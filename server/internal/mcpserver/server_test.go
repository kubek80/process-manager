package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/notify"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/skills"
)

const testSecret = "Zq8Wn3Lp6Tx1Vr9Kc4Hy7Bm2Gd5Fs0JaQ"

// The documents the tests add next to the sample content.
const (
	draftProcess  = "draft-secret-plan"
	draftStandard = "draft-secret-rules"
	retired       = "request-gcp-project-old"
)

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
	url    string
	docs   *docs.Store
	fb     *feedback.Store
	notes  *recorder
	secret string
	srv    *Server
	log    *logBuffer
}

// logBuffer keeps what the server logs, at every level.
type logBuffer struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

// fakeIndex answers searches from a fixed list.
type fakeIndex struct {
	mu        sync.Mutex
	on        bool
	found     []Found
	truncated bool
	err       error
	hang      bool // never answers, whatever the context says (a provider that hangs)
	asked     string
	limit     int
}

func (f *fakeIndex) set(fn func(f *fakeIndex)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

func (f *fakeIndex) Enabled() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.on
}

func (f *fakeIndex) Search(_ context.Context, q string, limit int) ([]Found, bool, error) {
	f.mu.Lock()
	f.asked, f.limit = q, limit
	hang := f.hang
	found, truncated, err := f.found, f.truncated, f.err
	f.mu.Unlock()
	if hang {
		select {}
	}
	return found, truncated, err
}

// setup starts the server over HTTP on a database with the sample content, a draft process,
// a draft standard and a retired process.
func setup(t *testing.T, secret string, index Index, change ...func(*Options)) *env {
	t.Helper()
	ctx := context.Background()
	pool := dbtest.NewPool(t)
	d := &docs.Store{Pool: pool}
	if _, problems, err := d.ImportDir(ctx, repo, "import", nil); err != nil || len(problems) > 0 {
		t.Fatal(err, problems)
	}
	gcp, err := d.Get(ctx, docs.Process, "request-gcp-project")
	if err != nil {
		t.Fatal(err)
	}
	put := func(kind, id string, body []byte, change map[string]any) {
		var m map[string]any
		_ = json.Unmarshal(body, &m)
		m["id"] = id
		for k, v := range change {
			m[k] = v
		}
		data, _ := json.Marshal(m)
		if _, _, err := d.Put(ctx, kind, id, data, "test"); err != nil {
			t.Fatal(err)
		}
	}
	put(docs.Process, draftProcess, gcp.Body, map[string]any{"status": "draft", "title": "Launch the secret plan", "summary": "Nobody may know about the secret plan before it is published."})
	put(docs.Process, retired, gcp.Body, map[string]any{"status": "deprecated", "replacedBy": "request-gcp-project", "title": "Request a GCP project the old way"})
	logging, _ := d.Get(ctx, docs.Standard, "secure-logging")
	put(docs.Standard, draftStandard, logging.Body, map[string]any{"status": "draft", "title": "Secret rules about logging"})
	// the published process points at the draft: its title must not show
	put(docs.Process, "request-github-repository", mustGet(t, d, docs.Process, "request-github-repository").Body, map[string]any{"standards": []string{draftStandard, "code-review"}})
	sk := &skills.Store{Pool: pool}
	if err := sk.SyncAll(ctx, d); err != nil {
		t.Fatal(err)
	}
	roles := &rbac.Store{Pool: pool}
	for _, a := range []rbac.Assignment{{Email: "casey@example.com", Role: rbac.Owner, Scope: "cloud-platform-team"}, {Email: "jordan@example.com", Role: rbac.PlatformOwner, Scope: "google-cloud"},
		{Email: "morgan@example.com", Role: rbac.PlatformMember, Scope: "google-cloud"}} {
		a.GrantedBy = "test"
		if err := roles.Grant(ctx, a); err != nil {
			t.Fatal(err)
		}
	}
	e := &env{t: t, docs: d, fb: &feedback.Store{Pool: pool}, notes: &recorder{}, secret: secret}
	e.log = &logBuffer{}
	o := Options{
		Docs: d, Skills: sk, Feedback: e.fb, Roles: roles, Index: index, Notifier: e.notes, Ready: pool.Ping,
		BaseURL: "https://processes.example.com", Secret: secret,
		Now: func() time.Time { return time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC) },
		Log: slog.New(slog.NewTextHandler(e.log, &slog.HandlerOptions{Level: slog.LevelDebug})),
	}
	for _, fn := range change {
		fn(&o)
	}
	srv, err := New(o)
	if err != nil {
		t.Fatal(err)
	}
	e.srv = srv
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	e.url = ts.URL
	return e
}

