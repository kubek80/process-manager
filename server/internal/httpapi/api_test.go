package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/auth/oidctest"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/notify"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/schema"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// The built-in development users, with the roles the development setup gives them.
const (
	sam   = "sam@example.com"   // consumer
	alex  = "alex@example.com"  // process editor + manages the lists
	casey = "casey@example.com" // owner for cloud-platform-team, which owns request-gcp-project
	riley = "riley@example.com" // standards editor + owner for the unit "security"
	dana  = "dana@example.com"  // admin through the server settings
)

const (
	gcp     = "request-gcp-project"       // process owned by cloud-platform-team
	repoP   = "request-github-repository" // process owned by developer-experience-team
	logging = "secure-logging"            // standard owned by security
	review  = "code-review"               // standard owned by engineering-practice
)

const repoRoot = "../../.." // sample content and schemas

var bg = context.Background()

type recorder struct {
	mu     sync.Mutex
	events []notify.Event
}

func (r *recorder) Notify(_ context.Context, e notify.Event) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

type env struct {
	t      *testing.T
	srv    *httptest.Server
	notes  *recorder
	deps   Deps
	logged *bytes.Buffer
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// setup starts a server on a fresh database filled with the sample content of the repository.
func setup(t *testing.T, mutate func(*Deps)) *env {
	t.Helper()
	pool := dbtest.NewPool(t)
	schemas, err := schema.Load(filepath.Join(repoRoot, "schema"))
	must(t, err)
	e := &env{t: t, notes: &recorder{}, logged: &bytes.Buffer{}}
	e.deps = Deps{
		Cfg:      config.Config{Auth: config.AuthDev, BaseURL: "http://pm.test", Notify: "log"},
		Sessions: auth.NewSessions([]byte("test-secret"), false),
		Docs:     &docs.Store{Pool: pool}, Schemas: schemas, Roles: &rbac.Store{Pool: pool, Bootstrap: []string{dana}},
		Audit: &audit.Log{Pool: pool}, Skills: &skills.Store{Pool: pool}, Feedback: &feedback.Store{Pool: pool},
		Notifier: e.notes, Log: slog.New(slog.NewTextHandler(e.logged, nil)),
	}
	_, problems, err := e.deps.Docs.ImportDir(bg, repoRoot, "import")
	if err != nil || len(problems) > 0 {
		t.Fatalf("import: %v %v", problems, err)
	}
	must(t, e.deps.Skills.SyncAll(bg, e.deps.Docs))
	for _, r := range auth.DevRoles {
		must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: r.Email, Role: r.Role, Scope: r.Scope, GrantedBy: "setup"}))
	}
	if mutate != nil {
		mutate(&e.deps)
	}
	e.srv = httptest.NewServer(New(e.deps))
	t.Cleanup(e.srv.Close)
	return e
}

// client is one browser.
type client struct {
	e    *env
	http *http.Client
}

func (e *env) anonymous() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, http: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (e *env) as(email string) *client {
	c := e.anonymous()
	if status, body := c.do("POST", "/auth/dev/login", map[string]string{"email": email}); status != 200 {
		e.t.Fatalf("dev login as %s: %d %v", email, status, body)
	}
	return c
}

// do sends JSON (or a raw string) with the CSRF header and decodes the JSON answer.
func (c *client) do(method, path string, body any) (int, map[string]any) {
	c.e.t.Helper()
	status, raw, _ := c.raw(method, path, body, true)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return status, out
}

func (c *client) raw(method, path string, body any, csrf bool) (int, []byte, http.Header) {
	c.e.t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	case []byte:
		reader = bytes.NewReader(b)
	default:
		data, _ := json.Marshal(b)
		reader = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, c.e.srv.URL+path, reader)
	if csrf {
		req.Header.Set(CSRFHeader, CSRFValue)
	}
	res, err := c.http.Do(req)
	must(c.e.t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return res.StatusCode, data, res.Header
}

func (c *client) report(kind, target, item, text string) map[string]any {
	c.e.t.Helper()
	status, it := c.do("POST", "/api/feedback", map[string]string{"targetKind": kind, "targetId": target, "itemId": item, "kind": "broken", "text": text})
	if status != 201 {
		c.e.t.Fatalf("report: %d %v", status, it)
	}
	return it
}

// items returns the feedback of a process or standard as this client sees it.
func (c *client) items(kind, target string) []map[string]any {
	c.e.t.Helper()
	status, raw, _ := c.raw("GET", "/api/feedback", nil, false)
	if status != 200 {
		c.e.t.Fatalf("list feedback: %d %s", status, raw)
	}
	var all map[string]map[string][]map[string]any
	must(c.e.t, json.Unmarshal(raw, &all))
	return all[kind][target]
}

func wantStatus(t *testing.T, got, want int, body any) {
	t.Helper()
	if got != want {
		t.Fatalf("status %d, want %d: %v", got, want, body)
	}
}

// body returns the current text of a document, with one replacement applied.
func (e *env) body(kind, id, old, new string) string {
	e.t.Helper()
	d, err := e.deps.Docs.Get(bg, kind, id)
	must(e.t, err)
	if old != "" && !strings.Contains(string(d.Body), old) {
		e.t.Fatalf("%s %s does not contain %q", kind, id, old)
	}
	return strings.Replace(string(d.Body), old, new, 1)
}

func fix(resolved bool) map[string]bool { return map[string]bool{"resolved": resolved} }

// ---------- sign-in

func TestHealthAndUnknownEndpoint(t *testing.T) {
	e := setup(t, nil)
	status, body := e.anonymous().do("GET", "/healthz", nil)
	if status != 200 || body["ok"] != true {
		t.Fatalf("%d %v", status, body)
	}
	status, body = e.as(sam).do("GET", "/api/nope", nil)
	if status != 404 || body["error"] == "" {
		t.Fatalf("%d %v", status, body)
	}
}

