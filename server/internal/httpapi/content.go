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
	"github.com/kubek80/process-manager/server/internal/engagement"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/requests"
)

// nouns for messages and the audit trail
var noun = map[string]string{docs.Process: "process", docs.Standard: "standard", docs.Catalog: "lists"}

// VersionHeader carries the version of the lists, which are served as one bare document.
const VersionHeader = "X-Document-Version"

// syncTimeout bounds one regeneration of skills after a save. syncWait is how long the answer
// to the save waits for it: well below the time the server has to write an answer.
const (
	syncTimeout = 2 * time.Minute
	syncWait    = 20 * time.Second
)

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

// headOf reads what a document belongs to (its team, platform and practice) and its status.
func headOf(body []byte) (rbac.Belongs, string) {
	var head struct {
		Owner    string `json:"owner"`
		Platform string `json:"platform"`
		Practice string `json:"practice"`
		Status   string `json:"status"`
	}
	_ = json.Unmarshal(body, &head)
	return rbac.Belongs{Owner: head.Owner, Platform: head.Platform, Practice: head.Practice}, head.Status
}

func belongsOf(body []byte) rbac.Belongs {
	b, _ := headOf(body)
	return b
}

// canSee: a draft is only for the people who work on it - whoever may edit it and the team
// that owns it. Everything else is for everyone who is signed in.
func canSee(s session, kind string, body []byte) bool {
	b, status := headOf(body)
	return status != "draft" || s.CanManageFeedback(kind, b)
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
		writeError(w, 403, "Only standards editors and the owners of its platform or practice can change this standard.")
	case docs.Catalog:
		writeError(w, 403, "Only people who manage the lists can change them.")
	default:
		writeError(w, 403, "Only process editors and the owners of its platform or practice can change this process.")
	}
}

// misplaced refuses a save that puts a document on a platform or in a practice, or takes it
// off one, that the caller does not own while they edit it only through such ownership.
type misplaced struct{ kind, field, name string }

func (m *misplaced) Error() string {
	editor := "a process editor"
	if m.kind == docs.Standard {
		editor = "a standards editor"
	}
	if m.field == "practice" {
		return fmt.Sprintf("Only an owner of the practice “%s”, or %s, can put this %s in that practice or take it out of it.", m.name, editor, noun[m.kind])
	}
	return fmt.Sprintf("Only an owner of the platform “%s”, or %s, can put this %s on that platform or take it off it.", m.name, editor, noun[m.kind])
}

// placeName is the name of a platform or practice in the lists, or its id.
func placeName(l docs.Lists, field, id string) string {
	if field == "practice" {
		return docs.Name(l.Practices, id)
	}
	return docs.Name(l.Platforms, id)
}

// deniedFor answers a save whose new content the caller may not store. Somebody who edits
// for a platform or a practice is told what is missing: it has to stay with one of theirs.
func deniedFor(w http.ResponseWriter, kind string, s session) {
	if kind != docs.Catalog && s.EditsSome() {
		writeError(w, 403, "You can only save a "+noun[kind]+" that belongs to a platform or practice you own.")
		return
	}
	denied(w, kind)
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
	// The save has happened. Whether the person who made it is still connected, or how long
	// their request has been running, must not decide whether the skills follow: the work runs
	// on its own. The answer waits for it a while - normally it is done in a moment - but not
	// for ever: other regenerations may be ahead of it in the queue.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), syncTimeout)
	done := make(chan struct{})
	if a.Background != nil {
		a.Background.Add(1)
	}
	go func() {
		defer close(done)
		defer cancel()
		if a.Background != nil {
			defer a.Background.Done()
		}
		var err error
		if kind == docs.Catalog {
			err = a.Skills.SyncAll(ctx, a.Docs) // names of teams and tools appear in the text
		} else {
			err = a.Skills.SyncChanged(ctx, a.Docs, kind, id)
		}
		if err != nil {
			a.Log.Error("skills not regenerated", "kind", kind, "id", id, "error", err)
		}
	}()
	select {
	case <-done:
	case <-time.After(syncWait):
		a.Log.Warn("skills are still being regenerated; the save is answered", "kind", kind, "id", id)
	}
}