func mustGet(t *testing.T, d *docs.Store, kind, id string) docs.Doc {
	t.Helper()
	doc, err := d.Get(context.Background(), kind, id)
	if err != nil {
		t.Fatal(err)
	}
	return doc
}

// headers adds fixed headers to every request.
type headers struct {
	h    map[string]string
	next http.RoundTripper
}

func (h headers) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	for k, v := range h.h {
		r.Header.Set(k, v)
	}
	return h.next.RoundTrip(r)
}

// connect opens an MCP session with the SDK's client over HTTP.
func (e *env) connect(h map[string]string) (*mcp.ClientSession, error) {
	c := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "1"}, nil)
	hc := &http.Client{Transport: headers{h: h, next: http.DefaultTransport}}
	return c.Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: e.url + "/mcp", HTTPClient: hc, DisableStandaloneSSE: true, MaxRetries: -1}, nil)
}

func (e *env) session(h map[string]string) *mcp.ClientSession {
	e.t.Helper()
	cs, err := e.connect(h)
	if err != nil {
		e.t.Fatal(err)
	}
	e.t.Cleanup(func() { _ = cs.Close() })
	return cs
}

// authorised are the headers of a call with the secret, acting for person when given.
func (e *env) authorised(person string) map[string]string {
	h := map[string]string{"Authorization": "Bearer " + e.secret}
	if person != "" {
		h[HeaderPerson] = person
		h[HeaderPersonName] = "Sam Consumer"
	}
	return h
}

func toolNames(t *testing.T, cs *mcp.ClientSession) []string {
	t.Helper()
	res, err := cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tl := range res.Tools {
		names = append(names, tl.Name)
		if tl.Description == "" || tl.InputSchema == nil {
			t.Errorf("%s has no description or input schema", tl.Name)
		}
	}
	slices.Sort(names)
	return names
}

// call calls a tool and decodes its structured result into out. It returns the readable text,
// or the error text when the tool refused.
func call(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any, out any) (text string, refused bool) {
	t.Helper()
	res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	if len(res.Content) == 0 {
		t.Fatalf("%s: no content", name)
	}
	text = res.Content[0].(*mcp.TextContent).Text
	if res.IsError {
		return text, true
	}
	if out != nil {
		// start from nothing: decoding into a used value would keep what this answer leaves out
		v := reflect.ValueOf(out).Elem()
		v.Set(reflect.Zero(v.Type()))
		data, _ := json.Marshal(res.StructuredContent)
		if err := json.Unmarshal(data, out); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		// the same as JSON text, for clients that do not read structured results
		if len(res.Content) != 2 || !json.Valid([]byte(res.Content[1].(*mcp.TextContent).Text)) {
			t.Fatalf("%s: no JSON text", name)
		}
	}
	return text, false
}

func mustCall(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any, out any) string {
	t.Helper()
	text, refused := call(t, cs, name, args, out)
	if refused {
		t.Fatalf("%s refused: %s", name, text)
	}
	return text
}

func mustRefuse(t *testing.T, cs *mcp.ClientSession, name string, args map[string]any, want string) {
	t.Helper()
	text, refused := call(t, cs, name, args, nil)
	if !refused || text != want {
		t.Fatalf("%s %v: refused=%v %q, want %q", name, args, refused, text, want)
	}
}

var readTools = []string{"get_catalog", "get_my_steps", "get_process", "get_skill", "get_standard", "search_processes", "search_standards"}

