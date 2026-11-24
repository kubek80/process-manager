package httpapi

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

// Viewing the portal as somebody else (Admin › Access › View as).
//
// An admin chooses a person and, in that one session, sees the portal exactly as that person
// does. How it is enforced:
//   - signedIn, the one place where the person of a request is decided, answers with the person
//     (their identity and their rights) and keeps the admin in session.viewer (viewedAs);
//   - guard refuses every request but GET and HEAD while viewing, on every route, apart from
//     stopping (DELETE /api/admin/view-as) and signing out (refuseWhileViewing);
//   - the GET routes that write something for the person (a skill download is counted, the
//     brakes on searching and on reading the code count per person) leave it out or count it
//     for the admin (countsFor, mayCount).
//
// It ends when the admin stops or signs out, when their session ends, after auth.ViewAsFor,
// and when a request finds that the admin is no longer an admin. Starting and every end are
// written to Activity in the admin's name.

// NoRolesReader is the address of "a reader with no roles": the view of somebody who has no
// role at all, also where nobody like that has signed in yet. Under .invalid, a name that can
// never be anybody's address; it has no rights whatever roles are stored for it.
const (
	NoRolesReader     = "reader@no-roles.invalid"
	NoRolesReaderName = "A reader with no roles"
)

// viewingAdmin is the admin who views the portal as somebody else.
type viewingAdmin struct {
	auth.User
	rbac.Perms
	viewing auth.Viewing
}

func (v *viewingAdmin) info() map[string]any {
	return map[string]any{"email": v.Email, "name": v.Name, "until": v.viewing.Until.UTC().Format(time.RFC3339)}
}

// self is the person who signed in: the admin while viewing as somebody else.
func (s session) self() session {
	if s.viewer == nil {
		return s
	}
	return session{User: s.viewer.User, Perms: s.viewer.Perms, id: s.id}
}

// countsFor is whose count a brake on a script charges: the person who signed in.
func (s session) countsFor() string { return s.self().Email }

// mayCount reports whether something done in this request may be counted for the person:
// never while somebody else views the portal as them.
func (s session) mayCount() bool { return s.viewer == nil }

// personLabel is a person as the app shows them: by name where known, else by address.
func personLabel(email, name string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}
	return email
}

// viewingRefusal is the one sentence that answers a change while viewing as somebody else.
func viewingRefusal(s session) string {
	return "You are viewing the portal as " + personLabel(s.Email, s.Name) + ", so nothing can be changed. Stop viewing first."
}

// mayChangeWhileViewing: the only changes that work while viewing as somebody: stopping, and
// signing out (which stops too). By exact path, so that anything else is refused.
func mayChangeWhileViewing(method, path string) bool {
	return (path == "/api/admin/view-as" && method == http.MethodDelete) || (path == "/auth/logout" && method == http.MethodPost)
}

// refuseWhileViewing answers 403 to a change made while viewing as somebody else. Otherwise it
// passes the request on with its person resolved, so that the route works with the same one.
func (a *api) refuseWhileViewing(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	if mayChangeWhileViewing(r.Method, r.URL.Path) {
		return r, false // allowed either way; the route finds out who it is for itself
	}
	s, err := a.signedIn(r)
	if errors.Is(err, errUnavailable) {
		// whether the session views as somebody is not known: nothing is let through on a guess
		writeError(w, 503, "The server cannot reach its database right now. Try again in a moment.")
		return r, true
	}
	if err != nil {
		return r, false // not signed in (sign-in itself, or the route answers 401 as always)
	}
	if s.viewer != nil {
		// also starting again (as somebody else, or the same person): stop first
		if r.URL.Path == "/api/admin/view-as" && r.Method == http.MethodPost {
			writeError(w, 409, "You are already viewing the portal as "+personLabel(s.Email, s.Name)+". Stop viewing first, then choose another person.")
			return r, true
		}
		writeError(w, 403, viewingRefusal(s))
		return r, true
	}
	return r.WithContext(context.WithValue(r.Context(), ctxKey{}, s)), false
}