func TestMeShowsRights(t *testing.T) {
	e := setup(t, nil)
	c := e.anonymous()
	_, me := c.do("GET", "/api/me", nil)
	if me["authenticated"] != false || me["provider"] != "dev" || len(me["devUsers"].([]any)) != 5 || me["user"] != nil || me["perms"] != nil {
		t.Fatalf("anonymous me: %v", me)
	}
	status, body := c.do("POST", "/auth/dev/login", map[string]string{"email": "mallory@example.com"})
	wantStatus(t, status, 400, body)
	status, body = c.do("POST", "/auth/dev/login", "{not json")
	wantStatus(t, status, 400, body)

	perms := func(email string) map[string]any {
		_, me := e.as(email).do("GET", "/api/me", nil)
		return me["perms"].(map[string]any)
	}
	if p := perms(sam); p["admin"] != false || p["processes"] != false || p["catalog"] != false || p["standards"] != false || len(p["owns"].([]any)) != 0 {
		t.Fatalf("sam: %v", p)
	}
	if p := perms(alex); p["processes"] != true || p["catalog"] != true || p["admin"] != false || p["standards"] != false {
		t.Fatalf("alex: %v", p)
	}
	if p := perms(casey); p["owns"].([]any)[0] != "cloud-platform-team" || p["processes"] != false {
		t.Fatalf("casey: %v", p)
	}
	if p := perms(riley); p["standardUnits"].([]any)[0] != "security" || p["standards"] != false {
		t.Fatalf("riley: %v", p)
	}
	if p := perms(dana); p["admin"] != true || p["processes"] != true || p["standards"] != true || p["catalog"] != true {
		t.Fatalf("dana: %v", p)
	}
}

func TestLogout(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	status, _ := c.do("POST", "/auth/logout", nil)
	wantStatus(t, status, 200, nil)
	if _, me := c.do("GET", "/api/me", nil); me["authenticated"] != false {
		t.Fatalf("still signed in: %v", me)
	}
	status, body := c.do("GET", "/api/processes", nil)
	wantStatus(t, status, 401, body)
}

func TestEverythingNeedsASession(t *testing.T) {
	e := setup(t, nil)
	c := e.anonymous()
	for _, req := range [][2]string{
		{"GET", "/api/processes"}, {"PUT", "/api/processes/x"}, {"DELETE", "/api/processes/x"}, {"GET", "/api/standards"}, {"PUT", "/api/standards/x"},
		{"DELETE", "/api/standards/x"}, {"GET", "/api/catalog"}, {"PUT", "/api/catalog"}, {"GET", "/api/history/process/x"}, {"GET", "/api/history/process/x/1"},
		{"GET", "/api/feedback"}, {"POST", "/api/feedback"}, {"PATCH", "/api/feedback/x"}, {"DELETE", "/api/feedback/x"},
		{"POST", "/api/feedback/x/also-hit"}, {"DELETE", "/api/feedback/x/also-hit"},
		{"GET", "/api/skills"}, {"GET", "/api/skills/x"}, {"GET", "/api/skills/x/versions/1"}, {"GET", "/api/skills/x/download"}, {"PUT", "/api/skills/x/extra"},
		{"GET", "/api/admin/access"}, {"POST", "/api/admin/access"}, {"DELETE", "/api/admin/access"}, {"GET", "/api/admin/audit"}, {"GET", "/api/admin/system"},
	} {
		if status, body := c.do(req[0], req[1], map[string]string{}); status != 401 {
			t.Errorf("%s %s: %d %v", req[0], req[1], status, body)
		}
	}
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/processes", nil)
	req.AddCookie(&http.Cookie{Name: "pm_session", Value: "forged.value"})
	res, _ := http.DefaultClient.Do(req)
	if res.StatusCode != 401 {
		t.Fatalf("forged cookie: %d", res.StatusCode)
	}
}

func TestChangesNeedTheCSRFHeader(t *testing.T) {
	e := setup(t, nil)
	c := e.as(dana)
	for _, req := range [][2]string{{"POST", "/api/feedback"}, {"PUT", "/api/catalog"}, {"DELETE", "/api/processes/" + repoP}, {"POST", "/api/admin/access"}, {"POST", "/auth/logout"}, {"POST", "/auth/dev/login"}} {
		status, raw, _ := c.raw(req[0], req[1], map[string]string{}, false)
		if status != 403 || !strings.Contains(string(raw), CSRFHeader) {
			t.Errorf("%s %s without header: %d %s", req[0], req[1], status, raw)
		}
	}
	if _, err := e.deps.Docs.Get(bg, docs.Process, repoP); err != nil {
		t.Fatal("the forged delete went through")
	}
	if status, _, _ := c.raw("GET", "/api/processes", nil, false); status != 200 {
		t.Fatalf("reads must work without the header: %d", status)
	}
}

// ---------- OpenID Connect (Entra ID / Google)

func oidcEnv(t *testing.T, claims map[string]any) *env {
	p := oidctest.New(t, "client-1")
	p.Claims = claims
	e := setup(t, func(d *Deps) { d.Cfg.Auth = config.AuthGoogle })
	// the callback address is only known once the server is up, so rebuild the handler
	e.srv.Close()
	mux := http.NewServeMux()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	e.deps.Cfg.BaseURL = e.srv.URL
	o, err := auth.NewOIDC(bg, e.deps.Sessions, p.Server.URL, "client-1", "secret", e.srv.URL+"/auth/callback", "")
	must(t, err)
	e.deps.OIDC = o
	mux.Handle("/", New(e.deps))
	return e
}

func TestOIDCSignInSetsASessionWithRolesFromTheDatabase(t *testing.T) {
	e := oidcEnv(t, map[string]any{"email": "Alex@example.com", "name": "Alex From Google"})
	c := e.anonymous()
	_, me := c.do("GET", "/api/me", nil)
	if me["authenticated"] != false || me["provider"] != "google" || me["devUsers"] != nil {
		t.Fatalf("anonymous me: %v", me)
	}
	if status, _ := c.do("POST", "/auth/dev/login", map[string]string{"email": alex}); status == 200 {
		t.Fatal("the dev login must not exist with a real provider")
	}
	c.http.CheckRedirect = nil
	status, _, _ := c.raw("GET", "/auth/login", nil, false) // app -> provider -> callback -> app
	wantStatus(t, status, 404, "final redirect lands on / (no static dir in this test)")
	_, me = c.do("GET", "/api/me", nil)
	user := me["user"].(map[string]any)
	if me["authenticated"] != true || user["email"] != alex || user["name"] != "Alex From Google" || me["perms"].(map[string]any)["processes"] != true {
		t.Fatalf("after sign-in: %v", me)
	}
	if !strings.Contains(e.logged.String(), "signed in") {
		t.Fatal("sign-in must be logged")
	}
}

