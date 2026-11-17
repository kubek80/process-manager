package upgrade_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/schema"
	"github.com/kubek80/process-manager/server/internal/upgrade"
)

func loadSchemas(t *testing.T) *schema.Set {
	t.Helper()
	set, err := schema.Load(filepath.Join("..", "..", "..", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	return set
}

// valid checks a converted document as a save in the portal would.
func valid(t *testing.T, set *schema.Set, l docs.Lists, kind, what string, body []byte) {
	t.Helper()
	if err := set.Validate(kind, body); err != nil {
		t.Errorf("%s: %v", what, err)
	}
	if err := docs.Check(kind, body, l); err != nil {
		t.Errorf("%s: %v", what, err)
	}
}

func TestOddInputStillFitsTheFormat(t *testing.T) {
	pool := dbtest.NewPool(t)
	store := &docs.Store{Pool: pool}
	var logged bytes.Buffer
	log := slog.New(slog.NewTextHandler(&logged, nil))
	long := strings.Repeat("Very long category text ", 6) // about 140 characters
	catalog := `{"tiers":[],"environments":[],"languages":[],"tools":[],"teams":[
	 {"id":"big-platform","name":"Big platform","kind":"platform","contact":"` + strings.Repeat("c", 120) + `","description":"` + strings.Repeat("d", 200) + `"},
	 {"id":"ops","name":"Ops","kind":"practice"}]}`
	put := func(kind, id, body string) {
		if _, _, err := store.Put(ctx, kind, id, []byte(body), "import"); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
	}
	put(docs.Catalog, docs.CatalogID, catalog)
	for id, category := range map[string]string{
		"p-cloud": "  Cloud  ", "p-cloud-upper": "CLOUD", "p-cloud-bang": "Cloud!", "p-chinese": "云计算", "p-chinese-2": "网络",
		"p-blank": "   ", "p-long": long, "p-plain": "General",
	} {
		put(docs.Process, id, process(id, "big-platform", category, ""))
	}
	put(docs.Process, "p-draft", process("p-draft", "ops", "Secret plans", `"status":"draft",`))
	put(docs.Process, "p-draft-shared", process("p-draft-shared", "ops", "general", `"status":"draft",`))
	put(docs.Process, "p-ghost", process("p-ghost", "ops", "General", `"platform":"ghost",`))
	// a deleted document: its category is not published, its versions lose it
	put(docs.Process, "p-gone", process("p-gone", "ops", "Retired things", ""))
	if err := store.Delete(ctx, docs.Process, "p-gone", "alex"); err != nil {
		t.Fatal(err)
	}
	// a stored row whose body does not match it: the save refuses it, the start goes on
	if _, err := pool.Exec(ctx, `insert into documents (kind, id, version, body, updated_by) values ('process', 'p-broken', 1, $1, 'import')`,
		process("p-other-id", "ops", "General", "")); err != nil {
		t.Fatal(err)
	}

	if err := upgrade.Lists(ctx, pool, log); err != nil {
		t.Fatal(err)
	}
	set := loadSchemas(t)
	l, _ := store.Lists(ctx)
	cat, _ := store.Get(ctx, docs.Catalog, docs.CatalogID)
	if err := set.Validate(docs.Catalog, cat.Body); err != nil {
		t.Fatalf("the converted lists do not match the format: %v\n%s", err, cat.Body)
	}
	if err := docs.Check(docs.Catalog, cat.Body, l); err != nil {
		t.Fatal(err)
	}
	var cats []string
	for _, c := range l.Categories {
		cats = append(cats, c.ID+"="+c.Name)
	}
	want := "category=云计算,category-2=网络,cloud=Cloud,cloud-2=Cloud!,general=General," +
		"very-long-category-text-very-long-category-text-very-long-category-text-very-lon=Very long category text Very long catego"
	if strings.Join(cats, ",") != want {
		t.Fatalf("categories:\n%s", strings.Join(cats, "\n"))
	}
	for _, d := range must(store.List(ctx, docs.Process)) {
		var head struct{ Category, Platform string }
		json.Unmarshal(d.Body, &head)
		switch d.ID {
		case "p-broken":
			continue // left as it was
		case "p-ghost":
			if head.Platform != "ghost" {
				t.Errorf("an unknown platform must be left: %q", head.Platform)
			}
			continue
		case "p-blank", "p-draft":
			if head.Category != "" {
				t.Errorf("%s keeps the category %q", d.ID, head.Category)
			}
		case "p-cloud", "p-cloud-upper":
			if head.Category != "cloud" {
				t.Errorf("%s: %q", d.ID, head.Category)
			}
		case "p-draft-shared":
			if head.Category != "general" {
				t.Errorf("a draft with a published text keeps it: %q", head.Category)
			}
		}
		valid(t, set, l, docs.Process, d.ID, d.Body)
	}
	// the deleted document's versions lose the category nobody can see, the marker stays
	history, _ := store.History(ctx, docs.Process, "p-gone")
	if len(history) != 2 || !history[0].Deleted {
		t.Fatalf("history: %+v", history)
	}
	old, _ := store.VersionBody(ctx, docs.Process, "p-gone", 1)
	if strings.Contains(string(old), "category") || !strings.Contains(string(old), `"practice": "ops"`) {
		t.Fatalf("old version:\n%s", old)
	}
	text := logged.String()
	for _, want := range []string{"text cut to fit the lists", "numbered id", "written differently became one category", "only drafts or deleted documents",
		"the document cannot be saved", "names a platform that is not in the lists"} {
		if !strings.Contains(text, want) {
			t.Errorf("the log does not say %q:\n%s", want, text)
		}
	}
	// and a second start finds nothing to do
	logged.Reset()
	if err := upgrade.Lists(ctx, pool, log); err != nil {
		t.Fatal(err)
	}
	if again, _ := store.Get(ctx, docs.Catalog, docs.CatalogID); again.Version != cat.Version {
		t.Fatal("converted twice")
	}
	if strings.Contains(logged.String(), "converted to practices") {
		t.Fatal("a second start converted again")
	}
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

var (
	ctx   = context.Background()
	quiet = slog.New(slog.NewTextHandler(io.Discard, nil))
)

// What a database filled by the earlier version holds: teams with a kind, free-text
// categories, no practices, platforms or categories, and standards editors of one unit.
const oldCatalog = `{"tiers":[{"id":"tier-0","name":"Tier 0"}],"environments":[{"id":"production","name":"Production"}],"languages":[],
"teams":[
 {"id":"cloud-platform-team","name":"Cloud Platform team","kind":"platform","contact":"Slack #cloud-platform"},
 {"id":"security","name":"Cyber Security","kind":"security","contact":"Slack #security"},
 {"id":"engineering-practice","name":"Engineering practice","kind":"practice","contact":"Slack #eng","description":"Guild that agrees how we write and review code."},
 {"id":"dns-team","name":"DNS team","kind":"team"},
 {"id":"network-team","name":"Network team"}],
"tools":[{"id":"github","name":"GitHub"}]}`

func process(id, owner, category, more string) string {
	return `{"schemaVersion":"1.0","id":"` + id + `","title":"` + id + `","summary":"Something people need to get done.","owner":"` + owner + `","category":"` + category + `",` + more +
		`"prerequisites":[],"actors":[{"id":"me","name":"You"}],"steps":[{"id":"do","title":"Do it","actor":"me","type":"task","next":[]}]}`
}

func standard(id, owner string) string {
	return `{"schemaVersion":"1.0","id":"` + id + `","title":"` + id + `","summary":"A rule that everyone follows.","owner":"` + owner + `","scope":"Everything.","status":"active",` +
		`"requirements":[{"id":"R-01","title":"Rule","level":"must","statement":"Everyone does it this way.","verification":{"method":"review"}}]}`
}

type fixture struct {
	pool  *pgxpool.Pool
	docs  *docs.Store
	roles *rbac.Store
	audit *audit.Log
}

func oldDatabase(t *testing.T) fixture {
	t.Helper()
	pool := dbtest.NewPool(t)
	f := fixture{pool: pool, docs: &docs.Store{Pool: pool}, roles: &rbac.Store{Pool: pool}, audit: &audit.Log{Pool: pool}}
	put := func(kind, id, body string) {
		if _, _, err := f.docs.Put(ctx, kind, id, []byte(body), "import"); err != nil {
			t.Fatalf("%s %s: %v", kind, id, err)
		}
	}
	put(docs.Catalog, docs.CatalogID, oldCatalog)
	put(docs.Process, "request-gcp-project", process("request-gcp-project", "cloud-platform-team", "Cloud", `"tags":["first"],`))
	put(docs.Process, "request-gcp-project", process("request-gcp-project", "cloud-platform-team", "Cloud", ""))
	put(docs.Process, "request-gcp-folder", process("request-gcp-folder", "cloud-platform-team", "cloud", ""))
	put(docs.Process, "publish-library", process("publish-library", "engineering-practice", "Source control", `"platform":"cloud-platform-team",`))
	put(docs.Process, "request-dns-record", process("request-dns-record", "dns-team", "Réseau & DNS", ""))
	put(docs.Standard, "secure-logging", standard("secure-logging", "security"))
	put(docs.Standard, "naming", standard("naming", "network-team"))
	// roles the earlier version allowed; Grant of this version refuses a limited standards editor
	for _, r := range [][3]string{
		{"riley@example.com", "standards-editor", "security"},
		{"riley@example.com", "owner", "security"},
		{"pat@example.com", "standards-editor", "engineering-practice"},
		{"kim@example.com", "standards-editor", "cloud-platform-team"},
		{"lee@example.com", "standards-editor", "dns-team"},
		{"max@example.com", "standards-editor", ""},
	} {
		if _, err := pool.Exec(ctx, `insert into role_assignments (email, role, scope, granted_by) values ($1, $2, $3, 'dana@example.com')`, r[0], r[1], r[2]); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f fixture) body(t *testing.T, kind, id string) (map[string]any, docs.Doc) {
	t.Helper()
	d, err := f.docs.Get(ctx, kind, id)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(d.Body, &out); err != nil {
		t.Fatal(err)
	}
	return out, d
}

func TestAnOlderDatabaseIsConvertedOnce(t *testing.T) {
	f := oldDatabase(t)
	if err := upgrade.Lists(ctx, f.pool, quiet); err != nil {
		t.Fatal(err)
	}

	// the lists: teams keep everything but their kind, platforms and practices are added
	_, cat := f.body(t, docs.Catalog, docs.CatalogID)
	text := string(cat.Body)
	if strings.Contains(text, `"kind"`) || cat.Version != 2 || cat.UpdatedBy != upgrade.By {
		t.Fatalf("lists v%d by %s:\n%s", cat.Version, cat.UpdatedBy, text)
	}
	order := []string{`"teams"`, `"practices"`, `"platforms"`, `"categories"`, `"tools"`}
	for i := 1; i < len(order); i++ {
		if strings.Index(text, order[i-1]) > strings.Index(text, order[i]) {
			t.Fatalf("the new lists belong between teams and tools:\n%s", text)
		}
	}
	l, _ := f.docs.Lists(ctx)
	if len(l.Teams) != 5 {
		t.Fatalf("teams: %+v", l.Teams)
	}
	if p, ok := l.Platform("cloud-platform-team"); !ok || p.Name != "Cloud Platform team" || p.Contact != "Slack #cloud-platform" || len(l.Platforms) != 1 {
		t.Fatalf("platforms: %+v", l.Platforms)
	}
	if p, ok := l.Practice("engineering-practice"); !ok || p.Description != "Guild that agrees how we write and review code." || len(l.Practices) != 2 {
		t.Fatalf("practices: %+v", l.Practices)
	}
	if _, ok := l.Practice("security"); !ok {
		t.Fatal("a security unit becomes a practice")
	}
	var cats []string
	for _, c := range l.Categories {
		cats = append(cats, c.ID+"="+c.Name)
	}
	if strings.Join(cats, ",") != "cloud=Cloud,reseau-dns=Réseau & DNS,source-control=Source control" {
		t.Fatalf("categories: %v", cats)
	}

	// the documents name ids, and belong to the platform or practice of their former unit
	gcp, d := f.body(t, docs.Process, "request-gcp-project")
	if gcp["category"] != "cloud" || gcp["platform"] != "cloud-platform-team" || gcp["practice"] != nil || d.Version != 3 || d.UpdatedBy != upgrade.By {
		t.Fatalf("gcp: %v", gcp)
	}
	if !strings.Contains(string(d.Body), "\"category\": \"cloud\",\n  \"platform\": \"cloud-platform-team\",\n  \"prerequisites\"") {
		t.Fatalf("the platform goes next to the category:\n%s", d.Body)
	}
	if folder, _ := f.body(t, docs.Process, "request-gcp-folder"); folder["category"] != "cloud" {
		t.Fatalf("the same category written differently: %v", folder["category"])
	}
	lib, _ := f.body(t, docs.Process, "publish-library")
	if lib["category"] != "source-control" || lib["practice"] != "engineering-practice" || lib["platform"] != "cloud-platform-team" {
		t.Fatalf("library: %v", lib)
	}
	if dns, _ := f.body(t, docs.Process, "request-dns-record"); dns["category"] != "reseau-dns" || dns["platform"] != nil || dns["practice"] != nil {
		t.Fatalf("dns: %v", dns)
	}
	if sec, _ := f.body(t, docs.Standard, "secure-logging"); sec["practice"] != "security" {
		t.Fatalf("standard: %v", sec)
	}
	if _, naming := f.body(t, docs.Standard, "naming"); naming.Version != 1 {
		t.Fatal("a document that needs no change must not get a version")
	}
	history, _ := f.docs.History(ctx, docs.Process, "request-gcp-project")
	if history[0].Note != upgrade.Note || history[0].SavedBy != upgrade.By {
		t.Fatalf("history: %+v", history[0])
	}

	// what was converted passes the checks of this version
	schemas, err := schema.Load(filepath.Join("..", "..", "..", "schema"))
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{docs.Catalog, docs.Process, docs.Standard} {
		list, _ := f.docs.List(ctx, kind)
		for _, d := range list {
			if err := schemas.Validate(kind, d.Body); err != nil {
				t.Errorf("%s %s: %v", kind, d.ID, err)
			}
			if err := docs.Check(kind, d.Body, l); err != nil {
				t.Errorf("%s %s: %v", kind, d.ID, err)
			}
		}
	}

	// roles: a standards editor of a unit owns its platform or practice now
	all, _ := f.roles.All(ctx)
	var got []string
	for _, a := range all {
		got = append(got, a.Email+" "+a.Role+" "+a.Scope+" "+a.GrantedBy)
	}
	want := "kim@example.com platform-owner cloud-platform-team dana@example.com," +
		"max@example.com standards-editor  dana@example.com," +
		"pat@example.com practice-owner engineering-practice dana@example.com," +
		"riley@example.com owner security dana@example.com," +
		"riley@example.com practice-owner security dana@example.com"
	if strings.Join(got, ",") != want {
		t.Fatalf("roles:\n%s", strings.Join(got, "\n"))
	}
	entries, _ := f.audit.Recent(ctx, 20)
	var actions []string
	for _, e := range entries {
		actions = append(actions, e.Action+" "+e.Target+" "+e.Detail)
	}
	joined := strings.Join(actions, "\n")
	for _, want := range []string{
		"content.convert lists 5 documents moved to the new lists (6 older versions adjusted); added 2 practices, 1 platforms, 3 categories; 3 roles converted, 1 removed",
		"access.grant riley@example.com Standards editor for Cyber Security became Practice owner for the practice Cyber Security",
		"access.revoke lee@example.com Standards editor for DNS team removed: it is neither a platform nor a practice",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("activity log lacks %q:\n%s", want, joined)
		}
	}

	// a version from before the conversion can be put back: it passes the checks of a save and
	// stays on its platform
	first, err := f.docs.VersionBody(ctx, docs.Process, "request-gcp-project", 1)
	if err != nil {
		t.Fatal(err)
	}
	valid(t, schemas, l, docs.Process, "version 1", first)
	if !strings.Contains(string(first), `"category": "cloud"`) || !strings.Contains(string(first), `"platform": "cloud-platform-team"`) || !strings.Contains(string(first), `"first"`) {
		t.Fatalf("version 1:\n%s", first)
	}
	if _, changed, err := f.docs.Save(ctx, docs.Change{Kind: docs.Process, ID: "request-gcp-project", Body: first, By: "alex@example.com"}); err != nil || !changed {
		t.Fatalf("restore: %v %v", changed, err)
	}

	// a second start finds nothing to do
	if err := upgrade.Lists(ctx, f.pool, quiet); err != nil {
		t.Fatal(err)
	}
	if _, again := f.body(t, docs.Catalog, docs.CatalogID); again.Version != 2 {
		t.Fatalf("lists converted twice: v%d", again.Version)
	}
	if _, again := f.body(t, docs.Process, "request-gcp-project"); again.Version != 4 {
		t.Fatalf("process converted twice: v%d", again.Version)
	}
	if later, _ := f.audit.Recent(ctx, 20); len(later) != len(entries) {
		t.Fatal("a second start wrote to the activity log")
	}
}

func TestSeveralServersStartingTogetherConvertOnce(t *testing.T) {
	f := oldDatabase(t)
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- db.Migrate(ctx, f.pool, func(ctx context.Context) error { return upgrade.Lists(ctx, f.pool, quiet) })
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, d := f.body(t, docs.Process, "request-gcp-project"); d.Version != 3 {
		t.Fatalf("v%d", d.Version)
	}
	entries, _ := f.audit.Recent(ctx, 50)
	n := 0
	for _, e := range entries {
		if e.Action == "content.convert" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("converted %d times", n)
	}
}

func TestNothingToConvert(t *testing.T) {
	pool := dbtest.NewPool(t)
	if err := upgrade.Lists(ctx, pool, quiet); err != nil {
		t.Fatal(err)
	}
	store := &docs.Store{Pool: pool}
	if n, _ := store.Count(ctx); n != 0 {
		t.Fatalf("an empty database got %d documents", n)
	}
	// content of this version is left as it is
	if _, _, err := store.Put(ctx, docs.Catalog, docs.CatalogID, []byte(docs.EmptyCatalog), "import"); err != nil {
		t.Fatal(err)
	}
	if err := upgrade.Lists(ctx, pool, quiet); err != nil {
		t.Fatal(err)
	}
	if d, _ := store.Get(ctx, docs.Catalog, docs.CatalogID); d.Version != 1 {
		t.Fatalf("v%d", d.Version)
	}
	// an older file without the new lists gets them, empty
	old := `{"tiers":[],"environments":[],"languages":[],"teams":[],"tools":[]}`
	store.Put(ctx, docs.Catalog, docs.CatalogID, []byte(old), "import")
	if err := upgrade.Lists(ctx, pool, quiet); err != nil {
		t.Fatal(err)
	}
	d, _ := store.Get(ctx, docs.Catalog, docs.CatalogID)
	if !strings.Contains(string(d.Body), `"teams": [],`+"\n"+`  "practices": [],`+"\n"+`  "platforms": [],`+"\n"+`  "categories": [],`+"\n"+`  "tools": []`) {
		t.Fatalf("lists:\n%s", d.Body)
	}
}
