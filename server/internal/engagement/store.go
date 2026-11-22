// Package engagement stores how processes and standards are used: views, bookmarks, upvotes
// and skill downloads, and reads the counts back for the app and for the statistics.
//
// Who viewed what, and who downloaded which skill, on which day is stored only to count each
// person once a day and to count different people; nothing here ever returns it per person.
package engagement

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Kinds of document that are counted.
const (
	Process  = "process"
	Standard = "standard"
)

// Ways a skill reaches a repository.
const (
	ViaDownload = "download"
	ViaExport   = "export"
)

// ErrNoDocument: what was to be counted, bookmarked or upvoted is not (or no longer) a stored
// process or standard.
var ErrNoDocument = errors.New("the document does not exist")

// Key names one process or standard.
type Key struct{ Kind, ID string }

// Counts are the all-time numbers of one document.
type Counts struct {
	Views     int `json:"views"`
	People    int `json:"people"`
	Downloads int `json:"downloads"`
	Upvotes   int `json:"upvotes"`
	Handled   int `json:"handled"` // feedback marked as fixed
}

// Bookmark is one document a person keeps.
type Bookmark struct {
	Kind string    `json:"kind"`
	ID   string    `json:"id"`
	At   time.Time `json:"at"`
}

// Ref names one document a person upvoted.
type Ref struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Draft is a document that only some people may see, with what decides who.
type Draft struct {
	Key
	Owner, Platform, Practice string
}

type Store struct{ Pool *pgxpool.Pool }

