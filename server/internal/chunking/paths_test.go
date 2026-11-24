package chunking

import (
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// The summary part says which paths a document is for, with what else each is called, so that
// "golden path" finds what is on the paved path also by meaning; a document for any path, and a
// path that is no longer in the lists, are said as they are.
func TestTheSummarySaysThePaths(t *testing.T) {
	lists := docs.Lists{Paths: []docs.Named{
		{ID: "greenfield", Name: "Greenfield", Symbol: "sprout", AlsoCalled: []string{"green field"}},
		{ID: "paved-path", Name: "Paved path", Symbol: "road", AlsoCalled: []string{"golden path", " ", "paved road"}},
		// the other names belong to the entry, not to its picture
		{ID: "lift", Name: "Lift and shift", Symbol: "road"},
	}}
	summary := func(kind, body string) string {
		t.Helper()
		cs, err := Chunks(kind, []byte(body), lists, Options{})
		if err != nil || len(cs) == 0 {
			t.Fatalf("%v %d", err, len(cs))
		}
		return cs[0].Text
	}
	p := summary(docs.Process, `{"id":"p","title":"Build a service","summary":"S.","paths":["paved-path","lift","gone"],"steps":[{"id":"a","title":"A","actor":"me"}]}`)
	if !strings.HasSuffix(p, "\nMeant for the paths: Paved path (also called golden path, paved road), Lift and shift, gone") {
		t.Fatalf("process:\n%s", p)
	}
	s := summary(docs.Standard, `{"id":"s","title":"Rule","summary":"S.","paths":["greenfield"],"requirements":[{"id":"R-1","title":"R","level":"must","statement":"Do it."}]}`)
	if !strings.Contains(s, "\nMeant for the paths: Greenfield (also called green field)") {
		t.Fatalf("standard:\n%s", s)
	}
	if none := summary(docs.Process, `{"id":"p","title":"Anything","summary":"S.","steps":[]}`); strings.Contains(none, "paths") {
		t.Fatalf("for any path:\n%s", none)
	}
}
