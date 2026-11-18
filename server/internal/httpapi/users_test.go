package httpapi

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/rbac"
)

type userAnswer struct {
	Email     string `json:"email"`
	Name      string `json:"name"`
	Bootstrap bool   `json:"bootstrap"`
	Roles     []struct {
		Role, Scope, GrantedBy, GrantedAt string
	} `json:"roles"`
}

func rolesOf(u map[string]any) string {
	var out []string
	for _, r := range u["roles"].([]any) {
		m := r.(map[string]any)
		s := m["role"].(string)
		if m["scope"] != "" {
			s += ":" + m["scope"].(string)
		}
		if m["grantedBy"] == "" || m["grantedAt"] == "" {
			s += "(?)"
		}
		out = append(out, s)
	}
	return strings.Join(out, ",")
}

func usersOf(t *testing.T, c *client) map[string]map[string]any {
	t.Helper()
	status, body := c.do("GET", "/api/admin/users", nil)
	wantStatus(t, status, 200, body)
	out := map[string]map[string]any{}
	for _, u := range body["users"].([]any) {
		m := u.(map[string]any)
		out[m["email"].(string)] = m
	}
	return out
}

func roles(list ...string) map[string]any {
	out := []map[string]string{}
	for _, r := range list {
		role, scope, _ := strings.Cut(r, ":")
		out = append(out, map[string]string{"role": role, "scope": scope})
	}
	return map[string]any{"roles": out}
}

func TestOnlyAdminsManageUsers(t *testing.T) {
	e := setup(t, nil)
	for _, who := range []string{sam, alex, jordan} { // a reader, a lists manager, an owner
		c := e.as(who)
		for _, req := range []struct {
			method string
			body   any
		}{{"GET", nil}, {"PUT", roles("process-editor")}, {"DELETE", nil}} {
			path := "/api/admin/users"
			if req.method != "GET" {
				path += "/" + sam
			}
			status, out := c.do(req.method, path, req.body)
			wantError(t, status, out, 403, "Only admins can do that.")
		}
	}
	status, _ := e.anonymous().do("GET", "/api/admin/users", nil)
	wantStatus(t, status, 401, nil)
}

