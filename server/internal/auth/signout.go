package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SignOuts remembers when a person last signed out. Session cookies are stateless, so without
// this a copy of a cookie would keep working until it expires. Signing out ends every session
// of that person, on every device.
//
// A session counts when it was issued at or after the recorded moment. That moment is a whole
// millisecond later than "now" by the later of two clocks (this server's and the database's),
// so that it is after every session issued so far, also by another instance whose clock runs
// a little ahead. A sign-in that follows is issued no earlier than it (see Sessions.Issue).
type SignOuts struct{ Pool *pgxpool.Pool }

// Mark records that the person signed out now and returns the recorded moment.
func (s *SignOuts) Mark(ctx context.Context, email string, now time.Time) (time.Time, error) {
	var at time.Time
	err := s.Pool.QueryRow(ctx, `insert into signed_out (email, at)
		values ($1, date_trunc('milliseconds', greatest(now(), $2::timestamptz)) + interval '1 millisecond')
		on conflict (email) do update set at = greatest(signed_out.at, excluded.at) returning at`, strings.ToLower(email), now).Scan(&at)
	return at, err
}

// At returns the moment before which the sessions of a person no longer count; the zero time
// when they never signed out.
func (s *SignOuts) At(ctx context.Context, email string) (time.Time, error) {
	var at time.Time
	err := s.Pool.QueryRow(ctx, `select at from signed_out where email = $1`, strings.ToLower(email)).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	return at, err
}

// Ended reports whether a session issued at the given moment was ended by a later sign-out.
func (s *SignOuts) Ended(ctx context.Context, email string, issued time.Time) (bool, error) {
	at, err := s.At(ctx, email)
	if err != nil {
		return false, err
	}
	return issued.Before(at), nil
}
