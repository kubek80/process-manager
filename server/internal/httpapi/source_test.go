package httpapi

import (
	"bytes"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAllowedSourcePath(t *testing.T) {
	for _, p := range []string{
		"server/internal/docs/store.go", "src/App.tsx", "src/lib/search.ts", "scripts/dev.mjs", "a.cjs", "a.js", "src/styles.css",
		"server/internal/db/migrations/001_init.sql", "package.json", "README.md", "docker-compose.yml", "x.yaml", "index.html",
		"deploy/cloudrun/deploy.sh", "server/go.mod", "Dockerfile", "deploy/Dockerfile", ".github/workflows/ci.yml",
	} {
		if !allowedSourcePath(p) {
			t.Errorf("refused: %q", p)
		}
	}
	for _, p := range []string{
		"", "/etc/passwd", "../x.go", "a/../b.go", "a/./b.go", "./a.go", "a//b.go", "a/b.go/", ".", "..",
		`a\b.go`, `..\x.go`, "C:/x.go", "a.go\x00.png", "a\x00.go", "%2e%2e/x.go", "a b.go", "a\n.go", "a\u00e9.go", "\xff.go",
		".env", ".env.local", "server/.env", "x/.env.example", "a/.hidden.go", ".hidden/a.go", ".git/config.json", ".github/x.yml",
		".github/workflows/sub/ci.yml", ".github/workflows", ".claude/skills/x/SKILL.md", "a/.github/workflows/ci.yml",
		"node_modules/x/index.js", "a/node_modules/b.ts", "dist/index.html", "test-results/x.json", "playwright-report/index.html", "coverage/x.json",
		"key.pem", "server.key", "a/client_secret.json", "my-SECRET.ts", "credentials.json", "gcp-credential.yml", "secrets/a.go",
		"image.png", "a.svg", "go.sum", "a.txt", "Makefile", "dockerfile", "a.GO", "a.go.bak", ".go", "server/internal/docs",
		strings.Repeat("a/", 260) + "b.go",
	} {
		if allowedSourcePath(p) {
			t.Errorf("allowed: %q", p)
		}
	}
}

// sourceTree makes a checkout with the files the tests ask for, a folder outside it, and links
// between them. It returns the checkout and the outside folder.
func sourceTree(t *testing.T) (string, string) {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "checkout")
	outside := filepath.Join(base, "outside")
	write := func(dir, name string, data []byte) {
		full := filepath.Join(dir, filepath.FromSlash(name))
		must(t, os.MkdirAll(filepath.Dir(full), 0o755))
		must(t, os.WriteFile(full, data, 0o644))
	}
	for name, text := range map[string]string{
		"server/internal/docs/store.go": "package docs\n\n// Save stores a version.\n",
		".github/workflows/ci.yml":      "name: ci\n",
		"Dockerfile":                    "FROM scratch\n",
		".env":                          "PM_SESSION_SECRET=do-not-show\n",
		".env.local":                    "TOKEN=do-not-show\n",
		"server.pem":                    "-----BEGIN-----\n",
		"a/client_secret.json":          "{}\n",
		".hidden/a.go":                  "package hidden\n",
		"node_modules/x/index.js":       "module.exports = 1\n",
		"dist/index.html":               "<html></html>\n",
		"notes.txt":                     "text\n",
		"folder.go/inside.go":           "package inside\n",
	} {
		write(root, name, []byte(text))
	}
	write(root, "binary.go", []byte("package x\x00\x01\x02"))
	write(root, "latin1.go", []byte("package x // caf\xe9\n"))
	write(root, "image.png", []byte("\x89PNG\r\n"))
	write(root, "big.ts", bytes.Repeat([]byte("a"), maxSourceBytes+1))
	write(root, "limit.ts", bytes.Repeat([]byte("a"), maxSourceBytes))
	write(outside, "secret.go", []byte("package outside // do-not-show\n"))
	write(outside, "plain.go", []byte("package outside // do-not-show\n"))
	link := func(target, name string) {
		must(t, os.Symlink(target, filepath.Join(root, filepath.FromSlash(name))))
	}
	link(filepath.Join(outside, "plain.go"), "out.go")         // a file outside, by absolute path
	link("../outside/plain.go", "relout.go")                   // a file outside, by relative path
	link(outside, "outdir")                                    // a folder outside
	link(".env", "env.ts")                                     // a refused file inside
	link(".hidden/a.go", "hidden.go")                          // a hidden file inside
	link("server/internal/docs/store.go", "store-link.go")     // an allowed file inside
	link("missing.go", "dangling.go")                          // nothing
	link("server/internal/docs", "docs-link.go")               // a folder inside, with an allowed name
	must(t, os.Symlink(root, filepath.Join(base, "via-link"))) // the checkout itself reached through a link
	return filepath.Join(base, "via-link"), outside
}

