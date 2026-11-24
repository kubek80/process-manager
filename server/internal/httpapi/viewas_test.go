package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

// viewAs starts viewing the portal as email in the client's session.
func (c *client) viewAs(email string) map[string]any {
	c.e.t.Helper()
	status, body := c.do("POST", "/api/admin/view-as", map[string]string{"email": email})
	wantStatus(c.e.t, status, 200, body)
	return body
}

// meOf is GET /api/me of the client.
func (c *client) meOf() map[string]any {
	c.e.t.Helper()
	status, body := c.do("GET", "/api/me", nil)
	wantStatus(c.e.t, status, 200, body)
	return body
}

func emailOf(me map[string]any) string {
	u, _ := me["user"].(map[string]any)
	s, _ := u["email"].(string)
	return s
}

// fingerprint is everything stored, table by table, apart from what viewing itself keeps: the
// viewing state and its own entries in the activity log.
func (e *env) fingerprint() map[string]string {
	e.t.Helper()
	pool := e.deps.Roles.Pool
	rows, err := pool.Query(bg, `select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' order by 1`)
	must(e.t, err)
	var tables []string
	for rows.Next() {
		var n string
		must(e.t, rows.Scan(&n))
		tables = append(tables, n)
	}
	rows.Close()
	out := map[string]string{}
	for _, tb := range tables {
		where := ""
		switch tb {
		case "viewing_as":
			continue
		case "audit_log":
			where = ` where t.action not like 'viewas.%'`
		}
		var sum *string
		must(e.t, pool.QueryRow(bg, fmt.Sprintf(`select md5(string_agg(t::text, '|' order by t::text)) || count(*)::text from %q t%s`, tb, where)).Scan(&sum))
		if sum != nil {
			out[tb] = *sum
		}
	}
	return out
}

func (e *env) audits(action string) []map[string]string {
	e.t.Helper()
	rows, err := e.deps.Roles.Pool.Query(bg, `select actor_email, target, detail from audit_log where action = $1 order by id`, action)
	must(e.t, err)
	defer rows.Close()
	var out []map[string]string
	for rows.Next() {
		var by, target, detail string
		must(e.t, rows.Scan(&by, &target, &detail))
		out = append(out, map[string]string{"by": by, "target": target, "detail": detail})
	}
	return out
}

// changeRoutes reads every route of api.go that takes another method than GET, with sample
// values in its path: a route added later is covered without being listed here.
func changeRoutes(t *testing.T) [][2]string {
	t.Helper()
	src, err := os.ReadFile("api.go")
	must(t, err)
	re := regexp.MustCompile(`mux\.Handle(?:Func)?\("([A-Z]+) ([^"]+)"(?:\+path\+"([^"]*)")?`)
	fill := strings.NewReplacer("{id}", gcp, "{kind}", "process", "{email}", sam, "{version}", "1")
	var out [][2]string
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		method, path := m[1], m[2]
		if method == "GET" || method == "HEAD" {
			continue
		}
		paths := []string{path}
		if m[3] != "" || strings.HasSuffix(path, "/api/") {
			paths = []string{path + "processes" + m[3], path + "standards" + m[3]}
		}
		for _, p := range paths {
			out = append(out, [2]string{method, fill.Replace(p)})
		}
	}
	if len(out) < 40 {
		t.Fatalf("only %d routes that change something found in api.go: %v", len(out), out)
	}
	return out
}

