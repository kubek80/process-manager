package mcpserver

import (
	"reflect"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// A path narrows the search as the portal's "My application" does: what names no path is for
// any path; what names paths is found only for one of them. "golden path" is the paved path.
func TestThePathFilter(t *testing.T) {
	l := sampleLists(t)
	gcp := sample(t, docs.Process, "request-gcp-project")       // greenfield, paved path
	akamai := sample(t, docs.Process, "onboard-site-to-akamai") // brownfield
	servicenow := sample(t, docs.Process, "raise-servicenow-request")
	for _, c := range []struct {
		path string
		want []bool // gcp, akamai, servicenow
		id   string
	}{
		{"", []bool{true, true, true}, ""},
		{"greenfield", []bool{true, false, true}, "greenfield"},
		{"Brownfield", []bool{false, true, true}, "brownfield"},
		{"paved path", []bool{true, false, true}, "paved-path"},
		{"Golden Path", []bool{true, false, true}, "paved-path"},
	} {
		f, err := resolveFilters(l, SearchInput{Path: c.path})
		if err != nil {
			t.Fatalf("%q: %v", c.path, err)
		}
		if f.profile.Path != c.id || (c.id != "" && f.shown()["path"] != c.id) {
			t.Errorf("%q resolved to %q", c.path, f.profile.Path)
		}
		var got []bool
		for _, e := range []*entry{gcp, akamai, servicenow} {
			ok, _ := f.passes(e)
			got = append(got, ok)
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: got %v, want %v", c.path, got, c.want)
		}
	}
	if _, err := resolveFilters(l, SearchInput{Path: "dirt road"}); err == nil || !strings.Contains(err.Error(), "There is no path “dirt road”. Use get_catalog to see the paths.") {
		t.Fatalf("unknown path: %v", err)
	}
	// "golden path" is found by words in what is on the paved path, and only there
	score := func(e *entry, q string) int { return wordScore(fieldsOf(e, l), partsOf(e, l), wordsOf(q)) }
	if score(gcp, "golden path") == 0 || score(akamai, "golden path") != 0 || score(akamai, "brownfield") == 0 {
		t.Fatal("paths are not found by their words")
	}
}

// Every answer says which paths a document is for, by id and name with what else it is called;
// get_catalog lists them.
func TestAnswersSayThePaths(t *testing.T) {
	l := sampleLists(t)
	got := pathRefs(l.Paths, []string{"paved-path", "gone"})
	want := []PathRef{
		{ID: "paved-path", Name: "Paved path", AlsoCalled: []string{"golden path", "paved road"}, Description: l.Paths[2].Description},
		{ID: "gone", Name: "gone"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
	if none := pathRefs(l.Paths, nil); none == nil || len(none) != 0 {
		t.Fatalf("no paths must be an empty list, not null: %#v", none)
	}
	if !strings.Contains(catalogText(Catalog{Paths: pathRefs(l.Paths, idsOf(l.Paths))}), "3 paths") {
		t.Fatal("catalog text")
	}
}

// Through the tools: search by path (also by "golden path"), and the paths in the answers.
func TestSearchAndReadByPath(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var out SearchOutput
	mustCall(t, cs, "search_processes", map[string]any{"path": "golden path"}, &out)
	if out.Filters["path"] != "paved-path" || out.Total == 0 {
		t.Fatalf("%+v", out)
	}
	for _, r := range out.Results {
		if r.ID == "onboard-site-to-akamai" || r.ID == "request-azure-landing-zone" {
			t.Fatalf("%s is for another path only", r.ID)
		}
		if r.ID == "request-gcp-project" && (len(r.Paths) != 2 || r.Paths[1].Name != "Paved path" || r.Paths[1].AlsoCalled[0] != "golden path") {
			t.Fatalf("paths: %+v", r.Paths)
		}
	}
	mustCall(t, cs, "search_processes", map[string]any{"query": "golden path"}, &out)
	if out.Total == 0 {
		t.Fatalf("not found by the other name of the paved path: %+v", out)
	}
	for _, r := range out.Results {
		if len(r.Paths) == 0 || r.Paths[len(r.Paths)-1].ID != "paved-path" && r.Paths[0].ID != "paved-path" {
			t.Fatalf("%s is not on the paved path: %+v", r.ID, r.Paths)
		}
	}
	var cat Catalog
	mustCall(t, cs, "get_catalog", nil, &cat)
	if len(cat.Paths) != 3 || cat.Paths[0].ID != "greenfield" {
		t.Fatalf("%+v", cat.Paths)
	}
}
