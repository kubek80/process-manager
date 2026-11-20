package httpapi

import (
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

// unfinished is a never-published version of a document with what the checker refuses: an empty
// title, and a secret that must stay with its editors.
func (e *env) unfinished(kind, id, secret string) string {
	body := e.asDraft(kind, id, "")
	return strings.Replace(body, `"id": "`+id+`",`, `"id": "`+id+`", "description": "`+secret+`",`, 1)
}

func TestANeverPublishedDocumentKeepsWhatCannotBeSavedYet(t *testing.T) {
	f := &flaky{Embedder: embedding.Builtin(768)}
	e := setup(t, withSearch(t, f))
	a := e.as(alex)
	const secret = "Zanzibar merger codename"
	path := "/api/processes/" + gcp
	v := e.version(docs.Process, gcp).Version
	// alex takes it back from readers; then saves what cannot be the document itself yet
	status, body := a.do("PUT", fmt.Sprintf("%s?base=%d", path, v), e.asDraft(docs.Process, gcp, "Request a GCP project"))
	wantStatus(t, status, 200, body)
	v++
	status, body = a.do("PUT", fmt.Sprintf("%s/draft?rev=0&base=%d", path, v), e.unfinished(docs.Process, gcp, secret))
	wantStatus(t, status, 200, body)
	doc, _ := body["document"].(map[string]any)
	if num(body["revision"]) != 1 || num(body["base"]) != v || doc["status"] != "draft" || num(doc["version"]) != v || doc["updatedByName"] != "Alex Editor" {
		t.Fatalf("saved: %v", body)
	}
	if d := e.version(docs.Process, gcp); d.Version != v || strings.Contains(string(d.Body), "Zanzibar") {
		t.Fatalf("the document itself changed: %d", d.Version)
	}
	status, body = a.do("GET", path+"/draft", nil)
	if status != 200 || !strings.Contains(fmt.Sprint(body["doc"]), "Zanzibar") {
		t.Fatalf("read back: %d %v", status, body)
	}
	// the lists tell its editors; the owning team (casey) sees the document, not the draft
	_, list := a.do("GET", "/api/processes", nil)
	if m := list["meta"].(map[string]any)[gcp].(map[string]any); m["draft"] == nil || m["updatedByName"] != "Alex Editor" {
		t.Fatalf("meta for alex: %v", m)
	}
	_, list = e.as(casey).do("GET", "/api/processes", nil)
	if m, ok := list["meta"].(map[string]any)[gcp].(map[string]any); !ok || m["draft"] != nil {
		t.Fatalf("meta for casey: %v", m)
	}

	// nobody else learns anything of it: every call about the draft answers "does not exist"
	_, nothing := e.as(sam).do("GET", "/api/processes/never-existed/draft", nil)
	for _, who := range []string{sam, casey, riley} {
		c := e.as(who)
		for _, call := range []struct{ method, path string }{
			{"GET", path + "/draft"}, {"PUT", path + "/draft?rev=1"}, {"PUT", path + "/draft?rev=0"}, {"DELETE", path + "/draft?rev=1"},
			{"POST", path + "/publish?rev=1"},
		} {
			status, raw, _ := c.raw(call.method, call.path, e.body(docs.Process, gcp, "", ""), true)
			if status != 404 || !strings.Contains(string(raw), nothing["error"].(string)) || strings.Contains(string(raw), "Zanzibar") || strings.Contains(string(raw), alex) {
				t.Errorf("%s %s %s: %d %s", who, call.method, call.path, status, raw)
			}
		}
	}
	time.Sleep(100 * time.Millisecond) // the index would follow a save within this time
	for _, who := range []string{sam, casey, riley, dana, alex} {
		c := e.as(who)
		for _, p := range []string{
			"/api/processes", "/api/history/process/" + gcp, fmt.Sprintf("/api/history/process/%s/%d", gcp, v),
			"/api/search?q=" + url.QueryEscape(secret), "/api/search?q=Zanzibar", "/api/skills", "/api/skills/process-" + gcp, "/api/admin/statistics",
		} {
			status, raw, _ := c.raw("GET", p, nil, false)
			if status >= 500 || strings.Contains(string(raw), "Zanzibar") {
				t.Errorf("%s %s: %d %s", who, p, status, raw)
			}
		}
		if _, list := c.do("GET", "/api/processes", nil); who == sam || who == riley {
			if _, ok := list["meta"].(map[string]any)[gcp]; ok {
				t.Errorf("%s sees the never-published document", who)
			}
		}
	}

	// an ordinary save made without knowing of it: the draft conflict, by name
	j := e.as(jordan)
	fixed := e.asDraft(docs.Process, gcp, "Request a GCP project, finished")
	status, body = j.do("PUT", fmt.Sprintf("%s?base=%d", path, v), fixed)
	wantError(t, status, body, 409, "Alex Editor saved newer changes to this draft while you were working on it.")
	if c := body["conflict"].(map[string]any); c["draft"] != true || c["exists"] != true || num(c["version"]) != 1 || c["updatedByName"] != "Alex Editor" {
		t.Fatalf("conflict: %v", c)
	}
	// replacing it needs its revision and the version it came from
	for _, q := range []string{"0", "-1", "x"} {
		if status, _ := j.do("PUT", fmt.Sprintf("%s?base=%d&draft=%s", path, v, q), fixed); status != 400 {
			t.Errorf("draft=%s: %d", q, status)
		}
	}
	status, body = j.do("PUT", fmt.Sprintf("%s?base=%d&draft=2", path, v), fixed)
	wantError(t, status, body, 409, "Alex Editor saved newer unpublished changes while you were working on this.")
	status, body = j.do("PUT", fmt.Sprintf("%s?base=%d&draft=1", path, v-1), fixed)
	if c, _ := body["conflict"].(map[string]any); status != 409 || c["draft"] != nil || num(c["version"]) != v || c["status"] != "draft" {
		t.Fatalf("an older base: %d %v", status, body)
	}
	// somebody who may not edit it cannot replace it either
	if status, _ := e.as(sam).do("PUT", fmt.Sprintf("%s?base=%d&draft=1", path, v), fixed); status != 403 {
		t.Fatalf("sam replaced it: %d", status)
	}
	if _, err := e.deps.Docs.GetDraft(bg, docs.Process, gcp); err != nil {
		t.Fatalf("a refused save lost the draft: %v", err)
	}
	// with nothing left to fix it is saved as the document itself, in place of the draft
	status, body = j.do("PUT", fmt.Sprintf("%s?base=%d&draft=1", path, v), fixed)
	wantStatus(t, status, 200, body)
	v++
	if num(body["version"]) != v {
		t.Fatalf("replace: %v", body)
	}
	if d := e.version(docs.Process, gcp); docs.StatusOf(d.Body) != "draft" || !strings.Contains(string(d.Body), "Request a GCP project, finished") {
		t.Fatalf("stored: %s", d.Body)
	}
	if status, _ := j.do("GET", path+"/draft", nil); status != 204 {
		t.Fatalf("the draft is still there: %d", status)
	}
	if entries, _ := e.deps.Audit.Recent(bg, 1); entries[0].Action != "process.save" || entries[0].Email != jordan {
		t.Fatalf("audit: %+v", entries[0])
	}

	// publishing a working draft of a never-published document makes it active
	status, body = a.do("PUT", fmt.Sprintf("%s/draft?rev=0&base=%d", path, v), e.asDraft(docs.Process, gcp, "Request a GCP project, published"))
	wantStatus(t, status, 200, body)
	status, body = a.do("POST", path+"/publish?rev=1&note=First", nil)
	wantStatus(t, status, 200, body)
	if d := e.version(docs.Process, gcp); d.Version != v+1 || docs.StatusOf(d.Body) != "active" || !strings.Contains(string(d.Body), "Request a GCP project, published") {
		t.Fatalf("published: %d %s", d.Version, d.Body)
	}
	if status, _ := a.do("GET", path+"/draft", nil); status != 204 {
		t.Fatalf("the draft is still there: %d", status)
	}

	// a published document's unpublished changes are published, never replaced by a save
	v = e.version(docs.Process, gcp).Version
	a.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Request a GCP project, published", "Request a GCP project, again"))
	status, body = a.do("PUT", fmt.Sprintf("%s?base=%d&draft=1", path, v), e.body(docs.Process, gcp, "", ""))
	wantError(t, status, body, 409, "This process is published: its unpublished changes are published with Publish, not saved over it.")
}

func TestWhoDeletedOrRetiredItIsSaid(t *testing.T) {
	e := setup(t, nil)
	a, d := e.as(alex), e.as(dana)
	path := "/api/processes/" + repoP
	v := e.version(docs.Process, repoP).Version
	// dana retires it while alex edits; alex's next save of the draft says so
	status, body := d.do("PUT", fmt.Sprintf("%s?base=%d", path, v), e.body(docs.Process, repoP, `"status": "active"`, `"status": "deprecated"`))
	wantStatus(t, status, 200, body)
	status, body = a.do("PUT", fmt.Sprintf("%s/draft?rev=0&base=%d", path, v), e.body(docs.Process, repoP, "Request a repository", "Request a repo"))
	wantStatus(t, status, 200, body)
	if doc := body["document"].(map[string]any); doc["status"] != "deprecated" || num(doc["version"]) != v+1 || doc["updatedBy"] != dana || doc["updatedByName"] != "Dana Admin" {
		t.Fatalf("document: %v", doc)
	}
	// publishing meets the conflict, with her name and the status
	status, body = a.do("POST", path+"/publish?rev=1", nil)
	wantError(t, status, body, 409, fmt.Sprintf("Dana Admin saved a newer version (version %d) while you were working on this.", v+1))
	if c := body["conflict"].(map[string]any); c["status"] != "deprecated" || c["updatedByName"] != "Dana Admin" {
		t.Fatalf("conflict: %v", c)
	}
	// she deletes it: saving says who did it, to those who could edit it
	mine := e.body(docs.Process, repoP, "Request a repository", "Request a repo")
	status, body = d.do("DELETE", fmt.Sprintf("%s?base=%d", path, v+1), nil)
	wantStatus(t, status, 200, body)
	for _, call := range []string{fmt.Sprintf("%s/draft?rev=1&known=%d", path, v+1), fmt.Sprintf("%s?base=%d", path, v+1)} {
		status, body = a.do("PUT", call, mine)
		wantError(t, status, body, 409, "Dana Admin deleted this process while you were working on it.")
		if c := body["conflict"].(map[string]any); c["exists"] != false || c["deletedBy"] != dana || c["deletedByName"] != "Dana Admin" || c["deletedAt"] == nil {
			t.Fatalf("%s: %v", call, c)
		}
	}
	// a reader learns nothing
	status, body = e.as(sam).do("PUT", path+"/draft?rev=0", mine)
	wantError(t, status, body, 404, "That does not exist.")
	if strings.Contains(fmt.Sprint(body), "Dana") {
		t.Fatalf("told a reader: %v", body)
	}
}
