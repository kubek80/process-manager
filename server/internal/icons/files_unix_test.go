//go:build unix

package icons_test

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/icons"
)

// Import reads only ordinary files: a pipe would make it wait for ever, a link could read any
// file of the machine. Export never writes through a link.
func TestImportAndExportOnlyTouchOrdinaryFiles(t *testing.T) {
	s := &icons.Store{Pool: dbtest.NewPool(t)}
	dir := t.TempDir()
	folder := icons.Folder(dir)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	good := svgIcon("#0a0")
	outside := filepath.Join(t.TempDir(), "secret.svg")
	if err := os.WriteFile(outside, good, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(filepath.Join(folder, strings.Repeat("1", 64)+".svg"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(folder, icons.ID(good)+".svg")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(folder, strings.Repeat("2", 64)+".svg"), 0o755); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	var added int
	var problems []string
	var err error
	go func() {
		defer close(done)
		added, problems, err = s.ImportDir(ctx, dir, "import")
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the import waits on a pipe")
	}
	if err != nil || added != 0 || len(problems) != 3 {
		t.Fatalf("import: %d %v %v", added, problems, err)
	}
	for _, p := range problems {
		if !strings.HasSuffix(p, "only ordinary files are imported, not links, folders or other special files.") {
			t.Errorf("problem: %s", p)
		}
	}

	// a folder that is a link is not imported from
	linked := t.TempDir()
	if err := os.MkdirAll(filepath.Join(linked, "catalog"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(folder, icons.Folder(linked)); err != nil {
		t.Fatal(err)
	}
	if n, problems, err := s.ImportDir(ctx, linked, "import"); n != 0 || len(problems) != 1 || err != nil || !strings.Contains(problems[0], "must be a folder, not a link") {
		t.Fatalf("linked folder: %d %v %v", n, problems, err)
	}

	// export: a link where an icon file goes is replaced, the file it pointed to is untouched
	ic, err := icons.Inspect(icons.SVG, good)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(ctx, ic, "x"); err != nil {
		t.Fatal(err)
	}
	out := t.TempDir()
	target := filepath.Join(t.TempDir(), "victim.txt")
	if err := os.WriteFile(target, []byte("keep me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(icons.Folder(out), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(icons.Folder(out), ic.ID+".svg")
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	lists := []byte(`{"tools":[{"id":"t","name":"T","icon":"` + ic.ID + `"}]}`)
	if n, err := s.ExportDir(ctx, out, lists); err != nil || n != 1 {
		t.Fatalf("export: %d %v", n, err)
	}
	if data, _ := os.ReadFile(target); string(data) != "keep me" {
		t.Fatal("the export wrote through a link")
	}
	if info, err := os.Lstat(path); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("exported file: %v %v", info, err)
	}
	// an icons folder that is a link is refused
	out2 := t.TempDir()
	if err := os.MkdirAll(filepath.Join(out2, "catalog"), 0o755); err != nil {
		t.Fatal(err)
	}
	elsewhere := t.TempDir()
	if err := os.Symlink(elsewhere, icons.Folder(out2)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ExportDir(ctx, out2, lists); err == nil || !strings.Contains(err.Error(), "not written through it") {
		t.Fatalf("linked folder: %v", err)
	}
	if entries, _ := os.ReadDir(elsewhere); len(entries) != 0 {
		t.Fatal("written through a linked folder")
	}
}