func TestToolsAndInstructions(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	if got := toolNames(t, cs); !slices.Equal(got, readTools) {
		t.Fatalf("%v", got)
	}
	init := cs.InitializeResult()
	if init.ServerInfo.Name != Name || !strings.Contains(init.Instructions, "cannot be waived") || !strings.Contains(init.Instructions, "Drafts are never returned") {
		t.Fatalf("%+v", init)
	}
	// without the secret, naming a person changes nothing
	cs = e.session(map[string]string{HeaderPerson: "sam@example.com"})
	if got := toolNames(t, cs); !slices.Equal(got, readTools) {
		t.Fatalf("with a person but no secret: %v", got)
	}
	if _, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "report_problem", Arguments: map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "idea", "text": "Hello there"}}); err == nil {
		t.Fatal("report_problem could be called without the secret")
	}
	if n, _ := e.fb.Count(context.Background()); n != 0 {
		t.Fatalf("%d feedback items", n)
	}
}

func TestSearchProcessesByWords(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var out SearchOutput
	text := mustCall(t, cs, "search_processes", map[string]any{"query": "budget"}, &out)
	if out.RankedBy != "words" || out.Total != 1 || out.Results[0].ID != "request-gcp-project" || !strings.Contains(text, "Request a GCP project (request-gcp-project, version") {
		t.Fatalf("%s %+v", text, out)
	}
	r := out.Results[0]
	if r.Version < 1 || r.Owner.Name != "Cloud Platform team" || r.Owner.Contact == "" || r.Platform.Name != "Google Cloud" || r.Rigour != "mandatory" ||
		r.Link != "https://processes.example.com/#/p/request-gcp-project" || r.Status != "active" || r.Retired {
		t.Fatalf("%+v", r)
	}
	if len(r.Matches) == 0 || r.Matches[0].Item != "approve-budget" || r.Matches[0].Label != "Step 3: Approve the monthly budget" {
		t.Fatalf("%+v", r.Matches)
	}
	// without a query: everything active, by title; the draft and the retired one are not there
	mustCall(t, cs, "search_processes", nil, &out)
	if out.Total != 7 || out.RankedBy != "title" || out.Results[0].Title > out.Results[1].Title {
		t.Fatalf("%+v", out)
	}
	for _, r := range out.Results {
		if r.ID == draftProcess || r.ID == retired {
			t.Fatalf("%s listed", r.ID)
		}
	}
	// filters by name, any case; a profile
	mustCall(t, cs, "search_processes", map[string]any{"platform": "AKAMAI"}, &out)
	if out.Total != 1 || out.Results[0].ID != "onboard-site-to-akamai" || out.Filters["platform"] != "akamai" {
		t.Fatalf("%+v", out)
	}
	mustCall(t, cs, "search_processes", map[string]any{"tier": "Tier 3", "rigour": "mandatory"}, &out)
	for _, r := range out.Results {
		if r.ID == "onboard-site-to-akamai" || r.ID == "onboard-api-to-apigee" || r.Rigour != "mandatory" {
			t.Fatalf("%s does not apply", r.ID)
		}
	}
	// the review state is marked: akamai was last reviewed 2026-03-02
	mustCall(t, cs, "search_processes", map[string]any{"query": "akamai"}, &out)
	if !out.Results[0].Review.Overdue || out.Results[0].Review.State != "overdue" {
		t.Fatalf("%+v", out.Results[0].Review)
	}
	// limit and total
	mustCall(t, cs, "search_processes", map[string]any{"limit": 2}, &out)
	if out.Total != 7 || len(out.Results) != 2 {
		t.Fatalf("%d %d", out.Total, len(out.Results))
	}
	mustRefuse(t, cs, "search_processes", map[string]any{"category": "space travel"}, "There is no category “space travel”. Use get_catalog to see the categories.")
	// words of the draft find nothing
	text = mustCall(t, cs, "search_processes", map[string]any{"query": "secret plan"}, &out)
	if out.Total != 0 || text != "No active processes match. Try fewer words or filters." {
		t.Fatalf("%s %+v", text, out)
	}
}

