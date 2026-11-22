package httpapi

import (
	"fmt"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

const (
	platformMsg = "Only an owner of the platform “%s”, or a %s editor, can put this %s on that platform or take it off it."
	practiceMsg = "Only an owner of the practice “%s”, or a %s editor, can put this %s in that practice or take it out of it."
)

func TestAStandardsEditorLimitedByAnEarlierVersionGivesNothing(t *testing.T) {
	e := setup(t, nil)
	if _, err := e.deps.Docs.Pool.Exec(bg, `insert into role_assignments (email, role, scope, granted_by) values ($1, 'standards-editor', 'security', 'old server')`, sam); err != nil {
		t.Fatal(err)
	}
	_, me := e.as(sam).do("GET", "/api/me", nil)
	if me["perms"].(map[string]any)["standards"] != false {
		t.Fatalf("perms: %v", me["perms"])
	}
	status, body := e.as(sam).do("PUT", "/api/standards/"+logging, e.body(docs.Standard, logging, "never written to logs", "never ever written to logs"))
	wantStatus(t, status, 403, body)
	// the Admin panel shows it and can take it away
	_, body = e.as(dana).do("GET", "/api/admin/access", nil)
	if !strings.Contains(fmt.Sprint(body["assignments"]), "role:standards-editor scope:security") {
		t.Fatalf("not listed: %v", body["assignments"])
	}
	status, body = e.as(dana).do("DELETE", "/api/admin/access", map[string]string{"email": sam, "role": "standards-editor", "scope": "security"})
	wantStatus(t, status, 200, body)
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Detail != "Standards editor (limited to security)" {
		t.Fatalf("audit: %+v", entries[0])
	}
}

func TestASharedDocumentStaysWithItsOtherPlatformOrPractice(t *testing.T) {
	e := setup(t, nil)
	j := e.as(jordan) // owns the practice engineering, not the platform github

	// (a) the library belongs to the practice engineering and the platform github
	status, body := j.do("PUT", "/api/processes/"+library, e.body(docs.Process, library, `"platform": "github"`, `"platform": "azure"`))
	wantError(t, status, body, 403, fmt.Sprintf(platformMsg, "GitHub", "process", "process"))
	status, body = j.do("PUT", "/api/processes/"+library, e.body(docs.Process, library, `"platform": "github",`, ``))
	wantError(t, status, body, 403, fmt.Sprintf(platformMsg, "GitHub", "process", "process"))
	// changing its team, or anything else, is fine
	status, body = j.do("PUT", "/api/processes/"+library, e.body(docs.Process, library, `"owner": "developer-experience-team"`, `"owner": "cloud-platform-team"`))
	wantStatus(t, status, 200, body)

	// (b) a standard shared by the practice engineering and the platform github
	status, body = e.as(dana).do("PUT", "/api/standards/"+review, e.body(docs.Standard, review, `"practice": "engineering",`, `"practice": "engineering", "platform": "github",`))
	wantStatus(t, status, 200, body)
	for _, p := range []string{"github", "azure"} {
		status, body = e.as(dana).do("POST", "/api/admin/access", map[string]string{"email": sam, "role": "platform-owner", "scope": p})
		wantStatus(t, status, 200, body)
	}
	s := e.as(sam)
	status, body = s.do("PUT", "/api/standards/"+review, e.body(docs.Standard, review, `"practice": "engineering",`, ``))
	wantError(t, status, body, 403, fmt.Sprintf(practiceMsg, "Engineering", "standards", "standard"))
	status, body = s.do("PUT", "/api/standards/"+review, e.body(docs.Standard, review, `"practice": "engineering"`, `"practice": "security"`))
	wantError(t, status, body, 403, fmt.Sprintf(practiceMsg, "Engineering", "standards", "standard"))
	// the owner of both platforms moves it from one to the other
	status, body = s.do("PUT", "/api/standards/"+review, e.body(docs.Standard, review, `"platform": "github"`, `"platform": "azure"`))
	wantStatus(t, status, 200, body)

	// the owner of a platform and a practice takes it off their platform and keeps the practice
	status, body = j.do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"platform": "google-cloud",`, `"practice": "engineering",`))
	wantStatus(t, status, 200, body)
	if d, _ := e.deps.Docs.Get(bg, docs.Process, gcp); strings.Contains(string(d.Body), `"platform"`) {
		t.Fatal("the platform was not removed")
	}

	// creating (a first publication): every platform and practice set must be one's own
	const both = "Only somebody who owns both the platform “%s” and the practice “%s”, or a process editor, can publish this process. Save it as a draft for them."
	fresh := strings.NewReplacer(`"id": "request-gcp-project"`, `"id": "request-gcp-folder"`, `"practice": "engineering"`, `"practice": "security", "platform": "google-cloud"`).Replace(e.body(docs.Process, gcp, "", ""))
	status, body = j.do("PUT", "/api/processes/request-gcp-folder?base=0", fresh)
	wantError(t, status, body, 403, fmt.Sprintf(both, "Google Cloud", "Cyber security"))
	// also under the id of something deleted: it starts from nothing
	status, body = e.as(alex).do("DELETE", "/api/processes/"+library, nil)
	wantStatus(t, status, 200, body)
	again := e.body(docs.Process, repoP, "", "")
	again = strings.NewReplacer(`"id": "request-github-repository"`, `"id": "`+library+`"`, `"owner": "developer-experience-team",`, `"owner": "developer-experience-team", "practice": "engineering",`).Replace(again)
	status, body = j.do("PUT", "/api/processes/"+library+"?base=0", again)
	wantError(t, status, body, 403, fmt.Sprintf(both, "GitHub", "Engineering"))

	// general editors are not limited
	status, body = e.as(alex).do("PUT", "/api/processes/"+repoP, e.body(docs.Process, repoP, `"platform": "github"`, `"platform": "azure"`))
	wantStatus(t, status, 200, body)
}

func TestTheVersionsOfADeletedDocumentAreNotPassedOn(t *testing.T) {
	e := setup(t, nil)
	editor := e.as(alex)
	base := strings.NewReplacer(`"id": "request-gcp-project"`, `"id": "gcp-demo"`, "Request a GCP project", "Old secret plan").Replace(e.body(docs.Process, gcp, "", ""))
	for i, body := range []string{base, strings.Replace(base, "Old secret plan", "Old secret plan, revised", 1)} {
		status, out := editor.do("PUT", fmt.Sprintf("/api/processes/gcp-demo?base=%d", i), body)
		wantStatus(t, status, 200, out)
	}
	status, out := editor.do("DELETE", "/api/processes/gcp-demo", nil)
	wantStatus(t, status, 200, out)
	// a platform owner creates something new under the same id: version 4
	status, out = e.as(jordan).do("PUT", "/api/processes/gcp-demo?base=0", strings.Replace(base, "Old secret plan", "New plan", 1))
	wantStatus(t, status, 200, out)

	versions := func(who string) string {
		_, body := e.as(who).do("GET", "/api/history/process/gcp-demo", nil)
		var out []string
		for _, v := range body["versions"].([]any) {
			out = append(out, fmt.Sprint(v.(map[string]any)["version"]))
		}
		return strings.Join(out, ",")
	}
	for who, want := range map[string]string{jordan: "4,3", sam: "4,3", alex: "4,3,2,1", dana: "4,3,2,1"} {
		if got := versions(who); got != want {
			t.Errorf("%s sees versions %s, want %s", who, got, want)
		}
	}
	for who, want := range map[string]int{jordan: 404, sam: 404, riley: 404, alex: 200, dana: 200} {
		status, raw, _ := e.as(who).raw("GET", "/api/history/process/gcp-demo/1", nil, false)
		if status != want || (want == 404 && strings.Contains(string(raw), "secret")) {
			t.Errorf("%s reads version 1: %d %s", who, status, raw)
		}
	}
	if status, _ := e.as(sam).do("GET", "/api/history/process/gcp-demo/4", nil); status != 200 {
		t.Errorf("the new version: %d", status)
	}
}
