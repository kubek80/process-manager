package engagement

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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

// store returns a store on a fresh database with a process "p" and a standard "s".
func store(t *testing.T) *Store {
	t.Helper()
	pool := dbtest.NewPool(t)
	for _, d := range [][3]string{{Process, "p", `{"id": "p", "owner": "team-a", "platform": "cloud"}`}, {Standard, "s", `{"id": "s", "status": "draft", "practice": "security"}`}} {
		if _, err := pool.Exec(ctx, `insert into documents (kind, id, version, body, updated_by) values ($1, $2, 1, $3, 'test')`, d[0], d[1], d[2]); err != nil {
			t.Fatal(err)
		}
	}
	return &Store{Pool: pool}
}

func deleteDoc(t *testing.T, pool *pgxpool.Pool, kind, id string) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `delete from documents where kind = $1 and id = $2`, kind, id); err != nil {
		t.Fatal(err)
	}
	if err := DeleteByTargetIn(ctx, tx, kind, id); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestViewsBookmarksUpvotesAndDownloads(t *testing.T) {
	s := store(t)
	if empty, err := s.Empty(ctx); err != nil || !empty {
		t.Fatalf("a new database is empty: %v %v", empty, err)
	}
	now := time.Now()
	for i, v := range []struct {
		email         string
		at            time.Time
		views, people int
	}{
		{"Sam@Example.com ", now, 1, 1},
		{"sam@example.com", now, 1, 1}, // the same day: nothing new
		{"alex@example.com", now, 2, 2},
		{"sam@example.com", now.AddDate(0, 0, -1), 3, 2}, // another day: a view, not a new person
	} {
		views, people, err := s.RecordView(ctx, Process, "p", v.email, v.at)
		if err != nil || views != v.views || people != v.people {
			t.Fatalf("view %d: %d %d %v", i, views, people, err)
		}
	}
	if _, _, err := s.RecordView(ctx, Process, "nope", "sam@example.com", now); !errors.Is(err, ErrNoDocument) {
		t.Fatalf("a view of nothing: %v", err)
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
	// downloads: once per person, skill and day; an export every time
	for i, d := range []struct {
		skill, email, via string
		at                time.Time
		counted           bool
	}{
		{"review-s", "sam@example.com", ViaDownload, now, true},
		{"review-s", "SAM@example.com", ViaDownload, now, false},
		{"standard-s", "sam@example.com", ViaDownload, now, true},
		{"review-s", "sam@example.com", ViaDownload, now.AddDate(0, 0, -1), true},
		{"review-s", "alex@example.com", ViaDownload, now, true},
		{"review-s", "", ViaExport, now, true},
		{"review-s", "", ViaExport, now, true},
	} {
		counted, err := s.CountDownload(ctx, d.skill, Standard, "s", d.email, d.via, d.at)
		if err != nil || counted != d.counted {
			t.Fatalf("download %d: %v %v", i, counted, err)
		}
	}
	if counted, err := s.CountDownload(ctx, "x", Process, "gone", "a@example.com", ViaDownload, now); counted || !errors.Is(err, ErrNoDocument) {
		t.Fatalf("download of nothing: %v %v", counted, err)
	}
	if empty, _ := s.Empty(ctx); empty {
		t.Fatal("not empty any more")
	}
	counts, err := s.Counts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if c := counts[Key{Process, "p"}]; c.Views != 3 || c.People != 2 {
		t.Fatalf("process: %+v", c)
	}
	if c := counts[Key{Standard, "s"}]; c.Upvotes != 1 || c.Downloads != 6 {
		t.Fatalf("standard: %+v", c)
	}
	bookmarks, upvotes, err := s.Mine(ctx, "SAM@EXAMPLE.COM")
	if err != nil || len(bookmarks) != 1 || len(upvotes) != 1 || upvotes[0] != (Ref{Standard, "s"}) {
		t.Fatalf("%v %v %v", bookmarks, upvotes, err)
	}
	drafts, err := s.Drafts(ctx)
	if err != nil || len(drafts) != 1 || drafts[0] != (Draft{Key{Standard, "s"}, "", "", "security"}) {
		t.Fatalf("drafts: %+v %v", drafts, err)
	}

	// deleted: bookmarks, votes and numbers go, views and downloads stay in the totals only
	deleteDoc(t, s.Pool, Process, "p")
	deleteDoc(t, s.Pool, Standard, "s")
	counts, _ = s.Counts(ctx)
	if len(counts) != 0 {
		t.Fatalf("still counted: %+v", counts)
	}
	p, err := s.PeriodFrom(ctx, now.AddDate(0, 0, -6), now)
	if err != nil {
		t.Fatal(err)
	}
	if p.Views != 3 || p.People != 2 || p.Downloads != 6 || p.DeletedViews != 3 || p.DeletedDownloads != 6 || len(p.Docs) != 0 {
		t.Fatalf("period: %+v", p)
	}
	// a new document under the same id is counted from scratch, the same day
	if _, err := s.Pool.Exec(ctx, `insert into documents (kind, id, version, body, updated_by) values ('process', 'p', 3, '{}', 'test')`); err != nil {
		t.Fatal(err)
	}
	if views, people, err := s.RecordView(ctx, Process, "p", "sam@example.com", now); err != nil || views != 1 || people != 1 {
		t.Fatalf("new document: %d %d %v", views, people, err)
	}
}

func TestAPersonIsCountedOnceEvenAtTheSameMoment(t *testing.T) {
	s := store(t)
	now := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			// the same person on several days at once, and others
			email := "sam@example.com"
			if i%2 == 1 {
				email = fmt.Sprintf("p%d@example.com", i)
			}
			if _, _, err := s.RecordView(ctx, Process, "p", email, now.AddDate(0, 0, -i)); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	views, people, _ := s.ViewCounts(ctx, Process, "p")
	if views != 20 || people != 11 {
		t.Fatalf("views %d, people %d", views, people)
	}
}

func TestThePeriodIsAggregatedInTheDatabase(t *testing.T) {
	s := store(t)
	now := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC) // a Wednesday
	if _, err := s.Pool.Exec(ctx, `insert into documents (kind, id, version, body, updated_by) values ('process', 'q', 1, '{"owner": "team-a"}', 'test')`); err != nil {
		t.Fatal(err)
	}
	for _, v := range []struct {
		id, email string
		days      int
	}{{"p", "a", 0}, {"p", "b", 0}, {"q", "a", 1}, {"q", "c", 8}, {"p", "a", 30}} {
		if _, _, err := s.RecordView(ctx, Process, v.id, v.email+"@example.com", now.AddDate(0, 0, -v.days)); err != nil {
			t.Fatal(err)
		}
	}
	p, err := s.PeriodFrom(ctx, now.AddDate(0, 0, -9), now) // Monday 9 November to today
	if err != nil {
		t.Fatal(err)
	}
	if p.Views != 4 || p.People != 3 || p.Docs[Key{Process, "p"}].People != 2 || p.Docs[Key{Process, "q"}].Views != 2 {
		t.Fatalf("%+v", p)
	}
	if g := p.Groups["platform"]["cloud"]; g == nil || g.Views != 2 || g.People != 2 {
		t.Fatalf("platform: %+v", g)
	}
	if g := p.Groups["platform"][""]; g == nil || g.Views != 2 || g.People != 2 {
		t.Fatalf("no platform: %+v", g)
	}
	if g := p.Groups["team"]["team-a"]; g == nil || g.Views != 4 || g.People != 3 {
		t.Fatalf("team: %+v", g)
	}
	// 9 November is a Monday: two whole weeks... the second one only up to today
	if len(p.Weeks) != 2 || p.Weeks[0].Days != 7 || p.Weeks[1].Days != 3 || p.Weeks[0].Views != 1 || p.Weeks[1].Views != 3 {
		t.Fatalf("weeks: %+v", p.Weeks)
	}
	p, _ = s.PeriodFrom(ctx, now.AddDate(0, 0, -6), now) // Thursday 12 November
	if len(p.Weeks) != 2 || p.Weeks[0].Days != 4 || p.Weeks[1].Days != 3 {
		t.Fatalf("partial weeks: %+v", p.Weeks)
	}
}

func TestEarliest(t *testing.T) {
	s := store(t)
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	if d, err := s.Earliest(ctx, now); err != nil || d.Format("2006-01-02") != "2026-11-17" {
		t.Fatalf("nothing recorded: %v %v", d, err)
	}
	if _, err := s.CountDownload(ctx, "x", Process, "p", "", ViaExport, now.AddDate(0, -2, 0)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.RecordView(ctx, Process, "p", "a@example.com", now.AddDate(0, -1, 0)); err != nil {
		t.Fatal(err)
	}
	if d, _ := s.Earliest(ctx, now); d.Format("2006-01-02") != "2026-09-17" {
		t.Fatalf("earliest: %v", d)
	}
}

func TestReset(t *testing.T) {
	s := store(t)
	if _, _, err := s.RecordView(ctx, Process, "p", "a@example.com", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := s.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if empty, _ := s.Empty(ctx); !empty {
		t.Fatal("not empty")
	}
	if counts, _ := s.Counts(ctx); len(counts) != 0 {
		t.Fatalf("numbers left: %v", counts)
	}
}
