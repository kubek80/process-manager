// Package feedback stores what people report about processes and steps.
package feedback

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

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
	ProcessID   string
	StepID      string // empty: about the whole process
	Kind        string
	Text        string
	AuthorEmail string
	AuthorName  string
	StepHash    string
	CreatedAt   time.Time
	ResolvedAt  *time.Time
	ResolvedBy  string
	AlsoHit     []string // emails of people who hit the same problem
}

// New is the input for Create.
type New struct {
	ProcessID, StepID, Kind, Text, AuthorEmail, AuthorName, StepHash string
}

type Store struct{ Pool *pgxpool.Pool }

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Migrate applies the SQL files that have not run yet. Safe to call on every start.
func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.Pool.Exec(ctx, `create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		version, err := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if err != nil {
			return fmt.Errorf("migration %s: name must start with a number", name)
		}
		sql, _ := migrations.ReadFile("migrations/" + name)
		err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
			// serialise concurrent starts
			if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(7461001)`); err != nil {
				return err
			}
			var done bool
			if err := tx.QueryRow(ctx, `select exists (select 1 from schema_migrations where version = $1)`, version).Scan(&done); err != nil || done {
				return err
			}
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `insert into schema_migrations (version) values ($1)`, version)
			return err
		})
		if err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}
	return nil
}

const columns = `f.id::text, f.process_id, coalesce(f.step_id, ''), f.kind, f.body, f.author_email, f.author_name,
  coalesce(f.step_hash, ''), f.created_at, f.resolved_at, coalesce(f.resolved_by, ''),
  coalesce((select array_agg(a.email order by a.created_at, a.email) from feedback_also_hit a where a.feedback_id = f.id), '{}')`

func scan(row pgx.Row) (Item, error) {
	var it Item
	err := row.Scan(&it.ID, &it.ProcessID, &it.StepID, &it.Kind, &it.Text, &it.AuthorEmail, &it.AuthorName,
		&it.StepHash, &it.CreatedAt, &it.ResolvedAt, &it.ResolvedBy, &it.AlsoHit)
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
		`insert into feedback (process_id, step_id, kind, body, author_email, author_name, step_hash)
		 values ($1, $2, $3, $4, $5, $6, $7) returning id::text`,
		n.ProcessID, nullable(n.StepID), n.Kind, n.Text, n.AuthorEmail, n.AuthorName, nullable(n.StepHash)).Scan(&id)
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

// DeleteByProcess removes all feedback of a process that no longer exists.
func (s *Store) DeleteByProcess(ctx context.Context, processID string) error {
	_, err := s.Pool.Exec(ctx, `delete from feedback where process_id = $1`, processID)
	return err
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
