package chunking

import (
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// The summary part names the architecture patterns a document is tagged with, with what else each
// is called, so that "EDA" finds what is event-driven also by meaning. A document tagged with none
// gets no line: its text, and so its vector, stay as they were, and Version need not change.
func TestTheSummaryNamesThePatterns(t *testing.T) {
	lists := docs.Lists{
		Paths:    []docs.Named{{ID: "greenfield", Name: "Greenfield"}},
		Patterns: []docs.Named{{ID: "event-driven", Name: "Event-driven", AlsoCalled: []string{"event-based", "EDA"}}, {ID: "microservices", Name: "Microservices"}},
	}
	summary := func(kind, body string) string {
		t.Helper()
		cs, err := Chunks(kind, []byte(body), lists, Options{})
		if err != nil || len(cs) == 0 {
			t.Fatalf("%v %d", err, len(cs))
		}
		return cs[0].Text
	}
	p := summary(docs.Process, `{"id":"p","title":"Build a service","summary":"S.","paths":["greenfield"],"patterns":["microservices","event-driven","gone"],"steps":[{"id":"a","title":"A","actor":"me"}]}`)
	if !strings.HasSuffix(p, "\nMeant for the paths: Greenfield\nArchitecture patterns: Microservices, Event-driven (also called event-based, EDA), gone") {
		t.Fatalf("process:\n%s", p)
	}
	s := summary(docs.Standard, `{"id":"s","title":"Rule","summary":"S.","patterns":["event-driven"],"requirements":[{"id":"R-1","title":"R","level":"must","statement":"Do it."}]}`)
	if !strings.Contains(s, "\nArchitecture patterns: Event-driven (also called event-based, EDA)") {
		t.Fatalf("standard:\n%s", s)
	}
	plain := `{"id":"p","title":"Anything","summary":"S.","steps":[]}`
	none := summary(docs.Process, plain)
	if strings.Contains(none, "pattern") {
		t.Fatalf("tagged with none:\n%s", none)
	}
	// the same text as with lists that have no patterns at all
	cs, err := Chunks(docs.Process, []byte(plain), docs.Lists{Paths: lists.Paths}, Options{})
	if err != nil || cs[0].Text != none {
		t.Fatalf("the text of an untagged document changed: %q vs %q (%v)", cs[0].Text, none, err)
	}
}
