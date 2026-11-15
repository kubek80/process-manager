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

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/auth/oidctest"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/content"
	"github.com/kubek80/process-manager/server/internal/feedback/feedbacktest"
	"github.com/kubek80/process-manager/server/internal/notify"
)

const (
	sam   = "sam@example.com"   // no extra rights
	alex  = "alex@example.com"  // editor
	casey = "casey@example.com" // member of cloud-platform-team, which owns request-gcp-project
)

const gcp = `{"schemaVersion":"1.0","id":"request-gcp-project","title":"Request a GCP project","owner":"cloud-platform-team",
 "steps":[{"id":"raise-request","title":"Raise the request","actor":"me","type":"form","next":[{"to":"verify"}]},
          {"id":"verify","title":"Check access","actor":"me","type":"verify","next":[]}]}`
const repo = `{"schemaVersion":"1.0","id":"request-repository","title":"Request a repository","owner":"devex",
 "steps":[{"id":"add-definition","title":"Add the definition","actor":"me","type":"code","next":[]}]}`

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
	dir    string
	notes  *recorder
	deps   Deps
	logged *bytes.Buffer
}

func setup(t *testing.T, mutate func(*Deps)) *env {
	t.Helper()
	dir := t.TempDir()
	files := &content.Store{Dir: dir}
	must(t, files.PutProcess("request-gcp-project", []byte(gcp)))
	must(t, files.PutProcess("request-repository", []byte(repo)))
	must(t, files.PutCatalog([]byte(`{"tiers":[],"languages":[],"tools":[],"teams":[{"id":"cloud-platform-team","name":"Cloud Platform team","contact":"Slack #cloud-platform"}]}`)))
	access := filepath.Join(dir, "config", "access.json")
	must(t, os.MkdirAll(filepath.Dir(access), 0o755))
	must(t, os.WriteFile(access, []byte(`{"editors":["alex@example.com"],"teams":{"cloud-platform-team":["casey@example.com"]}}`), 0o644))

	e := &env{t: t, dir: dir, notes: &recorder{}, logged: &bytes.Buffer{}}
	e.deps = Deps{
		Cfg:      config.Config{Auth: config.AuthDev, ContentDir: dir, ContentWritable: true, AccessFile: access, BaseURL: "http://pm.test"},
		Sessions: auth.NewSessions([]byte("test-secret"), false),
		Content:  files, Feedback: feedbacktest.NewStore(t), Notifier: e.notes,
		Log: slog.New(slog.NewTextHandler(e.logged, nil)),
	}
	if mutate != nil {
		mutate(&e.deps)
	}
	e.srv = httptest.NewServer(New(e.deps))
	t.Cleanup(e.srv.Close)
	return e
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
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
	status, raw := c.raw(method, path, body, true)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return status, out
}

func (c *client) raw(method, path string, body any, csrf bool) (int, []byte) {
	c.e.t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
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
	return res.StatusCode, data
}

func (c *client) report(process, step, kind, text string) map[string]any {
	c.e.t.Helper()
	status, item := c.do("POST", "/api/feedback", map[string]string{"processId": process, "stepId": step, "kind": kind, "text": text})
	if status != 201 {
		c.e.t.Fatalf("report: %d %v", status, item)
	}
	return item
}

// items returns the feedback of a process as this client sees it.
func (c *client) items(process string) []map[string]any {
	c.e.t.Helper()
	status, raw := c.raw("GET", "/api/feedback", nil, false)
	if status != 200 {
		c.e.t.Fatalf("list feedback: %d %s", status, raw)
	}
	var all map[string][]map[string]any
	must(c.e.t, json.Unmarshal(raw, &all))
	return all[process]
}

func wantStatus(t *testing.T, got, want int, body any) {
	t.Helper()
	if got != want {
		t.Fatalf("status %d, want %d: %v", got, want, body)
	}
}

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

