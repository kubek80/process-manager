package main

import (
	"bytes"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// runMigrate runs `server -migrate` against the schema of pool, as an operator would, with the
// development sign-in and a seed folder full of sample content, and returns what it printed.
func runMigrate(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var schemaName string
	if err := pool.QueryRow(ctx, `select current_schema()`).Scan(&schemaName); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", withSchema(schemaName))
	t.Setenv("PM_AUTH", "dev")
	t.Setenv("PM_SEED_DIR", "../../..") // the sample content: -migrate must not import it
	var out bytes.Buffer
	stdout = &out
	t.Cleanup(func() { stdout = nil })
	if err := run(quiet, options{migrate: true}); err != nil {
		t.Fatalf("-migrate: %v\n%s", err, out.String())
	}
	return out.String()
}

// withSchema is the address of the test database with the tables of one test.
func withSchema(name string) string {
	sep := "?"
	if strings.Contains(dbtest.URL(), "?") {
		sep = "&"
	}
	return dbtest.URL() + sep + "search_path=" + name
}

func storesOf(pool *pgxpool.Pool) stores {
	return stores{docs: &docs.Store{Pool: pool}, roles: &rbac.Store{Pool: pool}}
}

func TestMigrateOnAnEmptyDatabaseCreatesTheTablesAndImportsNothing(t *testing.T) {
	pool := dbtest.NewEmptyPool(t)
	out := runMigrate(t, pool)
	for _, want := range []string{
		"Tables:  12 applied: 001_feedback.sql, 002_content_roles_skills.sql, 003_version_notes_sessions.sql, 004_platform_practice_owners.sql, 005_engagement_requests.sql, 006_counts_and_limits.sql, 007_working_drafts.sql, 008_icons.sql, 009_draft_names.sql, 010_portal_settings.sql, 011_platform_practice_members.sql, 012_version_changes_by.sql\n",
		"Content: nothing to convert: the content already fits this version\n",
		"Skills:  already up to date\n",
		"Done.\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("output lacks %q:\n%s", want, out)
		}
	}
	st := storesOf(pool)
	if n, err := st.docs.Count(ctx); err != nil || n != 0 {
		t.Fatalf("documents: %d, %v", n, err)
	}
	if n, err := st.roles.Count(ctx); err != nil || n != 0 {
		t.Fatalf("development roles were given: %d, %v", n, err)
	}

	// a second run has nothing to do
	again := runMigrate(t, pool)
	if !strings.Contains(again, "Tables:  already up to date\n") || !strings.HasSuffix(again, "Nothing to do: the database was already up to date.\n") {
		t.Fatalf("second run:\n%s", again)
	}
}

const oldLists = `{"tiers":[],"environments":[],"languages":[],
"teams":[{"id":"cloud-platform-team","name":"Cloud Platform team","kind":"platform"},{"id":"dns-team","name":"DNS team","kind":"team"}],
"tools":[]}`

func oldProcess(id, owner, category string) string {
	return `{"schemaVersion":"1.0","id":"` + id + `","title":"` + id + `","summary":"Something people need to get done.","owner":"` + owner + `","category":"` + category + `",` +
		`"prerequisites":[],"actors":[{"id":"me","name":"You"}],"steps":[{"id":"do","title":"Do it","actor":"me","type":"task","next":[]}]}`
}

