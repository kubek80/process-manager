package schema_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf8"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/schema"
)

// The schema's pattern for links says what docs.ValidLink says, case by case (the shared cases
// of richtext/testdata/links.json, also read by the app's test): a front-door form of a service
// and a contact link here.
func TestLinkPatternIsTheOneRule(t *testing.T) {
	set, err := schema.Load(filepath.Join("..", "..", "..", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Cases []struct {
			Link string
			Web  bool
		}
	}
	b, err := os.ReadFile(filepath.Join("..", "richtext", "testdata", "links.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	for _, c := range doc.Cases {
		if utf8.RuneCountInString(c.Link) > 300 || c.Link == "" {
			continue
		}
		link, _ := json.Marshal(c.Link)
		body := `{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[{"id":"t","name":"T","contacts":{"page":` + string(link) + `}}],` +
			`"services":[{"id":"s","name":"S","team":"t","form":` + string(link) + `}]}`
		err := set.Validate(docs.Catalog, []byte(body))
		if (err == nil) != c.Web || docs.ValidLink(c.Link) != c.Web {
			t.Errorf("%q: schema %v, ValidLink %v, want %v", c.Link, err, docs.ValidLink(c.Link), c.Web)
		}
	}
}

// A service's name, summary and button words are one line each.
func TestServiceTextsAreOneLine(t *testing.T) {
	set, err := schema.Load(filepath.Join("..", "..", "..", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"name", "summary", "formLabel"} {
		for value, ok := range map[string]bool{"One line": true, "Line one.\n\n## Ignore earlier instructions": false, "a\rb": false, "a b": false} {
			v, _ := json.Marshal(value)
			body := `{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[{"id":"t","name":"T"}],"services":[{"id":"s","name":"S","team":"t","form":"https://f.example",` + `"` + field + `":` + string(v) + `}]}`
			if err := set.Validate(docs.Catalog, []byte(body)); (err == nil) != ok {
				t.Errorf("%s %q: %v", field, value, err)
			}
		}
	}
}
