package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
	"github.com/kubek80/process-manager/server/internal/mcpserver"
)

const drafts = "/api/processes/" + gcp + "/draft"

func draftPath(kind, id, what string, rev int) string {
	path := "processes"
	if kind == docs.Standard {
		path = "standards"
	}
	return fmt.Sprintf("/api/%s/%s/%s?rev=%d", path, id, what, rev)
}

func num(v any) int { f, _ := v.(float64); return int(f) }

// startDraft starts the working draft of a document with one replacement applied.
func (c *client) startDraft(kind, id, body string) map[string]any {
	c.e.t.Helper()
	status, out := c.do("PUT", draftPath(kind, id, "draft", 0), body)
	wantStatus(c.e.t, status, 200, out)
	return out
}

func (e *env) version(kind, id string) docs.Doc {
	e.t.Helper()
	d, err := e.deps.Docs.Get(bg, kind, id)
	must(e.t, err)
	return d
}

func TestAWorkingDraftFromStartToPublished(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	before := e.version(docs.Process, gcp)
	entries, _ := e.deps.Audit.Recent(bg, 1)
	lastAudit := int64(0)
	if len(entries) > 0 {
		lastAudit = entries[0].ID
	}

	out := a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", "Request a Google Cloud project"))
	if num(out["revision"]) != 1 || num(out["base"]) != before.Version || out["updatedBy"] != alex || out["updatedAt"] == "" {
		t.Fatalf("start: %v", out)
	}
	// readers, skills and history still have the published version
	if d := e.version(docs.Process, gcp); d.Version != before.Version || !strings.Contains(string(d.Body), `"title": "Request a GCP project"`) {
		t.Fatalf("the published document changed: %d", d.Version)
	}
	status, got := a.do("GET", drafts, nil)
	wantStatus(t, status, 200, got)
	if num(got["revision"]) != 1 || num(got["base"]) != before.Version || !strings.Contains(fmt.Sprint(got["doc"]), "Request a Google Cloud project") {
		t.Fatalf("read: %v", got)
	}

	// starting a second one, and saving from an old revision, are conflicts in the usual shape
	status, got = e.as(jordan).do("PUT", drafts+"?rev=0", e.body(docs.Process, gcp, "", ""))
	wantError(t, status, got, 409, "alex@example.com saved newer unpublished changes while you were working on this.")
	if c := got["conflict"].(map[string]any); c["exists"] != true || c["draft"] != true || num(c["version"]) != 1 || c["updatedBy"] != alex || c["updatedAt"] == nil {
		t.Fatalf("conflict: %v", c)
	}
	status, got = a.do("PUT", drafts+"?rev=1", e.body(docs.Process, gcp, "Request a GCP project", "Request a Google Cloud project, now"))
	wantStatus(t, status, 200, got)
	if num(got["revision"]) != 2 {
		t.Fatalf("second save: %v", got)
	}
	status, got = e.as(jordan).do("PUT", drafts+"?rev=1", e.body(docs.Process, gcp, "", ""))
	wantStatus(t, status, 409, got)
	// the jump straight to rev is required
	for _, q := range []string{"", "?rev=", "?rev=-1", "?rev=x"} {
		if status, _ := a.do("PUT", drafts+q, e.body(docs.Process, gcp, "", "")); status != 400 {
			t.Errorf("PUT %q: %d", q, status)
		}
	}
	// saving a draft is not in the activity log
	if entries, _ := e.deps.Audit.Recent(bg, 1); len(entries) > 0 && entries[0].ID != lastAudit {
		t.Fatalf("a draft save was logged: %+v", entries[0])
	}

	// an old revision is not published
	status, got = a.do("POST", draftPath(docs.Process, gcp, "publish", 1), nil)
	wantStatus(t, status, 409, got)
	status, got = a.do("POST", draftPath(docs.Process, gcp, "publish", 2)+"&note="+url.QueryEscape("New name"), nil)
	wantStatus(t, status, 200, got)
	if num(got["version"]) != before.Version+1 {
		t.Fatalf("publish: %v", got)
	}
	after := e.version(docs.Process, gcp)
	if after.Version != before.Version+1 || !strings.Contains(string(after.Body), "Request a Google Cloud project, now") || after.UpdatedBy != alex {
		t.Fatalf("published: %d %s", after.Version, after.UpdatedBy)
	}
	if status, _ := a.do("GET", drafts, nil); status != 404 {
		t.Fatalf("the draft is still there: %d", status)
	}
	// like any save: in the history with its note, in the activity log, the skills follow
	h, _ := e.deps.Docs.History(bg, docs.Process, gcp)
	if h[0].Version != after.Version || h[0].Note != "New name" || h[0].SavedBy != alex {
		t.Fatalf("history: %+v", h[0])
	}
	entries, _ = e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "process.publish" || entries[0].Target != gcp || entries[0].Detail != fmt.Sprintf("version %d: New name", after.Version) {
		t.Fatalf("audit: %+v", entries[0])
	}
	content, err := e.deps.Skills.Content(bg, "process-"+gcp, 0)
	must(t, err)
	if !strings.Contains(content, "Request a Google Cloud project, now") {
		t.Fatalf("the skill did not follow:\n%s", content)
	}
	// published twice
	status, got = a.do("POST", draftPath(docs.Process, gcp, "publish", 2), nil)
	wantError(t, status, got, 409, "These unpublished changes were published or discarded by someone else while you were working on them.")
	if c := got["conflict"].(map[string]any); c["exists"] != false {
		t.Fatalf("conflict: %v", c)
	}
}

