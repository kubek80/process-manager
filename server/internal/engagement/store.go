// Package engagement stores how processes and standards are used: views, bookmarks, upvotes
// and skill downloads, and reads the counts back for the app and for the statistics.
//
// Who viewed what on which day is stored only to count views and different people; nothing
// here ever returns it per person.
package engagement

import (
	"context"
	"fmt"
	"strings"
	"time"

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

// RecordView counts one view; the same person, document and day count once.
func (s *Store) RecordView(ctx context.Context, kind, id, email string, at time.Time) error {
	_, err := s.Pool.Exec(ctx, `insert into document_views (kind, id, day, email) values ($1, $2, $3, $4) on conflict do nothing`,
		kind, id, Day(at), Norm(email))
	return err
}

// SetBookmark keeps or drops a document for one person. Repeating it changes nothing.
func (s *Store) SetBookmark(ctx context.Context, email, kind, id string, on bool) error {
	q := `delete from bookmarks where email = $1 and kind = $2 and id = $3`
	if on {
		q = `insert into bookmarks (email, kind, id) values ($1, $2, $3) on conflict do nothing`
	}
	_, err := s.Pool.Exec(ctx, q, Norm(email), kind, id)
	return err
}

// SetUpvote gives or takes back the vote of one person and returns the votes of the document.
func (s *Store) SetUpvote(ctx context.Context, email, kind, id string, on bool) (int, error) {
	q := `delete from upvotes where email = $1 and kind = $2 and id = $3`
	if on {
		q = `insert into upvotes (email, kind, id) values ($1, $2, $3) on conflict do nothing`
	}
	if _, err := s.Pool.Exec(ctx, q, Norm(email), kind, id); err != nil {
		return 0, err
	}
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from upvotes where kind = $1 and id = $2`, kind, id).Scan(&n)
	return n, err
}

// CountDownload counts one skill or review agent that reached a repository.
func (s *Store) CountDownload(ctx context.Context, skillID, kind, id, via string, at time.Time) error {
	_, err := s.Pool.Exec(ctx, `insert into skill_downloads (skill_id, source_kind, source_id, via, at) values ($1, $2, $3, $4, $5)`,
		skillID, kind, id, via, at)
	return err
}

// Execer is a pool or a transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// DeleteByTargetIn removes the bookmarks and upvotes of a document that is deleted, in the
// transaction that deletes it. Its views and downloads stay, as part of the totals of the past,
// but are marked as belonging to a deleted document (see retired), so that a new document under
// the same id starts from nothing.
func DeleteByTargetIn(ctx context.Context, q Execer, kind, id string) error {
	mark := fmt.Sprintf("%s%s%d", id, retired, time.Now().UnixNano())
	for _, sql := range []string{
		`delete from bookmarks where kind = $1 and id = $2`,
		`delete from upvotes where kind = $1 and id = $2`,
		`update document_views set id = $3 where kind = $1 and id = $2`,
		`update skill_downloads set source_id = $3 where source_kind = $1 and source_id = $2`,
	} {
		args := []any{kind, id}
		if strings.Contains(sql, "$3") {
			args = append(args, mark)
		}
		if _, err := q.Exec(ctx, sql, args...); err != nil {
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

// each runs a query whose rows start with kind and id, and hands the rest to fn.
func (s *Store) each(ctx context.Context, sql string, args []any, fn func(k Key, vals []int)) error {
	rows, err := s.Pool.Query(ctx, sql, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		raw, err := rows.Values()
		if err != nil {
			return err
		}
		k := Key{Kind: raw[0].(string), ID: raw[1].(string)}
		vals := make([]int, 0, len(raw)-2)
		for _, v := range raw[2:] {
			vals = append(vals, toInt(v))
		}
		fn(k, vals)
	}
	return rows.Err()
}

func toInt(v any) int {
	switch n := v.(type) {
	case int64:
		return int(n)
	case int32:
		return int(n)
	case int:
		return n
	}
	return 0
}

// Counts returns the all-time numbers of every document that has any, by the documents as they
// exist now (views and downloads of a deleted document under the same id do not count).
func (s *Store) Counts(ctx context.Context) (map[Key]*Counts, error) {
	out := map[Key]*Counts{}
	get := func(k Key) *Counts {
		if out[k] == nil {
			out[k] = &Counts{}
		}
		return out[k]
	}
	queries := []struct {
		sql string
		set func(c *Counts, v []int)
	}{
		{`select kind, id, count(*), count(distinct email) from document_views group by kind, id`,
			func(c *Counts, v []int) { c.Views, c.People = v[0], v[1] }},
		{`select source_kind, source_id, count(*) from skill_downloads group by source_kind, source_id`,
			func(c *Counts, v []int) { c.Downloads = v[0] }},
		{`select kind, id, count(*) from upvotes group by kind, id`,
			func(c *Counts, v []int) { c.Upvotes = v[0] }},
		{`select target_kind, target_id, count(*) from feedback where resolved_at is not null group by target_kind, target_id`,
			func(c *Counts, v []int) { c.Handled = v[0] }},
	}
	for _, q := range queries {
		if err := s.each(ctx, q.sql, nil, func(k Key, v []int) { q.set(get(k), v) }); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Period is everything the statistics need about the days from a given date (UTC) until now.
type Period struct {
	// per document as it exists now, within the period
	Docs map[Key]*PeriodCounts
	// the people who viewed each document within the period: to count different people per group
	Viewers map[Key]map[string]bool
	// everything recorded within the period, deleted documents included
	Views, People, Downloads, Upvotes, FeedbackOpened, FeedbackHandled, Requests int
	Weeks                                                                        []Week
}

// PeriodCounts are the numbers of one document: within the period, except UpvotesTotal and
// FeedbackOpen, which are as of now.
type PeriodCounts struct {
	Views, People, Downloads, Upvotes, UpvotesTotal, FeedbackOpen, FeedbackHandled int
}

// Week is one week of the trend, starting on Monday.
type Week struct {
	Week      time.Time
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
		(select min(at at time zone 'UTC') from skill_downloads),
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

// PeriodFrom collects the statistics from the start of the day from (UTC) until now.
func (s *Store) PeriodFrom(ctx context.Context, from time.Time) (*Period, error) {
	from = Day(from)
	p := &Period{Docs: map[Key]*PeriodCounts{}, Viewers: map[Key]map[string]bool{}}
	get := func(k Key) *PeriodCounts {
		if p.Docs[k] == nil {
			p.Docs[k] = &PeriodCounts{}
		}
		return p.Docs[k]
	}
	everyone := map[string]bool{}
	// views: per document and person, so that people can be counted per document, per group and in all
	rows, err := s.Pool.Query(ctx, `select kind, id, email, count(*) from document_views where day >= $1 group by kind, id, email`, from)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var k Key
		var email string
		var views int
		if err := rows.Scan(&k.Kind, &k.ID, &email, &views); err != nil {
			rows.Close()
			return nil, err
		}
		p.Views += views
		everyone[email] = true
		if !strings.Contains(k.ID, retired) {
			c := get(k)
			c.Views += views
			c.People++
			if p.Viewers[k] == nil {
				p.Viewers[k] = map[string]bool{}
			}
			p.Viewers[k][email] = true
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	p.People = len(everyone)

	perDoc := []struct {
		sql string
		set func(c *PeriodCounts, v []int)
	}{
		{`select source_kind, source_id, count(*) from skill_downloads where at >= $1 group by source_kind, source_id`,
			func(c *PeriodCounts, v []int) { c.Downloads = v[0] }},
		{`select kind, id, count(*) filter (where created_at >= $1), count(*) from upvotes group by kind, id`,
			func(c *PeriodCounts, v []int) { c.Upvotes, c.UpvotesTotal = v[0], v[1] }},
		{`select target_kind, target_id, count(*) filter (where resolved_at is null), count(*) filter (where resolved_at >= $1)
		  from feedback group by target_kind, target_id`,
			func(c *PeriodCounts, v []int) { c.FeedbackOpen, c.FeedbackHandled = v[0], v[1] }},
	}
	for _, q := range perDoc {
		if err := s.each(ctx, q.sql, []any{from}, func(k Key, v []int) { q.set(get(k), v) }); err != nil {
			return nil, err
		}
	}

	err = s.Pool.QueryRow(ctx, `select
		(select count(*) from skill_downloads where at >= $1),
		(select count(*) from upvotes where created_at >= $1),
		(select count(*) from feedback where created_at >= $1),
		(select count(*) from feedback where resolved_at >= $1),
		(select count(*) from requests where created_at >= $1)`, from).
		Scan(&p.Downloads, &p.Upvotes, &p.FeedbackOpened, &p.FeedbackHandled, &p.Requests)
	if err != nil {
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
	rows, err = s.Pool.Query(ctx, `select date_trunc('week', day::timestamp), count(*), count(distinct email) from document_views where day >= $1 group by 1`, from)
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
	rows, err = s.Pool.Query(ctx, `select date_trunc('week', at at time zone 'UTC'), count(*) from skill_downloads where at >= $1 group by 1`, from)
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
	// every week of the period, quiet ones included, oldest first
	for monday := Monday(from); !monday.After(Day(time.Now())); monday = monday.AddDate(0, 0, 7) {
		p.Weeks = append(p.Weeks, *week(monday))
	}
	return p, nil
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