func TestSearchStandards(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var out SearchOutput
	mustCall(t, cs, "search_standards", map[string]any{"query": "logs", "environment": "development", "tier": "tier-3"}, &out)
	if out.Total != 1 || out.Results[0].ID != "secure-logging" {
		t.Fatalf("%+v", out)
	}
	var ids []string
	for _, r := range out.Results[0].Requirements {
		ids = append(ids, r.ID+"/"+r.Level)
	}
	if strings.Join(ids, " ") != "SEC-LOG-01/must SEC-LOG-02/must SEC-LOG-05/should" {
		t.Fatalf("%v", ids)
	}
	for _, m := range out.Results[0].Matches {
		if m.Item == "SEC-LOG-03" || m.Item == "SEC-LOG-04" {
			t.Fatalf("a requirement that does not apply matched: %+v", m)
		}
	}
	mustCall(t, cs, "search_standards", map[string]any{"rigour": "should"}, &out)
	if out.Total != 3 {
		t.Fatalf("every sample standard has a should: %+v", out)
	}
	mustCall(t, cs, "search_standards", map[string]any{"rigour": "may"}, &out)
	if out.Total != 0 {
		t.Fatalf("%+v", out)
	}
	mustCall(t, cs, "search_standards", map[string]any{"query": "secret rules"}, &out)
	if out.Total != 0 {
		t.Fatalf("the draft standard was found: %+v", out)
	}
	mustCall(t, cs, "search_standards", map[string]any{"owner": "Cyber Security"}, &out)
	if out.Total != 1 || out.Results[0].ID != "secure-logging" {
		t.Fatalf("%+v", out)
	}
}

func TestSearchByMeaning(t *testing.T) {
	ix := &fakeIndex{on: true, found: []Found{
		{Kind: docs.Process, ID: draftProcess, Score: 0.99, Hits: []FoundHit{{Part: "summary", Label: "Summary"}}},
		{Kind: docs.Process, ID: retired, Score: 0.95},
		{Kind: docs.Standard, ID: "secure-logging", Score: 0.9},
		{Kind: docs.Process, ID: "onboard-site-to-akamai", Score: 0.8, Hits: []FoundHit{{Part: "step", Item: "x", Label: "Step 1: X", Snippet: "…x…", Score: 0.8}}},
		{Kind: docs.Process, ID: "request-gcp-project", Score: 0.7},
	}}
	e := setup(t, "", ix)
	cs := e.session(nil)
	var out SearchOutput
	mustCall(t, cs, "search_processes", map[string]any{"query": "a website faster"}, &out)
	if out.RankedBy != "meaning" || out.Total != 2 || out.Results[0].ID != "onboard-site-to-akamai" || out.Results[1].ID != "request-gcp-project" || ix.asked != "a website faster" || ix.limit != 500 {
		t.Fatalf("%+v", out)
	}
	if out.Results[0].Score != 0.8 || out.Results[0].Matches[0] != (Match{Part: "step", Item: "x", Label: "Step 1: X", Snippet: "…x…"}) {
		t.Fatalf("%+v", out.Results[0])
	}
	// the filters apply to what the index found
	mustCall(t, cs, "search_processes", map[string]any{"query": "a website faster", "platform": "google-cloud"}, &out)
	if out.Total != 1 || out.Results[0].ID != "request-gcp-project" {
		t.Fatalf("%+v", out)
	}
	// when the index fails, the words take over
	ix.set(func(f *fakeIndex) { f.err = errors.New("unreachable") })
	text := mustCall(t, cs, "search_processes", map[string]any{"query": "budget"}, &out)
	if out.RankedBy != "words-fallback" || out.Total != 1 || out.Note == "" || !strings.Contains(text, out.Note) {
		t.Fatalf("%+v", out)
	}
	ix.set(func(f *fakeIndex) { f.err = fmt.Errorf("%w: timeout", ErrIndexProvider) })
	mustCall(t, cs, "search_processes", map[string]any{"query": "budget"}, &out)
	if out.RankedBy != "words-fallback" || !strings.Contains(out.Note, "could not be reached") {
		t.Fatalf("%+v", out)
	}
	ix.set(func(f *fakeIndex) { f.err = ErrIndexNotReady })
	mustCall(t, cs, "search_processes", map[string]any{"query": "budget"}, &out)
	if out.RankedBy != "words-fallback" || !strings.Contains(out.Note, "not ready yet") {
		t.Fatalf("%+v", out)
	}
	// switched off: words
	ix.set(func(f *fakeIndex) { f.on, f.err = false, nil })
	mustCall(t, cs, "search_processes", map[string]any{"query": "budget"}, &out)
	if out.RankedBy != "words" || out.Note != "" {
		t.Fatalf("%+v", out)
	}
}

