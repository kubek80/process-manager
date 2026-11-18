package main

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/engagement"
)

func countRows(t *testing.T, st stores, table string) int {
	t.Helper()
	var n int
	if err := st.engagement.Pool.QueryRow(ctx, `select count(*) from `+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSeedEngagementFillsAnEmptySetOnce(t *testing.T) {
	st := newStores(t)
	dev := config.Config{Auth: config.AuthDev, SeedDir: filepath.Join(repo, "..")}
	if err := seed(ctx, dev, st, quiet); err != nil { // no content yet: nothing to attach samples to
		t.Fatal(err)
	}
	if empty, _ := st.engagement.Empty(ctx); !empty {
		t.Fatal("seeded without content")
	}
	if err := prepare(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := seed(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	views, upvotes, bookmarks, downloads := countRows(t, st, "document_views"), countRows(t, st, "upvotes"), countRows(t, st, "bookmarks"), countRows(t, st, "skill_downloads")
	if views < 300 || upvotes < 10 || bookmarks < 5 || downloads < 10 {
		t.Fatalf("views %d, upvotes %d, bookmarks %d, downloads %d", views, upvotes, bookmarks, downloads)
	}
	// spread over the last twelve weeks, nothing in the future
	var first, last time.Time
	if err := st.engagement.Pool.QueryRow(ctx, `select min(day)::timestamp, max(day)::timestamp from document_views`).Scan(&first, &last); err != nil {
		t.Fatal(err)
	}
	today := engagement.Day(now)
	if first.Before(today.AddDate(0, 0, -7*seedWeeks)) || first.After(today.AddDate(0, 0, -7*seedWeeks+7)) || last.After(today) {
		t.Fatalf("views from %v to %v", first, last)
	}
	var future int
	if err := st.engagement.Pool.QueryRow(ctx, `select (select count(*) from skill_downloads where at > now()) + (select count(*) from upvotes where created_at > now())`).Scan(&future); err != nil || future != 0 {
		t.Fatalf("in the future: %d %v", future, err)
	}
	// every built-in user has upvotes or bookmarks
	var users int
	if err := st.engagement.Pool.QueryRow(ctx, `select count(distinct email) from (select email from upvotes union select email from bookmarks) x where email not like 'colleague-%'`).Scan(&users); err != nil || users != 6 {
		t.Fatalf("built-in users with upvotes or bookmarks: %d %v", users, err)
	}
	list, err := st.requests.List(ctx, "sam@example.com")
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]int{}
	for _, q := range list {
		states[q.State]++
		if q.Votes == 0 {
			t.Errorf("no votes: %+v", q)
		}
		if q.State == "done" && q.LinkedID != "onboard-site-to-akamai" {
			t.Errorf("done: %+v", q)
		}
	}
	if len(list) != 5 || states["open"] != 2 || states["planned"] != 1 || states["done"] != 1 || states["declined"] != 1 {
		t.Fatalf("requests: %v", states)
	}

	// never twice
	if err := seed(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	if countRows(t, st, "document_views") != views || countRows(t, st, "requests") != 5 {
		t.Fatal("seeded twice")
	}
}

func TestSeedEngagementNeverAddsToRealUse(t *testing.T) {
	st := newStores(t)
	dev := config.Config{Auth: config.AuthDev, SeedDir: filepath.Join(repo, "..")}
	if err := prepare(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	if _, err := st.engagement.SetUpvote(ctx, "sam@example.com", "process", "request-gcp-project", true); err != nil {
		t.Fatal(err)
	}
	if err := seed(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	if countRows(t, st, "document_views") != 0 || countRows(t, st, "requests") != 0 || countRows(t, st, "upvotes") != 1 {
		t.Fatal("added to what was there")
	}
}

func TestSeedEngagementOnlyWithDevelopmentSignIn(t *testing.T) {
	st := newStores(t)
	if err := importFiles(ctx, st, filepath.Join(repo, ".."), quiet); err != nil {
		t.Fatal(err)
	}
	if err := seed(ctx, config.Config{Auth: config.AuthEntra}, st, quiet); err != nil {
		t.Fatal(err)
	}
	if empty, _ := st.engagement.Empty(ctx); !empty {
		t.Fatal("seeded with a real sign-in")
	}
	if n, _ := st.feedback.Count(ctx); n != 3 {
		t.Fatalf("the feedback samples stay as they were: %d", n)
	}
}

func TestAnExportCountsOneDownloadPerSkill(t *testing.T) {
	st := newStores(t)
	if err := importFiles(ctx, st, filepath.Join(repo, ".."), quiet); err != nil {
		t.Fatal(err)
	}
	if err := exportFiles(ctx, st, t.TempDir(), quiet); err != nil {
		t.Fatal(err)
	}
	active, _ := st.skills.ActiveCount(ctx)
	var exports, logging int
	if err := st.engagement.Pool.QueryRow(ctx, `select count(*) filter (where via = 'export'), count(*) filter (where source_id = 'secure-logging') from skill_downloads`).Scan(&exports, &logging); err != nil {
		t.Fatal(err)
	}
	if exports != active || logging != 2 {
		t.Fatalf("exports %d of %d skills; secure-logging %d (skill and review agent)", exports, active, logging)
	}
}

func TestResetAndSeedGiveTheSamplesBack(t *testing.T) {
	st := newStores(t)
	dev := config.Config{Auth: config.AuthDev, SeedDir: filepath.Join(repo, "..")}
	if err := prepare(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	if err := seed(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	views, requests := countRows(t, st, "document_views"), countRows(t, st, "requests")
	if _, err := st.engagement.SetUpvote(ctx, "someone@example.com", "process", "request-gcp-project", true); err != nil {
		t.Fatal(err)
	}
	if err := reset(ctx, st); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"feedback", "document_views", "document_counts", "bookmarks", "upvotes", "skill_downloads", "requests", "request_votes"} {
		if n := countRows(t, st, table); n != 0 {
			t.Fatalf("%s: %d left", table, n)
		}
	}
	if err := seed(ctx, dev, st, quiet); err != nil {
		t.Fatal(err)
	}
	if countRows(t, st, "document_views") != views || countRows(t, st, "requests") != requests || countRows(t, st, "feedback") != 3 {
		t.Fatal("the samples did not come back")
	}
	// the numbers kept per document match what was added
	var mismatched int
	if err := st.engagement.Pool.QueryRow(ctx, `select count(*) from document_counts c where c.views <> (select count(*) from document_views v where v.kind = c.kind and v.id = c.id)
		or c.downloads <> (select count(*) from skill_downloads d where d.source_kind = c.kind and d.source_id = c.id)`).Scan(&mismatched); err != nil || mismatched != 0 {
		t.Fatalf("numbers do not match: %d %v", mismatched, err)
	}
}
