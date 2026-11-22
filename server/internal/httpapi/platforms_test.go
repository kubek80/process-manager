package httpapi

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// The rights of the owners of a platform or a practice, on processes and on standards.
// Jordan owns the platform google-cloud and the practice engineering (and is in the team
// cloud-platform-team); Riley owns the practice security (and is in the team security).

const (
	notYours  = "You can only save a %s that belongs to a platform or practice you own."
	notTheirs = "Only %s editors and the owners of its platform or practice can change this %s."
)

func notYoursFor(kind string) string { return fmt.Sprintf(notYours, kind) }
func notTheirsFor(kind string) string {
	if kind == docs.Standard {
		return fmt.Sprintf(notTheirs, "standards", kind)
	}
	return fmt.Sprintf(notTheirs, kind, kind)
}

func wantError(t *testing.T, status int, body map[string]any, wantStatus int, wantText string) {
	t.Helper()
	if status != wantStatus || (wantText != "" && body["error"] != wantText) {
		t.Fatalf("got %d %v, want %d %q", status, body, wantStatus, wantText)
	}
}

func TestPlatformAndPracticeOwnersEditWhatBelongsToThem(t *testing.T) {
	e := setup(t, nil)
	j := e.as(jordan)
	for _, c := range []struct {
		kind, path, id, old, new string
		want                     int
	}{
		{docs.Process, "processes", gcp, "Request a GCP project", "Request a Google Cloud project", 200},                       // platform google-cloud
		{docs.Process, "processes", library, `"title": "Publish`, `"title": "Release`, 200},                                    // practice engineering
		{docs.Process, "processes", repoP, "Request a repository", "Request a repo", 403},                                      // platform github
		{docs.Standard, "standards", iac, `"title": "Infrastructure as code"`, `"title": "Infrastructure as code (IaC)"`, 200}, // both
		{docs.Standard, "standards", review, "about 400", "about 300", 200},                                                    // practice engineering
		{docs.Standard, "standards", logging, "never written to logs", "never ever written to logs", 403},                      // practice security
	} {
		status, body := j.do("PUT", "/api/"+c.path+"/"+c.id, e.body(c.kind, c.id, c.old, c.new))
		if status != c.want {
			t.Errorf("%s %s: %d %v", c.kind, c.id, status, body)
		}
		if c.want == 403 && body["error"] != notYoursFor(c.kind) {
			t.Errorf("%s %s: %v", c.kind, c.id, body["error"])
		}
	}
	// the others of the same people: a team owner still edits nothing, Riley only security
	status, body := e.as(casey).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, "Request a Google Cloud project", "Request a GCP project"))
	wantError(t, status, body, 403, notTheirsFor(docs.Process))
	status, body = e.as(riley).do("PUT", "/api/standards/"+iac, e.body(docs.Standard, iac, "(IaC)", "(infra)"))
	wantError(t, status, body, 403, notYoursFor(docs.Standard))
	status, body = e.as(riley).do("PUT", "/api/standards/"+logging, e.body(docs.Standard, logging, "never written to logs", "never ever written to logs"))
	wantStatus(t, status, 200, body)
}