func TestWhoMayWorkOnAWorkingDraft(t *testing.T) {
	e := setup(t, nil)
	const secret = "SECRET NEW NAME"
	e.as(jordan).startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", secret)) // owns the platform google-cloud

	// readers, the owning team (casey) and owners of another practice (riley) may not edit it:
	// every answer is the one for something that does not exist
	_, nothing := e.as(sam).do("GET", "/api/processes/never-existed/draft", nil)
	for _, who := range []string{sam, casey, riley} {
		c := e.as(who)
		for _, call := range []struct{ method, path string }{
			{"GET", drafts}, {"PUT", drafts + "?rev=1"}, {"PUT", drafts + "?rev=0"}, {"DELETE", drafts + "?rev=1"},
			{"POST", "/api/processes/" + gcp + "/publish?rev=1"},
			{"GET", "/api/processes/never-existed/draft"}, {"PUT", "/api/processes/never-existed/draft?rev=0"},
		} {
			payload := e.body(docs.Process, gcp, "", "")
			if strings.Contains(call.path, "never-existed") {
				payload = strings.Replace(payload, `"id": "`+gcp+`"`, `"id": "never-existed"`, 1)
			}
			status, raw, _ := c.raw(call.method, call.path, payload, true)
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			if status != 404 || body["error"] != nothing["error"] || strings.Contains(string(raw), secret) || strings.Contains(string(raw), jordan) {
				t.Errorf("%s %s %s: %d %s", who, call.method, call.path, status, raw)
			}
		}
	}
	if d, _ := e.deps.Docs.GetDraft(bg, docs.Process, gcp); d.Revision != 1 {
		t.Fatalf("changed by somebody who may not: %+v", d)
	}

	// an owner of one platform cannot move it in the draft to another one
	j := e.as(jordan)
	status, body := j.do("PUT", drafts+"?rev=1", e.body(docs.Process, gcp, `"platform": "google-cloud"`, `"platform": "github"`))
	wantError(t, status, body, 403, notYoursFor("process"))
	// ... nor put it into a practice that is not theirs while keeping their platform
	status, body = j.do("PUT", drafts+"?rev=1", e.body(docs.Process, gcp, `"platform": "google-cloud",`, `"platform": "google-cloud", "practice": "security",`))
	wantError(t, status, body, 403, fmt.Sprintf(practiceMsg, "Cyber security", "process", "process"))
	// ... and a general editor can; the platform owner then no longer may edit it at all
	status, body = e.as(alex).do("PUT", drafts+"?rev=1", e.body(docs.Process, gcp, `"platform": "google-cloud"`, `"platform": "github"`))
	wantStatus(t, status, 200, body)
	status, body = j.do("POST", "/api/processes/"+gcp+"/publish?rev=2", nil)
	wantError(t, status, body, 403, notYoursFor("process"))
	// a document jordan may not edit at all
	status, body = j.do("PUT", "/api/processes/"+repoP+"/draft?rev=0", e.body(docs.Process, repoP, "", ""))
	wantError(t, status, body, 404, "That does not exist.")
	// the never-published one: saved the ordinary way
	status, body = e.as(alex).do("PUT", "/api/processes/"+repoP, e.asDraft(docs.Process, repoP, "Hidden"))
	wantStatus(t, status, 200, body)
	status, body = e.as(alex).do("PUT", "/api/processes/"+repoP+"/draft?rev=0", e.body(docs.Process, repoP, "", ""))
	wantError(t, status, body, 409, "This process is not published yet, so readers do not see it: save your changes to it directly.")
	if status, _ := e.as(alex).do("GET", "/api/processes/"+repoP+"/draft", nil); status != 404 {
		t.Fatal("a draft of something never published")
	}
}

