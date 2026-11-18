package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/embedding"
	"github.com/kubek80/process-manager/server/internal/retrieval"
)

// stuck is the built-in embedder behind a provider that hangs until released, or fails.
type stuck struct {
	embedding.Embedder
	gate chan struct{}
	fail bool
}

func (s *stuck) Embed(ctx context.Context, texts []string, p embedding.Purpose) ([][]float32, error) {
	if s.fail {
		return nil, errors.New("embeddings: Vertex AI could not be reached")
	}
	select {
	case <-s.gate:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return s.Embedder.Embed(ctx, texts, p)
}

func withEmbedder(t *testing.T, e embedding.Embedder) {
	old := newEmbedder
	newEmbedder = func(context.Context, embedding.Options) (embedding.Embedder, error) { return e, nil }
	t.Cleanup(func() { newEmbedder = old })
}

func freeAddr(t *testing.T) string {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

func TestTheServerListensWhileTheProviderHangs(t *testing.T) {
	pool := filledPool(t)
	s := &stuck{Embedder: embedding.Builtin(768), gate: make(chan struct{})}
	withEmbedder(t, s)
	addr := freeAddr(t)
	t.Setenv("PM_ADDR", addr)
	stopCtx, stopServer := context.WithCancel(context.Background())
	old := startContext
	startContext = func() (context.Context, context.CancelFunc) { return stopCtx, stopServer }
	t.Cleanup(func() { startContext = old })

	start := time.Now()
	done := make(chan error, 1)
	go func() {
		_, err := runWith(t, pool, options{})
		done <- err
	}()
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, Timeout: 5 * time.Second}
	base := "http://" + addr
	for {
		if r, err := c.Get(base + "/healthz"); err == nil {
			r.Body.Close()
			break
		}
		if time.Since(start) > 10*time.Second {
			t.Fatal("the server does not listen while the provider hangs")
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Logf("listening after %s with a provider that hangs", time.Since(start).Round(time.Millisecond))
	if took := time.Since(start); took > 5*time.Second {
		t.Fatalf("listening only after %s", took)
	}
	req, _ := http.NewRequest("POST", base+"/auth/dev/login", strings.NewReader(`{"email":"sam@example.com"}`))
	req.Header.Set("X-Requested-With", "process-manager")
	if r, err := c.Do(req); err != nil || r.StatusCode != 200 {
		t.Fatalf("sign in: %v %v", r, err)
	}
	search := func() int {
		r, err := c.Get(base + "/api/search?q=google+cloud+project")
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		return r.StatusCode
	}
	if status := search(); status != 503 {
		t.Fatalf("search while the index is built: %d", status)
	}
	close(s.gate) // the provider answers again
	for status := search(); status != 200; status = search() {
		if time.Since(start) > 20*time.Second {
			t.Fatalf("search after the provider came back: %d", status)
		}
		time.Sleep(50 * time.Millisecond)
	}
	stopServer()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("the server did not stop")
	}
}

func TestMigrateSucceedsWhileTheProviderIsDown(t *testing.T) {
	pool := filledPool(t)
	withEmbedder(t, &stuck{Embedder: embedding.Builtin(768), fail: true})
	out, err := runWith(t, pool, options{migrate: true})
	want := "  Search:  not brought up to date: the embeddings provider cannot be reached; the server catches it up later\n"
	if err != nil || !strings.Contains(out, want) || !strings.HasSuffix(out, "Done.\n") {
		t.Fatalf("%v\n%s", err, out)
	}
	var pending int
	if err := pool.QueryRow(ctx, `select count(*) from search_pending`).Scan(&pending); err != nil || pending != 10 {
		t.Fatalf("pending: %d %v", pending, err)
	}
	// -reindex says it failed
	if _, err := runWith(t, pool, options{reindex: true}); err == nil {
		t.Fatal("-reindex succeeded while the provider is down")
	}
}

func TestStartingWithSearchOffMarksAnOldIndexAsUnused(t *testing.T) {
	pool := filledPool(t)
	if _, err := runWith(t, pool, options{reindex: true}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PM_EMBEDDINGS", "off")
	st := storesOf(pool)
	var buf strings.Builder
	log := logTo(&buf)
	if err := prepareIndex(ctx, stores{docs: st.docs, index: offIndex(pool, st)}, log); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "marked as not in use") {
		t.Fatalf("log: %s", buf.String())
	}
	var complete bool
	if err := pool.QueryRow(ctx, `select complete from search_settings`).Scan(&complete); err != nil || complete {
		t.Fatalf("complete: %v %v", complete, err)
	}
}

func logTo(b *strings.Builder) *slog.Logger { return slog.New(slog.NewTextHandler(b, nil)) }

func offIndex(pool *pgxpool.Pool, st stores) *retrieval.Index {
	return retrieval.New(pool, st.docs, nil, chunking.Options{}, quiet)
}
