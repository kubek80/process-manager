package retrieval

import (
	"context"
	"errors"
	"hash/fnv"
	"io"
	"log/slog"
	"math"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

var bg = context.Background()

const repoRoot = "../../.."

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// fake is an embedder for tests: words hashed into a small vector, so texts that share words
// are close. It counts what it is asked and can be made to fail.
type fake struct {
	mu    sync.Mutex
	name  string
	dims  int
	calls int
	texts int
	fail  bool
}

func newFake() *fake { return &fake{name: "fake", dims: 64} }

func (f *fake) Name() string    { return f.name }
func (f *fake) Dimensions() int { return f.dims }
func (f *fake) Outside() bool   { return false }

func (f *fake) Embed(_ context.Context, texts []string, _ embedding.Purpose) ([][]float32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail {
		return nil, errors.New("connection refused")
	}
	f.calls++
	f.texts += len(texts)
	out := make([][]float32, len(texts))
	for i, t := range texts {
		v := make([]float32, f.dims)
		for _, w := range strings.Fields(strings.ToLower(t)) {
			w = strings.Trim(w, ".,:;()“”\"'?!")
			if len(w) < 3 {
				continue
			}
			h := fnv.New32a()
			_, _ = h.Write([]byte(w))
			v[h.Sum32()%uint32(f.dims)]++
		}
		v[0] += 0.01 // never all zero
		var n float64
		for _, x := range v {
			n += float64(x) * float64(x)
		}
		for j := range v {
			v[j] = float32(float64(v[j]) / math.Sqrt(n))
		}
		out[i] = v
	}
	return out, nil
}

func (f *fake) counts() (calls, texts int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls, f.texts
}

func (f *fake) reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls, f.texts = 0, 0
}

