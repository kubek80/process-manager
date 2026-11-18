package requests

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
)

var ctx = context.Background()

func TestRequestsVotesAndStates(t *testing.T) {
	s := &Store{Pool: dbtest.NewPool(t)}
	q, err := s.Create(ctx, New{Kind: "process", Title: "A title", Description: "Something needed", ByEmail: " Sam@Example.com", ByName: "Sam"}, 0)
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

func TestTheBrakeHoldsForParallelRequestsAndWithdrawals(t *testing.T) {
	s := &Store{Pool: dbtest.NewPool(t)}
	n := New{Kind: "process", Title: "A title", Description: "Something needed", ByEmail: "sam@example.com", ByName: "Sam"}
	var wg sync.WaitGroup
	var mu sync.Mutex
	stored, refused := 0, 0
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Create(ctx, n, 10)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				stored++
			case errors.Is(err, ErrTooMany):
				refused++
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if stored != 10 || refused != 30 {
		t.Fatalf("stored %d, refused %d", stored, refused)
	}
	// withdrawing does not free a place in the hour
	list, _ := s.List(ctx, "sam@example.com")
	for _, q := range list {
		if err := s.Delete(ctx, q.ID, true); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Create(ctx, n, 10); !errors.Is(err, ErrTooMany) {
		t.Fatalf("after withdrawing: %v", err)
	}
	// somebody else is not held back, and an hour later it is fine again
	other := n
	other.ByEmail = "alex@example.com"
	if _, err := s.Create(ctx, other, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `update requests_removed set created_at = created_at - interval '61 minutes'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, n, 10); err != nil {
		t.Fatalf("an hour later: %v", err)
	}
}

func TestADeletedAnswerIsMarkedGone(t *testing.T) {
	s := &Store{Pool: dbtest.NewPool(t)}
	q, _ := s.Create(ctx, New{Kind: "process", Title: "A title", Description: "Something needed", ByEmail: "sam@example.com"}, 0)
	other, _ := s.Create(ctx, New{Kind: "standard", Title: "A title", Description: "Something needed", ByEmail: "sam@example.com"}, 0)
	if _, err := s.SetState(ctx, q.ID, Done, "", "p", "Alex", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetState(ctx, other.ID, Done, "", "p", "Alex", ""); err != nil {
		t.Fatal(err)
	}
	if err := AnswerGoneIn(ctx, s.Pool, "process", "p"); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, q.ID, "")
	if got.State != Done || got.LinkedID != "" || !got.LinkedGone {
		t.Fatalf("%+v", got)
	}
	if got, _ := s.Get(ctx, other.ID, ""); got.LinkedID != "p" || got.LinkedGone {
		t.Fatalf("a standard with the same id: %+v", got)
	}
	// marked done again with another answer, it is no longer gone
	got, _ = s.SetState(ctx, q.ID, Done, "", "q", "Alex", "")
	if got.LinkedGone || got.LinkedID != "q" {
		t.Fatalf("%+v", got)
	}
	if err := s.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.List(ctx, ""); len(list) != 0 {
		t.Fatal("reset left requests")
	}
}