func TestOwnersCannotTakeOverOrGiveAway(t *testing.T) {
	e := setup(t, nil)
	j := e.as(jordan)
	for _, kind := range []string{docs.Process, docs.Standard} {
		path, mine, other := "/api/processes/", gcp, repoP
		otherFrom, otherTo := `"platform": "github"`, `"platform": "google-cloud"`
		mineFrom := `"platform": "google-cloud"`
		if kind == docs.Standard {
			path, mine, other = "/api/standards/", iac, logging
			otherFrom, otherTo = `"practice": "security"`, `"practice": "engineering"`
		}
		// taking over: the stored version belongs to someone else
		status, body := j.do("PUT", path+other, e.body(kind, other, otherFrom, otherTo))
		wantError(t, status, body, 403, notTheirsFor(kind))
		// giving away: the new content belongs to someone else
		status, body = j.do("PUT", path+mine, e.body(kind, mine, mineFrom, `"platform": "azure"`))
		if kind == docs.Process {
			wantError(t, status, body, 403, notYoursFor(kind))
		} else {
			// Jordan may edit it through the practice engineering, but the platform Azure is not
			// Jordan's to put it on
			wantError(t, status, body, 403, "Only an owner of the platform “Azure”, or a standards editor, can put this standard on that platform or take it off it.")
		}
		// or to nothing at all
		status, body = j.do("PUT", path+mine, strings.NewReplacer(`"platform": "google-cloud",`, ``, `"platform": "azure",`, ``, `"practice": "engineering",`, ``).Replace(e.body(kind, mine, "", "")))
		wantError(t, status, body, 403, notYoursFor(kind))
	}
	// adding a practice of one's own is fine
	status, body := j.do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"platform": "google-cloud",`, `"practice": "engineering", "platform": "google-cloud",`))
	wantStatus(t, status, 200, body)
	// nothing of the refused saves was stored
	if d, _ := e.deps.Docs.Get(bg, docs.Process, repoP); d.Version != 1 {
		t.Fatalf("a refused save was stored: v%d", d.Version)
	}
}

func TestOwnersCreateAndDeleteTheirOwn(t *testing.T) {
	e := setup(t, nil)
	j := e.as(jordan)
	fresh := strings.NewReplacer(`"id": "request-gcp-project"`, `"id": "request-gcp-folder"`, "Request a GCP project", "Request a GCP folder").Replace(e.body(docs.Process, gcp, "", ""))
	status, body := j.do("PUT", "/api/processes/request-gcp-folder?base=0", strings.Replace(fresh, `"platform": "google-cloud"`, `"platform": "azure"`, 1))
	wantError(t, status, body, 403, notYoursFor(docs.Process))
	status, body = j.do("PUT", "/api/processes/request-gcp-folder?base=0", fresh)
	wantStatus(t, status, 200, body)
	if sk, err := e.deps.Skills.Get(bg, "process-request-gcp-folder"); err != nil || !sk.Active {
		t.Fatalf("skill: %+v %v", sk, err)
	}
	// a standard of their platform, of no practice
	std := strings.NewReplacer(`"id": "infrastructure-as-code"`, `"id": "cloud-labels"`, `"practice": "engineering",`, ``).Replace(e.body(docs.Standard, iac, "", ""))
	status, body = j.do("PUT", "/api/standards/cloud-labels?base=0", std)
	wantStatus(t, status, 200, body)
	status, body = e.as(riley).do("PUT", "/api/standards/cloud-labels-2?base=0", strings.Replace(std, `"id": "cloud-labels"`, `"id": "cloud-labels-2"`, 1))
	wantError(t, status, body, 403, notYoursFor(docs.Standard))

	for _, path := range []string{"/api/processes/request-gcp-folder", "/api/standards/cloud-labels", "/api/standards/" + review} {
		status, body := j.do("DELETE", path, nil)
		wantStatus(t, status, 200, body)
	}
	for _, path := range []string{"/api/processes/" + repoP, "/api/standards/" + logging} {
		status, body := j.do("DELETE", path, nil)
		wantStatus(t, status, 403, body)
	}
	status, body = e.as(riley).do("DELETE", "/api/standards/"+logging, nil)
	wantStatus(t, status, 200, body)
}

func TestOwnersConfirmReviewsSeeDraftsAndManageFeedback(t *testing.T) {
	e := setup(t, nil)
	// reviews
	for _, c := range []struct {
		who, path string
		want      int
	}{
		{jordan, "/api/processes/" + gcp, 200},
		{jordan, "/api/processes/" + library, 200},
		{jordan, "/api/standards/" + iac, 200},
		{jordan, "/api/processes/" + repoP, 403},
		{jordan, "/api/standards/" + logging, 403},
		{riley, "/api/standards/" + logging, 200},
		{riley, "/api/standards/" + review, 403},
		{casey, "/api/standards/" + iac, 200}, // the owning team, unchanged
	} {
		if status, body := e.as(c.who).do("POST", c.path+"/review", nil); status != c.want {
			t.Errorf("%s reviews %s: %d %v", c.who, c.path, status, body)
		}
	}

	// drafts: a draft of a platform is seen by its owners; one of another platform is not
	status, body := e.as(alex).do("PUT", "/api/processes/"+repoP, e.asDraft(docs.Process, repoP, "Secret repo plan"))
	wantStatus(t, status, 200, body)
	status, body = e.as(alex).do("PUT", "/api/processes/"+library, strings.Replace(e.asDraft(docs.Process, library, "Secret library plan"), `"owner": "developer-experience-team"`, `"owner": "dns-team"`, 1))
	wantStatus(t, status, 200, body)
	sees := func(who, id string) bool {
		_, body := e.as(who).do("GET", "/api/processes", nil)
		for _, d := range body["processes"].([]any) {
			if d.(map[string]any)["id"] == id {
				return true
			}
		}
		return false
	}
	for who, want := range map[string]bool{jordan: true, sam: false, riley: false, casey: false} {
		if got := sees(who, library); got != want {
			t.Errorf("%s sees the draft of the practice engineering: %v", who, got)
		}
	}
	if sees(jordan, repoP) {
		t.Error("jordan sees a draft of the platform github")
	}
	if status, _ := e.as(jordan).do("GET", "/api/history/process/"+library, nil); status != 200 {
		t.Errorf("history of a draft of theirs: %d", status)
	}
	if status, _ := e.as(jordan).do("GET", "/api/history/process/"+repoP, nil); status != 404 {
		t.Errorf("history of a draft of another platform: %d", status)
	}
	if status, _ := e.as(jordan).do("DELETE", "/api/processes/"+repoP, nil); status != 404 {
		t.Errorf("deleting a draft one cannot see: %d", status)
	}

	// feedback
	onGCP := e.as(sam).report(docs.Process, gcp, "", "The form moved.")
	onRepo := e.as(sam).report(docs.Standard, logging, "", "Unclear rule.")
	onIaC := e.as(sam).report(docs.Standard, iac, "", "Which tool?")
	for _, it := range []struct {
		who  string
		item map[string]any
		kind string
		id   string
		can  bool
	}{
		{jordan, onGCP, docs.Process, gcp, true},
		{jordan, onRepo, docs.Standard, logging, false},
		{jordan, onIaC, docs.Standard, iac, true},
		{riley, onRepo, docs.Standard, logging, true},
		{riley, onIaC, docs.Standard, iac, false},
	} {
		items := e.as(it.who).items(it.kind, it.id)
		if len(items) != 1 || items[0]["canManage"] != it.can {
			t.Errorf("%s on %s: %v", it.who, it.id, items)
		}
		want := 403
		if it.can {
			want = 200
		}
		if status, body := e.as(it.who).do("PATCH", "/api/feedback/"+it.item["id"].(string), fix(true)); status != want {
			t.Errorf("%s fixes feedback on %s: %d %v", it.who, it.id, status, body)
		}
		if it.can {
			e.as(it.who).do("PATCH", "/api/feedback/"+it.item["id"].(string), fix(false))
		}
	}
	status, body = e.as(jordan).do("DELETE", "/api/feedback/"+onIaC["id"].(string), nil)
	wantStatus(t, status, 204, body)
	status, body = e.as(jordan).do("DELETE", "/api/feedback/"+onRepo["id"].(string), nil)
	wantStatus(t, status, 403, body)

	// the guidance of a generated skill follows the same rights
	_, body = e.as(jordan).do("GET", "/api/skills/standard-"+iac, nil)
	if body["canEdit"] != true {
		t.Errorf("jordan cannot edit the guidance of the IaC skill: %v", body["canEdit"])
	}
	if status, _ := e.as(jordan).do("PUT", "/api/skills/standard-"+logging+"/extra", map[string]string{"extra": "x"}); status != 403 {
		t.Errorf("guidance of another practice: %d", status)
	}
}

func TestEveryoneCanSeeWhoBelongsToWhat(t *testing.T) {
	e := setup(t, nil)
	if status, _ := e.anonymous().do("GET", "/api/members", nil); status != 401 {
		t.Fatalf("without a session: %d", status)
	}
	status, raw, _ := e.as(sam).raw("GET", "/api/members", nil, false)
	want := `{"members":[` +
		`{"email":"casey@example.com","role":"owner","scope":"cloud-platform-team"},` +
		`{"email":"jordan@example.com","role":"owner","scope":"cloud-platform-team"},` +
		`{"email":"riley@example.com","role":"owner","scope":"security"},` +
		`{"email":"morgan@example.com","role":"platform-member","scope":"google-cloud"},` +
		`{"email":"jordan@example.com","role":"platform-owner","scope":"google-cloud"},` +
		`{"email":"morgan@example.com","role":"practice-member","scope":"engineering"},` +
		`{"email":"jordan@example.com","role":"practice-owner","scope":"engineering"},` +
		`{"email":"riley@example.com","role":"practice-owner","scope":"security"}]}`
	if status != 200 || strings.TrimSpace(string(raw)) != want {
		t.Fatalf("%d %s", status, raw)
	}
	// giving and taking the roles stays with admins
	for _, method := range []string{"POST", "DELETE"} {
		status, body := e.as(jordan).do(method, "/api/admin/access", map[string]string{"email": sam, "role": "platform-owner", "scope": "google-cloud"})
		wantStatus(t, status, 403, body)
	}
	status, body := e.as(dana).do("POST", "/api/admin/access", map[string]string{"email": sam, "role": "platform-owner", "scope": "google-cloud"})
	wantStatus(t, status, 200, body)
	_, body = e.as(sam).do("GET", "/api/members", nil)
	if len(body["members"].([]any)) != 9 {
		t.Fatalf("members: %v", body)
	}
	_, body = e.as(sam).do("GET", "/api/me", nil)
	if fmt.Sprint(body["perms"].(map[string]any)["platforms"]) != "[google-cloud]" {
		t.Fatalf("perms: %v", body["perms"])
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "access.grant" || entries[0].Target != sam || entries[0].Detail != "Platform owner for the platform Google Cloud" {
		t.Fatalf("audit: %+v", entries[0])
	}
	// the new right applies at once
	status, body = e.as(sam).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, "Request a GCP project", "Request a Google Cloud project"))
	wantStatus(t, status, 200, body)
}

func TestUnknownCategoriesPracticesAndPlatformsAreRefused(t *testing.T) {
	e := setup(t, nil)
	for _, c := range []struct{ kind, path, id, field, value string }{
		{docs.Process, "processes", gcp, "category", "ghost"},
		{docs.Process, "processes", gcp, "platform", "ghost"},
		{docs.Process, "processes", gcp, "practice", "security-team"},
		{docs.Standard, "standards", logging, "category", "ghost"},
		{docs.Standard, "standards", logging, "platform", "security"}, // a team and a practice, not a platform
	} {
		body := e.body(c.kind, c.id, "", "")
		var doc map[string]any
		must(t, json.Unmarshal([]byte(body), &doc))
		doc[c.field] = c.value
		data, _ := json.Marshal(doc)
		status, out := e.as(dana).do("PUT", "/api/"+c.path+"/"+c.id, data)
		if status != 400 || !strings.Contains(out["error"].(string), c.field+`: "`+c.value+`" is not a known `+c.field) {
			t.Errorf("%s %s %s=%s: %d %v", c.kind, c.id, c.field, c.value, status, out)
		}
	}
	// a free-text category, as the earlier version had them, does not match the format
	status, out := e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"category": "cloud"`, `"category": "Cloud"`))
	if status != 400 || !strings.Contains(out["error"].(string), "/category") {
		t.Fatalf("free text: %d %v", status, out)
	}
}

