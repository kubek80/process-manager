package httpapi

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSourceAllowedPath(t *testing.T) {
	for _, p := range []string{
		"server/internal/docs/store.go", "src/App.tsx", "src/lib/search.ts", "scripts/dev.mjs", "a.cjs", "a.js", "src/styles.css",
		"server/internal/db/migrations/001_init.sql", "package.json", "README.md", "docker-compose.yml", "x.yaml", "index.html",
		"deploy/cloudrun/deploy.sh", "server/go.mod", "Dockerfile", "deploy/Dockerfile", ".github/workflows/ci.yml",
		// tracking decides about these: the demo set has a standard named secrets-management
		"demo/standards/secrets-management.json", "a/client_secret.json", "credentials.json",
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
		"key.pem", "server.key", "a/b.key/c.go",
		"image.png", "a.svg", "go.sum", "a.txt", "Makefile", "dockerfile", "a.GO", "a.go.bak", ".go", "server/internal/docs",
		strings.Repeat("a/", 260) + "b.go",
	} {
		if allowedSourcePath(p) {
			t.Errorf("allowed: %q", p)
		}
	}
}

// git runs git in dir for a test, with an identity and no configuration from outside.
func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com", "GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func needGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed: the source of Admin › Code map is listed with git, so these tests need it")
	}
}

// sourceCheckout makes a git checkout with the files the tests ask for (most of them tracked),
// a folder outside it, and links between them. It returns the checkout (reached through a link)
// and the outside folder.
func sourceCheckout(t *testing.T) (string, string) {
	t.Helper()
	needGit(t)
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
		"server.pem":                    "-----BEGIN----- do-not-show\n",
		"a/client_secret.json":          "{\"tracked\": true}\n",
		".hidden/a.go":                  "package hidden // do-not-show\n",
		"node_modules/x/index.js":       "module.exports = 1\n",
		"dist/index.html":               "<html></html>\n",
		"notes.txt":                     "text\n",
		"folder.go/inside.go":           "package inside\n",
		"fifo.go":                       "package fifo\n",
		"swap.go":                       "package swap // fine\n",
		"race/t.go":                     "package race // fine\n",
	} {
		write(root, name, []byte(text))
	}
	write(root, "binary.go", []byte("package x\x00\x01\x02"))
	write(root, "latin1.go", []byte("package x // caf\xe9\n"))
	write(root, "image.png", []byte("\x89PNG\r\n"))
	write(root, "big.ts", bytes.Repeat([]byte("a"), maxSourceBytes+1))
	write(root, "limit.ts", bytes.Repeat([]byte("a"), maxSourceBytes))
	write(outside, "plain.go", []byte("package outside // do-not-show\n"))
	write(outside, "race/t.go", []byte("package outside // do-not-show\n"))
	link := func(target, name string) {
		must(t, os.Symlink(target, filepath.Join(root, filepath.FromSlash(name))))
	}
	link(filepath.Join(outside, "plain.go"), "out.go")           // a file outside, by absolute path
	link("../outside/plain.go", "relout.go")                     // a file outside, by relative path
	link(outside, "outdir")                                      // a folder outside
	link(".env", "env.ts")                                       // a refused file inside
	link(".hidden/a.go", "hidden.go")                            // a hidden file inside
	link("server/internal/docs/store.go", "store-link.go")       // an allowed file inside
	link("missing.go", "dangling.go")                            // nothing
	link("server/internal/docs", "docs-link.go")                 // a folder inside, with an allowed name
	link("server/internal/docs/key.json", "key-link.go")         // a file that is not tracked
	link(filepath.Join(outside, "race"), "race-out")             // for swapping with race/
	must(t, os.Symlink(".env", filepath.Join(root, "swap-env"))) // for swapping with swap.go
	gitIn(t, root, "init", "-q")
	gitIn(t, root, "add", "-A")
	// not tracked: dropped into the working checkout after the last `git add`
	write(root, "server/internal/docs/key.json", []byte("{\"private_key\": \"do-not-show\"}\n"))
	write(root, "untracked.go", []byte("package untracked // do-not-show\n"))
	must(t, os.Symlink(root, filepath.Join(base, "via-link"))) // the checkout itself reached through a link
	return filepath.Join(base, "via-link"), outside
}

