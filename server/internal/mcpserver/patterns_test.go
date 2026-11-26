package mcpserver

import (
	"reflect"
	"strings"
	"testing"
)

// Every answer names the architecture patterns a document is tagged with, by id and name with what
// else each is called; get_catalog lists them. There is no parameter for them: the path means
// "applies to" and a pattern is only a tag, so agents find patterns by words or by meaning.
func TestAnswersNameThePatterns(t *testing.T) {
	l := sampleLists(t)
	got := patternRefs(l.Patterns, []string{"event-driven", "gone"})
	want := []PatternRef{
		{ID: "event-driven", Name: "Event-driven", AlsoCalled: []string{"event-based", "EDA"}, Description: l.Patterns[2].Description},
		{ID: "gone", Name: "gone"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
	if none := patternRefs(l.Patterns, nil); none == nil || len(none) != 0 {
		t.Fatalf("no patterns must be an empty list, not null: %#v", none)
	}
	if !strings.HasSuffix(catalogText(Catalog{Patterns: patternRefs(l.Patterns, idsOf(l.Patterns))}), ", 6 architecture patterns.") {
		t.Fatal("catalog text")
	}
	// found by words through their names and other names, only where they are tagged
	apigee, servicenow := sample(t, "process", "onboard-api-to-apigee"), sample(t, "process", "raise-servicenow-request")
	score := func(e *entry, q string) int { return wordScore(fieldsOf(e, l), partsOf(e, l), wordsOf(q)) }
	if score(apigee, "contract-first") == 0 || score(servicenow, "contract-first") != 0 {
		t.Fatal("patterns are not found by their words")
	}
	// the search takes no pattern
	if _, ok := reflect.TypeOf(SearchInput{}).FieldByName("Pattern"); ok {
		t.Fatal("a pattern parameter")
	}
}

// Through the tools: the patterns in a search result, a process and the catalog.
func TestSearchAndReadPatterns(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var out SearchOutput
	mustCall(t, cs, "search_processes", map[string]any{"query": "contract-first"}, &out)
	if out.Total != 1 || out.Results[0].ID != "onboard-api-to-apigee" || len(out.Results[0].Patterns) != 1 || out.Results[0].Patterns[0].Name != "API-first" {
		t.Fatalf("%+v", out)
	}
	var p Process
	mustCall(t, cs, "get_process", map[string]any{"id": "onboard-site-to-akamai"}, &p)
	if len(p.Patterns) != 1 || p.Patterns[0].ID != "static-site-cdn" || p.Patterns[0].AlsoCalled[0] != "JAMstack" {
		t.Fatalf("%+v", p.Patterns)
	}
	mustCall(t, cs, "get_process", map[string]any{"id": "request-gcp-project"}, &p)
	if p.Patterns == nil || len(p.Patterns) != 0 {
		t.Fatalf("untagged: %#v", p.Patterns)
	}
	var cat Catalog
	mustCall(t, cs, "get_catalog", nil, &cat)
	if len(cat.Patterns) != 6 || cat.Patterns[0].ID != "api-first" {
		t.Fatalf("%+v", cat.Patterns)
	}
}
