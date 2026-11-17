package httpapi

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

func (c *client) request(kind, title, platform, practice string) map[string]any {
	c.e.t.Helper()
	status, body := c.do("POST", "/api/requests", map[string]string{"kind": kind, "title": title,
		"description": "We need this because nobody knows how it works.", "platform": platform, "practice": practice})
	if status != 201 {
		c.e.t.Fatalf("request: %d %v", status, body)
	}
	return body
}

func (c *client) requests() []map[string]any {
	c.e.t.Helper()
	status, raw, _ := c.raw("GET", "/api/requests", nil, false)
	if status != 200 {
		c.e.t.Fatalf("requests: %d %s", status, raw)
	}
	var out struct{ Requests []map[string]any }
	must(c.e.t, json.Unmarshal(raw, &out))
	if out.Requests == nil {
		c.e.t.Fatalf("null list: %s", raw)
	}
	return out.Requests
}

func path(q map[string]any, rest string) string {
	return fmt.Sprintf("/api/requests/%v%s", q["id"], rest)
}

func TestAnyoneCanRequestAndEveryoneSeesIt(t *testing.T) {
	e := setup(t, nil)
	q := e.as(sam).request(docs.Process, "  Get a Kubernetes namespace  ", "google-cloud", "")
	want := map[string]any{"kind": "process", "title": "Get a Kubernetes namespace", "platform": "google-cloud", "practice": "",
		"state": "open", "stateNote": "", "stateBy": "", "stateAt": "", "linkedId": "", "votes": float64(0), "votedByMe": false, "mine": true, "canManage": false}
	for k, v := range want {
		if q[k] != v {
			t.Errorf("%s: %v, want %v", k, q[k], v)
		}
	}
	if by := q["requestedBy"].(map[string]any); by["email"] != sam || by["name"] != "Sam Consumer" || q["createdAt"] == "" {
		t.Errorf("requestedBy: %v", q)
	}
	e.as(alex).request(docs.Standard, "Naming of cloud resources", "", "engineering")
	list := e.as(riley).requests()
	if len(list) != 2 || list[0]["title"] != "Naming of cloud resources" || list[1]["mine"] != false {
		t.Fatalf("newest first, as riley sees it: %v", list)
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "request.create" || entries[0].Detail != "Asked for a standard: “Naming of cloud resources”" {
		t.Fatalf("audit: %+v", entries[0])
	}
}

func TestARequestIsChecked(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	ok := map[string]string{"kind": "process", "title": "A good title", "description": "What is needed and why."}
	with := func(k, v string) map[string]string {
		out := map[string]string{}
		for a, b := range ok {
			out[a] = b
		}
		out[k] = v
		return out
	}
	for _, c := range []struct {
		body map[string]string
		want string
	}{
		{with("kind", "catalog"), "Say whether a process or a standard is requested."},
		{with("title", "Four"), "Give the request a title of 5 to 120 characters."},
		{with("title", strings.Repeat("x", 121)), "Give the request a title of 5 to 120 characters."},
		{with("description", "Too short"), "Describe what is needed and why in 10 to 1000 characters."},
		{with("description", strings.Repeat("y", 1001)), "Describe what is needed and why in 10 to 1000 characters."},
		{with("title", "Bad \x00 title"), "The text contains characters that cannot be stored."},
		{with("platform", "mars"), "There is no platform “mars” in the lists."},
		{with("practice", "alchemy"), "There is no practice “alchemy” in the lists."},
	} {
		status, body := s.do("POST", "/api/requests", c.body)
		wantError(t, status, body, 400, c.want)
	}
	if len(s.requests()) != 0 {
		t.Fatal("nothing should have been stored")
	}
}

func TestOnePersonCannotFloodTheRequests(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	for i := 0; i < maxRequestsPerHour; i++ {
		s.request(docs.Process, fmt.Sprintf("Request number %d", i), "", "")
	}
	status, body := s.do("POST", "/api/requests", map[string]string{"kind": "process", "title": "One too many", "description": "Yet another request."})
	wantError(t, status, body, 429, "You have made a lot of requests in the last hour. Please try again later.")
	e.as(alex).request(docs.Process, "Somebody else is not held back", "", "")
}

func TestVotesAreOnePerPerson(t *testing.T) {
	e := setup(t, nil)
	q := e.as(sam).request(docs.Process, "Get a Kubernetes namespace", "", "")
	vote := func(who, method string, want int) {
		t.Helper()
		status, body := e.as(who).do(method, path(q, "/vote"), nil)
		if status != 200 || body["votes"] != float64(want) {
			t.Fatalf("%s %s: %d %v, want %d", who, method, status, body, want)
		}
	}
	vote(alex, "PUT", 1)
	vote(alex, "PUT", 1)
	vote(riley, "PUT", 2)
	vote(alex, "DELETE", 1)
	list := e.as(riley).requests()
	if list[0]["votes"] != float64(1) || list[0]["votedByMe"] != true {
		t.Fatalf("riley: %v", list[0])
	}
	if e.as(alex).requests()[0]["votedByMe"] != false {
		t.Fatal("alex took the vote back")
	}
	for _, p := range []string{"/api/requests/999/vote", "/api/requests/x/vote", "/api/requests/-1/vote"} {
		status, body := e.as(sam).do("PUT", p, nil)
		wantError(t, status, body, 404, "That request does not exist.")
	}
}

func TestWhoMayChangeTheStateOfARequest(t *testing.T) {
	e := setup(t, nil)
	process := e.as(sam).request(docs.Process, "Get a Kubernetes namespace", "google-cloud", "")
	standard := e.as(sam).request(docs.Standard, "Secrets in build pipelines", "", "security")
	plain := e.as(sam).request(docs.Standard, "Something without a home", "", "")
	planned := map[string]string{"state": "planned"}
	for _, c := range []struct {
		who string
		q   map[string]any
		ok  bool
	}{
		{sam, process, false}, {casey, process, false}, {riley, process, false},
		{alex, process, true}, {jordan, process, true}, {dana, process, true}, // process editor, owner of google-cloud, admin
		{alex, standard, false}, {jordan, standard, false}, {riley, standard, true}, {dana, standard, true},
		{riley, plain, false}, {jordan, plain, false}, {dana, plain, true},
	} {
		status, body := e.as(c.who).do("PUT", path(c.q, "/state"), planned)
		switch {
		case c.ok && status != 200, !c.ok && status != 403:
			t.Errorf("%s on %v: %d %v", c.who, c.q["title"], status, body)
		case c.ok && body["canManage"] != true:
			t.Errorf("%s: canManage %v", c.who, body)
		}
	}
	// what the list says matches
	for who, want := range map[string]string{sam: "false,false,false", jordan: "false,false,true", riley: "false,true,false", alex: "false,false,true", dana: "true,true,true"} {
		var got []string
		for _, q := range e.as(who).requests() {
			got = append(got, fmt.Sprint(q["canManage"]))
		}
		if strings.Join(got, ",") != want {
			t.Errorf("%s: canManage %v, want %s", who, got, want)
		}
	}
	status, body := e.as(sam).do("PUT", path(standard, "/state"), planned)
	wantError(t, status, body, 403, "Only admins, standards editors and the owners of the platform or practice it names can change the state of this request.")
	status, body = e.as(sam).do("PUT", path(process, "/state"), planned)
	wantError(t, status, body, 403, "Only admins, process editors and the owners of the platform or practice it names can change the state of this request.")
}

func TestTheStatesOfARequest(t *testing.T) {
	e := setup(t, nil)
	q := e.as(sam).request(docs.Process, "Publish a library", "", "")
	a := e.as(alex)
	for _, c := range []struct {
		body map[string]string
		want string
	}{
		{map[string]string{"state": "finished"}, "The state must be open, planned, done or declined."},
		{map[string]string{"state": "declined", "note": "   "}, "Say why the request is declined."},
		{map[string]string{"state": "done"}, "Choose the process that answers this request."},
		{map[string]string{"state": "done", "linkedId": "nope"}, "There is no process “nope”."},
		{map[string]string{"state": "done", "linkedId": logging}, "There is no process “secure-logging”."}, // a standard
		{map[string]string{"state": "planned", "note": strings.Repeat("n", 1001)}, "Keep the note under 1000 characters."},
	} {
		status, body := a.do("PUT", path(q, "/state"), c.body)
		wantError(t, status, body, 400, c.want)
	}
	status, body := a.do("PUT", path(q, "/state"), map[string]string{"state": "planned", "note": "Next month.", "linkedId": library})
	wantStatus(t, status, 200, body)
	if body["state"] != "planned" || body["stateNote"] != "Next month." || body["stateBy"] != "Alex Editor" || body["stateAt"] == "" || body["linkedId"] != "" {
		t.Fatalf("planned: %v", body)
	}
	status, body = a.do("PUT", path(q, "/state"), map[string]string{"state": "done", "linkedId": library})
	wantStatus(t, status, 200, body)
	if body["state"] != "done" || body["linkedId"] != library || body["stateNote"] != "" {
		t.Fatalf("done: %v", body)
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "request.state" || entries[0].Target != fmt.Sprintf("request %v", q["id"]) ||
		entries[0].Detail != "“Publish a library”: Done, answered by the process “Publish an internal library”" {
		t.Fatalf("audit: %+v", entries[0])
	}
	// the document that answers it is deleted: the request keeps its id and the list still works
	status, body = a.do("DELETE", "/api/processes/"+library, nil)
	wantStatus(t, status, 200, body)
	if got := e.as(sam).requests()[0]; got["linkedId"] != library || got["state"] != "done" {
		t.Fatalf("after deleting: %v", got)
	}
	// declined, with the reason
	status, body = a.do("PUT", path(q, "/state"), map[string]string{"state": "declined", "note": "Covered elsewhere."})
	wantStatus(t, status, 200, body)
	if body["linkedId"] != "" || body["stateNote"] != "Covered elsewhere." {
		t.Fatalf("declined: %v", body)
	}
	status, body = a.do("PUT", "/api/requests/999/state", map[string]string{"state": "planned"})
	wantError(t, status, body, 404, "That request does not exist.")
}

func TestADraftThatAnswersARequestIsNotNamedToOthers(t *testing.T) {
	e := setup(t, nil)
	q := e.as(sam).request(docs.Process, "Get a GCP project", "", "")
	status, body := e.as(alex).do("PUT", path(q, "/state"), map[string]string{"state": "done", "linkedId": gcp})
	wantStatus(t, status, 200, body)
	status, body = e.as(alex).do("PUT", "/api/processes/"+gcp, e.asDraft(docs.Process, gcp, "SECRET"))
	wantStatus(t, status, 200, body)
	if got := e.as(sam).requests()[0]; got["linkedId"] != "" {
		t.Fatalf("sam sees %v", got["linkedId"])
	}
	if got := e.as(casey).requests()[0]; got["linkedId"] != gcp {
		t.Fatalf("casey works on it: %v", got["linkedId"])
	}
	// a manager who cannot see a draft cannot name it either
	q2 := e.as(sam).request(docs.Process, "Another GCP request", "google-cloud", "")
	status, body = e.as(dana).do("POST", "/api/admin/access", map[string]string{"email": sam, "role": "platform-owner", "scope": "github"})
	wantStatus(t, status, 200, body)
	status, body = e.as(jordan).do("PUT", path(q2, "/state"), map[string]string{"state": "done", "linkedId": gcp})
	wantStatus(t, status, 200, body) // jordan owns google-cloud and sees the draft
	q3 := e.as(alex).request(docs.Process, "A GitHub request here", "github", "")
	status, body = e.as(sam).do("PUT", path(q3, "/state"), map[string]string{"state": "done", "linkedId": gcp})
	wantError(t, status, body, 400, "There is no process “request-gcp-project”.")
}

func TestWithdrawingARequest(t *testing.T) {
	e := setup(t, nil)
	mine := e.as(sam).request(docs.Process, "Withdrawn by me", "", "")
	planned := e.as(sam).request(docs.Process, "Planned already", "", "")
	other := e.as(alex).request(docs.Process, "Not mine at all", "", "")
	if status, body := e.as(alex).do("PUT", path(planned, "/vote"), nil); status != 200 {
		t.Fatal(status, body)
	}
	status, body := e.as(alex).do("PUT", path(planned, "/state"), map[string]string{"state": "planned"})
	wantStatus(t, status, 200, body)

	status, body = e.as(sam).do("DELETE", path(other, ""), nil)
	wantError(t, status, body, 403, "You can only withdraw your own request.")
	status, body = e.as(alex).do("DELETE", path(mine, ""), nil) // a process editor is not an admin
	wantError(t, status, body, 403, "You can only withdraw your own request.")
	status, body = e.as(sam).do("DELETE", path(planned, ""), nil)
	wantError(t, status, body, 409, "This request is no longer open, so it cannot be withdrawn.")
	e.as(sam).noContent("DELETE", path(mine, ""))
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "request.delete" || entries[0].Detail != "“Withdrawn by me”: withdrawn by the requester" {
		t.Fatalf("audit: %+v", entries[0])
	}
	// an admin removes anything, votes included
	e.as(dana).noContent("DELETE", path(planned, ""))
	entries, _ = e.deps.Audit.Recent(bg, 1)
	if entries[0].Detail != "“Planned already”: removed (asked for by sam@example.com)" {
		t.Fatalf("audit: %+v", entries[0])
	}
	if list := e.as(sam).requests(); len(list) != 1 || list[0]["title"] != "Not mine at all" {
		t.Fatalf("left: %v", list)
	}
	status, body = e.as(dana).do("DELETE", path(mine, ""), nil)
	wantError(t, status, body, 404, "That request does not exist.")
}

func TestARequestKeepsAPlatformThatIsRemovedFromTheLists(t *testing.T) {
	e := setup(t, nil)
	e.as(sam).request(docs.Process, "Something on Apigee", "apigee", "")
	// apigee is used by a process; take that away first, then the platform
	status, body := e.as(alex).do("DELETE", "/api/processes/onboard-api-to-apigee", nil)
	wantStatus(t, status, 200, body)
	status, body = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("platforms", "apigee")))
	wantStatus(t, status, 200, body)
	if got := e.as(sam).requests()[0]; got["platform"] != "apigee" {
		t.Fatalf("%v", got)
	}
}
