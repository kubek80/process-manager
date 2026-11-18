package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/kubek80/process-manager/server/internal/retrieval"
)

// searchesPerMinute is how many searches by meaning one person may make in a minute. Each may
// call an outside service; a person typing searches far fewer.
const searchesPerMinute = 60

// search is GET /api/search?q=…&limit=…: the published processes and standards closest in
// meaning to the question, best first, each with the parts that matched. The page applies its
// filters, counts and paging itself.
func (a *api) search(w http.ResponseWriter, r *http.Request) {
	if !a.Index.Enabled() {
		writeError(w, 404, "Search by meaning is not switched on.")
		return
	}
	q := r.URL.Query().Get("q")
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > retrieval.MaxLimit {
			writeError(w, 400, "Ask for 1 to 500 results.")
			return
		}
		limit = n
	}
	if len([]rune(q)) > retrieval.MaxQuery {
		writeError(w, 400, "The question is too long: use at most 1000 characters.")
		return
	}
	page := retrieval.Page{Results: []retrieval.Result{}}
	if !blank(q) {
		if !a.searches.allow(who(r).Email, time.Now()) {
			w.Header().Set("Retry-After", "60")
			writeError(w, 429, "You have searched very often in the last minute. Wait a moment, then try again.")
			return
		}
		var err error
		page, err = a.Index.SearchPage(r.Context(), q, limit)
		switch {
		case errors.Is(err, retrieval.ErrProvider):
			a.Log.Error("search by meaning failed: the embeddings provider could not be reached", "provider", a.Index.Provider(), "error", err)
			writeError(w, 502, "Search by meaning is not available right now. Try again in a moment, or search by words.")
			return
		case errors.Is(err, retrieval.ErrNotSetUp):
			a.Log.Warn("search by meaning is not ready", "reason", err)
			writeError(w, 503, "Search by meaning is not ready yet. Try again in a moment, or search by words.")
			return
		case err != nil:
			a.fail(w, r, err)
			return
		}
	}
	writeJSON(w, 200, map[string]any{"results": page.Results, "truncated": page.Truncated})
}

func blank(s string) bool {
	for _, c := range s {
		if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
			return false
		}
	}
	return true
}

// brake counts what each person does in a fixed window and refuses more than max of it.
type brake struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	counts map[string]*window
}

type window struct {
	start time.Time
	n     int
}

func newBrake(max int, every time.Duration) *brake {
	return &brake{max: max, window: every, counts: map[string]*window{}}
}

func (b *brake) allow(who string, now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.counts) > 10000 { // forget windows that are over, so the map does not grow for ever
		for k, c := range b.counts {
			if now.Sub(c.start) >= b.window {
				delete(b.counts, k)
			}
		}
	}
	c := b.counts[who]
	if c == nil || now.Sub(c.start) >= b.window {
		c = &window{start: now}
		b.counts[who] = c
	}
	if c.n >= b.max {
		return false
	}
	c.n++
	return true
}

// searchInfo is what /api/me says about search by meaning: whether it is on, whether the
// question leaves the company, and with which provider ("builtin" or "vertex"; left out when off).
func (a *api) searchInfo() map[string]any {
	info := map[string]any{"meaning": a.Index.Enabled(), "outside": a.Index.Outside()}
	if p := a.Index.ProviderKind(); p != "" {
		info["provider"] = p
	}
	return info
}
