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
//   - autoTruncate (default true) cuts a text longer than the model's input limit (2048 tokens)
//     instead of refusing it; our chunks are far shorter.

const (
	scopeCloudPlatform = "https://www.googleapis.com/auth/cloud-platform"
	maxAttempts        = 5
	parallelRequests   = 4 // one text per request for gemini-embedding-001: a few at a time
)

type vertex struct {
	model, project, location string
	dims                     int
	url                      string
	client                   *http.Client
	backoff                  time.Duration // first wait before a retry; doubled each time
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
	}
	if v.client == nil {
		creds, err := google.FindDefaultCredentials(ctx, scopeCloudPlatform)
		if err != nil {
			return nil, fmt.Errorf("embeddings: no Google credentials found for Vertex AI. Run the server with a Google service account (workload identity), or set GOOGLE_APPLICATION_CREDENTIALS to the path of a credentials file (Application Default Credentials): %v", err)
		}
		// The token source outlives the start-up context.
		c := oauth2.NewClient(context.WithoutCancel(ctx), creds.TokenSource)
		c.Timeout = 60 * time.Second
		v.client = c
	}
	return v, nil
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

func (v *vertex) Embed(ctx context.Context, texts []string, p Purpose) ([][]float32, error) {
	out := make([][]float32, len(texts))
	if len(texts) == 0 {
		return out, nil
	}
	task := "RETRIEVAL_DOCUMENT"
	if p == Query {
		task = "RETRIEVAL_QUERY"
	}
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
	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// call sends one request, retrying what may pass on its own (rate limits, server errors,
// network trouble) with a growing wait.
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
	var last error
	for attempt := 1; ; attempt++ {
		vecs, retryAfter, err := v.once(ctx, body, len(texts))
		if err == nil {
			return vecs, nil
		}
		last = err
		var re retryable
		if !errors.As(err, &re) || attempt == maxAttempts {
			break
		}
		d := wait + time.Duration(rand.Int64N(int64(wait)/2+1))
		if retryAfter > d {
			d = retryAfter
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
	var re retryable
	if errors.As(last, &re) {
		return nil, re.error
	}
	return nil, last
}

// retryable marks an error that may pass when the request is sent again.
type retryable struct{ error }

func (v *vertex) once(ctx context.Context, body []byte, want int) ([][]float32, time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := v.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, 0, ctx.Err()
		}
		var re *oauth2.RetrieveError
		if errors.As(err, &re) {
			return nil, 0, fmt.Errorf("embeddings: the server could not get a Google access token for Vertex AI; check its Application Default Credentials (workload identity or GOOGLE_APPLICATION_CREDENTIALS): %v", re)
		}
		var ne net.Error
		if errors.As(err, &ne) || errors.Is(err, io.ErrUnexpectedEOF) || strings.Contains(err.Error(), "connection") {
			return nil, 0, retryable{fmt.Errorf("embeddings: Vertex AI could not be reached at %s; check the server's network access to Google: %v", req.URL.Host, err)}
		}
		return nil, 0, fmt.Errorf("embeddings: Vertex AI could not be called; check the server's Google credentials and network access: %v", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, 0, retryable{fmt.Errorf("embeddings: the answer from Vertex AI was cut off: %v", err)}
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
	case code == http.StatusBadRequest:
		return fmt.Errorf("embeddings: Vertex AI refused the request (400). Check PM_EMBEDDINGS_MODEL and PM_EMBEDDINGS_DIMENSIONS.%s", detail)
	}
	return fmt.Errorf("embeddings: Vertex AI refused the request (%d).%s", code, detail)
}

func retryAfter(h string) time.Duration {
	if s, err := strconv.Atoi(strings.TrimSpace(h)); err == nil && s > 0 {
		return min(time.Duration(s)*time.Second, 60*time.Second)
	}
	return 0
}
