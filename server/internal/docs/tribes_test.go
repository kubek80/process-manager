package docs_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// Tribes group teams and domains group tribes. Everything is optional; what a team or a tribe
// names must be in its list, said by name as the app says it (unknownGroupSentence).
func TestTribesAndDomainsMustBeInTheLists(t *testing.T) {
	check := func(teams, tribes, domains string) error {
		return docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":`+teams+`,"tribes":`+tribes+`,"domains":`+domains+`}`), docs.Lists{})
	}
	for _, ok := range [][3]string{
		{`[{"id":"a","name":"A","tribe":"t"},{"id":"b","name":"B"}]`, `[{"id":"t","name":"T","domain":"d"},{"id":"u","name":"U"}]`, `[{"id":"d","name":"D"},{"id":"e","name":"E"}]`},
		{`[{"id":"a","name":"A"}]`, `[]`, `[]`},
	} {
		if err := check(ok[0], ok[1], ok[2]); err != nil {
			t.Errorf("%v: %v", ok, err)
		}
	}
	// lists without the keys: no tribe and no domain, nothing wrong
	if err := docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[{"id":"a","name":"A"}]}`), docs.Lists{}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ teams, tribes, domains, want string }{
		{`[{"id":"a","name":"Payments team","tribe":"gone"}]`, `[]`, `[]`, "teams[0].tribe: The team “Payments team” is part of the tribe “gone”, which is not in the list of tribes: choose another tribe, or none."},
		{`[]`, `[{"id":"t","name":"","domain":"gone"}]`, `[]`, "tribes[0].domain: The tribe with the id “t” is part of the domain “gone”, which is not in the list of domains: choose another domain, or none."},
		{`[]`, `[{"id":"t","name":"T"},{"id":"t","name":"T"}]`, `[]`, "tribes[1].id: Two tribes have the id “t”, both called “T”: remove one of them."},
		{`[]`, `[]`, `[{"id":"d","name":"D"},{"id":"d","name":"E"}]`, "domains[1].id: Two domains have the id “d” (“D” and “E”): remove one of them."},
	} {
		if err := check(c.teams, c.tribes, c.domains); !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), c.want) {
			t.Errorf("want %q, got %v", c.want, err)
		}
	}
	l := listsOf(t, `{"teams":[{"id":"a","name":"A","tribe":"t"}],"tribes":[{"id":"t","name":"T","domain":"d"}],"domains":[{"id":"d","name":"D"}]}`)
	if l.Teams[0].Tribe != "t" || l.Tribes[0].Domain != "d" || len(l.ByKey("tribes")) != 1 || len(l.ByKey("domains")) != 1 {
		t.Fatalf("%+v", l)
	}
	after := listsOf(t, `{"teams":[{"id":"a","name":"A"}],"tribes":[],"domains":[]}`)
	if removed := docs.Removed(l, after); strings.Join(removed, ",") != "domains/d,tribes/t" {
		t.Fatalf("removed: %v", removed)
	}
	if !strings.Contains(docs.EmptyCatalog, `"tribes":[],"domains":[]`) {
		t.Fatal(docs.EmptyCatalog)
	}
}
