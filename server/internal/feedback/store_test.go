package feedback_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/feedback/feedbacktest"
)

var ctx = context.Background()

func sample(step string) feedback.New {
	return feedback.New{ProcessID: "request-gcp-project", StepID: step, Kind: "broken", Text: "The form was renamed.",
		AuthorEmail: "sam@example.com", AuthorName: "Sam", StepHash: "abc123"}
}

func TestMigrateIsRepeatableAndConcurrent(t *testing.T) {
	s := feedbacktest.NewStore(t) // already migrated once
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); errs <- s.Migrate(ctx) }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*) from schema_migrations`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("migrations recorded: %d, %v", n, err)
	}
}

func TestCreateGetList(t *testing.T) {
	s := feedbacktest.NewStore(t)
	a, err := s.Create(ctx, sample("raise-request"))
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == "" || a.StepID != "raise-request" || a.StepHash != "abc123" || a.ResolvedAt != nil || a.CreatedAt.IsZero() || a.AlsoHit == nil || len(a.AlsoHit) != 0 {
		t.Fatalf("unexpected item: %+v", a)
	}
	whole := sample("")
	whole.StepHash = ""
	b, err := s.Create(ctx, whole)
	if err != nil || b.StepID != "" || b.StepHash != "" {
		t.Fatalf("process-level item: %+v %v", b, err)
	}
	got, err := s.Get(ctx, a.ID)
	if err != nil || got.Text != "The form was renamed." || got.AuthorName != "Sam" {
		t.Fatalf("get: %+v %v", got, err)
	}
	list, err := s.List(ctx)
	if err != nil || len(list) != 2 || list[0].ID != a.ID || list[1].ID != b.ID {
		t.Fatalf("list must be oldest first: %+v %v", list, err)
	}
	if n, _ := s.Count(ctx); n != 2 {
		t.Fatalf("count: %d", n)
	}
}

func TestCreateRejectsUnknownKind(t *testing.T) {
	s := feedbacktest.NewStore(t)
	bad := sample("x")
	bad.Kind = "rant"
	if _, err := s.Create(ctx, bad); err == nil || !strings.Contains(err.Error(), "check") {
		t.Fatalf("the database must refuse an unknown kind, got %v", err)
	}
	if !feedback.ValidKind("idea") || feedback.ValidKind("rant") {
		t.Fatal("ValidKind is wrong")
	}
}

func TestNotFound(t *testing.T) {
	s := feedbacktest.NewStore(t)
	for _, id := range []string{"", "nope", "'; drop table feedback; --", "00000000-0000-0000-0000-000000000000"} {
		if _, err := s.Get(ctx, id); !errors.Is(err, feedback.ErrNotFound) {
			t.Errorf("Get(%q): %v", id, err)
		}
		if _, err := s.SetResolved(ctx, id, true, "x"); !errors.Is(err, feedback.ErrNotFound) {
			t.Errorf("SetResolved(%q): %v", id, err)
		}
		if _, err := s.SetAlsoHit(ctx, id, "a@b.c", true); !errors.Is(err, feedback.ErrNotFound) {
			t.Errorf("SetAlsoHit(%q): %v", id, err)
		}
		if err := s.Delete(ctx, id); !errors.Is(err, feedback.ErrNotFound) {
			t.Errorf("Delete(%q): %v", id, err)
		}
	}
}

func TestAlsoHitIsIdempotentPerPerson(t *testing.T) {
	s := feedbacktest.NewStore(t)
	it, _ := s.Create(ctx, sample("raise-request"))
	for i := 0; i < 3; i++ {
		if _, err := s.SetAlsoHit(ctx, it.ID, "kim@example.com", true); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.SetAlsoHit(ctx, it.ID, "lee@example.com", true)
	if err != nil || strings.Join(got.AlsoHit, ",") != "kim@example.com,lee@example.com" {
		t.Fatalf("got %v %v", got.AlsoHit, err)
	}
	got, _ = s.SetAlsoHit(ctx, it.ID, "kim@example.com", false)
	got, _ = s.SetAlsoHit(ctx, it.ID, "kim@example.com", false)
	if strings.Join(got.AlsoHit, ",") != "lee@example.com" {
		t.Fatalf("got %v", got.AlsoHit)
	}
}

func TestResolveAndReopen(t *testing.T) {
	s := feedbacktest.NewStore(t)
	it, _ := s.Create(ctx, sample("raise-request"))
	done, err := s.SetResolved(ctx, it.ID, true, "casey@example.com")
	if err != nil || done.ResolvedAt == nil || done.ResolvedBy != "casey@example.com" {
		t.Fatalf("resolve: %+v %v", done, err)
	}
	again, _ := s.SetResolved(ctx, it.ID, true, "alex@example.com")
	if again.ResolvedBy != "casey@example.com" || !again.ResolvedAt.Equal(*done.ResolvedAt) {
		t.Fatalf("resolving twice must keep the first resolution: %+v", again)
	}
	open, err := s.SetResolved(ctx, it.ID, false, "")
	if err != nil || open.ResolvedAt != nil || open.ResolvedBy != "" {
		t.Fatalf("reopen: %+v %v", open, err)
	}
}

func TestDeleteRemovesAlsoHitRows(t *testing.T) {
	s := feedbacktest.NewStore(t)
	it, _ := s.Create(ctx, sample("raise-request"))
	s.SetAlsoHit(ctx, it.ID, "kim@example.com", true)
	if err := s.Delete(ctx, it.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	s.Pool.QueryRow(ctx, `select count(*) from feedback_also_hit`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d also-hit rows left behind", n)
	}
}

func TestDeleteByProcessAndReset(t *testing.T) {
	s := feedbacktest.NewStore(t)
	s.Create(ctx, sample("a"))
	s.Create(ctx, sample("b"))
	other := sample("c")
	other.ProcessID = "request-repository"
	keep, _ := s.Create(ctx, other)
	if err := s.DeleteByProcess(ctx, "request-gcp-project"); err != nil {
		t.Fatal(err)
	}
	list, _ := s.List(ctx)
	if len(list) != 1 || list[0].ID != keep.ID {
		t.Fatalf("got %+v", list)
	}
	if err := s.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.Count(ctx); n != 0 {
		t.Fatalf("reset left %d items", n)
	}
}
