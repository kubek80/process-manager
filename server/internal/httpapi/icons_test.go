package httpapi

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/icons"
)

func pngIcon(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	must(t, png.Encode(&b, image.NewGray(image.Rect(0, 0, w, h))))
	return b.Bytes()
}

const plainSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#246"/></svg>`

// upload sends an image as the body of POST /api/icons.
func (c *client) upload(contentType string, data []byte) (int, map[string]any) {
	c.e.t.Helper()
	req, _ := http.NewRequest("POST", c.e.srv.URL+"/api/icons", bytes.NewReader(data))
	req.Header.Set(CSRFHeader, CSRFValue)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := c.http.Do(req)
	must(c.e.t, err)
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (c *client) fetch(path string, header map[string]string) (int, []byte, http.Header) {
	c.e.t.Helper()
	req, _ := http.NewRequest("GET", c.e.srv.URL+path, nil)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := c.http.Do(req)
	must(c.e.t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return res.StatusCode, data, res.Header
}

func TestIconsAreUploadedByListsManagersAndServedToEveryone(t *testing.T) {
	e := setup(t, nil)
	data := pngIcon(t, 64, 64)
	id := icons.ID(data)

	status, out := e.anonymous().upload("image/png", data)
	wantStatus(t, status, 401, out)
	for _, who := range []string{sam, casey, jordan, riley} {
		status, out := e.as(who).upload("image/png", data)
		wantError(t, status, out, 403, "Only people who manage the lists can add icons.")
	}
	for _, who := range []string{alex, dana} { // a lists manager, an admin
		status, out := e.as(who).upload("image/png", data)
		wantStatus(t, status, 200, out)
		if out["id"] != id || out["contentType"] != "image/png" || out["width"] != 64.0 || out["height"] != 64.0 || len(out) != 4 {
			t.Fatalf("%s: %v", who, out)
		}
	}
	// stored once, recorded once
	var n int
	must(t, e.deps.Docs.Pool.QueryRow(bg, `select count(*) from icons`).Scan(&n))
	entries, _ := e.deps.Audit.Recent(bg, 5)
	uploads := 0
	for _, en := range entries {
		if en.Action == "icon.upload" {
			uploads++
			if en.Target != id || en.Detail != "PNG image, 64 × 64" || en.Email != alex {
				t.Fatalf("audit: %+v", en)
			}
		}
	}
	if n != 1 || uploads != 1 {
		t.Fatalf("stored %d, recorded %d", n, uploads)
	}

	// everyone signed in fetches it, with headers that keep it inert
	status, _, _ = e.anonymous().fetch("/api/icons/"+id, nil)
	if status != 401 {
		t.Fatalf("anonymous: %d", status)
	}
	status, body, h := e.as(sam).fetch("/api/icons/"+id, nil)
	if status != 200 || !bytes.Equal(body, data) {
		t.Fatalf("fetch: %d %d bytes", status, len(body))
	}
	for k, v := range map[string]string{
		"Content-Type":            "image/png",
		"Cache-Control":           "private, max-age=31536000, immutable",
		"X-Content-Type-Options":  "nosniff",
		"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
		"ETag":                    `"` + id + `"`,
	} {
		if got := h.Values(k); len(got) != 1 || got[0] != v {
			t.Errorf("%s: %q, want %q", k, got, v)
		}
	}
	for _, etag := range []string{`"` + id + `"`, `W/"` + id + `"`, `"other", "` + id + `"`} {
		status, body, h = e.as(sam).fetch("/api/icons/"+id, map[string]string{"If-None-Match": etag})
		if status != 304 || len(body) != 0 || h.Get("ETag") != `"`+id+`"` {
			t.Fatalf("%s: %d %q", etag, status, body)
		}
	}
	if status, _, _ = e.as(sam).fetch("/api/icons/"+id, map[string]string{"If-None-Match": `"other"`}); status != 200 {
		t.Fatalf("other etag: %d", status)
	}
}

func TestAServedSVGCannotRunAnything(t *testing.T) {
	e := setup(t, nil)
	status, out := e.as(alex).upload("image/svg+xml", []byte(plainSVG))
	wantStatus(t, status, 200, out)
	if out["width"] != 16.0 || out["contentType"] != "image/svg+xml" {
		t.Fatalf("%v", out)
	}
	status, body, h := e.as(sam).fetch("/api/icons/"+out["id"].(string), nil)
	csp := h.Get("Content-Security-Policy")
	// opened on its own in a tab: no script, nothing loaded, a sandbox without scripts
	if status != 200 || string(body) != plainSVG || h.Get("Content-Type") != "image/svg+xml" || h.Get("X-Content-Type-Options") != "nosniff" ||
		!strings.Contains(csp, "default-src 'none'") || !strings.Contains(csp, "sandbox") || strings.Contains(csp, "allow-scripts") || strings.Contains(csp, "script-src") {
		t.Fatalf("%d %v", status, h)
	}
	// and nothing that could run is stored in the first place
	for _, bad := range []string{
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(document.cookie)"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>`,
	} {
		status, out := e.as(alex).upload("image/svg+xml", []byte(bad))
		if status != 400 || !strings.HasSuffix(out["error"].(string), "Only plain drawings can be used as icons.") {
			t.Fatalf("%s: %d %v", bad, status, out)
		}
	}
}

func TestUploadsThatAreRefused(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	for _, c := range []struct {
		kind string
		data []byte
		want string
	}{
		{"image/jpeg", pngIcon(t, 8, 8), "The file was sent as a JPEG image, but it is a PNG image."},
		{"image/svg+xml", pngIcon(t, 8, 8), "The file was sent as an SVG image, but it is a PNG image."},
		{"", pngIcon(t, 8, 8), "Only PNG, JPEG, WebP and SVG images can be used as icons."},
		{"text/html", []byte("<script>alert(1)</script>"), "Only PNG, JPEG, WebP and SVG images can be used as icons."},
		{"image/png", []byte("hello"), "This file is not a PNG, JPEG, WebP or SVG image."},
		{"image/png", pngIcon(t, 64, 48), "The image must be square: this one is 64 × 48 pixels."},
		{"image/png", pngIcon(t, 600, 600), "The image must be at most 512 × 512 pixels: this one is 600 × 600."},
		{"image/png", nil, "The file is empty."},
		{"image/png", append(pngIcon(t, 8, 8), make([]byte, 70<<10)...), "The image is larger than 64 KB. Make it smaller and try again."},
	} {
		status, out := a.upload(c.kind, c.data)
		wantError(t, status, out, 400, c.want)
	}
	var n int
	must(t, e.deps.Docs.Pool.QueryRow(bg, `select count(*) from icons`).Scan(&n))
	if n != 0 {
		t.Fatalf("stored: %d", n)
	}
}

// counting is a body that would be very large; it counts what was read of it.
type counting struct {
	left int64
	read atomic.Int64
}

func (c *counting) Read(p []byte) (int, error) {
	if c.left <= 0 {
		return 0, io.EOF
	}
	n := int64(len(p))
	if n > c.left {
		n = c.left
	}
	for i := range p[:n] {
		p[i] = 'a'
	}
	c.left -= n
	c.read.Add(n)
	return int(n), nil
}

func TestAnOversizedUploadIsCutOff(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	for _, declared := range []bool{true, false} {
		const size = 50 << 20
		body := &counting{left: size}
		req, _ := http.NewRequest("POST", e.srv.URL+"/api/icons", body)
		req.Header.Set(CSRFHeader, CSRFValue)
		req.Header.Set("Content-Type", "image/png")
		if declared {
			req.ContentLength = size
		} else {
			req.ContentLength = -1 // sent in chunks: the size is not known in advance
		}
		res, err := a.http.Do(req)
		if err == nil {
			out, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode != 400 && res.StatusCode != 413 {
				t.Fatalf("declared %v: %d %s", declared, res.StatusCode, out)
			}
			if res.StatusCode == 400 && !strings.Contains(string(out), "larger than 64 KB") {
				t.Fatalf("declared %v: %s", declared, out)
			}
		}
		// the server stopped reading long before the end (what is in flight in buffers aside)
		if got := body.read.Load(); got > 4<<20 {
			t.Fatalf("declared %v: %d bytes were read", declared, got)
		}
	}
}

func TestIconAddressesThatAreNotIcons(t *testing.T) {
	e := setup(t, nil)
	_, out := e.as(alex).upload("image/svg+xml", []byte(plainSVG))
	id := out["id"].(string)
	s := e.as(sam)
	for _, path := range []string{
		"/api/icons/" + strings.ToUpper(id),
		"/api/icons/" + id + ".svg",
		"/api/icons/" + id[:63],
		"/api/icons/" + strings.Repeat("0", 64),
		"/api/icons/..%2f..%2fapi%2fme",
		"/api/icons/%2e%2e",
		"/api/icons/" + id + "%00",
		"/api/icons/" + id + "/x",
		"/api/icons/",
	} {
		status, body, h := s.fetch(path, nil)
		if status == 200 || strings.Contains(h.Get("Content-Type"), "svg") || bytes.Contains(body, []byte("<svg")) {
			t.Errorf("%s: %d %s", path, status, body)
		}
	}
}

func TestConcurrentUploadsOfTheSameImage(t *testing.T) {
	e := setup(t, nil)
	data := pngIcon(t, 32, 32)
	clients := []*client{e.as(alex), e.as(dana)}
	var wg sync.WaitGroup
	ids := make([]string, 10)
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest("POST", e.srv.URL+"/api/icons", bytes.NewReader(data))
			req.Header.Set(CSRFHeader, CSRFValue)
			req.Header.Set("Content-Type", "image/png")
			res, err := clients[i%2].http.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			defer res.Body.Close()
			var out map[string]any
			_ = json.NewDecoder(res.Body).Decode(&out)
			if res.StatusCode != 200 {
				t.Errorf("%d %v", res.StatusCode, out)
				return
			}
			ids[i] = out["id"].(string)
		}()
	}
	wg.Wait()
	var n int
	must(t, e.deps.Docs.Pool.QueryRow(bg, `select count(*) from icons`).Scan(&n))
	if n != 1 {
		t.Fatalf("stored %d times", n)
	}
	for _, id := range ids {
		if id != icons.ID(data) {
			t.Fatalf("ids: %v", ids)
		}
	}
}

