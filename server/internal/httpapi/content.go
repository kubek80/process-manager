package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
)

// nouns for messages and the audit trail
var noun = map[string]string{docs.Process: "process", docs.Standard: "standard", docs.Catalog: "lists"}

// VersionHeader carries the version of the lists, which are served as one bare document.
const VersionHeader = "X-Document-Version"

// errDenied is returned from inside a save when the stored document belongs to someone the
// caller may not edit for.
var errDenied = errors.New("not allowed")

// docMeta is what the app needs to know about a document besides its content.
type docMeta struct {
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy string    `json:"updatedBy"`
}

func metaOf(d docs.Doc) docMeta {
	return docMeta{Version: d.Version, UpdatedAt: d.UpdatedAt, UpdatedBy: d.UpdatedBy}
}

// headOf reads the owning team or unit and the status from a document body.
func headOf(body []byte) (owner, status string) {
	var head struct {
		Owner  string `json:"owner"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal(body, &head)
	return head.Owner, head.Status
}

func ownerOf(body []byte) string {
	owner, _ := headOf(body)
	return owner
}

// canSee: a draft is only for the people who work on it - whoever may edit it and the team
// or unit that owns it. Everything else is for everyone who is signed in.
func canSee(s session, kind string, body []byte) bool {
	owner, status := headOf(body)
	return status != "draft" || s.CanManageFeedback(kind, owner)
}

func (a *api) listDocs(kind, key string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := a.Docs.List(r.Context(), kind)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		s := who(r)
		bodies := make([]json.RawMessage, 0, len(list))
		meta := map[string]docMeta{}
		for _, d := range list {
			if !canSee(s, kind, d.Body) {
				continue
			}
			bodies = append(bodies, d.Body)
			meta[d.ID] = metaOf(d)
		}
		writeJSON(w, 200, map[string]any{key: bodies, "meta": meta})
	}
}

func (a *api) getCatalog(w http.ResponseWriter, r *http.Request) {
	d, err := a.Docs.Get(r.Context(), docs.Catalog, docs.CatalogID)
	if errors.Is(err, docs.ErrNotFound) {
		w.Header().Set(VersionHeader, "0")
		writeJSON(w, 200, json.RawMessage(docs.EmptyCatalog))
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	w.Header().Set(VersionHeader, strconv.Itoa(d.Version))
	writeJSON(w, 200, d.Body)
}

func denied(w http.ResponseWriter, kind string) {
	switch kind {
	case docs.Standard:
		writeError(w, 403, "Only editors of that unit's standards can change this.")
	case docs.Catalog:
		writeError(w, 403, "Only people who manage the lists can change them.")
	default:
		writeError(w, 403, "Only process editors can change processes.")
	}
}

// conflict tells the app that somebody else saved first, and who.
func conflict(w http.ResponseWriter, kind string, c *docs.Conflict) {
	if !c.Exists {
		writeJSON(w, 409, map[string]any{
			"error":    "This was deleted by someone else while you were working on it.",
			"conflict": map[string]any{"exists": false},
		})
		return
	}
	msg := fmt.Sprintf("%s saved a newer version (version %d) while you were working on this.", c.Current.UpdatedBy, c.Current.Version)
	if kind == docs.Catalog {
		msg = fmt.Sprintf("%s changed the lists (version %d) while you were working on them.", c.Current.UpdatedBy, c.Current.Version)
	}
	writeJSON(w, 409, map[string]any{
		"error":    msg,
		"conflict": map[string]any{"exists": true, "version": c.Current.Version, "updatedAt": c.Current.UpdatedAt, "updatedBy": c.Current.UpdatedBy},
	})
}

// baseOf reads the version a change was made from. Absent: no check.
func baseOf(r *http.Request) (*int, bool) {
	raw := r.URL.Query().Get("base")
	if raw == "" {
		return nil, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		return nil, false
	}
	return &n, true
}

// syncSkills regenerates what depends on a changed document. A failure is logged: the save
// itself has already happened and the next save or restart regenerates again.
func (a *api) syncSkills(ctx context.Context, kind, id string) {
	var err error
	if kind == docs.Catalog {
		err = a.Skills.SyncAll(ctx, a.Docs) // names of teams and tools appear in the text
	} else {
		err = a.Skills.SyncChanged(ctx, a.Docs, kind, id)
	}
	if err != nil {
		a.Log.Error("skills not regenerated", "kind", kind, "id", id, "error", err)
	}
}

// stillUsed refuses to drop entries of the lists that processes, standards or roles still
// name: they would be left pointing at nothing.
func (a *api) stillUsed(ctx context.Context, body []byte) error {
	old, err := a.Docs.Lists(ctx)
	if err != nil {
		return err
	}
	var next docs.Lists
	if err := json.Unmarshal(body, &next); err != nil {
		return fmt.Errorf("%w: not the lists: %v", docs.ErrInvalid, err)
	}
	removed := docs.Removed(old, next)
	if len(removed) == 0 {
		return nil
	}
	usedBy := map[string][]string{}
	for _, kind := range []string{docs.Process, docs.Standard} {
		list, err := a.Docs.List(ctx, kind)
		if err != nil {
			return err
		}
		for _, d := range list {
			u := docs.UsesOf(kind, d.Body)
			title := d.ID
			if t, ok := docs.TargetOf(d); ok && t.Title != "" {
				title = t.Title
			}
			for _, entry := range removed {
				key, id, _ := strings.Cut(entry, "/")
				if u.Lists[key][id] {
					usedBy[entry] = append(usedBy[entry], "“"+title+"”")
				}
			}
		}
	}
	assignments, err := a.Roles.All(ctx)
	if err != nil {
		return err
	}
	for _, as := range assignments {
		if entry := "teams/" + as.Scope; as.Scope != "" && contains(removed, entry) {
			usedBy[entry] = append(usedBy[entry], "a role of "+as.Email)
		}
	}
	var problems []string
	for _, entry := range removed {
		users := usedBy[entry]
		if len(users) == 0 {
			continue
		}
		_, id, _ := strings.Cut(entry, "/")
		sort.Strings(users)
		more := ""
		if len(users) > 3 {
			more = fmt.Sprintf(" and %d more", len(users)-3)
			users = users[:3]
		}
		problems = append(problems, fmt.Sprintf("“%s” is still used by %s%s", id, strings.Join(users, ", "), more))
	}
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("%w: cannot remove what is still in use: %s. Change those first.", docs.ErrInvalid, strings.Join(problems, "; "))
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (a *api) putDoc(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if kind == docs.Catalog {
			id = docs.CatalogID
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
		s := who(r)
		// the right is needed for the unit it belongs to now and for the unit it is moved to
		if !s.CanEdit(kind, ownerOf(body)) {
			denied(w, kind)
			return
		}
		if err := a.Schemas.Validate(kind, body); err != nil {
			a.fail(w, r, err)
			return
		}
		lists, err := a.Docs.Lists(r.Context())
		if err == nil && kind == docs.Catalog {
			err = json.Unmarshal(body, &lists) // the lists are checked against themselves
		}
		if err == nil {
			err = docs.Check(kind, body, lists)
		}
		if err == nil && kind == docs.Catalog {
			err = a.stillUsed(r.Context(), body)
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		note := r.URL.Query().Get("note")
		doc, changed, err := a.Docs.Save(r.Context(), docs.Change{
			Kind: kind, ID: id, Body: body, By: s.Email, Note: note, Base: base,
			Check: func(current *docs.Doc) error {
				if current != nil && !s.CanEdit(kind, ownerOf(current.Body)) {
					return errDenied
				}
				return nil
			},
			After: func(ctx context.Context, tx pgx.Tx, saved docs.Doc) error {
				detail := fmt.Sprintf("version %d", saved.Version)
				if n := strings.TrimSpace(note); n != "" {
					detail += ": " + n
				}
				return audit.AddIn(ctx, tx, s.Email, s.Name, noun[kind]+".save", id, detail)
			},
		})
		var c *docs.Conflict
		switch {
		case errors.Is(err, errDenied):
			denied(w, kind)
			return
		case errors.As(err, &c):
			conflict(w, kind, c)
			return
		case err != nil:
			a.fail(w, r, err)
			return
		}
		if changed {
			a.syncSkills(r.Context(), kind, id)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "changed": changed, "version": doc.Version, "updatedAt": doc.UpdatedAt, "updatedBy": doc.UpdatedBy})
	}
}

func (a *api) deleteDoc(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		base, ok := baseOf(r)
		if !ok {
			writeError(w, 400, "base must be a version number.")
			return
		}
		s := who(r)
		// the document, its feedback and the entry in the activity log go together or not at all
		err := a.Docs.Remove(r.Context(), docs.Removal{
			Kind: kind, ID: id, By: s.Email, Base: base,
			Check: func(current *docs.Doc) error {
				if !s.CanEdit(kind, ownerOf(current.Body)) {
					return errDenied
				}
				return nil
			},
			After: func(ctx context.Context, tx pgx.Tx) error {
				if err := feedback.DeleteByTargetIn(ctx, tx, kind, id); err != nil {
					return err
				}
				return audit.AddIn(ctx, tx, s.Email, s.Name, noun[kind]+".delete", id, "")
			},
		})
		var c *docs.Conflict
		switch {
		case errors.Is(err, errDenied):
			denied(w, kind)
			return
		case errors.As(err, &c):
			conflict(w, kind, c)
			return
		case err != nil:
			a.fail(w, r, err)
			return
		}
		a.syncSkills(r.Context(), kind, id)
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

// historyAccess checks the kind in the address and whether the caller may see its history:
// whoever can see the document; for a deleted one, admins.
func (a *api) historyAccess(w http.ResponseWriter, r *http.Request) (kind, id string, ok bool) {
	kind, id = r.PathValue("kind"), r.PathValue("id")
	if !docs.ValidKind(kind) || !docs.ValidID(id) {
		writeError(w, 404, "That does not exist.")
		return "", "", false
	}
	s := who(r)
	existing, err := a.Docs.Get(r.Context(), kind, id)
	switch {
	case err == nil && canSee(s, kind, existing.Body):
		return kind, id, true
	case err == nil, errors.Is(err, docs.ErrNotFound) && !s.Admin:
		// a draft somebody may not see looks the same as something that does not exist
		writeError(w, 404, "That does not exist.")
	case errors.Is(err, docs.ErrNotFound):
		return kind, id, true // admins can look at what was deleted
	default:
		a.fail(w, r, err)
	}
	return "", "", false
}

func (a *api) history(w http.ResponseWriter, r *http.Request) {
	kind, id, ok := a.historyAccess(w, r)
	if !ok {
		return
	}
	versions, err := a.Docs.History(r.Context(), kind, id)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if len(versions) == 0 {
		writeError(w, 404, "That does not exist.")
		return
	}
	writeJSON(w, 200, map[string]any{"versions": versions})
}

func (a *api) historyVersion(w http.ResponseWriter, r *http.Request) {
	kind, id, ok := a.historyAccess(w, r)
	if !ok {
		return
	}
	n, err := strconv.Atoi(r.PathValue("version"))
	if err != nil {
		writeError(w, 404, "That does not exist.")
		return
	}
	body, err := a.Docs.VersionBody(r.Context(), kind, id, n)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	// earlier drafts stay with the people who work on the document
	if !canSee(who(r), kind, body) {
		writeError(w, 404, "That does not exist.")
		return
	}
	writeJSON(w, 200, body)
}
