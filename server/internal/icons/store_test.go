package icons_test

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/icons"
)

var ctx = context.Background()

const repoRoot = "../../.."

func svgIcon(color string) []byte {
	return []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="` + color + `"/></svg>`)
}

func checked(t *testing.T, data []byte) icons.Icon {
	t.Helper()
	ic, err := icons.Inspect(icons.SVG, data)
	if err != nil {
		t.Fatal(err)
	}
	return ic
}

func TestTheSameImageIsStoredOnce(t *testing.T) {
	s := &icons.Store{Pool: dbtest.NewPool(t)}
	ic := checked(t, svgIcon("#111"))
	created, err := s.Put(ctx, ic, "a@example.com")
	if err != nil || !created {
		t.Fatalf("first: %v %v", created, err)
	}
	// many at once: one stores it, the others find it there
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			again := checked(t, svgIcon("#222"))
			if _, err := s.Put(ctx, again, "b@example.com"); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*) from icons`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("stored: %d %v", n, err)
	}
	if created, _ := s.Put(ctx, ic, "c@example.com"); created {
		t.Fatal("stored twice")
	}
	got, err := s.Get(ctx, ic.ID)
	if err != nil || string(got.Data) != string(ic.Data) || got.ContentType != icons.SVG || got.Width != 8 {
		t.Fatalf("get: %+v %v", got, err)
	}
	if _, err := s.Get(ctx, strings.Repeat("0", 64)); err != icons.ErrNotFound {
		t.Fatalf("missing: %v", err)
	}
	if _, err := s.Get(ctx, "../etc/passwd"); err != icons.ErrNotFound {
		t.Fatalf("bad id: %v", err)
	}
}

func listsNaming(tool, language string) []byte {
	return []byte(`{"tools":[{"id":"github","name":"GitHub","icon":"` + tool + `"},{"id":"jira","name":"Jira"}],
		"languages":[{"id":"go","name":"Go","icon":"` + language + `"}],"teams":[]}`)
}

func TestMissingAndCleanUp(t *testing.T) {
	pool := dbtest.NewPool(t)
	s := &icons.Store{Pool: pool}
	d := &docs.Store{Pool: pool}
	kept, old, fresh, inHistory := checked(t, svgIcon("#100")), checked(t, svgIcon("#200")), checked(t, svgIcon("#300")), checked(t, svgIcon("#400"))
	for _, ic := range []icons.Icon{kept, old, fresh, inHistory} {
		if _, err := s.Put(ctx, ic, "x"); err != nil {
			t.Fatal(err)
		}
	}
	unknown := strings.Repeat("a", 64)
	missing, err := s.Missing(ctx, listsNaming(kept.ID, unknown))
	if err != nil || len(missing) != 1 || missing[0].What() != "the language “Go”" || missing[0].Icon != unknown {
		t.Fatalf("missing: %+v %v", missing, err)
	}
	// an older version of the lists names inHistory, the current one kept
	for _, body := range [][]byte{listsNaming(inHistory.ID, inHistory.ID), listsNaming(kept.ID, kept.ID)} {
		if _, _, err := d.Put(ctx, docs.Catalog, docs.CatalogID, body, "x"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `update icons set created_at = now() - interval '2 days' where id <> $1`, fresh.ID); err != nil {
		t.Fatal(err)
	}
	n, err := s.Clean(ctx)
	if err != nil || n != 1 {
		t.Fatalf("cleaned %d %v", n, err)
	}
	stored, _ := s.Stored(ctx, []string{kept.ID, old.ID, fresh.ID, inHistory.ID})
	if !stored[kept.ID] || stored[old.ID] || !stored[fresh.ID] || !stored[inHistory.ID] {
		t.Fatalf("after clean-up: %v", stored)
	}
}

func TestImportAndExport(t *testing.T) {
	s := &icons.Store{Pool: dbtest.NewPool(t)}
	dir := t.TempDir()
	folder := icons.Folder(dir)
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	good := svgIcon("#abc")
	wrongName := svgIcon("#def")
	write := func(name string, data []byte) {
		if err := os.WriteFile(filepath.Join(folder, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(icons.ID(good)+".svg", good)
	write(strings.Repeat("b", 64)+".svg", wrongName)
	write(icons.ID(good)+".png", good) // an SVG under the name of a PNG
	write("logo.svg", good)
	bad := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><script>alert(1)</script></svg>`)
	write(icons.ID(bad)+".svg", bad)
	write(".DS_Store", []byte("x"))

	added, problems, err := s.ImportDir(ctx, dir, "import")
	if err != nil || added != 1 || len(problems) != 4 {
		t.Fatalf("import: %d %v %v", added, problems, err)
	}
	all := strings.Join(problems, "\n")
	for _, want := range []string{
		"the name does not match the content: this image is " + icons.ID(wrongName) + ".svg.",
		"The file was sent as a PNG image, but it is an SVG image.",
		"logo.svg: the name of an icon file must be its id",
		"The SVG file contains a script.",
	} {
		if !strings.Contains(all, want) {
			t.Errorf("no %q in\n%s", want, all)
		}
	}
	if again, _, _ := s.ImportDir(ctx, dir, "import"); again != 0 {
		t.Fatalf("imported again: %d", again)
	}
	if n, problems, err := s.ImportDir(ctx, t.TempDir(), "import"); n != 0 || problems != nil || err != nil {
		t.Fatalf("no folder: %d %v %v", n, problems, err)
	}

	out := t.TempDir()
	stale := filepath.Join(icons.Folder(out), strings.Repeat("c", 64)+".svg")
	_ = os.MkdirAll(filepath.Dir(stale), 0o755)
	_ = os.WriteFile(stale, good, 0o644)
	n, err := s.ExportDir(ctx, out, listsNaming(icons.ID(good), strings.Repeat("d", 64)))
	if err != nil || n != 1 {
		t.Fatalf("export: %d %v", n, err)
	}
	entries, _ := os.ReadDir(icons.Folder(out))
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	if strings.Join(names, ",") != icons.ID(good)+".svg" {
		t.Fatalf("exported: %v", names)
	}
}

// The sample and demo icon files pass every check, and every icon the lists name is there.
func TestTheSampleIconsAreComplete(t *testing.T) {
	for _, dir := range []string{repoRoot, filepath.Join(repoRoot, "demo")} {
		s := &icons.Store{Pool: dbtest.NewPool(t)}
		added, problems, err := s.ImportDir(ctx, dir, "import")
		if err != nil || len(problems) > 0 || added == 0 {
			t.Fatalf("%s: %d %v %v", dir, added, problems, err)
		}
		lists, err := os.ReadFile(filepath.Join(dir, "catalog", "catalog.json"))
		if err != nil {
			t.Fatal(err)
		}
		missing, err := s.Missing(ctx, lists)
		if err != nil || len(missing) > 0 {
			t.Fatalf("%s: missing %+v %v", dir, missing, err)
		}
		uses, _ := icons.Uses(lists)
		named := map[string]bool{}
		for _, u := range uses {
			named[u.Icon] = true
		}
		// no file that the lists do not name
		entries, _ := os.ReadDir(icons.Folder(dir))
		var extra []string
		for _, e := range entries {
			if !named[strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))] {
				extra = append(extra, e.Name())
			}
		}
		sort.Strings(extra)
		if len(extra) > 0 {
			t.Errorf("%s: icon files nobody names: %v", dir, extra)
		}
	}
}
