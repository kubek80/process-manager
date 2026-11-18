package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// Vertex AI text embeddings, called through the REST "predict" method:
//
//	POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict
//	     (location "global": https://aiplatform.googleapis.com/…)
//	{"instances":[{"content":"…","task_type":"RETRIEVAL_DOCUMENT"}],
//	 "parameters":{"outputDimensionality":768,"autoTruncate":true}}
//	-> {"predictions":[{"embeddings":{"values":[…],"statistics":{"token_count":12,"truncated":false}}}]}
//
// What the published reference says, as far as it could be checked when this was written (the
// documentation site could not be opened from the build machine, only search results quoting
// it; marked ASSUMED where not confirmed):
//   - gemini-embedding-001 takes ONE text per request; older text-embedding models take up to
//     250 (ASSUMED for those; this package only batches models whose name does not start with
//     "gemini-embedding").
//   - task_type RETRIEVAL_DOCUMENT for what is searched, RETRIEVAL_QUERY for the question.
//   - outputDimensionality truncates the 3072-long vector to a smaller size. Whether the
//     service scales a truncated vector back to length 1 is not stated clearly (ASSUMED not), so
//     every vector is normalised here; for one that already has length 1 this changes nothing.
//   - The model reads at most 2048 tokens of one text. autoTruncate=true asks the service to
//     cut a longer text instead of refusing it. Whether gemini-embedding-001 honours it is not
//     certain (ASSUMED it may not), so a refusal for a text that is too long becomes an error
//     naming PM_CHUNK_MAX_CHARS. With the default of 2000 characters a chunk stays far below
//     the limit (roughly 500 tokens).
//
// How long a provider that does not answer may hold things up:
//   - one request: at most 10 seconds (requestTimeout);
//   - at most 3 tries (maxAttempts), waiting about 0.5 s and then 1 s between them, longer only
//     when the service asks for it with Retry-After, never more than 5 s;
//   - one Embed call as a whole: at most 20 seconds, plus 2 seconds for every further text
//     (embedCeiling), so a search waits at most 20 s and a document of 30 parts at most 78 s;
//     a shorter deadline of the caller's context wins;
//   - only what can pass on its own is tried again: timeouts, broken connections, 429 and
//     5xx answers. Other refusals (400, 401, 403, 404) and a cancelled context end at once.
//   - looking up the credentials when the server starts: at most 10 seconds (credsTimeout).
//     On a machine without any, the library answers within milliseconds; on one that may be in
//     Google Cloud it asks the local metadata server, which it bounds itself (2 s to connect,
//     5 s per request). No token is fetched at start.

const (
	scopeCloudPlatform = "https://www.googleapis.com/auth/cloud-platform"
	maxAttempts        = 3
	parallelRequests   = 4 // one text per request for gemini-embedding-001: a few at a time
	requestTimeout     = 10 * time.Second
	maxRetryAfter      = 5 * time.Second
	credsTimeout       = 10 * time.Second
	ceilingBase        = 20 * time.Second
	ceilingPerText     = 2 * time.Second
)

// embedCeiling is the longest one Embed call of n texts may take.
func embedCeiling(n int) time.Duration {
	return ceilingBase + time.Duration(max(n-1, 0))*ceilingPerText
}

type vertex struct {
	model, project, location string
	dims                     int
	url                      string
	client                   *http.Client
	backoff                  time.Duration // first wait before a retry; doubled each time
	timeout                  time.Duration // one request
	ceiling                  func(n int) time.Duration
}

func newVertex(ctx context.Context, o Options) (*vertex, error) {
	if strings.TrimSpace(o.Project) == "" {
		return nil, errors.New("embeddings: Vertex AI needs the Google Cloud project; set PM_VERTEX_PROJECT")
	}
	if strings.TrimSpace(o.Location) == "" {
		return nil, errors.New("embeddings: Vertex AI needs the region; set PM_VERTEX_LOCATION (for example europe-west4, or global)")
	}
	model := strings.TrimSpace(o.Model)
	if model == "" {
		model = DefaultModel
	}
	base := strings.TrimRight(o.Endpoint, "/")
	if base == "" {
		if o.Location == "global" {
			base = "https://aiplatform.googleapis.com"
		} else {
			base = "https://" + o.Location + "-aiplatform.googleapis.com"
		}
	}
	v := &vertex{
		model: model, project: o.Project, location: o.Location, dims: o.Dimensions,
		url: base + "/v1/projects/" + url.PathEscape(o.Project) + "/locations/" + url.PathEscape(o.Location) +
			"/publishers/google/models/" + url.PathEscape(model) + ":predict",
		client:  o.HTTPClient,
		backoff: 500 * time.Millisecond,
		timeout: requestTimeout,
		ceiling: embedCeiling,
	}
	if v.client == nil {
		creds, err := findCredentials(ctx, credsTimeout)
		if err != nil {
			return nil, err
		}
		// The token source outlives the start-up context. Each request has its own deadline
		// (requestTimeout), which also bounds fetching a token.
		v.client = oauth2.NewClient(context.WithoutCancel(ctx), creds.TokenSource)
	}
	return v, nil
}

