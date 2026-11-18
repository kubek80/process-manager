package retrieval

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
)

// hang makes every call of the fake wait until release is called.
func (f *fake) hang() (release func()) {
	gate := make(chan struct{})
	f.mu.Lock()
	f.gate, f.entered = gate, make(chan struct{}, 100)
	f.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			close(gate)
			f.mu.Lock()
			f.gate = nil
			f.mu.Unlock()
		})
	}
}

func (f *fake) waitEntered(t *testing.T) {
	t.Helper()
	select {
	case <-f.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("the provider was not called")
	}
}

func TestAHangingProviderHoldsNoDatabaseConnection(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	build(t, ix)
	release := f.hang()
	defer release()

	// more syncs waiting for the provider than the pool has connections
	n := int(pool.Config().MaxConns) + 3
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		edit(t, store, docs.Standard, "secure-logging", `"title": "Secure logging`, `"title": "Secure logging!`)
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = ix.Sync(bg, docs.Standard, "secure-logging")
		}()
		f.waitEntered(t)
	}
	// and a search for a question not asked before
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = ix.Search(bg, "a question never asked", 5)
	}()
	f.waitEntered(t)

	if busy := pool.Stat().AcquiredConns(); busy != 0 {
		t.Fatalf("%d connections are held while the provider is waited for", busy)
	}
	ctx, cancel := context.WithTimeout(bg, 2*time.Second)
	defer cancel()
	if _, err := store.Get(ctx, docs.Process, "request-gcp-project"); err != nil {
		t.Fatalf("the database is not usable while the provider hangs: %v", err)
	}
	release()
	wg.Wait()
	var title string
	must(t, pool.QueryRow(bg, `select label from search_chunks where doc_id = 'secure-logging' and part = 'requirement' limit 1`).Scan(&title))
	if n, _ := ix.Pending(bg); n != 0 {
		t.Fatalf("pending after the provider came back: %d", n)
	}
}

func TestAProviderThatNeverAnswersIsGivenUpOn(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	build(t, ix)
	ix.embedBudget = 100 * time.Millisecond
	release := f.hang()
	defer release()
	edit(t, store, docs.Standard, "secure-logging", `"title": "Secure logging`, `"title": "Secure logging today`)
	start := time.Now()
	err := ix.Sync(bg, docs.Standard, "secure-logging")
	if !errors.Is(err, ErrProvider) || time.Since(start) > 2*time.Second || !strings.Contains(err.Error(), "no answer within 100ms") {
		t.Fatalf("after %s: %v", time.Since(start), err)
	}
	if strings.Count(err.Error(), "could not be reached") > 1 {
		t.Fatalf("the message repeats itself: %v", err)
	}
	if n, _ := ix.Pending(bg); n != 1 {
		t.Fatalf("pending: %d", n)
	}
}

func TestADocumentThatChangesWhileItIsEmbeddedIsReadAgain(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	build(t, ix)

	// changed meanwhile: the newer text is stored
	release := f.hang()
	edit(t, store, docs.Standard, "secure-logging", `"summary": "What services`, `"summary": "First change. What services`)
	done := make(chan error, 1)
	go func() { done <- ix.Sync(bg, docs.Standard, "secure-logging") }()
	f.waitEntered(t)
	edit(t, store, docs.Standard, "secure-logging", `"summary": "First change.`, `"summary": "Second change.`)
	release()
	must(t, <-done)
	var snippet string
	must(t, pool.QueryRow(bg, `select snippet from search_chunks where doc_id = 'secure-logging' and part = 'summary'`).Scan(&snippet))
	if !strings.HasPrefix(snippet, "Second change.") {
		t.Fatalf("summary: %q", snippet)
	}

	// a draft meanwhile: nothing is written, its parts are gone
	release = f.hang()
	edit(t, store, docs.Standard, "secure-logging", `"summary": "Second change.`, `"summary": "Third change.`)
	go func() { done <- ix.Sync(bg, docs.Standard, "secure-logging") }()
	f.waitEntered(t)
	edit(t, store, docs.Standard, "secure-logging", `"status": "active"`, `"status": "draft"`)
	release()
	must(t, <-done)
	if n := chunkCount(t, pool, `where doc_id = 'secure-logging'`); n != 0 {
		t.Fatalf("a draft keeps %d parts", n)
	}
}