func TestViewingAsSomebodyChangesNothingOnAnyRoute(t *testing.T) {
	e := setup(t, nil)
	// the strongest view there is: another admin's
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: alex, Role: rbac.Admin, GrantedBy: "setup"}))
	d := e.as(dana)
	d.viewAs(alex)
	before := e.fingerprint()
	refusal := "You are viewing the portal as Alex Editor, so nothing can be changed. Stop viewing first."
	bodies := []any{nil, map[string]any{"email": sam, "roles": []any{}, "role": "admin", "text": "x", "kind": "problem", "targetKind": "process", "targetId": gcp}}
	for _, rt := range changeRoutes(t) {
		method, path := rt[0], rt[1]
		if (method == "DELETE" && path == "/api/admin/view-as") || (method == "POST" && path == "/auth/logout") {
			continue // the two that end viewing: below
		}
		for _, b := range bodies {
			status, body := d.do(method, path, b)
			if method == "POST" && path == "/api/admin/view-as" {
				wantError(t, status, body, 409, "You are already viewing the portal as Alex Editor. Stop viewing first, then choose another person.")
				continue
			}
			if status != 403 || body["error"] != refusal {
				t.Fatalf("%s %s while viewing: %d %v", method, path, status, body)
			}
		}
		// also with a query, which some saves carry
		if status, body := d.do(method, path+"?base=1&rev=0", nil); status != 403 && !(method == "POST" && path == "/api/admin/view-as") {
			t.Fatalf("%s %s?…: %d %v", method, path, status, body)
		}
	}
	// any other method on any path, and a path that is not quite one of the allowed two
	for _, rt := range [][2]string{{"PATCH", "/api/processes/" + gcp}, {"OPTIONS", "/api/catalog"}, {"POST", "/api/admin/view-as/"}, {"DELETE", "/api/admin//view-as"}, {"PUT", "/auth/logout"}, {"POST", "/"},
		{"DELETE", "/api/admin/view-as/"}, {"DELETE", "/api/admin/view-asx"}, {"DELETE", "/api/admin/view-as/x"}, {"POST", "/auth/logoutx"}, {"POST", "/auth/logout/"}} {
		if status, body := d.do(rt[0], rt[1], nil); status != 403 || body["error"] != refusal {
			t.Fatalf("%s %s while viewing: %d %v", rt[0], rt[1], status, body)
		}
	}
	if after := e.fingerprint(); fmt.Sprint(after) != fmt.Sprint(before) {
		for k := range after {
			if after[k] != before[k] {
				t.Errorf("table %s changed while viewing", k)
			}
		}
		t.FailNow()
	}
	// reading still works, as alex
	if me := d.meOf(); emailOf(me) != alex {
		t.Fatalf("me while viewing: %v", me)
	}
	// stopping works, and so do changes again
	if status, body := d.do("DELETE", "/api/admin/view-as", nil); status != 204 {
		t.Fatalf("stop: %d %v", status, body)
	}
	if status, body := d.do("PUT", "/api/bookmarks/process/"+gcp, nil); status >= 300 {
		t.Fatalf("a change after stopping: %d %v", status, body)
	}
}

func TestViewingAsSomebodySeesExactlyWhatTheySee(t *testing.T) {
	e := setup(t, nil)
	const secret = "Zanzibar merger codename"
	e.as(jordan).startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", secret))
	// something of casey's own: a bookmark and a request
	cs := e.as(casey)
	if status, body := cs.do("PUT", "/api/bookmarks/standard/"+logging, nil); status >= 300 {
		t.Fatalf("bookmark: %d %v", status, body)
	}
	d := e.as(dana)
	for _, person := range []string{casey, morgan} {
		own := e.as(person)
		d.viewAs(person)
		for _, path := range []string{
			"/api/processes", "/api/standards", "/api/catalog", "/api/engagement", "/api/feedback", "/api/requests", "/api/skills", "/api/members",
			"/api/processes/" + gcp + "/draft", "/api/history/process/" + gcp, "/api/skills/process-" + gcp,
			"/api/admin/users", "/api/admin/audit", "/api/admin/system", "/api/admin/statistics", "/api/admin/theme", "/api/admin/source?path=README.md",
		} {
			s1, b1, _ := own.raw("GET", path, nil, false)
			s2, b2, _ := d.raw("GET", path, nil, false)
			if s1 != s2 || string(b1) != string(b2) {
				t.Fatalf("GET %s as %s: %d %.300s; viewing as them: %d %.300s", path, person, s1, b1, s2, b2)
			}
		}
		me, mine := d.meOf(), own.meOf()
		if fmt.Sprint(me["user"]) != fmt.Sprint(mine["user"]) || fmt.Sprint(me["perms"]) != fmt.Sprint(mine["perms"]) {
			t.Fatalf("me: %v; their own: %v", me, mine)
		}
		by, _ := me["viewedBy"].(map[string]any)
		if by["email"] != dana || by["name"] != "Dana Admin" || by["until"] == nil {
			t.Fatalf("viewedBy: %v", me)
		}
		if _, ok := mine["viewedBy"]; ok {
			t.Fatalf("viewedBy without viewing: %v", mine)
		}
		if status, _ := d.do("DELETE", "/api/admin/view-as", nil); status != 204 {
			t.Fatal("stop")
		}
	}
	// what casey may not see stays out of reach, as for casey: the draft, the admin routes
	d.viewAs(casey)
	if status, raw, _ := d.raw("GET", "/api/processes/"+gcp+"/draft", nil, false); status != 404 || strings.Contains(string(raw), "Zanzibar") {
		t.Fatalf("the working draft while viewing as casey: %d %s", status, raw)
	}
	if _, raw, _ := d.raw("GET", "/api/processes", nil, false); strings.Contains(string(raw), "Zanzibar") {
		t.Fatal("the draft is in the list")
	}
	if status, _ := d.do("GET", "/api/admin/users", nil); status != 403 {
		t.Fatalf("admin route while viewing as casey: %d", status)
	}
	// and morgan, a member of google-cloud, sees it: their drafts too
	d.do("DELETE", "/api/admin/view-as", nil)
	d.viewAs(morgan)
	if status, raw, _ := d.raw("GET", "/api/processes/"+gcp+"/draft", nil, false); status != 200 || !strings.Contains(string(raw), "Zanzibar") {
		t.Fatalf("the working draft while viewing as morgan: %d %.200s", status, raw)
	}
	// without viewing: dana herself again, without viewedBy
	d.do("DELETE", "/api/admin/view-as", nil)
	if me := d.meOf(); emailOf(me) != dana || me["viewedBy"] != nil {
		t.Fatalf("after stopping: %v", me)
	}
}