func TestGetProcess(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var p Process
	text := mustCall(t, cs, "get_process", map[string]any{"id": "request-gcp-project"}, &p)
	if !strings.HasPrefix(text, "Process “Request a GCP project” (request-gcp-project, version 1, owned by Cloud Platform team)") {
		t.Fatalf("%s", text)
	}
	if p.Version != 1 || p.Actors[0].ID != "me" || p.Owner.Name != "Cloud Platform team" || p.Category.Name != "Cloud" || p.Rigour != "mandatory" || p.Notice != "" {
		t.Fatalf("%+v", p.Header)
	}
	var raise, approve Step
	for _, s := range p.Steps {
		switch s.ID {
		case "raise-request":
			raise = s
		case "approve-budget":
			approve = s
		}
	}
	if raise.Tool == nil || raise.Tool.Name != "ServiceNow" || raise.Tool.URL == "" || raise.SubProcess == nil || raise.SubProcess.Title != "Raise a ServiceNow request" || !raise.AgentMayDo {
		t.Fatalf("%+v", raise)
	}
	if approve.AgentMayDo || approve.Actor.Name != "Budget owner" {
		t.Fatalf("%+v", approve)
	}
	if p.Prerequisites[3].Process == nil || p.Prerequisites[3].Process.ID != "request-github-repository" {
		t.Fatalf("%+v", p.Prerequisites)
	}
	if len(p.Skills) != 1 || p.Skills[0].ID != "process-request-gcp-project" {
		t.Fatalf("%+v", p.Skills)
	}
	if p.Actors[2].Team == nil || p.Actors[2].Team.Contact == "" {
		t.Fatalf("%+v", p.Actors)
	}

	// a reference to a draft names its id only
	mustCall(t, cs, "get_process", map[string]any{"id": "request-github-repository"}, &p)
	if p.Standards[0] != (DocRef{Kind: docs.Standard, ID: draftStandard}) || p.Standards[1].Title != "Code review" {
		t.Fatalf("%+v", p.Standards)
	}

	// retired: marked, with what replaces it
	text = mustCall(t, cs, "get_process", map[string]any{"id": retired}, &p)
	if !p.Retired || p.Status != "deprecated" || p.ReplacedBy == nil || p.ReplacedBy.ID != "request-gcp-project" || p.ReplacedBy.Title != "Request a GCP project" ||
		!strings.Contains(p.Notice, "retired") || !strings.Contains(text, "Use Request a GCP project (request-gcp-project) instead.") || p.Review.State != "none" {
		t.Fatalf("%s %+v", text, p.Header)
	}

	// overdue: marked
	mustCall(t, cs, "get_process", map[string]any{"id": "onboard-site-to-akamai"}, &p)
	if !p.Review.Overdue || !strings.Contains(p.Notice, "review is overdue") {
		t.Fatalf("%+v", p.Review)
	}

	// a draft is exactly like nothing
	want := func(id string) string {
		return "There is no process “" + id + "”. Use search_processes to find the id."
	}
	mustRefuse(t, cs, "get_process", map[string]any{"id": draftProcess}, want(draftProcess))
	mustRefuse(t, cs, "get_process", map[string]any{"id": "no-such-thing"}, want("no-such-thing"))
	mustRefuse(t, cs, "get_process", map[string]any{"id": "secure-logging"}, want("secure-logging"))
}

func TestGetStandard(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var st Standard
	mustCall(t, cs, "get_standard", map[string]any{"id": "secure-logging"}, &st)
	if len(st.Requirements) != 5 || st.LeftOut != 0 || st.Scope == "" || st.Version != 1 || st.Practice.Name != "Cyber security" {
		t.Fatalf("%+v", st)
	}
	if len(st.Skills) != 2 {
		t.Fatalf("skill and review agent: %+v", st.Skills)
	}
	r := st.Requirements[2]
	if r.ID != "SEC-LOG-03" || r.Level != "must" || len(r.AppliesTo.Tiers) != 2 || r.AppliesTo.Tiers[0].Name != "Tier 0" || r.Verification == "" {
		t.Fatalf("%+v", r)
	}
	text := mustCall(t, cs, "get_standard", map[string]any{"id": "secure-logging", "tier": "tier-3", "environment": "Development"}, &st)
	if len(st.Requirements) != 3 || st.LeftOut != 2 || !strings.Contains(text, "2 requirements left out because they do not apply") {
		t.Fatalf("%s %+v", text, st)
	}
	mustRefuse(t, cs, "get_standard", map[string]any{"id": "secure-logging", "tier": "tier-9"}, "There is no tier “tier-9”. Use get_catalog to see the tiers.")
	mustRefuse(t, cs, "get_standard", map[string]any{"id": draftStandard}, "There is no standard “"+draftStandard+"”. Use search_standards to find the id.")
	mustRefuse(t, cs, "get_standard", map[string]any{"id": "nothing-here"}, "There is no standard “nothing-here”. Use search_standards to find the id.")
}

