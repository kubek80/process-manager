// Package audit records who changed what, for the Admin panel.
package audit

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Entry is one recorded change.
type Entry struct {
	ID     int64     `json:"id"`
	At     time.Time `json:"at"`
	Email  string    `json:"email"`
	Name   string    `json:"name"`
	Action string    `json:"action"` // e.g. "process.save", "access.grant"
	Target string    `json:"target"` // what it was done to
	Detail string    `json:"detail"`
}

type Log struct{ Pool *pgxpool.Pool }

// Execer is a pool or a transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Add records a change.
func (l *Log) Add(ctx context.Context, email, name, action, target, detail string) error {
	return AddIn(ctx, l.Pool, email, name, action, target, detail)
}

// AddIn records a change through q, so that the entry can be part of the transaction that
// makes the change: either both happen or neither.
func AddIn(ctx context.Context, q Execer, email, name, action, target, detail string) error {
	_, err := q.Exec(ctx, `insert into audit_log (actor_email, actor_name, action, target, detail) values ($1, $2, $3, $4, $5)`, email, name, action, target, detail)
	return err
}

// Recent returns the newest entries first.
func (l *Log) Recent(ctx context.Context, limit int) ([]Entry, error) { return l.Before(ctx, 0, limit) }

// Before returns the entries older than the one with the given id, newest first; 0 starts at
// the newest. Together with the id of the last entry of a page this walks the whole log.
func (l *Log) Before(ctx context.Context, before int64, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := l.Pool.Query(ctx, `select id, at, actor_email, actor_name, action, target, detail from audit_log
		where ($1 = 0 or id < $1) order by id desc limit $2`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.At, &e.Email, &e.Name, &e.Action, &e.Target, &e.Detail); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
