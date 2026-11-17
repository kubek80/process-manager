package engagement

import (
	"context"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
)

var ctx = context.Background()

func TestDayAndMondayAreUTC(t *testing.T) {
	berlin := time.FixedZone("CET", 3600)
	// half past midnight in Berlin on a Monday is still Sunday in UTC
	at := time.Date(2026, 11, 16, 0, 30, 0, 0, berlin)
	if got := Day(at).Format("2006-01-02"); got != "2026-11-15" {
		t.Fatalf("day: %s", got)
	}
	if got := Monday(at).Format("2006-01-02"); got != "2026-11-09" {
		t.Fatalf("monday: %s", got)
	}
	if got := Monday(time.Date(2026, 11, 16, 12, 0, 0, 0, time.UTC)).Format("2006-01-02"); got != "2026-11-16" {
		t.Fatalf("a Monday is its own week: %s", got)
	}
}

func TestViewsBookmarksUpvotesAndDownloads(t *testing.T) {
	s := &Store{Pool: dbtest.NewPool(t)}
	if empty, err := s.Empty(ctx); err != nil || !empty {
		t.Fatalf("a new database is empty: %v %v", empty, err)
	}
	now := time.Now()
	for _, email := range []string{"Sam@Example.com ", "sam@example.com", "alex@example.com"} {
		if err := s.RecordView(ctx, Process, "p", email, now); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RecordView(ctx, Process, "p", "sam@example.com", now.AddDate(0, 0, -1)); err != nil {
		t.Fatal(err)
	}
	if n, err := s.SetUpvote(ctx, "SAM@example.com", Standard, "s", true); err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	if n, _ := s.SetUpvote(ctx, "sam@example.com", Standard, "s", true); n != 1 {
		t.Fatalf("twice: %d", n)
	}
	if err := s.SetBookmark(ctx, "Sam@example.com", Process, "p", true); err != nil {
		t.Fatal(err)
	}
	if err := s.CountDownload(ctx, "review-s", Standard, "s", ViaDownload, now); err != nil {
		t.Fatal(err)
	}
	if empty, _ := s.Empty(ctx); empty {
		t.Fatal("not empty any more")
	}
	counts, err := s.Counts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if c := counts[Key{Process, "p"}]; c == nil || c.Views != 3 || c.People != 2 {
		t.Fatalf("process: %+v", c)
	}
	if c := counts[Key{Standard, "s"}]; c == nil || c.Upvotes != 1 || c.Downloads != 1 {
		t.Fatalf("standard: %+v", c)
	}
	bookmarks, upvotes, err := s.Mine(ctx, "SAM@EXAMPLE.COM")
	if err != nil || len(bookmarks) != 1 || len(upvotes) != 1 || upvotes[0] != (Ref{Standard, "s"}) {
		t.Fatalf("%v %v %v", bookmarks, upvotes, err)
	}

	// deleted: bookmarks and votes go, views and downloads stay in the totals only
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := DeleteByTargetIn(ctx, tx, Process, "p"); err != nil {
		t.Fatal(err)
	}
	if err := DeleteByTargetIn(ctx, tx, Standard, "s"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	counts, _ = s.Counts(ctx)
	if counts[Key{Process, "p"}] != nil || counts[Key{Standard, "s"}] != nil {
		t.Fatalf("still counted: %+v", counts)
	}
	p, err := s.PeriodFrom(ctx, now.AddDate(0, 0, -6))
	if err != nil {
		t.Fatal(err)
	}
	if p.Views != 3 || p.People != 2 || p.Downloads != 1 || p.Docs[Key{Process, "p"}] != nil {
		t.Fatalf("period: %+v", p)
	}
	// a new document under the same id is counted from scratch, the same day
	if err := s.RecordView(ctx, Process, "p", "sam@example.com", now); err != nil {
		t.Fatal(err)
	}
	counts, _ = s.Counts(ctx)
	if c := counts[Key{Process, "p"}]; c == nil || c.Views != 1 {
		t.Fatalf("new document: %+v", c)
	}
}

func TestEarliest(t *testing.T) {
	s := &Store{Pool: dbtest.NewPool(t)}
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	if d, err := s.Earliest(ctx, now); err != nil || d.Format("2006-01-02") != "2026-11-17" {
		t.Fatalf("nothing recorded: %v %v", d, err)
	}
	if err := s.CountDownload(ctx, "x", Process, "p", ViaExport, now.AddDate(0, -2, 0)); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordView(ctx, Process, "p", "a@example.com", now.AddDate(0, -1, 0)); err != nil {
		t.Fatal(err)
	}
	if d, _ := s.Earliest(ctx, now); d.Format("2006-01-02") != "2026-09-17" {
		t.Fatalf("earliest: %v", d)
	}
}