func TestViewingAsSomebodyCountsNothing(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	d.viewAs(casey)
	before := e.fingerprint()
	for i := 0; i < 2; i++ {
		if status, raw, _ := d.raw("GET", "/api/skills/process-"+gcp+"/download", nil, false); status != 200 || len(raw) == 0 {
			t.Fatalf("download while viewing: %d", status)
		}
		if status, _, _ := d.raw("HEAD", "/api/skills/process-"+gcp+"/download", nil, false); status != 200 {
			t.Fatalf("HEAD download while viewing: %d", status)
		}
	}
	if status, body := d.do("POST", "/api/views/process/"+gcp, nil); status != 403 {
		t.Fatalf("a view while viewing: %d %v", status, body)
	}
	if after := e.fingerprint(); after["skill_downloads"] != before["skill_downloads"] || after["document_views"] != before["document_views"] || after["document_counts"] != before["document_counts"] {
		t.Fatal("a download or a view was counted while viewing")
	}
	// the same download by casey is counted: the rule above is what kept it out
	if status, _, _ := e.as(casey).raw("GET", "/api/skills/process-"+gcp+"/download", nil, false); status != 200 {
		t.Fatal("casey's download")
	}
	if after := e.fingerprint(); after["skill_downloads"] == before["skill_downloads"] {
		t.Fatal("casey's own download was not counted")
	}
}

func TestOnlyAnAdminStartsViewingAndNeverAsThemselves(t *testing.T) {
	e := setup(t, nil)
	start := func(c *client, email string) (int, map[string]any) {
		return c.do("POST", "/api/admin/view-as", map[string]string{"email": email})
	}
	for _, who := range []string{sam, alex, casey, riley, jordan, morgan} {
		status, body := start(e.as(who), dana)
		wantError(t, status, body, 403, "Only admins can do that.")
	}
	if status, body := start(e.anonymous(), casey); status != 401 {
		t.Fatalf("signed out: %d %v", status, body)
	}
	d := e.as(dana)
	status, body := start(d, " DANA@example.com ")
	wantError(t, status, body, 400, "You cannot view the portal as yourself: this is already your view.")
	status, body = start(d, dana)
	wantError(t, status, body, 400, "You cannot view the portal as yourself: this is already your view.")
	for _, bad := range []string{"not an address", "sam@", "@example.com", "sam@example", "a b@example.com"} {
		status, body = start(d, bad)
		wantError(t, status, body, 400, "That is not an email address. Write one, such as name@company.com.")
	}
	status, body = start(d, "")
	wantError(t, status, body, 400, "Say whose view of the portal you want to see: send their email address.")
	// neither nested nor switched: stop first
	d.viewAs(casey)
	for _, other := range []string{jordan, casey, dana} {
		status, body = start(d, other)
		wantError(t, status, body, 409, "You are already viewing the portal as Casey Owner. Stop viewing first, then choose another person.")
	}
	if emailOf(d.meOf()) != casey {
		t.Fatal("switched")
	}
	// another admin viewing as an admin cannot start from there either (jordan made admin)
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: jordan, Role: rbac.Admin, GrantedBy: "setup"}))
	d.do("DELETE", "/api/admin/view-as", nil)
	d.viewAs(jordan)
	status, body = start(d, casey)
	wantError(t, status, body, 409, "")
	// the activity log, in the admin's name
	d.do("DELETE", "/api/admin/view-as", nil)
	starts, stops := e.audits("viewas.start"), e.audits("viewas.stop")
	if len(starts) != 2 || starts[0]["by"] != dana || starts[0]["target"] != casey || starts[1]["target"] != jordan {
		t.Fatalf("starts: %v", starts)
	}
	if len(stops) != 2 || stops[0]["by"] != dana || stops[0]["target"] != casey {
		t.Fatalf("stops: %v", stops)
	}
	// stopping when nothing is viewed is fine and writes nothing
	if status, _ := d.do("DELETE", "/api/admin/view-as", nil); status != 204 || len(e.audits("viewas.stop")) != 2 {
		t.Fatal("stopping twice")
	}
	if status, _ := e.as(sam).do("DELETE", "/api/admin/view-as", nil); status != 204 {
		t.Fatal("stopping by a reader")
	}
}

