package httpapi

import (
	"bytes"
	"context"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	slashpath "path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

// The source files of the portal, for Admin › Code map: GET /api/admin/source?path=… sends one
// file of the repository checkout named by PM_SOURCE_DIR, to admins only. Only a file that git
// tracks in that checkout can be read, and only when its name passes allowedSourcePath (text
// source files, nothing hidden, generated or named like a key).

// maxSourceBytes is the largest file that is sent.
const maxSourceBytes = 400 * 1024

// maxSourcePath is the longest path that is looked at.
const maxSourcePath = 512

// sourceReadsPerMinute is how many files one person may open in a minute: far more than anybody
// reading code, a brake on a script.
const sourceReadsPerMinute = 300

// gitTimeout bounds one listing of the tracked files.
const gitTimeout = 10 * time.Second

// Every refusal is one answer, whatever the reason, so that nothing about the folder can be
// probed: a path that is not allowed, not tracked, does not exist, or is not a regular text file.
const (
	sourceOffMessage     = "This installation does not show its source code."
	sourceRefusedMessage = "That file cannot be shown."
)

// sourceExtensions are the endings of the files that may be read; "Dockerfile" is the one name
// without an ending.
var sourceExtensions = map[string]bool{
	".go": true, ".ts": true, ".tsx": true, ".js": true, ".mjs": true, ".cjs": true, ".css": true, ".sql": true,
	".json": true, ".md": true, ".yml": true, ".yaml": true, ".html": true, ".sh": true, ".mod": true,
}

// excludedFolders are never read from, at any depth: installed packages, build output and test
// output.
var excludedFolders = map[string]bool{
	"node_modules": true, "dist": true, "test-results": true, "playwright-report": true, "coverage": true,
}

// allowedSourcePath reports whether p, a path from the repository root with forward slashes, may
// be read if git tracks it. It is checked twice: on the path as asked, and on the path after
// symbolic links are resolved, so that a link cannot lead to a file the list would refuse.
func allowedSourcePath(p string) bool {
	if p == "" || len(p) > maxSourcePath || !utf8.ValidString(p) {
		return false
	}
	// letters, digits and . _ - / only: no backslash, colon, percent sign, space, NUL or other
	// control character can reach the file system
	for _, r := range p {
		ok := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '-' || r == '/'
		if !ok {
			return false
		}
	}
	// a cleaned relative path: no leading or trailing slash, no "//", no "." or ".." segment
	if slashpath.IsAbs(p) || slashpath.Clean(p) != p {
		return false
	}
	segments := strings.Split(p, "/")
	for i, seg := range segments {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
		// hidden files and folders, with one exception: the files of .github/workflows/
		if strings.HasPrefix(seg, ".") {
			workflow := i == 0 && seg == ".github" && len(segments) == 3 && segments[1] == "workflows"
			if !workflow {
				return false
			}
		}
		if excludedFolders[seg] || keyLike(seg) {
			return false
		}
	}
	name := segments[len(segments)-1]
	if name == "Dockerfile" {
		return true
	}
	ext := slashpath.Ext(name)
	return ext != name && sourceExtensions[ext]
}

// keyLike reports whether a file or folder is named like a key or a file of secret settings.
// Whether a file may be read at all is decided by git tracking it; this is a second check.
func keyLike(name string) bool {
	n := strings.ToLower(name)
	return strings.HasPrefix(n, ".env") || strings.HasSuffix(n, ".pem") || strings.HasSuffix(n, ".key")
}

// ---------- the checkout and the files git tracks in it

// sourceTree is the checkout named by PM_SOURCE_DIR and the set of files git tracks in it. The
// set is listed with `git ls-files` and listed again only when git's index changes.
type sourceTree struct {
	dir string // PM_SOURCE_DIR as set; "" when the portal shows no source

	mu      sync.Mutex
	known   bool       // something was listed (or failed) for stamp
	stamp   indexStamp // the index the cached answer belongs to
	index   string     // git's index file of root, once known
	tracked map[string]bool
	problem string // why no source can be shown; "" when it can
}

// indexStamp identifies a state of the checkout: its folder and its index file as they are.
type indexStamp struct {
	root, index string
	mod         time.Time
	size        int64
	exists      bool
}

// sourceView is what one request works with.
type sourceView struct {
	root    string
	tracked map[string]bool
}

// current returns the checkout and its tracked files, or "" as root and why not.
func (t *sourceTree) current(ctx context.Context) (sourceView, string) {
	if t == nil || t.dir == "" {
		return sourceView{}, "PM_SOURCE_DIR is not set"
	}
	root, err := filepath.EvalSymlinks(t.dir)
	if err != nil {
		return sourceView{}, "the folder " + t.dir + " (PM_SOURCE_DIR) cannot be found"
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return sourceView{}, "PM_SOURCE_DIR=" + t.dir + " is not a folder"
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	index := t.index
	if index == "" || t.stamp.root != root {
		index = gitIndexFile(root)
	}
	stamp := indexStamp{root: root, index: index}
	if info, err := os.Stat(index); err == nil {
		stamp.mod, stamp.size, stamp.exists = info.ModTime(), info.Size(), true
	}
	if !t.known || t.stamp != stamp {
		// stamped before listing: a change made while git runs is listed by the next request
		t.tracked, t.problem = listFiles(ctx, root)
		t.known, t.stamp, t.index = true, stamp, index
	}
	if t.problem != "" {
		return sourceView{}, t.problem
	}
	return sourceView{root: root, tracked: t.tracked}, ""
}

// gitIndexFile is the index file of the checkout at root: .git/index, or the index of the folder
// that a .git file names (a worktree). "" when there is neither.
func gitIndexFile(root string) string {
	dotgit := filepath.Join(root, ".git")
	info, err := os.Lstat(dotgit)
	if err != nil {
		return ""
	}
	if info.IsDir() {
		return filepath.Join(dotgit, "index")
	}
	if !info.Mode().IsRegular() || info.Size() > 4096 {
		return ""
	}
	data, err := os.ReadFile(dotgit)
	if err != nil {
		return ""
	}
	dir, ok := strings.CutPrefix(strings.TrimSpace(string(data)), "gitdir: ")
	if !ok || dir == "" {
		return ""
	}
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(root, dir)
	}
	return filepath.Join(dir, "index")
}

// gitArgs and gitEnv are how git is run: no shell, fixed arguments, and an environment of its
// own so that no configuration outside the checkout applies and nothing in the checkout's
// configuration runs a program. ls-files reads the index only: it runs no hooks, filters, pager,
// credential helper or network command; core.fsmonitor, the one setting that would make it run
// a program, is switched off on the command line, which wins over the checkout's own config.
var gitArgs = []string{"-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--no-pager", "--no-optional-locks", "--literal-pathspecs", "ls-files", "-z", "--cached"}

func gitEnv(root string) []string {
	env := []string{
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_CONFIG_SYSTEM=" + os.DevNull,
		"GIT_CONFIG_GLOBAL=" + os.DevNull,
		"GIT_TERMINAL_PROMPT=0",
		"GIT_OPTIONAL_LOCKS=0",
		"GIT_NO_REPLACE_OBJECTS=1",
		// the checkout itself and nothing above it: a folder inside another checkout is no checkout
		"GIT_CEILING_DIRECTORIES=" + filepath.Dir(root),
		"HOME=" + os.DevNull,
		"LC_ALL=C",
	}
	// what git needs to start at all on Windows
	for _, k := range []string{"PATH", "SYSTEMROOT"} {
		if v := os.Getenv(k); v != "" {
			env = append(env, k+"="+v)
		}
	}
	return env
}

// listFiles lists the tracked files; tests count its calls.
var listFiles = listTracked

// listTracked runs `git ls-files` in root and returns the tracked paths, or why it could not.
func listTracked(ctx context.Context, root string) (map[string]bool, string) {
	git, err := exec.LookPath("git")
	if err != nil {
		return nil, "git is not installed, and only files that git tracks in " + root + " (PM_SOURCE_DIR) are shown"
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, git, gitArgs...)
	cmd.Dir = root
	cmd.Env = gitEnv(root)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		why := strings.TrimSpace(strings.SplitN(stderr.String(), "\n", 2)[0])
		if why == "" {
			why = err.Error()
		}
		return nil, root + " (PM_SOURCE_DIR) is not a git checkout whose files can be listed (" + why + ")"
	}
	tracked := map[string]bool{}
	for _, p := range bytes.Split(out, []byte{0}) {
		if len(p) > 0 {
			tracked[string(p)] = true
		}
	}
	return tracked, ""
}

