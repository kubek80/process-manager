package schema_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/schema"
)

// The schemas and the sample content live at the root of the repository.
const repo = "../../.."

func load(t *testing.T) *schema.Set {
	t.Helper()
	set, err := schema.Load(filepath.Join(repo, "schema"))
	if err != nil {
		t.Fatal(err)
	}
	return set
}

func TestEverySampleFileIsValid(t *testing.T) {
	set := load(t)
	check := func(kind, pattern string) {
		files, _ := filepath.Glob(filepath.Join(repo, pattern))
		if len(files) == 0 {
			t.Fatalf("no files match %s", pattern)
		}
		for _, f := range files {
			data, _ := os.ReadFile(f)
			if err := set.Validate(kind, data); err != nil {
				t.Errorf("%s: %v", f, err)
			}
		}
	}
	check(docs.Process, "processes/*.json")
	check(docs.Standard, "standards/*.json")
	check(docs.Catalog, "catalog/catalog.json")
}

func TestRejectsWrongShapes(t *testing.T) {
	set := load(t)
	cases := []struct{ kind, body, want string }{
		{docs.Process, `{"id":"x"}`, "does not match the format"},
		{docs.Process, `{nope`, "not valid JSON"},
		{docs.Standard, `{"schemaVersion":"1.0","id":"s","title":"Standard","summary":"Long enough summary.","owner":"security","requirements":[]}`, "/requirements"},
		{docs.Standard, `{"schemaVersion":"1.0","id":"s","title":"Standard","summary":"Long enough summary.","owner":"security","requirements":[{"id":"lower-case","title":"Rule","level":"must","statement":"A rule that is long enough.","verification":{"method":"review"}}]}`, "/requirements/0/id"},
		{docs.Standard, `{"schemaVersion":"1.0","id":"s","title":"Standard","summary":"Long enough summary.","owner":"security","requirements":[{"id":"SEC-01","title":"Rule","level":"always","statement":"A rule that is long enough.","verification":{"method":"review"}}]}`, "/requirements/0/level"},
		{docs.Catalog, `{"tiers":[],"languages":[],"teams":[],"tools":[]}`, "does not match the format"},
		{docs.Catalog, `{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[{"id":"a","name":"A","kind":"platform"}]}`, "additional properties 'kind' not allowed"}, // teams have no kind any more
		{docs.Catalog, `{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[],"platforms":[{"id":"Google Cloud","name":"Google Cloud"}]}`, "/platforms/0/id"},
		{"skill", `{}`, "unknown kind"},
	}
	for _, c := range cases {
		err := set.Validate(c.kind, []byte(c.body))
		if !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s %.40s…: want %q, got %v", c.kind, c.body, c.want, err)
		}
	}
	// many problems are summarised, not dumped
	err := set.Validate(docs.Process, []byte(`{}`))
	if err == nil || len(err.Error()) > 600 {
		t.Fatalf("summary too long or missing: %v", err)
	}
}

func TestLoadFailsWithoutSchemas(t *testing.T) {
	if _, err := schema.Load(t.TempDir()); err == nil {
		t.Fatal("expected an error for a folder without schemas")
	}
	dir := t.TempDir()
	for _, name := range []string{"process.schema.json", "standard.schema.json", "catalog.schema.json"} {
		os.WriteFile(filepath.Join(dir, name), []byte("{broken"), 0o644)
	}
	if _, err := schema.Load(dir); err == nil {
		t.Fatal("expected an error for broken schemas")
	}
}