func TestViewingEndsWhenTheAdminIsNoLongerAnAdmin(t *testing.T) {
	e := setup(t, nil)
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: alex, Role: rbac.Admin, GrantedBy: "setup"}))
	a := e.as(alex)
	a.viewAs(casey)
	if emailOf(a.meOf()) != casey {
		t.Fatal("not viewing")
	}
	must(t, e.deps.Roles.Revoke(bg, alex, rbac.Admin, ""))
	me := a.meOf()
	if emailOf(me) != alex || me["viewedBy"] != nil {
		t.Fatalf("still viewing after the admin role went: %v", me)
	}
	// and it stays ended when the role comes back
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: alex, Role: rbac.Admin, GrantedBy: "setup"}))
	if emailOf(a.meOf()) != alex {
		t.Fatal("viewing came back with the role")
	}
	ends := e.audits("viewas.end")
	if len(ends) != 1 || ends[0]["by"] != alex || ends[0]["target"] != casey || ends[0]["detail"] != "They are no longer an admin." {
		t.Fatalf("ends: %v", ends)
	}
}

// A person who loses every role is a reader from then on, and the view follows: it does not end.
func TestViewingFollowsThePersonWhoLosesTheirRoles(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	d.viewAs(morgan)
	_, err := e.deps.Roles.Replace(bg, morgan, []rbac.Role{}, "setup")
	must(t, err)
	me := d.meOf()
	perms, _ := me["perms"].(map[string]any)
	if emailOf(me) != morgan || me["viewedBy"] == nil || len(perms["memberPlatforms"].([]any)) != 0 {
		t.Fatalf("after morgan lost the roles: %v", me)
	}
	if fmt.Sprint(me["perms"]) != fmt.Sprint(e.as(morgan).meOf()["perms"]) {
		t.Fatal("not morgan's rights")
	}
	if ends := e.audits("viewas.end"); len(ends) != 0 {
		t.Fatalf("ends: %v", ends)
	}
}

// Anybody by address: a reader with no role (sam), an address the portal has never seen, and
// the built-in reader with no roles. Each is exactly a signed-in person without roles, and
// nothing is stored in any table but the viewing itself and Activity.
func TestViewingAsAReaderOrAnUnknownAddressCreatesNothing(t *testing.T) {
	e := setup(t, nil)
	reader := e.as(sam)
	d := e.as(dana)
	for _, who := range []string{sam, "never.seen@example.org", NoRolesReader} {
		before := e.fingerprint()
		body := d.viewAs(who)
		if body["email"] != who {
			t.Fatalf("started: %v", body)
		}
		for _, path := range []string{"/api/processes", "/api/standards", "/api/catalog", "/api/feedback", "/api/requests", "/api/skills", "/api/members",
			"/api/admin/users", "/api/processes/" + gcp + "/draft", "/api/skills/process-" + gcp, "/api/history/process/" + gcp} {
			s1, b1, _ := reader.raw("GET", path, nil, false)
			s2, b2, _ := d.raw("GET", path, nil, false)
			if s1 != s2 || string(b1) != string(b2) {
				t.Fatalf("GET %s as %s: %d %.200s; sam: %d %.200s", path, who, s2, b2, s1, b1)
			}
		}
		me, mine := d.meOf(), reader.meOf()
		if emailOf(me) != who || fmt.Sprint(me["perms"]) != fmt.Sprint(mine["perms"]) {
			t.Fatalf("me as %s: %v; a reader: %v", who, me, mine)
		}
		if who == NoRolesReader {
			if u := me["user"].(map[string]any); u["name"] != "A reader with no roles" {
				t.Fatalf("name: %v", u)
			}
		}
		if status, body := d.do("PUT", "/api/bookmarks/process/"+gcp, nil); status != 403 {
			t.Fatalf("a change as %s: %d %v", who, status, body)
		}
		d.do("DELETE", "/api/admin/view-as", nil)
		if after := e.fingerprint(); fmt.Sprint(after) != fmt.Sprint(before) {
			t.Fatalf("viewing as %s stored something", who)
		}
	}
	if starts := e.audits("viewas.start"); len(starts) != 3 || starts[1]["target"] != "never.seen@example.org" || starts[2]["target"] != NoRolesReader {
		t.Fatalf("starts: %v", starts)
	}
}

// The built-in reader has no rights, even where somebody gave its address roles.
func TestTheReaderWithNoRolesNeverHasRights(t *testing.T) {
	e := setup(t, nil)
	// as an earlier version could have stored it: no way of giving roles accepts the address now
	_, err := e.deps.Roles.Pool.Exec(bg, `insert into role_assignments (email, role, scope, granted_by) values ($1, 'process-editor', '', 'setup')`, NoRolesReader)
	must(t, err)
	d := e.as(dana)
	d.viewAs(NoRolesReader)
	if me := d.meOf(); fmt.Sprint(me["perms"]) != fmt.Sprint(e.as(sam).meOf()["perms"]) {
		t.Fatalf("the reader with no roles has rights: %v", me["perms"])
	}
}