func TestWhatADraftNeedsAndWhatPublishingNeeds(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	// unfinished: no title, a step without a name - it is kept, not published
	var doc map[string]any
	must(t, json.Unmarshal([]byte(e.body(docs.Process, gcp, "", "")), &doc))
	delete(doc, "title")
	doc["steps"] = append(doc["steps"].([]any), map[string]any{"id": "", "title": ""})
	out := a.startDraft(docs.Process, gcp, mustJSON(t, doc))
	status, body := a.do("POST", draftPath(docs.Process, gcp, "publish", num(out["revision"])), nil)
	wantStatus(t, status, 400, body)
	if _, err := e.deps.Docs.GetDraft(bg, docs.Process, gcp); err != nil {
		t.Fatalf("a refused publish lost the draft: %v", err)
	}
	for _, c := range []struct{ body, want string }{
		{`[]`, "The draft must be a whole process or standard in JSON."},
		{`{"id": "request-github-repository"}`, "The id in the draft must stay “request-gcp-project”."},
		{`{"id": "request-gcp-project", "title": "a\u0000b"}`, "The draft contains characters that cannot be stored. Remove them and try again."},
		{`{"id": "request-gcp-project", "summary": "` + strings.Repeat("x", docs.MaxDraftBytes) + `"}`, "The draft is too large to save (more than 512 KB). Shorten it and try again."},
	} {
		status, body := a.do("PUT", drafts+"?rev=1", c.body)
		wantError(t, status, body, 400, c.want)
	}
	// larger than any request may be
	status, _ = a.do("PUT", drafts+"?rev=1", `{"id": "request-gcp-project", "summary": "`+strings.Repeat("x", 1<<20)+`"}`)
	wantStatus(t, status, 413, nil)

	// "status" in the draft is ignored: publishing does not hide the published document
	status, body = a.do("PUT", drafts+"?rev=1", e.asDraft(docs.Process, gcp, "Request a GCP project, renamed"))
	wantStatus(t, status, 200, body)
	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 2), nil)
	wantStatus(t, status, 200, body)
	if d := e.version(docs.Process, gcp); docs.StatusOf(d.Body) != "active" || !strings.Contains(string(d.Body), "renamed") {
		t.Fatalf("published: %s", d.Body)
	}
	// ... nor un-retire a retired one
	retire := e.body(docs.Process, gcp, `"status": "active"`, `"status": "deprecated", "replacedBy": "`+repoP+`"`)
	status, body = a.do("PUT", "/api/processes/"+gcp, retire)
	wantStatus(t, status, 200, body)
	a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, `"status": "deprecated"`, `"status": "active"`))
	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 1), nil)
	wantStatus(t, status, 200, body)
	if d := e.version(docs.Process, gcp); docs.StatusOf(d.Body) != "deprecated" {
		t.Fatalf("un-retired: %s", d.Body)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	must(t, err)
	return string(data)
}