func TestAdminsListAndReplaceTheRolesOfAPerson(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	users := usersOf(t, d)
	// everyone with a role, and the admin of the server settings; names from development sign-in
	if users[dana]["bootstrap"] != true || users[dana]["name"] != "Dana Admin" || users[sam] != nil {
		t.Fatalf("users: %v", users)
	}
	if got := rolesOf(users[alex]); got != "catalog-manager,process-editor" {
		t.Fatalf("alex: %s", got)
	}
	if got := rolesOf(users[jordan]); got != "owner:cloud-platform-team,platform-owner:google-cloud,practice-owner:engineering" {
		t.Fatalf("jordan: %s", got)
	}

	// the complete set, at once; the email is taken as it is stored
	status, out := d.do("PUT", "/api/admin/users/"+url.PathEscape(" Alex@Example.com"), roles("platform-owner:google-cloud", "catalog-manager"))
	wantStatus(t, status, 200, out)
	if out["email"] != alex || out["name"] != "Alex Editor" || out["bootstrap"] != false || rolesOf(out) != "catalog-manager,platform-owner:google-cloud" {
		t.Fatalf("answer: %v", out)
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if en := entries[0]; en.Action != "access.change" || en.Target != alex || en.Email != dana ||
		en.Detail != "Alex Editor: added Platform owner for the platform Google Cloud; removed Process editor" {
		t.Fatalf("audit: %+v", en)
	}
	// the new rights apply at once
	_, me := e.as(alex).do("GET", "/api/me", nil)
	if p := me["perms"].(map[string]any); p["processes"] != false || fmt.Sprint(p["platforms"]) != "[google-cloud]" || p["catalog"] != true {
		t.Fatalf("perms: %v", p)
	}
	// the same set again: no change, no entry
	status, out = d.do("PUT", "/api/admin/users/"+alex, roles("catalog-manager", "platform-owner:google-cloud"))
	wantStatus(t, status, 200, out)
	if again, _ := e.deps.Audit.Recent(bg, 1); again[0].ID != entries[0].ID {
		t.Fatalf("recorded a change that was none: %+v", again[0])
	}

	// a new person, several of a kind
	status, out = d.do("PUT", "/api/admin/users/pat@example.com", roles("owner:security", "owner:cloud-platform-team", "standards-editor"))
	wantStatus(t, status, 200, out)
	if rolesOf(out) != "standards-editor,owner:cloud-platform-team,owner:security" || out["name"] != "" {
		t.Fatalf("pat: %v", out)
	}
	entries, _ = e.deps.Audit.Recent(bg, 1)
	if entries[0].Detail != "pat@example.com: added Standards editor, Owner for the team Cloud Platform team and Owner for the team Cyber Security" {
		t.Fatalf("audit: %q", entries[0].Detail)
	}

	// refused: as when a role is given on its own; nothing changes
	for _, c := range []struct {
		body any
		want string
	}{
		{roles("owner"), "An owner needs the team it is for."},
		{roles("platform-owner"), "A platform owner needs the platform it is for."},
		{roles("admin:security"), "An admin always covers everything: it cannot be limited to a team, platform or practice."},
		{roles("process-editor", "practice-owner:nowhere"), "There is no practice “nowhere” in the lists."},
		{roles("platform-owner:security"), "There is no platform “security” in the lists."},
		{roles("superuser"), `There is no role "superuser".`},
		{map[string]any{}, "Send all the roles the person should have; an empty list removes them all."},
		{map[string]any{"roles": nil}, "Send all the roles the person should have; an empty list removes them all."},
		{"not json", "the request is not valid JSON"},
	} {
		status, out := d.do("PUT", "/api/admin/users/pat@example.com", c.body)
		wantError(t, status, out, 400, c.want)
	}
	status, out = d.do("PUT", "/api/admin/users/not-an-email", roles())
	wantError(t, status, out, 400, "That is not an email address.")
	if got := rolesOf(usersOf(t, d)["pat@example.com"]); got != "standards-editor,owner:cloud-platform-team,owner:security" {
		t.Fatalf("changed by a refused request: %s", got)
	}

	// delete: every role goes, the person can still read
	status, raw, _ := d.raw("DELETE", "/api/admin/users/pat@example.com", nil, true)
	if status != 204 || len(raw) != 0 {
		t.Fatalf("delete: %d %s", status, raw)
	}
	if usersOf(t, d)["pat@example.com"] != nil {
		t.Fatal("still listed")
	}
	entries, _ = e.deps.Audit.Recent(bg, 1)
	if en := entries[0]; en.Action != "access.remove" || en.Target != "pat@example.com" || !strings.HasPrefix(en.Detail, "pat@example.com: removed Standards editor, ") {
		t.Fatalf("audit: %+v", en)
	}
	// deleting somebody without roles changes nothing and records nothing
	status, _, _ = d.raw("DELETE", "/api/admin/users/pat@example.com", nil, true)
	if after, _ := e.deps.Audit.Recent(bg, 1); status != 204 || after[0].ID != entries[0].ID {
		t.Fatalf("delete again: %d", status)
	}

	// the admin of the server settings stays an admin whatever is stored
	status, out = d.do("PUT", "/api/admin/users/"+dana, roles("process-editor"))
	wantStatus(t, status, 200, out)
	if out["bootstrap"] != true {
		t.Fatalf("dana: %v", out)
	}
	// nobody removes all of their own roles: the app does not offer it, the server refuses it
	status, out = d.do("DELETE", "/api/admin/users/"+url.PathEscape("DANA@example.com "), nil)
	wantError(t, status, out, 409, "You cannot remove all of your own roles. Ask another admin to do it.")
	if got := rolesOf(usersOf(t, d)[dana]); got != "process-editor" {
		t.Fatalf("dana: %s", got)
	}
	_, me = d.do("GET", "/api/me", nil)
	if me["perms"].(map[string]any)["admin"] != true {
		t.Fatal("the admin of the server settings lost the role")
	}

	// the existing calls keep working beside these
	status, out = d.do("POST", "/api/admin/access", map[string]string{"email": "pat@example.com", "role": "owner", "scope": "security"})
	wantStatus(t, status, 200, out)
	if got := rolesOf(usersOf(t, d)["pat@example.com"]); got != "owner:security" {
		t.Fatalf("after grant: %s", got)
	}
}

func TestTheLastAdminIsKeptByUsers(t *testing.T) {
	// no admin in the server settings: the stored admins are all there is
	e := setup(t, func(d *Deps) { d.Roles.Bootstrap = nil })
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: dana, Role: rbac.Admin, GrantedBy: "setup"}))
	d := e.as(dana)
	status, out := d.do("PUT", "/api/admin/users/"+dana, roles("process-editor"))
	wantError(t, status, out, 409, "This is the last admin. Make someone else an admin first.")
	status, out = d.do("DELETE", "/api/admin/users/"+dana, nil)
	wantError(t, status, out, 409, "You cannot remove all of your own roles. Ask another admin to do it.")
	if users := usersOf(t, d); rolesOf(users[dana]) != "admin" || users[dana]["bootstrap"] != false {
		t.Fatalf("dana: %v", users[dana])
	}
	// with another admin, an admin may also take the role from themself
	status, out = d.do("PUT", "/api/admin/users/"+riley, roles("admin", "practice-owner:security"))
	wantStatus(t, status, 200, out)
	status, out = d.do("PUT", "/api/admin/users/"+dana, roles("process-editor"))
	wantStatus(t, status, 200, out)
	status, out = e.as(riley).do("PUT", "/api/admin/users/"+dana, roles("admin"))
	wantStatus(t, status, 200, out)
	status, _, _ = e.as(riley).raw("DELETE", "/api/admin/users/"+dana, nil, true)
	wantStatus(t, status, 204, nil)
	status, out = d.do("GET", "/api/admin/users", nil)
	wantError(t, status, out, 403, "Only admins can do that.")
	// and riley, now the only admin, is protected in turn
	status, out = e.as(riley).do("PUT", "/api/admin/users/"+riley, roles("practice-owner:security"))
	wantError(t, status, out, 409, "This is the last admin. Make someone else an admin first.")
}

