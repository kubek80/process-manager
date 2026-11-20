package httpapi

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

// teamDraft creates a never-published process of the cloud-platform-team on the platform github:
// casey and jordan (owners for the team) see it but may not edit it; riley and sam do not see it.
// It returns its id and the body.
func (e *env) teamDraft(id string) string {
	e.t.Helper()
	body := e.body(docs.Process, repoP, `"id": "`+repoP+`"`, `"id": "`+id+`"`)
	body = strings.Replace(body, `"owner": "developer-experience-team"`, `"owner": "cloud-platform-team"`, 1)
	if strings.Contains(body, `"status": "active"`) {
		body = strings.Replace(body, `"status": "active"`, `"status": "draft"`, 1)
	} else {
		body = strings.Replace(body, `"title":`, `"status": "draft", "title":`, 1)
	}
	status, out := e.as(alex).do("PUT", "/api/processes/"+id+"?base=0", body)
	wantStatus(e.t, status, 200, out)
	return body
}

// retitled is the stored document with another title, its status as it is.
func (e *env) retitled(kind, id, title string) string {
	e.t.Helper()
	body := e.body(kind, id, "", "")
	var head struct{ Title string }
	_ = json.Unmarshal([]byte(body), &head)
	return strings.Replace(body, `"title": "`+head.Title+`"`, `"title": "`+title+`"`, 1)
}

func latestAudit(e *env) (string, string) {
	entries, _ := e.deps.Audit.Recent(bg, 1)
	return entries[0].Action, entries[0].Detail
}

func TestADraftNobodyMaySeeAnswersLikeNothingOnEverySavePath(t *testing.T) {
	e := setup(t, nil)
	const hidden, unknown = "team-secret-plan", "no-such-plan"
	body := e.teamDraft(hidden)
	e.as(alex).startDraft(docs.Process, hidden, body)
	as := func(id, b string) string { return strings.Replace(b, `"id": "`+hidden+`"`, `"id": "`+id+`"`, 1) }
	// riley may edit what is in the practice security: a body riley may save
	rileys := strings.Replace(body, `"platform": "github",`, `"platform": "github", "practice": "security",`, 1)
	for _, c := range []struct {
		who, body string
	}{{sam, body}, {riley, rileys}, {riley, body}} {
		for _, q := range []string{"?base=1&draft=1", "?base=0&draft=1", "?base=1", "?base=7"} {
			s1, b1 := e.as(c.who).do("PUT", "/api/processes/"+hidden+q, as(hidden, c.body))
			s2, b2 := e.as(c.who).do("PUT", "/api/processes/"+unknown+q, as(unknown, c.body))
			if s1 != s2 || b1["error"] != b2["error"] || fmt.Sprint(b1["conflict"]) != fmt.Sprint(b2["conflict"]) {
				t.Errorf("%s %s: hidden %d %v, nothing %d %v", c.who, q, s1, b1, s2, b2)
			}
		}
	}
	// creating under the id: that it is taken cannot be hidden, but nothing more is said
	status, out := e.as(riley).do("PUT", "/api/processes/"+hidden+"?base=0", strings.Replace(rileys, `"platform": "github", `, "", 1))
	wantError(t, status, out, 409, "Something else already has this id. Give the process another name.")
	// casey and jordan see it but may not edit it: the answer for any document they may not change
	for _, who := range []string{casey, jordan} {
		for _, q := range []string{"?base=1&draft=1", "?base=1"} {
			status, out := e.as(who).do("PUT", "/api/processes/"+hidden+q, body)
			if status != 403 {
				t.Errorf("%s %s: %d %v", who, q, status, out)
			}
		}
	}
	if d := e.version(docs.Process, hidden); d.Version != 1 {
		t.Fatalf("changed: %d", d.Version)
	}
	if _, err := e.deps.Docs.GetDraft(bg, docs.Process, hidden); err != nil {
		t.Fatalf("the working draft went: %v", err)
	}
	// deleted: who did it is said only to somebody who could edit it and names a version of it
	status, out = e.as(alex).do("DELETE", "/api/processes/"+hidden+"?base=1", nil)
	wantStatus(t, status, 200, out)
	jordans := strings.Replace(body, `"platform": "github"`, `"platform": "google-cloud"`, 1)
	status, out = e.as(jordan).do("PUT", "/api/processes/"+hidden+"?base=1", jordans)
	wantError(t, status, out, 409, "This was deleted by someone else while you were working on it.")
	if c := out["conflict"].(map[string]any); c["deletedBy"] != nil {
		t.Fatalf("told jordan: %v", c)
	}
	// alex, without a version of it: nothing about who
	status, out = e.as(alex).do("PUT", "/api/processes/"+hidden+"/draft?rev=1", body)
	wantError(t, status, out, 404, "That does not exist.")
	status, out = e.as(alex).do("PUT", "/api/processes/"+hidden+"/draft?rev=1&known=1", body)
	wantError(t, status, out, 409, "Alex Editor deleted this process while you were working on it.")
	// created again under the id: the old working draft is gone
	status, out = e.as(alex).do("PUT", "/api/processes/"+hidden+"?base=0", body)
	wantStatus(t, status, 200, out)
	if status, _ := e.as(alex).do("GET", "/api/processes/"+hidden+"/draft", nil); status != 204 {
		t.Fatalf("an old draft came back: %d", status)
	}
}

