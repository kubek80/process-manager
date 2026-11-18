package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
	"github.com/kubek80/process-manager/server/internal/retrieval"
)

// flaky is the built-in embedder that can be made to fail like an unreachable provider.
type flaky struct {
	embedding.Embedder
	down atomic.Bool
	// hanging: every call waits until the channel is closed or the call's time is up
	hanging atomic.Pointer[chan struct{}]
}

func (f *flaky) Embed(ctx context.Context, texts []string, p embedding.Purpose) ([][]float32, error) {
	if gate := f.hanging.Load(); gate != nil {
		select {
		case <-*gate:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.down.Load() {
		return nil, errors.New("connection refused")
	}
	return f.Embedder.Embed(ctx, texts, p)
}

// hang makes the provider hang until the returned function is called.
func (f *flaky) hang() func() {
	gate := make(chan struct{})
	f.hanging.Store(&gate)
	return func() { f.hanging.Store(nil); close(gate) }
}

// withSearch switches search by meaning on, with the built-in embedder, and builds the index.
func withSearch(t *testing.T, f *flaky) func(*Deps) {
	return func(d *Deps) {
		d.Index = retrieval.New(d.Docs.Pool, d.Docs, f, chunking.Options{}, d.Log)
		must(t, d.Index.Ensure(bg))
		_, err := d.Index.CatchUp(bg)
		must(t, err)
	}
}

func searchIDs(t *testing.T, c *client, q string) []string {
	t.Helper()
	status, body := c.do("GET", "/api/search?q="+strings.ReplaceAll(q, " ", "+"), nil)
	wantStatus(t, status, 200, body)
	out := []string{}
	for _, r := range body["results"].([]any) {
		out = append(out, r.(map[string]any)["id"].(string))
	}
	return out
}

// eventually polls a search until ok says it shows what is expected: the index follows a save in
// the background, as the browser tests poll for it.
func eventually(t *testing.T, c *client, q string, ok func([]string) bool) []string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		ids := searchIDs(t, c, q)
		if ok(ids) || time.Now().After(deadline) {
			return ids
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func has(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func TestSearchByMeaningIsOffByDefault(t *testing.T) {
	e := setup(t, nil)
	_, me := e.anonymous().do("GET", "/api/me", nil)
	if fmt.Sprint(me["search"]) != "map[meaning:false outside:false]" {
		t.Fatalf("me: %v", me["search"])
	}
	status, body := e.as(sam).do("GET", "/api/search?q=project", nil)
	wantError(t, status, body, 404, "Search by meaning is not switched on.")
}

func TestSearchByMeaning(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	e := setup(t, withSearch(t, f))
	_, me := e.as(sam).do("GET", "/api/me", nil)
	if fmt.Sprint(me["search"]) != "map[meaning:true outside:false provider:builtin]" {
		t.Fatalf("me: %v", me["search"])
	}
	if status, _ := e.anonymous().do("GET", "/api/search?q=project", nil); status != 401 {
		t.Fatalf("anonymous: %d", status)
	}

	s := e.as(sam)
	status, body := s.do("GET", "/api/search?q=how+do+I+get+a+google+cloud+project&limit=3", nil)
	wantStatus(t, status, 200, body)
	results := body["results"].([]any)
	if len(results) == 0 || len(results) > 3 {
		t.Fatalf("results: %v", results)
	}
	first := results[0].(map[string]any)
	if first["kind"] != "process" || first["id"] != gcp || first["score"].(float64) <= 0 || first["score"].(float64) > 1 {
		t.Fatalf("first: %v", first)
	}
	if body["truncated"] != true {
		t.Fatalf("truncated with limit 3: %v", body["truncated"])
	}
	if _, ok := first["status"]; ok || len(first) != 4 {
		t.Fatalf("fields of a result: %v", first)
	}
	hit := first["hits"].([]any)[0].(map[string]any)
	for _, key := range []string{"part", "item", "label", "snippet", "score"} {
		if _, ok := hit[key]; !ok || len(hit) != 5 {
			t.Fatalf("hit lacks %s: %v", key, hit)
		}
	}
	if hit["score"] != first["score"] {
		t.Fatalf("the score of a document is that of its best part: %v", first)
	}

	status, body = s.do("GET", "/api/search?q=+", nil)
	wantStatus(t, status, 200, body)
	if fmt.Sprint(body) != "map[results:[] truncated:false]" {
		t.Fatalf("empty question: %v", body)
	}
	for _, bad := range []string{"0", "501", "ten"} {
		status, body = s.do("GET", "/api/search?q=x&limit="+bad, nil)
		wantError(t, status, body, 400, "Ask for 1 to 500 results.")
	}
	status, body = s.do("GET", "/api/search?q=google+cloud+project&limit=500", nil)
	wantStatus(t, status, 200, body)
	if body["truncated"] != false {
		t.Fatalf("truncated with limit 500: %v", body["truncated"])
	}
	status, body = s.do("GET", "/api/search?q="+strings.Repeat("a", 1001), nil)
	wantStatus(t, status, 400, body)

	// the provider cannot be reached
	f.down.Store(true)
	status, body = s.do("GET", "/api/search?q=a+question+never+asked", nil)
	wantError(t, status, body, 502, "Search by meaning is not available right now. Try again in a moment, or search by words.")
	f.down.Store(false)
}

func TestSearchNeverReturnsADraftOrSomethingDeleted(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	e := setup(t, withSearch(t, f))
	const q = "google cloud project"
	if ids := searchIDs(t, e.as(sam), q); !has(ids, gcp) {
		t.Fatalf("not found: %v", ids)
	}
	// a draft: gone at once, for everyone - also for its owners, who can see the draft
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"status": "active"`, `"status": "draft"`))
	wantStatus(t, status, 200, body)
	for _, who := range []string{sam, casey, alex, dana} {
		if ids := searchIDs(t, e.as(who), q); has(ids, gcp) {
			t.Fatalf("%s finds the draft: %v", who, ids)
		}
	}
	// published again
	status, body = e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"status": "draft"`, `"status": "active"`))
	wantStatus(t, status, 200, body)
	if ids := eventually(t, e.as(sam), q, func(ids []string) bool { return has(ids, gcp) }); !has(ids, gcp) {
		t.Fatalf("published again, not found: %v", ids)
	}
	// a new process can be found as soon as it is saved
	fresh := strings.NewReplacer(`"id": "request-gcp-project"`, `"id": "order-office-plants"`, "Request a GCP project", "Order office plants for the team").Replace(e.body(docs.Process, gcp, "", ""))
	status, body = e.as(alex).do("PUT", "/api/processes/order-office-plants?base=0", fresh)
	wantStatus(t, status, 200, body)
	first := func(ids []string) bool { return len(ids) > 0 && ids[0] == "order-office-plants" }
	if ids := eventually(t, e.as(sam), "office plants", first); !first(ids) {
		t.Fatalf("a new process: %v", ids)
	}
	// deleted: gone at once
	status, body = e.as(alex).do("DELETE", "/api/processes/order-office-plants", nil)
	wantStatus(t, status, 200, body)
	if ids := searchIDs(t, e.as(sam), "office plants"); has(ids, "order-office-plants") {
		t.Fatalf("a deleted process: %v", ids)
	}
	var n int
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		must(t, e.deps.Docs.Pool.QueryRow(bg, `select count(*) from search_chunks where doc_id = 'order-office-plants'`).Scan(&n))
		if n == 0 {
			break
		}
	}
	if n != 0 {
		t.Fatalf("parts of a deleted process left: %d", n)
	}
}

func TestASaveWorksWhileTheProviderIsDown(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	e := setup(t, func(d *Deps) { withSearch(t, f)(d); d.Background = &sync.WaitGroup{} })
	f.down.Store(true)
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, "Request a GCP project", "Request a Google Cloud project"))
	wantStatus(t, status, 200, body)
	e.deps.Background.Wait()
	if !strings.Contains(e.logged.String(), "search by meaning: the search index could not be brought up to date") {
		t.Fatalf("not logged:\n%s", e.logged.String())
	}
	if n, _ := e.deps.Index.Pending(bg); n != 1 {
		t.Fatalf("pending: %d", n)
	}
	f.down.Store(false)
	if n, err := e.deps.Index.Retry(bg); n != 1 || err != nil {
		t.Fatalf("retry: %d %v", n, err)
	}
}

