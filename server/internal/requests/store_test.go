package requests

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
)

var ctx = context.Background()

func TestRequestsVotesAndStates(t *testing.T) {
	s := &Store{Pool: dbtest.NewPool(t)}
	q, err := s.Create(ctx, New{Kind: "process", Title: "A title", Description: "Something needed", ByEmail: " Sam@Example.com", ByName: "Sam"})
	if err != nil {
		t.Fatal(err)
	}
	if q.ByEmail != "sam@example.com" || q.State != Open || q.StateAt != nil || q.Votes != 0 {
		t.Fatalf("%+v", q)
	}
	if n, _ := s.CountSince(ctx, "SAM@example.com", time.Now().Add(-time.Minute)); n != 1 {
		t.Fatalf("count: %d", n)
	}
	for _, email := range []string{"Alex@example.com", "alex@example.com", "riley@example.com"} {
		if _, err := s.SetVote(ctx, q.ID, email, true); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := s.Get(ctx, q.ID, "ALEX@example.com")
	if got.Votes != 2 || !got.VotedByMe {
		t.Fatalf("%+v", got)
	}
	got, err = s.SetState(ctx, q.ID, Planned, "soon", "ignored", "Alex", "sam@example.com")
	if err != nil || got.State != Planned || got.LinkedID != "" || got.StateAt == nil || got.StateBy != "Alex" {
		t.Fatalf("%+v %v", got, err)
	}
	if err := s.Delete(ctx, q.ID, true); !errors.Is(err, ErrNotOpen) {
		t.Fatalf("withdrawing a planned request: %v", err)
	}
	if err := s.Delete(ctx, q.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetVote(ctx, q.ID, "sam@example.com", true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("vote on a deleted request: %v", err)
	}
	if err := s.Delete(ctx, q.ID, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete twice: %v", err)
	}
	var votes int
	if err := s.Pool.QueryRow(ctx, `select count(*) from request_votes`).Scan(&votes); err != nil || votes != 0 {
		t.Fatalf("votes left: %d %v", votes, err)
	}
	if _, err := s.SetState(ctx, q.ID, Open, "", "", "x", "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("state of a deleted request: %v", err)
	}
}
