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
type SignOuts struct{ Pool *pgxpool.Pool }

// Mark records that the person signed out at the given moment.
func (s *SignOuts) Mark(ctx context.Context, email string, at time.Time) error {
	_, err := s.Pool.Exec(ctx, `insert into signed_out (email, at) values ($1, $2)
		on conflict (email) do update set at = greatest(signed_out.at, excluded.at)`, strings.ToLower(email), at)
	return err
}

// Ended reports whether a session issued at the given moment was ended by a later sign-out.
func (s *SignOuts) Ended(ctx context.Context, email string, issued time.Time) (bool, error) {
	var at time.Time
	err := s.Pool.QueryRow(ctx, `select at from signed_out where email = $1`, strings.ToLower(email)).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return !issued.After(at), nil
}