func TestAdminsListThePeopleThePortalKnows(t *testing.T) {
	e := setup(t, nil)
	// shown as actors: the author of feedback, of a request, somebody in the activity log
	e.as(sam).report(docs.Process, gcp, "", "The first step is unclear")
	must(t, e.deps.Audit.Add(bg, "lee@example.com", "Lee Actor", "process.save", gcp, ""))
	_, err := e.deps.Roles.Pool.Exec(bg, `insert into requests (kind, title, description, requested_by_email, requested_by_name) values ('process', 'A thing', '', 'asker@example.com', 'Asker')`)
	must(t, err)
	// known ONLY from reading: never listed
	readers := map[string]string{
		"viewer@example.com":   `insert into document_views (kind, id, day, email) values ('process', '` + gcp + `', current_date, 'viewer@example.com')`,
		"bookmark@example.com": `insert into bookmarks (email, kind, id) values ('bookmark@example.com', 'process', '` + gcp + `')`,
		"upvote@example.com":   `insert into upvotes (email, kind, id) values ('upvote@example.com', 'process', '` + gcp + `')`,
		"download@example.com": `insert into skill_downloads (skill_id, source_kind, source_id, email, via, day) values ('process-` + gcp + `', 'process', '` + gcp + `', 'download@example.com', 'download', current_date)`,
		"signout@example.com":  `insert into signed_out (email, at) values ('signout@example.com', now())`,
	}
	for email, q := range readers {
		if _, err := e.deps.Roles.Pool.Exec(bg, q); err != nil {
			t.Fatalf("%s: %v", email, err)
		}
	}
	status, body := e.as(dana).do("GET", "/api/admin/people", nil)
	wantStatus(t, status, 200, body)
	got := map[string]map[string]any{}
	for _, p := range body["people"].([]any) {
		m := p.(map[string]any)
		got[m["email"].(string)] = m
	}
	for email, roles := range map[string]bool{sam: false, "lee@example.com": false, casey: true, dana: true, morgan: true} {
		if p, ok := got[email]; !ok || p["roles"] != roles {
			t.Fatalf("%s: %v (all: %v)", email, p, got)
		}
	}
	if _, ok := got["asker@example.com"]; !ok {
		t.Fatalf("the author of a request is missing: %v", got)
	}
	for email := range readers {
		if _, ok := got[email]; ok {
			t.Fatalf("%s is listed, known only from reading", email)
		}
	}
	if got[casey]["name"] != "Casey Owner" {
		t.Fatalf("names: %v", got[casey])
	}
	for _, other := range []string{sam, alex, casey} {
		if status, _ := e.as(other).do("GET", "/api/admin/people", nil); status != 403 {
			t.Fatalf("%s lists people: %d", other, status)
		}
	}
	d := e.as(dana)
	d.viewAs(sam)
	if status, _ := d.do("GET", "/api/admin/people", nil); status != 403 {
		t.Fatal("people listed while viewing as a reader")
	}
}

func TestViewingEndsAfterAnHour(t *testing.T) {
	var mu sync.Mutex
	now := time.Now()
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	e := setup(t, func(d *Deps) { d.Sessions.Now = clock })
	d := e.as(dana)
	body := d.viewAs(casey)
	until, err := time.Parse(time.RFC3339, body["until"].(string))
	if err != nil || until.Sub(now) < 59*time.Minute || until.Sub(now) > 61*time.Minute {
		t.Fatalf("until: %v %v", body, err)
	}
	mu.Lock()
	now = now.Add(59 * time.Minute)
	mu.Unlock()
	if emailOf(d.meOf()) != casey {
		t.Fatal("ended before the hour")
	}
	mu.Lock()
	now = now.Add(2 * time.Minute)
	mu.Unlock()
	if me := d.meOf(); emailOf(me) != dana || me["viewedBy"] != nil {
		t.Fatalf("still viewing after an hour: %v", me)
	}
	if ends := e.audits("viewas.end"); len(ends) != 1 || ends[0]["detail"] != "An hour had passed." {
		t.Fatalf("ends: %v", ends)
	}
}

func TestSigningOutWhileViewingSignsOutTheAdminNotThePerson(t *testing.T) {
	e := setup(t, nil)
	c := e.as(casey)
	d := e.as(dana)
	other := e.as(dana) // another session of dana's: not viewing
	d.viewAs(casey)
	if me := other.meOf(); emailOf(me) != dana || me["viewedBy"] != nil {
		t.Fatalf("viewing is of one session only: %v", me)
	}
	if status, body := d.do("POST", "/auth/logout", nil); status != 200 {
		t.Fatalf("sign out: %d %v", status, body)
	}
	if me := c.meOf(); emailOf(me) != casey || me["authenticated"] != true {
		t.Fatalf("casey was signed out by dana's sign-out: %v", me)
	}
	if me := other.meOf(); me["authenticated"] != false {
		t.Fatalf("dana's other session is still signed in: %v", me)
	}
	if ends := e.audits("viewas.end"); len(ends) != 1 || ends[0]["by"] != dana || ends[0]["target"] != casey || ends[0]["detail"] != "They signed out." {
		t.Fatalf("ends: %v", ends)
	}
	// signing in again does not view as anybody
	if me := e.as(dana).meOf(); emailOf(me) != dana || me["viewedBy"] != nil {
		t.Fatalf("after signing in again: %v", me)
	}
}