func TestPublishingOverANewerVersion(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	v := e.version(docs.Process, gcp).Version
	a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", "Mine"))
	// an import changes the published document meanwhile (people's saves are refused)
	_, _, err := e.deps.Docs.Put(bg, docs.Process, gcp, []byte(e.body(docs.Process, gcp, "Request a GCP project", "Theirs")), "import")
	must(t, err)

	status, body := a.do("POST", draftPath(docs.Process, gcp, "publish", 1), nil)
	wantError(t, status, body, 409, fmt.Sprintf("import saved a newer version (version %d) while you were working on this.", v+1))
	if c := body["conflict"].(map[string]any); c["exists"] != true || num(c["version"]) != v+1 || c["draft"] != nil {
		t.Fatalf("conflict: %v", c)
	}
	// over a version that is not the current one: the same answer
	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 1)+fmt.Sprintf("&over=%d", v), nil)
	wantStatus(t, status, 409, body)
	// "publish mine over theirs"
	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 1)+fmt.Sprintf("&over=%d", v+1), nil)
	wantStatus(t, status, 200, body)
	if d := e.version(docs.Process, gcp); d.Version != v+2 || !strings.Contains(string(d.Body), `"Mine"`) {
		t.Fatalf("published: %d %s", d.Version, d.Body)
	}

	// "continue from theirs": the draft is moved onto the current version
	a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, `"Mine"`, `"Mine again"`))
	_, _, err = e.deps.Docs.Put(bg, docs.Process, gcp, []byte(e.body(docs.Process, gcp, `"Mine"`, `"Theirs again"`)), "import")
	must(t, err)
	status, body = a.do("PUT", drafts+fmt.Sprintf("?rev=1&base=%d", v+2), e.body(docs.Process, gcp, `"Theirs again"`, `"Theirs, and mine"`))
	wantStatus(t, status, 409, body) // not the current version
	status, body = a.do("PUT", drafts+fmt.Sprintf("?rev=1&base=%d", v+3), e.body(docs.Process, gcp, `"Theirs again"`, `"Theirs, and mine"`))
	wantStatus(t, status, 200, body)
	if num(body["base"]) != v+3 || num(body["revision"]) != 2 {
		t.Fatalf("moved: %v", body)
	}
	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 2), nil)
	wantStatus(t, status, 200, body)
	if num(body["version"]) != v+4 {
		t.Fatalf("published: %v", body)
	}
}

func TestADraftIsMovedOverAReviewConfirmation(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	v := e.version(docs.Process, gcp).Version
	a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", "Request a GCP project, revised"))
	// the owning team confirms the review of the published version meanwhile
	status, body := e.as(casey).do("POST", "/api/processes/"+gcp+"/review", nil)
	wantStatus(t, status, 200, body)
	reviewed := e.version(docs.Process, gcp)
	var want struct{ Review any }
	must(t, json.Unmarshal(reviewed.Body, &want))

	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 1), nil)
	wantStatus(t, status, 200, body)
	d := e.version(docs.Process, gcp)
	var got struct{ Review any }
	must(t, json.Unmarshal(d.Body, &got))
	if d.Version != v+2 || !strings.Contains(string(d.Body), "revised") || fmt.Sprint(got.Review) != fmt.Sprint(want.Review) {
		t.Fatalf("published %d with review %v, want %v", d.Version, got.Review, want.Review)
	}

	// anything else in between is a real conflict
	a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "revised", "revised twice"))
	_, _, err := e.deps.Docs.Put(bg, docs.Process, gcp, []byte(e.body(docs.Process, gcp, `"rigour": "mandatory"`, `"rigour": "recommended"`)), "import")
	must(t, err)
	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 1), nil)
	wantStatus(t, status, 409, body)
}

