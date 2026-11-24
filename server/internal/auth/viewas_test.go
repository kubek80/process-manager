package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
)

func TestViewAsIsOnePersonPerSessionUntilStopped(t *testing.T) {
	ctx := context.Background()
	v := &ViewAs{Pool: dbtest.NewPool(t)}
	now := time.Now().UTC().Truncate(time.Millisecond)
	got, err := v.Start(ctx, "Dana@Example.com", "s1", "Casey@example.com", "Casey Owner", now)
	if err != nil || got.Admin != "dana@example.com" || got.Target != "casey@example.com" || !got.Until.Equal(now.Add(ViewAsFor)) {
		t.Fatalf("start: %+v %v", got, err)
	}
	// neither switched nor started again in the same session
	for _, target := range []string{"jordan@example.com", "casey@example.com"} {
		if _, err := v.Start(ctx, "dana@example.com", "s1", target, "", now); !errors.Is(err, ErrAlreadyViewing) {
			t.Fatalf("second start as %s: %v", target, err)
		}
	}
	if cur, on, err := v.Of(ctx, "dana@example.com", "s1"); err != nil || !on || cur.Target != "casey@example.com" {
		t.Fatalf("of: %+v %v %v", cur, on, err)
	}
	// another session of the same admin is its own
	if _, on, _ := v.Of(ctx, "dana@example.com", "s2"); on {
		t.Fatal("another session views too")
	}
	if _, err := v.Start(ctx, "dana@example.com", "s2", "jordan@example.com", "", now); err != nil {
		t.Fatal(err)
	}
	// stopped once
	if _, stopped, err := v.Stop(ctx, "dana@example.com", "s1"); err != nil || !stopped {
		t.Fatalf("stop: %v %v", stopped, err)
	}
	if _, stopped, _ := v.Stop(ctx, "dana@example.com", "s1"); stopped {
		t.Fatal("stopped twice")
	}
	list, err := v.StopAll(ctx, "DANA@example.com")
	if err != nil || len(list) != 1 || list[0].Target != "jordan@example.com" {
		t.Fatalf("stop all: %+v %v", list, err)
	}
	// a row whose session has certainly ended is cleared by the next start
	if _, err := v.Start(ctx, "alex@example.com", "old", "casey@example.com", "", now.Add(-26*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Start(ctx, "dana@example.com", "s3", "casey@example.com", "", now); err != nil {
		t.Fatal(err)
	}
	if _, on, _ := v.Of(ctx, "alex@example.com", "old"); on {
		t.Fatal("a row of a long-ended session is still there")
	}
}

func TestEverySessionHasItsOwnID(t *testing.T) {
	s := NewSessions([]byte("secret"), false)
	ids := map[string]bool{}
	for i := 0; i < 3; i++ {
		rec := httptestRecorder()
		s.Issue(rec, User{Email: "dana@example.com", Name: "Dana"})
		req := requestWith(rec)
		ses, ok := s.ReadSession(req)
		if !ok || len(ses.ID) < 20 || ids[ses.ID] {
			t.Fatalf("session %d: %+v %v", i, ses, ok)
		}
		ids[ses.ID] = true
	}
}

func httptestRecorder() *httptest.ResponseRecorder { return httptest.NewRecorder() }

func requestWith(rec *httptest.ResponseRecorder) *http.Request {
	req := httptest.NewRequest("GET", "/", nil)
	for _, c := range rec.Result().Cookies() {
		req.AddCookie(c)
	}
	return req
}