func TestConcurrentChangesOfOnePersonsRoles(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	sets := []map[string]any{
		roles("process-editor", "owner:security"),
		roles("standards-editor"),
		roles("catalog-manager", "platform-owner:azure", "practice-owner:security"),
		roles(),
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := e.as(dana) // a client of its own: cookie jars are not shared
			if status, out := req.do("PUT", "/api/admin/users/pat@example.com", sets[i%len(sets)]); status != 200 {
				t.Errorf("%d %v", status, out)
			}
		}()
	}
	wg.Wait()
	got := ""
	if u := usersOf(t, d)["pat@example.com"]; u != nil {
		got = rolesOf(u)
	}
	for _, want := range []string{"process-editor,owner:security", "standards-editor", "catalog-manager,platform-owner:azure,practice-owner:security", ""} {
		if got == want {
			return
		}
	}
	t.Fatalf("a mix of two changes: %s", got)
}

func TestNamesComeFromWhatPeopleDid(t *testing.T) {
	e := setup(t, nil)
	for _, email := range []string{"pat@example.com", "kim@example.com", "lee@example.com", "max@example.com"} {
		must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: email, Role: rbac.ProcessEditor, GrantedBy: "setup"}))
	}
	must(t, e.deps.Audit.Add(bg, "pat@example.com", "Pat Older", "process.save", "x", ""))
	must(t, e.deps.Audit.Add(bg, "pat@example.com", "Pat Newer", "process.save", "x", ""))
	must(t, e.deps.Audit.Add(bg, "max@example.com", "max@example.com", "process.save", "x", "")) // no name: the email stood in
	_, err := e.deps.Docs.Pool.Exec(bg, `insert into feedback (target_kind, target_id, kind, body, author_email, author_name) values ('process', 'x', 'idea', 'x', 'kim@example.com', 'Kim Reader')`)
	must(t, err)
	users := usersOf(t, e.as(dana))
	for email, want := range map[string]string{"pat@example.com": "Pat Newer", "kim@example.com": "Kim Reader", "lee@example.com": "", "max@example.com": "", alex: "Alex Editor"} {
		if got := users[email]["name"]; got != want {
			t.Errorf("%s: %q, want %q", email, got, want)
		}
	}
}