// viewedAs turns the session of an admin who views the portal as somebody else into that
// person's, or ends the viewing when it no longer counts. permsFailed: the admin's own roles
// could not be read.
func (a *api) viewedAs(ctx context.Context, s session, permsFailed bool) (session, error) {
	if a.viewAs == nil {
		return s, nil
	}
	v, on, err := a.viewAs.Of(ctx, s.Email, s.id)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			a.Log.Error("viewing as somebody else could not be read", "error", err)
		}
		return session{}, errUnavailable // never the admin's own rights instead
	}
	if !on {
		return s, nil
	}
	if permsFailed {
		return session{}, errUnavailable
	}
	// A person who loses their roles is simply a reader from then on: the view follows, as it
	// would for them.
	why := ""
	switch {
	case !s.Admin:
		why = "They are no longer an admin."
	case !a.Sessions.Now().Before(v.Until):
		why = "An hour had passed."
	case strings.EqualFold(v.Target, s.Email):
		why = "It was their own view."
	}
	if why != "" {
		a.endViewing(ctx, s, why)
		return s, nil
	}
	perms := rbac.PermsFrom(nil, false) // the reader with no roles has none, whatever is stored
	if v.Target != NoRolesReader {
		if perms, err = a.Roles.Perms(ctx, v.Target); err != nil {
			a.Log.Error("roles could not be read", "error", err)
			return session{}, errUnavailable
		}
	}
	name := v.TargetName
	if name == "" {
		name = v.Target
	}
	return session{User: auth.User{Email: v.Target, Name: name}, Perms: perms, id: s.id,
		viewer: &viewingAdmin{User: s.User, Perms: s.Perms, viewing: v}}, nil
}

// endViewing stops viewing in the session of s (the admin) and writes why to Activity, once.
func (a *api) endViewing(ctx context.Context, s session, why string) {
	ctx = context.WithoutCancel(ctx)
	v, ended, err := a.viewAs.Stop(ctx, s.Email, s.id)
	if err != nil {
		a.Log.Error("viewing as somebody else could not be ended", "error", err)
		return
	}
	if ended {
		a.recordViewing(ctx, s, "viewas.end", v.Target, why)
	}
}

// endAllViewing stops viewing in every session of the admin: they sign out.
func (a *api) endAllViewing(ctx context.Context, s session) {
	if a.viewAs == nil {
		return
	}
	ctx = context.WithoutCancel(ctx)
	list, err := a.viewAs.StopAll(ctx, s.Email)
	if err != nil {
		a.Log.Error("viewing as somebody else could not be ended", "error", err)
		return
	}
	for _, v := range list {
		a.recordViewing(ctx, s, "viewas.end", v.Target, "They signed out.")
	}
}

func (a *api) recordViewing(ctx context.Context, admin session, action, target, detail string) {
	if err := a.Audit.Add(ctx, admin.Email, admin.Name, action, target, detail); err != nil {
		a.Log.Error("audit entry not written", "action", action, "target", target, "error", err)
	}
}