func sourceQuery(p string) string { return "/api/admin/source?path=" + url.QueryEscape(p) }

func TestTheSourceIsReadByAdminsOnly(t *testing.T) {
	root, _ := sourceTree(t)
	e := setup(t, func(d *Deps) { d.Cfg.SourceDir = root })
	before, err := e.deps.Audit.Recent(bg, 1000)
	must(t, err)

	status, raw, h := e.as(dana).raw("GET", sourceQuery("server/internal/docs/store.go"), nil, false)
	if status != 200 || h.Get("Cache-Control") != "no-store" || h.Get("Content-Type") != "application/json" {
		t.Fatalf("admin: %d %v %s", status, h, raw)
	}
	_, body := e.as(dana).do("GET", sourceQuery("server/internal/docs/store.go"), nil)
	want := "package docs\n\n// Save stores a version.\n"
	if body["path"] != "server/internal/docs/store.go" || body["text"] != want || body["bytes"] != float64(len(want)) || len(body) != 3 {
		t.Fatalf("answer: %v", body)
	}
	for _, p := range []string{".github/workflows/ci.yml", "Dockerfile", "store-link.go", "limit.ts", "folder.go/inside.go"} {
		if status, body := e.as(dana).do("GET", sourceQuery(p), nil); status != 200 || body["path"] != p {
			t.Errorf("%s: %d %v", p, status, body)
		}
	}

	// readers, editors and owners of every kind are refused
	for _, who := range []string{sam, alex, casey, riley, jordan} {
		status, raw, _ := e.as(who).raw("GET", sourceQuery("server/internal/docs/store.go"), nil, false)
		if status != 403 || strings.Contains(string(raw), "package") {
			t.Errorf("%s: %d %s", who, status, raw)
		}
	}
	if status, _, _ := e.anonymous().raw("GET", sourceQuery("server/internal/docs/store.go"), nil, false); status != 401 {
		t.Errorf("anonymous: %d", status)
	}
	// only reading: nothing else answers at this address
	if status, _ := e.as(dana).do("PUT", sourceQuery("Dockerfile"), "x"); status != 405 && status != 404 {
		t.Errorf("PUT: %d", status)
	}

	// reading is not written to Activity
	after, err := e.deps.Audit.Recent(bg, 1000)
	must(t, err)
	if len(after) != len(before) {
		t.Fatalf("reading was recorded: %d entries, before %d", len(after), len(before))
	}

	// the system information says the source can be shown
	if _, sys := e.as(dana).do("GET", "/api/admin/system", nil); sys["source"] != true {
		t.Fatalf("system: %v", sys)
	}
}

