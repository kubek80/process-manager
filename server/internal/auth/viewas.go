package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ViewAsFor is how long an admin views the portal as somebody else before it ends by itself.
const ViewAsFor = time.Hour

// ErrAlreadyViewing: the session already views the portal as somebody; it must stop first.
var ErrAlreadyViewing = errors.New("this session already views the portal as somebody else")

// ViewAs remembers, for one session of an admin, the person whose view of the portal the admin
// is looking at. It is kept on the server under the session's ID, never in anything the
// browser could change. A row only ever takes rights away: the requests of that session are
// answered as that person, and nothing can be changed (see httpapi).
type ViewAs struct{ Pool *pgxpool.Pool }

// Viewing is one admin's session viewing the portal as Target.
type Viewing struct {
	Admin      string
	Session    string
	Target     string
	TargetName string
	Started    time.Time
	Until      time.Time
}

const viewingColumns = `email, session, target, target_name, started_at, until`

func scanViewing(row pgx.Row) (Viewing, error) {
	var v Viewing
	err := row.Scan(&v.Admin, &v.Session, &v.Target, &v.TargetName, &v.Started, &v.Until)
	return v, err
}

// Start begins viewing as target for the session, until now + ViewAsFor. ErrAlreadyViewing
// when the session already views as somebody (also the same person): nothing is nested or
// switched without stopping first.
func (s *ViewAs) Start(ctx context.Context, admin, session, target, targetName string, now time.Time) (Viewing, error) {
	admin, target = strings.ToLower(strings.TrimSpace(admin)), strings.ToLower(strings.TrimSpace(target))
	// rows whose session has certainly ended (sessions last at most a day) are of no use any more
	if _, err := s.Pool.Exec(ctx, `delete from viewing_as where until < $1`, now.Add(-24*time.Hour)); err != nil {
		return Viewing{}, err
	}
	v, err := scanViewing(s.Pool.QueryRow(ctx, `insert into viewing_as (email, session, target, target_name, started_at, until)
		values ($1, $2, $3, $4, $5, $6) on conflict (email, session) do nothing returning `+viewingColumns,
		admin, session, target, targetName, now, now.Add(ViewAsFor)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Viewing{}, ErrAlreadyViewing
	}
	return v, err
}

// Of returns what the session views the portal as; false when it views nothing.
func (s *ViewAs) Of(ctx context.Context, admin, session string) (Viewing, bool, error) {
	v, err := scanViewing(s.Pool.QueryRow(ctx, `select `+viewingColumns+` from viewing_as where email = $1 and session = $2`,
		strings.ToLower(strings.TrimSpace(admin)), session))
	if errors.Is(err, pgx.ErrNoRows) {
		return Viewing{}, false, nil
	}
	return v, err == nil, err
}

// Stop ends viewing for the session. false: it viewed nothing (or another request ended it a
// moment before), so that an end is recorded once.
func (s *ViewAs) Stop(ctx context.Context, admin, session string) (Viewing, bool, error) {
	v, err := scanViewing(s.Pool.QueryRow(ctx, `delete from viewing_as where email = $1 and session = $2 returning `+viewingColumns,
		strings.ToLower(strings.TrimSpace(admin)), session))
	if errors.Is(err, pgx.ErrNoRows) {
		return Viewing{}, false, nil
	}
	return v, err == nil, err
}

// StopAll ends viewing in every session of the admin (signing out ends all of them) and
// returns what was still going on.
func (s *ViewAs) StopAll(ctx context.Context, admin string) ([]Viewing, error) {
	rows, err := s.Pool.Query(ctx, `delete from viewing_as where email = $1 returning `+viewingColumns, strings.ToLower(strings.TrimSpace(admin)))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Viewing, error) { return scanViewing(r) })
}
