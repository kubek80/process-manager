package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
)

func TestEveryAnswerCarriesSecurityHeaders(t *testing.T) {
	static := t.TempDir()
	must(t, os.WriteFile(filepath.Join(static, "index.html"), []byte("<html>app</html>"), 0o644))
	e := setup(t, func(d *Deps) { d.Cfg.StaticDir = static })
	for _, path := range []string{"/", "/api/me", "/healthz", "/api/nope"} {
		_, _, h := e.anonymous().raw("GET", path, nil, false)
		csp := h.Get("Content-Security-Policy")
		if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("X-Frame-Options") != "DENY" || h.Get("Referrer-Policy") != "same-origin" ||
			!strings.Contains(csp, "default-src 'self'") || !strings.Contains(csp, "frame-ancestors 'none'") || !strings.Contains(csp, "script-src 'self'") {
			t.Errorf("%s: %v", path, h)
		}
		if h.Get("Strict-Transport-Security") != "" {
			t.Errorf("%s: HSTS on plain http", path)
		}
	}
	https := setup(t, func(d *Deps) { d.Cfg.BaseURL = "https://pm.example.com" })
	if _, _, h := https.anonymous().raw("GET", "/api/me", nil, false); !strings.Contains(h.Get("Strict-Transport-Security"), "max-age=31536000") {
		t.Errorf("no HSTS behind https: %v", h)
	}
}

func TestSigningOutEndsEveryCopyOfTheSession(t *testing.T) {
	e := setup(t, nil)
	c := e.as(dana)
	// somebody copied the cookie before she signed out
	base, _ := url.Parse(e.srv.URL)
	jar, _ := cookiejar.New(nil)
	jar.SetCookies(base, c.http.Jar.Cookies(base))
	thief := &client{e: e, http: &http.Client{Jar: jar}}
	if status, _ := thief.do("GET", "/api/admin/access", nil); status != 200 {
		t.Fatalf("the copy before sign-out: %d", status)
	}
	other := e.as(sam)

	status, _ := c.do("POST", "/auth/logout", nil)
	wantStatus(t, status, 200, nil)
	if status, _ := thief.do("GET", "/api/admin/access", nil); status != 401 {
		t.Fatalf("the copy after sign-out: %d", status)
	}
	if _, me := thief.do("GET", "/api/me", nil); me["authenticated"] != false {
		t.Fatalf("the copy still counts as signed in: %v", me)
	}
	// other people are not affected, and she can sign in again
	if status, _ := other.do("GET", "/api/processes", nil); status != 200 {
		t.Fatalf("somebody else's session: %d", status)
	}
	if status, _ := e.as(dana).do("GET", "/api/admin/access", nil); status != 200 {
		t.Fatalf("signing in again: %d", status)
	}
	// signing out without a session is not an error
	if status, _ := e.anonymous().do("POST", "/auth/logout", nil); status != 200 {
		t.Fatalf("anonymous sign-out: %d", status)
	}
}

func TestReadyOnlyWhenTheDatabaseAnswers(t *testing.T) {
	down := false
	e := setup(t, func(d *Deps) {
		ping := d.Ready
		d.Ready = func(ctx context.Context) error {
			if down {
				return errors.New("connection refused")
			}
			return ping(ctx)
		}
	})
	c := e.anonymous()
	if status, _ := c.do("GET", "/readyz", nil); status != 200 {
		t.Fatalf("ready: %d", status)
	}
	down = true
	if status, body := c.do("GET", "/readyz", nil); status != 503 || body["error"] == nil {
		t.Fatalf("not ready: %d %v", status, body)
	}
	if status, _ := c.do("GET", "/healthz", nil); status != 200 {
		t.Fatalf("alive: %d", status)
	}
}

func TestAMissingFileIsNotTheAppPage(t *testing.T) {
	static := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(static, "assets"), 0o755))
	must(t, os.WriteFile(filepath.Join(static, "index.html"), []byte("<html>app</html>"), 0o644))
	e := setup(t, func(d *Deps) { d.Cfg.StaticDir = static })
	c := e.anonymous()
	// a browser that still runs the previous version asks for a script that is gone
	for _, path := range []string{"/assets/index-old123.js", "/favicon.ico", "/robots.txt", "/assets/"} {
		if status, body, _ := c.raw("GET", path, nil, false); status != 404 || strings.Contains(string(body), "<html>app") {
			t.Errorf("%s: %d %q", path, status, body)
		}
	}
	if status, body, _ := c.raw("GET", "/some/page", nil, false); status != 200 || string(body) != "<html>app</html>" {
		t.Errorf("a page of the app: %d %q", status, body)
	}
}

