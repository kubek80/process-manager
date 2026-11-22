package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"os"
	slashpath "path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// The source files of the portal, for Admin › Code map: GET /api/admin/source?path=… sends one
// file of the repository checkout named by PM_SOURCE_DIR, to admins only. What may be read is an
// allow-list (allowedSourcePath): text source files, nothing hidden, generated or secret.

// maxSourceBytes is the largest file that is sent.
const maxSourceBytes = 400 * 1024

// maxSourcePath is the longest path that is looked at.
const maxSourcePath = 512

// Every refusal is one answer, whatever the reason, so that nothing about the folder can be
// probed: a path that is not allowed, does not exist, or is not a regular text file.
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
// be read. It is checked twice: on the path as asked, and on the path after symbolic links are
// resolved, so that a link cannot lead to a file the list would refuse.
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
		if excludedFolders[seg] || secretLike(seg) {
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

// secretLike reports whether a file or folder is named like something that holds a secret.
func secretLike(name string) bool {
	n := strings.ToLower(name)
	return strings.HasPrefix(n, ".env") || strings.HasSuffix(n, ".pem") || strings.HasSuffix(n, ".key") ||
		strings.Contains(n, "secret") || strings.Contains(n, "credential")
}

// sourceRoot is the folder of the checkout with its symbolic links resolved, or "" when the
// portal shows no source (not set, or not a folder that can be read).
func (a *api) sourceRoot() string {
	if a.Cfg.SourceDir == "" {
		return ""
	}
	root, err := filepath.EvalSymlinks(a.Cfg.SourceDir)
	if err != nil {
		return ""
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		return ""
	}
	return root
}

// readSource reads the file at p below root, or reports false for every reason it may not.
func readSource(root, p string) ([]byte, bool) {
	if !allowedSourcePath(p) {
		return nil, false
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(p)))
	if err != nil {
		return nil, false
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil, false
	}
	// where the links lead must pass the same list
	if !allowedSourcePath(filepath.ToSlash(rel)) {
		return nil, false
	}
	f, err := os.Open(resolved)
	if err != nil {
		return nil, false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxSourceBytes {
		return nil, false
	}
	// the file opened is the one that was checked (not swapped for another in between)
	if checked, err := os.Lstat(resolved); err != nil || !os.SameFile(info, checked) {
		return nil, false
	}
	data, err := io.ReadAll(io.LimitReader(f, maxSourceBytes+1))
	if err != nil || len(data) > maxSourceBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return nil, false
	}
	return data, true
}

// source answers GET /api/admin/source?path=… (admins only; reading is not written to Activity).
func (a *api) source(w http.ResponseWriter, r *http.Request) {
	root := a.sourceRoot()
	if root == "" {
		writeError(w, 404, sourceOffMessage)
		return
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query["path"]) != 1 {
		writeError(w, 404, sourceRefusedMessage)
		return
	}
	p := query.Get("path")
	data, ok := readSource(root, p)
	if !ok {
		writeError(w, 404, sourceRefusedMessage)
		return
	}
	writeJSON(w, 200, map[string]any{"path": p, "text": string(data), "bytes": len(data)})
}