func TestTheSourceRefusesEverythingOutsideTheList(t *testing.T) {
	root, outside := sourceTree(t)
	e := setup(t, func(d *Deps) { d.Cfg.SourceDir = root })
	admin := e.as(dana)

	_, refused, refusedHeaders := admin.raw("GET", sourceQuery("never-there.go"), nil, false)
	if !strings.Contains(string(refused), sourceRefusedMessage) {
		t.Fatalf("the refusal: %s", refused)
	}
	for _, query := range []string{
		sourceQuery("../outside/plain.go"),              // ..
		sourceQuery(filepath.Join(outside, "plain.go")), // an absolute path
		sourceQuery("/etc/passwd"),                      // an absolute path
		sourceQuery("out.go"),                           // a link to a file outside
		sourceQuery("relout.go"),                        // a relative link to a file outside
		sourceQuery("outdir/plain.go"),                  // through a link to a folder outside
		sourceQuery("env.ts"),                           // a link to .env inside
		sourceQuery("hidden.go"),                        // a link to a hidden file inside
		sourceQuery("dangling.go"),                      // a link to nothing
		sourceQuery("docs-link.go"),                     // a link to a folder
		sourceQuery(".env"), sourceQuery(".env.local"),  // secrets
		sourceQuery("server.pem"), sourceQuery("a/client_secret.json"),
		sourceQuery(".hidden/a.go"), // a hidden folder
		sourceQuery("node_modules/x/index.js"), sourceQuery("dist/index.html"),
		sourceQuery("binary.go"),                           // not text
		sourceQuery("latin1.go"),                           // not UTF-8
		sourceQuery("image.png"), sourceQuery("notes.txt"), // unknown endings
		sourceQuery("big.ts"),                                        // too large
		sourceQuery("folder.go"),                                     // a folder
		sourceQuery("server/internal/docs"),                          // a folder
		sourceQuery("never-there.go"),                                // nothing
		"/api/admin/source?path=%2e%2e%2foutside%2fplain.go",         // encoded ..
		"/api/admin/source?path=%2e%2e/outside/plain.go",             //
		"/api/admin/source?path=%252e%252e%252foutside%252fplain.go", // encoded twice
		"/api/admin/source?path=..%5Coutside%5Cplain.go",             // a backslash
		"/api/admin/source?path=Dockerfile%00.png",                   // a NUL byte
		"/api/admin/source?path=Dockerfile%00",                       //
		"/api/admin/source?path=.%2FDockerfile",                      // not cleaned
		"/api/admin/source?path=server//internal/docs/store.go",      //
		"/api/admin/source?path=server/internal/docs/store.go/",      //
		"/api/admin/source?path=%zz",                                 // not a query
		"/api/admin/source?path=Dockerfile&path=.env",                // twice
		"/api/admin/source",                                          // no path
		"/api/admin/source?path=",                                    //
	} {
		status, raw, h := admin.raw("GET", query, nil, false)
		if status != 404 || !bytes.Equal(raw, refused) || h.Get("Content-Type") != refusedHeaders.Get("Content-Type") ||
			h.Get("Cache-Control") != refusedHeaders.Get("Cache-Control") || h.Get("Content-Length") != refusedHeaders.Get("Content-Length") {
			t.Errorf("%s: %d %v %s", query, status, h, raw)
		}
		if strings.Contains(string(raw), "do-not-show") {
			t.Errorf("%s gave away: %s", query, raw)
		}
	}
}

func TestTheSourceIsOffWithoutAFolder(t *testing.T) {
	for name, dir := range map[string]string{"not set": "", "missing": filepath.Join(t.TempDir(), "gone"), "a file": func() string {
		f := filepath.Join(t.TempDir(), "file")
		must(t, os.WriteFile(f, []byte("x"), 0o644))
		return f
	}()} {
		e := setup(t, func(d *Deps) { d.Cfg.SourceDir = dir })
		admin := e.as(dana)
		var first []byte
		for _, p := range []string{"server/internal/docs/store.go", "Dockerfile", ".env", "../x.go", "go.mod", ""} {
			status, raw, _ := admin.raw("GET", sourceQuery(p), nil, false)
			if status != 404 || !strings.Contains(string(raw), sourceOffMessage) || (first != nil && !bytes.Equal(raw, first)) {
				t.Errorf("%s, %q: %d %s", name, p, status, raw)
			}
			first = raw
		}
		if _, sys := admin.do("GET", "/api/admin/system", nil); sys["source"] != false {
			t.Errorf("%s: system %v", name, sys)
		}
	}
}

func TestTheRepositoryItselfCanBeRead(t *testing.T) {
	root, err := filepath.Abs(repoRoot)
	must(t, err)
	for _, p := range []string{"server/internal/httpapi/source.go", "package.json", "Dockerfile", "src/App.tsx"} {
		data, ok := readSource(root, p)
		if !ok || len(data) == 0 {
			t.Errorf("%s: not read", p)
		}
	}
	for _, p := range []string{".env.example", ".gitignore", "server/go.sum", "catalog/icons"} {
		if _, ok := readSource(root, p); ok {
			t.Errorf("%s: read", p)
		}
	}
}
