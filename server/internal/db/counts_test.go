package db_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
)

// A database of the version before the numbers kept per document: the migration fills them from
// the views and downloads that were recorded, gives old downloads a day, and leaves deleted
// documents out.
func TestTheCountsAreFilledFromWhatWasRecorded(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewEmptyPool(t)
	if _, err := pool.Exec(ctx, `create table schema_migrations (version int primary key, applied_at timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	files, _ := filepath.Glob("migrations/00[1-5]_*.sql")
	if len(files) != 5 {
		t.Fatalf("migrations: %v", files)
	}
	for i, f := range files {
		sql, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		if _, err := pool.Exec(ctx, `insert into schema_migrations (version) values ($1)`, i+1); err != nil {
			t.Fatal(err)
		}
	}
	for _, sql := range []string{
		`insert into documents (kind, id, version, body, updated_by) values ('process', 'p', 1, '{"status": "draft", "owner": "t"}', 'x')`,
		`insert into document_views (kind, id, day, email) values ('process', 'p', '2026-11-01', 'a'), ('process', 'p', '2026-11-02', 'a'),
			('process', 'p', '2026-11-02', 'b'), ('process', 'p@deleted-1', '2026-11-01', 'a')`,
		`insert into skill_downloads (skill_id, source_kind, source_id, via, at) values ('process-p', 'process', 'p', 'download', '2026-11-02 23:30+00'),
			('process-p', 'process', 'p', 'download', '2026-11-02 23:40+00'), ('process-p', 'process', 'p@deleted-1', 'export', now())`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var views, people, downloads int
	if err := pool.QueryRow(ctx, `select views, people, downloads from document_counts where kind = 'process' and id = 'p'`).Scan(&views, &people, &downloads); err != nil {
		t.Fatal(err)
	}
	if views != 3 || people != 2 || downloads != 2 {
		t.Fatalf("views %d, people %d, downloads %d", views, people, downloads)
	}
	var rows, days int
	var status, owner string
	pool.QueryRow(ctx, `select count(*), count(*) filter (where day = '2026-11-02') from skill_downloads`).Scan(&rows, &days)
	pool.QueryRow(ctx, `select status, owner from documents`).Scan(&status, &owner)
	if rows != 3 || days != 2 || status != "draft" || owner != "t" {
		t.Fatalf("downloads %d (%d on the day), status %q, owner %q", rows, days, status, owner)
	}
}