// Norm is how emails are stored: trimmed, in lower case.
func Norm(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// Day is the date a moment falls on by the server's clock in UTC.
func Day(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// retired is the mark a deleted document's views and downloads get in their id: they still count
// in the totals of a period, but never for a new document created under the same id. Ids of
// documents never contain "@".
const retired = "@deleted-"

// held takes the row of the document for the rest of the transaction, so that a delete either
// comes first (and nothing is counted for what no longer exists) or waits until this is stored
// (and then takes it along).
func held(ctx context.Context, tx pgx.Tx, kind, id string) error {
	var one int
	err := tx.QueryRow(ctx, `select 1 from documents where kind = $1 and id = $2 for share`, kind, id).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoDocument
	}
	return err
}

// RecordView counts one view; the same person, document and day count once. It answers the
// all-time views and people of the document afterwards.
func (s *Store) RecordView(ctx context.Context, kind, id, email string, at time.Time) (views, people int, err error) {
	email, day := Norm(email), Day(at)
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := held(ctx, tx, kind, id); err != nil {
			return err
		}
		// one person and document at a time, so that "first view ever" is decided once
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 7463))`, kind+"/"+id+"/"+email); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `insert into document_views (kind, id, email, day) values ($1, $2, $3, $4) on conflict do nothing`, kind, id, email, day)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 1 {
			var before bool
			if err := tx.QueryRow(ctx, `select exists (select 1 from document_views where kind = $1 and id = $2 and email = $3 and day <> $4)`,
				kind, id, email, day).Scan(&before); err != nil {
				return err
			}
			first := 1
			if before {
				first = 0
			}
			if _, err := tx.Exec(ctx, `insert into document_counts (kind, id, views, people) values ($1, $2, 1, $3)
				on conflict (kind, id) do update set views = document_counts.views + 1, people = document_counts.people + excluded.people`, kind, id, first); err != nil {
				return err
			}
		}
		return tx.QueryRow(ctx, `select coalesce((select views from document_counts where kind = $1 and id = $2), 0),
			coalesce((select people from document_counts where kind = $1 and id = $2), 0)`, kind, id).Scan(&views, &people)
	})
	return views, people, err
}

// ViewCounts returns the all-time views and people of one document.
func (s *Store) ViewCounts(ctx context.Context, kind, id string) (views, people int, err error) {
	err = s.Pool.QueryRow(ctx, `select coalesce((select views from document_counts where kind = $1 and id = $2), 0),
		coalesce((select people from document_counts where kind = $1 and id = $2), 0)`, kind, id).Scan(&views, &people)
	return views, people, err
}

// CountDownload counts a skill or review agent that reached a repository. A download counts at
// most once per person, skill and day; an export (no person) counts every time. counted says
// whether this one was counted. Nothing is counted for a document that does not exist.
func (s *Store) CountDownload(ctx context.Context, skillID, kind, id, email, via string, at time.Time) (counted bool, err error) {
	email = Norm(email)
	if via == ViaExport {
		email = ""
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := held(ctx, tx, kind, id); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `insert into skill_downloads (skill_id, source_kind, source_id, via, at, email, day) values ($1, $2, $3, $4, $5, $6, $7)
			on conflict do nothing`, skillID, kind, id, via, at, email, Day(at))
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		counted = true
		_, err = tx.Exec(ctx, `insert into document_counts (kind, id, downloads) values ($1, $2, 1)
			on conflict (kind, id) do update set downloads = document_counts.downloads + 1`, kind, id)
		return err
	})
	return counted, err
}

// SetBookmark keeps or drops a document for one person. Repeating it changes nothing. Keeping
// one is stored only while the document exists (ErrNoDocument otherwise), like a view; dropping
// always works.
func (s *Store) SetBookmark(ctx context.Context, email, kind, id string, on bool) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := `delete from bookmarks where email = $1 and kind = $2 and id = $3`
		if on {
			if err := held(ctx, tx, kind, id); err != nil {
				return err
			}
			q = `insert into bookmarks (email, kind, id) values ($1, $2, $3) on conflict do nothing`
		}
		_, err := tx.Exec(ctx, q, Norm(email), kind, id)
		return err
	})
}

// SetUpvote gives or takes back the vote of one person and returns the votes of the document.
// A vote is given only while the document exists (ErrNoDocument otherwise), like a view; taking
// it back always works.
func (s *Store) SetUpvote(ctx context.Context, email, kind, id string, on bool) (n int, err error) {
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := `delete from upvotes where email = $1 and kind = $2 and id = $3`
		if on {
			if err := held(ctx, tx, kind, id); err != nil {
				return err
			}
			q = `insert into upvotes (email, kind, id) values ($1, $2, $3) on conflict do nothing`
		}
		if _, err := tx.Exec(ctx, q, Norm(email), kind, id); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `select count(*) from upvotes where kind = $1 and id = $2`, kind, id).Scan(&n)
	})
	return n, err
}

// Execer is a pool or a transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// DeleteByTargetIn removes the bookmarks, upvotes and all-time numbers of a document that is
// deleted, in the transaction that deletes it. Its views and downloads stay, as part of the
// totals of the past, but are marked as belonging to a deleted document (see retired), so that a
// new document under the same id starts from nothing.
func DeleteByTargetIn(ctx context.Context, q Execer, kind, id string) error {
	mark := fmt.Sprintf("%s%s%d", id, retired, time.Now().UnixNano())
	for _, step := range []struct {
		sql  string
		mark bool
	}{
		{`delete from bookmarks where kind = $1 and id = $2`, false},
		{`delete from upvotes where kind = $1 and id = $2`, false},
		{`delete from document_counts where kind = $1 and id = $2`, false},
		{`update document_views set id = $3 where kind = $1 and id = $2`, true},
		{`update skill_downloads set source_id = $3 where source_kind = $1 and source_id = $2`, true},
	} {
		args := []any{kind, id}
		if step.mark {
			args = append(args, mark)
		}
		if _, err := q.Exec(ctx, step.sql, args...); err != nil {
			return err
		}
	}
	return nil
}

// Mine returns the bookmarks (newest first) and upvotes of one person.
func (s *Store) Mine(ctx context.Context, email string) ([]Bookmark, []Ref, error) {
	email = Norm(email)
	bookmarks := []Bookmark{}
	rows, err := s.Pool.Query(ctx, `select kind, id, created_at from bookmarks where email = $1 order by created_at desc, kind, id`, email)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var b Bookmark
		if err := rows.Scan(&b.Kind, &b.ID, &b.At); err != nil {
			rows.Close()
			return nil, nil, err
		}
		bookmarks = append(bookmarks, b)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	upvotes := []Ref{}
	rows, err = s.Pool.Query(ctx, `select kind, id from upvotes where email = $1 order by kind, id`, email)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var u Ref
		if err := rows.Scan(&u.Kind, &u.ID); err != nil {
			return nil, nil, err
		}
		upvotes = append(upvotes, u)
	}
	return bookmarks, upvotes, rows.Err()
}

// Drafts lists the processes and standards that are drafts, read from the columns the database
// keeps of every body (no body is read).
func (s *Store) Drafts(ctx context.Context) ([]Draft, error) {
	rows, err := s.Pool.Query(ctx, `select kind, id, owner, platform, practice from documents where status = 'draft' and kind in ('process', 'standard')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Draft{}
	for rows.Next() {
		var d Draft
		if err := rows.Scan(&d.Kind, &d.ID, &d.Owner, &d.Platform, &d.Practice); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Counts returns the all-time numbers of every stored process and standard that has any. Views,
// people and downloads come from the numbers kept per document; upvotes and handled feedback are
// counted through their indexes. It does not depend on how many views were ever recorded.
func (s *Store) Counts(ctx context.Context) (map[Key]Counts, error) {
	rows, err := s.Pool.Query(ctx, `select d.kind, d.id, coalesce(c.views, 0), coalesce(c.people, 0), coalesce(c.downloads, 0),
		(select count(*) from upvotes u where u.kind = d.kind and u.id = d.id),
		(select count(*) from feedback f where f.target_kind = d.kind and f.target_id = d.id and f.resolved_at is not null)
		from documents d left join document_counts c on c.kind = d.kind and c.id = d.id
		where d.kind in ('process', 'standard')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[Key]Counts{}
	for rows.Next() {
		var k Key
		var c Counts
		if err := rows.Scan(&k.Kind, &k.ID, &c.Views, &c.People, &c.Downloads, &c.Upvotes, &c.Handled); err != nil {
			return nil, err
		}
		if c != (Counts{}) {
			out[k] = c
		}
	}
	return out, rows.Err()
}

// Period is everything the statistics need about the days from a given date (UTC) until now.
type Period struct {
	// per document as it exists now, within the period
	Docs map[Key]*PeriodCounts
	// per platform, practice and owning team ("" for documents without one): views, people and
	// downloads within the period of the documents as they exist now
	Groups map[string]map[string]*GroupCounts
	// everything recorded within the period, deleted documents included
	Views, People, Downloads, Upvotes, FeedbackOpened, FeedbackHandled, Requests int
	// the part of Views and Downloads that belongs to documents deleted since
	DeletedViews, DeletedDownloads int
	Weeks                          []Week
}

// PeriodCounts are the numbers of one document: within the period, except UpvotesTotal and
// FeedbackOpen, which are as of now.
type PeriodCounts struct {
	Views, People, Downloads, Upvotes, UpvotesTotal, FeedbackOpen, FeedbackHandled int
}

// GroupCounts are the views and different people of a group of documents within the period.
type GroupCounts struct{ Views, People int }

// Week is one week of the trend, starting on Monday. Days is how many of its days fall in the period.
type Week struct {
	Week      time.Time
	Days      int
	Views     int
	People    int
	Downloads int
}

// Earliest is the first day anything was recorded (views, downloads, upvotes, feedback,
// requests), or today when nothing was.
func (s *Store) Earliest(ctx context.Context, now time.Time) (time.Time, error) {
	var first *time.Time
	err := s.Pool.QueryRow(ctx, `select least(
		(select min(day)::timestamp from document_views),
		(select min(day)::timestamp from skill_downloads),
		(select min(created_at at time zone 'UTC') from upvotes),
		(select min(created_at at time zone 'UTC') from feedback),
		(select min(created_at at time zone 'UTC') from requests))`).Scan(&first)
	if err != nil {
		return time.Time{}, err
	}
	if first == nil {
		return Day(now), nil
	}
	return Day(*first), nil
}

// viewsBySet aggregates the views of a period in the database: per document, per platform,
// practice and owning team, the part of deleted documents, and in all. The views are first
// reduced to one row per document and person; different people are then counted by grouping
// again (hash aggregation), never by sorting every view. A view of a deleted document has no row
// in documents (its id is marked).
const viewsBySet = `with pairs as materialized (
	select kind collate "C" as kind, id collate "C" as id, email collate "C" as email, count(*) as n
	from document_views where day >= $1 group by 1, 2, 3
)
select 'document', p.kind, p.id, sum(p.n)::bigint, count(*) from pairs p join documents d on d.kind = p.kind and d.id = p.id group by p.kind, p.id
union all
select 'platform', '', platform, sum(n)::bigint, count(*) from (select d.platform, p.email, sum(p.n) as n from pairs p
	join documents d on d.kind = p.kind and d.id = p.id group by d.platform, p.email) x group by platform
union all
select 'practice', '', practice, sum(n)::bigint, count(*) from (select d.practice, p.email, sum(p.n) as n from pairs p
	join documents d on d.kind = p.kind and d.id = p.id group by d.practice, p.email) x group by practice
union all
select 'team', '', owner, sum(n)::bigint, count(*) from (select d.owner, p.email, sum(p.n) as n from pairs p
	join documents d on d.kind = p.kind and d.id = p.id group by d.owner, p.email) x group by owner
union all
select 'deleted', '', '', coalesce(sum(p.n), 0)::bigint, 0 from pairs p where not exists (select 1 from documents d where d.kind = p.kind and d.id = p.id)
union all
select 'total', '', '', coalesce(sum(n), 0)::bigint, count(*) from (select email, sum(n) as n from pairs group by email) x`

// PeriodFrom collects the statistics from the start of the day from (UTC) until now.
func (s *Store) PeriodFrom(ctx context.Context, from, now time.Time) (*Period, error) {
	from, today := Day(from), Day(now)
	// the weekly trend is counted at the same time, on a connection of its own
	trend := make(chan weekly, 1)
	go func() {
		w, err := s.weeksFrom(ctx, from)
		trend <- weekly{w, err}
	}()
	p := &Period{Docs: map[Key]*PeriodCounts{}, Groups: map[string]map[string]*GroupCounts{"platform": {}, "practice": {}, "team": {}}}
	get := func(k Key) *PeriodCounts {
		if p.Docs[k] == nil {
			p.Docs[k] = &PeriodCounts{}
		}
		return p.Docs[k]
	}
	// one transaction, so that the reports of a period may use more memory for their grouping
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `set local work_mem = '64MB'; set local jit = off`); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, viewsBySet, from)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var set, kind, id string
		var views, people int
		if err := rows.Scan(&set, &kind, &id, &views, &people); err != nil {
			rows.Close()
			return nil, err
		}
		switch set {
		case "document":
			c := get(Key{kind, id})
			c.Views, c.People = views, people
		case "platform", "practice", "team":
			p.Groups[set][id] = &GroupCounts{views, people}
		case "deleted":
			p.DeletedViews = views
		case "total":
			p.Views, p.People = views, people
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// downloads per document; those of deleted documents have no row in documents
	rows, err = tx.Query(ctx, `select s.source_kind, s.source_id, d.kind is null, count(*) from skill_downloads s
		left join documents d on d.kind = s.source_kind and d.id = s.source_id where s.day >= $1 group by 1, 2, 3`, from)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k Key
		var deleted bool
		var n int
		if err := rows.Scan(&k.Kind, &k.ID, &deleted, &n); err != nil {
			rows.Close()
			return nil, err
		}
		p.Downloads += n
		if deleted {
			p.DeletedDownloads += n
		} else {
			get(k).Downloads = n
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	perDoc := []struct {
		sql string
		set func(c *PeriodCounts, a, b int)
	}{
		{`select kind, id, count(*) filter (where created_at >= $1), count(*) from upvotes group by kind, id`,
			func(c *PeriodCounts, a, b int) { c.Upvotes, c.UpvotesTotal = a, b }},
		{`select target_kind, target_id, count(*) filter (where resolved_at is null), count(*) filter (where resolved_at >= $1)
		  from feedback group by target_kind, target_id`,
			func(c *PeriodCounts, a, b int) { c.FeedbackOpen, c.FeedbackHandled = a, b }},
	}
	for _, q := range perDoc {
		rows, err := tx.Query(ctx, q.sql, from)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var k Key
			var a, b int
			if err := rows.Scan(&k.Kind, &k.ID, &a, &b); err != nil {
				rows.Close()
				return nil, err
			}
			q.set(get(k), a, b)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	err = tx.QueryRow(ctx, `select
		(select count(*) from upvotes where created_at >= $1),
		(select count(*) from feedback where created_at >= $1),
		(select count(*) from feedback where resolved_at >= $1),
		(select count(*) from requests where created_at >= $1)`, from).
		Scan(&p.Upvotes, &p.FeedbackOpened, &p.FeedbackHandled, &p.Requests)
	if err != nil {
		return nil, err
	}

	weeks := <-trend
	if weeks.err != nil {
		return nil, weeks.err
	}
	week := func(t time.Time) *Week {
		if weeks.byMonday[t] == nil {
			weeks.byMonday[t] = &Week{Week: t}
		}
		return weeks.byMonday[t]
	}
	// every week of the period, quiet ones included, oldest first
	for monday := Monday(from); !monday.After(today); monday = monday.AddDate(0, 0, 7) {
		w := week(monday)
		for d := 0; d < 7; d++ {
			if day := monday.AddDate(0, 0, d); !day.Before(from) && !day.After(today) {
				w.Days++
			}
		}
		p.Weeks = append(p.Weeks, *w)
	}
	return p, nil
}

type weekly struct {
	byMonday map[time.Time]*Week
	err      error
}

// weeksFrom counts views, people and downloads per week from the start of the day from. It runs
// beside the other queries of a period, on a connection of its own.
func (s *Store) weeksFrom(ctx context.Context, from time.Time) (map[time.Time]*Week, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `set local work_mem = '64MB'; set local jit = off`); err != nil {
		return nil, err
	}
	weeks := map[time.Time]*Week{}
	week := func(t time.Time) *Week {
		t = Day(t)
		if weeks[t] == nil {
			weeks[t] = &Week{Week: t}
		}
		return weeks[t]
	}
	rows, err := tx.Query(ctx, `select week, sum(n)::bigint, count(*) from (select date_trunc('week', day::timestamp) as week, email collate "C" as email, count(*) as n
		from document_views where day >= $1 group by 1, 2) x group by week`, from)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t time.Time
		var views, people int
		if err := rows.Scan(&t, &views, &people); err != nil {
			rows.Close()
			return nil, err
		}
		w := week(t)
		w.Views, w.People = views, people
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows, err = tx.Query(ctx, `select date_trunc('week', day::timestamp), count(*) from skill_downloads where day >= $1 group by 1`, from)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t time.Time
		var n int
		if err := rows.Scan(&t, &n); err != nil {
			rows.Close()
			return nil, err
		}
		week(t).Downloads = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return weeks, nil
}

// Monday is the start of the week a day falls in.
func Monday(t time.Time) time.Time {
	t = Day(t)
	offset := (int(t.Weekday()) + 6) % 7 // Monday 0 ... Sunday 6
	return t.AddDate(0, 0, -offset)
}

// Empty reports whether nothing at all was recorded yet: no views, bookmarks, upvotes,
// downloads or requests. The development samples are only added then.
func (s *Store) Empty(ctx context.Context) (bool, error) {
	var some bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from document_views) or exists (select 1 from bookmarks) or exists (select 1 from upvotes)
		or exists (select 1 from skill_downloads) or exists (select 1 from requests)`).Scan(&some)
	return !some, err
}

// Reset removes every view, bookmark, upvote, download and the numbers kept of them. Local
// development only.
func (s *Store) Reset(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `truncate document_views, document_counts, bookmarks, upvotes, skill_downloads`)
	return err
}