// startViewAs answers POST /api/admin/view-as {"email"}: admins only, by their own roles (who
// is not yet anybody else here: guard refuses this while viewing). Anybody but oneself, by
// address (NoRolesReader: a reader with no roles).
func (a *api) startViewAs(w http.ResponseWriter, r *http.Request) {
	s := who(r)
	if s.viewer != nil { // guard answers this first; kept so that the rule does not hang on it alone
		writeError(w, 409, "You are already viewing the portal as "+personLabel(s.Email, s.Name)+". Stop viewing first, then choose another person.")
		return
	}
	if !s.Admin {
		writeError(w, 403, "Only admins can do that.")
		return
	}
	if a.viewAs == nil {
		writeError(w, 404, "Viewing the portal as somebody else is not available here.")
		return
	}
	var in struct {
		Email string `json:"email"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if email == "" {
		writeError(w, 400, "Say whose view of the portal you want to see: send their email address.")
		return
	}
	if email == strings.ToLower(strings.TrimSpace(s.Email)) {
		writeError(w, 400, "You cannot view the portal as yourself: this is already your view.")
		return
	}
	// anybody by address: a person with roles, somebody the portal has seen, or an address it
	// has never seen, who is then exactly a signed-in person without roles. Nothing is stored
	// in their name: nothing can be changed while viewing.
	if !rbac.ValidEmail(email) || !docs.Storable(email) {
		writeError(w, 400, "That is not an email address. Write one, such as name@company.com.")
		return
	}
	name := NoRolesReaderName
	if email != NoRolesReader {
		names, err := a.names(r.Context(), []string{email})
		if err != nil {
			a.fail(w, r, err)
			return
		}
		name = names[email]
	}
	v, err := a.viewAs.Start(r.Context(), s.Email, s.id, email, name, a.Sessions.Now())
	if errors.Is(err, auth.ErrAlreadyViewing) {
		writeError(w, 409, "You are already viewing the portal as somebody. Stop viewing first, then choose another person.")
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	a.recordViewing(r.Context(), s, "viewas.start", email, "")
	writeJSON(w, 200, map[string]any{"email": v.Target, "name": v.TargetName, "until": v.Until.UTC().Format(time.RFC3339)})
}

// stopViewAs answers DELETE /api/admin/view-as: the session sees the portal as the admin again.
// Nothing to stop is fine too.
func (a *api) stopViewAs(w http.ResponseWriter, r *http.Request) {
	me := who(r).self()
	if a.viewAs != nil {
		v, stopped, err := a.viewAs.Stop(context.WithoutCancel(r.Context()), me.Email, me.id)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if stopped {
			a.recordViewing(r.Context(), me, "viewas.stop", v.Target, "")
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// maxPeople bounds the addresses GET /api/admin/people sends.
const maxPeople = 2000

// peopleQuery: every address the portal has seen: with a role, in the activity log, as the
// author of feedback or of a request, a vote, a view, a bookmark, an upvote, a skill download,
// a sign-out. Only the addresses: never what they did.
const peopleQuery = `select email, bool_or(has_role) from (
	select email, true as has_role from role_assignments
	union all select actor_email, false from audit_log
	union all select author_email, false from feedback
	union all select email, false from feedback_also_hit
	union all select requested_by_email, false from requests
	union all select email, false from request_votes
	union all select email, false from document_views
	union all select email, false from bookmarks
	union all select email, false from upvotes
	union all select email, false from skill_downloads
	union all select email, false from signed_out
) p where email like '%@%' group by email order by email limit $1`

// listPeople answers GET /api/admin/people (admins only): the people an admin can choose to view
// the portal as, besides any address typed in. {"people": [{"email", "name", "roles"}]}.
func (a *api) listPeople(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := a.Roles.Pool.Query(ctx, peopleQuery, maxPeople)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	type person struct {
		Email string `json:"email"`
		Name  string `json:"name"`
		Roles bool   `json:"roles"`
	}
	out := []person{}
	seen := map[string]bool{}
	for rows.Next() {
		var p person
		if err := rows.Scan(&p.Email, &p.Roles); err != nil {
			rows.Close()
			a.fail(w, r, err)
			return
		}
		p.Email = strings.ToLower(strings.TrimSpace(p.Email))
		if !seen[p.Email] && rbac.ValidEmail(p.Email) {
			seen[p.Email] = true
			out = append(out, p)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		a.fail(w, r, err)
		return
	}
	// admins named in the server settings, and the built-in users of a development server
	add := func(email string, roles bool) {
		if email = strings.ToLower(strings.TrimSpace(email)); email != "" && !seen[email] && len(out) < maxPeople {
			seen[email] = true
			out = append(out, person{Email: email, Roles: roles})
		}
	}
	for _, b := range a.Roles.Bootstrap {
		add(b, true)
	}
	if a.Cfg.Auth == config.AuthDev {
		for _, u := range auth.DevUsers {
			add(u.Email, false)
		}
	}
	emails := make([]string, len(out))
	for i, p := range out {
		emails[i] = p.Email
	}
	names, err := a.names(ctx, emails)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	for i := range out {
		out[i].Name = names[out[i].Email]
		if a.Roles.IsBootstrap(out[i].Email) {
			out[i].Roles = true
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Email < out[j].Email })
	writeJSON(w, 200, map[string]any{"people": out})
}
