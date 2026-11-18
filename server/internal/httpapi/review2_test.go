package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
)

// asDraft returns the current text of a document with its status set to draft and a title
// nobody outside its editors should ever read.
func (e *env) asDraft(kind, id, secretTitle string) string {
	body := e.body(kind, id, "", "")
	var head struct{ Title string }
	_ = json.Unmarshal([]byte(body), &head)
	body = strings.Replace(body, `"title": "`+head.Title+`"`, `"title": "`+secretTitle+`"`, 1)
	if strings.Contains(body, `"status": "active"`) {
		return strings.Replace(body, `"status": "active"`, `"status": "draft"`, 1)
	}
	return strings.Replace(body, `"title":`, `"status": "draft", "title":`, 1)
}

func TestADraftGivesNothingAwayThroughOtherDoors(t *testing.T) {
	e := setup(t, nil)
	const secret = "SECRET REORG OF TEAM X"
	const sub = "raise-servicenow-request" // a sub-process of the GCP process
	item := e.as(sam).report(docs.Process, sub, "", "Reported while it was published")
	status, body := e.as(alex).do("PUT", "/api/processes/"+sub+"?note="+url.QueryEscape("DRAFT NOTE about the reorg"), e.asDraft(docs.Process, sub, secret))
	wantStatus(t, status, 200, body)

	// the skills of the processes that use it are for everyone: they name the draft by its id only
	for _, id := range []string{"process-" + gcp} {
		content, err := e.deps.Skills.Content(bg, id, 0)
		must(t, err)
		if strings.Contains(content, secret) || !strings.Contains(content, "“"+sub+"”") {
			t.Errorf("%s gives the title of the draft away, or lost the reference:\n%s", id, content)
		}
	}
	// "I hit this too" on feedback of the draft, by its id
	for _, method := range []string{"POST", "DELETE"} {
		status, body := e.as(riley).do(method, "/api/feedback/"+item["id"].(string)+"/also-hit", nil)
		if status != 404 || strings.Contains(strings.Join(mapValues(body), " "), "Reported while") {
			t.Errorf("%s also-hit on a hidden draft: %d %v", method, status, body)
		}
	}
	// deleting it looks the same as deleting something that never existed
	if status, _ := e.as(sam).do("DELETE", "/api/processes/"+sub, nil); status != 404 {
		t.Errorf("a reader deleting a draft: %d", status)
	}
	if status, _ := e.as(sam).do("DELETE", "/api/processes/never-existed", nil); status != 404 {
		t.Errorf("a reader deleting nothing: %d", status)
	}

	// published again: the version that was a draft is not in the list of versions for readers
	status, body = e.as(alex).do("PUT", "/api/processes/"+sub, e.body(docs.Process, sub, `"status": "draft"`, `"status": "active"`))
	wantStatus(t, status, 200, body)
	_, h := e.as(sam).do("GET", "/api/history/process/"+sub, nil)
	var seen []float64
	for _, v := range h["versions"].([]any) {
		row := v.(map[string]any)
		seen = append(seen, row["version"].(float64))
		if strings.Contains(row["note"].(string), "DRAFT NOTE") {
			t.Errorf("the note of a draft version is shown to a reader: %v", row)
		}
	}
	if len(seen) != 2 || seen[0] != 3 || seen[1] != 1 {
		t.Errorf("a reader sees versions %v, want 3 and 1", seen)
	}
	_, h = e.as(alex).do("GET", "/api/history/process/"+sub, nil)
	if len(h["versions"].([]any)) != 3 {
		t.Errorf("the editor sees %d versions", len(h["versions"].([]any)))
	}
}

func TestStillInUseSaysOnlyWhatTheCallerMayKnow(t *testing.T) {
	e := setup(t, nil)
	const secret = "SECRET DRAFT STANDARD"
	status, body := e.as(riley).do("PUT", "/api/standards/"+logging, e.asDraft(docs.Standard, logging, secret))
	wantStatus(t, status, 200, body)
	// alex manages the lists but cannot see the drafts of Cyber Security, nor who has which role
	without := strings.Replace(e.body(docs.Catalog, docs.CatalogID, "", ""), `"id": "security"`, `"id": "security-renamed"`, 1)
	status, body = e.as(alex).do("PUT", "/api/catalog", without)
	msg, _ := body["error"].(string)
	if status != 400 || !strings.Contains(msg, "still used by") || strings.Contains(msg, secret) || strings.Contains(msg, riley) ||
		!strings.Contains(msg, "a draft you cannot see") || !strings.Contains(msg, "roles that are limited to it") {
		t.Fatalf("as a lists manager: %d %q", status, msg)
	}
	// an admin may see both, and each person once
	status, body = e.as(dana).do("PUT", "/api/catalog", without)
	msg, _ = body["error"].(string)
	if status != 400 || !strings.Contains(msg, secret) || strings.Count(msg, riley) != 1 {
		t.Fatalf("as an admin: %d %q", status, msg)
	}
}

func TestSkillsFollowASaveEvenWhenTheClientIsGone(t *testing.T) {
	e := setup(t, nil)
	a := &api{Deps: e.deps}
	_, _, err := e.deps.Docs.Put(bg, docs.Process, repoP, []byte(e.body(docs.Process, repoP, "Request a repository", "Get a repository")), alex)
	must(t, err)
	gone, cancel := context.WithCancel(bg)
	cancel() // the browser closed the connection right after the save
	a.syncSkills(gone, docs.Process, repoP)
	own, _ := e.deps.Skills.Content(bg, "process-"+repoP, 0)
	other, _ := e.deps.Skills.Content(bg, "process-"+gcp, 0)
	if !strings.Contains(own, "# Process: Get a repository") || !strings.Contains(other, "“Get a repository”") {
		t.Fatalf("skills not regenerated: %s", e.logged.String())
	}
}

