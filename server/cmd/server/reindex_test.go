package main

import (
	"bytes"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
)

// runWith runs the server with options against the schema of pool, with search by meaning on
// (the built-in embedder), and returns what it printed.
func runWith(t *testing.T, pool *pgxpool.Pool, o options) (string, error) {
	t.Helper()
	var schemaName string
	if err := pool.QueryRow(ctx, `select current_schema()`).Scan(&schemaName); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", withSchema(schemaName))
	t.Setenv("PM_AUTH", "dev")
	t.Setenv("PM_SEED_DIR", "../../..")
	t.Setenv("PM_EMBEDDINGS", "builtin")
	var out bytes.Buffer
	stdout = &out
	t.Cleanup(func() { stdout = nil })
	err := run(quiet, o)
	return out.String(), err
}

func filledPool(t *testing.T) *pgxpool.Pool {
	pool := dbtest.NewPool(t)
	if _, problems, err := (&docs.Store{Pool: pool}).ImportDir(ctx, "../../..", "import", nil); err != nil || len(problems) > 0 {
		t.Fatalf("import: %v %v", problems, err)
	}
	return pool
}

var embeddedLine = regexp.MustCompile(`^Search index \(builtin\)\n  10 documents, (\d+) parts embedded, 0 unchanged, 0 removed\nDone\.\n$`)

func TestReindex(t *testing.T) {
	pool := filledPool(t)
	out, err := runWith(t, pool, options{reindex: true})
	m := embeddedLine.FindStringSubmatch(out)
	if err != nil || m == nil || m[1] == "0" {
		t.Fatalf("first run: %v\n%s", err, out)
	}
	// nothing changed: nothing embedded
	out, err = runWith(t, pool, options{reindex: true})
	if err != nil || out != "Search index (builtin)\n  10 documents, 0 parts embedded, "+m[1]+" unchanged, 0 removed\nDone.\n" {
		t.Fatalf("second run: %v\n%s", err, out)
	}
	// a deleted document loses its parts
	if err := (&docs.Store{Pool: pool}).Delete(ctx, docs.Process, "request-gcp-project", "test"); err != nil {
		t.Fatal(err)
	}
	out, err = runWith(t, pool, options{reindex: true})
	if err != nil || !strings.Contains(out, "parts embedded, ") || strings.Contains(out, " 0 removed") {
		t.Fatalf("after a delete: %v\n%s", err, out)
	}

	// switched off: nothing to rebuild
	t.Setenv("PM_EMBEDDINGS", "off")
	if err := run(quiet, options{reindex: true}); err == nil || !strings.Contains(err.Error(), "search by meaning is switched off") {
		t.Fatalf("switched off: %v", err)
	}
}

func TestMigrateBringsTheSearchIndexUpToDate(t *testing.T) {
	pool := filledPool(t)
	out, err := runWith(t, pool, options{migrate: true})
	if err != nil || !regexp.MustCompile(`\n  Search:  10 documents, \d+ parts embedded, 0 unchanged, 0 removed\nDone\.\n$`).MatchString(out) {
		t.Fatalf("first run: %v\n%s", err, out)
	}
	out, err = runWith(t, pool, options{migrate: true})
	if err != nil || !strings.HasSuffix(out, "  Search:  already up to date\nNothing to do: the database was already up to date.\n") {
		t.Fatalf("second run: %v\n%s", err, out)
	}
}

func TestImportBringsTheSearchIndexUpToDate(t *testing.T) {
	pool := dbtest.NewPool(t)
	if _, err := runWith(t, pool, options{importDir: "../../.."}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `select count(distinct doc_id) from search_chunks`).Scan(&n); err != nil || n != 10 {
		t.Fatalf("indexed documents: %d %v", n, err)
	}
}
