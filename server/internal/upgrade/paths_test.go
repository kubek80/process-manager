package upgrade_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/upgrade"
)

// lists of the version before the paths: every other list is there
const listsBeforePaths = `{"tiers":[{"id":"tier-0","name":"Tier 0"}],"environments":[],"languages":[],"teams":[{"id":"ops","name":"Ops"}],"practices":[],"platforms":[],"categories":[],"tools":[]}`

func TestListsWithoutPathsGetThemOnce(t *testing.T) {
	pool := dbtest.NewPool(t)
	f := fixture{pool: pool, docs: &docs.Store{Pool: pool}}
	if _, _, err := f.docs.Put(ctx, docs.Catalog, docs.CatalogID, []byte(listsBeforePaths), "import"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.docs.Put(ctx, docs.Process, "p", []byte(process("p", "ops", "", "")), "import"); err != nil {
		t.Fatal(err)
	}
	report, err := upgrade.Convert(ctx, pool, quiet)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Converted || !report.Lists || report.Paths != 3 || report.Documents != 0 {
		t.Fatalf("report: %+v", report)
	}
	if !strings.Contains(report.String(), "added the list of paths with 3 entries") {
		t.Fatalf("report: %s", report)
	}
	l, err := f.docs.Lists(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, p := range l.Paths {
		got = append(got, p.ID+"="+p.Name+"/"+p.Symbol)
	}
	if strings.Join(got, ",") != "greenfield=Greenfield/sprout,brownfield=Brownfield/buildings,paved-path=Paved path/road" {
		t.Fatalf("paths: %v", got)
	}
	_, cat := f.body(t, docs.Catalog, docs.CatalogID)
	if cat.Version != 2 || cat.UpdatedBy != upgrade.By {
		t.Fatalf("lists v%d by %s", cat.Version, cat.UpdatedBy)
	}
	// next to the tiers, the other lists as they were
	text := string(cat.Body)
	if !(strings.Index(text, `"tiers"`) < strings.Index(text, `"paths"`) && strings.Index(text, `"paths"`) < strings.Index(text, `"environments"`)) {
		t.Fatalf("the paths go after the tiers:\n%s", text)
	}
	history, _ := f.docs.History(ctx, docs.Catalog, docs.CatalogID)
	if history[0].Note != upgrade.PathsNote {
		t.Fatalf("history: %+v", history[0])
	}
	// what was added passes the checks of this version
	set := loadSchemas(t)
	valid(t, set, l, docs.Catalog, "the lists", cat.Body)
	// a document without paths is valid as it is: not rewritten
	if _, p := f.body(t, docs.Process, "p"); p.Version != 1 {
		t.Fatalf("process v%d", p.Version)
	}
	logged := activity(t, pool)
	if !strings.Contains(logged, "content.convert lists "+upgrade.PathsSummary) {
		t.Fatalf("activity log:\n%s", logged)
	}

	// a second start finds nothing to do
	again, err := upgrade.Convert(ctx, pool, quiet)
	if err != nil {
		t.Fatal(err)
	}
	if again.Converted {
		t.Fatalf("converted again: %+v", again)
	}
	if _, cat := f.body(t, docs.Catalog, docs.CatalogID); cat.Version != 2 {
		t.Fatalf("lists v%d after a second start", cat.Version)
	}
	if later := activity(t, pool); later != logged {
		t.Fatalf("a second start wrote to the activity log:\n%s", later)
	}
}

func TestRemovedPathsDoNotComeBack(t *testing.T) {
	pool := dbtest.NewPool(t)
	store := &docs.Store{Pool: pool}
	// an admin removed every path: the key stays, empty
	removed := strings.Replace(listsBeforePaths, `"environments"`, `"paths":[],"environments"`, 1)
	if _, _, err := store.Put(ctx, docs.Catalog, docs.CatalogID, []byte(removed), "import"); err != nil {
		t.Fatal(err)
	}
	report, err := upgrade.Convert(ctx, pool, quiet)
	if err != nil || report.Converted {
		t.Fatalf("%+v %v", report, err)
	}
	if d, _ := store.Get(ctx, docs.Catalog, docs.CatalogID); d.Version != 1 {
		t.Fatalf("lists v%d", d.Version)
	}
	// and one that kept only a path of its own
	own := strings.Replace(listsBeforePaths, `"environments"`, `"paths":[{"id":"lift-and-shift","name":"Lift and shift","symbol":"bridge"}],"environments"`, 1)
	if _, _, err := store.Put(ctx, docs.Catalog, docs.CatalogID, []byte(own), "alex@example.com"); err != nil {
		t.Fatal(err)
	}
	if report, err := upgrade.Convert(ctx, pool, quiet); err != nil || report.Converted {
		t.Fatalf("%+v %v", report, err)
	}
	l, _ := store.Lists(ctx)
	if len(l.Paths) != 1 || l.Paths[0].ID != "lift-and-shift" {
		t.Fatalf("paths: %+v", l.Paths)
	}
}

func TestAnOlderDatabaseGetsThePathsInTheSameVersion(t *testing.T) {
	f := oldDatabase(t)
	report, err := upgrade.Convert(ctx, f.pool, quiet)
	if err != nil {
		t.Fatal(err)
	}
	if report.Paths != 3 {
		t.Fatalf("report: %+v", report)
	}
	l, _ := f.docs.Lists(ctx)
	if len(l.Paths) != 3 {
		t.Fatalf("paths: %+v", l.Paths)
	}
	// one new version of the lists, which says what moved
	if _, cat := f.body(t, docs.Catalog, docs.CatalogID); cat.Version != 2 {
		t.Fatalf("lists v%d", cat.Version)
	}
	history, _ := f.docs.History(ctx, docs.Catalog, docs.CatalogID)
	if history[0].Note != upgrade.Note {
		t.Fatalf("history: %+v", history[0])
	}
	logged := activity(t, f.pool)
	if !strings.Contains(logged, "; "+upgrade.PathsSummary) {
		t.Fatalf("activity log:\n%s", logged)
	}
}

func TestListsMadeForOlderContentGetThePaths(t *testing.T) {
	pool := dbtest.NewPool(t)
	store := &docs.Store{Pool: pool}
	// documents without any lists at all (the lists are made by the conversion)
	if _, _, err := store.Put(ctx, docs.Process, "p", []byte(process("p", "ops", "", "")), "import"); err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade.Convert(ctx, pool, quiet); err != nil {
		t.Fatal(err)
	}
	if l, _ := store.Lists(ctx); len(l.Paths) != 3 {
		t.Fatalf("paths: %+v", l.Paths)
	}
}

// activity is the activity log, newest first, a line per entry.
func activity(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	entries, err := (&audit.Log{Pool: pool}).Recent(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	for _, e := range entries {
		lines = append(lines, e.Action+" "+e.Target+" "+e.Detail)
	}
	return strings.Join(lines, "\n")
}

// The paths an older installation is given are those of the sample lists.
func TestDefaultPathsAreTheSamples(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "..", "catalog", "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		Paths []docs.Named `json:"paths"`
	}
	var given []docs.Named
	if err := json.Unmarshal(body, &sample); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(upgrade.DefaultPaths, &given); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(sample.Paths, given) || len(given) != 3 {
		t.Fatalf("sample %+v\ngiven %+v", sample.Paths, given)
	}
}