func TestAServerWithOtherSettingsWritesNothing(t *testing.T) {
	pool, store := filled(t, false)
	a := newFake()
	old := New(pool, store, a, chunking.Options{}, quiet)
	build(t, old)

	b := newFake()
	b.name = "vertex:other"
	switched := New(pool, store, b, chunking.Options{}, quiet)
	build(t, switched)
	hashes := func() string {
		var s string
		must(t, pool.QueryRow(bg, `select string_agg(content_hash, ',' order by kind, doc_id, part, item, seq) from search_chunks`).Scan(&s))
		return s
	}
	before := hashes()

	// the old server, still running, saves
	edit(t, store, docs.Standard, "secure-logging", `"summary": "What services`, `"summary": "Changed. What services`)
	err := old.Sync(bg, docs.Standard, "secure-logging")
	if !errors.Is(err, ErrOtherSettings) {
		t.Fatalf("sync of the old server: %v", err)
	}
	if hashes() != before {
		t.Fatal("the old server wrote into the new index")
	}
	if n, _ := switched.Pending(bg); n != 1 {
		t.Fatalf("not marked for the new index: %d", n)
	}
	if _, err := old.Search(bg, "logs", 5); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("search of the old server: %v", err)
	}
	// the owner picks the change up, embedding only what changed
	b.reset()
	if n, err := switched.Retry(bg); n != 1 || err != nil {
		t.Fatalf("retry: %d %v", n, err)
	}
	if _, texts := b.counts(); texts != 1 {
		t.Fatalf("embedded %d texts", texts)
	}

	// vectors are told apart by provider and size, not only by text
	if old.hashOf("x") == switched.hashOf("x") {
		t.Fatal("the same hash for two providers")
	}
}

func TestNewSettingsDropNothingWhileTheNewProviderIsDown(t *testing.T) {
	pool, store := filled(t, false)
	a := newFake()
	old := New(pool, store, a, chunking.Options{}, quiet)
	build(t, old)
	parts := chunkCount(t, pool, "")

	b := newFake()
	b.dims = 32
	b.setFail(true)
	next := New(pool, store, b, chunking.Options{}, quiet)
	must(t, next.Ensure(bg)) // quick, drops nothing
	if _, err := next.CatchUp(bg); !errors.Is(err, ErrProvider) {
		t.Fatalf("catch up: %v", err)
	}
	if n := chunkCount(t, pool, ""); n != parts {
		t.Fatalf("the old index lost parts: %d of %d", n, parts)
	}
	if r, err := old.Search(bg, "secrets passwords tokens logs", 5); err != nil || len(r) == 0 {
		t.Fatalf("the old index is not searchable any more: %v %v", r, err)
	}
	if err := next.Ready(bg); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("the new server is ready: %v", err)
	}
	b.setFail(false)
	if _, err := next.CatchUp(bg); err != nil {
		t.Fatal(err)
	}
	must(t, next.Ready(bg))
	if err := old.Ready(bg); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("the old server still searches: %v", err)
	}
}

func TestAnIndexNobodyKeepsUpToDateIsNotSearched(t *testing.T) {
	pool, store := filled(t, false)
	ix := New(pool, store, newFake(), chunking.Options{}, quiet)
	build(t, ix)
	off := New(pool, store, nil, chunking.Options{}, quiet)
	if was, err := off.MarkUnused(bg); err != nil || !was {
		t.Fatalf("mark unused: %v %v", was, err)
	}
	if was, _ := off.MarkUnused(bg); was {
		t.Fatal("marked twice")
	}
	if _, err := ix.Search(bg, "logs", 5); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("search of an index not in use: %v", err)
	}
	// switched on again: caught up, then searched
	must(t, ix.Ensure(bg))
	if err := ix.Ready(bg); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("ready before catching up: %v", err)
	}
	_, err := ix.CatchUp(bg)
	must(t, err)
	must(t, ix.Ready(bg))
	// nothing to mark on a database without an index
	empty := New(dbtest.NewPool(t), store, nil, chunking.Options{}, quiet)
	if was, err := empty.MarkUnused(bg); was || err != nil {
		t.Fatalf("empty: %v %v", was, err)
	}
}

func TestTruncatedAndTheFloor(t *testing.T) {
	pool, store := filled(t, false)
	ix := New(pool, store, newFake(), chunking.Options{}, quiet)
	build(t, ix)
	all, err := ix.SearchPage(bg, "process request project", MaxLimit)
	must(t, err)
	if all.Truncated || len(all.Results) < 2 {
		t.Fatalf("all: %d %v", len(all.Results), all.Truncated)
	}
	one, err := ix.SearchPage(bg, "process request project", 1)
	must(t, err)
	if !one.Truncated || len(one.Results) != 1 || one.Results[0].ID != all.Results[0].ID {
		t.Fatalf("one: %+v", one)
	}
	ix.SetMinScore(0.999)
	if r, _ := ix.Search(bg, "process request project", 50); len(r) != 0 {
		t.Fatalf("above the floor: %d", len(r))
	}
	ix.SetMinScore(0)
	if r, _ := ix.Search(bg, "process request project", 50); len(r) < len(all.Results) {
		t.Fatalf("floor 0: %d", len(r))
	}
}