// catalogWith returns the lists with one change applied to the decoded document.
func (e *env) catalogWith(change func(map[string]any)) string {
	e.t.Helper()
	var c map[string]any
	must(e.t, json.Unmarshal([]byte(e.body(docs.Catalog, docs.CatalogID, "", "")), &c))
	change(c)
	data, _ := json.Marshal(c)
	return string(data)
}

func dropEntry(key, id string) func(map[string]any) {
	return func(c map[string]any) {
		var keep []any
		for _, n := range c[key].([]any) {
			if n.(map[string]any)["id"] != id {
				keep = append(keep, n)
			}
		}
		c[key] = keep
	}
}

func TestUsedCategoriesPracticesAndPlatformsCannotBeRemoved(t *testing.T) {
	e := setup(t, nil)
	for _, c := range []struct{ key, id, usedBy string }{
		{"categories", "cloud", "Request a GCP project"},
		{"platforms", "google-cloud", "Infrastructure as code"},
		{"practices", "engineering", "Code review"},
		{"practices", "security", "Secure logging"}, // the team "security" stays: only the practice goes
	} {
		status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry(c.key, c.id)))
		if status != 400 || !strings.Contains(out["error"].(string), "“"+c.id+"” is still used by") || !strings.Contains(out["error"].(string), c.usedBy) {
			t.Errorf("removing %s/%s: %d %v", c.key, c.id, status, out)
		}
	}
	// a platform nothing belongs to, but somebody owns: the role keeps it
	status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["platforms"] = append(c["platforms"].([]any), map[string]any{"id": "aws", "name": "AWS"})
		c["categories"] = append(c["categories"].([]any), map[string]any{"id": "misc", "name": "Miscellaneous"})
		c["teams"] = append(c["teams"].([]any), map[string]any{"id": "aws", "name": "AWS team"})
	}))
	wantStatus(t, status, 200, out)
	status, out = e.as(dana).do("POST", "/api/admin/access", map[string]string{"email": sam, "role": "platform-owner", "scope": "aws"})
	wantStatus(t, status, 200, out)
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("platforms", "aws")))
	if status != 400 || !strings.Contains(out["error"].(string), "roles that are limited to it") {
		t.Fatalf("a platform with an owner: %d %v", status, out)
	}
	status, out = e.as(dana).do("PUT", "/api/catalog", e.catalogWith(dropEntry("platforms", "aws")))
	if status != 400 || !strings.Contains(out["error"].(string), "the roles of sam@example.com") {
		t.Fatalf("admins see whose: %d %v", status, out)
	}
	// a team with the same id is a different entry: the platform owner does not keep the team
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("teams", "aws")))
	wantStatus(t, status, 200, out)
	// an unused category can go
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("categories", "misc")))
	wantStatus(t, status, 200, out)
}
