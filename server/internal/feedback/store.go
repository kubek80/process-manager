// Package feedback stores what people report about processes and steps.
package feedback

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a feedback item does not exist.
var ErrNotFound = errors.New("feedback not found")

// Kinds a reporter can choose from.
var Kinds = []string{"broken", "outdated", "unclear", "idea"}

func ValidKind(k string) bool {
	for _, x := range Kinds {
		if x == k {
			return true
		}
	}
	return false
}

// Item is one piece of feedback.
type Item struct {
	ID          string
	TargetKind  string // "process" or "standard"
	TargetID    string
	ItemID      string // step or requirement; empty: about the whole process or standard
	Kind        string
	Text        string
	AuthorEmail string
	AuthorName  string
	ItemHash    string // fingerprint of the step or requirement when the feedback was written
	CreatedAt   time.Time
	ResolvedAt  *time.Time
	ResolvedBy  string
	AlsoHit     []string // emails of people who hit the same problem
}

// New is the input for Create.
type New struct {
	TargetKind, TargetID, ItemID, Kind, Text, AuthorEmail, AuthorName, ItemHash string
}

type Store struct{ Pool *pgxpool.Pool }

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

const columns = `f.id::text, f.target_kind, f.target_id, coalesce(f.step_id, ''), f.kind, f.body, f.author_email, f.author_name,
  coalesce(f.step_hash, ''), f.created_at, f.resolved_at, coalesce(f.resolved_by, ''),
  coalesce((select array_agg(a.email order by a.created_at, a.email) from feedback_also_hit a where a.feedback_id = f.id), '{}')`

func scan(row pgx.Row) (Item, error) {
	var it Item
	err := row.Scan(&it.ID, &it.TargetKind, &it.TargetID, &it.ItemID, &it.Kind, &it.Text, &it.AuthorEmail, &it.AuthorName,
		&it.ItemHash, &it.CreatedAt, &it.ResolvedAt, &it.ResolvedBy, &it.AlsoHit)
	if errors.Is(err, pgx.ErrNoRows) {
		return it, ErrNotFound
	}
	return it, err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Create stores a new item.
func (s *Store) Create(ctx context.Context, n New) (Item, error) {
	var id string
	err := s.Pool.QueryRow(ctx,
		`insert into feedback (target_kind, target_id, step_id, kind, body, author_email, author_name, step_hash)
		 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text`,
		n.TargetKind, n.TargetID, nullable(n.ItemID), n.Kind, n.Text, n.AuthorEmail, n.AuthorName, nullable(n.ItemHash)).Scan(&id)
	if err != nil {
		return Item{}, err
	}
	return s.Get(ctx, id)
}

// Get returns one item.
func (s *Store) Get(ctx context.Context, id string) (Item, error) {
	if !uuidPattern.MatchString(id) {
		return Item{}, ErrNotFound
	}
	return scan(s.Pool.QueryRow(ctx, `select `+columns+` from feedback f where f.id = $1`, id))
}

// List returns every item, oldest first.
func (s *Store) List(ctx context.Context) ([]Item, error) {
	rows, err := s.Pool.Query(ctx, `select `+columns+` from feedback f order by f.created_at, f.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		it, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// SetAlsoHit records or withdraws "I hit this as well" for one person. Repeating it changes nothing.
func (s *Store) SetAlsoHit(ctx context.Context, id, email string, on bool) (Item, error) {
	if _, err := s.Get(ctx, id); err != nil {
		return Item{}, err
	}
	var err error
	if on {
		_, err = s.Pool.Exec(ctx, `insert into feedback_also_hit (feedback_id, email) values ($1, $2) on conflict do nothing`, id, email)
	} else {
		_, err = s.Pool.Exec(ctx, `delete from feedback_also_hit where feedback_id = $1 and email = $2`, id, email)
	}
	if err != nil {
		return Item{}, err
	}
	return s.Get(ctx, id)
}

// SetResolved marks an item as fixed, or reopens it.
func (s *Store) SetResolved(ctx context.Context, id string, resolved bool, by string) (Item, error) {
	if !uuidPattern.MatchString(id) {
		return Item{}, ErrNotFound
	}
	var tag string
	var err error
	if resolved {
		// keep the first resolution if it is already resolved
		err = s.Pool.QueryRow(ctx, `update feedback set resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, $2) where id = $1 returning id::text`, id, by).Scan(&tag)
	} else {
		err = s.Pool.QueryRow(ctx, `update feedback set resolved_at = null, resolved_by = null where id = $1 returning id::text`, id).Scan(&tag)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, err
	}
	return s.Get(ctx, id)
}

// Delete removes one item.
func (s *Store) Delete(ctx context.Context, id string) error {
	if !uuidPattern.MatchString(id) {
		return ErrNotFound
	}
	tag, err := s.Pool.Exec(ctx, `delete from feedback where id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// DeleteByTarget removes all feedback of a process or standard that no longer exists.
func (s *Store) DeleteByTarget(ctx context.Context, kind, id string) error {
	_, err := s.Pool.Exec(ctx, `delete from feedback where target_kind = $1 and target_id = $2`, kind, id)
	return err
}

// OpenCount returns how many items are not marked as fixed.
func (s *Store) OpenCount(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from feedback where resolved_at is null`).Scan(&n)
	return n, err
}

// Count returns the number of items; used to decide whether to add sample data.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from feedback`).Scan(&n)
	return n, err
}

// Reset removes everything. Local development and end-to-end tests only.
func (s *Store) Reset(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `truncate feedback_also_hit, feedback`)
	return err
}