func TestGetMySteps(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var m MySteps
	text := mustCall(t, cs, "get_my_steps", map[string]any{"id": "request-gcp-project"}, &m)
	var ids []string
	for _, s := range m.Steps {
		ids = append(ids, s.ID)
		if !s.AgentMayDo {
			t.Errorf("%s: a step of me that is not an approval", s.ID)
		}
	}
	if strings.Join(ids, " ") != "decide-project-details raise-request add-project-config clarify-request verify-access" || m.Actor.ID != "me" || m.Process.Version != 1 {
		t.Fatalf("%v %+v", ids, m.Actor)
	}
	add := m.Steps[2]
	if len(add.Before) != 1 || add.Before[0].ID != "details-ok" || add.Before[0].Actor != "Cloud Platform team" || add.Before[0].Label == "" ||
		len(add.After) != 1 || add.After[0].ID != "review-pull-request" {
		t.Fatalf("%+v", add)
	}
	if !strings.HasPrefix(text, "5 steps of You in process “Request a GCP project”") {
		t.Fatalf("%s", text)
	}
	// another participant, by name; approvals are not for the agent
	mustCall(t, cs, "get_my_steps", map[string]any{"id": "request-gcp-project", "actor": "budget owner"}, &m)
	if len(m.Steps) != 1 || m.Steps[0].ID != "approve-budget" || m.Steps[0].AgentMayDo {
		t.Fatalf("%+v", m.Steps)
	}
	text, refused := call(t, cs, "get_my_steps", map[string]any{"id": "request-gcp-project", "actor": "the moon"}, nil)
	if !refused || !strings.HasPrefix(text, "The process “request-gcp-project” has no participant “the moon”. Its participants are: me (You), budget-owner (Budget owner)") {
		t.Fatalf("%s", text)
	}
	mustRefuse(t, cs, "get_my_steps", map[string]any{"id": draftProcess}, "There is no process “"+draftProcess+"”. Use search_processes to find the id.")
}

func TestGetSkill(t *testing.T) {
	e := setup(t, "", nil)
	cs := e.session(nil)
	var sk SkillOut
	text := mustCall(t, cs, "get_skill", map[string]any{"id": "process-request-gcp-project"}, &sk)
	if sk.Version != 1 || sk.LatestVersion != 1 || sk.SourceVersion != 1 || !sk.Active || sk.Source.ID != "request-gcp-project" || sk.Content == "" || text != sk.Content ||
		sk.Path != ".claude/skills/process-request-gcp-project/SKILL.md" {
		t.Fatalf("%+v", sk)
	}
	mustCall(t, cs, "get_skill", map[string]any{"id": "review-secure-logging", "version": 1}, &sk)
	if sk.Kind != skills.KindReview || sk.Source.Kind != docs.Standard {
		t.Fatalf("%+v", sk)
	}
	mustRefuse(t, cs, "get_skill", map[string]any{"id": "process-request-gcp-project", "version": 7}, "The skill “process-request-gcp-project” has no version 7. Its latest version is 1.")
	missing := func(id string) string {
		return "There is no skill “" + id + "”. The skills of a process or standard are listed by get_process and get_standard."
	}
	mustRefuse(t, cs, "get_skill", map[string]any{"id": "process-nothing"}, missing("process-nothing"))
	// a published process becomes a draft again: its skills, old versions included, are gone for agents
	gcp := mustGet(t, e.docs, docs.Process, "request-gcp-project")
	body := strings.Replace(string(gcp.Body), `"status": "active"`, `"status": "draft"`, 1)
	if _, _, err := e.docs.Put(context.Background(), docs.Process, "request-gcp-project", []byte(body), "test"); err != nil {
		t.Fatal(err)
	}
	mustRefuse(t, cs, "get_skill", map[string]any{"id": "process-request-gcp-project"}, missing("process-request-gcp-project"))
	mustRefuse(t, cs, "get_skill", map[string]any{"id": "process-request-gcp-project", "version": 1}, missing("process-request-gcp-project"))
	// a retired one keeps its skill, marked as withdrawn
	mustRefuse(t, cs, "get_skill", map[string]any{"id": "process-" + retired}, missing("process-"+retired)) // never active, so never generated
}