// SourceProblem says why Admin › Code map cannot show source code although PM_SOURCE_DIR is set,
// or "" when it can (or the setting is empty). Said once at start.
func SourceProblem(dir string) string {
	if dir == "" {
		return ""
	}
	t := &sourceTree{dir: dir}
	if _, problem := t.current(context.Background()); problem != "" {
		return "Admin › Code map shows no source code: " + problem
	}
	return ""
}

// ---------- reading one file

// readSource reads the file at p of the checkout, or reports false for every reason it may not.
func readSource(v sourceView, p string) ([]byte, bool) {
	if v.root == "" || !allowedSourcePath(p) || !v.tracked[p] {
		return nil, false
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(v.root, filepath.FromSlash(p)))
	if err != nil {
		return nil, false
	}
	rel, err := filepath.Rel(v.root, resolved)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil, false
	}
	// where the links lead must pass the same checks
	if relSlash := filepath.ToSlash(rel); !allowedSourcePath(relSlash) || !v.tracked[relSlash] {
		return nil, false
	}
	// Opened through the checkout as a root: nothing outside it can be reached, also when a
	// folder on the way is swapped for a link after the checks above. Without blocking: a FIFO
	// opens at once and is refused below instead of holding the request for ever.
	dir, err := os.OpenRoot(v.root)
	if err != nil {
		return nil, false
	}
	defer dir.Close()
	f, err := dir.OpenFile(rel, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxSourceBytes {
		return nil, false
	}
	// the file opened is the one that was checked: not a link put in its place in between
	if checked, err := dir.Lstat(rel); err != nil || !os.SameFile(info, checked) {
		return nil, false
	}
	data, err := io.ReadAll(io.LimitReader(f, maxSourceBytes+1))
	if err != nil || len(data) > maxSourceBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return nil, false
	}
	return data, true
}