func TestWhatASaveFromTheWorkingDraftSays(t *testing.T) {
	e := setup(t, withSearch(t, &flaky{Embedder: embedding.Builtin(768)}))
	a := e.as(alex)
	path := "/api/processes/" + gcp
	// a published document without a working draft: published, not "discarded"
	status, out := a.do("PUT", path+"?base=1&draft=1", e.body(docs.Process, gcp, "", ""))
	wantError(t, status, out, 409, "This process is published: its unpublished changes are published with Publish, not saved over it.")

	const id = "plan-from-draft"
	body := e.teamDraft(id)
	p := "/api/processes/" + id
	// a never-published document is never retired directly, on any save path
	retired := strings.Replace(body, `"status": "draft"`, `"status": "deprecated"`, 1)
	want := "A process that readers do not see cannot be retired. Publish it first, or delete it."
	status, out = a.do("PUT", p+"?base=1", retired)
	wantError(t, status, out, 400, want)
	a.startDraft(docs.Process, id, body)
	status, out = a.do("PUT", p+"?base=1&draft=1", retired)
	wantError(t, status, out, 400, want)

	// a save with the stored body in place of the working draft: no version, but logged
	status, out = a.do("PUT", p+"?base=1&draft=1", body)
	wantStatus(t, status, 200, out)
	if out["changed"] != false || e.version(docs.Process, id).Version != 1 {
		t.Fatalf("unchanged: %v", out)
	}
	if action, detail := latestAudit(e); action != "process.discard" || !strings.Contains(detail, "replaced by the process as it is stored (version 1): nothing changed") {
		t.Fatalf("audit: %s %s", action, detail)
	}
	// discarding a never-published document's draft: true words
	a.startDraft(docs.Process, id, strings.Replace(body, "Request a repository", "Plan, unfinished", 1))
	status, out = a.do("DELETE", p+"/draft?rev=1", nil)
	wantStatus(t, status, 204, out)
	if action, detail := latestAudit(e); action != "process.discard" || detail != "changes kept in its draft, last saved by alex@example.com; the process stays as stored in version 1, which readers do not see" {
		t.Fatalf("audit: %s %s", action, detail)
	}
	// after a discard, a replace is told so
	status, out = a.do("PUT", p+"?base=1&draft=1", strings.Replace(body, "Request a repository", "Plan, finished", 1))
	wantError(t, status, out, 409, "The newer changes kept in this draft were discarded by someone else while you were working on them.")
	// a second tab replacing what the first already saved as the document: who saved which version
	a.startDraft(docs.Process, id, strings.Replace(body, "Request a repository", "Plan, unfinished", 1))
	status, out = a.do("PUT", p+"?base=1&draft=1", strings.Replace(body, "Request a repository", "Plan, finished", 1))
	wantStatus(t, status, 200, out)
	status, out = a.do("PUT", p+"?base=1&draft=1", strings.Replace(body, "Request a repository", "Plan, other tab", 1))
	wantError(t, status, out, 409, "Alex Editor saved a newer version (version 2) while you were working on this.")

	// the first publication through a save from the working draft: logged as one; skills and
	// search follow
	a.startDraft(docs.Process, id, strings.Replace(body, "Request a repository", "Plan, unfinished again", 1))
	published := strings.Replace(strings.Replace(body, "Request a repository", "Zebrafinch onboarding plan", 1), `"status": "draft"`, `"status": "active"`, 1)
	status, out = a.do("PUT", p+"?base=2&draft=1&note=First", published)
	wantStatus(t, status, 200, out)
	if action, detail := latestAudit(e); action != "process.publish" || detail != "version 3: First" {
		t.Fatalf("audit: %s %s", action, detail)
	}
	content, err := e.deps.Skills.Content(bg, "process-"+id, 0)
	if err != nil || !strings.Contains(content, "Zebrafinch onboarding plan") {
		t.Fatalf("skill: %v", err)
	}
	time.Sleep(200 * time.Millisecond)
	_, found := e.as(sam).do("GET", "/api/search?q="+url.QueryEscape("Zebrafinch onboarding"), nil)
	if !strings.Contains(fmt.Sprint(found["results"]), id) {
		t.Fatalf("not found by meaning: %v", found)
	}
	// an ordinary first publication too
	other := e.teamDraft("plan-published-plainly")
	status, out = a.do("PUT", "/api/processes/plan-published-plainly?base=1", strings.Replace(other, `"status": "draft"`, `"status": "active"`, 1))
	wantStatus(t, status, 200, out)
	if action, _ := latestAudit(e); action != "process.publish" {
		t.Fatalf("audit: %s", action)
	}
}