func TestGetCatalog(t *testing.T) {
	e := setup(t, "", nil)
	var c Catalog
	text := mustCall(t, e.session(nil), "get_catalog", nil, &c)
	if len(c.Teams) != 10 || len(c.Tools) != 9 || c.Tools[2].URL != "https://portal.azure.com" || c.Teams[0].Contact == "" || len(c.Tiers) != 4 || !strings.HasPrefix(text, "10 teams, 3 practices") {
		t.Fatalf("%s %+v", text, c)
	}
	// without the secret nobody vouched for the caller: no people
	if c.MembersShown || c.Teams[2].Members != nil {
		t.Fatalf("%+v", c.Teams[2])
	}
	// how to reach a group, each way on its own, beside the free line
	for _, g := range c.Platforms {
		if g.ID == "google-cloud" && (g.Drafters != nil || g.Contacts == nil || g.Contacts.Email != "cloud-platform@example.com" || g.Contacts.Form == "" || g.Contact == "") {
			t.Fatalf("%+v", g)
		}
	}
	s := setup(t, testSecret, nil)
	mustCall(t, s.session(s.authorised("")), "get_catalog", nil, &c)
	var cloud, gcp Group
	for _, g := range c.Teams {
		if g.ID == "cloud-platform-team" {
			cloud = g
		}
	}
	for _, g := range c.Platforms {
		if g.ID == "google-cloud" {
			gcp = g
		}
	}
	if !c.MembersShown || !slices.Equal(cloud.Members, []string{"casey@example.com"}) || !slices.Equal(gcp.Members, []string{"jordan@example.com"}) ||
		!slices.Equal(gcp.Drafters, []string{"morgan@example.com"}) || cloud.Drafters != nil {
		t.Fatalf("%+v %+v", cloud, gcp)
	}
}