func TestRequestsAreLoggedAndBadJSONIsExplained(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	status, body := c.do("POST", "/api/feedback", "{not json")
	if status != 400 || body["error"] != "the request is not valid JSON" {
		t.Fatalf("%d %v", status, body)
	}
	log := e.logged.String()
	if !strings.Contains(log, "msg=request method=POST path=/api/feedback status=400") || !strings.Contains(log, "path=/auth/dev/login status=200") {
		t.Fatalf("request log: %s", log)
	}
	if strings.Contains(log, "/healthz") {
		t.Fatal("health checks must not fill the log")
	}
}

func TestTheActivityLogCanBeReadPageByPage(t *testing.T) {
	e := setup(t, nil)
	admin := e.as(dana)
	for _, who := range []string{"a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"} {
		status, body := admin.do("POST", "/api/admin/access", map[string]string{"email": who, "role": "process-editor"})
		wantStatus(t, status, 200, body)
	}
	_, first := admin.do("GET", "/api/admin/audit?limit=2", nil)
	entries := first["entries"].([]any)
	if len(entries) != 2 || first["more"] != true || entries[0].(map[string]any)["target"] != "e@example.com" {
		t.Fatalf("first page: %v", first)
	}
	last := entries[1].(map[string]any)["id"].(float64)
	_, second := admin.do("GET", "/api/admin/audit?limit=2&before="+strconv.Itoa(int(last)), nil)
	entries = second["entries"].([]any)
	if len(entries) != 2 || entries[0].(map[string]any)["target"] != "c@example.com" || second["more"] != true {
		t.Fatalf("second page: %v", second)
	}
	_, all := admin.do("GET", "/api/admin/audit", nil)
	if all["more"] != false || len(all["entries"].([]any)) != 5 {
		t.Fatalf("everything: %v", all["more"])
	}
	// taking away a role nobody has is refused and leaves no trace
	status, body := admin.do("DELETE", "/api/admin/access", map[string]string{"email": "nobody@example.com", "role": "process-editor"})
	wantStatus(t, status, 404, body)
	status, body = admin.do("DELETE", "/api/admin/access", map[string]string{"email": "a@example.com", "role": "no-such-role"})
	wantStatus(t, status, 404, body)
	if again, _ := e.deps.Audit.Recent(bg, 1); again[0].Action != "access.grant" {
		t.Fatalf("a refused change was recorded: %+v", again[0])
	}
}

func TestManagingOtherPeoplesFeedbackLeavesATrace(t *testing.T) {
	e := setup(t, nil)
	item := e.as(sam).report(docs.Process, gcp, "", "The form was renamed")
	id := item["id"].(string)
	owner := e.as(casey)
	status, body := owner.do("PATCH", "/api/feedback/"+id, fix(true))
	wantStatus(t, status, 200, body)
	owner.do("PATCH", "/api/feedback/"+id, fix(true)) // already fixed: nothing new happened
	owner.do("PATCH", "/api/feedback/"+id, fix(false))
	status, _, _ = owner.raw("DELETE", "/api/feedback/"+id, nil, true)
	wantStatus(t, status, 204, nil)
	// deleting your own report is not worth an entry
	own := e.as(sam).report(docs.Process, gcp, "", "Never mind")
	e.as(sam).raw("DELETE", "/api/feedback/"+own["id"].(string), nil, true)

	entries, _ := e.deps.Audit.Recent(bg, 10)
	var got []string
	for _, en := range entries {
		got = append(got, en.Action+" by "+en.Email+" ("+en.Detail+")")
	}
	want := []string{"feedback.delete by " + casey + " (reported by " + sam + ")", "feedback.reopen by " + casey + " (reported by " + sam + ")", "feedback.fixed by " + casey + " (reported by " + sam + ")"}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("activity:\n%s", strings.Join(got, "\n"))
	}
}

func TestOnePersonCannotFloodTheOwners(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	for i := 0; i < feedback.MaxPerHour; i++ {
		c.report(docs.Process, gcp, "", "The same thing again")
	}
	status, body := c.do("POST", "/api/feedback", map[string]string{"targetKind": docs.Process, "targetId": gcp, "kind": "broken", "text": "And again"})
	if status != 429 || !strings.Contains(body["error"].(string), "try again later") {
		t.Fatalf("%d %v", status, body)
	}
	// somebody else is not held back
	e.as(alex).report(docs.Process, gcp, "", "I see it too")
}