func TestMeAndDevLogin(t *testing.T) {
	e := setup(t, nil)
	c := e.anonymous()
	_, me := c.do("GET", "/api/me", nil)
	if me["authenticated"] != false || me["provider"] != "dev" || len(me["devUsers"].([]any)) != 3 || me["user"] != nil {
		t.Fatalf("anonymous me: %v", me)
	}
	status, body := c.do("POST", "/auth/dev/login", map[string]string{"email": "mallory@example.com"})
	wantStatus(t, status, 400, body)
	status, body = c.do("POST", "/auth/dev/login", "{not json")
	wantStatus(t, status, 400, body)

	_, me = e.as(casey).do("GET", "/api/me", nil)
	if me["authenticated"] != true || me["editor"] != false || me["contentWritable"] != true ||
		me["user"].(map[string]any)["name"] != "Casey Owner" || me["teams"].([]any)[0] != "cloud-platform-team" {
		t.Fatalf("casey: %v", me)
	}
	_, me = e.as(alex).do("GET", "/api/me", nil)
	if me["editor"] != true || len(me["teams"].([]any)) != 0 {
		t.Fatalf("alex: %v", me)
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
		{"GET", "/api/processes"}, {"PUT", "/api/processes/x"}, {"DELETE", "/api/processes/x"}, {"GET", "/api/catalog"}, {"PUT", "/api/catalog"},
		{"GET", "/api/feedback"}, {"POST", "/api/feedback"}, {"PATCH", "/api/feedback/x"}, {"DELETE", "/api/feedback/x"},
		{"POST", "/api/feedback/x/also-hit"}, {"DELETE", "/api/feedback/x/also-hit"},
	} {
		if status, body := c.do(req[0], req[1], map[string]string{}); status != 401 {
			t.Errorf("%s %s: %d %v", req[0], req[1], status, body)
		}
	}
	// a forged or foreign cookie is no session either
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/processes", nil)
	req.AddCookie(&http.Cookie{Name: "pm_session", Value: "forged.value"})
	res, _ := http.DefaultClient.Do(req)
	if res.StatusCode != 401 {
		t.Fatalf("forged cookie: %d", res.StatusCode)
	}
}

func TestChangesNeedTheCSRFHeader(t *testing.T) {
	e := setup(t, nil)
	c := e.as(alex)
	for _, req := range [][2]string{{"POST", "/api/feedback"}, {"PUT", "/api/catalog"}, {"DELETE", "/api/processes/request-repository"}, {"POST", "/auth/logout"}, {"POST", "/auth/dev/login"}} {
		status, raw := c.raw(req[0], req[1], map[string]string{}, false)
		if status != 403 || !strings.Contains(string(raw), CSRFHeader) {
			t.Errorf("%s %s without header: %d %s", req[0], req[1], status, raw)
		}
	}
	if _, ok := e.deps.Content.Info("request-repository"); !ok {
		t.Fatal("the forged delete went through")
	}
	if status, _ := c.raw("GET", "/api/processes", nil, false); status != 200 {
		t.Fatalf("reads must work without the header: %d", status)
	}
}

func TestBrokenAccessFileGrantsNothingButReadingWorks(t *testing.T) {
	e := setup(t, nil)
	must(t, os.WriteFile(e.deps.Cfg.AccessFile, []byte("{broken"), 0o644))
	c := e.as(alex)
	_, me := c.do("GET", "/api/me", nil)
	if me["authenticated"] != true || me["editor"] != false {
		t.Fatalf("me: %v", me)
	}
	if status, _ := c.do("GET", "/api/processes", nil); status != 200 {
		t.Fatalf("reading: %d", status)
	}
	if !strings.Contains(e.logged.String(), "access file unreadable") {
		t.Fatal("the problem must be logged")
	}
}

// ---------- OpenID Connect (Entra ID / Google)

func oidcEnv(t *testing.T, claims map[string]any) (*env, *oidctest.Provider) {
	p := oidctest.New(t, "client-1")
	p.Claims = claims
	var e *env
	e = setup(t, func(d *Deps) { d.Cfg.Auth = config.AuthGoogle })
	// the callback address is only known once the server is up, so rebuild the handler
	e.srv.Close()
	mux := http.NewServeMux()
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	e.deps.Cfg.BaseURL = e.srv.URL
	o, err := auth.NewOIDC(context.Background(), e.deps.Sessions, p.Server.URL, "client-1", "secret", e.srv.URL+"/auth/callback", "")
	must(t, err)
	e.deps.OIDC = o
	mux.Handle("/", New(e.deps))
	return e, p
}

func follow(c *client) { c.http.CheckRedirect = nil }