func (f *fake) setFail(v bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.fail = v
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// filled is a migrated database with the sample content (and the demo set when demo is true).
func filled(t *testing.T, demo bool) (*pgxpool.Pool, *docs.Store) {
	t.Helper()
	pool := dbtest.NewPool(t)
	store := &docs.Store{Pool: pool}
	dirs := []string{repoRoot}
	if demo {
		dirs = append(dirs, repoRoot+"/demo")
	}
	for _, dir := range dirs {
		if _, problems, err := store.ImportDir(bg, dir, "import", nil); err != nil || len(problems) > 0 {
			t.Fatalf("import %s: %v %v", dir, problems, err)
		}
	}
	return pool, store
}

func chunkCount(t *testing.T, pool *pgxpool.Pool, where string, args ...any) int {
	t.Helper()
	var n int
	must(t, pool.QueryRow(bg, `select count(*) from search_chunks `+where, args...).Scan(&n))
	return n
}

// expected is the number of parts the chunker makes of everything published.
func expected(t *testing.T, store *docs.Store, o chunking.Options) int {
	t.Helper()
	lists, err := store.Lists(bg)
	must(t, err)
	n := 0
	for _, kind := range []string{docs.Process, docs.Standard} {
		list, err := store.List(bg, kind)
		must(t, err)
		for _, d := range list {
			if tg, _ := docs.TargetOf(d); tg.Status == "draft" {
				continue
			}
			cs, err := chunking.Chunks(kind, d.Body, lists, o)
			must(t, err)
			n += len(cs)
		}
	}
	return n
}

func edit(t *testing.T, store *docs.Store, kind, id, from, to string) {
	t.Helper()
	d, err := store.Get(bg, kind, id)
	must(t, err)
	if !strings.Contains(string(d.Body), from) {
		t.Fatalf("%s %s does not contain %q", kind, id, from)
	}
	_, changed, err := store.Put(bg, kind, id, []byte(strings.Replace(string(d.Body), from, to, 1)), "test")
	must(t, err)
	if !changed {
		t.Fatal("nothing changed")
	}
}

func TestSwitchedOffIsSafe(t *testing.T) {
	var nilIndex *Index
	off := New(nil, nil, nil, chunking.Options{}, nil)
	for _, ix := range []*Index{nilIndex, off} {
		if ix.Enabled() || ix.Provider() != "" || ix.Outside() {
			t.Fatal("switched off reports on")
		}
		must(t, ix.Ensure(bg))
		must(t, ix.Sync(bg, docs.Process, "x"))
		if r, err := ix.Search(bg, "anything", 10); err != nil || len(r) != 0 {
			t.Fatalf("search: %v %v", r, err)
		}
		if _, err := ix.Rebuild(bg); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEnsureOnAnEmptyDatabaseAndTwiceInParallel(t *testing.T) {
	pool := dbtest.NewPool(t)
	store := &docs.Store{Pool: pool}
	f := newFake()
	var wg sync.WaitGroup
	errs := make([]error, 3)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = New(pool, store, f, chunking.Options{}, quiet).Ensure(bg)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		must(t, err)
	}
	if n := chunkCount(t, pool, ""); n != 0 {
		t.Fatalf("parts in an empty database: %d", n)
	}
	var dims int
	must(t, pool.QueryRow(bg, `select dimensions from search_settings`).Scan(&dims))
	if dims != 64 {
		t.Fatalf("dimensions: %d", dims)
	}
	// and once more: nothing to do
	must(t, New(pool, store, f, chunking.Options{}, quiet).Ensure(bg))
	if calls, _ := f.counts(); calls != 0 {
		t.Fatalf("embedded for an empty database: %d calls", calls)
	}
}

func TestSyncEmbedsOnlyWhatChangedAndRemovesWhatIsGone(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	must(t, ix.Ensure(bg))
	all := expected(t, store, chunking.Default())
	if n := chunkCount(t, pool, ""); n != all || n == 0 {
		t.Fatalf("parts after the first build: %d, want %d", n, all)
	}
	if n, _ := ix.Pending(bg); n != 0 {
		t.Fatalf("pending after the build: %d", n)
	}
	_, texts := f.counts()
	if texts != all {
		t.Fatalf("embedded %d texts for %d parts", texts, all)
	}

	// nothing changed: a sync and a rebuild embed nothing
	f.reset()
	must(t, ix.Sync(bg, docs.Process, "request-gcp-project"))
	r, err := ix.Rebuild(bg)
	must(t, err)
	if calls, _ := f.counts(); calls != 0 || r.Embedded != 0 || r.Unchanged != all || r.Removed != 0 || r.Documents != 10 {
		t.Fatalf("an unchanged rebuild: %d calls, %+v", calls, r)
	}

	// one step changes: one text, in one call
	before := chunkCount(t, pool, `where kind = 'process' and doc_id = 'request-gcp-project'`)
	d, _ := store.Get(bg, docs.Process, "request-gcp-project")
	tg, _ := docs.TargetOf(d)
	var stepID string
	for id := range tg.Titles {
		stepID = id
		break
	}
	edit(t, store, docs.Process, "request-gcp-project", `"title": "`+tg.Titles[stepID]+`"`, `"title": "`+tg.Titles[stepID]+` with a cost centre"`)
	f.reset()
	must(t, ix.Sync(bg, docs.Process, "request-gcp-project"))
	if calls, texts := f.counts(); calls != 1 || texts != 1 {
		t.Fatalf("a changed step: %d calls, %d texts", calls, texts)
	}
	var label string
	must(t, pool.QueryRow(bg, `select label from search_chunks where doc_id = 'request-gcp-project' and item = $1`, stepID).Scan(&label))
	if !strings.Contains(label, "with a cost centre") {
		t.Fatalf("label: %q", label)
	}

	// a draft has no parts; published again they come back
	edit(t, store, docs.Process, "request-gcp-project", `"status": "active"`, `"status": "draft"`)
	must(t, ix.Sync(bg, docs.Process, "request-gcp-project"))
	if n := chunkCount(t, pool, `where doc_id = 'request-gcp-project'`); n != 0 {
		t.Fatalf("a draft keeps %d parts", n)
	}
	edit(t, store, docs.Process, "request-gcp-project", `"status": "draft"`, `"status": "retired"`)
	must(t, ix.Sync(bg, docs.Process, "request-gcp-project"))
	if n := chunkCount(t, pool, `where doc_id = 'request-gcp-project' and status = 'retired'`); n != before {
		t.Fatalf("retired: %d parts, want %d", n, before)
	}

	// deleted: gone
	must(t, store.Delete(bg, docs.Process, "request-gcp-project", "test"))
	must(t, ix.Sync(bg, docs.Process, "request-gcp-project"))
	if n := chunkCount(t, pool, `where doc_id = 'request-gcp-project'`); n != 0 {
		t.Fatalf("a deleted document keeps %d parts", n)
	}
}

func TestAPartThatIsGoneIsRemoved(t *testing.T) {
	pool, store := filled(t, false)
	ix := New(pool, store, newFake(), chunking.Options{}, quiet)
	must(t, ix.Ensure(bg))
	before := chunkCount(t, pool, `where doc_id = 'request-gcp-project'`)
	// only the summary and the steps
	only := New(pool, store, newFake(), chunking.Options{Parts: []string{"summary"}, MaxChars: 2000}, quiet)
	must(t, only.Ensure(bg)) // other settings: everything again
	if n := chunkCount(t, pool, `where doc_id = 'request-gcp-project'`); n != 1 || n >= before {
		t.Fatalf("summary only: %d parts (before %d)", n, before)
	}
	if n := chunkCount(t, pool, `where part <> 'summary'`); n != 0 {
		t.Fatalf("other parts left: %d", n)
	}
}

func TestOtherSettingsRebuildEverything(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	must(t, New(pool, store, f, chunking.Options{}, quiet).Ensure(bg))
	all := expected(t, store, chunking.Default())

	// the same settings: nothing
	f.reset()
	must(t, New(pool, store, f, chunking.Options{}, quiet).Ensure(bg))
	if calls, _ := f.counts(); calls != 0 {
		t.Fatalf("the same settings embedded again: %d calls", calls)
	}
	// another size of vector, another provider: everything
	for _, change := range []func(*fake){func(f *fake) { f.dims = 32 }, func(f *fake) { f.name = "other" }} {
		g := newFake()
		g.dims = f.dims
		change(g)
		must(t, New(pool, store, g, chunking.Options{}, quiet).Ensure(bg))
		if _, texts := g.counts(); texts != all {
			t.Fatalf("after a change of settings %d texts embedded, want %d", texts, all)
		}
		f = g
	}
	var provider string
	var dims int
	must(t, pool.QueryRow(bg, `select provider, dimensions from search_settings`).Scan(&provider, &dims))
	if provider != "other" || dims != 32 {
		t.Fatalf("settings: %s %d", provider, dims)
	}
	// a server with the old settings does not search an index it did not build
	if _, err := New(pool, store, newFake(), chunking.Options{}, quiet).Search(bg, "project", 5); !errors.Is(err, ErrNotSetUp) {
		t.Fatalf("search with other settings: %v", err)
	}
}

func TestAProviderFailureLeavesTheOldPartsAndIsTriedAgain(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	must(t, ix.Ensure(bg))
	before := chunkCount(t, pool, `where doc_id = 'secure-logging'`)

	f.setFail(true)
	edit(t, store, docs.Standard, "secure-logging", `"summary": "What services`, `"summary": "Logs never hold a password, token or key. What services`)
	err := ix.Sync(bg, docs.Standard, "secure-logging")
	if !errors.Is(err, ErrProvider) {
		t.Fatalf("sync while the provider is down: %v", err)
	}
	if n := chunkCount(t, pool, `where doc_id = 'secure-logging'`); n != before {
		t.Fatalf("the old parts were touched: %d, before %d", n, before)
	}
	if n, _ := ix.Pending(bg); n != 1 {
		t.Fatalf("pending: %d", n)
	}
	// still down: the retry leaves it marked
	if n, err := ix.Retry(bg); n != 0 || !errors.Is(err, ErrProvider) {
		t.Fatalf("retry while down: %d %v", n, err)
	}
	// a rebuild while down stops and marks everything
	r, err := ix.Rebuild(bg)
	if !errors.Is(err, ErrProvider) || r.Failed == 0 {
		t.Fatalf("rebuild while down: %+v %v", r, err)
	}

	f.setFail(false)
	f.reset()
	n, err := ix.Retry(bg)
	must(t, err)
	if n == 0 {
		t.Fatalf("caught up %d documents", n)
	}
	if p, _ := ix.Pending(bg); p != 0 {
		t.Fatalf("still pending: %d", p)
	}
	if _, texts := f.counts(); texts != 1 {
		t.Fatalf("embedded %d texts after the retry, want only the new summary", texts)
	}
	var snippet string
	must(t, pool.QueryRow(bg, `select snippet from search_chunks where doc_id = 'secure-logging' and part = 'summary'`).Scan(&snippet))
	if !strings.Contains(snippet, "never hold a password") {
		t.Fatalf("summary: %q", snippet)
	}
}

func TestRetryEveryCatchesUp(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	must(t, ix.Ensure(bg))
	f.setFail(true)
	edit(t, store, docs.Process, "request-gcp-project", `"status": "active"`, `"status": "draft"`)
	_ = ix.Sync(bg, docs.Process, "request-gcp-project") // a draft needs no provider: it works
	edit(t, store, docs.Process, "request-gcp-project", `"status": "draft"`, `"status": "active"`)
	if err := ix.Sync(bg, docs.Process, "request-gcp-project"); err == nil {
		t.Fatal("no failure")
	}
	f.setFail(false)
	ctx, cancel := context.WithCancel(bg)
	defer cancel()
	go ix.RetryEvery(ctx, 20*time.Millisecond)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if n, _ := ix.Pending(bg); n == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("not caught up")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if n := chunkCount(t, pool, `where doc_id = 'request-gcp-project'`); n == 0 {
		t.Fatal("no parts after the retry")
	}
}

func TestSearchGroupsByDocumentAndNeverReturnsADraft(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	must(t, ix.Ensure(bg))

	results, err := ix.Search(bg, "secrets passwords tokens logs", 50)
	must(t, err)
	if len(results) == 0 || results[0].ID != "secure-logging" || results[0].Kind != docs.Standard || results[0].Status != "active" {
		t.Fatalf("results: %+v", results)
	}
	seen := map[string]bool{}
	for i, r := range results {
		if seen[r.Kind+r.ID] {
			t.Fatalf("%s twice", r.ID)
		}
		seen[r.Kind+r.ID] = true
		if len(r.Hits) == 0 || len(r.Hits) > MaxHits || r.Score != r.Hits[0].Score || r.Score <= 0 || r.Score > 1 {
			t.Fatalf("result %d: %+v", i, r)
		}
		for j := 1; j < len(r.Hits); j++ {
			if r.Hits[j].Score > r.Hits[j-1].Score {
				t.Fatalf("hits not best first: %+v", r.Hits)
			}
		}
		if i > 0 && r.Score > results[i-1].Score {
			t.Fatal("results not best first")
		}
		for _, h := range r.Hits {
			if h.Label == "" || h.Snippet == "" || len([]rune(h.Snippet)) > SnippetLength+1 {
				t.Fatalf("hit: %+v", h)
			}
		}
	}
	if limited, _ := ix.Search(bg, "secrets passwords tokens logs", 1); len(limited) != 1 {
		t.Fatalf("limit 1: %d", len(limited))
	}
	if empty, err := ix.Search(bg, "   ", 5); err != nil || len(empty) != 0 {
		t.Fatalf("empty question: %v %v", empty, err)
	}

	// the same question again does not ask the provider
	f.reset()
	_, _ = ix.Search(bg, "secrets  passwords tokens logs ", 50)
	if calls, _ := f.counts(); calls != 0 {
		t.Fatalf("a repeated question called the provider %d times", calls)
	}

	// a draft disappears at once - even before its parts are removed - and so does a deleted one
	edit(t, store, docs.Standard, "secure-logging", `"status": "active"`, `"status": "draft"`)
	results, err = ix.Search(bg, "secrets passwords tokens logs", 50)
	must(t, err)
	for _, r := range results {
		if r.ID == "secure-logging" {
			t.Fatal("a draft was returned")
		}
	}
	edit(t, store, docs.Standard, "secure-logging", `"status": "draft"`, `"status": "retired"`)
	results, _ = ix.Search(bg, "secrets passwords tokens logs", 50)
	if len(results) == 0 || results[0].ID != "secure-logging" || results[0].Status != "retired" {
		t.Fatalf("retired: %+v", results)
	}
	must(t, store.Delete(bg, docs.Standard, "secure-logging", "test"))
	results, _ = ix.Search(bg, "secrets passwords tokens logs", 50)
	for _, r := range results {
		if r.ID == "secure-logging" {
			t.Fatal("a deleted document was returned")
		}
	}

	// the provider is down: an error that says so
	f.setFail(true)
	if _, err := ix.Search(bg, "something not asked before", 5); !errors.Is(err, ErrProvider) {
		t.Fatalf("search while down: %v", err)
	}
}

func TestSnippet(t *testing.T) {
	for _, tc := range []struct{ text, label, want string }{
		{"Process: Request a GCP project\nStep 1: Decide the details\nDone by: Requester\nPick a name.", "Step 1: Decide the details", "Done by: Requester · Pick a name."},
		{"Standard: Secure logging\nScope: All services.", "Scope", "All services."},
		{"Process: Request a GCP project\nGet a project.\nTags: gcp,   cloud", "Summary", "Get a project. · Tags: gcp, cloud"},
		{"One line only", "", "One line only"},
	} {
		if got := Snippet(tc.text, tc.label); got != tc.want {
			t.Errorf("Snippet(%q) = %q, want %q", tc.text, got, tc.want)
		}
	}
	long := Snippet("Head\n"+strings.Repeat("word ", 100), "")
	if r := []rune(long); len(r) > SnippetLength+1 || !strings.HasSuffix(long, "word…") {
		t.Fatalf("long: %q", long)
	}
}

func TestQueryCache(t *testing.T) {
	c := newQueryCache(2, time.Minute)
	now := time.Unix(1000, 0)
	c.now = func() time.Time { return now }
	c.put("a", []float32{1})
	now = now.Add(time.Second)
	c.put("b", []float32{2})
	now = now.Add(time.Second)
	c.put("c", []float32{3}) // a, the oldest, goes
	if _, ok := c.get("a"); ok {
		t.Fatal("a kept")
	}
	if v, ok := c.get("c"); !ok || v[0] != 3 {
		t.Fatal("c lost")
	}
	now = now.Add(2 * time.Minute)
	if _, ok := c.get("b"); ok {
		t.Fatal("an old entry was used")
	}
}

func TestSupportedVersions(t *testing.T) {
	for v, want := range map[string]bool{"0.4.4": false, "0.5.0": true, "0.6.0": true, "0.8.1": true, "1.0": true, "x": false} {
		if supported(v) != want {
			t.Errorf("%s: %v", v, !want)
		}
	}
}

func TestEnsureWorksWhileTheProviderIsDown(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	f.setFail(true)
	ix := New(pool, store, f, chunking.Options{}, quiet)
	must(t, ix.Ensure(bg)) // the server starts all the same
	if n, _ := ix.Pending(bg); n != 10 {
		t.Fatalf("pending: %d", n)
	}
	if _, err := ix.CatchUp(bg); !errors.Is(err, ErrProvider) {
		t.Fatalf("catch up while down: %v", err)
	}
	f.setFail(false)
	r, err := ix.CatchUp(bg)
	must(t, err)
	if r.Documents != 10 || r.Embedded == 0 || r.Failed != 0 {
		t.Fatalf("catch up: %+v", r)
	}
	if n, _ := ix.Pending(bg); n != 0 {
		t.Fatalf("pending after catching up: %d", n)
	}
}
