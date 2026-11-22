package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/docs"
)

// Working drafts: changes to a process or standard that are not stored as the document itself -
// unpublished changes to a published one, or what cannot be saved yet as a never-published one -
// shared by everyone who may edit it. Only they ever learn that one exists: for everybody else
// every answer here is the one for something that does not exist. See docs/backend.md.

// notThere is the answer for a document or working draft that does not exist, or that the caller
// may not edit.
func notThere(w http.ResponseWriter) { writeError(w, 404, "That does not exist.") }

// errHidden: the caller may not edit the published document, so its draft does not exist for them.
var errHidden = errors.New("hidden")

// errContent: the caller may edit the published document but not what the draft makes of it.
var errContent = errors.New("not allowed for the new content")

// revOf reads the revision of the working draft a change was made from. It is required.
func revOf(r *http.Request) (int, bool) {
	n, err := strconv.Atoi(r.URL.Query().Get("rev"))
	return n, err == nil && n >= 0
}

func draftJSON(d docs.WorkingDraft) map[string]any {
	out := map[string]any{"revision": d.Revision, "base": d.Base, "updatedBy": d.UpdatedBy, "updatedAt": d.UpdatedAt}
	if d.UpdatedByName != "" {
		out["updatedByName"] = d.UpdatedByName
	}
	return out
}

// nameOf is the name to keep with a draft: the one the sign-in gave, "" when it gave none.
func nameOf(s session) string {
	if name := strings.TrimSpace(s.Name); name != "" && !strings.EqualFold(name, s.Email) {
		return name
	}
	return ""
}

// draftConflict tells the app that somebody else saved, published or discarded the working
// draft first. The shape is that of a version conflict, with "draft": true; "version" is the
// revision of the draft.
func draftConflict(w http.ResponseWriter, c *docs.DraftConflict) {
	if c.Current == nil && c.Discarded {
		writeJSON(w, 409, map[string]any{
			"error":    "The newer changes kept in this draft were discarded by someone else while you were working on them.",
			"conflict": map[string]any{"exists": false, "draft": true},
		})
		return
	}
	if c.Current == nil {
		writeJSON(w, 409, map[string]any{
			"error":    "These unpublished changes were published or discarded by someone else while you were working on them.",
			"conflict": map[string]any{"exists": false, "draft": true},
		})
		return
	}
	info := map[string]any{"exists": true, "draft": true, "version": c.Current.Revision, "updatedAt": c.Current.UpdatedAt, "updatedBy": c.Current.UpdatedBy}
	if c.Current.UpdatedByName != "" {
		info["updatedByName"] = c.Current.UpdatedByName
	}
	writeJSON(w, 409, map[string]any{
		"error":    fmt.Sprintf("%s saved newer unpublished changes while you were working on this.", draftAuthor(*c.Current)),
		"conflict": info,
	})
}

// draftAuthor names whoever saved a working draft last: by name when it is known.
func draftAuthor(d docs.WorkingDraft) string {
	if d.UpdatedByName != "" {
		return d.UpdatedByName
	}
	return d.UpdatedBy
}

// draftPending refuses an ordinary save of a document that has a working draft. For a document
// that was never published the working draft is simply the newer state of the same draft:
// the answer is a draft conflict, so that the app asks whether to continue from it or to save
// over it (with draft=<revision>).
func draftPending(w http.ResponseWriter, kind string, p *docs.DraftPending) {
	n := noun[kind]
	by := draftAuthor(p.Draft)
	if p.Status == "draft" {
		info := map[string]any{"exists": true, "draft": true, "version": p.Draft.Revision, "updatedAt": p.Draft.UpdatedAt, "updatedBy": p.Draft.UpdatedBy}
		if p.Draft.UpdatedByName != "" {
			info["updatedByName"] = p.Draft.UpdatedByName
		}
		writeJSON(w, 409, map[string]any{
			"error":    fmt.Sprintf("%s saved newer changes to this draft while you were working on it.", by),
			"conflict": info,
			"draft":    p.Draft.Info(),
		})
		return
	}
	msg := fmt.Sprintf("This %s has unpublished changes by %s. Publish or discard them first, then make this change.", n, by)
	switch {
	case p.NewStatus == "draft":
		msg = fmt.Sprintf("This %s has unpublished changes by %s. Publish or discard them before you hide the %s from readers again.", n, by, n)
	case p.NewStatus == "deprecated" && p.Status != "deprecated":
		msg = fmt.Sprintf("This %s has unpublished changes by %s. Publish or discard them before you retire the %s.", n, by, n)
	}
	writeJSON(w, 409, map[string]any{
		"error": msg,
		"draft": p.Draft.Info(),
	})
}