// sourceShown reports whether this installation can show its source (for /api/admin/system).
func (a *api) sourceShown(ctx context.Context) bool {
	v, _ := a.sourceFiles.current(ctx)
	return v.root != ""
}

// source answers GET /api/admin/source?path=… (admins only; reading is not written to Activity).
func (a *api) source(w http.ResponseWriter, r *http.Request) {
	email := who(r).countsFor() // the admin who reads, also while viewing as somebody else
	if !a.sourceReads.allow(email, time.Now()) {
		secs := int(math.Ceil(a.sourceReads.wait(email, time.Now()).Seconds()))
		w.Header().Set("Retry-After", strconv.Itoa(max(secs, 1)))
		writeError(w, 429, "You have opened a great many files in the last minute. Wait a moment, then try again.")
		return
	}
	v, _ := a.sourceFiles.current(r.Context())
	if v.root == "" {
		writeError(w, 404, sourceOffMessage)
		return
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query["path"]) != 1 {
		writeError(w, 404, sourceRefusedMessage)
		return
	}
	p := query.Get("path")
	data, ok := readSource(v, p)
	if !ok {
		writeError(w, 404, sourceRefusedMessage)
		return
	}
	writeJSON(w, 200, map[string]any{"path": p, "text": string(data), "bytes": len(data)})
}
