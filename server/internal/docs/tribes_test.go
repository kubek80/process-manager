package docs_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// Pillars group teams, tribes group pillars and domains group tribes. Everything is optional;
// what a team, a pillar or a tribe names must be in its list, said by name as the app says it
// (unknownGroupSentence).
func TestPillarsTribesAndDomainsMustBeInTheLists(t *testing.T) {
	check := func(teams, pillars, tribes, domains string) error {
		return docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":`+teams+`,"pillars":`+pillars+`,"tribes":`+tribes+`,"domains":`+domains+`}`), docs.Lists{})
	}
	for _, ok := range [][4]string{
		{`[{"id":"a","name":"A","pillar":"p"},{"id":"b","name":"B"}]`, `[{"id":"p","name":"P","tribe":"t"},{"id":"q","name":"Q"}]`, `[{"id":"t","name":"T","domain":"d"},{"id":"u","name":"U"}]`, `[{"id":"d","name":"D"},{"id":"e","name":"E"}]`},
		{`[{"id":"a","name":"A"}]`, `[]`, `[]`, `[]`},
	} {
		if err := check(ok[0], ok[1], ok[2], ok[3]); err != nil {
			t.Errorf("%v: %v", ok, err)
		}
	}
	// lists without the keys: no pillar, no tribe and no domain, nothing wrong
	if err := docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[{"id":"a","name":"A"}]}`), docs.Lists{}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ teams, pillars, tribes, domains, want string }{
		{`[{"id":"a","name":"Payments team","pillar":"gone"}]`, `[]`, `[]`, `[]`, "teams[0].pillar: The team “Payments team” is part of the pillar “gone”, which is not in the list of pillars: choose another pillar, or none."},
		{`[]`, `[{"id":"p","name":"Compute","tribe":"gone"}]`, `[]`, `[]`, "pillars[0].tribe: The pillar “Compute” is part of the tribe “gone”, which is not in the list of tribes: choose another tribe, or none."},
		{`[]`, `[]`, `[{"id":"t","name":"","domain":"gone"}]`, `[]`, "tribes[0].domain: The tribe with the id “t” is part of the domain “gone”, which is not in the list of domains: choose another domain, or none."},
		{`[]`, `[{"id":"p","name":"P"},{"id":"p","name":"P"}]`, `[]`, `[]`, "pillars[1].id: Two pillars have the id “p”, both called “P”: remove one of them."},
		{`[]`, `[]`, `[]`, `[{"id":"d","name":"D"},{"id":"d","name":"E"}]`, "domains[1].id: Two domains have the id “d” (“D” and “E”): remove one of them."},
	} {
		if err := check(c.teams, c.pillars, c.tribes, c.domains); !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), c.want) {
			t.Errorf("want %q, got %v", c.want, err)
		}
	}
	l := listsOf(t, `{"teams":[{"id":"a","name":"A","pillar":"p"}],"pillars":[{"id":"p","name":"P","tribe":"t"}],"tribes":[{"id":"t","name":"T","domain":"d"}],"domains":[{"id":"d","name":"D"}]}`)
	if l.Teams[0].Pillar != "p" || l.Pillars[0].Tribe != "t" || l.Tribes[0].Domain != "d" || len(l.ByKey("pillars")) != 1 || len(l.ByKey("tribes")) != 1 || len(l.ByKey("domains")) != 1 {
		t.Fatalf("%+v", l)
	}
	after := listsOf(t, `{"teams":[{"id":"a","name":"A"}],"pillars":[],"tribes":[],"domains":[]}`)
	if removed := docs.Removed(l, after); strings.Join(removed, ",") != "domains/d,pillars/p,tribes/t" {
		t.Fatalf("removed: %v", removed)
	}
	if !strings.Contains(docs.EmptyCatalog, `"pillars":[],"tribes":[],"domains":[]`) {
		t.Fatal(docs.EmptyCatalog)
	}
}