func TestViewingIsKeptOnTheServerNotInTheCookie(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	var before []string
	for _, ck := range d.http.Jar.Cookies(mustURL(t, e.srv.URL)) {
		before = append(before, ck.Name+"="+ck.Value)
	}
	d.viewAs(casey)
	var after []string
	for _, ck := range d.http.Jar.Cookies(mustURL(t, e.srv.URL)) {
		after = append(after, ck.Name+"="+ck.Value)
	}
	if strings.Join(before, ";") != strings.Join(after, ";") {
		t.Fatalf("the cookie changed: %v -> %v", before, after)
	}
	// the database row, not the cookie, decides: removing it ends viewing
	_, err := e.deps.Roles.Pool.Exec(bg, `delete from viewing_as`)
	must(t, err)
	if emailOf(d.meOf()) != dana {
		t.Fatal("viewing without its row")
	}
}

func TestTheBrakesCountTheAdminWhileViewing(t *testing.T) {
	s := session{}
	s.Email = casey
	viewing := s
	viewing.viewer = &viewingAdmin{}
	viewing.viewer.Email = dana
	if s.countsFor() != casey || viewing.countsFor() != dana || !s.mayCount() || viewing.mayCount() {
		t.Fatalf("counts for %q and %q", s.countsFor(), viewing.countsFor())
	}
	if viewing.self().Email != dana || viewing.self().viewer != nil {
		t.Fatal("self")
	}
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	must(t, err)
	return u
}

// Starting while viewing is refused by the route itself too, not only by guard in front of it.
func TestStartingWhileViewingIsRefusedByTheRouteToo(t *testing.T) {
	e := setup(t, nil)
	a := &api{Deps: e.deps, viewAs: &auth.ViewAs{Pool: e.deps.Roles.Pool}}
	s := session{User: auth.User{Email: casey, Name: "Casey Owner"}, Perms: rbac.PermsFrom(nil, true), id: "x",
		viewer: &viewingAdmin{User: auth.User{Email: dana, Name: "Dana Admin"}, Perms: rbac.PermsFrom(nil, true)}}
	req := httptest.NewRequest("POST", "/api/admin/view-as", strings.NewReader(`{"email":"jordan@example.com"}`))
	req = req.WithContext(context.WithValue(req.Context(), ctxKey{}, s))
	rec := httptest.NewRecorder()
	a.startViewAs(rec, req)
	if rec.Code != 409 {
		t.Fatalf("start while viewing: %d %s", rec.Code, rec.Body)
	}
}

// A change is judged against the person guard resolved, also when viewing starts between guard
// and the route: then it is the admin's own change, never one in the other person's name. The
// clock is the hook: the second time anybody asks it, a viewing appears for the session.
func TestAChangeKeepsThePersonGuardFound(t *testing.T) {
	var mu sync.Mutex
	armed, calls := false, 0
	var hook func()
	clock := func() time.Time {
		mu.Lock()
		run := false
		if armed {
			calls++
			run = calls == 2
		}
		mu.Unlock()
		if run {
			hook()
		}
		return time.Now()
	}
	e := setup(t, func(d *Deps) { d.Sessions.Now = clock })
	d := e.as(dana)
	sid := sessionID(t, d)
	hook = func() {
		_, err := e.deps.Roles.Pool.Exec(bg, `insert into viewing_as (email, session, target, target_name, started_at, until)
			values ($1, $2, $3, '', now(), now() + interval '1 hour')`, dana, sid, casey)
		must(t, err)
	}
	mu.Lock()
	armed = true
	mu.Unlock()
	if status, body := d.do("PUT", "/api/bookmarks/process/"+gcp, nil); status >= 300 {
		t.Fatalf("bookmark: %d %v", status, body)
	}
	var mine, caseys int
	must(t, e.deps.Roles.Pool.QueryRow(bg, `select count(*) filter (where email = $1), count(*) filter (where email = $2) from bookmarks`, dana, casey).Scan(&mine, &caseys))
	if mine != 1 || caseys != 0 {
		t.Fatalf("bookmarks: dana %d, casey %d", mine, caseys)
	}
	mu.Lock()
	n := calls
	mu.Unlock()
	if n < 1 {
		t.Fatal("the hook was never reached")
	}
}

// sessionID reads the id of the client's session from its cookie (signed, not secret).
func sessionID(t *testing.T, c *client) string {
	t.Helper()
	for _, ck := range c.http.Jar.Cookies(mustURL(t, c.e.srv.URL)) {
		if ck.Name != "pm_session" {
			continue
		}
		body, _, _ := strings.Cut(ck.Value, ".")
		raw, err := base64.RawURLEncoding.DecodeString(body)
		must(t, err)
		var p struct {
			Sid string `json:"sid"`
		}
		must(t, json.Unmarshal(raw, &p))
		return p.Sid
	}
	t.Fatal("no session cookie")
	return ""
}