// stillUsed refuses to drop entries of the lists that processes, standards or roles still
// name: they would be left pointing at nothing.
func (a *api) stillUsed(ctx context.Context, s session, body []byte) error {
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
	// Who uses an entry is said in a way that gives nothing away: drafts the caller cannot see
	// are only counted, and who holds a role is for admins.
	usedBy := map[string][]string{}
	hidden := map[string]int{}
	roles := map[string]map[string]bool{}
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
				switch {
				case !u.Lists[key][id]:
				case canSee(s, kind, d.Body):
					usedBy[entry] = append(usedBy[entry], "“"+title+"”")
				default:
					hidden[entry]++
				}
			}
		}
	}
	assignments, err := a.Roles.All(ctx)
	if err != nil {
		return err
	}
	for _, as := range assignments {
		key := rbac.ScopeList(as.Role)
		if entry := key + "/" + as.Scope; key != "" && contains(removed, entry) {
			if roles[entry] == nil {
				roles[entry] = map[string]bool{}
			}
			roles[entry][as.Email] = true
		}
	}
	var problems []string
	for _, entry := range removed {
		users := usedBy[entry]
		sort.Strings(users)
		if len(users) > 3 {
			users = append(users[:3], fmt.Sprintf("%d more", len(users)-3))
		}
		if n := hidden[entry]; n == 1 {
			users = append(users, "a draft you cannot see")
		} else if n > 1 {
			users = append(users, fmt.Sprintf("%d drafts you cannot see", n))
		}
		if people := roles[entry]; len(people) > 0 {
			if s.Admin {
				names := make([]string, 0, len(people))
				for email := range people {
					names = append(names, email)
				}
				sort.Strings(names)
				users = append(users, "the roles of "+strings.Join(names, ", "))
			} else {
				users = append(users, "roles that are limited to it (an admin can see whose)")
			}
		}
		if len(users) == 0 {
			continue
		}
		_, id, _ := strings.Cut(entry, "/")
		problems = append(problems, fmt.Sprintf("“%s” is still used by %s", id, strings.Join(users, ", ")))
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
		// The right is needed for what it belongs to now and for what it is moved to: an owner of
		// one platform can neither take over a document of another nor hand theirs away.
		if !s.CanEdit(kind, belongsOf(body)) {
			deniedFor(w, kind, s)
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
			err = a.stillUsed(r.Context(), s, body)
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		note := r.URL.Query().Get("note")
		doc, changed, err := a.Docs.Save(r.Context(), docs.Change{
			Kind: kind, ID: id, Body: body, By: s.Email, Note: note, Base: base,
			Check: func(current *docs.Doc) error {
				var stored *rbac.Belongs
				if current != nil {
					b := belongsOf(current.Body)
					if !s.CanEdit(kind, b) {
						return errDenied
					}
					stored = &b
				}
				// a document shared with another platform or practice stays with it
				if field, id := s.Misplaced(kind, stored, belongsOf(body)); field != "" {
					return &misplaced{kind: kind, field: field, name: placeName(lists, field, id)}
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
		var m *misplaced
		switch {
		case errors.Is(err, errDenied):
			denied(w, kind)
			return
		case errors.As(err, &m):
			writeError(w, 403, m.Error())
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

// reviewRhythm is the rhythm a document gets when its first review is recorded and it had none.
var reviewRhythm = map[string]int{docs.Process: 6, docs.Standard: 12}

// reviewerName is the name as it is stored with a review: the format allows 60 characters, and
// a long name (or an email address standing in for one) must not stop anybody from reviewing.
func reviewerName(name string) string {
	if r := []rune(name); len(r) > 60 {
		return string(r[:59]) + "…"
	}
	return name
}

// reviewDoc records that somebody confirmed a process or standard as still correct: today's
// date and their name. This is the one change the owning team may make themselves -
// they are the ones who are asked to review - besides everyone who may edit it. It is saved as
// a version like every other change.
func (a *api) reviewDoc(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		s := who(r)
		current, err := a.Docs.Get(r.Context(), kind, id)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		belongs, status := headOf(current.Body)
		switch {
		case !canSee(s, kind, current.Body):
			writeError(w, 404, "That does not exist.")
			return
		case !s.CanManageFeedback(kind, belongs):
			writeError(w, 403, "Only the team that owns this, and the people who can edit it, can confirm its review.")
			return
		case status != "" && status != "active":
			writeError(w, 400, "Only something that is in use is reviewed. Set its status to Active first.")
			return
		}
		base, ok := baseOf(r)
		if !ok {
			writeError(w, 400, "base must be a version number.")
			return
		}
		// The review is of exactly the version that was read above: its rights were checked and
		// the new content is built from it. A caller who names another version is told so; and
		// the save below is refused if somebody else gets in first.
		if base != nil && *base != current.Version {
			conflict(w, kind, &docs.Conflict{Current: current, Exists: true})
			return
		}
		body, err := docs.WithReview(current.Body, time.Now().UTC().Format("2006-01-02"), reviewerName(s.Name), reviewRhythm[kind])
		if err == nil {
			err = a.Schemas.Validate(kind, body)
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		const note = "Reviewed: confirmed as still correct"
		doc, changed, err := a.Docs.Save(r.Context(), docs.Change{
			Kind: kind, ID: id, Body: body, By: s.Email, Note: note, Base: &current.Version,
			After: func(ctx context.Context, tx pgx.Tx, saved docs.Doc) error {
				return audit.AddIn(ctx, tx, s.Email, s.Name, noun[kind]+".review", id, fmt.Sprintf("version %d", saved.Version))
			},
		})
		var c *docs.Conflict
		switch {
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
		writeJSON(w, 200, map[string]any{"ok": true, "changed": changed, "version": doc.Version, "updatedAt": doc.UpdatedAt, "updatedBy": doc.UpdatedBy, "document": doc.Body})
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
		// the document, its feedback, bookmarks and upvotes and the entry in the activity log go
		// together or not at all
		err := a.Docs.Remove(r.Context(), docs.Removal{
			Kind: kind, ID: id, By: s.Email, Base: base,
			Check: func(current *docs.Doc) error {
				switch {
				case s.CanEdit(kind, belongsOf(current.Body)):
					return nil
				case !canSee(s, kind, current.Body):
					return docs.ErrNotFound // a draft somebody cannot see does not exist for them
				}
				return errDenied
			},
			After: func(ctx context.Context, tx pgx.Tx) error {
				if err := feedback.DeleteByTargetIn(ctx, tx, kind, id); err != nil {
					return err
				}
				// bookmarks and upvotes go with it; its views and downloads stay in the statistics
				if err := engagement.DeleteByTargetIn(ctx, tx, kind, id); err != nil {
					return err
				}
				// a request it answered stays done and says its answer was removed
				if err := requests.AnswerGoneIn(ctx, tx, kind, id); err != nil {
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
	// versions that were drafts stay with the people who work on the document: number, note
	// and author included; versions from before the last deletion are for editors of the kind
	s := who(r)
	deleted := 0
	for _, v := range versions {
		if v.Deleted && v.Version > deleted {
			deleted = v.Version
		}
	}
	shown := versions[:0]
	for _, v := range versions {
		if v.Version < deleted && !s.EditsAll(kind) {
			continue
		}
		if v.Deleted || v.Status != "draft" || s.CanManageFeedback(kind, rbac.Belongs{Owner: v.Owner, Platform: v.Platform, Practice: v.Practice}) {
			shown = append(shown, v)
		}
	}
	if len(shown) == 0 {
		writeError(w, 404, "That does not exist.")
		return
	}
	writeJSON(w, 200, map[string]any{"versions": shown})
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
	// A deleted document's versions are not passed on to whoever creates something new under
	// its id: they are for the editors of every document of the kind.
	if s := who(r); !s.EditsAll(kind) {
		deleted, err := a.Docs.LastDeletion(r.Context(), kind, id)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if n < deleted {
			writeError(w, 404, "That does not exist.")
			return
		}
	}
	// earlier drafts stay with the people who work on the document
	if !canSee(who(r), kind, body) {
		writeError(w, 404, "That does not exist.")
		return
	}
	writeJSON(w, 200, body)
}