func TestOrdinarySavesWhileThereAreUnpublishedChanges(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", "Changed"))
	path := "/api/processes/" + gcp
	for _, c := range []struct{ body, want string }{
		{e.body(docs.Process, gcp, `"status": "active"`, `"status": "draft"`), "This process has unpublished changes by alex@example.com. Publish or discard them before you hide the process from readers again."},
		{e.body(docs.Process, gcp, `"status": "active"`, `"status": "deprecated", "replacedBy": "` + repoP + `"`), "This process has unpublished changes by alex@example.com. Publish or discard them before you retire the process."},
		{e.body(docs.Process, gcp, "Request a GCP project", "Changed directly"), "This process has unpublished changes by alex@example.com. Publish or discard them first, then make this change."},
	} {
		status, body := e.as(jordan).do("PUT", path, c.body)
		wantError(t, status, body, 409, c.want)
		if d := body["draft"].(map[string]any); d["updatedBy"] != alex || d["updatedAt"] == nil || body["conflict"] != nil {
			t.Fatalf("draft: %v", body)
		}
	}
	// a reader learns nothing from trying
	status, body := e.as(sam).do("PUT", path, e.body(docs.Process, gcp, `"status": "active"`, `"status": "draft"`))
	wantError(t, status, body, 403, notTheirsFor("process"))
	// confirming the review is still possible
	status, body = e.as(casey).do("POST", path+"/review", nil)
	wantStatus(t, status, 200, body)

	// discarding: the right revision only, in the activity log
	status, body = a.do("DELETE", drafts+"?rev=2", nil)
	wantStatus(t, status, 409, body)
	status, raw, _ := e.as(jordan).raw("DELETE", drafts+"?rev=1", nil, true)
	if status != 204 || len(raw) != 0 {
		t.Fatalf("discard: %d %s", status, raw)
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "process.discard" || entries[0].Email != jordan || entries[0].Target != gcp || !strings.Contains(entries[0].Detail, "last saved by alex@example.com") {
		t.Fatalf("audit: %+v", entries[0])
	}
	status, body = a.do("DELETE", drafts+"?rev=1", nil)
	wantStatus(t, status, 409, body)
	// now retiring is an ordinary save again
	status, body = e.as(jordan).do("PUT", path, e.body(docs.Process, gcp, `"status": "active"`, `"status": "deprecated", "replacedBy": "`+repoP+`"`))
	wantStatus(t, status, 200, body)

	// deleting the document deletes its draft; under the same id it starts without one
	e.as(alex).startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", "Changed"))
	status, body = a.do("DELETE", path, nil)
	wantStatus(t, status, 200, body)
	var n int
	must(t, e.deps.Docs.Pool.QueryRow(bg, `select count(*) from working_drafts`).Scan(&n))
	if n != 0 {
		t.Fatalf("%d drafts left", n)
	}
}

func TestRestoringAnOldVersionGoesThroughTheDraft(t *testing.T) {
	e := setup(t, nil)
	a := e.as(alex)
	v := e.version(docs.Process, gcp).Version
	status, body := a.do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, "Request a GCP project", "Renamed"))
	wantStatus(t, status, 200, body)
	// the app loads the old version and puts it into its draft
	status, old, _ := a.raw("GET", fmt.Sprintf("/api/history/process/%s/%d", gcp, v), nil, false)
	wantStatus(t, status, 200, string(old))
	a.startDraft(docs.Process, gcp, string(old))
	status, body = a.do("POST", draftPath(docs.Process, gcp, "publish", 1)+"&note="+url.QueryEscape(fmt.Sprintf("Restored version %d", v)), nil)
	wantStatus(t, status, 200, body)
	if d := e.version(docs.Process, gcp); d.Version != v+2 || mustJSON(t, json.RawMessage(d.Body)) != mustJSON(t, json.RawMessage(old)) {
		t.Fatalf("restored: %d\n%s", d.Version, d.Body)
	}
}

func TestListsSayWhenADocumentWasAddedAndWhoHasUnpublishedChanges(t *testing.T) {
	e := setup(t, nil)
	e.as(jordan).startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", "Changed"))
	meta := func(who string) map[string]map[string]any {
		status, raw, _ := e.as(who).raw("GET", "/api/processes", nil, false)
		wantStatus(t, status, 200, string(raw))
		var out struct{ Meta map[string]map[string]any }
		must(t, json.Unmarshal(raw, &out))
		return out.Meta
	}
	for who, sees := range map[string]bool{alex: true, jordan: true, dana: true, sam: false, casey: false, riley: false} {
		m := meta(who)
		for id, entry := range m {
			created, err := time.Parse(time.RFC3339Nano, fmt.Sprint(entry["createdAt"]))
			if err != nil || created.IsZero() || created.After(time.Now()) {
				t.Errorf("%s: createdAt of %s: %v", who, id, entry["createdAt"])
			}
			if id != gcp && entry["draft"] != nil {
				t.Errorf("%s: a draft of %s", who, id)
			}
		}
		d, has := m[gcp]["draft"].(map[string]any)
		if has != sees || (sees && (d["updatedBy"] != jordan || d["updatedAt"] == nil || len(d) != 2)) {
			t.Errorf("%s sees the draft: %v (want %v)", who, m[gcp]["draft"], sees)
		}
	}
	// a team owner sees the drafts of what their team owns, but has no right to edit: no draft
	if _, ok := meta(casey)[gcp]; !ok {
		t.Fatal("casey does not see the process")
	}
	if st, raw, _ := e.as(sam).raw("GET", "/api/standards", nil, false); st != 200 || !strings.Contains(string(raw), `"createdAt"`) {
		t.Fatalf("standards: %d %s", st, raw)
	}
}