// do with extra headers.
func (c *client) doWith(method, path string, body any, headers map[string]string) (int, map[string]any) {
	c.e.t.Helper()
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, reader)
	req.Header.Set(CSRFHeader, CSRFValue)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := c.http.Do(req)
	must(c.e.t, err)
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (e *env) bookmarksOf(email string) int {
	e.t.Helper()
	var n int
	must(e.t, e.deps.Roles.Pool.QueryRow(bg, `select count(*) from bookmarks where email = $1`, email).Scan(&n))
	return n
}

// A change that finds its viewing ended in that very request (the hour, the admin role gone) is
// not done as the admin: it was meant as the other person. The next request is the admin's.
func TestAChangeThatEndsTheViewingIsNotDoneAsTheAdmin(t *testing.T) {
	var mu sync.Mutex
	now := time.Now()
	clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	e := setup(t, func(d *Deps) { d.Sessions.Now = clock })
	d := e.as(dana)
	d.viewAs(morgan)
	mu.Lock()
	now = now.Add(61 * time.Minute)
	mu.Unlock()
	status, body := d.do("PUT", "/api/bookmarks/process/"+gcp, nil)
	wantError(t, status, body, 409, "Your view of the portal as Morgan Member has ended, so this was not done. Reload the page to go on as yourself.")
	if e.bookmarksOf(dana)+e.bookmarksOf(morgan) != 0 {
		t.Fatal("the change was done")
	}
	if ends := e.audits("viewas.end"); len(ends) != 1 || ends[0]["detail"] != "An hour had passed." {
		t.Fatalf("ends: %v", ends)
	}
	if status, body := d.do("PUT", "/api/bookmarks/process/"+gcp, nil); status >= 300 || e.bookmarksOf(dana) != 1 {
		t.Fatalf("the next change: %d %v", status, body)
	}
	// the admin role gone, the same
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: alex, Role: rbac.Admin, GrantedBy: "setup"}))
	a := e.as(alex)
	a.viewAs(casey)
	must(t, e.deps.Roles.Revoke(bg, alex, rbac.Admin, ""))
	status, body = a.do("PUT", "/api/bookmarks/process/"+gcp, nil)
	wantError(t, status, body, 409, "Your view of the portal as Casey Owner has ended, so this was not done. Reload the page to go on as yourself.")
	if e.bookmarksOf(alex)+e.bookmarksOf(casey) != 0 {
		t.Fatal("the change was done")
	}
}

// The app says with every change whom it believes it acts as; a page left open while viewing
// started or stopped in another tab is refused, in either direction. Without the header (other
// clients) nothing is compared.
func TestAPageThatActsAsSomebodyElseIsRefused(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	stale := "This page is out of date: it was opened for somebody else than the portal now answers you as. Reload the page, then do it again."
	// viewing stopped in another tab: this tab still believes it is casey
	d.viewAs(casey)
	d.do("DELETE", "/api/admin/view-as", nil)
	status, body := d.doWith("PUT", "/api/bookmarks/process/"+gcp, nil, map[string]string{ActingAsHeader: casey})
	wantError(t, status, body, 409, stale)
	if e.bookmarksOf(dana)+e.bookmarksOf(casey) != 0 {
		t.Fatal("done as somebody else")
	}
	status, body = d.doWith("PUT", "/api/bookmarks/process/"+gcp, nil, map[string]string{ActingAsHeader: "nonsense%zz"})
	wantError(t, status, body, 409, stale)
	// the right person, in any letter case and encoded as the app sends it
	if status, body := d.doWith("PUT", "/api/bookmarks/process/"+gcp, nil, map[string]string{ActingAsHeader: "Dana%40Example.com"}); status >= 300 {
		t.Fatalf("own change: %d %v", status, body)
	}
	if status, body := d.do("DELETE", "/api/bookmarks/process/"+gcp, nil); status >= 300 {
		t.Fatalf("without the header: %d %v", status, body)
	}
	// viewing started in another tab: this tab still believes it is dana; refused as any change while viewing
	d.viewAs(casey)
	status, body = d.doWith("PUT", "/api/bookmarks/process/"+gcp, nil, map[string]string{ActingAsHeader: dana})
	wantError(t, status, body, 403, "You are viewing the portal as Casey Owner, so nothing can be changed. Stop viewing first.")
	// stopping and signing out are never refused for it
	if status, _ := d.doWith("DELETE", "/api/admin/view-as", nil, map[string]string{ActingAsHeader: casey}); status != 204 {
		t.Fatal("stop with a stale page")
	}
	if status, _ := d.doWith("POST", "/auth/logout", nil, map[string]string{ActingAsHeader: casey}); status != 200 {
		t.Fatal("sign out with a stale page")
	}
}

