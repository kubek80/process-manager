package main

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/icons"
)

func iconFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(icons.Folder(dir))
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

// The icons are imported before the lists, exported with them, and come back on a round trip.
func TestIconsGoInAndOutWithTheLists(t *testing.T) {
	st := newStores(t)
	sample := filepath.Join(repo, "..")
	var logged bytes.Buffer
	log := slog.New(slog.NewTextHandler(&logged, nil))
	if err := importFiles(ctx, st, sample, log); err != nil {
		t.Fatal(err)
	}
	cat, err := st.docs.Get(ctx, docs.Catalog, docs.CatalogID)
	if err != nil {
		t.Fatal(err)
	}
	if missing, err := st.iconStore().Missing(ctx, cat.Body); err != nil || len(missing) > 0 || strings.Contains(logged.String(), "level=WARN") {
		t.Fatalf("missing %v %v\n%s", missing, err, logged.String())
	}
	out := t.TempDir()
	// an icon file nobody names any more is removed from the export folder
	stale := filepath.Join(icons.Folder(out), strings.Repeat("f", 64)+".svg")
	os.MkdirAll(filepath.Dir(stale), 0o755)
	os.WriteFile(stale, []byte("old"), 0o644)
	if err := exportFiles(ctx, st, out, quiet); err != nil {
		t.Fatal(err)
	}
	if got, want := strings.Join(iconFiles(t, out), ","), strings.Join(iconFiles(t, sample), ","); got != want {
		t.Fatalf("exported %s, want %s", got, want)
	}
	fresh := newStores(t)
	if err := importFiles(ctx, fresh, out, quiet); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := fresh.docs.Pool.QueryRow(ctx, `select count(*) from icons`).Scan(&n); err != nil || n != len(iconFiles(t, sample)) {
		t.Fatalf("round trip: %d icons %v", n, err)
	}
}

// Lists whose icon files are missing are imported all the same, and say what is missing.
func TestListsAreImportedWithoutTheirIconFiles(t *testing.T) {
	st := newStores(t)
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "catalog", "icons"), 0o755)
	lists, _ := os.ReadFile(filepath.Join(repo, "..", "catalog", "catalog.json"))
	os.WriteFile(filepath.Join(dir, "catalog", "catalog.json"), lists, 0o644)
	os.WriteFile(filepath.Join(dir, "catalog", "icons", strings.Repeat("a", 64)+".svg"), []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`), 0o644)
	var logged bytes.Buffer
	if err := importFiles(ctx, st, dir, slog.New(slog.NewTextHandler(&logged, nil))); err != nil {
		t.Fatal(err)
	}
	if _, err := st.docs.Get(ctx, docs.Catalog, docs.CatalogID); err != nil {
		t.Fatal("the lists were not imported")
	}
	for _, want := range []string{"icon not imported", "the name does not match the content", "the lists name an icon that is not stored", "the tool “GitHub”", "the language “Go”"} {
		if !strings.Contains(logged.String(), want) {
			t.Errorf("no %q in\n%s", want, logged.String())
		}
	}
}

// A start fills an empty database with the icons too, and removes old icons nobody ever named.
func TestPrepareImportsAndCleansIcons(t *testing.T) {
	st := newStores(t)
	cfg := config.Config{Auth: config.AuthDev, SeedDir: filepath.Join(repo, "..")}
	if err := prepare(ctx, cfg, st, quiet); err != nil {
		t.Fatal(err)
	}
	unused, err := icons.Inspect(icons.SVG, []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"/>`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.iconStore().Put(ctx, unused, "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.docs.Pool.Exec(ctx, `update icons set created_at = now() - interval '3 days'`); err != nil {
		t.Fatal(err)
	}
	if err := prepare(ctx, cfg, st, quiet); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := st.docs.Pool.QueryRow(ctx, `select count(*) from icons`).Scan(&n); err != nil || n != len(iconFiles(t, cfg.SeedDir)) {
		t.Fatalf("icons after start: %d %v", n, err)
	}
	if _, err := st.iconStore().Get(ctx, unused.ID); err != icons.ErrNotFound {
		t.Fatalf("unused icon kept: %v", err)
	}
}