func sourceQuery(p string) string { return "/api/admin/source?path=" + url.QueryEscape(p) }

// countListings counts how often the tracked files are listed during a test.
func countListings(t *testing.T) *atomic.Int64 {
	var n atomic.Int64
	old := listFiles
	listFiles = func(ctx context.Context, root string) (map[string]bool, string) {
		n.Add(1)
		return old(ctx, root)
	}
	t.Cleanup(func() { listFiles = old })
	return &n
}

func TestSourceIsReadByAdminsOnly(t *testing.T) {
	root, _ := sourceCheckout(t)
	listings := countListings(t)
	e := setup(t, func(d *Deps) { d.Cfg.SourceDir = root })
	before, err := e.deps.Audit.Recent(bg, 1000)
	must(t, err)

	admin := e.as(dana)
	status, raw, h := admin.raw("GET", sourceQuery("server/internal/docs/store.go"), nil, false)
	if status != 200 || h.Get("Cache-Control") != "no-store" || h.Get("Content-Type") != "application/json" {
		t.Fatalf("admin: %d %v %s", status, h, raw)
	}
	_, body := admin.do("GET", sourceQuery("server/internal/docs/store.go"), nil)
	want := "package docs\n\n// Save stores a version.\n"
	if body["path"] != "server/internal/docs/store.go" || body["text"] != want || body["bytes"] != float64(len(want)) || len(body) != 3 {
		t.Fatalf("answer: %v", body)
	}
	for _, p := range []string{".github/workflows/ci.yml", "Dockerfile", "store-link.go", "limit.ts", "folder.go/inside.go", "a/client_secret.json"} {
		if status, body := admin.do("GET", sourceQuery(p), nil); status != 200 || body["path"] != p {
			t.Errorf("%s: %d %v", p, status, body)
		}
	}
	// the tracked files were listed once, not per request
	if n := listings.Load(); n != 1 {
		t.Errorf("listed %d times", n)
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
	if status, _ := admin.do("PUT", sourceQuery("Dockerfile"), "x"); status != 405 && status != 404 {
		t.Errorf("PUT: %d", status)
	}

	// reading is not written to Activity
	after, err := e.deps.Audit.Recent(bg, 1000)
	must(t, err)
	if len(after) != len(before) {
		t.Fatalf("reading was recorded: %d entries, before %d", len(after), len(before))
	}
	if _, sys := admin.do("GET", "/api/admin/system", nil); sys["source"] != true {
		t.Fatalf("system: %v", sys)
	}

	// a file added to git is readable at once; the list is made again because the index changed
	real, err := filepath.EvalSymlinks(root)
	must(t, err)
	must(t, os.WriteFile(filepath.Join(real, "added.go"), []byte("package added\n"), 0o644))
	if status, _ := admin.do("GET", sourceQuery("added.go"), nil); status != 404 {
		t.Errorf("an untracked file: %d", status)
	}
	gitIn(t, real, "add", "added.go")
	if status, body := admin.do("GET", sourceQuery("added.go"), nil); status != 200 || body["text"] != "package added\n" {
		t.Errorf("after git add: %d %v", status, body)
	}
	if n := listings.Load(); n != 2 {
		t.Errorf("listed %d times after one change of the index", n)
	}
}

func TestSourceRefusesEverythingElseWithOneAnswer(t *testing.T) {
	root, outside := sourceCheckout(t)
	e := setup(t, func(d *Deps) { d.Cfg.SourceDir = root })
	admin := e.as(dana)

	_, refused, refusedHeaders := admin.raw("GET", sourceQuery("never-there.go"), nil, false)
	if !strings.Contains(string(refused), sourceRefusedMessage) {
		t.Fatalf("the refusal: %s", refused)
	}
	for _, query := range []string{
		sourceQuery("server/internal/docs/key.json"), // not tracked, beside a tracked file
		sourceQuery("untracked.go"),                  // not tracked
		sourceQuery("key-link.go"),                   // a tracked link to a file that is not tracked
		sourceQuery("../outside/plain.go"),           // ..
		sourceQuery(filepath.Join(outside, "plain.go")),
		sourceQuery("/etc/passwd"),
		sourceQuery("out.go"),                                                     // a link to a file outside
		sourceQuery("relout.go"),                                                  // a relative link to a file outside
		sourceQuery("outdir/plain.go"),                                            // through a link to a folder outside
		sourceQuery("env.ts"),                                                     // a link to .env inside
		sourceQuery("hidden.go"),                                                  // a link to a hidden file inside
		sourceQuery("dangling.go"),                                                // a link to nothing
		sourceQuery("docs-link.go"),                                               // a link to a folder
		sourceQuery(".env"), sourceQuery(".env.local"), sourceQuery("server.pem"), // tracked, refused by name
		sourceQuery(".hidden/a.go"),
		sourceQuery("node_modules/x/index.js"), sourceQuery("dist/index.html"),
		sourceQuery("binary.go"), // not text
		sourceQuery("latin1.go"), // not UTF-8
		sourceQuery("image.png"), sourceQuery("notes.txt"),
		sourceQuery("big.ts"),               // too large
		sourceQuery("folder.go"),            // a folder
		sourceQuery("server/internal/docs"), // a folder
		sourceQuery("never-there.go"),
		"/api/admin/source?path=%2e%2e%2foutside%2fplain.go",
		"/api/admin/source?path=%2e%2e/outside/plain.go",
		"/api/admin/source?path=%252e%252e%252foutside%252fplain.go",
		"/api/admin/source?path=..%5Coutside%5Cplain.go",
		"/api/admin/source?path=Dockerfile%00.png",
		"/api/admin/source?path=Dockerfile%00",
		"/api/admin/source?path=.%2FDockerfile",
		"/api/admin/source?path=server//internal/docs/store.go",
		"/api/admin/source?path=server/internal/docs/store.go/",
		"/api/admin/source?path=%zz",
		"/api/admin/source?path=Dockerfile&path=.env",
		"/api/admin/source",
		"/api/admin/source?path=",
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

func TestSourceIsOffWithoutACheckout(t *testing.T) {
	needGit(t)
	plain := t.TempDir()
	must(t, os.WriteFile(filepath.Join(plain, "Dockerfile"), []byte("FROM scratch\n"), 0o644))
	file := filepath.Join(t.TempDir(), "file")
	must(t, os.WriteFile(file, []byte("x"), 0o644))
	// a folder inside a checkout is not a checkout of its own
	outer := t.TempDir()
	gitIn(t, outer, "init", "-q")
	inner := filepath.Join(outer, "inner")
	must(t, os.MkdirAll(inner, 0o755))
	must(t, os.WriteFile(filepath.Join(inner, "Dockerfile"), []byte("FROM scratch\n"), 0o644))
	gitIn(t, outer, "add", "-A")
	for name, dir := range map[string]string{"not set": "", "missing": filepath.Join(t.TempDir(), "gone"), "a file": file, "not a checkout": plain, "inside a checkout": inner} {
		e := setup(t, func(d *Deps) { d.Cfg.SourceDir = dir })
		admin := e.as(dana)
		var first []byte
		for _, p := range []string{"Dockerfile", "server/internal/docs/store.go", ".env", "../x.go", ""} {
			status, raw, _ := admin.raw("GET", sourceQuery(p), nil, false)
			if status != 404 || !strings.Contains(string(raw), sourceOffMessage) || (first != nil && !bytes.Equal(raw, first)) {
				t.Errorf("%s, %q: %d %s", name, p, status, raw)
			}
			first = raw
		}
		if _, sys := admin.do("GET", "/api/admin/system", nil); sys["source"] != false {
			t.Errorf("%s: system %v", name, sys)
		}
		if got := SourceProblem(dir); (dir == "") != (got == "") || (dir != "" && !strings.HasPrefix(got, "Admin › Code map shows no source code: ")) {
			t.Errorf("%s: problem %q", name, got)
		}
	}
}

func TestSourceIsOffWithoutGit(t *testing.T) {
	root, _ := sourceCheckout(t)
	t.Setenv("PATH", "")
	if got := SourceProblem(root); !strings.Contains(got, "git is not installed") {
		t.Errorf("problem: %q", got)
	}
	e := setup(t, func(d *Deps) { d.Cfg.SourceDir = root })
	status, raw, _ := e.as(dana).raw("GET", sourceQuery("Dockerfile"), nil, false)
	if status != 404 || !strings.Contains(string(raw), sourceOffMessage) {
		t.Errorf("%d %s", status, raw)
	}
}

func TestSourceGitRunsWithAnEnvironmentOfItsOwn(t *testing.T) {
	env := strings.Join(gitEnv("/srv/checkout"), "\n")
	for _, want := range []string{"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=" + os.DevNull, "GIT_TERMINAL_PROMPT=0", "GIT_CEILING_DIRECTORIES=/srv"} {
		if !strings.Contains(env, want) {
			t.Errorf("missing %s in %s", want, env)
		}
	}
	// a checkout whose own configuration asks for a program to be run: it is not run
	root, _ := sourceCheckout(t)
	real, err := filepath.EvalSymlinks(root)
	must(t, err)
	marker := filepath.Join(t.TempDir(), "ran")
	script := filepath.Join(t.TempDir(), "monitor.sh")
	must(t, os.WriteFile(script, []byte("#!/bin/sh\ntouch "+marker+"\n"), 0o755))
	gitIn(t, real, "config", "core.fsmonitor", script)
	v, problem := (&sourceTree{dir: root}).current(bg)
	if problem != "" || !v.tracked["Dockerfile"] {
		t.Fatalf("listing: %q %v", problem, v.tracked)
	}
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("the checkout's core.fsmonitor was run")
	}
	// nothing of the server's own environment is passed on to git
	for _, leak := range []string{"GIT_DIR", "GIT_INDEX_FILE", "GIT_CONFIG_PARAMETERS", "GIT_WORK_TREE"} {
		t.Setenv(leak, "/elsewhere")
		if strings.Contains(strings.Join(gitEnv("/srv/checkout"), "\n"), leak+"=") {
			t.Errorf("%s is passed on", leak)
		}
	}
	if !strings.Contains(strings.Join(gitArgs, " "), "-c core.fsmonitor=false") {
		t.Errorf("args: %v", gitArgs)
	}
}

func TestSourceOfThisRepositoryCanBeRead(t *testing.T) {
	needGit(t)
	dir, err := filepath.Abs(repoRoot)
	must(t, err)
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		t.Skip("not a git checkout")
	}
	v, problem := (&sourceTree{dir: dir}).current(bg)
	if problem != "" {
		t.Fatal(problem)
	}
	for _, p := range []string{"server/internal/httpapi/api.go", "package.json", "Dockerfile", "src/App.tsx", "demo/standards/secrets-management.json"} {
		if data, ok := readSource(v, p); !ok || len(data) == 0 {
			t.Errorf("%s: not read", p)
		}
	}
	for _, p := range []string{".env.example", ".gitignore", "server/go.sum", "catalog/icons"} {
		if _, ok := readSource(v, p); ok {
			t.Errorf("%s: read", p)
		}
	}
}