// The brakes on searching and on reading the code count the admin who does it, also while
// viewing as somebody: through the real routes.
func TestTheBrakesChargeTheAdminWhileViewing(t *testing.T) {
	t.Run("search", func(t *testing.T) {
		e := setup(t, withSearch(t, &flaky{Embedder: embedding.Builtin(768)}))
		d, own := e.as(dana), e.as(casey)
		d.viewAs(casey)
		for i := 0; i < searchesPerMinute; i++ {
			if status, body := d.do("GET", "/api/search?q=project", nil); status != 200 {
				t.Fatalf("search %d: %d %v", i, status, body)
			}
		}
		if status, _ := d.do("GET", "/api/search?q=project", nil); status != 429 {
			t.Fatalf("over the limit: %d", status)
		}
		if status, body := own.do("GET", "/api/search?q=project", nil); status != 200 {
			t.Fatalf("casey's own search was charged: %d %v", status, body)
		}
		if status, _ := e.as(dana).do("GET", "/api/search?q=project", nil); status != 429 {
			t.Fatalf("dana's other session was not charged: %d", status)
		}
	})
	t.Run("source", func(t *testing.T) {
		root, _ := sourceCheckout(t)
		e := setup(t, func(dp *Deps) { dp.Cfg.SourceDir = root })
		must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: alex, Role: rbac.Admin, GrantedBy: "setup"}))
		d, own := e.as(dana), e.as(alex)
		d.viewAs(alex)
		for i := 0; i < sourceReadsPerMinute; i++ {
			if status, raw, _ := d.raw("GET", sourceQuery("Dockerfile"), nil, false); status != 200 {
				t.Fatalf("read %d: %d %s", i, status, raw)
			}
		}
		if status, _, _ := d.raw("GET", sourceQuery("Dockerfile"), nil, false); status != 429 {
			t.Fatalf("over the limit: %d", status)
		}
		if status, raw, _ := own.raw("GET", sourceQuery("Dockerfile"), nil, false); status != 200 {
			t.Fatalf("alex's own reading was charged: %d %s", status, raw)
		}
		if status, _, _ := e.as(dana).raw("GET", sourceQuery("Dockerfile"), nil, false); status != 429 {
			t.Fatalf("dana's other session was not charged: %d", status)
		}
	})
}

func TestTheAddressIsCappedAndTheReaderAddressGetsNoRole(t *testing.T) {
	e := setup(t, nil)
	d := e.as(dana)
	long := strings.Repeat("a", 243) + "@example.com" // 255
	status, body := d.do("POST", "/api/admin/view-as", map[string]string{"email": long})
	wantError(t, status, body, 400, "That address is too long: an email address has at most 254 characters.")
	if status, _ := d.do("POST", "/api/admin/view-as", map[string]string{"email": long[1:]}); status != 200 {
		t.Fatal("254 characters refused")
	}
	d.do("DELETE", "/api/admin/view-as", nil)
	refused := "reader@no-roles.invalid stands for “a reader with no roles” when an admin views the portal as somebody else. It cannot be given a role."
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"PUT", "/api/admin/users/" + NoRolesReader, map[string]any{"roles": []map[string]string{{"role": "process-editor", "scope": ""}}}},
		{"POST", "/api/admin/access", map[string]string{"email": "Reader@No-Roles.invalid", "role": "admin"}},
		{"POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": NoRolesReader}},
	} {
		status, body := d.do(c.method, c.path, c.body)
		if status != 400 || (body["error"] != refused && !strings.Contains(fmt.Sprint(body["error"]), "cannot be given a role")) {
			t.Fatalf("%s %s: %d %v", c.method, c.path, status, body)
		}
	}
	// jordan, an owner of google-cloud, adds members: the same
	status, body = e.as(jordan).do("POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": NoRolesReader})
	if status != 400 || !strings.Contains(fmt.Sprint(body["error"]), "cannot be given a role") {
		t.Fatalf("owner adds the reader address: %d %v", status, body)
	}
	var n int
	must(t, e.deps.Roles.Pool.QueryRow(bg, `select count(*) from role_assignments where email = $1`, NoRolesReader).Scan(&n))
	if n != 0 {
		t.Fatalf("%d roles stored for the reader address", n)
	}
}

func TestAHeadOfADownloadCountsNothing(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	before := e.fingerprint()["skill_downloads"]
	if status, _, _ := s.raw("HEAD", "/api/skills/process-"+gcp+"/download", nil, false); status != 200 {
		t.Fatalf("HEAD: %d", status)
	}
	if e.fingerprint()["skill_downloads"] != before {
		t.Fatal("a HEAD was counted as a download")
	}
	if status, _, _ := s.raw("GET", "/api/skills/process-"+gcp+"/download", nil, false); status != 200 || e.fingerprint()["skill_downloads"] == before {
		t.Fatal("a GET was not counted")
	}
}
