package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// nouns for messages and the audit trail
var noun = map[string]string{docs.Process: "process", docs.Standard: "standard", docs.Catalog: "lists"}

func (a *api) listDocs(kind, key string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := a.Docs.List(r.Context(), kind)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		bodies := make([]json.RawMessage, 0, len(list))
		for _, d := range list {
			bodies = append(bodies, d.Body)
		}
		writeJSON(w, 200, map[string]any{key: bodies})
	}
}

func (a *api) getCatalog(w http.ResponseWriter, r *http.Request) {
	d, err := a.Docs.Get(r.Context(), docs.Catalog, docs.CatalogID)
	if errors.Is(err, docs.ErrNotFound) {
		writeJSON(w, 200, json.RawMessage(docs.EmptyCatalog))
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, d.Body)
}

// ownerOf reads the owning team or unit from a document body.
func ownerOf(body []byte) string {
	var head struct {
		Owner string `json:"owner"`
	}
	_ = json.Unmarshal(body, &head)
	return head.Owner
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

// syncSkills regenerates what depends on a changed document. A failure is logged: the save
// itself has already happened and the next save or restart regenerates again.
func (a *api) syncSkills(r *http.Request, kind, id string, doc *docs.Doc) {
	var err error
	if kind == docs.Catalog {
		err = a.Skills.SyncAll(r.Context(), a.Docs) // names of teams and tools appear in the text
	} else {
		var c skills.Context
		if c, err = skills.NewContext(r.Context(), a.Docs); err == nil {
			err = a.Skills.SyncSource(r.Context(), kind, id, doc, c)
		}
	}
	if err != nil {
		a.Log.Error("skills not regenerated", "kind", kind, "id", id, "error", err)
	}
}

func (a *api) putDoc(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if kind == docs.Catalog {
			id = docs.CatalogID
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
		if existing, err := a.Docs.Get(r.Context(), kind, id); err == nil && !s.CanEdit(kind, ownerOf(existing.Body)) {
			denied(w, kind)
			return
		}
		if err := a.Schemas.Validate(kind, body); err != nil {
			a.fail(w, r, err)
			return
		}
		doc, changed, err := a.Docs.Put(r.Context(), kind, id, body, s.Email)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if changed {
			a.record(r, noun[kind]+".save", id, fmt.Sprintf("revision %d", doc.Version))
			a.syncSkills(r, kind, id, &doc)
		}
		writeJSON(w, 200, map[string]any{"ok": true, "version": doc.Version})
	}
}

func (a *api) deleteDoc(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		existing, err := a.Docs.Get(r.Context(), kind, id)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if !who(r).CanEdit(kind, ownerOf(existing.Body)) {
			denied(w, kind)
			return
		}
		if err := a.Docs.Delete(r.Context(), kind, id, who(r).Email); err != nil {
			a.fail(w, r, err)
			return
		}
		if err := a.Feedback.DeleteByTarget(r.Context(), kind, id); err != nil {
			a.fail(w, r, err)
			return
		}
		a.record(r, noun[kind]+".delete", id, "")
		a.syncSkills(r, kind, id, nil)
		writeJSON(w, 200, map[string]bool{"ok": true})
	}
}

// historyAccess checks the kind in the address and whether the caller may see its history:
// whoever may edit the document; for a deleted one, admins.
func (a *api) historyAccess(w http.ResponseWriter, r *http.Request) (kind, id string, ok bool) {
	kind, id = r.PathValue("kind"), r.PathValue("id")
	if !docs.ValidKind(kind) || !docs.ValidID(id) {
		writeError(w, 404, "That does not exist.")
		return "", "", false
	}
	s := who(r)
	existing, err := a.Docs.Get(r.Context(), kind, id)
	allowed := s.Admin
	if err == nil {
		allowed = s.CanEdit(kind, ownerOf(existing.Body))
	}
	if !allowed {
		writeError(w, 403, "Only people who can edit this can see its history.")
		return "", "", false
	}
	return kind, id, true
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
	writeJSON(w, 200, body)
}