func TestOnePersonCannotSearchWithoutEnd(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	e := setup(t, withSearch(t, f))
	s := e.as(sam)
	for i := 0; i < searchesPerMinute; i++ {
		if status, body := s.do("GET", "/api/search?q=project", nil); status != 200 {
			t.Fatalf("search %d: %d %v", i+1, status, body)
		}
	}
	status, body := s.do("GET", "/api/search?q=project", nil)
	wantError(t, status, body, 429, "You have searched very often in the last minute. Wait a moment, then try again.")
	// somebody else still can
	if status, _ := e.as(alex).do("GET", "/api/search?q=project", nil); status != 200 {
		t.Fatalf("another person: %d", status)
	}
}

func TestBrakeWindow(t *testing.T) {
	b := newBrake(2, time.Minute)
	now := time.Unix(1000, 0)
	if !b.allow("a", now) || !b.allow("a", now) || b.allow("a", now) {
		t.Fatal("the third in a minute was allowed")
	}
	if !b.allow("b", now) {
		t.Fatal("another person was refused")
	}
	if !b.allow("a", now.Add(time.Minute)) {
		t.Fatal("refused after the minute")
	}
}

// A provider that hangs must not slow down saves, nor take the database from the rest of the portal.
func TestAHangingProviderNeitherSlowsASaveNorBlocksThePortal(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	var background sync.WaitGroup
	e := setup(t, func(d *Deps) { withSearch(t, f)(d); d.Background = &background })
	release := f.hang()
	editor := e.as(alex)
	n := int(e.deps.Docs.Pool.Config().MaxConns) + 2
	for i := 0; i < n; i++ {
		start := time.Now()
		status, body := editor.do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, "Request a GCP project", fmt.Sprintf("Request a GCP project (%d)", i)))
		wantStatus(t, status, 200, body)
		if took := time.Since(start); took > 3*time.Second {
			t.Fatalf("save %d took %s while the provider hangs", i+1, took)
		}
	}
	// every page still works
	for _, path := range []string{"/api/processes", "/api/me", "/api/catalog"} {
		if status, body := e.as(sam).do("GET", path, nil); status != 200 {
			t.Fatalf("%s while the provider hangs: %d %v", path, status, body)
		}
	}
	release()
	background.Wait()
	if ids := searchIDs(t, e.as(sam), "google cloud project"); !has(ids, gcp) {
		t.Fatalf("not found after the provider came back: %v", ids)
	}
}

func TestSearchWhileTheIndexIsNotReady(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	e := setup(t, func(d *Deps) {
		d.Index = retrieval.New(d.Docs.Pool, d.Docs, f, chunking.Options{}, d.Log)
		must(t, d.Index.Ensure(bg)) // built in the background, not yet done
	})
	status, body := e.as(sam).do("GET", "/api/search?q=project", nil)
	wantError(t, status, body, 503, "Search by meaning is not ready yet. Try again in a moment, or search by words.")
}