func TestTextThatCannotBeStoredIsRefusedNotAnError(t *testing.T) {
	e := setup(t, nil)
	editor := e.as(alex)
	for name, path := range map[string]string{"a NUL in the note": "?note=%00", "a note that is not text": "?note=%ff%fe"} {
		status, body := editor.do("PUT", "/api/processes/"+repoP+path, e.body(docs.Process, repoP, "Request a repository", "Request a repo"))
		wantStatus(t, status, 400, name+": "+strings.Join(mapValues(body), " "))
	}
	status, body := editor.do("PUT", "/api/processes/"+repoP, strings.Replace(e.body(docs.Process, repoP, "", ""), "Request a repository", "Request a \xff repository", 1))
	wantStatus(t, status, 400, body)
	status, body = e.as(sam).do("POST", "/api/feedback", map[string]string{"targetKind": docs.Process, "targetId": gcp, "kind": "broken", "text": "broken\x00here"})
	wantStatus(t, status, 400, body)
	status, body = e.as(dana).do("POST", "/api/admin/access", map[string]string{"email": "a\x00b@example.com", "role": "process-editor"})
	wantStatus(t, status, 400, body)
}

func TestAnEndedSessionCannotSignThePersonOutAgain(t *testing.T) {
	e := setup(t, nil)
	first := e.as(dana)
	base, _ := url.Parse(e.srv.URL)
	jar, _ := cookiejar.New(nil)
	jar.SetCookies(base, first.http.Jar.Cookies(base))
	copyOfFirst := &client{e: e, http: &http.Client{Jar: jar}}

	status, _ := first.do("POST", "/auth/logout", nil)
	wantStatus(t, status, 200, nil)
	// signing in again straight away works: the new session is dated after the sign-out
	second := e.as(dana)
	if status, _ := second.do("GET", "/api/admin/access", nil); status != 200 {
		t.Fatalf("the session right after a sign-out: %d", status)
	}
	// whoever holds the old cookie can neither use it nor end the new session with it
	if status, _ := copyOfFirst.do("GET", "/api/admin/access", nil); status != 401 {
		t.Fatalf("the ended copy: %d", status)
	}
	status, _ = copyOfFirst.do("POST", "/auth/logout", nil)
	wantStatus(t, status, 200, nil)
	if status, _ := second.do("GET", "/api/admin/access", nil); status != 200 {
		t.Fatalf("the new session after the ended copy signed out: %d", status)
	}
}

func TestSigningInRightAfterSigningOutEvenInTheSameMoment(t *testing.T) {
	// the clock of the server stands still: sign-in, sign-out and sign-in again in one instant
	now := time.Now()
	e := setup(t, func(d *Deps) { d.Sessions.Now = func() time.Time { return now } })
	c := e.as(sam)
	status, _ := c.do("POST", "/auth/logout", nil)
	wantStatus(t, status, 200, nil)
	again := e.as(sam)
	if status, _ := again.do("GET", "/api/processes", nil); status != 200 {
		t.Fatalf("signed in again in the same moment: %d", status)
	}
}

func TestAnOutageIsNotShownAsSignedOut(t *testing.T) {
	broken := dbtest.NewPool(t)
	e := setup(t, nil)
	c := e.as(sam)
	e.deps.SignOuts.Pool = broken
	broken.Close() // the database is gone
	status, body := c.do("GET", "/api/processes", nil)
	if status != 503 || !strings.Contains(body["error"].(string), "database") {
		t.Fatalf("content during an outage: %d %v", status, body)
	}
	if status, _ := c.do("GET", "/api/me", nil); status != 503 {
		t.Fatalf("who-am-I during an outage: %d", status)
	}
	// signing out says that the other sessions could not be ended, and signing in says "later"
	status, body = c.do("POST", "/auth/logout", nil)
	if status != 503 || !strings.Contains(body["error"].(string), "could not be ended") {
		t.Fatalf("sign-out during an outage: %d %v", status, body)
	}
	if status, _ := e.anonymous().do("POST", "/auth/dev/login", map[string]string{"email": sam}); status != 503 {
		t.Fatalf("sign-in during an outage: %d", status)
	}
}

func TestTheWholeActivityLogCanBeAskedForAtOnce(t *testing.T) {
	e := setup(t, nil)
	for i := 0; i < 120; i++ {
		must(t, e.deps.Audit.Add(bg, "x@example.com", "X", "process.save", "p", ""))
	}
	_, body := e.as(dana).do("GET", "/api/admin/audit?limit=500", nil)
	if n := len(body["entries"].([]any)); n != 120 || body["more"] != false {
		t.Fatalf("%d entries, more=%v", n, body["more"])
	}
}

func TestAFailedSignInDoesNotPutTheProvidersAnswerInTheAddress(t *testing.T) {
	if got := auth.PublicMessage(context.DeadlineExceeded); strings.Contains(got, "deadline") {
		t.Fatalf("an unknown error is shown as is: %q", got)
	}
}

func mapValues(m map[string]any) []string {
	out := []string{}
	for _, v := range m {
		out = append(out, fmt.Sprint(v))
	}
	return out
}