func TestOIDCSignInSetsASession(t *testing.T) {
	e, _ := oidcEnv(t, map[string]any{"email": "Alex@example.com", "name": "Alex From Google"})
	c := e.anonymous()
	_, me := c.do("GET", "/api/me", nil)
	if me["authenticated"] != false || me["provider"] != "google" || me["devUsers"] != nil {
		t.Fatalf("anonymous me: %v", me)
	}
	if status, _ := c.do("POST", "/auth/dev/login", map[string]string{"email": alex}); status == 200 {
		t.Fatal("the dev login must not exist with a real provider")
	}
	follow(c)
	status, _ := c.raw("GET", "/auth/login", nil, false) // app -> provider -> callback -> app
	wantStatus(t, status, 404, "final redirect lands on / (no static dir in this test)")
	_, me = c.do("GET", "/api/me", nil)
	if me["authenticated"] != true || me["editor"] != true || me["user"].(map[string]any)["email"] != alex || me["user"].(map[string]any)["name"] != "Alex From Google" {
		t.Fatalf("after sign-in: %v", me)
	}
	if !strings.Contains(e.logged.String(), "signed in") {
		t.Fatal("sign-in must be logged")
	}
}

func TestOIDCFailureRedirectsWithAReason(t *testing.T) {
	e, _ := oidcEnv(t, map[string]any{"name": "No Email"})
	c := e.anonymous()
	jar := c.http.Jar
	var last *http.Response
	c.http = &http.Client{Jar: jar, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if strings.Contains(req.URL.RawQuery, "signin_error") {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	res, err := c.http.Get(e.srv.URL + "/auth/login")
	must(t, err)
	last = res
	loc := last.Header.Get("Location")
	if last.StatusCode != 302 || !strings.Contains(loc, "signin_error=") || !strings.Contains(loc, "email") {
		t.Fatalf("status %d location %q", last.StatusCode, loc)
	}
	if _, me := c.do("GET", "/api/me", nil); me["authenticated"] != false {
		t.Fatal("a failed sign-in must not create a session")
	}
}

// ---------- content files

func TestReadContent(t *testing.T) {
	e := setup(t, nil)
	must(t, os.WriteFile(filepath.Join(e.dir, "processes", "broken.json"), []byte("{nope"), 0o644))
	c := e.as(sam)
	status, body := c.do("GET", "/api/processes", nil)
	if status != 200 || len(body["processes"].([]any)) != 2 || body["broken"].([]any)[0].(map[string]any)["file"] != "broken.json" {
		t.Fatalf("%d %v", status, body)
	}
	status, body = c.do("GET", "/api/catalog", nil)
	if status != 200 || len(body["teams"].([]any)) != 1 {
		t.Fatalf("%d %v", status, body)
	}
}

func TestOnlyEditorsWriteContentAndOnlyWhereAllowed(t *testing.T) {
	e := setup(t, nil)
	changed := strings.Replace(repo, "Request a repository", "Request a repo", 1)

	for _, who := range []string{sam, casey} {
		status, body := e.as(who).do("PUT", "/api/processes/request-repository", changed)
		if status != 403 || !strings.Contains(body["error"].(string), "Only editors") {
			t.Fatalf("%s: %d %v", who, status, body)
		}
		status, _ = e.as(who).do("PUT", "/api/catalog", `{"teams":[]}`)
		wantStatus(t, status, 403, who)
		status, _ = e.as(who).do("DELETE", "/api/processes/request-repository", nil)
		wantStatus(t, status, 403, who)
	}

	editor := e.as(alex)
	status, body := editor.do("PUT", "/api/processes/request-repository", changed)
	wantStatus(t, status, 200, body)
	if info, _ := e.deps.Content.Info("request-repository"); info.Title != "Request a repo" {
		t.Fatalf("not written: %+v", info)
	}
	status, body = editor.do("PUT", "/api/catalog", `{"tiers":[],"languages":[],"tools":[],"teams":[{"id":"devex","name":"DevEx"}]}`)
	wantStatus(t, status, 200, body)
	if team, ok := e.deps.Content.Team("devex"); !ok || team.Name != "DevEx" {
		t.Fatal("catalog not written")
	}

	for name, req := range map[string][2]string{
		"id mismatch": {"/api/processes/other", changed}, "bad id": {"/api/processes/Bad_ID", changed},
		"not json": {"/api/processes/request-repository", "{nope"}, "catalog not object": {"/api/catalog", "[]"},
	} {
		if status, body := editor.do("PUT", req[0], req[1]); status != 400 || body["error"] == "" {
			t.Errorf("%s: %d %v", name, status, body)
		}
	}
	status, body = editor.do("PUT", "/api/processes/request-repository", `{"id":"request-repository","pad":"`+strings.Repeat("x", maxBody)+`"}`)
	wantStatus(t, status, 413, body)

	// read-only deployment: not even editors write
	ro := setup(t, func(d *Deps) { d.Cfg.ContentWritable = false })
	status, body = ro.as(alex).do("PUT", "/api/processes/request-repository", changed)
	if status != 403 || !strings.Contains(body["error"].(string), "read-only") {
		t.Fatalf("%d %v", status, body)
	}
	if _, me := ro.as(alex).do("GET", "/api/me", nil); me["contentWritable"] != false {
		t.Fatalf("me must say the content is read-only: %v", me)
	}
}

func TestDeletingAProcessRemovesItsFeedback(t *testing.T) {
	e := setup(t, nil)
	e.as(sam).report("request-repository", "add-definition", "broken", "Template is gone.")
	keep := e.as(sam).report("request-gcp-project", "", "idea", "Add a diagram.")
	status, body := e.as(alex).do("DELETE", "/api/processes/request-repository", nil)
	wantStatus(t, status, 200, body)
	if _, ok := e.deps.Content.Info("request-repository"); ok {
		t.Fatal("file still there")
	}
	c := e.as(sam)
	if len(c.items("request-repository")) != 0 || len(c.items("request-gcp-project")) != 1 || c.items("request-gcp-project")[0]["id"] != keep["id"] {
		t.Fatal("feedback of the deleted process must go, other feedback must stay")
	}
}

// ---------- feedback

func TestReportFeedback(t *testing.T) {
	e := setup(t, nil)
	item := e.as(sam).report("request-gcp-project", "raise-request", "broken", "  The form was renamed.  ")
	author := item["author"].(map[string]any)
	if item["text"] != "The form was renamed." || item["stepId"] != "raise-request" || author["name"] != "Sam Consumer" || author["email"] != sam ||
		item["resolved"] != false || item["mine"] != true || item["canManage"] != false || item["stale"] != false || item["alsoHit"] != float64(0) {
		t.Fatalf("item: %v", item)
	}
	whole := e.as(sam).report("request-gcp-project", "", "idea", "Add a diagram.")
	if _, has := whole["stepId"]; has {
		t.Fatalf("process-level feedback must have no stepId: %v", whole)
	}

	// the owner team is told, with its contact
	if len(e.notes.events) != 2 {
		t.Fatalf("notifications: %+v", e.notes.events)
	}
	n := e.notes.events[0]
	if n.Type != "feedback.created" || n.To != "Cloud Platform team" || n.Contact != "Slack #cloud-platform" || n.ProcessTitle != "Request a GCP project" ||
		n.StepTitle != "Raise the request" || n.Author != "Sam Consumer" || n.URL != "http://pm.test/#/p/request-gcp-project/feedback" {
		t.Fatalf("notification: %+v", n)
	}
	// a process whose owner is not in the catalog still notifies
	e.as(sam).report("request-repository", "", "unclear", "Which template?")
	if got := e.notes.events[2].To; got != "the process owner" {
		t.Fatalf("fallback recipient: %q", got)
	}
}

func TestReportFeedbackRejects(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	cases := map[string]any{
		"does not exist":          map[string]string{"processId": "nope", "kind": "broken", "text": "Something"},
		"step does not exist":     map[string]string{"processId": "request-gcp-project", "stepId": "nope", "kind": "broken", "text": "Something"},
		"what kind":               map[string]string{"processId": "request-gcp-project", "kind": "rant", "text": "Something"},
		"in a sentence":           map[string]string{"processId": "request-gcp-project", "kind": "broken", "text": "  a "},
		"under 2000":              map[string]string{"processId": "request-gcp-project", "kind": "broken", "text": strings.Repeat("ü", 2001)},
		"not valid JSON":          "{nope",
		"That process does not e": map[string]string{"processId": "../request-gcp-project", "kind": "broken", "text": "Something"},
	}
	for want, body := range cases {
		status, got := c.do("POST", "/api/feedback", body)
		if status != 400 || !strings.Contains(got["error"].(string), want) {
			t.Errorf("want 400 with %q, got %d %v", want, status, got)
		}
	}
	if len(c.items("request-gcp-project")) != 0 || len(e.notes.events) != 0 {
		t.Fatal("rejected feedback was stored or notified")
	}
	// exactly at the limit is fine, counted in characters not bytes
	status, body := c.do("POST", "/api/feedback", map[string]string{"processId": "request-gcp-project", "kind": "broken", "text": strings.Repeat("ü", 2000)})
	wantStatus(t, status, 201, body)
}

func TestWhoMayMarkAsFixed(t *testing.T) {
	e := setup(t, nil)
	onGCP := e.as(sam).report("request-gcp-project", "raise-request", "broken", "Form renamed.")["id"].(string)
	onRepo := e.as(sam).report("request-repository", "", "broken", "Template gone.")["id"].(string)
	e.notes.events = nil
	fix := map[string]bool{"resolved": true}

	// a consumer cannot, not even on their own report
	status, body := e.as(sam).do("PATCH", "/api/feedback/"+onGCP, fix)
	wantStatus(t, status, 403, body)

	// the owner team can on its own process, and sees that it can
	owner := e.as(casey)
	for _, it := range owner.items("request-gcp-project") {
		if it["canManage"] != true || it["mine"] != false {
			t.Fatalf("owner view: %v", it)
		}
	}
	if owner.items("request-repository")[0]["canManage"] != false {
		t.Fatal("owner of one process must not manage another")
	}
	status, body = owner.do("PATCH", "/api/feedback/"+onRepo, fix)
	wantStatus(t, status, 403, body)
	status, body = owner.do("PATCH", "/api/feedback/"+onGCP, fix)
	wantStatus(t, status, 200, body)
	if body["resolved"] != true || body["resolvedBy"] != "Casey Owner" || body["resolvedAt"] == nil {
		t.Fatalf("resolved item: %v", body)
	}

	// the reporter is told once; fixing again does not notify again
	if len(e.notes.events) != 1 || e.notes.events[0].Type != "feedback.resolved" || e.notes.events[0].To != sam || e.notes.events[0].Actor != "Casey Owner" {
		t.Fatalf("notifications: %+v", e.notes.events)
	}
	owner.do("PATCH", "/api/feedback/"+onGCP, fix)
	if len(e.notes.events) != 1 {
		t.Fatal("resolving twice notified twice")
	}

	// reopen, then an editor fixes it: editors can everywhere
	status, body = owner.do("PATCH", "/api/feedback/"+onGCP, map[string]bool{"resolved": false})
	if status != 200 || body["resolved"] != false || body["resolvedBy"] != nil {
		t.Fatalf("reopen: %d %v", status, body)
	}
	editor := e.as(alex)
	status, body = editor.do("PATCH", "/api/feedback/"+onRepo, fix)
	wantStatus(t, status, 200, body)

	status, body = editor.do("PATCH", "/api/feedback/"+onRepo, map[string]string{})
	wantStatus(t, status, 400, body)
	status, body = editor.do("PATCH", "/api/feedback/"+onRepo, "{nope")
	wantStatus(t, status, 400, body)
	status, body = editor.do("PATCH", "/api/feedback/00000000-0000-0000-0000-000000000000", fix)
	wantStatus(t, status, 404, body)
	status, body = editor.do("PATCH", "/api/feedback/not-an-id", fix)
	wantStatus(t, status, 404, body)
}

func TestFixingYourOwnReportDoesNotNotifyYou(t *testing.T) {
	e := setup(t, nil)
	id := e.as(alex).report("request-repository", "", "idea", "Shorter name.")["id"].(string)
	e.notes.events = nil
	status, body := e.as(alex).do("PATCH", "/api/feedback/"+id, map[string]bool{"resolved": true})
	wantStatus(t, status, 200, body)
	if len(e.notes.events) != 0 {
		t.Fatalf("notified: %+v", e.notes.events)
	}
}

func TestAlsoHit(t *testing.T) {
	e := setup(t, nil)
	id := e.as(sam).report("request-gcp-project", "raise-request", "broken", "Form renamed.")["id"].(string)

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
	if it := e.as(sam).items("request-gcp-project")[0]; it["alsoHit"] != float64(2) || it["alsoHitByMe"] != false {
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
	mine := e.as(sam).report("request-repository", "", "idea", "First.")["id"].(string)
	theirs := e.as(casey).report("request-repository", "", "idea", "Second.")["id"].(string)
	onOwned := e.as(sam).report("request-gcp-project", "", "idea", "Third.")["id"].(string)

	status, body := e.as(sam).do("DELETE", "/api/feedback/"+theirs, nil)
	wantStatus(t, status, 403, body)
	status, _ = e.as(sam).do("DELETE", "/api/feedback/"+mine, nil) // own report
	wantStatus(t, status, 204, nil)
	status, _ = e.as(casey).do("DELETE", "/api/feedback/"+onOwned, nil) // owner team
	wantStatus(t, status, 204, nil)
	status, _ = e.as(alex).do("DELETE", "/api/feedback/"+theirs, nil) // editor
	wantStatus(t, status, 204, nil)
	status, body = e.as(alex).do("DELETE", "/api/feedback/"+theirs, nil)
	wantStatus(t, status, 404, body)
	if n := len(e.as(sam).items("request-repository")) + len(e.as(sam).items("request-gcp-project")); n != 0 {
		t.Fatalf("%d items left", n)
	}
}

func TestStaleWhenTheStepChanged(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	onRaise := c.report("request-gcp-project", "raise-request", "broken", "Form renamed.")["id"].(string)
	onVerify := c.report("request-gcp-project", "verify", "unclear", "Which console?")["id"].(string)
	whole := c.report("request-gcp-project", "", "idea", "Add a diagram.")["id"].(string)
	stale := func() map[string]bool {
		out := map[string]bool{}
		for _, it := range c.items("request-gcp-project") {
			out[it["id"].(string)] = it["stale"].(bool)
		}
		return out
	}
	if s := stale(); s[onRaise] || s[onVerify] || s[whole] {
		t.Fatalf("nothing changed yet: %v", s)
	}

	// the owner rewrites one step: only feedback on that step may be fixed already
	must(t, e.deps.Content.PutProcess("request-gcp-project", []byte(strings.Replace(gcp, "Raise the request", "Raise the 'Cloud project' request", 1))))
	if s := stale(); !s[onRaise] || s[onVerify] || s[whole] {
		t.Fatalf("after editing raise-request: %v", s)
	}

	// once marked fixed it is no longer flagged
	e.as(alex).do("PATCH", "/api/feedback/"+onRaise, map[string]bool{"resolved": true})
	if s := stale(); s[onRaise] {
		t.Fatal("resolved feedback must not be stale")
	}

	// a removed step, then a removed file
	must(t, e.deps.Content.PutProcess("request-gcp-project", []byte(strings.Replace(gcp, `"id":"verify"`, `"id":"check"`, 1))))
	if s := stale(); !s[onVerify] || s[whole] {
		t.Fatalf("after removing the step: %v", s)
	}
	must(t, os.Remove(filepath.Join(e.dir, "processes", "request-gcp-project.json")))
	if s := stale(); !s[onVerify] || s[whole] {
		t.Fatalf("after removing the file: %v", s)
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
		if status, body := c.raw("GET", path, nil, false); status != 200 || string(body) != "<html>app</html>" {
			t.Errorf("%s: %d %q", path, status, body)
		}
	}
	// climbing out of the folder never reaches a real file: the router normalises the path first
	follow(c)
	if status, body := c.raw("GET", "/../../etc/passwd", nil, false); status != 200 || string(body) != "<html>app</html>" {
		t.Errorf("path traversal: %d %q", status, body)
	}
	res, err := http.Get(e.srv.URL + "/assets/app.js")
	must(t, err)
	if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Cache-Control"), "immutable") {
		t.Fatalf("asset: %d %q", res.StatusCode, res.Header.Get("Cache-Control"))
	}
	if status, body := c.do("GET", "/api/nope", nil); status != 404 || body["error"] == nil {
		t.Fatalf("unknown API paths must not fall through to the app: %d %v", status, body)
	}
	if status, _ := c.do("POST", "/", nil); status != 405 {
		t.Fatalf("POST /: %d", status)
	}
}