func TestMigrateConvertsAnOlderDatabaseAndReportsIt(t *testing.T) {
	pool := dbtest.NewPool(t)
	st := storesOf(pool)
	for _, d := range [][3]string{
		{docs.Catalog, docs.CatalogID, oldLists},
		{docs.Process, "request-gcp-project", oldProcess("request-gcp-project", "cloud-platform-team", "Cloud")},
		{docs.Process, "request-gcp-project", oldProcess("request-gcp-project", "cloud-platform-team", "cloud")},
		{docs.Process, "request-dns-record", oldProcess("request-dns-record", "dns-team", "Network")},
	} {
		if _, _, err := st.docs.Put(ctx, d[0], d[1], []byte(d[2]), "import"); err != nil {
			t.Fatal(err)
		}
	}
	// roles the earlier version allowed: a standards editor limited to one unit
	for _, r := range [][2]string{{"kim@example.com", "cloud-platform-team"}, {"lee@example.com", "dns-team"}} {
		if _, err := pool.Exec(ctx, `insert into role_assignments (email, role, scope, granted_by) values ($1, 'standards-editor', $2, 'dana@example.com')`, r[0], r[1]); err != nil {
			t.Fatal(err)
		}
	}

	out := runMigrate(t, pool)
	want := "Database migration\n" +
		"  Tables:  already up to date\n" +
		"  Content: 2 documents moved to the new lists (3 older versions adjusted); added 1 platforms, 2 categories; 1 roles converted, 1 removed; added the list of paths with 3 entries; the lists were updated\n" +
		"  Skills:  2 regenerated\n" +
		"Done.\n"
	if out != want {
		t.Fatalf("output:\n%s\nwant:\n%s", out, want)
	}
	if d, _ := st.docs.Get(ctx, docs.Process, "request-gcp-project"); !strings.Contains(string(d.Body), `"platform": "cloud-platform-team"`) {
		t.Fatalf("not converted:\n%s", d.Body)
	}
	all, _ := st.roles.All(ctx)
	if len(all) != 1 || all[0].Email != "kim@example.com" || all[0].Role != rbac.PlatformOwner {
		t.Fatalf("roles (and no development roles): %+v", all)
	}
	if n, _ := st.docs.Count(ctx); n != 3 {
		t.Fatalf("the seed folder was imported: %d documents", n)
	}

	again := runMigrate(t, pool)
	want = "Database migration\n" +
		"  Tables:  already up to date\n" +
		"  Content: nothing to convert: the content already fits this version\n" +
		"  Skills:  already up to date\n" +
		"Nothing to do: the database was already up to date.\n"
	if again != want {
		t.Fatalf("second run:\n%s", again)
	}
}

// -migrate while a server starts, or twice at once: the conversion runs once, under the lock of
// the migrations, and the other run finds nothing to convert.
func TestMigrateTwiceAtOnceConvertsOnce(t *testing.T) {
	pool := dbtest.NewPool(t)
	st := stores{docs: &docs.Store{Pool: pool}, roles: &rbac.Store{Pool: pool}, skills: &skills.Store{Pool: pool}}
	if _, _, err := st.docs.Put(ctx, docs.Catalog, docs.CatalogID, []byte(oldLists), "import"); err != nil {
		t.Fatal(err)
	}
	outs := make([]bytes.Buffer, 3)
	var wg sync.WaitGroup
	for i := range outs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := migrateCommand(ctx, pool, st, quiet, &outs[i]); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	converted := 0
	for i := range outs {
		if strings.Contains(outs[i].String(), "the lists were updated") {
			converted++
		} else if !strings.Contains(outs[i].String(), "Content: nothing to convert") {
			t.Errorf("output:\n%s", outs[i].String())
		}
	}
	if d, _ := st.docs.Get(ctx, docs.Catalog, docs.CatalogID); converted != 1 || d.Version != 2 {
		t.Fatalf("converted %d times, lists v%d", converted, d.Version)
	}
}

func TestMigrateFailsWithTheReason(t *testing.T) {
	pool := dbtest.NewPool(t)
	// lists that are not a JSON object cannot be converted
	if _, err := pool.Exec(ctx, `insert into documents (kind, id, version, body, updated_by) values ('catalog', 'catalog', 1, '[1]', 'x')`); err != nil {
		t.Fatal(err)
	}
	var schemaName string
	if err := pool.QueryRow(ctx, `select current_schema()`).Scan(&schemaName); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", withSchema(schemaName))
	t.Setenv("PM_AUTH", "dev")
	var out bytes.Buffer
	stdout = &out
	t.Cleanup(func() { stdout = nil })
	err := run(quiet, options{migrate: true})
	if err == nil || !strings.HasPrefix(err.Error(), "migration failed: database setup: the lists:") || out.Len() != 0 {
		t.Fatalf("error: %v, printed %q", err, out.String())
	}
}
