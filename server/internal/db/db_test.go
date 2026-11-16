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
	if err := pool.QueryRow(ctx, `select count(*) from schema_migrations`).Scan(&n); err != nil || n != 3 {
		t.Fatalf("migrations recorded: %d, %v", n, err)
	}
	for _, table := range []string{"feedback", "feedback_also_hit", "documents", "document_versions", "role_assignments", "audit_log", "skills", "skill_versions", "signed_out"} {
		if _, err := pool.Exec(ctx, "select 1 from "+table+" limit 1"); err != nil {
			t.Errorf("table %s: %v", table, err)
		}
	}
}

// Several instances of the server start at the same moment on a database that has never been
// used: all of them must come up, and every migration must have run exactly once.
func TestMigrateOnAnEmptyDatabaseFromSeveralInstances(t *testing.T) {
	ctx := context.Background()
	for round := 0; round < 3; round++ {
		pool := dbtest.NewEmptyPool(t)
		var wg sync.WaitGroup
		errs := make(chan error, 6)
		for i := 0; i < 6; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); errs <- db.Migrate(ctx, pool) }()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatalf("round %d: %v", round, err)
			}
		}
		var n int
		if err := pool.QueryRow(ctx, `select count(*) from schema_migrations`).Scan(&n); err != nil || n != 3 {
			t.Fatalf("round %d: migrations recorded: %d, %v", round, n, err)
		}
	}
}

func TestWithLockLetsOneInAtATime(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.NewPool(t)
	var mu sync.Mutex
	inside, most := 0, 0
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := db.WithLock(ctx, pool, 99001, func() error {
				mu.Lock()
				inside++
				if inside > most {
					most = inside
				}
				mu.Unlock()
				_, err := pool.Exec(ctx, `select pg_sleep(0.02)`)
				mu.Lock()
				inside--
				mu.Unlock()
				return err
			})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if most != 1 {
		t.Fatalf("%d were inside at the same time", most)
	}
}