// findCredentials looks up Application Default Credentials, giving up after limit.
func findCredentials(ctx context.Context, limit time.Duration) (*google.Credentials, error) {
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	type result struct {
		c   *google.Credentials
		err error
	}
	done := make(chan result, 1)
	go func() {
		c, err := google.FindDefaultCredentials(ctx, scopeCloudPlatform)
		done <- result{c, err}
	}()
	select {
	case r := <-done:
		if r.err != nil {
			return nil, fmt.Errorf("embeddings: no Google credentials found for Vertex AI. Run the server with a Google service account (workload identity), or set GOOGLE_APPLICATION_CREDENTIALS to the path of a credentials file (Application Default Credentials): %v", r.err)
		}
		return r.c, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("embeddings: looking up the Google credentials for Vertex AI took longer than %s. Set GOOGLE_APPLICATION_CREDENTIALS to the path of a credentials file, or check the server's access to the Google metadata server", limit)
	}
}

func (v *vertex) Name() string    { return "vertex:" + v.model }
func (v *vertex) Dimensions() int { return v.dims }
func (v *vertex) Outside() bool   { return true }

// perRequest is how many texts one request may carry.
func (v *vertex) perRequest() int {
	if strings.HasPrefix(v.model, "gemini-embedding") {
		return 1
	}
	return 250
}

type instance struct {
	Content  string `json:"content"`
	TaskType string `json:"task_type"`
}

type predictRequest struct {
	Instances  []instance `json:"instances"`
	Parameters struct {
		OutputDimensionality int  `json:"outputDimensionality"`
		AutoTruncate         bool `json:"autoTruncate"`
	} `json:"parameters"`
}

type predictResponse struct {
	Predictions []struct {
		Embeddings struct {
			Values []float64 `json:"values"`
		} `json:"embeddings"`
	} `json:"predictions"`
}

// errSlow is the cause when one Embed call reaches its own ceiling.
var errSlow = errors.New("ceiling")

func (v *vertex) Embed(ctx context.Context, texts []string, p Purpose) ([][]float32, error) {
	out := make([][]float32, len(texts))
	if len(texts) == 0 {
		return out, nil
	}
	task := "RETRIEVAL_DOCUMENT"
	if p == Query {
		task = "RETRIEVAL_QUERY"
	}
	parent := ctx
	limit := v.ceiling(len(texts))
	ctx, stop := context.WithTimeoutCause(ctx, limit, errSlow)
	defer stop()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
		slots    = make(chan struct{}, parallelRequests)
	)
	n := v.perRequest()
	for start := 0; start < len(texts); start += n {
		end := min(start+n, len(texts))
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(start, end int) {
			defer wg.Done()
			defer func() { <-slots }()
			vecs, err := v.call(ctx, texts[start:end], task)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				cancel()
				return
			}
			copy(out[start:end], vecs)
		}(start, end)
	}
	wg.Wait()
	if err := parent.Err(); err != nil {
		return nil, err
	}
	if firstErr != nil && !errors.Is(firstErr, context.Canceled) && !errors.Is(firstErr, context.DeadlineExceeded) {
		return nil, firstErr
	}
	if firstErr != nil || ctx.Err() != nil {
		return nil, fmt.Errorf("embeddings: Vertex AI did not answer within %s; try again later, or check the server's network access to Google", limit)
	}
	return out, nil
}

// call sends one request, retrying what may pass on its own (rate limits, server errors, a
// timeout or a broken connection) with a growing wait.
func (v *vertex) call(ctx context.Context, texts []string, task string) ([][]float32, error) {
	var req predictRequest
	for _, t := range texts {
		req.Instances = append(req.Instances, instance{Content: t, TaskType: task})
	}
	req.Parameters.OutputDimensionality = v.dims
	req.Parameters.AutoTruncate = true
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	wait := v.backoff
	for attempt := 1; ; attempt++ {
		vecs, retryAfter, err := v.once(ctx, body, len(texts))
		if err == nil {
			return vecs, nil
		}
		var re retryable
		if !errors.As(err, &re) {
			return nil, err
		}
		if attempt == maxAttempts {
			return nil, re.error
		}
		d := wait + time.Duration(rand.Int64N(int64(wait)/2+1))
		if retryAfter > d {
			d = retryAfter
		}
		if dl, ok := ctx.Deadline(); ok && time.Until(dl) < d {
			return nil, re.error // waiting would only run into the deadline
		}
		t := time.NewTimer(d)
		select {
		case <-ctx.Done():
			t.Stop()
			return nil, ctx.Err()
		case <-t.C:
		}
		wait *= 2
	}
}

// retryable marks an error that may pass when the request is sent again.
type retryable struct{ error }

