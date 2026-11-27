package docs_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// A service is performed by a team of the lists, requested through a web link, and described in
// rich text of the allow-list; the sentences are the app's (serviceIssues, issueText).
func TestServicesInTheLists(t *testing.T) {
	check := func(services string) error {
		return docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[{"id":"dns","name":"DNS team"}],"services":`+services+`}`), docs.Lists{})
	}
	if err := check(`[{"id":"dns-change","name":"DNS record change","team":"dns","form":"https://forms.example.com/dns","description":"<p>A <strong>record</strong>, see <a href=\"mailto:dns@example.com\">us</a>.</p>"}]`); err != nil {
		t.Fatal(err)
	}
	// lists without the key have no services
	if err := docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[]}`), docs.Lists{}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ services, want string }{
		{`[{"id":"x","name":"X","team":"gone","form":"https://f.example"}]`, "services[0].team: The service “X” is performed by the team “gone”, which is not in the list of teams: choose another team."},
		{`[{"id":"x","name":"X","form":"https://f.example"}]`, "services[0].team: Choose the team that performs the service “X”."},
		{`[{"id":"x","name":"X","team":"dns"}]`, "services[0].form: Give the front-door form of the service “X”: the link where people request it."},
		{`[{"id":"x","name":"X","team":"dns","form":"javascript:alert(1)"}]`, "services[0].form: The front-door form of the service “X” is not a whole link: write it with https:// at the start."},
		{`[{"id":"x","name":"X","team":"dns","form":"https://f.example","description":"<p onclick=\"x()\">hi</p>"}]`, "services[0].description: The description of the service “X” contains the attribute “onclick”, which cannot be shown: remove it, or paste the text again."},
		{`[{"id":"x","name":"","team":"dns","form":"https://f.example","description":"<script>x</script>"}]`, "services[0].description: The description of the service with the id “x” contains a script"},
		{`[{"id":"x","name":"X","team":"dns","form":"https://f.example"},{"id":"x","name":"Y","team":"dns","form":"https://f.example"}]`, "services[1].id: Two services have the id “x” (“X” and “Y”): remove one of them."},
	} {
		err := check(c.services)
		if !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s:\n got %v\nwant %s", c.services, err, c.want)
		}
	}
}

// A step requests a service only as a service step, and only one of the list.
func TestServiceStepsOfAProcess(t *testing.T) {
	lists := docs.Lists{Services: []docs.Named{{ID: "dns-change", Name: "DNS record change", Team: "dns"}}}
	process := func(step string) []byte {
		return []byte(`{"id":"p","actors":[{"id":"me","name":"You"}],"steps":[` + step + `]}`)
	}
	if err := docs.Check(docs.Process, process(`{"id":"a","actor":"me","type":"service","service":"dns-change","next":[]}`), lists); err != nil {
		t.Fatal(err)
	}
	for step, want := range map[string]string{
		`{"id":"a","actor":"me","type":"service","next":[]}`:                     "steps[0].service: A service step needs the service it requests: choose it under “Service”.",
		`{"id":"a","actor":"me","type":"task","service":"dns-change","next":[]}`: "steps[0].service: Only a step of the kind Service requests a service: make it a Service step, or remove the service.",
		`{"id":"a","actor":"me","type":"service","service":"gone","next":[]}`:    "steps[0].service: The service “gone” is not in the list of services: choose one of the list.",
	} {
		if err := docs.Check(docs.Process, process(step), lists); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s:\n got %v\nwant %s", step, err, want)
		}
	}
	// what a step requests counts as a use of the service: it cannot be removed while used
	u := docs.UsesOf(docs.Process, process(`{"id":"a","actor":"me","type":"service","service":"dns-change","next":[]}`))
	if !u.Lists["services"]["dns-change"] {
		t.Fatalf("uses: %+v", u.Lists)
	}
	if got := docs.Removed(lists, docs.Lists{}); strings.Join(got, ",") != "services/dns-change" {
		t.Fatalf("removed: %v", got)
	}
}
