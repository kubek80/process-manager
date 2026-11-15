package db_test

import (
	"context"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
)

func TestMigrateIsRepeatableAndConcurrent(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewPool(t) // already migrated once
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- db.Migrate(ctx, pool) }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `select count(*) from schema_migrations`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("migrations recorded: %d, %v", n, err)
	}
	for _, table := range []string{"feedback", "feedback_also_hit", "documents", "document_versions", "role_assignments", "audit_log", "skills", "skill_versions"} {
		if _, err := pool.Exec(ctx, "select 1 from "+table+" limit 1"); err != nil {
			t.Errorf("table %s: %v", table, err)
		}
	}
}
