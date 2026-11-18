// Package db opens the database and keeps its tables up to date.
package db

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Locks that make starting several instances at once safe. Each is held for the whole step.
const (
	lockMigrate = 7461001
	LockPrepare = 7461002 // filling an empty database and regenerating the skills
	LockSkills  = 7461003 // regenerating skills: one at a time
)

// WithLock runs fn while holding a database-wide lock, so that only one instance at a time
// does it; the others wait and then find the work done. Waiting does not hold a connection:
// fn needs connections of the same pool, and a pool full of waiters would starve it.
func WithLock(ctx context.Context, pool *pgxpool.Pool, key int64, fn func() error) error {
	for {
		conn, err := pool.Acquire(ctx)
		if err != nil {
			return err
		}
		var got bool
		if err := conn.QueryRow(ctx, `select pg_try_advisory_lock($1)`, key).Scan(&got); err != nil {
			conn.Release()
			return err
		}
		if got {
			// released on a context of its own: the lock must go even when ctx was cancelled meanwhile
			defer func() {
				_, _ = conn.Exec(context.WithoutCancel(ctx), `select pg_advisory_unlock($1)`, key)
				conn.Release()
			}()
			return fn()
		}
		conn.Release()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// Migrate applies the SQL files that have not run yet, then the conversions of content given
// as after (each must find nothing to do when it has run before). Safe to call on every start,
// and from several instances at once - also on a database that is still completely empty: one
// instance does the work under a lock, the others wait and then find it done.
func Migrate(ctx context.Context, pool *pgxpool.Pool, after ...func(context.Context) error) error {
	_, err := Upgrade(ctx, pool, after...)
	return err
}

// Upgrade is Migrate that also says which SQL files it applied, by name, in the order they
// ran. None means the tables were already up to date (or another instance, which held the lock
// first, did the work).
func Upgrade(ctx context.Context, pool *pgxpool.Pool, after ...func(context.Context) error) ([]string, error) {
	var applied []string
	err := WithLock(ctx, pool, lockMigrate, func() error {
		var err error
		if applied, err = migrate(ctx, pool); err != nil {
			return err
		}
		for _, step := range after {
			if err := step(ctx); err != nil {
				return err
			}
		}
		return nil
	})
	return applied, err
}

func migrate(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	if _, err := pool.Exec(ctx, `create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`); err != nil {
		return nil, err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return nil, err
	}
	applied := []string{}
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		version, err := strconv.Atoi(strings.SplitN(name, "_", 2)[0])
		if err != nil {
			return applied, fmt.Errorf("migration %s: name must start with a number", name)
		}
		sql, _ := migrations.ReadFile("migrations/" + name)
		ran := false
		err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			var done bool
			if err := tx.QueryRow(ctx, `select exists (select 1 from schema_migrations where version = $1)`, version).Scan(&done); err != nil || done {
				return err
			}
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `insert into schema_migrations (version) values ($1)`, version)
			ran = err == nil
			return err
		})
		if err != nil {
			return applied, fmt.Errorf("migration %s: %w", name, err)
		}
		if ran {
			applied = append(applied, name)
		}
	}
	return applied, nil
}

// ErrBehind is returned by Current when the database lacks migrations of this version.
var ErrBehind = errors.New("the database is not up to date")

// Latest is the number of the newest migration this version of the server has.
func Latest() int {
	entries, _ := migrations.ReadDir("migrations")
	latest := 0
	for _, e := range entries {
		if n, err := strconv.Atoi(strings.SplitN(e.Name(), "_", 2)[0]); err == nil && n > latest {
			latest = n
		}
	}
	return latest
}

// Current checks, without changing anything, that the database has every migration of this
// version: for a program that reads the database but does not upgrade it (the MCP server).
// ErrBehind (wrapped, with a plain explanation) when it does not.
func Current(ctx context.Context, pool *pgxpool.Pool) error {
	var exists bool
	if err := pool.QueryRow(ctx, `select to_regclass('schema_migrations') is not null`).Scan(&exists); err != nil {
		return err
	}
	have := 0
	if exists {
		if err := pool.QueryRow(ctx, `select coalesce(max(version), 0) from schema_migrations`).Scan(&have); err != nil {
			return err
		}
	}
	if have < Latest() {
		return fmt.Errorf("%w: it has migration %d, this version needs %d. Start the portal server (or run it with -migrate) first", ErrBehind, have, Latest())
	}
	return nil
}
