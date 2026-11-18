// Package requests stores what people ask for: a process or standard that does not exist yet,
// with the votes of everyone who wants it too and the state it is in.
package requests

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// States a request goes through: open -> planned -> done or declined.
const (
	Open     = "open"
	Planned  = "planned"
	Done     = "done"
	Declined = "declined"
)

// States in their order.
var States = []string{Open, Planned, Done, Declined}

// ValidState reports whether s is a state.
func ValidState(s string) bool {
	for _, x := range States {
		if x == s {
			return true
		}
	}
	return false
}

var (
	// ErrNotFound: no such request.
	ErrNotFound = errors.New("request not found")
	// ErrNotOpen: the requester may only withdraw a request that is still open.
	ErrNotOpen = errors.New("the request is no longer open")
	// ErrTooMany: the person made as many requests in the last hour as they may.
	ErrTooMany = errors.New("too many requests in the last hour")
)

// Request is one stored request, with its votes.
type Request struct {
	ID          int64
	Kind        string // "process" or "standard"
	Title       string
	Description string
	Platform    string // id in the lists, or ""
	Practice    string // id in the lists, or ""
	ByEmail     string
	ByName      string
	CreatedAt   time.Time
	State       string
	StateNote   string
	StateBy     string // name of whoever changed the state last
	StateAt     *time.Time
	LinkedID    string // the process or standard (same kind) that answers it
	LinkedGone  bool   // the document that answered it was deleted since
	Votes       int
	VotedByMe   bool // by the email the request was read for
}

// New is the input for Create.
type New struct {
	Kind, Title, Description, Platform, Practice, ByEmail, ByName string
}

type Store struct{ Pool *pgxpool.Pool }

func norm(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

const columns = `r.id, r.kind, r.title, r.description, r.platform, r.practice, r.requested_by_email, r.requested_by_name, r.created_at,
  r.state, r.state_note, r.state_by, r.state_at, r.linked_id, r.linked_gone,
  (select count(*) from request_votes v where v.request_id = r.id),
  exists (select 1 from request_votes v where v.request_id = r.id and v.email = $1)`

func scan(row pgx.Row) (Request, error) {
	var q Request
	err := row.Scan(&q.ID, &q.Kind, &q.Title, &q.Description, &q.Platform, &q.Practice, &q.ByEmail, &q.ByName, &q.CreatedAt,
		&q.State, &q.StateNote, &q.StateBy, &q.StateAt, &q.LinkedID, &q.LinkedGone, &q.Votes, &q.VotedByMe)
	if errors.Is(err, pgx.ErrNoRows) {
		return q, ErrNotFound
	}
	return q, err
}

// List returns every request, newest first, as the person with this email sees it.
func (s *Store) List(ctx context.Context, email string) ([]Request, error) {
	rows, err := s.Pool.Query(ctx, `select `+columns+` from requests r order by r.created_at desc, r.id desc`, norm(email))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Request{}
	for rows.Next() {
		q, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// Get returns one request as the person with this email sees it.
func (s *Store) Get(ctx context.Context, id int64, email string) (Request, error) {
	return scan(s.Pool.QueryRow(ctx, `select `+columns+` from requests r where r.id = $2`, norm(email), id))
}

// Create stores a new open request, unless the person made max requests or more in the hour
// before (ErrTooMany). Requests withdrawn or removed since count too. The count and the insert
// happen under a lock of the person, so requests sent at the same time cannot slip past.
// max <= 0: no limit.
func (s *Store) Create(ctx context.Context, n New, max int) (Request, error) {
	var id int64
	email := norm(n.ByEmail)
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if max > 0 {
			if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 7464))`, email); err != nil {
				return err
			}
			var made int
			if err := tx.QueryRow(ctx, `select (select count(*) from requests where requested_by_email = $1 and created_at > now() - interval '1 hour')
				+ (select count(*) from requests_removed where email = $1 and created_at > now() - interval '1 hour')`, email).Scan(&made); err != nil {
				return err
			}
			if made >= max {
				return ErrTooMany
			}
		}
		return tx.QueryRow(ctx, `insert into requests (kind, title, description, platform, practice, requested_by_email, requested_by_name)
			values ($1, $2, $3, $4, $5, $6, $7) returning id`, n.Kind, n.Title, n.Description, n.Platform, n.Practice, email, n.ByName).Scan(&id)
	})
	if err != nil {
		return Request{}, err
	}
	return s.Get(ctx, id, n.ByEmail)
}

// SetState moves a request to another state. linked is kept only for "done".
func (s *Store) SetState(ctx context.Context, id int64, state, note, linked, by, email string) (Request, error) {
	if state != Done {
		linked = ""
	}
	tag, err := s.Pool.Exec(ctx, `update requests set state = $2, state_note = $3, linked_id = $4, linked_gone = false, state_by = $5, state_at = now() where id = $1`,
		id, state, note, linked, by)
	if err != nil {
		return Request{}, err
	}
	if tag.RowsAffected() == 0 {
		return Request{}, ErrNotFound
	}
	return s.Get(ctx, id, email)
}

// Delete removes a request with its votes. onlyOpen: only while it is open (the requester
// withdrawing it); checked in the same statement, so a change of state in between wins.
// The request still counts for the brake of the hour it was made in.
func (s *Store) Delete(ctx context.Context, id int64, onlyOpen bool) error {
	var deleted bool
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var email string
		var created time.Time
		err := tx.QueryRow(ctx, `delete from requests where id = $1 and (not $2 or state = 'open') returning requested_by_email, created_at`, id, onlyOpen).Scan(&email, &created)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		deleted = true
		if _, err := tx.Exec(ctx, `delete from requests_removed where created_at < now() - interval '1 day'`); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `insert into requests_removed (email, created_at) values ($1, $2)`, email, created)
		return err
	})
	if err != nil || deleted {
		return err
	}
	var exists bool
	if err := s.Pool.QueryRow(ctx, `select exists (select 1 from requests where id = $1)`, id).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return ErrNotOpen
	}
	return ErrNotFound
}

// SetVote gives or takes back the vote of one person and returns the votes of the request.
func (s *Store) SetVote(ctx context.Context, id int64, email string, on bool) (int, error) {
	var n int
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		// the request is held, so that it cannot be deleted between the check and the vote
		var one int
		if err := tx.QueryRow(ctx, `select 1 from requests where id = $1 for share`, id).Scan(&one); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		q := `delete from request_votes where request_id = $1 and email = $2`
		if on {
			q = `insert into request_votes (request_id, email) values ($1, $2) on conflict do nothing`
		}
		if _, err := tx.Exec(ctx, q, id, norm(email)); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `select count(*) from request_votes where request_id = $1`, id).Scan(&n)
	})
	return n, err
}

// Execer is a pool or a transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// AnswerGoneIn is called in the transaction that deletes a process or standard: a done request it
// answered keeps its state, loses the link and records that its answer was removed, so that a
// document created later under the same id does not silently become the answer.
func AnswerGoneIn(ctx context.Context, q Execer, kind, id string) error {
	_, err := q.Exec(ctx, `update requests set linked_id = '', linked_gone = true where kind = $1 and linked_id = $2`, kind, id)
	return err
}

// Reset removes every request and vote. Local development only.
func (s *Store) Reset(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `truncate request_votes, requests_removed, requests`)
	return err
}

// CountSince returns how many requests one person made since the given moment.
func (s *Store) CountSince(ctx context.Context, email string, since time.Time) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from requests where requested_by_email = $1 and created_at >= $2`, norm(email), since).Scan(&n)
	return n, err
}