func TestMoreWaysAroundANeverPublishedWorkingDraft(t *testing.T) {
	e := setup(t, nil)
	a, j := e.as(alex), e.as(jordan)

	// an import over a never-published document with a working draft: kept; publishing it meets
	// the newer version and goes over it when told to
	unpub := e.asDraft(docs.Process, gcp, "Request a GCP project")
	status, out := a.do("PUT", "/api/processes/"+gcp+"?base=1", unpub)
	wantStatus(t, status, 200, out)
	a.startDraft(docs.Process, gcp, strings.Replace(unpub, "Request a GCP project", "From the draft", 1))
	if _, _, err := e.deps.Docs.Put(bg, docs.Process, gcp, []byte(strings.Replace(unpub, "Request a GCP project", "Imported", 1)), "import"); err != nil {
		t.Fatal(err)
	}
	status, out = a.do("POST", "/api/processes/"+gcp+"/publish?rev=1", nil)
	if c, _ := out["conflict"].(map[string]any); status != 409 || num(c["version"]) != 3 {
		t.Fatalf("publish over an import: %d %v", status, out)
	}
	status, out = a.do("POST", "/api/processes/"+gcp+"/publish?rev=1&over=3", nil)
	wantStatus(t, status, 200, out)
	d := e.version(docs.Process, gcp)
	if docs.StatusOf(d.Body) != "active" || !strings.Contains(string(d.Body), "From the draft") {
		t.Fatalf("published: %s", d.Body)
	}
	// unpublished again, a working draft, published again: the review record stays
	status, out = a.do("PUT", fmt.Sprintf("/api/processes/%s?base=%d", gcp, d.Version), e.asDraft(docs.Process, gcp, "From the draft"))
	wantStatus(t, status, 200, out)
	noReview := e.body(docs.Process, gcp, `"lastReviewedAt": "2026-11-03"`, `"lastReviewedAt": "2020-01-01"`)
	a.startDraft(docs.Process, gcp, strings.Replace(noReview, "From the draft", "Again", 1))
	status, out = a.do("POST", "/api/processes/"+gcp+"/publish?rev=1", nil)
	wantStatus(t, status, 200, out)
	if d := e.version(docs.Process, gcp); docs.StatusOf(d.Body) != "active" || !strings.Contains(string(d.Body), `"lastReviewedAt": "2026-11-03"`) || !strings.Contains(string(d.Body), "Again") {
		t.Fatalf("published again: %s", d.Body)
	}
	if action, _ := latestAudit(e); action != "process.publish" {
		t.Fatalf("audit: %s", action)
	}

	// moving it off jordan's platform: not through a save from the working draft, not through
	// publishing it
	v := e.version(docs.Process, gcp).Version
	status, out = a.do("PUT", fmt.Sprintf("/api/processes/%s?base=%d", gcp, v), e.asDraft(docs.Process, gcp, "Again"))
	wantStatus(t, status, 200, out)
	v++
	j.startDraft(docs.Process, gcp, e.body(docs.Process, gcp, "Again", "Jordan's"))
	moved := e.body(docs.Process, gcp, `"platform": "google-cloud"`, `"platform": "github"`)
	status, out = j.do("PUT", fmt.Sprintf("/api/processes/%s?base=%d&draft=1", gcp, v), moved)
	wantError(t, status, out, 403, notYoursFor("process"))
	status, out = a.do("PUT", "/api/processes/"+gcp+"/draft?rev=1", moved)
	wantStatus(t, status, 200, out)
	status, out = j.do("POST", "/api/processes/"+gcp+"/publish?rev=2", nil)
	wantError(t, status, out, 403, notYoursFor("process"))

	// a save from the working draft racing a save of the draft: exactly one of them wins
	for round := 0; round < 5; round++ {
		cur := e.version(docs.Process, gcp)
		wd, err := e.deps.Docs.GetDraft(bg, docs.Process, gcp)
		if err != nil {
			wd, err = e.deps.Docs.SaveDraft(bg, docs.DraftChange{Kind: docs.Process, ID: gcp, Body: cur.Body, By: alex})
			must(t, err)
		}
		var wg sync.WaitGroup
		var replace, draft int
		wg.Add(2)
		go func() {
			defer wg.Done()
			replace, _ = a.do("PUT", fmt.Sprintf("/api/processes/%s?base=%d&draft=%d", gcp, cur.Version, wd.Revision), e.retitled(docs.Process, gcp, fmt.Sprintf("Round %d", round)))
		}()
		go func() {
			defer wg.Done()
			draft, _ = e.as(dana).do("PUT", fmt.Sprintf("/api/processes/%s/draft?rev=%d", gcp, wd.Revision), e.retitled(docs.Process, gcp, fmt.Sprintf("Draft %d", round)))
		}()
		wg.Wait()
		if (replace == 200) == (draft == 200) || replace+draft != 609 {
			t.Fatalf("round %d: replace %d, draft %d", round, replace, draft)
		}
	}
	// against publish and delete
	cur := e.version(docs.Process, gcp)
	wd, err := e.deps.Docs.GetDraft(bg, docs.Process, gcp)
	if err != nil {
		wd, err = e.deps.Docs.SaveDraft(bg, docs.DraftChange{Kind: docs.Process, ID: gcp, Body: cur.Body, By: alex})
		must(t, err)
	}
	status, out = e.as(dana).do("POST", fmt.Sprintf("/api/processes/%s/publish?rev=%d", gcp, wd.Revision), nil)
	wantStatus(t, status, 200, out)
	status, out = a.do("PUT", fmt.Sprintf("/api/processes/%s?base=%d&draft=%d", gcp, cur.Version, wd.Revision), e.asDraft(docs.Process, gcp, "Late"))
	wantError(t, status, out, 409, "This process is published: its unpublished changes are published with Publish, not saved over it.")
	cur = e.version(docs.Process, gcp)
	status, out = a.do("PUT", fmt.Sprintf("/api/processes/%s?base=%d", gcp, cur.Version), e.asDraft(docs.Process, gcp, "Hidden again"))
	wantStatus(t, status, 200, out)
	last := e.retitled(docs.Process, gcp, "Unfinished")
	a.startDraft(docs.Process, gcp, last)
	status, out = e.as(dana).do("DELETE", fmt.Sprintf("/api/processes/%s?base=%d", gcp, cur.Version+1), nil)
	wantStatus(t, status, 200, out)
	status, out = a.do("PUT", fmt.Sprintf("/api/processes/%s?base=%d&draft=1", gcp, cur.Version+1), last)
	if c, _ := out["conflict"].(map[string]any); status != 409 || c["exists"] != false || c["deletedByName"] != "Dana Admin" {
		t.Fatalf("after a delete: %d %v", status, out)
	}
}
