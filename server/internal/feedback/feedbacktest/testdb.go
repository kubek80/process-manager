// Package feedbacktest gives tests a feedback store on a real Postgres database.
// Every test gets its own schema, so tests can run in parallel and leave nothing behind.
package feedbacktest

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/feedback"
)

var counter atomic.Int64

// URL is the database tests run against.
func URL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	return "postgres://pm:pm@localhost:54329/pm_test?sslmode=disable"
}

// NewStore returns a migrated store in a fresh schema. Without a reachable database the test
// is skipped locally and fails in CI, so a green CI run always includes the database tests.
func NewStore(t testing.TB) *feedback.Store {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, URL())
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("test database not reachable at %s: %v", URL(), err)
		}
		t.Skipf("test database not reachable (%v). Start it with `docker compose up -d db` or set TEST_DATABASE_URL.", err)
	}
	schema := fmt.Sprintf("t_%d_%d", os.Getpid(), counter.Add(1))
	if _, err := admin.Exec(ctx, "create schema "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(URL())
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "drop schema "+schema+" cascade")
		_ = admin.Close(context.Background())
	})
	store := &feedback.Store{Pool: pool}
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return store
}
