package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
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

// errHiddenDoc is returned from inside a save when the stored document is a draft the caller may
// not see: for them it does not exist.
var errHiddenDoc = errors.New("hidden draft")

// docMeta is what the app needs to know about a document besides its content. Draft says that
// it has unpublished changes, and is only there for the people who may edit it.
type docMeta struct {
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy string    `json:"updatedBy"`
	// UpdatedByName is the name of whoever saved it last, where the portal knows it.
	UpdatedByName string    `json:"updatedByName,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	// PublishedAt is when readers could first see it (its first version that was not a draft);
	// absent for a document never published.
	PublishedAt *time.Time      `json:"publishedAt,omitempty"`
	Draft       *docs.DraftInfo `json:"draft,omitempty"`
}

func metaOf(d docs.Doc) docMeta {
	return docMeta{Version: d.Version, UpdatedAt: d.UpdatedAt, UpdatedBy: d.UpdatedBy, CreatedAt: d.CreatedAt}
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

// canSee: a draft is only for the people who work on it - whoever may edit it, the members of
// its platform or practice, and the team that owns it. Everything else is for everyone who is
// signed in.
func canSee(s session, kind string, body []byte) bool {
	b, status := headOf(body)
	return status != "draft" || s.CanSeeDraft(kind, b)
}

func (a *api) listDocs(kind, key string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		list, err := a.Docs.List(r.Context(), kind)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		// unpublished changes: one query for the whole list, shown only to who may edit
		drafts, err := a.Docs.Drafts(r.Context(), kind)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		// when each was first published: one query for the whole list
		published, err := a.Docs.Published(r.Context(), kind)
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
			m := metaOf(d)
			if at, ok := published[d.ID]; ok {
				m.PublishedAt = &at
			}
			if info, ok := drafts[d.ID]; ok && s.CanDraft(kind, belongsOf(d.Body)) {
				m.Draft = &info
			}
			meta[d.ID] = m
		}
		// who saved each last, by name where it is known: one lookup for the whole list
		var emails []string
		for _, m := range meta {
			if strings.Contains(m.UpdatedBy, "@") && !slices.Contains(emails, m.UpdatedBy) {
				emails = append(emails, m.UpdatedBy)
			}
		}
		if names, err := a.names(r.Context(), emails); err == nil {
			for id, m := range meta {
				if n := names[m.UpdatedBy]; n != "" {
					m.UpdatedByName = n
					meta[id] = m
				}
			}
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
// off one, that the caller does not own while they edit it only through such ownership. For a
// save that stays a draft (draft), being a member of it is enough as well.
type misplaced struct {
	kind, field, name string
	draft             bool
	member            bool // the person is a member of some platform or practice
}

func (m *misplaced) Error() string {
	who := "an owner"
	if m.draft && m.member {
		who = "an owner or member"
	}
	if m.field == "practice" {
		return fmt.Sprintf("Only %s of the practice “%s”, or %s, can put this %s in that practice or take it out of it.", who, m.name, editorOf(m.kind), noun[m.kind])
	}
	return fmt.Sprintf("Only %s of the platform “%s”, or %s, can put this %s on that platform or take it off it.", who, m.name, editorOf(m.kind), noun[m.kind])
}

// editorOf is the role that edits every document of the kind, in words.
func editorOf(kind string) string {
	if kind == docs.Standard {
		return "a standards editor"
	}
	return "a process editor"
}

// notPublisher refuses a member of a platform or practice what only its owners and the
// editors of the kind may do: publish, retire, unpublish, bring back or delete. It says who can.
type notPublisher struct {
	kind  string
	b     rbac.Belongs
	lists docs.Lists
	does  string // "publish this process", "retire this standard", ...
	after string // a sentence after it, or ""
	// first: readers would see it for the first time, so whoever publishes must own its whole
	// placement - both its platform and its practice when it has both
	first bool
}

func (e *notPublisher) Error() string {
	if e.first && e.b.Platform != "" && e.b.Practice != "" {
		msg := fmt.Sprintf("Only somebody who owns both the platform “%s” and the practice “%s”, or %s, can %s.",
			docs.Name(e.lists.Platforms, e.b.Platform), docs.Name(e.lists.Practices, e.b.Practice), editorOf(e.kind), e.does)
		if e.after != "" {
			msg += " " + e.after
		}
		return msg
	}
	var who []string
	if e.b.Platform != "" {
		who = append(who, "an owner of the platform “"+docs.Name(e.lists.Platforms, e.b.Platform)+"”")
	}
	if e.b.Practice != "" {
		who = append(who, "an owner of the practice “"+docs.Name(e.lists.Practices, e.b.Practice)+"”")
	}
	who = append(who, editorOf(e.kind))
	msg := fmt.Sprintf("Only %s, or %s, can %s.", strings.Join(who[:len(who)-1], ", "), who[len(who)-1], e.does)
	if len(who) == 1 {
		msg = fmt.Sprintf("Only %s can %s.", who[0], e.does)
	}
	if e.after != "" {
		msg += " " + e.after
	}
	return msg
}

// publishWords says what a save does to readers that a member may not do: from the stored
// status (storedDraft: never published, or new) to the new one. kept: the person's draft stays
// stored (publishing a working draft, or storing a never-published document from it).
func publishWords(kind string, storedDraft bool, stored, next string, kept bool) (does, after string) {
	n := noun[kind]
	switch {
	case storedDraft && next == "deprecated":
		return "retire this " + n, ""
	case kept:
		return "publish this " + n, "Your draft is saved for them."
	case storedDraft:
		return "publish this " + n, "Save it as a draft for them."
	case next == "draft":
		return "hide this " + n + " from readers", ""
	case next == "deprecated" && stored != "deprecated":
		return "retire this " + n, ""
	case next != "deprecated" && stored == "deprecated":
		return "bring back this " + n, ""
	}
	return "change this " + n + " as readers see it", "Save your changes as a draft for them."
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
	switch {
	case kind == docs.Catalog:
	case s.EditsSome() && s.MemberOfSome():
		writeError(w, 403, "You can only save a "+noun[kind]+" that belongs to a platform or practice you own or are a member of.")
		return
	case s.EditsSome():
		writeError(w, 403, "You can only save a "+noun[kind]+" that belongs to a platform or practice you own.")
		return
	case s.MemberOfSome():
		writeError(w, 403, "You can only save a draft of a "+noun[kind]+" that belongs to a platform or practice you are a member of.")
		return
	}
	denied(w, kind)
}

// conflict tells the app that somebody else saved or deleted first, and who: by name where the
// portal knows it. Who deleted something is said only to people who could edit its last version.
func (a *api) conflict(w http.ResponseWriter, r *http.Request, kind, id string, c *docs.Conflict) {
	ctx := r.Context()
	if !c.Exists {
		info := map[string]any{"exists": false}
		msg := "This was deleted by someone else while you were working on it."
		if del, ok := a.deletion(r, kind, id); ok {
			name := a.personName(ctx, del.By)
			info["deletedBy"], info["deletedAt"] = del.By, del.At
			if name != "" {
				info["deletedByName"] = name
			} else {
				name = del.By
			}
			msg = fmt.Sprintf("%s deleted this %s while you were working on it.", name, noun[kind])
		}
		writeJSON(w, 409, map[string]any{"error": msg, "conflict": info})
		return
	}
	info := a.headJSON(ctx, c.Current)
	info["exists"] = true
	by := c.Current.UpdatedBy
	if name, ok := info["updatedByName"].(string); ok {
		by = name
	}
	msg := fmt.Sprintf("%s saved a newer version (version %d) while you were working on this.", by, c.Current.Version)
	if kind == docs.Catalog {
		msg = fmt.Sprintf("%s changed the lists (version %d) while you were working on them.", by, c.Current.Version)
		delete(info, "status")
	}
	writeJSON(w, 409, map[string]any{"error": msg, "conflict": info})
}

// headJSON is what the app is told about the stored document after somebody else changed it:
// its version, its status ("draft", "active" or "deprecated"), and who saved it when (by name
// where known).
func (a *api) headJSON(ctx context.Context, d docs.Doc) map[string]any {
	status := docs.StatusOf(d.Body)
	if status == "" {
		status = "active"
	}
	out := map[string]any{"version": d.Version, "status": status, "updatedAt": d.UpdatedAt, "updatedBy": d.UpdatedBy}
	if name := a.personName(ctx, d.UpdatedBy); name != "" {
		out["updatedByName"] = name
	}
	return out
}

// personName is a person's name where the portal knows it, "" otherwise (also on a failure:
// a name is never a reason for an answer to fail).
func (a *api) personName(ctx context.Context, email string) string {
	if !strings.Contains(email, "@") {
		return ""
	}
	names, err := a.names(ctx, []string{email})
	if err != nil {
		return ""
	}
	return names[email]
}

// deletion is the last deletion of a document that does not exist now, told only to somebody
// who was working on it: who could edit its last version and names a version of it that they
// had (`base`, or `known` on a save of the working draft).
func (a *api) deletion(r *http.Request, kind, id string) (docs.Deletion, bool) {
	if kind == docs.Catalog || !docs.ValidID(id) {
		return docs.Deletion{}, false
	}
	q := r.URL.Query()
	raw := q.Get("known")
	if raw == "" {
		raw = q.Get("base")
	}
	seen, err := strconv.Atoi(raw)
	if err != nil || seen < 1 {
		return docs.Deletion{}, false
	}
	del, err := a.Docs.LastDeleted(r.Context(), kind, id, seen)
	if err != nil || !who(r).CanDraft(kind, belongsOf(del.Last)) {
		return docs.Deletion{}, false
	}
	return del, true
}

// deletedFor reports whether a document that does not exist was deleted, and the caller could
// edit it before.
func (a *api) deletedFor(r *http.Request, kind, id string) bool {
	_, ok := a.deletion(r, kind, id)
	return ok
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

// syncSkills regenerates what depends on a changed document - its skills and its parts in the
// search index. A failure is logged: the save itself has already happened; the next save or
// restart regenerates the skills again, and the index tries the document again by itself.
func (a *api) syncSkills(ctx context.Context, kind, id string) {
	// The save has happened. Whether the person who made it is still connected, or how long
	// their request has been running, must not decide whether the skills follow: the work runs
	// on its own. The answer waits for the skills a while - normally they are done in a moment -
	// but not for ever: other regenerations may be ahead of it in the queue.
	ctx = context.WithoutCancel(ctx)
	a.syncIndex(ctx, kind, id)
	skillsCtx, cancel := context.WithTimeout(ctx, syncTimeout)
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
			err = a.Skills.SyncAll(skillsCtx, a.Docs) // names of teams and tools appear in the text
		} else {
			err = a.Skills.SyncChanged(skillsCtx, a.Docs, kind, id)
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

// indexTimeout bounds bringing the search index up to date after one change (the catalog goes
// through every document).
const indexTimeout = 10 * time.Minute

// syncIndex brings the search index up to date after a change, in the background: the save does
// not wait for it, since the provider may be slow or unreachable. With the built-in embedder it is
// done in a moment. A failure marks the document; it is tried again by itself.
func (a *api) syncIndex(ctx context.Context, kind, id string) {
	if !a.Index.Enabled() {
		return
	}
	if a.Background != nil {
		a.Background.Add(1)
	}
	go func() {
		if a.Background != nil {
			defer a.Background.Done()
		}
		ctx, cancel := context.WithTimeout(ctx, indexTimeout)
		defer cancel()
		// the catalog goes through every document: names of the lists appear in the parts
		if err := a.Index.Sync(ctx, kind, id); err != nil {
			a.Log.Warn("search by meaning: the search index could not be brought up to date after a change; the earlier text stays searchable and it is tried again in a few minutes",
				"kind", kind, "id", id, "error", err)
		}
	}()
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
	inLists := map[string][]string{} // entries of the lists that name it, in the order of their list
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
	// within the lists: a pillar the teams are part of, a tribe the pillars are part of, a domain
	// the tribes are part of, a team that performs a service (as the new lists have them)
	for _, entry := range removed {
		key, id, _ := strings.Cut(entry, "/")
		inner := map[string]struct {
			noun string
			list []docs.Named
			of   func(docs.Named) string
		}{
			"pillars": {"team", next.Teams, func(n docs.Named) string { return n.Pillar }},
			"tribes":  {"pillar", next.Pillars, func(n docs.Named) string { return n.Tribe }},
			"domains": {"tribe", next.Tribes, func(n docs.Named) string { return n.Domain }},
			// a team that performs a service
			"teams": {"service", next.Services, func(n docs.Named) string { return n.Team }},
		}
		if in, ok := inner[key]; ok {
			for _, n := range in.list {
				if in.of(n) == id {
					inLists[entry] = append(inLists[entry], docs.EntryWords(in.noun, n))
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
	anyUse, anyPeople := false, false
	for _, entry := range removed {
		// the documents first, by title; then what in the lists names it (a team's service)
		users := usedBy[entry]
		sort.Strings(users)
		users = append(users, inLists[entry]...)
		if len(users) > 3 {
			users = append(users[:3], fmt.Sprintf("%d more", len(users)-3))
		}
		if n := hidden[entry]; n == 1 {
			users = append(users, "a draft you cannot see")
		} else if n > 1 {
			users = append(users, fmt.Sprintf("%d drafts you cannot see", n))
		}
		// the people tied to it: its owners (a team's Owners) and members, counted; by address for admins
		key, id, _ := strings.Cut(entry, "/")
		var tied, alone string // "2 people are still its owners or members", "2 people are still owners or members of “x”"
		if people := roles[entry]; len(people) > 0 {
			who := "owners or members"
			if key == "teams" {
				who = "Owners"
			}
			names := ""
			if s.Admin {
				list := make([]string, 0, len(people))
				for email := range people {
					list = append(list, email)
				}
				sort.Strings(list)
				names = " (" + strings.Join(list, ", ") + ")"
			}
			tied = fmt.Sprintf("%d people are still its %s%s", len(people), who, names)
			alone = fmt.Sprintf("%d people are still %s of “%s”%s", len(people), who, id, names)
			if len(people) == 1 {
				tied = fmt.Sprintf("1 person is still one of its %s%s", who, names)
				alone = fmt.Sprintf("1 person is still one of the %s of “%s”%s", who, id, names)
			}
		}
		switch {
		case len(users) > 0 && tied != "":
			problems = append(problems, fmt.Sprintf("“%s” is still used by %s, and %s", id, strings.Join(users, ", "), tied))
		case len(users) > 0:
			problems = append(problems, fmt.Sprintf("“%s” is still used by %s", id, strings.Join(users, ", ")))
		case tied != "":
			problems = append(problems, alone)
		default:
			continue
		}
		anyUse = anyUse || len(users) > 0
		anyPeople = anyPeople || tied != ""
	}
	if len(problems) == 0 {
		return nil
	}
	end := "Change those first."
	switch {
	case anyUse && anyPeople:
		end = "Change those first and take their roles, then it can be removed."
	case anyPeople:
		end = "Take their roles first, then it can be removed."
	}
	return fmt.Errorf("%w: cannot remove what is still in use: %s. %s", docs.ErrInvalid, strings.Join(problems, "; "), end)
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
		// A person's ordinary save of a process or standard that has a working draft is refused:
		// the changes would be lost, or hidden under a version they never saw - unless it is a
		// never-published document saved from its working draft (draft=<its revision>), which the
		// save replaces.
		rule, rev := docs.KeepDraft, 0
		if kind != docs.Catalog {
			rule = docs.RefuseIfDraft
			if raw := r.URL.Query().Get("draft"); raw != "" {
				n, err := strconv.Atoi(raw)
				if err != nil || n < 1 {
					writeError(w, 400, "draft must be the revision of the working draft the save replaces.")
					return
				}
				rule, rev = docs.ReplaceDraft, n
			}
		}
		a.save(w, r, saving{kind: kind, id: id, body: body, base: base, note: r.URL.Query().Get("note"), action: "save", drafts: rule, revision: rev})
	}
}

// saving is one save of a document by a person: an ordinary save, or publishing a working draft.
type saving struct {
	kind, id string
	body     []byte
	base     *int
	note     string
	action   string // in the activity log: noun + "." + action
	drafts   docs.DraftRule
	revision int // of the working draft that is published
}

// save runs every check a save gets - rights, the format, the checker, what is still used - and
// stores a new version through docs.Store.Save; skills and the search index follow. It answers
// the request.
func (a *api) save(w http.ResponseWriter, r *http.Request, sv saving) {
	kind, id, body := sv.kind, sv.id, sv.body
	s := who(r)
	next, newStatus := headOf(body)
	fromDraft := sv.drafts == docs.PublishDraft
	// kept is true when the person's draft stays stored whatever is refused: publishing a working
	// draft, or storing a never-published document from it
	kept := fromDraft || sv.drafts == docs.ReplaceDraft
	// A save that stays a draft needs the right to work on drafts (members of its platform or
	// practice have it); anything readers would see needs the right to edit (checked with the
	// stored document, below). The right is needed for what it belongs to now and for what it
	// is moved to: an owner of one platform can neither take over a document of another nor
	// hand theirs away. What is refused here is decided by the body alone, so it is the same
	// whether the id exists or not.
	staysDraft := kind != docs.Catalog && !fromDraft && newStatus == "draft"
	if !s.CanDraft(kind, next) {
		deniedFor(w, kind, s)
		return
	}
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if err := a.validateFormat(kind, body); err != nil {
		a.fail(w, r, err)
		return
	}
	if kind == docs.Catalog {
		err = json.Unmarshal(body, &lists) // the lists are checked against themselves
	}
	// the lists: what is still in use is said first, by who uses it (a tribe a team is part of
	// would otherwise only be "not in the list of tribes")
	if err == nil && kind == docs.Catalog {
		err = a.stillUsed(r.Context(), s, body)
	}
	if err == nil {
		err = docs.Check(kind, body, lists)
	}
	if err == nil && kind == docs.Catalog {
		err = a.knownIcons(r.Context(), body)
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	note := sv.note
	action := sv.action
	doc, changed, err := a.Docs.Save(r.Context(), docs.Change{
		Kind: kind, ID: id, Body: body, By: s.Email, Note: note, Base: sv.base,
		Drafts: sv.drafts, Revision: sv.revision, Log: a.Log,
		Check: func(current *docs.Doc) error {
			var stored *rbac.Belongs
			// a draft somebody may not see is, for them, something that does not exist: every
			// check below runs as for a new document, and only then is the save refused
			hidden := current != nil && kind != docs.Catalog && !canSee(s, kind, current.Body)
			storedStatus := ""
			if current != nil && !hidden {
				storedStatus = docs.StatusOf(current.Body)
			}
			storedDraft := current == nil || hidden || storedStatus == "draft"
			// a never-published document saved as a draft: the right to work on drafts is enough
			draftOnly := staysDraft && storedDraft
			// readers see it for the first time: its whole placement is checked as for a new
			// document, since a draft may have been placed where somebody is only a member
			first := kind != docs.Catalog && storedDraft && !staysDraft
			refuse := func(b rbac.Belongs) error {
				does, after := publishWords(kind, storedDraft, storedStatus, newStatus, kept)
				return &notPublisher{kind: kind, b: b, lists: lists, does: does, after: after, first: first}
			}
			if current != nil && !hidden {
				b := belongsOf(current.Body)
				switch {
				case draftOnly && !s.CanDraft(kind, b):
					return errDenied
				case !draftOnly && !s.CanEdit(kind, b):
					if kind != docs.Catalog && s.CanDraft(kind, b) {
						if first {
							return refuse(next)
						}
						return refuse(b)
					}
					return errDenied
				}
				stored = &b
			}
			// only a member of where it would be: who can do it is said (also for a draft
			// somebody may not see, which answers as for an id that does not exist)
			if !draftOnly && kind != docs.Catalog && !s.CanEdit(kind, next) {
				return refuse(next)
			}
			// a document shared with another platform or practice stays with it
			switch {
			case draftOnly:
				if field, id := s.MisplacedDraft(kind, stored, next); field != "" {
					return &misplaced{kind: kind, field: field, name: placeName(lists, field, id), draft: true, member: s.MemberOfSome()}
				}
			case first:
				// the first publication (of a stored draft, or of something new): the publisher must
				// own its whole placement
				if field, _ := s.Misplaced(kind, nil, next); field != "" {
					return refuse(next)
				}
			default:
				if field, id := s.Misplaced(kind, stored, next); field != "" {
					return &misplaced{kind: kind, field: field, name: placeName(lists, field, id)}
				}
			}
			if kind != docs.Catalog {
				// a document readers do not see becomes published (active), never retired directly
				// (something new or deleted is saved as for the first time: see the format)
				unseen := current == nil || hidden || docs.StatusOf(current.Body) == "draft"
				if current != nil && !hidden && unseen && docs.StatusOf(body) == "deprecated" {
					return fmt.Errorf("%w: A %s that readers do not see cannot be retired. Publish it first, or delete it.", docs.ErrInvalid, noun[kind])
				}
				// the first publication is logged as one, whichever call made it
				if unseen && !hidden && docs.StatusOf(body) != "draft" {
					action = "publish"
				}
			}
			if hidden {
				return errHiddenDoc
			}
			return nil
		},
		After: func(ctx context.Context, tx pgx.Tx, saved docs.Doc) error {
			detail := fmt.Sprintf("version %d", saved.Version)
			if n := strings.TrimSpace(note); n != "" {
				detail += ": " + n
			}
			if saved.ChangesBy != "" {
				by := saved.ChangesByName
				if by == "" {
					by = a.personName(ctx, saved.ChangesBy)
				}
				if by == "" {
					by = saved.ChangesBy
				}
				detail += "; the changes were last saved by " + by
			}
			return audit.AddIn(ctx, tx, s.Email, s.Name, noun[kind]+"."+action, id, detail)
		},
		// a working draft that went without a new version is not lost without a trace
		DraftDropped: func(ctx context.Context, tx pgx.Tx, d docs.WorkingDraft) error {
			detail := fmt.Sprintf("the changes kept in its draft, last saved by %s, were replaced by the %s as it is stored (version %d): nothing changed", d.UpdatedBy, noun[kind], d.Base)
			if sv.drafts == docs.PublishDraft {
				detail = fmt.Sprintf("the unpublished changes, last saved by %s, were the same as the published version: nothing was published", d.UpdatedBy)
			}
			return audit.AddIn(ctx, tx, s.Email, s.Name, noun[kind]+".discard", id, detail)
		},
	})
	var c *docs.Conflict
	var m *misplaced
	var np *notPublisher
	var pending *docs.DraftPending
	var dc *docs.DraftConflict
	switch {
	case errors.Is(err, errDenied):
		denied(w, kind)
		return
	case errors.As(err, &np):
		writeError(w, 403, np.Error())
		return
	case errors.Is(err, errHiddenDoc):
		// what the same save of an id that does not exist would answer: "deleted meanwhile" for
		// a save made from a version, else the id is taken (that much cannot be hidden)
		if sv.drafts == docs.PublishDraft || sv.drafts == docs.ReplaceDraft || (sv.base != nil && *sv.base > 0) {
			a.conflict(w, r, kind, id, &docs.Conflict{})
		} else {
			writeError(w, 409, fmt.Sprintf("Something else already has this id. Give the %s another name.", noun[kind]))
		}
		return
	case errors.As(err, &m):
		writeError(w, 403, m.Error())
		return
	case errors.As(err, &c):
		a.conflict(w, r, kind, id, c)
		return
	case errors.As(err, &pending):
		draftPending(w, kind, pending)
		return
	case errors.As(err, &dc):
		draftConflict(w, dc)
		return
	case errors.Is(err, docs.ErrPublished):
		writeError(w, 409, fmt.Sprintf("This %s is published: its unpublished changes are published with Publish, not saved over it.", noun[kind]))
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
// date (their own day) and their name. This is the one change the owning team may make themselves -
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
		case status == "draft":
			writeError(w, 400, fmt.Sprintf("Only a published %s is reviewed. Publish it first.", noun[kind]))
			return
		case status != "" && status != "active":
			writeError(w, 400, fmt.Sprintf("A retired %s is not reviewed any more.", noun[kind]))
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
			a.conflict(w, r, kind, id, &docs.Conflict{Current: current, Exists: true})
			return
		}
		// The day is the person's own (?day=, from the app): ahead of UTC it is already tomorrow
		// for them, and that is the day they confirmed on. It is taken while it is today somewhere
		// on Earth. Without it (an older app, a script) or from a computer whose clock is wrong,
		// the server's own day (UTC): the review is recorded either way, on a day that is today.
		day := r.URL.Query().Get("day")
		if !docs.TodaySomewhere(day, time.Now()) {
			day = time.Now().UTC().Format(time.DateOnly)
		}
		body, err := docs.WithReview(current.Body, day, reviewerName(s.Name), reviewRhythm[kind])
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
				// unpublished changes based on the reviewed version stay based on what readers see
				if err := docs.MoveDraftBaseIn(ctx, tx, kind, id, current.Version, saved.Version); err != nil {
					return err
				}
				return audit.AddIn(ctx, tx, s.Email, s.Name, noun[kind]+".review", id, fmt.Sprintf("version %d", saved.Version))
			},
		})
		var c *docs.Conflict
		switch {
		case errors.As(err, &c):
			a.conflict(w, r, kind, id, c)
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
		lists, err := a.Docs.Lists(r.Context()) // for the names in a refusal
		if err != nil {
			a.fail(w, r, err)
			return
		}
		// the document, its feedback, bookmarks and upvotes and the entry in the activity log go
		// together or not at all
		err = a.Docs.Remove(r.Context(), docs.Removal{
			Kind: kind, ID: id, By: s.Email, Base: base,
			Check: func(current *docs.Doc) error {
				b := belongsOf(current.Body)
				switch {
				case s.CanEdit(kind, b):
					return nil
				case !canSee(s, kind, current.Body):
					return docs.ErrNotFound // a draft somebody cannot see does not exist for them
				case s.CanDraft(kind, b):
					return &notPublisher{kind: kind, b: b, lists: lists, does: "delete this " + noun[kind]}
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
		var np *notPublisher
		switch {
		case errors.Is(err, errDenied):
			denied(w, kind)
			return
		case errors.As(err, &np):
			writeError(w, 403, np.Error())
			return
		case errors.As(err, &c):
			a.conflict(w, r, kind, id, c)
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
		if v.Deleted || v.Status != "draft" || s.CanSeeDraft(kind, rbac.Belongs{Owner: v.Owner, Platform: v.Platform, Practice: v.Practice}) {
			shown = append(shown, v)
		}
	}
	if len(shown) == 0 {
		writeError(w, 404, "That does not exist.")
		return
	}
	// who saved each, by name where it is known (an import or the portal itself has none)
	var emails []string
	for _, v := range shown {
		for _, e := range []string{v.SavedBy, v.ChangesBy} {
			if strings.Contains(e, "@") && !slices.Contains(emails, e) {
				emails = append(emails, e)
			}
		}
	}
	names, err := a.names(r.Context(), emails)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	for i := range shown {
		shown[i].SavedByName = names[shown[i].SavedBy]
		if shown[i].ChangesBy != "" && shown[i].ChangesByName == "" {
			shown[i].ChangesByName = names[shown[i].ChangesBy]
		}
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