func (v *vertex) once(ctx context.Context, body []byte, want int) ([][]float32, time.Duration, error) {
	rctx, cancel := context.WithTimeout(ctx, v.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, http.MethodPost, v.url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := v.client.Do(req)
	if err != nil {
		return nil, 0, v.transportError(ctx, err, req.URL.Host)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, 0, v.transportError(ctx, err, req.URL.Host)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, retryAfter(resp.Header.Get("Retry-After")), v.statusError(resp.StatusCode, raw)
	}
	var pr predictResponse
	if err := json.Unmarshal(raw, &pr); err != nil {
		return nil, 0, fmt.Errorf("embeddings: Vertex AI answered with something that is not an embedding: %v", err)
	}
	if len(pr.Predictions) != want {
		return nil, 0, fmt.Errorf("embeddings: Vertex AI returned %d vectors for %d texts", len(pr.Predictions), want)
	}
	out := make([][]float32, want)
	for i, p := range pr.Predictions {
		if len(p.Embeddings.Values) != v.dims {
			return nil, 0, fmt.Errorf("embeddings: Vertex AI returned vectors of size %d, not %d; check that the model %s supports PM_EMBEDDINGS_DIMENSIONS=%d", len(p.Embeddings.Values), v.dims, v.model, v.dims)
		}
		out[i] = normalise(p.Embeddings.Values)
	}
	return out, 0, nil
}

// transportError sorts a failure to get an answer at all: the caller's context ended (never
// retried), no access token (not retried: it will not appear on its own), a timeout or a broken
// connection (retried), anything else (not retried: DNS, TLS, a wrong address).
func (v *vertex) transportError(ctx context.Context, err error, host string) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var re *oauth2.RetrieveError
	if errors.As(err, &re) {
		return fmt.Errorf("embeddings: the server could not get a Google access token for Vertex AI; check its Application Default Credentials (workload identity or GOOGLE_APPLICATION_CREDENTIALS): %v", re)
	}
	var ne net.Error
	timeout := errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout())
	if timeout {
		return retryable{fmt.Errorf("embeddings: Vertex AI at %s did not answer within %s; try again later, or check the server's network access to Google", host, v.timeout)}
	}
	if errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.ECONNABORTED) || errors.Is(err, syscall.EPIPE) ||
		errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return retryable{fmt.Errorf("embeddings: the connection to Vertex AI at %s broke off; try again later, or check the server's network access to Google: %v", host, err)}
	}
	return fmt.Errorf("embeddings: Vertex AI at %s could not be reached; check PM_VERTEX_LOCATION and the server's network access to Google: %v", host, err)
}

// statusError turns a refusal into a sentence that says what an operator must fix. Google's
// own message is added, shortened; it describes the request, not the texts.
func (v *vertex) statusError(code int, raw []byte) error {
	var g struct {
		Error struct {
			Message string `json:"message"`
			Status  string `json:"status"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &g)
	detail := g.Error.Message
	if len(detail) > 300 {
		detail = detail[:300] + "…"
	}
	lower := strings.ToLower(detail)
	if detail != "" {
		detail = " Google says: " + detail
	}
	switch {
	case code == http.StatusUnauthorized:
		return fmt.Errorf("embeddings: Vertex AI did not accept the server's Google credentials (401). Check its Application Default Credentials (workload identity or GOOGLE_APPLICATION_CREDENTIALS).%s", detail)
	case code == http.StatusForbidden:
		return fmt.Errorf("embeddings: the server's Google account may not use Vertex AI in project %q (403). Give it the role Vertex AI User (roles/aiplatform.user) there and check that the Vertex AI API is enabled in the project.%s", v.project, detail)
	case code == http.StatusNotFound:
		return fmt.Errorf("embeddings: Vertex AI has no model %q for project %q in location %q (404). Check PM_EMBEDDINGS_MODEL, PM_VERTEX_PROJECT and PM_VERTEX_LOCATION.%s", v.model, v.project, v.location, detail)
	case code == http.StatusTooManyRequests:
		return retryable{fmt.Errorf("embeddings: the Vertex AI quota for embeddings in project %q is used up (429), even after waiting. Try again later, or ask for a higher quota for %s in that project.%s", v.project, v.model, detail)}
	case code >= 500:
		return retryable{fmt.Errorf("embeddings: Vertex AI had a problem on its side (%d) and did not recover after %d tries. Try again later.%s", code, maxAttempts, detail)}
	case code == http.StatusBadRequest && tooLong(lower):
		return fmt.Errorf("embeddings: Vertex AI refused a text as too long for the model (400). Lower PM_CHUNK_MAX_CHARS (for example to 2000) so every part stays within the model's input limit.%s", detail)
	case code == http.StatusBadRequest:
		return fmt.Errorf("embeddings: Vertex AI refused the request (400). Check PM_EMBEDDINGS_MODEL and PM_EMBEDDINGS_DIMENSIONS.%s", detail)
	}
	return fmt.Errorf("embeddings: Vertex AI refused the request (%d).%s", code, detail)
}

// tooLong: does Google's message say that an input is too long?
func tooLong(msg string) bool {
	for _, s := range []string{"too long", "token", "exceeds", "exceeded", "input length", "maximum length"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

func retryAfter(h string) time.Duration {
	if s, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && s > 0 {
		return min(time.Duration(s)*time.Second, maxRetryAfter)
	}
	return 0
}
