package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

// maxRoles is the most roles one person can be given in one go.
const maxRoles = 200

// names finds the names of people. The server keeps no list of people: a name is the one a
// person had when they last changed something (the activity log), wrote feedback or asked for
// a process or standard; with development sign-in, the built-in users' names. Unknown: "".
func (a *api) names(ctx context.Context, emails []string) (map[string]string, error) {
	out := map[string]string{}
	if len(emails) == 0 {
		return out, nil
	}
	pool := a.Roles.Pool
	queries := []string{
		// the newest name in the activity log: one index lookup per person
		`select e, l.actor_name from unnest($1::text[]) e
		   cross join lateral (select actor_name from audit_log where actor_email = e and actor_name <> '' and actor_name <> e order by id desc limit 1) l`,
		`select distinct on (author_email) author_email, author_name from feedback
		   where author_email = any($1) and author_name <> '' and author_name <> author_email order by author_email, created_at desc`,
		`select distinct on (requested_by_email) requested_by_email, requested_by_name from requests
		   where requested_by_email = any($1) and requested_by_name <> '' and requested_by_name <> requested_by_email order by requested_by_email, created_at desc`,
	}
	for _, q := range queries {
		rows, err := pool.Query(ctx, q, emails)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var email, name string
			if err := rows.Scan(&email, &name); err != nil {
				rows.Close()
				return nil, err
			}
			if out[email] == "" {
				out[email] = name
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	if a.Cfg.Auth == config.AuthDev {
		for _, u := range auth.DevUsers {
			if out[u.Email] == "" {
				out[u.Email] = u.Name
			}
		}
	}
	return out, nil
}

func (a *api) withNames(ctx context.Context, users []rbac.User) error {
	emails := make([]string, 0, len(users))
	for _, u := range users {
		emails = append(emails, u.Email)
	}
	names, err := a.names(ctx, emails)
	if err != nil {
		return err
	}
	for i := range users {
		users[i].Name = names[users[i].Email]
	}
	return nil
}

// listUsers is every person who has a role, with all their roles: Admin > Access.
func (a *api) listUsers(w http.ResponseWriter, r *http.Request) {
	users, err := a.Roles.Users(r.Context())
	if err == nil {
		err = a.withNames(r.Context(), users)
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"users": users})
}

// storedEmail reads an address to take roles from: as it is stored, also one an earlier version
// let in that would not be accepted today, so that it can always be removed.
func storedEmail(raw string) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(raw))
	return email, email != "" && docs.Storable(email)
}

// userEmail reads the email in the address, as it is stored.
func userEmail(w http.ResponseWriter, r *http.Request) (string, bool) {
	email := strings.ToLower(strings.TrimSpace(r.PathValue("email")))
	if !docs.Storable(email) || !rbac.ValidEmail(email) {
		writeError(w, 400, "That is not an email address.")
		return "", false
	}
	return email, true
}

// putUser gives a person exactly the roles sent: the complete set, in one go.
func (a *api) putUser(w http.ResponseWriter, r *http.Request) {
	email, ok := userEmail(w, r)
	if !ok {
		return
	}
	var in struct {
		Roles *[]rbac.Role `json:"roles"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	if in.Roles == nil {
		writeError(w, 400, "Send all the roles the person should have; an empty list removes them all.")
		return
	}
	roles := *in.Roles
	if refuseOwnLastRoles(w, r, email, roles) {
		return
	}
	if len(roles) > maxRoles {
		writeError(w, 400, "That is more roles than one person can be given.")
		return
	}
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	// each role as when it is given on its own: its form first, then whether its team,
	// platform or practice exists
	for _, role := range roles {
		if err := rbac.Check(rbac.Assignment{Email: email, Role: role.Role, Scope: role.Scope}); err != nil {
			a.fail(w, r, err)
			return
		}
		if key := rbac.ScopeList(role.Role); key != "" {
			if _, ok := find(lists.ByKey(key), role.Scope); !ok {
				writeError(w, 400, "There is no "+rbac.ScopeNoun(role.Role)+" “"+role.Scope+"” in the lists.")
				return
			}
		}
	}
	a.replaceRoles(w, r, email, roles, lists, "access.change")
}

// refuseOwnLastRoles answers 409 when roles (the complete new set) would leave the caller with
// none of their own: like the app, which offers it for everybody else, nobody removes all of
// their own roles, by DELETE or by an empty set in PUT. Taking away some of them is left to the
// other checks (the last admin is kept by the rbac store).
func refuseOwnLastRoles(w http.ResponseWriter, r *http.Request, email string, roles []rbac.Role) bool {
	if len(roles) > 0 || email != strings.ToLower(strings.TrimSpace(who(r).Email)) {
		return false
	}
	writeError(w, 409, "You cannot remove all of your own roles. Ask another admin to do it.")
	return true
}

// deleteUser takes every role from a person. They can still sign in and read like everyone.
func (a *api) deleteUser(w http.ResponseWriter, r *http.Request) {
	email, ok := storedEmail(r.PathValue("email"))
	if !ok {
		writeError(w, 400, "That is not an email address.")
		return
	}
	if refuseOwnLastRoles(w, r, email, nil) {
		return
	}
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.Log.Error("lists not read for the activity log", "error", err) // the names fall back to ids
	}
	a.replaceRoles(w, r, email, []rbac.Role{}, lists, "access.remove")
}

func (a *api) replaceRoles(w http.ResponseWriter, r *http.Request, email string, roles []rbac.Role, lists docs.Lists, action string) {
	ctx := r.Context()
	ch, err := a.Roles.Replace(ctx, email, roles, who(r).Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	user, err := a.Roles.UserOf(ctx, email)
	var names map[string]string
	if err == nil {
		names, err = a.names(ctx, []string{email})
	}
	if err != nil {
		a.fail(w, r, err) // the change has been made; reading it back failed
		return
	}
	user.Name = names[email]
	if len(ch.Added)+len(ch.Removed) > 0 {
		a.record(r, action, email, changeDetail(user, ch, lists))
	}
	if action == "access.remove" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, 200, user)
}

// changeDetail says in the words of the Admin panel what a change of roles did:
// "Alex Editor: added Platform owner for the platform Google Cloud; removed Process editor".
func changeDetail(u rbac.User, ch rbac.Change, lists docs.Lists) string {
	words := func(list []rbac.Assignment) string {
		parts := make([]string, 0, len(list))
		for _, as := range list {
			parts = append(parts, describe(accessInput{Role: as.Role, Scope: as.Scope}, lists))
		}
		return joinAnd(parts)
	}
	who := u.Name
	if who == "" {
		who = u.Email
	}
	var parts []string
	if len(ch.Added) > 0 {
		parts = append(parts, "added "+words(ch.Added))
	}
	if len(ch.Removed) > 0 {
		parts = append(parts, "removed "+words(ch.Removed))
	}
	return who + ": " + strings.Join(parts, "; ")
}