func TestOIDCFailureRedirectsWithAReason(t *testing.T) {
	e := oidcEnv(t, map[string]any{"name": "No Email"})
	c := e.anonymous()
	c.http = &http.Client{Jar: c.http.Jar, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if strings.Contains(req.URL.RawQuery, "signin_error") {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	res, err := c.http.Get(e.srv.URL + "/auth/login")
	must(t, err)
	loc := res.Header.Get("Location")
	if res.StatusCode != 302 || !strings.Contains(loc, "signin_error=") || !strings.Contains(loc, "email") {
		t.Fatalf("status %d location %q", res.StatusCode, loc)
	}
	if _, me := c.do("GET", "/api/me", nil); me["authenticated"] != false {
		t.Fatal("a failed sign-in must not create a session")
	}
}

// ---------- content

func TestReadContent(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	status, body := c.do("GET", "/api/processes", nil)
	if status != 200 || len(body["processes"].([]any)) != 7 {
		t.Fatalf("%d %d processes", status, len(body["processes"].([]any)))
	}
	status, body = c.do("GET", "/api/standards", nil)
	if status != 200 || len(body["standards"].([]any)) != 3 {
		t.Fatalf("%d %v", status, body)
	}
	status, body = c.do("GET", "/api/catalog", nil)
	if status != 200 || len(body["environments"].([]any)) != 4 {
		t.Fatalf("%d %v", status, body)
	}
	// before any lists exist the catalog is empty, not an error
	must(t, e.deps.Docs.Delete(bg, docs.Catalog, docs.CatalogID, "x"))
	status, body = c.do("GET", "/api/catalog", nil)
	if status != 200 || len(body["teams"].([]any)) != 0 {
		t.Fatalf("empty catalog: %d %v", status, body)
	}
}

func TestProcessEditorsSaveProcesses(t *testing.T) {
	e := setup(t, nil)
	changed := e.body(docs.Process, repoP, "Request a repository", "Request a repo")
	for _, who := range []string{sam, casey, riley} {
		status, body := e.as(who).do("PUT", "/api/processes/"+repoP, changed)
		if status != 403 || !strings.Contains(body["error"].(string), "process editors") {
			t.Fatalf("%s: %d %v", who, status, body)
		}
		status, _ = e.as(who).do("DELETE", "/api/processes/"+repoP, nil)
		wantStatus(t, status, 403, who)
	}

	editor := e.as(alex)
	status, body := editor.do("PUT", "/api/processes/"+repoP, changed)
	if status != 200 || body["version"] != float64(2) {
		t.Fatalf("save: %d %v", status, body)
	}
	d, _ := e.deps.Docs.Get(bg, docs.Process, repoP)
	if !strings.Contains(string(d.Body), "Request a repo\"") || d.UpdatedBy != alex {
		t.Fatalf("not saved: %s by %s", d.Body[:200], d.UpdatedBy)
	}
	// the save is in the audit trail and the process skill has a new version
	entries, _ := e.deps.Audit.Recent(bg, 5)
	if entries[0].Action != "process.save" || entries[0].Target != repoP || entries[0].Email != alex || entries[0].Detail != "revision 2" {
		t.Fatalf("audit: %+v", entries[0])
	}
	sk, _ := e.deps.Skills.Get(bg, "process-"+repoP)
	content, _ := e.deps.Skills.Content(bg, sk.ID, 0)
	if sk.Version != 2 || !strings.Contains(content, "# Process: Request a repo\n") {
		t.Fatalf("skill v%d", sk.Version)
	}
	// saving the same again is not a new revision and leaves no audit entry
	status, body = editor.do("PUT", "/api/processes/"+repoP, changed)
	if status != 200 || body["version"] != float64(2) {
		t.Fatalf("unchanged save: %d %v", status, body)
	}
	if again, _ := e.deps.Audit.Recent(bg, 5); len(again) != len(entries) {
		t.Fatal("an unchanged save was recorded")
	}

	for name, req := range map[string][2]string{
		"id mismatch":  {"/api/processes/other", changed},
		"wrong shape":  {"/api/processes/" + repoP, `{"id":"` + repoP + `","title":"x"}`},
		"not json":     {"/api/processes/" + repoP, "{nope"},
		"unknown type": {"/api/processes/" + repoP, strings.Replace(changed, `"type": "review"`, `"type": "magic"`, 1)},
	} {
		if status, body := editor.do("PUT", req[0], req[1]); status != 400 || body["error"] == "" {
			t.Errorf("%s: %d %v", name, status, body)
		}
	}
	_, body = editor.do("PUT", "/api/processes/"+repoP, strings.Replace(changed, `"type": "review"`, `"type": "magic"`, 1))
	if !strings.Contains(body["error"].(string), "does not match the format") || !strings.Contains(body["error"].(string), "/steps/2/type") {
		t.Fatalf("the error must say where: %v", body)
	}
	status, body = editor.do("PUT", "/api/processes/"+repoP, `{"id":"`+repoP+`","pad":"`+strings.Repeat("x", maxBody)+`"}`)
	wantStatus(t, status, 413, body)
}

func TestDeletingAProcessRemovesItsFeedbackAndWithdrawsItsSkill(t *testing.T) {
	e := setup(t, nil)
	e.as(sam).report(docs.Process, repoP, "finish-setup", "Template is gone.")
	keep := e.as(sam).report(docs.Process, gcp, "", "Add a diagram.")
	status, body := e.as(alex).do("DELETE", "/api/processes/"+repoP, nil)
	wantStatus(t, status, 200, body)
	status, body = e.as(alex).do("DELETE", "/api/processes/"+repoP, nil)
	wantStatus(t, status, 404, body)
	c := e.as(sam)
	if len(c.items(docs.Process, repoP)) != 0 || c.items(docs.Process, gcp)[0]["id"] != keep["id"] {
		t.Fatal("feedback of the deleted process must go, other feedback must stay")
	}
	if sk, _ := e.deps.Skills.Get(bg, "process-"+repoP); sk.Active {
		t.Fatal("the skill must be withdrawn")
	}
}

func TestStandardsAreEditedByTheirUnit(t *testing.T) {
	e := setup(t, nil)
	changedLogging := e.body(docs.Standard, logging, "never written to logs", "never ever written to logs")
	changedReview := e.body(docs.Standard, review, "about 400", "about 300")

	// process editors and consumers cannot touch standards
	for _, who := range []string{sam, alex, casey} {
		status, body := e.as(who).do("PUT", "/api/standards/"+logging, changedLogging)
		if status != 403 || !strings.Contains(body["error"].(string), "that unit's standards") {
			t.Fatalf("%s: %d %v", who, status, body)
		}
	}
	sec := e.as(riley)
	status, body := sec.do("PUT", "/api/standards/"+logging, changedLogging)
	wantStatus(t, status, 200, body)
	// ...but not another unit's standard,
	status, body = sec.do("PUT", "/api/standards/"+review, changedReview)
	wantStatus(t, status, 403, body)
	status, body = sec.do("DELETE", "/api/standards/"+review, nil)
	wantStatus(t, status, 403, body)
	// not by claiming it for their own unit,
	status, body = sec.do("PUT", "/api/standards/"+review, strings.Replace(changedReview, `"owner": "engineering-practice"`, `"owner": "security"`, 1))
	wantStatus(t, status, 403, body)
	// and they cannot hand their standard to a unit they do not edit for
	status, body = sec.do("PUT", "/api/standards/"+logging, strings.Replace(changedLogging, `"owner": "security"`, `"owner": "engineering-practice"`, 1))
	wantStatus(t, status, 403, body)

	// a new standard for their own unit is fine, and gets a skill and a review agent
	fresh := strings.NewReplacer(`"id": "secure-logging"`, `"id": "secret-storage"`, "Secure logging", "Secret storage").Replace(changedLogging)
	status, body = sec.do("PUT", "/api/standards/secret-storage", fresh)
	wantStatus(t, status, 200, body)
	for _, id := range []string{"standard-secret-storage", "review-secret-storage"} {
		if sk, err := e.deps.Skills.Get(bg, id); err != nil || !sk.Active || sk.Version != 1 {
			t.Errorf("%s: %+v %v", id, sk, err)
		}
	}
	if sk, _ := e.deps.Skills.Get(bg, "review-"+logging); sk.Version != 2 {
		t.Fatalf("the review agent must follow the standard: v%d", sk.Version)
	}
	status, body = sec.do("PUT", "/api/standards/"+logging, strings.Replace(changedLogging, `"level": "must"`, `"level": "always"`, 1))
	if status != 400 || !strings.Contains(body["error"].(string), "/requirements/0/level") {
		t.Fatalf("wrong shape: %d %v", status, body)
	}
	status, body = sec.do("DELETE", "/api/standards/secret-storage", nil)
	wantStatus(t, status, 200, body)

	// an admin edits any unit's standards
	status, body = e.as(dana).do("PUT", "/api/standards/"+review, changedReview)
	wantStatus(t, status, 200, body)
}

func TestListsAreManagedByTheirManagersAndRegenerateSkills(t *testing.T) {
	e := setup(t, nil)
	renamed := e.body(docs.Catalog, docs.CatalogID, `"name": "Cyber Security"`, `"name": "Information Security"`)
	for _, who := range []string{sam, casey, riley} {
		status, body := e.as(who).do("PUT", "/api/catalog", renamed)
		if status != 403 || !strings.Contains(body["error"].(string), "manage the lists") {
			t.Fatalf("%s: %d %v", who, status, body)
		}
	}
	status, body := e.as(alex).do("PUT", "/api/catalog", renamed)
	wantStatus(t, status, 200, body)
	// the unit's new name reaches the generated text
	content, _ := e.deps.Skills.Content(bg, "standard-"+logging, 0)
	sk, _ := e.deps.Skills.Get(bg, "standard-"+logging)
	if sk.Version != 2 || !strings.Contains(content, "Issued by: Information Security") {
		t.Fatalf("skill v%d not regenerated", sk.Version)
	}
	if other, _ := e.deps.Skills.Get(bg, "process-"+gcp); other.Version != 1 {
		t.Fatalf("a skill that does not mention the unit must not change: v%d", other.Version)
	}
	status, body = e.as(alex).do("PUT", "/api/catalog", `{"tiers":[],"languages":[],"teams":[],"tools":[]}`)
	if status != 400 || !strings.Contains(body["error"].(string), "does not match the format") {
		t.Fatalf("lists without environments: %d %v", status, body)
	}
}

func TestHistoryIsForThoseWhoCanEdit(t *testing.T) {
	e := setup(t, nil)
	e.as(alex).do("PUT", "/api/processes/"+repoP, e.body(docs.Process, repoP, "Request a repository", "Request a repo"))
	status, body := e.as(alex).do("GET", "/api/history/process/"+repoP, nil)
	versions := body["versions"].([]any)
	if status != 200 || len(versions) != 2 || versions[0].(map[string]any)["savedBy"] != alex || versions[1].(map[string]any)["savedBy"] != "import" {
		t.Fatalf("history: %d %v", status, body)
	}
	status, old := e.as(alex).do("GET", "/api/history/process/"+repoP+"/1", nil)
	if status != 200 || old["title"] != "Request a repository" {
		t.Fatalf("version 1: %d %v", status, old["title"])
	}
	for _, who := range []string{sam, riley} {
		status, _ := e.as(who).do("GET", "/api/history/process/"+repoP, nil)
		wantStatus(t, status, 403, who)
	}
	if status, _ := e.as(riley).do("GET", "/api/history/standard/"+logging, nil); status != 200 {
		t.Fatalf("riley and her unit's standard: %d", status)
	}
	if status, _ := e.as(riley).do("GET", "/api/history/standard/"+review, nil); status != 403 {
		t.Fatalf("riley and another unit's standard: %d", status)
	}
	if status, _ := e.as(alex).do("GET", "/api/history/catalog/catalog", nil); status != 200 {
		t.Fatalf("lists history: %d", status)
	}
	for _, path := range []string{"/api/history/skill/x", "/api/history/process/Bad_ID", "/api/history/process/" + repoP + "/abc", "/api/history/process/" + repoP + "/99", "/api/history/process/never-existed"} {
		if status, _ := e.as(dana).do("GET", path, nil); status != 404 {
			t.Errorf("%s: %d", path, status)
		}
	}
	// after a delete only an admin can look at what was there
	e.as(alex).do("DELETE", "/api/processes/"+repoP, nil)
	if status, _ := e.as(alex).do("GET", "/api/history/process/"+repoP, nil); status != 403 {
		t.Fatalf("editor after delete: %d", status)
	}
	status, body = e.as(dana).do("GET", "/api/history/process/"+repoP, nil)
	if status != 200 || body["versions"].([]any)[0].(map[string]any)["deleted"] != true {
		t.Fatalf("admin after delete: %d %v", status, body)
	}
}

// ---------- feedback

func TestReportFeedbackOnAStepAndOnARequirement(t *testing.T) {
	e := setup(t, nil)
	item := e.as(sam).report(docs.Process, gcp, "raise-request", "  The form was renamed.  ")
	author := item["author"].(map[string]any)
	if item["text"] != "The form was renamed." || item["targetKind"] != "process" || item["targetId"] != gcp || item["itemId"] != "raise-request" ||
		author["name"] != "Sam Consumer" || item["resolved"] != false || item["mine"] != true || item["canManage"] != false || item["stale"] != false {
		t.Fatalf("item: %v", item)
	}
	onReq := e.as(sam).report(docs.Standard, logging, "SEC-LOG-05", "Does this cover migration scripts?")
	if onReq["targetKind"] != "standard" || onReq["itemId"] != "SEC-LOG-05" {
		t.Fatalf("standard item: %v", onReq)
	}
	whole := e.as(sam).report(docs.Standard, logging, "", "A summary table would help.")
	if _, has := whole["itemId"]; has {
		t.Fatalf("feedback on the whole standard must have no itemId: %v", whole)
	}
	if len(e.as(sam).items(docs.Standard, logging)) != 2 || len(e.as(sam).items(docs.Process, gcp)) != 1 {
		t.Fatal("feedback must be grouped by what it is about")
	}

	// the owner is told, with its contact and a link to the right page
	if len(e.notes.events) != 3 {
		t.Fatalf("notifications: %+v", e.notes.events)
	}
	n := e.notes.events[0]
	if n.Type != "feedback.created" || n.To != "Cloud Platform team" || n.Contact != "Slack #cloud-platform" || n.ProcessTitle != "Request a GCP project" ||
		n.StepTitle != "Raise the 'New GCP project' request" || n.URL != "http://pm.test/#/p/"+gcp+"/feedback" {
		t.Fatalf("notification: %+v", n)
	}
	s := e.notes.events[1]
	if s.To != "Cyber Security" || s.StepTitle != "Structured logs" || s.URL != "http://pm.test/#/s/"+logging+"/feedback" {
		t.Fatalf("standard notification: %+v", s)
	}
}

func TestReportFeedbackRejects(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	cases := map[string]any{
		"That process does not exist":   map[string]string{"targetId": "nope", "kind": "broken", "text": "Something"},
		"That standard does not exist":  map[string]string{"targetKind": "standard", "targetId": gcp, "kind": "broken", "text": "Something"},
		"step does not exist":           map[string]string{"targetId": gcp, "itemId": "nope", "kind": "broken", "text": "Something"},
		"requirement does not exist":    map[string]string{"targetKind": "standard", "targetId": logging, "itemId": "SEC-LOG-99", "kind": "broken", "text": "Something"},
		"what kind":                     map[string]string{"targetId": gcp, "kind": "rant", "text": "Something"},
		"in a sentence":                 map[string]string{"targetId": gcp, "kind": "broken", "text": "  a "},
		"under 2000":                    map[string]string{"targetId": gcp, "kind": "broken", "text": strings.Repeat("ü", 2001)},
		"not valid JSON":                "{nope",
		"That process does not exist.":  map[string]string{"targetId": "../" + gcp, "kind": "broken", "text": "Something"},
		"That process does not exist. ": map[string]string{"targetKind": "catalog", "targetId": "catalog", "kind": "broken", "text": "Something"},
	}
	for want, body := range cases {
		status, got := c.do("POST", "/api/feedback", body)
		if status != 400 || !strings.Contains(got["error"].(string), strings.TrimSpace(want)) {
			t.Errorf("want 400 with %q, got %d %v", want, status, got)
		}
	}
	if len(c.items(docs.Process, gcp)) != 0 || len(e.notes.events) != 0 {
		t.Fatal("rejected feedback was stored or notified")
	}
	status, body := c.do("POST", "/api/feedback", map[string]string{"targetId": gcp, "kind": "broken", "text": strings.Repeat("ü", 2000)})
	wantStatus(t, status, 201, body) // the process is the default kind; the limit counts characters, not bytes
}

func TestWhoMayMarkAsFixed(t *testing.T) {
	e := setup(t, nil)
	onGCP := e.as(sam).report(docs.Process, gcp, "raise-request", "Form renamed.")["id"].(string)
	onRepo := e.as(sam).report(docs.Process, repoP, "", "Template gone.")["id"].(string)
	onLogging := e.as(sam).report(docs.Standard, logging, "SEC-LOG-01", "Example is wrong.")["id"].(string)
	onReview := e.as(sam).report(docs.Standard, review, "", "Too strict.")["id"].(string)
	e.notes.events = nil

	can := func(who, id string) bool {
		status, _ := e.as(who).do("PATCH", "/api/feedback/"+id, fix(true))
		if status == 200 {
			e.as(dana).do("PATCH", "/api/feedback/"+id, fix(false)) // reopen for the next check
		}
		return status == 200
	}
	// who                 gcp process   repo process   security standard   practice standard
	want := map[string][4]bool{
		sam:   {false, false, false, false}, // not even their own reports
		casey: {true, false, false, false},  // owner for the team that owns the GCP process
		alex:  {true, true, false, false},   // edits every process
		riley: {false, false, true, false},  // edits and owns for the unit "security"
		dana:  {true, true, true, true},     // admin
	}
	for who, row := range want {
		for i, id := range []string{onGCP, onRepo, onLogging, onReview} {
			if got := can(who, id); got != row[i] {
				t.Errorf("%s on item %d: got %v, want %v", who, i, got, row[i])
			}
		}
	}
	// what each person is shown matches what the server allows
	if it := e.as(casey).items(docs.Process, gcp)[0]; it["canManage"] != true || it["mine"] != false {
		t.Fatalf("casey's view: %v", it)
	}
	if it := e.as(casey).items(docs.Process, repoP)[0]; it["canManage"] != false {
		t.Fatalf("casey on another team's process: %v", it)
	}
	if it := e.as(riley).items(docs.Standard, logging)[0]; it["canManage"] != true {
		t.Fatalf("riley's view: %v", it)
	}

	// marking as fixed tells the reporter, once
	e.notes.events = nil
	status, body := e.as(casey).do("PATCH", "/api/feedback/"+onGCP, fix(true))
	if status != 200 || body["resolved"] != true || body["resolvedBy"] != "Casey Owner" {
		t.Fatalf("resolved item: %d %v", status, body)
	}
	e.as(casey).do("PATCH", "/api/feedback/"+onGCP, fix(true))
	if len(e.notes.events) != 1 || e.notes.events[0].Type != "feedback.resolved" || e.notes.events[0].To != sam || e.notes.events[0].Actor != "Casey Owner" {
		t.Fatalf("notifications: %+v", e.notes.events)
	}

	editor := e.as(alex)
	status, body = editor.do("PATCH", "/api/feedback/"+onRepo, map[string]string{})
	wantStatus(t, status, 400, body)
	status, body = editor.do("PATCH", "/api/feedback/"+onRepo, "{nope")
	wantStatus(t, status, 400, body)
	status, body = editor.do("PATCH", "/api/feedback/00000000-0000-0000-0000-000000000000", fix(true))
	wantStatus(t, status, 404, body)
	status, body = editor.do("PATCH", "/api/feedback/not-an-id", fix(true))
	wantStatus(t, status, 404, body)
}

func TestFixingYourOwnReportDoesNotNotifyYou(t *testing.T) {
	e := setup(t, nil)
	id := e.as(alex).report(docs.Process, repoP, "", "Shorter name.")["id"].(string)
	e.notes.events = nil
	status, body := e.as(alex).do("PATCH", "/api/feedback/"+id, fix(true))
	wantStatus(t, status, 200, body)
	if len(e.notes.events) != 0 {
		t.Fatalf("notified: %+v", e.notes.events)
	}
}

func TestAlsoHit(t *testing.T) {
	e := setup(t, nil)
	id := e.as(sam).report(docs.Standard, logging, "SEC-LOG-01", "Example is wrong.")["id"].(string)
	status, body := e.as(sam).do("POST", "/api/feedback/"+id+"/also-hit", nil)
	if status != 400 || !strings.Contains(body["error"].(string), "yourself") {
		t.Fatalf("reporter: %d %v", status, body)
	}
	c := e.as(casey)
	for i := 0; i < 2; i++ {
		status, body = c.do("POST", "/api/feedback/"+id+"/also-hit", nil)
		if status != 200 || body["alsoHit"] != float64(1) || body["alsoHitByMe"] != true {
			t.Fatalf("casey: %d %v", status, body)
		}
	}
	_, body = e.as(alex).do("POST", "/api/feedback/"+id+"/also-hit", nil)
	if body["alsoHit"] != float64(2) {
		t.Fatalf("alex: %v", body)
	}
	if it := e.as(sam).items(docs.Standard, logging)[0]; it["alsoHit"] != float64(2) || it["alsoHitByMe"] != false {
		t.Fatalf("reporter's view: %v", it)
	}
	status, body = c.do("DELETE", "/api/feedback/"+id+"/also-hit", nil)
	if status != 200 || body["alsoHit"] != float64(1) || body["alsoHitByMe"] != false {
		t.Fatalf("withdraw: %d %v", status, body)
	}
	status, body = c.do("POST", "/api/feedback/00000000-0000-0000-0000-000000000000/also-hit", nil)
	wantStatus(t, status, 404, body)
}

func TestWhoMayDelete(t *testing.T) {
	e := setup(t, nil)
	mine := e.as(sam).report(docs.Process, repoP, "", "First.")["id"].(string)
	theirs := e.as(casey).report(docs.Process, repoP, "", "Second.")["id"].(string)
	onOwned := e.as(sam).report(docs.Process, gcp, "", "Third.")["id"].(string)
	onStandard := e.as(sam).report(docs.Standard, logging, "", "Fourth.")["id"].(string)

	status, body := e.as(sam).do("DELETE", "/api/feedback/"+theirs, nil)
	wantStatus(t, status, 403, body)
	status, body = e.as(alex).do("DELETE", "/api/feedback/"+onStandard, nil) // a process editor has no say over standards
	wantStatus(t, status, 403, body)
	for who, id := range map[string]string{sam: mine, casey: onOwned, alex: theirs, riley: onStandard} {
		if status, _ := e.as(who).do("DELETE", "/api/feedback/"+id, nil); status != 204 {
			t.Errorf("%s: %d", who, status)
		}
	}
	status, body = e.as(alex).do("DELETE", "/api/feedback/"+theirs, nil)
	wantStatus(t, status, 404, body)
}

func TestStaleWhenTheStepOrRequirementChanged(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	onStep := c.report(docs.Process, gcp, "raise-request", "Form renamed.")["id"].(string)
	otherStep := c.report(docs.Process, gcp, "verify-access", "Which console?")["id"].(string)
	wholeProcess := c.report(docs.Process, gcp, "", "Add a diagram.")["id"].(string)
	onReq := c.report(docs.Standard, logging, "SEC-LOG-01", "Example is wrong.")["id"].(string)
	stale := func() map[string]bool {
		out := map[string]bool{}
		for _, it := range append(c.items(docs.Process, gcp), c.items(docs.Standard, logging)...) {
			out[it["id"].(string)] = it["stale"].(bool)
		}
		return out
	}
	if s := stale(); s[onStep] || s[otherStep] || s[wholeProcess] || s[onReq] {
		t.Fatalf("nothing changed yet: %v", s)
	}

	// the owners rewrite one step and one requirement
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, "Raise the 'New GCP project' request", "Raise the 'Cloud project' request"))
	wantStatus(t, status, 200, body)
	status, body = e.as(riley).do("PUT", "/api/standards/"+logging, e.body(docs.Standard, logging, "never written to logs", "never ever written to logs"))
	wantStatus(t, status, 200, body)
	if s := stale(); !s[onStep] || s[otherStep] || s[wholeProcess] || !s[onReq] {
		t.Fatalf("after the edits: %v", s)
	}
	// once marked fixed it is no longer flagged
	e.as(alex).do("PATCH", "/api/feedback/"+onStep, fix(true))
	if s := stale(); s[onStep] {
		t.Fatal("resolved feedback must not be stale")
	}
	// a removed step
	status, body = e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"id": "verify-access"`, `"id": "check-access"`))
	wantStatus(t, status, 200, body)
	if s := stale(); !s[otherStep] || s[wholeProcess] {
		t.Fatalf("after removing the step: %v", s)
	}
}

// ---------- admin panel

func TestAccessIsManagedByAdminsAndTakesEffectAtOnce(t *testing.T) {
	e := setup(t, nil)
	for _, who := range []string{sam, alex, riley} {
		for _, req := range [][2]string{{"GET", "/api/admin/access"}, {"POST", "/api/admin/access"}, {"DELETE", "/api/admin/access"}, {"GET", "/api/admin/audit"}, {"GET", "/api/admin/system"}} {
			if status, body := e.as(who).do(req[0], req[1], map[string]string{}); status != 403 || !strings.Contains(body["error"].(string), "Only admins") {
				t.Errorf("%s %s %s: %d %v", who, req[0], req[1], status, body)
			}
		}
	}
	admin := e.as(dana)
	status, body := admin.do("GET", "/api/admin/access", nil)
	if status != 200 || len(body["assignments"].([]any)) != 5 || body["bootstrapAdmins"].([]any)[0] != dana || len(body["roles"].([]any)) != 5 {
		t.Fatalf("access: %d %v", status, body)
	}

	// Sam cannot edit a standard... until an admin says so
	changed := e.body(docs.Standard, review, "about 400", "about 300")
	samClient := e.as(sam)
	status, _ = samClient.do("PUT", "/api/standards/"+review, changed)
	wantStatus(t, status, 403, nil)
	status, body = admin.do("POST", "/api/admin/access", map[string]string{"email": " Sam@Example.com ", "role": "standards-editor", "scope": "engineering-practice"})
	if status != 200 || len(body["assignments"].([]any)) != 6 {
		t.Fatalf("grant: %d %v", status, body)
	}
	status, body = samClient.do("PUT", "/api/standards/"+review, changed) // same session, no new sign-in
	wantStatus(t, status, 200, body)
	status, body = admin.do("DELETE", "/api/admin/access", map[string]string{"email": sam, "role": "standards-editor", "scope": "engineering-practice"})
	if status != 200 || len(body["assignments"].([]any)) != 5 {
		t.Fatalf("revoke: %d %v", status, body)
	}
	status, _ = samClient.do("PUT", "/api/standards/"+review, e.body(docs.Standard, review, "about 300", "about 200"))
	wantStatus(t, status, 403, nil)

	for want, in := range map[string]map[string]string{
		"not an email address":     {"email": "nobody", "role": "admin"},
		"unknown role":             {"email": "x@example.com", "role": "god"},
		"cannot be limited":        {"email": "x@example.com", "role": "process-editor", "scope": "security"},
		"owner needs":              {"email": "x@example.com", "role": "owner"},
		"no team or unit “ghosts”": {"email": "x@example.com", "role": "owner", "scope": "ghosts"},
	} {
		if status, body := admin.do("POST", "/api/admin/access", in); status != 400 || !strings.Contains(body["error"].(string), want) {
			t.Errorf("want 400 with %q, got %d %v", want, status, body)
		}
	}
	status, body = admin.do("POST", "/api/admin/access", "{nope")
	wantStatus(t, status, 400, body)

	// every change is in the audit trail, newest first
	status, body = admin.do("GET", "/api/admin/audit?limit=3", nil)
	entries := body["entries"].([]any)
	first, second := entries[0].(map[string]any), entries[2].(map[string]any)
	if status != 200 || len(entries) != 3 || first["action"] != "access.revoke" || first["target"] != sam || first["detail"] != "standards-editor for engineering-practice" ||
		first["name"] != "Dana Admin" || second["action"] != "access.grant" {
		t.Fatalf("audit: %d %v", status, entries)
	}
}

func TestTheLastAdminCannotBeRemoved(t *testing.T) {
	e := setup(t, func(d *Deps) { d.Roles.Bootstrap = nil }) // no admin in the server settings
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: dana, Role: rbac.Admin, GrantedBy: "setup"}))
	admin := e.as(dana)
	status, body := admin.do("DELETE", "/api/admin/access", map[string]string{"email": dana, "role": "admin"})
	if status != 409 || !strings.Contains(body["error"].(string), "last admin") {
		t.Fatalf("%d %v", status, body)
	}
	_, body = admin.do("GET", "/api/admin/access", nil)
	if len(body["bootstrapAdmins"].([]any)) != 0 {
		t.Fatalf("bootstrap admins: %v", body["bootstrapAdmins"])
	}
	admin.do("POST", "/api/admin/access", map[string]string{"email": alex, "role": "admin"})
	status, body = admin.do("DELETE", "/api/admin/access", map[string]string{"email": dana, "role": "admin"})
	wantStatus(t, status, 200, body)
	if status, _ := admin.do("GET", "/api/admin/access", nil); status != 403 {
		t.Fatalf("dana gave up her admin role but still gets in: %d", status)
	}
}

func TestSystemOverview(t *testing.T) {
	e := setup(t, nil)
	e.as(sam).report(docs.Process, gcp, "", "One open item.")
	status, body := e.as(dana).do("GET", "/api/admin/system", nil)
	if status != 200 || body["provider"] != "dev" || body["processes"] != float64(7) || body["standards"] != float64(3) || body["skills"] != float64(13) ||
		body["assignments"] != float64(5) || body["openFeedback"] != float64(1) || body["baseUrl"] != "http://pm.test" {
		t.Fatalf("%d %v", status, body)
	}
}

// ---------- skills and review agents

func TestSkillsRegistry(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam) // everyone can read and download skills
	status, body := c.do("GET", "/api/skills", nil)
	list := body["skills"].([]any)
	if status != 200 || len(list) != 13 {
		t.Fatalf("%d, %d skills", status, len(list))
	}
	status, body = c.do("GET", "/api/skills/review-"+logging, nil)
	sk := body["skill"].(map[string]any)
	if status != 200 || sk["kind"] != "review-agent" || sk["sourceKind"] != "standard" || sk["sourceId"] != logging || sk["path"] != ".claude/agents/review-secure-logging.md" ||
		sk["version"] != float64(1) || body["canEdit"] != false || !strings.Contains(body["content"].(string), "report as blocker") || len(body["versions"].([]any)) != 1 {
		t.Fatalf("%d %v", status, sk)
	}
	status, raw, header := c.raw("GET", "/api/skills/review-"+logging+"/download", nil, false)
	if status != 200 || !strings.HasPrefix(string(raw), "---\nname: review-secure-logging\n") ||
		header.Get("Content-Disposition") != `attachment; filename="review-secure-logging.md"` || !strings.HasPrefix(header.Get("Content-Type"), "text/markdown") {
		t.Fatalf("download: %d %q", status, header.Get("Content-Disposition"))
	}
	_, _, header = c.raw("GET", "/api/skills/process-"+gcp+"/download", nil, false)
	if header.Get("Content-Disposition") != `attachment; filename="SKILL.md"` {
		t.Fatalf("skill file name: %q", header.Get("Content-Disposition"))
	}
	for _, path := range []string{"/api/skills/nope", "/api/skills/nope/download", "/api/skills/review-" + logging + "/versions/9", "/api/skills/review-" + logging + "/versions/0", "/api/skills/review-" + logging + "/versions/x"} {
		if status, _ := c.do("GET", path, nil); status != 404 {
			t.Errorf("%s: %d", path, status)
		}
	}
}

func TestExtraGuidanceIsForThoseWhoEditTheSource(t *testing.T) {
	e := setup(t, nil)
	guidance := map[string]string{"extra": "  Ignore files under testdata/.  "}
	for who, id := range map[string]string{sam: "review-" + logging, alex: "review-" + logging, riley: "review-" + review, casey: "process-" + gcp} {
		status, body := e.as(who).do("PUT", "/api/skills/"+id+"/extra", guidance)
		if status != 403 {
			t.Errorf("%s on %s: %d %v", who, id, status, body)
		}
	}
	sec := e.as(riley)
	status, body := sec.do("PUT", "/api/skills/review-"+logging+"/extra", guidance)
	sk := body["skill"].(map[string]any)
	if status != 200 || sk["extra"] != "Ignore files under testdata/." || sk["version"] != float64(2) || body["canEdit"] != true ||
		!strings.Contains(body["content"].(string), "## Additional guidance\n\nIgnore files under testdata/.") || len(body["versions"].([]any)) != 2 {
		t.Fatalf("%d %v", status, sk)
	}
	// the older version is still there, without the guidance
	_, old := sec.do("GET", "/api/skills/review-"+logging+"/versions/1", nil)
	if strings.Contains(old["content"].(string), "Additional guidance") {
		t.Fatal("version 1 was changed")
	}
	// only that item got a new version
	if other, _ := e.deps.Skills.Get(bg, "standard-"+logging); other.Version != 1 {
		t.Fatalf("the skill moved too: v%d", other.Version)
	}
	// the guidance survives a change of the standard
	sec.do("PUT", "/api/standards/"+logging, e.body(docs.Standard, logging, "never written to logs", "never ever written to logs"))
	content, _ := e.deps.Skills.Content(bg, "review-"+logging, 0)
	if !strings.Contains(content, "never ever written") || !strings.Contains(content, "Ignore files under testdata/.") || !strings.Contains(content, "Version 3") {
		t.Fatal("guidance lost on regeneration")
	}
	if status, _ := e.as(alex).do("PUT", "/api/skills/process-"+gcp+"/extra", guidance); status != 200 {
		t.Fatalf("a process editor and a process skill: %d", status)
	}
	status, body = sec.do("PUT", "/api/skills/review-"+logging+"/extra", map[string]string{"extra": strings.Repeat("x", 8001)})
	wantStatus(t, status, 400, body)
	status, body = sec.do("PUT", "/api/skills/review-"+logging+"/extra", "{nope")
	wantStatus(t, status, 400, body)
	status, body = e.as(dana).do("PUT", "/api/skills/nope/extra", guidance)
	wantStatus(t, status, 404, body)
	entries, _ := e.deps.Audit.Recent(bg, 20)
	found := false
	for _, en := range entries {
		found = found || (en.Action == "skill.guidance" && en.Target == "review-"+logging && en.Email == riley)
	}
	if !found {
		t.Fatal("the change of guidance is not in the audit trail")
	}
}

// ---------- built frontend

func TestServesTheBuiltApp(t *testing.T) {
	static := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(static, "assets"), 0o755))
	must(t, os.WriteFile(filepath.Join(static, "index.html"), []byte("<html>app</html>"), 0o644))
	must(t, os.WriteFile(filepath.Join(static, "assets", "app.js"), []byte("console.log(1)"), 0o644))
	e := setup(t, func(d *Deps) { d.Cfg.StaticDir = static })
	c := e.anonymous()

	for _, path := range []string{"/", "/some/deep/link", "/etc/passwd"} {
		if status, body, _ := c.raw("GET", path, nil, false); status != 200 || string(body) != "<html>app</html>" {
			t.Errorf("%s: %d %q", path, status, body)
		}
	}
	// climbing out of the folder never reaches a real file: the router normalises the path first
	c.http.CheckRedirect = nil
	if status, body, _ := c.raw("GET", "/../../etc/passwd", nil, false); status != 200 || string(body) != "<html>app</html>" {
		t.Errorf("path traversal: %d %q", status, body)
	}
	_, _, header := c.raw("GET", "/assets/app.js", nil, false)
	if !strings.Contains(header.Get("Cache-Control"), "immutable") {
		t.Fatalf("asset cache: %q", header.Get("Cache-Control"))
	}
	if status, body := c.do("GET", "/api/nope", nil); status != 404 || body["error"] == nil {
		t.Fatalf("unknown API paths must not fall through to the app: %d %v", status, body)
	}
	if status, _ := c.do("POST", "/", nil); status != 405 {
		t.Fatalf("POST /: %d", status)
	}
}
