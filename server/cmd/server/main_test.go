package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/content"
	"github.com/kubek80/process-manager/server/internal/feedback/feedbacktest"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestSeedFeedbackOnlyFillsAnEmptyDatabaseAndSkipsMissingProcesses(t *testing.T) {
	ctx := context.Background()
	store := feedbacktest.NewStore(t)
	files := &content.Store{Dir: t.TempDir()}

	// no processes on disk: nothing to attach samples to
	if err := seedFeedback(ctx, store, files, quiet); err != nil {
		t.Fatal(err)
	}
	if n, _ := store.Count(ctx); n != 0 {
		t.Fatalf("seeded %d items without processes", n)
	}

	if err := files.PutProcess("request-gcp-project", []byte(`{"id":"request-gcp-project","title":"GCP","steps":[{"id":"raise-request","title":"Raise"}]}`)); err != nil {
		t.Fatal(err)
	}
	if err := seedFeedback(ctx, store, files, quiet); err != nil {
		t.Fatal(err)
	}
	items, _ := store.List(ctx)
	if len(items) != 1 || items[0].StepID != "raise-request" || items[0].StepHash == "" {
		t.Fatalf("got %+v", items)
	}
	// running again must not duplicate
	if err := seedFeedback(ctx, store, files, quiet); err != nil {
		t.Fatal(err)
	}
	if n, _ := store.Count(ctx); n != 1 {
		t.Fatalf("seeding twice left %d items", n)
	}
}

func TestRunRefusesBadConfiguration(t *testing.T) {
	t.Setenv("PM_AUTH", "")
	t.Setenv("DATABASE_URL", "")
	err := run(quiet, false, false)
	if err == nil || !strings.Contains(err.Error(), "PM_AUTH is required") || !strings.Contains(err.Error(), "DATABASE_URL is required") {
		t.Fatalf("got %v", err)
	}
}

func TestConnectReportsAnUnusableAddress(t *testing.T) {
	if _, err := connect(context.Background(), "not a url", quiet); err == nil || !strings.Contains(err.Error(), "database address") {
		t.Fatalf("got %v", err)
	}
}

func TestResetDeletesAndExits(t *testing.T) {
	store := feedbacktest.NewStore(t) // skips when no database is available
	_ = store
	t.Setenv("PM_AUTH", "dev")
	t.Setenv("DATABASE_URL", feedbacktest.URL())
	t.Setenv("PM_CONTENT_DIR", t.TempDir())
	if err := run(quiet, false, true); err != nil {
		t.Fatalf("reset run: %v", err)
	}
}
