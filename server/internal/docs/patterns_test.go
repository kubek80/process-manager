package docs_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// the lists with three architecture patterns
const withPatterns = `{"tiers":[{"id":"tier-0","name":"Tier 0"}],"patterns":[{"id":"api-first","name":"API-first"},{"id":"event-driven","name":"Event-driven","alsoCalled":["EDA"]},{"id":"microservices","name":"Microservices"}],
"environments":[],"languages":[],"teams":[{"id":"network-team","name":"Network"},{"id":"security","name":"Security"}],"tools":[]}`

// An architecture pattern a process or standard is tagged with must be in the list, like a path;
// lists without the key have none, so none can be named.
func TestPatternsMustBeInTheLists(t *testing.T) {
	l := listsOf(t, withPatterns)
	if len(l.Patterns) != 3 || l.Patterns[1].AlsoCalled[0] != "EDA" || len(l.ByKey("patterns")) != 3 {
		t.Fatalf("patterns: %+v", l.Patterns)
	}
	process := strings.Replace(vpn, `"steps":`, `"actors":[{"id":"me","name":"You"}],"steps":`, 1)
	on := func(body, field, value string) []byte {
		return []byte(strings.Replace(body, `"owner":"`+field, `"patterns":`+value+`,"owner":"`+field, 1))
	}
	for _, c := range []struct {
		kind  string
		body  []byte
		wrong string
	}{
		{docs.Process, on(process, "network-team", `["api-first","event-driven"]`), ""},
		{docs.Standard, on(logging, "security", `["microservices"]`), ""},
		{docs.Process, on(process, "network-team", `[]`), ""},
		{docs.Process, on(process, "network-team", `["api-first","soa"]`), `patterns[1]: "soa" is not a known architecture pattern. Known architecture patterns: api-first, event-driven, microservices`},
		{docs.Standard, on(logging, "security", `["EDA"]`), `patterns[0]: "EDA" is not a known architecture pattern`},
	} {
		err := docs.Check(c.kind, c.body, l)
		if c.wrong == "" && err != nil {
			t.Errorf("%s %s: %v", c.kind, c.body[:60], err)
		}
		if c.wrong != "" && (!errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), c.wrong)) {
			t.Errorf("%s: want %q, got %v", c.kind, c.wrong, err)
		}
	}
	if err := docs.Check(docs.Process, on(process, "network-team", `["api-first"]`), listsOf(t, lists)); err == nil || !strings.Contains(err.Error(), "Known architecture patterns: (none)") {
		t.Fatalf("missing patterns count as empty: %v", err)
	}
	if !strings.Contains(docs.EmptyCatalog, `"patterns":[]`) {
		t.Fatalf("the empty lists: %s", docs.EmptyCatalog)
	}
}

// The patterns a document is tagged with are uses of the list, so that one in use cannot be removed.
func TestPatternsAreUsesAndCanBeRemoved(t *testing.T) {
	process := strings.Replace(vpn, `"owner":"network-team"`, `"patterns":["event-driven"],"owner":"network-team"`, 1)
	if u := docs.UsesOf(docs.Process, []byte(process)); !u.Lists["patterns"]["event-driven"] || len(u.Lists["patterns"]) != 1 {
		t.Fatalf("process uses: %+v", u.Lists)
	}
	std := strings.Replace(logging, `"owner":"security"`, `"patterns":["api-first","microservices"],"owner":"security"`, 1)
	if u := docs.UsesOf(docs.Standard, []byte(std)); !u.Lists["patterns"]["api-first"] || !u.Lists["patterns"]["microservices"] {
		t.Fatalf("standard uses: %+v", u.Lists)
	}
	after := strings.Replace(withPatterns, `{"id":"api-first","name":"API-first"},`, "", 1)
	if removed := docs.Removed(listsOf(t, withPatterns), listsOf(t, after)); strings.Join(removed, ",") != "patterns/api-first" {
		t.Fatalf("removed: %v", removed)
	}
	twice := strings.Replace(withPatterns, `"name":"Microservices"`, `"name":"Microservices"},{"id":"api-first","name":"API first"`, 1)
	if err := docs.Check(docs.Catalog, []byte(twice), docs.Lists{}); err == nil || !strings.Contains(err.Error(), "Two architecture patterns have the id “api-first” (“API-first” and “API first”): remove one of them.") {
		t.Fatalf("duplicate pattern: %v", err)
	}
}

// The other names of a pattern belong to one pattern only and are no other pattern's name, in
// the app's words (patternNameClashes in src/lib/patterns.ts); a path may share one with a pattern.
func TestOtherNamesOfThePatterns(t *testing.T) {
	l := listsOf(t, withPatterns)
	if got := docs.PatternNames(l.Patterns, []string{"event-driven", "gone", "api-first"}); got != "Event-driven (also called EDA), gone, API-first" {
		t.Fatalf("%q", got)
	}
	clash := func(body string) error {
		return docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"teams":[],"tools":[],"paths":[{"id":"p","name":"Streaming"}],"patterns":`+body+`}`), docs.Lists{})
	}
	if err := clash(`[{"id":"a","name":"A","alsoCalled":["streaming"]},{"id":"b","name":"B","alsoCalled":["y"]}]`); err != nil {
		t.Fatal(err)
	}
	for body, want := range map[string]string{
		`[{"id":"a","name":"Event-driven","alsoCalled":["EDA"]},{"id":"b","name":"Streaming","alsoCalled":["eda"]}]`: "patterns[1].alsoCalled: The architecture patterns “Event-driven” and “Streaming” are both also called “eda”: keep it on one of them.",
		`[{"id":"a","name":"Serverless"},{"id":"b","name":"Functions","alsoCalled":["serverless"]}]`:                 "patterns[1].alsoCalled: The architecture pattern “Functions” is also called “serverless”, which is the name of the architecture pattern “Serverless”: take it off “Functions”.",
	} {
		if err := clash(body); !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: %v", body, err)
		}
	}
}