// editable reads the published document and checks that the caller may work on its drafts
// (publish: may edit it). It answers the request when not: "does not exist" for whoever may not
// work on its drafts; to a member of its platform or practice who asks to publish, who can.
func (a *api) editable(w http.ResponseWriter, r *http.Request, kind string, publish bool) (docs.Doc, bool) {
	id := r.PathValue("id")
	if !docs.ValidID(id) {
		notThere(w)
		return docs.Doc{}, false
	}
	cur, err := a.Docs.Get(r.Context(), kind, id)
	switch {
	case errors.Is(err, docs.ErrNotFound):
		notThere(w)
		return cur, false
	case err != nil:
		a.fail(w, r, err)
		return cur, false
	case !who(r).CanDraft(kind, belongsOf(cur.Body)):
		notThere(w)
		return cur, false
	case publish && !who(r).CanEdit(kind, belongsOf(cur.Body)):
		lists, err := a.Docs.Lists(r.Context())
		if err != nil {
			a.fail(w, r, err)
			return cur, false
		}
		e := notPublisher{kind: kind, b: belongsOf(cur.Body), lists: lists, does: "publish this " + noun[kind], after: "Your draft is saved for them."}
		writeError(w, 403, e.Error())
		return cur, false
	}
	return cur, true
}

func (a *api) getDraft(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cur, ok := a.editable(w, r, kind, false)
		if !ok {
			return
		}
		d, err := a.Docs.GetDraft(r.Context(), kind, cur.ID)
		if errors.Is(err, docs.ErrNotFound) {
			// for an editor "no unpublished changes" is an ordinary answer, not an error
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		out := draftJSON(d)
		out["doc"] = d.Body
		writeJSON(w, 200, out)
	}
}

func (a *api) putDraft(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rev, ok := revOf(r)
		if !ok {
			writeError(w, 400, "rev must be the revision of the draft (0 to start one).")
			return
		}
		base, ok := baseOf(r)
		if !ok {
			writeError(w, 400, "base must be a version number.")
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		lists, err := a.Docs.Lists(r.Context()) // for the names in a refusal
		if err != nil {
			a.fail(w, r, err)
			return
		}
		s := who(r)
		var m *misplaced
		d, err := a.Docs.SaveDraft(r.Context(), docs.DraftChange{
			Kind: kind, ID: id, Body: body, By: s.Email, ByName: nameOf(s), Revision: rev, Base: base,
			// the same rule as a save that stays a draft: the published document and what the
			// draft makes of it, for whoever may work on its drafts (its members too)
			Check: func(current docs.Doc) error {
				stored := belongsOf(current.Body)
				if !s.CanDraft(kind, stored) {
					return errHidden
				}
				next := belongsOf(body)
				if !s.CanDraft(kind, next) {
					return errContent
				}
				if field, place := s.MisplacedDraft(kind, &stored, next); field != "" {
					return &misplaced{kind: kind, field: field, name: placeName(lists, field, place), draft: true, member: s.MemberOfSome()}
				}
				return nil
			},
		})
		var c *docs.Conflict
		var dc *docs.DraftConflict
		switch {
		case errors.Is(err, docs.ErrNotFound) && a.deletedFor(r, kind, id):
			// deleted while somebody who could edit it worked on it: they are told who did it
			a.conflict(w, r, kind, id, &docs.Conflict{})
		case errors.Is(err, errHidden), errors.Is(err, docs.ErrNotFound):
			notThere(w)
		case errors.Is(err, errContent):
			deniedFor(w, kind, s)
		case errors.As(err, &m):
			writeError(w, 403, m.Error())
		case errors.As(err, &dc):
			draftConflict(w, dc)
		case errors.As(err, &c):
			a.conflict(w, r, kind, id, c)
		case err != nil:
			a.fail(w, r, err)
		default:
			// saving a draft is not in the activity log: it happens every few seconds
			out := draftJSON(d)
			// what the document itself is now: somebody may have retired, unpublished or saved it
			// meanwhile, which the person is told at once rather than when they publish
			if cur, err := a.Docs.Get(r.Context(), kind, id); err == nil {
				out["document"] = a.headJSON(r.Context(), cur)
			}
			writeJSON(w, 200, out)
		}
	}
}