func TestTheSecret(t *testing.T) {
	e := setup(t, testSecret, nil)
	post := func(auth string) (int, string) {
		req, _ := http.NewRequest("POST", e.url+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(body)
	}
	_, missing := post("")
	for _, auth := range []string{"", "Bearer", "Bearer wrong", "Bearer " + testSecret + "x", "Basic " + testSecret, testSecret} {
		status, body := post(auth)
		// missing and wrong get the same answer
		if status != 401 || body != missing || !strings.Contains(body, "A valid shared secret is required") {
			t.Fatalf("%q: %d %s", auth, status, body)
		}
	}
	if status, _ := post("Bearer " + testSecret); status != 200 {
		t.Fatalf("with the secret: %d", status)
	}
	if _, err := e.connect(nil); err == nil {
		t.Fatal("connected without the secret")
	}
	// the health check needs no secret and says nothing
	res, err := http.Get(e.url + "/healthz")
	if err != nil || res.StatusCode != 200 {
		t.Fatal(err, res.StatusCode)
	}
	res.Body.Close()

	// with the secret: read-only, until a person is named
	if got := toolNames(t, e.session(e.authorised(""))); !slices.Equal(got, readTools) {
		t.Fatalf("%v", got)
	}
	if got := toolNames(t, e.session(e.authorised("sam@example.com"))); !slices.Contains(got, "report_problem") || len(got) != 8 {
		t.Fatalf("%v", got)
	}
	// a person header that is not an email is refused
	h := e.authorised("")
	h[HeaderPerson] = "Sam <sam@example.com>"
	if _, err := e.connect(h); err == nil {
		t.Fatal("a person that is not an email address was accepted")
	}
}

func TestOnlyThisMachineWithoutASecret(t *testing.T) {
	e := setup(t, "", nil)
	srv, _ := New(Options{Docs: e.docs})
	req := httptest.NewRequest("POST", "/mcp", strings.NewReader(`{}`))
	req.RemoteAddr = "10.1.2.3:4000"
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if _, err := New(Options{Docs: e.docs, Secret: "short"}); err == nil {
		t.Fatal("a short secret was accepted")
	}
}

func TestReportProblem(t *testing.T) {
	e := setup(t, testSecret, nil)
	ctx := context.Background()
	cs := e.session(e.authorised("Sam@Example.com"))
	var r Report
	text := mustCall(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "itemId": "raise-request", "kind": "outdated", "text": "  The catalogue item has a new name.  "}, &r)
	if r.Author != "sam@example.com" || r.ItemID != "raise-request" || r.NotifiedTo != "Cloud Platform team" || text != "Reported to Cloud Platform team on behalf of sam@example.com." ||
		r.Link != "https://processes.example.com/#/p/request-gcp-project/feedback" {
		t.Fatalf("%s %+v", text, r)
	}
	it, err := e.fb.Get(ctx, r.ID)
	if err != nil || it.AuthorEmail != "sam@example.com" || it.AuthorName != "Sam Consumer" || it.Text != "The catalogue item has a new name." || it.ItemHash == "" {
		t.Fatalf("%+v %v", it, err)
	}
	if len(e.notes.events) != 1 || e.notes.events[0].To != "Cloud Platform team" || e.notes.events[0].StepTitle != "Raise the 'New GCP project' request" || e.notes.events[0].Author != "Sam Consumer" {
		t.Fatalf("%+v", e.notes.events)
	}
	// a standard, and a retired process: published, so feedback is welcome
	mustCall(t, cs, "report_problem", map[string]any{"targetKind": "standard", "targetId": "secure-logging", "itemId": "SEC-LOG-05", "kind": "unclear", "text": "Does this apply to scripts?"}, nil)
	mustCall(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": retired, "kind": "idea", "text": "Remove this one."}, nil)

	// refused: a draft (as if it did not exist), something unknown, a step that is not there, bad text
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": draftProcess, "kind": "idea", "text": "Looks good"}, "There is no process “"+draftProcess+"”. Use search_processes to find the id.")
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "standard", "targetId": draftStandard, "kind": "idea", "text": "Looks good"}, "There is no standard “"+draftStandard+"”. Use search_standards to find the id.")
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "nope", "kind": "idea", "text": "Looks good"}, "There is no process “nope”. Use search_processes to find the id.")
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "itemId": "fly", "kind": "broken", "text": "It broke"},
		"The process “request-gcp-project” has no step “fly”. Use get_process to see the ids of its steps.")
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "angry", "text": "It broke"}, "Choose what kind of problem this is: broken, outdated, unclear, idea.")
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "broken", "text": "no"}, "Say in a sentence what happened.")
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "broken", "text": "bad ‮ text"}, "The text contains characters that change the reading direction. Remove them and try again.")
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "team", "targetId": "security", "kind": "broken", "text": "It broke"}, "targetKind must be process or standard.")
	if n, _ := e.fb.Count(ctx); n != 3 {
		t.Fatalf("%d items", n)
	}

	// the limit per person counts what they reported in the portal too
	for i := 0; i < feedback.MaxPerHour-3; i++ {
		if _, err := e.fb.Create(ctx, feedback.New{TargetKind: docs.Process, TargetID: "request-gcp-project", Kind: "idea", Text: fmt.Sprint("idea ", i), AuthorEmail: "sam@example.com", AuthorName: "Sam"}); err != nil {
			t.Fatal(err)
		}
	}
	mustRefuse(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "broken", "text": "It broke again"}, "This person has reported a lot in the last hour. Try again later.")
	// somebody else is not held back
	mustCall(t, e.session(e.authorised("alex@example.com")), "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "broken", "text": "It broke for me too"}, nil)
	// with the secret but without a person, the tool is not there
	if _, err := e.session(e.authorised("")).CallTool(ctx, &mcp.CallToolParams{Name: "report_problem", Arguments: map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "idea", "text": "Hello there"}}); err == nil {
		t.Fatal("report_problem without a person")
	}
}
