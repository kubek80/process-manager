package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/engagement"
)

// seen is what one request knows about the processes and standards: every one that exists,
// and whether the caller may see it.
type seen struct {
	targets map[engagement.Key]docs.Target
	visible map[engagement.Key]bool
}

func (v seen) exists(kind, id string) bool {
	_, ok := v.targets[engagement.Key{Kind: kind, ID: id}]
	return ok
}

func (v seen) canSee(kind, id string) bool { return v.visible[engagement.Key{Kind: kind, ID: id}] }

// documents reads every process and standard once and works out which the caller may see.
func (a *api) documents(ctx context.Context, s session) (seen, error) {
	out := seen{targets: map[engagement.Key]docs.Target{}, visible: map[engagement.Key]bool{}}
	for _, kind := range []string{docs.Process, docs.Standard} {
		list, err := a.Docs.List(ctx, kind)
		if err != nil {
			return out, err
		}
		for _, d := range list {
			t, ok := docs.TargetOf(d)
			if !ok {
				continue
			}
			k := engagement.Key{Kind: kind, ID: d.ID}
			out.targets[k] = t
			out.visible[k] = canSee(s, kind, d.Body)
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
// their own bookmarks and upvotes. A document with nothing yet is left out.
func (a *api) getEngagement(w http.ResponseWriter, r *http.Request) {
	s := who(r)
	known, err := a.documents(r.Context(), s)
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
		if known.visible[k] {
			counts[k.Kind][k.ID] = *c
		}
	}
	bookmarks, upvotes, err := a.Engagement.Mine(r.Context(), s.Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	myBookmarks := []engagement.Bookmark{}
	for _, b := range bookmarks {
		if known.canSee(b.Kind, b.ID) {
			myBookmarks = append(myBookmarks, b)
		}
	}
	myUpvotes := []engagement.Ref{}
	for _, u := range upvotes {
		if known.canSee(u.Kind, u.ID) {
			myUpvotes = append(myUpvotes, u)
		}
	}
	writeJSON(w, 200, map[string]any{
		"counts": counts,
		"mine":   map[string]any{"bookmarks": myBookmarks, "upvotes": myUpvotes},
	})
}

// recordView counts a view: once per person, document and day. It must never get in the way of
// reading: a failure to store it is logged and the answer is the same.
func (a *api) recordView(w http.ResponseWriter, r *http.Request) {
	d, err := a.visibleDoc(r)
	switch {
	case errors.Is(err, docs.ErrNotFound):
		writeError(w, 404, "That does not exist.")
		return
	case err != nil:
		a.Log.Warn("view not counted", "path", r.URL.Path, "error", err)
	default:
		if err := a.Engagement.RecordView(r.Context(), d.Kind, d.ID, who(r).Email, time.Now()); err != nil {
			a.Log.Warn("view not counted", "path", r.URL.Path, "error", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
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
			a.fail(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// upvote gives or takes back the caller's "this is useful" and answers with the number of votes.
func (a *api) upvote(on bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		d, err := a.visibleDoc(r)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		n, err := a.Engagement.SetUpvote(r.Context(), who(r).Email, d.Kind, d.ID, on)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]int{"upvotes": n})
	}
}