func (a *api) deleteDraft(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rev, ok := revOf(r)
		if !ok {
			writeError(w, 400, "rev must be the revision of the draft.")
			return
		}
		s := who(r)
		var stored docs.Doc
		err := a.Docs.DiscardDraft(r.Context(), kind, id, rev,
			func(current docs.Doc) error {
				if !s.CanDraft(kind, belongsOf(current.Body)) {
					return errHidden
				}
				stored = current
				return nil
			},
			func(ctx context.Context, tx pgx.Tx, d docs.WorkingDraft) error {
				detail := fmt.Sprintf("unpublished changes last saved by %s; readers keep version %d", d.UpdatedBy, d.Base)
				if !docs.Published(stored.Body) {
					detail = fmt.Sprintf("changes kept in its draft, last saved by %s; the %s stays as stored in version %d, which readers do not see", d.UpdatedBy, noun[kind], stored.Version)
				}
				return audit.AddIn(ctx, tx, s.Email, s.Name, noun[kind]+".discard", id, detail)
			})
		var dc *docs.DraftConflict
		switch {
		case errors.Is(err, errHidden), errors.Is(err, docs.ErrNotFound):
			notThere(w)
		case errors.As(err, &dc):
			// rights are checked before the draft is looked for: only editors get here
			draftConflict(w, dc)
		case err != nil:
			a.fail(w, r, err)
		default:
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

// publishDraft publishes the working draft as the next version of the document, through the
// ordinary save: the same checks, the same activity log entry, skills and search follow.
func (a *api) publishDraft(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rev, ok := revOf(r)
		if !ok {
			writeError(w, 400, "rev must be the revision of the draft.")
			return
		}
		var over *int
		if raw := r.URL.Query().Get("over"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 {
				writeError(w, 400, "over must be a version number.")
				return
			}
			over = &n
		}
		cur, ok := a.editable(w, r, kind, true)
		if !ok {
			return
		}
		d, err := a.Docs.GetDraft(r.Context(), kind, cur.ID)
		switch {
		case errors.Is(err, docs.ErrNotFound):
			draftConflict(w, &docs.DraftConflict{})
			return
		case err != nil:
			a.fail(w, r, err)
			return
		case d.Revision != rev:
			draftConflict(w, &docs.DraftConflict{Current: &d})
			return
		}
		// What it is saved on top of: the version the draft was based on, so that a version
		// somebody published since is not overwritten unseen - unless the person decided to
		// publish over it (over), or all that came in between is a review confirmation: then the
		// draft is moved onto the current version. Either way the review record (when, by whom)
		// is the published one; see docs.ForPublishing.
		base := d.Base
		switch {
		case over != nil:
			base = *over
		case d.Base != cur.Version:
			was, err := a.Docs.VersionBody(r.Context(), kind, cur.ID, d.Base)
			if err != nil && !errors.Is(err, docs.ErrNotFound) {
				a.fail(w, r, err)
				return
			}
			if err == nil && docs.OnlyReviewDiffers(was, cur.Body) {
				base = cur.Version
			}
		}
		body, err := docs.ForPublishing(d.Body, cur.Body)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		a.save(w, r, saving{kind: kind, id: cur.ID, body: body, base: &base, note: r.URL.Query().Get("note"),
			action: "publish", drafts: docs.PublishDraft, revision: rev})
	}
}