// Nothing about a working draft reaches anybody who may not edit the document: not the lists,
// the history, search, counts, statistics, skills or the MCP server.
func TestAWorkingDraftGivesNothingAway(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	e := setup(t, withSearch(t, f))
	const secret = "Zanzibar merger codename"
	j := e.as(jordan)
	j.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project", secret))
	status, body := j.do("PUT", "/api/standards/"+iac+"/draft?rev=0", e.body(docs.Standard, iac, `"title": "`, `"title": "`+secret+` `))
	wantStatus(t, status, 200, body)
	e.as(sam).view(docs.Process, gcp)
	time.Sleep(100 * time.Millisecond) // the index would follow a save within this time

	leaks := func(who, what string, raw []byte) {
		t.Helper()
		if strings.Contains(string(raw), "Zanzibar") || (who != dana && strings.Contains(string(raw), `"draft":{`)) {
			t.Errorf("%s: %s gives the working draft away: %s", who, what, raw)
		}
	}
	for _, who := range []string{sam, casey, riley, dana} {
		c := e.as(who)
		for _, path := range []string{
			"/api/processes", "/api/standards", "/api/history/process/" + gcp, "/api/history/standard/" + iac,
			fmt.Sprintf("/api/history/process/%s/%d", gcp, e.version(docs.Process, gcp).Version),
			"/api/search?q=" + url.QueryEscape(secret), "/api/search?q=Zanzibar", "/api/engagement", "/api/feedback", "/api/skills",
			"/api/skills/process-" + gcp, "/api/admin/statistics", "/api/admin/audit",
		} {
			status, raw, _ := c.raw("GET", path, nil, false)
			if status >= 500 {
				t.Errorf("%s %s: %d", who, path, status)
			}
			leaks(who, path, raw)
		}
	}
	// what an admin sees in the lists is the published version too
	_, raw, _ := e.as(dana).raw("GET", "/api/processes", nil, false)
	leaks(sam, "the list of an admin", []byte(strings.ReplaceAll(string(raw), `"draft":{`, "")))

	// the MCP server reads the published documents only
	srv, err := mcpserver.New(mcpserver.Options{Docs: e.deps.Docs, Skills: e.deps.Skills, Feedback: e.deps.Feedback, Roles: e.deps.Roles})
	must(t, err)
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).
		Connect(context.Background(), &mcp.StreamableClientTransport{Endpoint: ts.URL + "/mcp", DisableStandaloneSSE: true, MaxRetries: -1}, nil)
	must(t, err)
	t.Cleanup(func() { _ = cs.Close() })
	for _, call := range []struct {
		tool string
		args map[string]any
	}{
		{"get_process", map[string]any{"id": gcp}}, {"get_standard", map[string]any{"id": iac}},
		{"get_my_steps", map[string]any{"id": gcp}}, {"get_skill", map[string]any{"id": "process-" + gcp}},
		{"search_processes", map[string]any{"query": secret}}, {"search_standards", map[string]any{"query": "Zanzibar"}},
	} {
		res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: call.tool, Arguments: call.args})
		must(t, err)
		data, _ := json.Marshal(res)
		if res.IsError || strings.Contains(string(data), "Zanzibar") {
			t.Errorf("%s: %s", call.tool, data)
		}
	}
}
