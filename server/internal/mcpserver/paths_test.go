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
	gcp := sample(t, docs.Process, "request-gcp-project")        // paved path
	repo := sample(t, docs.Process, "request-github-repository") // greenfield, paved path
	servicenow := sample(t, docs.Process, "raise-servicenow-request")
	for _, c := range []struct {
		path string
		want []bool // gcp, repo, servicenow
		id   string
	}{
		{"", []bool{true, true, true}, ""},
		{"greenfield", []bool{false, true, true}, "greenfield"},
		{"Brownfield", []bool{false, false, true}, "brownfield"},
		{"paved path", []bool{true, true, true}, "paved-path"},
		{"Golden Path", []bool{true, true, true}, "paved-path"},
		{"green field", []bool{false, true, true}, "greenfield"},
	} {
		f, err := resolveFilters(l, SearchInput{Path: c.path})
		if err != nil {
			t.Fatalf("%q: %v", c.path, err)
		}
		if f.profile.Path != c.id || (c.id != "" && f.shown()["path"] != c.id) {
			t.Errorf("%q resolved to %q", c.path, f.profile.Path)
		}
		var got []bool
		for _, e := range []*entry{gcp, repo, servicenow} {
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
	// the other names belong to the entry, not to its picture: another path with the road is not the golden path
	l.Paths = append(l.Paths, docs.Named{ID: "toll-road", Name: "Toll road", Symbol: "road"})
	if f, _ := resolveFilters(l, SearchInput{Path: "golden path"}); f.profile.Path != "paved-path" {
		t.Fatalf("golden path: %q", f.profile.Path)
	}
	if _, err := resolveFilters(l, SearchInput{Path: "paved road"}); err != nil {
		t.Fatal(err)
	}
	l.Paths[2].AlsoCalled = nil
	if _, err := resolveFilters(l, SearchInput{Path: "golden path"}); err == nil {
		t.Fatal("found by an other name the entry no longer has")
	}
	l = sampleLists(t)
	// "golden path" is found by words in what is on the paved path, and only there
	score := func(e *entry, q string) int { return wordScore(fieldsOf(e, l), partsOf(e, l), wordsOf(q)) }
	if score(gcp, "golden path") == 0 || score(servicenow, "golden path") != 0 || score(repo, "greenfield") == 0 {
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
	// what is not tied to a path applies to every path: all active processes
	mustCall(t, cs, "search_processes", map[string]any{"path": "golden path"}, &out)
	if out.Filters["path"] != "paved-path" || out.Total != 7 {
		t.Fatalf("%+v", out)
	}
	// greenfield: what is made for the paved path only is left out
	mustCall(t, cs, "search_processes", map[string]any{"path": "greenfield"}, &out)
	for _, r := range out.Results {
		if r.ID == "request-gcp-project" || r.ID == "request-azure-landing-zone" || r.ID == "onboard-api-to-apigee" {
			t.Fatalf("%s is for the paved path only", r.ID)
		}
	}
	if out.Total != 4 {
		t.Fatalf("greenfield: %d", out.Total)
	}
	for _, r := range out.Results {
		if r.ID == "request-github-repository" && (len(r.Paths) != 2 || r.Paths[1].Name != "Paved path" || r.Paths[1].AlsoCalled[0] != "golden path") {
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
