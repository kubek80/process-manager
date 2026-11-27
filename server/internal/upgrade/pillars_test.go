package upgrade_test

import (
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/upgrade"
)

// lists of the version before pillars: teams straight in tribes (yesterday's shape)
const listsBeforePillars = `{"tiers":[],"paths":[],"environments":[],"languages":[],
"teams":[{"id":"a","name":"Alpha","tribe":"cloud"},{"id":"b","name":"Beta","tribe":"net"},{"id":"c","name":"Gamma","tribe":"cloud"},
{"id":"d","name":"Delta"},{"id":"e","name":"Epsilon","tribe":"gone"}],
"tribes":[{"id":"cloud","name":"Cloud","domain":"infra"},{"id":"net","name":"Connectivity"},{"id":"empty","name":"Empty"}],
"domains":[{"id":"infra","name":"Infrastructure"}],"practices":[],"platforms":[],"categories":[],"tools":[]}`

// Teams that named a tribe are put in one pillar of that tribe each, named like it; "tribe" leaves
// the teams; a team that named a tribe the lists do not have is in no pillar; once.
func TestTeamsInTribesArePutInPillarsOnce(t *testing.T) {
	pool := dbtest.NewPool(t)
	f := fixture{pool: pool, docs: &docs.Store{Pool: pool}}
	if _, _, err := f.docs.Put(ctx, docs.Catalog, docs.CatalogID, []byte(listsBeforePillars), "import"); err != nil {
		t.Fatal(err)
	}
	report, err := upgrade.Convert(ctx, pool, quiet)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Converted || !report.Lists || report.Pillars != 2 || report.TeamsInPillars != 3 || report.Paths != 0 {
		t.Fatalf("report: %+v", report)
	}
	if report.String() != "put 3 teams in 2 new pillars; the lists were updated" {
		t.Fatalf("report: %s", report)
	}
	l, err := f.docs.Lists(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var pillars, teams []string
	for _, p := range l.Pillars {
		pillars = append(pillars, p.ID+"="+p.Name+"/"+p.Tribe)
	}
	for _, tm := range l.Teams {
		teams = append(teams, tm.ID+":"+tm.Pillar+":"+tm.Tribe)
	}
	if strings.Join(pillars, ",") != "cloud=Cloud/cloud,net=Connectivity/net" {
		t.Fatalf("pillars: %v", pillars)
	}
	if strings.Join(teams, ",") != "a:cloud:,b:net:,c:cloud:,d::,e::" {
		t.Fatalf("teams: %v", teams)
	}
	_, cat := f.body(t, docs.Catalog, docs.CatalogID)
	text := string(cat.Body)
	if strings.Contains(text, `"tribe": "cloud",`+"\n"+`      "name"`) || cat.Version != 2 || cat.UpdatedBy != upgrade.By {
		t.Fatalf("lists v%d by %s:\n%s", cat.Version, cat.UpdatedBy, text)
	}
	// the pillars go after the teams, and the result passes the checks of this version
	if !(strings.Index(text, `"teams"`) < strings.Index(text, `"pillars"`) && strings.Index(text, `"pillars"`) < strings.Index(text, `"tribes"`)) {
		t.Fatalf("the pillars go after the teams:\n%s", text)
	}
	valid(t, loadSchemas(t), l, docs.Catalog, "the lists", cat.Body)
	history, _ := f.docs.History(ctx, docs.Catalog, docs.CatalogID)
	if history[0].Note != upgrade.PillarsNote {
		t.Fatalf("history: %+v", history[0])
	}
	logged := activity(t, pool)
	if !strings.Contains(logged, "content.convert lists put the teams that were in a tribe in pillars: 2 pillars added, one in each such tribe") {
		t.Fatalf("activity log:\n%s", logged)
	}
	// a second start finds nothing to do
	again, err := upgrade.Convert(ctx, pool, quiet)
	if err != nil || again.Converted {
		t.Fatalf("converted again: %+v %v", again, err)
	}
	if _, cat := f.body(t, docs.Catalog, docs.CatalogID); cat.Version != 2 {
		t.Fatalf("lists v%d after a second start", cat.Version)
	}
}

// Lists in which no team names a tribe are left exactly as they are.
func TestListsWithoutTeamsInTribesAreLeftAlone(t *testing.T) {
	body := `{"teams":[{"id":"a","name":"A","pillar":"p"}],"pillars":[{"id":"p","name":"P"}]}`
	out, pillars, teams, err := upgrade.PillarsFromTribes([]byte(body), quiet)
	if err != nil || string(out) != body || pillars != 0 || teams != 0 {
		t.Fatalf("%s %d %d %v", out, pillars, teams, err)
	}
	// no teams at all
	if out, _, _, err := upgrade.PillarsFromTribes([]byte(`{"tiers":[]}`), quiet); err != nil || string(out) != `{"tiers":[]}` {
		t.Fatalf("%s %v", out, err)
	}
}

// An id the pillars already have gets a number; a team that names a pillar keeps it; the tribe
// of a name too long for a pillar is cut to its limit.
func TestPillarIdsThatWouldClash(t *testing.T) {
	body := `{"teams":[{"id":"a","name":"A","tribe":"cloud"},{"id":"b","name":"B","tribe":"cloud","pillar":"own"},{"id":"c","name":"C","tribe":"net"}],
"pillars":[{"id":"cloud","name":"An older pillar"},{"id":"cloud-2","name":"Another"},{"id":"own","name":"Own"}],
"tribes":[{"id":"cloud","name":"Cloud"},{"id":"net","name":"` + strings.Repeat("N", 70) + `"}]}`
	out, pillars, teams, err := upgrade.PillarsFromTribes([]byte(body), quiet)
	if err != nil || pillars != 2 || teams != 2 {
		t.Fatalf("%s %d %d %v", out, pillars, teams, err)
	}
	text := string(out)
	for _, want := range []string{
		`{"id":"cloud-3","name":"Cloud","tribe":"cloud"}`,
		`{"id":"net","name":"` + strings.Repeat("N", 60) + `","tribe":"net"}`,
		`{"id":"a","name":"A","pillar":"cloud-3"}`,
		`{"id":"b","name":"B","pillar":"own"}`,
		`{"id":"c","name":"C","pillar":"net"}`,
	} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %s in\n%s", want, text)
		}
	}
	if strings.Contains(text, `"tribe":"cloud","pillar"`) || strings.Contains(text, `"name":"A","tribe"`) {
		t.Fatalf("a team still names a tribe:\n%s", text)
	}
}
