package embedding

import (
	"context"
	"encoding/json"
	"errors"
	"hash/fnv"
	"io"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func dot(a, b []float32) float64 {
	var s float64
	for i := range a {
		s += float64(a[i]) * float64(b[i])
	}
	return s
}

func length(v []float32) float64 { return math.Sqrt(dot(v, v)) }

func embed(t *testing.T, e Embedder, texts ...string) [][]float32 {
	t.Helper()
	vs, err := e.Embed(context.Background(), texts, Document)
	if err != nil {
		t.Fatal(err)
	}
	if len(vs) != len(texts) {
		t.Fatalf("%d vectors for %d texts", len(vs), len(texts))
	}
	return vs
}

func TestNew(t *testing.T) {
	ctx := context.Background()
	for _, p := range []string{"", "off", " OFF "} {
		if e, err := New(ctx, Options{Provider: p}); e != nil || err != nil {
			t.Errorf("%q: %v %v", p, e, err)
		}
	}
	e, err := New(ctx, Options{Provider: "builtin"})
	if err != nil || e.Name() != "builtin" || e.Dimensions() != DefaultDimensions || e.Outside() {
		t.Errorf("builtin default: %v %v", e, err)
	}
	for _, d := range []int{64, 768, 3072} {
		if e, err := New(ctx, Options{Provider: "builtin", Dimensions: d}); err != nil || e.Dimensions() != d {
			t.Errorf("builtin %d: %v", d, err)
		}
	}
	bad := []Options{
		{Provider: "chroma"},
		{Provider: "builtin", Dimensions: 63},
		{Provider: "builtin", Dimensions: 3073},
		{Provider: "builtin", Dimensions: -1},
		{Provider: "vertex", Location: "europe-west4", HTTPClient: http.DefaultClient},
		{Provider: "vertex", Project: "p", HTTPClient: http.DefaultClient},
		{Provider: "vertex", Project: "p", Location: "europe-west4", Dimensions: 5000, HTTPClient: http.DefaultClient},
	}
	for _, o := range bad {
		if _, err := New(ctx, o); err == nil {
			t.Errorf("%+v accepted", o)
		}
	}
	e, err = New(ctx, Options{Provider: "vertex", Project: "p", Location: "europe-west4", HTTPClient: http.DefaultClient})
	if err != nil || e.Name() != "vertex:gemini-embedding-001" || !e.Outside() || e.Dimensions() != 768 {
		t.Errorf("vertex: %v %v", e, err)
	}
	if v := e.(*vertex); v.url != "https://europe-west4-aiplatform.googleapis.com/v1/projects/p/locations/europe-west4/publishers/google/models/gemini-embedding-001:predict" {
		t.Errorf("url %s", v.url)
	}
	e, _ = New(ctx, Options{Provider: "vertex", Project: "p", Location: "global", HTTPClient: http.DefaultClient})
	if v := e.(*vertex); !strings.HasPrefix(v.url, "https://aiplatform.googleapis.com/v1/projects/p/locations/global/") {
		t.Errorf("global url %s", v.url)
	}
}

func TestNewVertexWithoutCredentials(t *testing.T) {
	for _, file := range []string{"/nonexistent/credentials.json", ""} {
		t.Setenv("GOOGLE_APPLICATION_CREDENTIALS", file)
		t.Setenv("HOME", t.TempDir())
		t.Setenv("CLOUDSDK_CONFIG", t.TempDir())
		start := time.Now()
		_, err := New(context.Background(), Options{Provider: "vertex", Project: "p", Location: "europe-west4"})
		if err == nil || !strings.Contains(err.Error(), "GOOGLE_APPLICATION_CREDENTIALS") {
			t.Errorf("missing credentials (%q): %v", file, err)
		}
		// on a machine outside Google Cloud the lookup ends fast; inside it is bounded by credsTimeout
		if d := time.Since(start); d > credsTimeout+time.Second {
			t.Errorf("the lookup took %v", d)
		}
	}
}

func TestBuiltinVectors(t *testing.T) {
	e := Builtin(768)
	vs := embed(t, e, "Request a GCP project", "Request a GCP project", "", "!!!", "x")
	if !reflect.DeepEqual(vs[0], vs[1]) {
		t.Error("identical texts gave different vectors")
	}
	for i, v := range vs {
		if len(v) != 768 || math.Abs(length(v)-1) > 1e-5 {
			t.Errorf("vector %d: size %d, length %f", i, len(v), length(v))
		}
	}
	q, _ := e.Embed(context.Background(), []string{"Request a GCP project"}, Query)
	if !reflect.DeepEqual(q[0], vs[0]) {
		t.Error("the purpose changed the builtin vector")
	}
	if a := embed(t, Builtin(64), "Café Résumé"); !reflect.DeepEqual(a, embed(t, Builtin(64), "cafe RESUME")) {
		t.Error("accents or case made a difference")
	}
	if got := Tokens("Héllo, wörld! GCP-123_x"); !reflect.DeepEqual(got, []string{"hello", "world", "gcp", "123", "x"}) {
		t.Errorf("tokens %v", got)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := e.Embed(ctx, []string{"a"}, Document); err == nil {
		t.Error("a cancelled context was ignored")
	}
}

// The builtin vectors must be the same on every machine: a fingerprint of a few vectors is
// fixed here. If this changes, every installation's index is silently wrong until rebuilt.
func TestBuiltinIsStable(t *testing.T) {
	h := fnv.New64a()
	for _, v := range embed(t, Builtin(256), "Request a GCP project", "Rotate a leaked secret", "Café 42") {
		for _, x := range v {
			b := math.Float32bits(x)
			h.Write([]byte{byte(b), byte(b >> 8), byte(b >> 16), byte(b >> 24)})
		}
	}
	const want = 0x94a092f3440f274
	if got := h.Sum64(); got != want {
		t.Errorf("builtin vectors changed: fingerprint %#x, want %#x", got, uint64(want))
	}
}

func TestBuiltinFindsSharedWords(t *testing.T) {
	e := Builtin(768)
	vs := embed(t, e,
		"Request a GCP project",
		"how do I get a Google Cloud project",
		"rotate a leaked secret",
		"Request GCP projects",
		"approve the monthly budget",
		"approval of the budget",
	)
	if near, far := dot(vs[0], vs[1]), dot(vs[0], vs[2]); near <= far+0.1 {
		t.Errorf("shared word: %.3f vs unrelated %.3f", near, far)
	}
	if near, far := dot(vs[0], vs[3]), dot(vs[0], vs[1]); near <= far {
		t.Errorf("same words in another form %.3f should beat one shared word %.3f", near, far)
	}
	if near, far := dot(vs[4], vs[5]), dot(vs[4], vs[2]); near <= far+0.1 {
		t.Errorf("word parts: %.3f vs %.3f", near, far)
	}
}

// standIn behaves like the Vertex AI predict endpoint for one project, location and model.
type standIn struct {
	t        *testing.T
	calls    atomic.Int32
	failures atomic.Int32 // the first n calls fail with failStatus
	status   int
	mu       sync.Mutex
	tasks    []string
	sizes    []int
}

const testToken = "test-token"

func (s *standIn) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.calls.Add(1)
	fail := func(code int, status, msg string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": code, "message": msg, "status": status}})
	}
	if r.Header.Get("Authorization") != "Bearer "+testToken {
		fail(401, "UNAUTHENTICATED", "Request had invalid authentication credentials.")
		return
	}
	if r.Method != http.MethodPost || r.URL.Path != "/v1/projects/my-proj/locations/europe-west4/publishers/google/models/gemini-embedding-001:predict" {
		fail(404, "NOT_FOUND", "Publisher Model was not found.")
		return
	}
	if s.failures.Add(-1) >= 0 {
		fail(s.status, "UNAVAILABLE", "try later")
		return
	}
	var req struct {
		Instances []struct {
			Content  string `json:"content"`
			TaskType string `json:"task_type"`
		} `json:"instances"`
		Parameters struct {
			OutputDimensionality int  `json:"outputDimensionality"`
			AutoTruncate         bool `json:"autoTruncate"`
		} `json:"parameters"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Instances) != 1 || req.Parameters.OutputDimensionality == 0 {
		fail(400, "INVALID_ARGUMENT", "bad request")
		return
	}
	s.mu.Lock()
	s.tasks = append(s.tasks, req.Instances[0].TaskType)
	s.sizes = append(s.sizes, req.Parameters.OutputDimensionality)
	s.mu.Unlock()
	// A vector that depends on the text and is NOT of length 1, as a truncated one may be.
	vals := make([]float64, req.Parameters.OutputDimensionality)
	for i := range vals {
		vals[i] = 0.1
	}
	vals[len(req.Instances[0].Content)%len(vals)] = 3
	_ = json.NewEncoder(w).Encode(map[string]any{"predictions": []any{
		map[string]any{"embeddings": map[string]any{"values": vals, "statistics": map[string]any{"token_count": 3, "truncated": false}}},
	}})
}

func newStandIn(t *testing.T, token string) (*standIn, *vertex) {
	s := &standIn{t: t}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	client := oauth2.NewClient(context.Background(), oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token}))
	e, err := New(context.Background(), Options{Provider: "vertex", Project: "my-proj", Location: "europe-west4",
		Dimensions: 768, Endpoint: srv.URL, HTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	v := e.(*vertex)
	v.backoff = time.Millisecond
	return s, v
}

func TestVertex(t *testing.T) {
	s, v := newStandIn(t, testToken)
	texts := []string{"a", "bb", "ccc", "dddd", "eeeee", "ffffff", "g"}
	vs, err := v.Embed(context.Background(), texts, Document)
	if err != nil {
		t.Fatal(err)
	}
	for i, vec := range vs {
		if len(vec) != 768 || math.Abs(length(vec)-1) > 1e-5 {
			t.Fatalf("vector %d: size %d length %f", i, len(vec), length(vec))
		}
		// order kept: the large value sits at len(text).
		if vec[len(texts[i])] < 0.5 {
			t.Errorf("vector %d is not the one for %q", i, texts[i])
		}
	}
	if int(s.calls.Load()) != len(texts) {
		t.Errorf("%d calls for %d texts", s.calls.Load(), len(texts))
	}
	if _, err := v.Embed(context.Background(), []string{"question"}, Query); err != nil {
		t.Fatal(err)
	}
	if s.tasks[0] != "RETRIEVAL_DOCUMENT" || s.tasks[len(s.tasks)-1] != "RETRIEVAL_QUERY" || s.sizes[0] != 768 {
		t.Errorf("tasks %v sizes %v", s.tasks, s.sizes)
	}
	if vs, err := v.Embed(context.Background(), nil, Document); err != nil || len(vs) != 0 {
		t.Errorf("no texts: %v %v", vs, err)
	}
}

func TestVertexRetriesAndGivesUp(t *testing.T) {
	s, v := newStandIn(t, testToken)
	s.status = 503
	s.failures.Store(2)
	if _, err := v.Embed(context.Background(), []string{"x"}, Document); err != nil {
		t.Fatalf("two passing failures: %v", err)
	}
	if s.calls.Load() != 3 {
		t.Errorf("%d calls", s.calls.Load())
	}

	s.status = 429
	s.failures.Store(100)
	s.calls.Store(0)
	_, err := v.Embed(context.Background(), []string{"x"}, Document)
	if err == nil || !strings.Contains(err.Error(), "quota") || strings.Contains(err.Error(), "retryable") {
		t.Errorf("quota: %v", err)
	}
	if s.calls.Load() != maxAttempts {
		t.Errorf("%d calls, want %d", s.calls.Load(), maxAttempts)
	}
}

func TestVertexErrorsSayWhatToFix(t *testing.T) {
	_, v := newStandIn(t, "wrong-token")
	_, err := v.Embed(context.Background(), []string{"secret text"}, Document)
	if err == nil || !strings.Contains(err.Error(), "credentials") || strings.Contains(err.Error(), "secret text") {
		t.Errorf("401: %v", err)
	}

	s, v := newStandIn(t, testToken)
	v.url = strings.Replace(v.url, "my-proj", "other", 1)
	if _, err := v.Embed(context.Background(), []string{"x"}, Document); err == nil || !strings.Contains(err.Error(), "PM_VERTEX_PROJECT") {
		t.Errorf("404: %v", err)
	}
	if s.calls.Load() != 1 {
		t.Errorf("a 404 was retried: %d calls", s.calls.Load())
	}

	s, v = newStandIn(t, testToken)
	s.status = 403
	s.failures.Store(1)
	if _, err := v.Embed(context.Background(), []string{"x"}, Document); err == nil || !strings.Contains(err.Error(), "roles/aiplatform.user") {
		t.Errorf("403: %v", err)
	}
}

// hanging answers nothing until the request is given up.
func hanging(calls *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body) // only then does the server notice the client leaving
		<-r.Context().Done()
	}))
}

func vertexAt(t *testing.T, srv *httptest.Server, client *http.Client) *vertex {
	t.Helper()
	if client == nil {
		client = srv.Client()
	}
	e, err := New(context.Background(), Options{Provider: "vertex", Project: "p", Location: "l", Endpoint: srv.URL, HTTPClient: client})
	if err != nil {
		t.Fatal(err)
	}
	v := e.(*vertex)
	v.backoff = time.Millisecond
	return v
}

func TestVertexTimeouts(t *testing.T) {
	if embedCeiling(1) != 20*time.Second || embedCeiling(30) != 78*time.Second || maxAttempts != 3 || requestTimeout != 10*time.Second {
		t.Errorf("the documented limits changed: %v %v %d %v", embedCeiling(1), embedCeiling(30), maxAttempts, requestTimeout)
	}

	// each request times out and is tried again, up to maxAttempts
	var calls atomic.Int32
	srv := hanging(&calls)
	defer srv.Close()
	v := vertexAt(t, srv, nil)
	v.timeout = 30 * time.Millisecond
	start := time.Now()
	_, err := v.Embed(context.Background(), []string{"x"}, Query)
	if err == nil || !strings.Contains(err.Error(), "did not answer within") || time.Since(start) > 2*time.Second {
		t.Errorf("hanging: %v after %v", err, time.Since(start))
	}
	if calls.Load() != maxAttempts {
		t.Errorf("%d calls, want %d", calls.Load(), maxAttempts)
	}

	// the ceiling of the whole call wins over the tries
	calls.Store(0)
	v.timeout = time.Hour
	v.ceiling = func(int) time.Duration { return 50 * time.Millisecond }
	start = time.Now()
	_, err = v.Embed(context.Background(), []string{"x", "y"}, Document)
	if err == nil || !strings.Contains(err.Error(), "did not answer within 50ms") || time.Since(start) > 2*time.Second {
		t.Errorf("ceiling: %v after %v", err, time.Since(start))
	}

	// the caller's context: given back as it is, never tried again
	calls.Store(0)
	v.ceiling = embedCeiling
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err = v.Embed(ctx, []string{"x"}, Document)
	if !errors.Is(err, context.DeadlineExceeded) || calls.Load() != 1 {
		t.Errorf("caller's deadline: %v, %d calls", err, calls.Load())
	}
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if _, err := v.Embed(ctx, []string{"x"}, Document); !errors.Is(err, context.Canceled) {
		t.Errorf("cancelled: %v", err)
	}
}

func TestVertexWaitsNoLongerThanTheDeadline(t *testing.T) {
	s, v := newStandIn(t, testToken)
	s.status = 503
	s.failures.Store(100)
	v.backoff = time.Hour
	start := time.Now()
	_, err := v.Embed(context.Background(), []string{"x"}, Document)
	if err == nil || !strings.Contains(err.Error(), "(503)") || time.Since(start) > 2*time.Second || s.calls.Load() != 1 {
		t.Errorf("%v after %v, %d calls", err, time.Since(start), s.calls.Load())
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestVertexRetriesOnlyWhatCanPass(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	for _, c := range []struct {
		err   error
		calls int32
		says  string
	}{
		{syscall.ECONNRESET, maxAttempts, "broke off"},
		{io.ErrUnexpectedEOF, maxAttempts, "broke off"},
		{errors.New("tls: bad certificate"), 1, "could not be reached"},
		{&net.DNSError{Err: "no such host", Name: "x"}, 1, "PM_VERTEX_LOCATION"},
	} {
		var calls atomic.Int32
		v := vertexAt(t, srv, &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
			calls.Add(1)
			return nil, c.err
		})})
		_, err := v.Embed(context.Background(), []string{"x"}, Document)
		if err == nil || !strings.Contains(err.Error(), c.says) || calls.Load() != c.calls {
			t.Errorf("%v: %v after %d calls", c.err, err, calls.Load())
		}
	}

	for _, c := range []struct {
		code int
		msg  string
		says string
	}{
		{400, "Unable to submit request because the input token count is 3000 but the model supports up to 2048.", "PM_CHUNK_MAX_CHARS"},
		{400, "Invalid value at 'parameters.outputDimensionality'", "PM_EMBEDDINGS_DIMENSIONS"},
		{401, "", "credentials"},
		{403, "", "roles/aiplatform.user"},
		{404, "", "PM_VERTEX_PROJECT"},
	} {
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			w.WriteHeader(c.code)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": c.code, "message": c.msg}})
		}))
		v := vertexAt(t, srv, nil)
		_, err := v.Embed(context.Background(), []string{"x"}, Document)
		if err == nil || !strings.Contains(err.Error(), c.says) || calls.Load() != 1 {
			t.Errorf("%d %q: %v after %d calls", c.code, c.msg, err, calls.Load())
		}
		srv.Close()
	}
}

func TestVertexWrongSize(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"predictions":[{"embeddings":{"values":[1,2,3]}}]}`))
	}))
	defer srv.Close()
	e, _ := New(context.Background(), Options{Provider: "vertex", Project: "p", Location: "l", Endpoint: srv.URL, HTTPClient: srv.Client()})
	if _, err := e.Embed(context.Background(), []string{"x"}, Document); err == nil || !strings.Contains(err.Error(), "size 3") {
		t.Errorf("wrong size: %v", err)
	}
}