func setIcon(key, id, icon string) func(map[string]any) {
	return func(c map[string]any) {
		for _, n := range c[key].([]any) {
			if m := n.(map[string]any); m["id"] == id {
				m["icon"] = icon
			}
		}
	}
}

func TestListsCannotNameAnIconThatIsNotStored(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	data := pngIcon(t, 16, 16)
	id := icons.ID(data)
	unknown := strings.Repeat("e", 64)

	status, out := a.do("PUT", "/api/catalog", e.catalogWith(setIcon("tools", "github", id)))
	wantError(t, status, out, 400, "The icon of the tool “GitHub” has not been uploaded. Choose the image again.")
	status, out = a.do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		setIcon("tools", "jira-not-there", id)(c)
		setIcon("tools", "terraform", unknown)(c)
		setIcon("languages", "go", unknown)(c)
	}))
	wantError(t, status, out, 400, "The icons of the tool “Terraform” and the language “Go” have not been uploaded. Choose the images again.")

	status, out = a.upload("image/png", data)
	wantStatus(t, status, 200, out)
	status, out = a.do("PUT", "/api/catalog", e.catalogWith(setIcon("tools", "github", id)))
	wantStatus(t, status, 200, out)
	if cat, _ := e.deps.Docs.Get(bg, docs.Catalog, docs.CatalogID); !strings.Contains(string(cat.Body), id) {
		t.Fatal("not saved")
	}
	// lists that already name an icon that is not stored (imported without its file) can still
	// be saved: only a newly named icon must be there
	_, err := e.deps.Docs.Pool.Exec(bg, `delete from icons`)
	must(t, err)
	status, out = a.do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["tools"].([]any)[0].(map[string]any)["description"] = "Changed."
	}))
	wantStatus(t, status, 200, out)
}
