package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/engagement"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

// hidden is the set of drafts the caller may not see: everything else that exists is for
// everyone who is signed in. Only drafts can be hidden, so only they are read - from the columns
// the database keeps of each body, without reading any body.
type hidden map[engagement.Key]bool

func (h hidden) has(kind, id string) bool { return h[engagement.Key{Kind: kind, ID: id}] }

func (a *api) hiddenFor(ctx context.Context, s session) (hidden, error) {
	drafts, err := a.Engagement.Drafts(ctx)
	if err != nil {
		return nil, err
	}
	out := hidden{}
	for _, d := range drafts {
		if !s.CanSeeDraft(d.Kind, rbac.Belongs{Owner: d.Owner, Platform: d.Platform, Practice: d.Practice}) {
			out[d.Key] = true
		}
	}
	return out, nil
}

// countedKind: views, bookmarks and upvotes are about processes and standards.
func countedKind(kind string) bool { return kind == docs.Process || kind == docs.Standard }

// visibleDoc finds the process or standard named in the address. docs.ErrNotFound also when
// the caller may not see it: a draft somebody cannot see does not exist for them.
func (a *api) visibleDoc(r *http.Request) (docs.Doc, error) {
	kind, id := r.PathValue("kind"), r.PathValue("id")
	if !countedKind(kind) || !docs.ValidID(id) {
		return docs.Doc{}, docs.ErrNotFound
	}
	d, err := a.Docs.Get(r.Context(), kind, id)
	if err != nil {
		return d, err
	}
	if !canSee(who(r), kind, d.Body) {
		return docs.Doc{}, docs.ErrNotFound
	}
	return d, nil
}

// getEngagement: the all-time counts of every process and standard the caller may see, and
// their own bookmarks and upvotes. A document with nothing yet is left out. The work does not
// depend on how many views were ever recorded: the numbers are kept per document.
func (a *api) getEngagement(w http.ResponseWriter, r *http.Request) {
	s := who(r)
	hide, err := a.hiddenFor(r.Context(), s)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	all, err := a.Engagement.Counts(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	counts := map[string]map[string]engagement.Counts{docs.Process: {}, docs.Standard: {}}
	for k, c := range all {
		if !hide[k] {
			counts[k.Kind][k.ID] = c
		}
	}
	bookmarks, upvotes, err := a.Engagement.Mine(r.Context(), s.Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	// bookmarks and upvotes go with their document, so what is left exists; drafts are filtered
	myBookmarks := []engagement.Bookmark{}
	for _, b := range bookmarks {
		if !hide.has(b.Kind, b.ID) {
			myBookmarks = append(myBookmarks, b)
		}
	}
	myUpvotes := []engagement.Ref{}
	for _, u := range upvotes {
		if !hide.has(u.Kind, u.ID) {
			myUpvotes = append(myUpvotes, u)
		}
	}
	writeJSON(w, 200, map[string]any{
		"counts": counts,
		"mine":   map[string]any{"bookmarks": myBookmarks, "upvotes": myUpvotes},
	})
}

// recordView counts a view: once per person, document and day. It answers the all-time views
// and people of the document, so that the page can show its own view at once. It must never get
// in the way of reading: a failure to store it is logged and the numbers are answered as they are.
func (a *api) recordView(w http.ResponseWriter, r *http.Request) {
	d, err := a.visibleDoc(r)
	if errors.Is(err, docs.ErrNotFound) {
		writeError(w, 404, "That does not exist.")
		return
	}
	kind, id := r.PathValue("kind"), r.PathValue("id")
	var views, people int
	if err == nil {
		views, people, err = a.Engagement.RecordView(r.Context(), d.Kind, d.ID, who(r).Email, time.Now())
	}
	if err != nil {
		a.Log.Warn("view not counted", "path", r.URL.Path, "error", err)
		if views, people, err = a.Engagement.ViewCounts(r.Context(), kind, id); err != nil {
			views, people = 0, 0
		}
	}
	writeJSON(w, 200, map[string]int{"views": views, "people": people})
}

// bookmark keeps or drops a process or standard for the caller. Dropping always works, also
// for something that is gone or that the caller can no longer see.
func (a *api) bookmark(on bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind, id := r.PathValue("kind"), r.PathValue("id")
		if on {
			if _, err := a.visibleDoc(r); err != nil {
				a.fail(w, r, err)
				return
			}
		} else if !countedKind(kind) || !docs.ValidID(id) {
			writeError(w, 404, "That does not exist.")
			return
		}
		if err := a.Engagement.SetBookmark(r.Context(), who(r).Email, kind, id, on); err != nil {
			a.fail(w, r, goneAsNotFound(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// upvote gives or takes back the caller's "this is useful" and answers with the number of votes.
// Taking it back always works, like dropping a bookmark; for a document the caller cannot see
// (any more) the answer is 204 without the number.
func (a *api) upvote(on bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind, id := r.PathValue("kind"), r.PathValue("id")
		_, err := a.visibleDoc(r)
		visible := err == nil
		switch {
		case on && err != nil:
			a.fail(w, r, err)
			return
		case !on && !visible && (!countedKind(kind) || !docs.ValidID(id)):
			writeError(w, 404, "That does not exist.")
			return
		case !on && !visible && !errors.Is(err, docs.ErrNotFound):
			a.fail(w, r, err)
			return
		}
		n, err := a.Engagement.SetUpvote(r.Context(), who(r).Email, kind, id, on)
		if err != nil {
			a.fail(w, r, goneAsNotFound(err))
			return
		}
		if !visible {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeJSON(w, 200, map[string]int{"upvotes": n})
	}
}
