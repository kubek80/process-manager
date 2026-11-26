package httpapi

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

// Members of a platform or practice: they see and save drafts of what belongs to it, an owner
// (or an editor of the kind) publishes. And the details of a group, changed by its owners.

const morgan = "morgan@example.com" // member of the platform google-cloud and the practice engineering

// variant is the GCP process (platform google-cloud, owned by cloud-platform-team) under another
// id, with a status and a title of its own.
func (e *env) variant(id, status, title string) string {
	e.t.Helper()
	body := e.body(docs.Process, gcp, `"id": "`+gcp+`"`, `"id": "`+id+`"`)
	body = strings.Replace(body, `"status": "active"`, `"status": "`+status+`"`, 1)
	return strings.Replace(body, `"title": "Request a GCP project"`, `"title": "`+title+`"`, 1)
}

func (e *env) store(id, status string) {
	e.t.Helper()
	if _, _, err := e.deps.Docs.Put(bg, docs.Process, id, []byte(e.variant(id, status, "Title of "+id)), "setup"); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) storeDraft(id, status string) {
	e.t.Helper()
	if _, err := e.deps.Docs.SaveDraft(bg, docs.DraftChange{Kind: docs.Process, ID: id, Body: []byte(e.variant(id, status, "Draft of "+id)), By: dana}); err != nil {
		e.t.Fatal(err)
	}
}

// outsider is riley, made a member of another platform (Azure): for the documents of Google
// Cloud below (owned by the Cloud Platform team, in no practice) as good as a reader.
const outsider = riley

func TestWhoMayDoWhatWithDrafts(t *testing.T) {
	people := []string{sam, morgan, outsider, jordan, alex, dana}
	type step struct {
		name string
		want [6]int // in the order of people
		run  func(e *env, c *client) (int, map[string]any)
	}
	listed := func(id string, inMeta func(m map[string]any) bool) func(e *env, c *client) (int, map[string]any) {
		return func(e *env, c *client) (int, map[string]any) {
			_, out := c.do("GET", "/api/processes", nil)
			meta, _ := out["meta"].(map[string]any)
			m, ok := meta[id].(map[string]any)
			if ok && (inMeta == nil || inMeta(m)) {
				return 1, nil
			}
			return 0, nil
		}
	}
	put := func(path string, body func(e *env) string) func(e *env, c *client) (int, map[string]any) {
		return func(e *env, c *client) (int, map[string]any) { return c.do("PUT", path, body(e)) }
	}
	call := func(method, path string) func(e *env, c *client) (int, map[string]any) {
		return func(e *env, c *client) (int, map[string]any) { return c.do(method, path, nil) }
	}
	steps := []step{
		{"sees a never-published document", [6]int{0, 1, 0, 1, 1, 1}, listed("np1", nil)},
		{"creates a draft", [6]int{403, 200, 403, 200, 200, 200}, put("/api/processes/new-one?base=0", func(e *env) string { return e.variant("new-one", "draft", "New") })},
		{"creates it published", [6]int{403, 403, 403, 200, 200, 200}, put("/api/processes/new-two?base=0", func(e *env) string { return e.variant("new-two", "active", "New") })},
		{"saves a never-published document as a draft", [6]int{403, 200, 403, 200, 200, 200}, put("/api/processes/np1?base=1", func(e *env) string { return e.variant("np1", "draft", "Changed") })},
		{"publishes it by a save", [6]int{403, 403, 403, 200, 200, 200}, put("/api/processes/np2?base=1", func(e *env) string { return e.variant("np2", "active", "Published") })},
		{"stores it from its working draft, still a draft", [6]int{403, 200, 403, 200, 200, 200}, put("/api/processes/np4?base=1&draft=1", func(e *env) string { return e.variant("np4", "draft", "From the draft") })},
		{"publishes it from its working draft", [6]int{403, 403, 403, 200, 200, 200}, put("/api/processes/np5?base=1&draft=1", func(e *env) string { return e.variant("np5", "active", "From the draft") })},
		{"starts unpublished changes", [6]int{404, 200, 404, 200, 200, 200}, put("/api/processes/pub-w/draft?rev=0", func(e *env) string { return e.variant("pub-w", "active", "Changed") })},
		{"is told of unpublished changes", [6]int{0, 1, 0, 1, 1, 1}, listed("pub-d", func(m map[string]any) bool { return m["draft"] != nil })},
		{"reads unpublished changes", [6]int{404, 200, 404, 200, 200, 200}, call("GET", "/api/processes/pub-d/draft")},
		{"discards unpublished changes", [6]int{404, 204, 404, 204, 204, 204}, call("DELETE", "/api/processes/pub-d/draft?rev=1")},
		{"publishes unpublished changes", [6]int{404, 403, 404, 200, 200, 200}, call("POST", "/api/processes/pub-p/publish?rev=1")},
		{"saves a published document", [6]int{403, 403, 403, 200, 200, 200}, put("/api/processes/pub1?base=1", func(e *env) string { return e.variant("pub1", "active", "Changed") })},
		{"retires it", [6]int{403, 403, 403, 200, 200, 200}, put("/api/processes/pub2?base=1", func(e *env) string { return e.variant("pub2", "deprecated", "Title of pub2") })},
		{"takes it back from readers", [6]int{403, 403, 403, 200, 200, 200}, put("/api/processes/pub3?base=1", func(e *env) string { return e.variant("pub3", "draft", "Title of pub3") })},
		{"brings back a retired one", [6]int{403, 403, 403, 200, 200, 200}, put("/api/processes/old?base=1", func(e *env) string { return e.variant("old", "active", "Title of old") })},
		{"deletes a never-published document", [6]int{404, 403, 404, 200, 200, 200}, call("DELETE", "/api/processes/np3?base=1")},
		{"deletes a published document", [6]int{403, 403, 403, 200, 200, 200}, call("DELETE", "/api/processes/pub-w")},
		{"confirms a review", [6]int{403, 403, 403, 200, 200, 200}, call("POST", "/api/processes/"+gcp+"/review?base=1")},
		{"reads the history of a draft", [6]int{404, 200, 404, 200, 200, 200}, call("GET", "/api/history/process/np6")},
		{"reads a version of a draft", [6]int{404, 200, 404, 200, 200, 200}, call("GET", "/api/history/process/np6/1")},
		{"counts a view of a draft", [6]int{404, 200, 404, 200, 200, 200}, call("POST", "/api/views/process/np6")},
		{"changes the lists", [6]int{403, 403, 403, 403, 200, 200}, func(e *env, c *client) (int, map[string]any) {
			return c.do("PUT", "/api/catalog", e.body(docs.Catalog, docs.CatalogID, `"name": "Azure"`, `"name": "Azure cloud"`))
		}},
		{"gives roles", [6]int{403, 403, 403, 403, 403, 200}, func(e *env, c *client) (int, map[string]any) {
			return c.do("POST", "/api/admin/access", map[string]string{"email": "new@example.com", "role": "platform-owner", "scope": "google-cloud"})
		}},
	}
	for i, who := range people {
		t.Run(strings.Split(who, "@")[0], func(t *testing.T) {
			e := setup(t, nil)
			must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: outsider, Role: rbac.PlatformMember, Scope: "azure", GrantedBy: "test"}))
			for _, id := range []string{"np1", "np2", "np3", "np4", "np5", "np6"} {
				e.store(id, "draft")
			}
			for _, id := range []string{"pub1", "pub2", "pub3", "pub-w", "pub-d", "pub-p"} {
				e.store(id, "active")
			}
			e.store("old", "deprecated")
			e.storeDraft("np4", "draft")
			e.storeDraft("np5", "draft")
			e.storeDraft("pub-d", "active")
			e.storeDraft("pub-p", "active")
			c := e.as(who)
			for _, s := range steps {
				if got, out := s.run(e, c); got != s.want[i] {
					t.Errorf("%s %s: %d, want %d: %v", who, s.name, got, s.want[i], out)
				}
			}
		})
	}
}

func TestAMemberIsToldWhoCanPublish(t *testing.T) {
	e := setup(t, nil)
	e.store("np1", "draft")
	e.store("pub1", "active")
	e.store("old", "deprecated")
	e.storeDraft("pub1", "active")
	m := e.as(morgan)
	for _, c := range []struct{ method, path, body, want string }{
		{"POST", "/api/processes/pub1/publish?rev=1", "", "Only an owner of the platform “Google Cloud”, or a process editor, can publish this process. Your draft is saved for them."},
		{"PUT", "/api/processes/np1?base=1", e.variant("np1", "active", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can publish this process. Save it as a draft for them."},
		{"PUT", "/api/processes/np1?base=1", e.variant("np1", "deprecated", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can retire this process."},
		{"PUT", "/api/processes/pub1?base=1", e.variant("pub1", "draft", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can hide this process from readers."},
		{"PUT", "/api/processes/old?base=1", e.variant("old", "active", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can bring back this process."},
		{"PUT", "/api/processes/old?base=1", e.variant("old", "deprecated", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can change this process as readers see it. Save your changes as a draft for them."},
		{"PUT", "/api/processes/pub1?base=1", e.variant("pub1", "active", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can change this process as readers see it. Save your changes as a draft for them."},
		{"PUT", "/api/processes/pub1?base=1", e.variant("pub1", "deprecated", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can retire this process."},
		{"PUT", "/api/processes/brand-new?base=0", e.variant("brand-new", "active", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can publish this process. Save it as a draft for them."},
		{"PUT", "/api/processes/np1?base=1&draft=1", e.variant("np1", "active", "Xxx"), "Only an owner of the platform “Google Cloud”, or a process editor, can publish this process. Your draft is saved for them."},
		// a standard of the platform and the practice: published, either owner can; first published, an owner of both
		{"PUT", "/api/standards/" + iac + "?base=1", e.body(docs.Standard, iac, `"summary": "`, `"summary": "Changed. `), "Only an owner of the platform “Google Cloud”, an owner of the practice “Engineering”, or a standards editor, can change this standard as readers see it. Save your changes as a draft for them."},
		{"PUT", "/api/standards/sx1?base=0", strings.Replace(e.body(docs.Standard, iac, `"id": "`+iac+`"`, `"id": "sx1"`), `"status": "active"`, `"status": "active"`, 1), "Only somebody who owns both the platform “Google Cloud” and the practice “Engineering”, or a standards editor, can publish this standard. Save it as a draft for them."},
		{"DELETE", "/api/processes/np1?base=1", "", "Only an owner of the platform “Google Cloud”, or a process editor, can delete this process."},
		// a standard of the platform and the practice: either owner can
		{"POST", "/api/standards/" + iac + "/review?base=1", "", "Only the team that owns this, and the people who can edit it, can confirm its review."},
		{"DELETE", "/api/standards/" + iac + "?base=1", "", "Only an owner of the platform “Google Cloud”, an owner of the practice “Engineering”, or a standards editor, can delete this standard."},
	} {
		var body any
		if c.body != "" {
			body = c.body
		}
		status, out := m.do(c.method, c.path, body)
		if status != 403 || out["error"] != c.want {
			t.Errorf("%s %s: %d %v", c.method, c.path, status, out)
		}
	}
	// a draft of something somebody publishes changes nothing readers see
	if d := e.version(docs.Process, "pub1"); d.Version != 1 {
		t.Fatalf("pub1 moved: %d", d.Version)
	}
}

func TestAMemberPutsDraftsOnlyWhereTheyAreAMemberOrOwner(t *testing.T) {
	e := setup(t, nil)
	m := e.as(morgan)
	// on a platform that is not theirs: refused by what the body says, whether the id exists or not
	status, out := m.do("PUT", "/api/processes/x?base=0", strings.Replace(e.variant("x", "draft", "X"), `"platform": "google-cloud"`, `"platform": "azure"`, 1))
	if status != 403 || out["error"] != "You can only save a draft of a process that belongs to a platform or practice you are a member of." {
		t.Fatalf("%d %v", status, out)
	}
	// in their practice, but onto a platform that is not theirs
	eng := strings.Replace(e.variant("eng", "draft", "Eng"), `"platform": "google-cloud",`, `"practice": "engineering",`, 1)
	status, out = m.do("PUT", "/api/processes/eng?base=0", eng)
	wantStatus(t, status, 200, out)
	status, out = m.do("PUT", "/api/processes/eng?base=1", strings.Replace(eng, `"practice": "engineering",`, `"practice": "engineering", "platform": "azure",`, 1))
	if status != 403 || out["error"] != "Only an owner or member of the platform “Azure”, or a process editor, can put this process on that platform or take it off it." {
		t.Fatalf("%d %v", status, out)
	}
	// the same through unpublished changes: the published library is in their practice, on GitHub
	lib := e.body(docs.Process, library, `"platform": "github"`, `"platform": "azure"`)
	status, out = m.do("PUT", draftPath(docs.Process, library, "draft", 0), lib)
	if status != 403 || !strings.Contains(out["error"].(string), "Only an owner or member of the platform “GitHub”") {
		t.Fatalf("%d %v", status, out)
	}
	// moving it into their own platform is fine for a draft
	status, out = m.do("PUT", draftPath(docs.Process, library, "draft", 0), e.body(docs.Process, library, `"summary": "`, `"summary": "Changed. `))
	wantStatus(t, status, 200, out)
}

// To a member of another platform a never-published document answers exactly as an id that does
// not exist, on every save path.
func TestADraftDoesNotExistForAMemberOfAnotherPlatform(t *testing.T) {
	e := setup(t, nil)
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: outsider, Role: rbac.PlatformMember, Scope: "azure", GrantedBy: "test"}))
	e.store("np1", "draft")
	e.storeDraft("np1", "draft")
	o := e.as(outsider)
	theirs := func(id string) string {
		return strings.Replace(e.variant(id, "draft", "Mine"), `"platform": "google-cloud"`, `"platform": "azure"`, 1)
	}
	for _, c := range []struct{ method, query string }{
		{"PUT", "?base=1"}, {"PUT", "?base=0"}, {"PUT", ""}, {"PUT", "?base=1&draft=1"},
		{"GET", "/draft"}, {"PUT", "/draft?rev=1"}, {"PUT", "/draft?rev=0"}, {"DELETE", "/draft?rev=1"}, {"POST", "/publish?rev=1"},
		{"DELETE", "?base=1"},
	} {
		var a, b any
		if c.method == "PUT" {
			a, b = theirs("np1"), theirs("nothing-here")
		}
		s1, out1 := o.do(c.method, "/api/processes/np1"+c.query, a)
		if c.query == "?base=0" || c.query == "" {
			// creating under a taken id cannot be hidden: the same answer as for any taken id
			if s1 != 409 || !strings.Contains(fmt.Sprint(out1["error"]), "Something else already has this id") {
				t.Errorf("%s %s: %d %v", c.method, c.query, s1, out1)
			}
			continue
		}
		s2, out2 := o.do(c.method, "/api/processes/nothing-here"+c.query, b)
		if s1 != s2 || fmt.Sprint(out1) != fmt.Sprint(out2) {
			t.Errorf("%s %s: %d %v, but for an id that does not exist %d %v", c.method, c.query, s1, out1, s2, out2)
		}
	}
	// and nothing else gives it away
	for _, path := range []string{"/api/processes", "/api/feedback", "/api/engagement", "/api/history/process/np1"} {
		_, raw, _ := o.raw("GET", path, nil, false)
		if strings.Contains(string(raw), "Title of np1") || strings.Contains(string(raw), `"np1"`) {
			t.Errorf("%s gives the draft away: %s", path, raw)
		}
	}
}

func TestMembersAreAddedByTheOwnersOfTheirGroup(t *testing.T) {
	e := setup(t, nil)
	const pat = "pat@example.com"
	members := func(out map[string]any) string {
		var list []string
		for _, m := range out["members"].([]any) {
			m := m.(map[string]any)
			list = append(list, fmt.Sprint(m["email"], " ", m["role"], " ", m["name"]))
		}
		return strings.Join(list, "; ")
	}
	j := e.as(jordan)
	status, out := j.do("POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": " Pat@Example.com "})
	if status != 200 || members(out) != "morgan@example.com platform-member Morgan Member; pat@example.com platform-member <nil>; jordan@example.com platform-owner Jordan Platform" || out["note"] != nil {
		t.Fatalf("%d %v", status, out)
	}
	if _, me := e.as(sam).do("GET", "/api/me", nil); me == nil {
		t.Fatal("me")
	}
	if p, _ := e.deps.Roles.Perms(bg, pat); strings.Join(p.MemberPlatforms, ",") != "google-cloud" || p.EditsSome() {
		t.Fatalf("%+v", p)
	}
	for who, note := range map[string]string{pat: "pat@example.com is already a member of the platform “Google Cloud”: nothing changed.", jordan: "jordan@example.com is already an owner of the platform “Google Cloud”: nothing changed."} {
		status, out = j.do("POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": who})
		if status != 200 || out["note"] != note {
			t.Fatalf("%d %v", status, out)
		}
	}
	for _, c := range []struct {
		who, method, path string
		body              any
		status            int
		want              string
	}{
		{jordan, "POST", "/api/groups/platforms/azure/members", map[string]string{"email": pat}, 403, "Only an owner of the platform “Azure”, or an admin, can add or remove its members."},
		{jordan, "DELETE", "/api/groups/platforms/azure/members?email=" + morgan, nil, 403, "Only an owner of the platform “Azure”, or an admin, can add or remove its members."},
		{morgan, "POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": "x@example.com"}, 403, "Only an owner of the platform “Google Cloud”, or an admin, can add or remove its members."},
		{sam, "POST", "/api/groups/practices/engineering/members", map[string]string{"email": "x@example.com"}, 403, "Only an owner of the practice “Engineering”, or an admin, can add or remove its members."},
		{alex, "POST", "/api/groups/practices/engineering/members", map[string]string{"email": "x@example.com"}, 403, "Only an owner of the practice “Engineering”, or an admin, can add or remove its members."},
		{jordan, "POST", "/api/groups/platforms/nope/members", map[string]string{"email": pat}, 404, "There is no platform “nope” in the lists."},
		{jordan, "POST", "/api/groups/teams/cloud-platform-team/members", map[string]string{"email": pat}, 404, "That does not exist."},
		{jordan, "POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": "not an address"}, 400, "That is not an email address."},
		{jordan, "POST", "/api/groups/platforms/google-cloud/members", `{"email": `, 400, "the request is not valid JSON"},
		// owners are given by admins only, as before
		{jordan, "POST", "/api/admin/access", map[string]string{"email": pat, "role": "platform-owner", "scope": "google-cloud"}, 403, "Only admins can do that."},
		{jordan, "POST", "/api/admin/access", map[string]string{"email": pat, "role": "platform-member", "scope": "google-cloud"}, 403, "Only admins can do that."},
	} {
		status, out := e.as(c.who).do(c.method, c.path, c.body)
		if status != c.status || out["error"] != c.want {
			t.Errorf("%s %s %s: %d %v", c.who, c.method, c.path, status, out)
		}
	}
	// without the request header: refused like every other change
	if status, _, _ := j.raw("POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": pat}, false); status != 403 {
		t.Fatalf("without the header: %d", status)
	}
	if status, _ := j.do("POST", "/api/groups/platforms/google-cloud/members", `{"email": "`+strings.Repeat("a", 20000)+`@example.com"}`); status != 413 {
		t.Fatalf("a large body: %d", status)
	}
	status, out = j.do("DELETE", "/api/groups/platforms/google-cloud/members?email="+url.QueryEscape(pat), nil)
	if status != 200 || strings.Contains(members(out), pat) {
		t.Fatalf("%d %v", status, out)
	}
	status, out = j.do("DELETE", "/api/groups/platforms/google-cloud/members?email="+url.QueryEscape(pat), nil)
	if status != 200 || out["note"] != "pat@example.com is not a member of the platform “Google Cloud”: nothing changed." {
		t.Fatalf("%d %v", status, out)
	}
	// an owner is not removed through this call
	status, out = j.do("DELETE", "/api/groups/platforms/google-cloud/members?email="+jordan, nil)
	if status != 200 || !strings.Contains(members(out), "jordan@example.com platform-owner") {
		t.Fatalf("%d %v", status, out)
	}
	// admins add and remove the members of any group
	status, out = e.as(dana).do("POST", "/api/groups/practices/security/members", map[string]string{"email": pat})
	wantStatus(t, status, 200, out)
	entries, err := e.deps.Audit.Before(bg, 0, 10)
	must(t, err)
	var log []string
	for _, en := range entries {
		if strings.HasPrefix(en.Action, "access.") {
			log = append(log, en.Action+" "+en.Target+": "+en.Detail)
		}
	}
	if strings.Join(log, "\n") != "access.grant pat@example.com: Practice member for the practice Cyber security\n"+
		"access.revoke pat@example.com: Platform member for the platform Google Cloud\n"+
		"access.grant pat@example.com: Platform member for the platform Google Cloud" {
		t.Fatalf("%v", log)
	}
	// a reader sees members by name where the portal knows it, and nothing about who gave the role
	_, raw, _ := e.as(sam).raw("GET", "/api/members", nil, false)
	if !strings.Contains(string(raw), `{"email":"pat@example.com","role":"practice-member","scope":"security"}`) ||
		!strings.Contains(string(raw), `{"email":"morgan@example.com","role":"platform-member","scope":"google-cloud","name":"Morgan Member"}`) ||
		strings.Contains(string(raw), "grantedBy") || strings.Contains(string(raw), "grantedAt") {
		t.Fatalf("%s", raw)
	}
	// a practice that still has members stays in the lists, like one that still has owners
	status, out = e.as(alex).do("PUT", "/api/catalog", strings.Replace(e.body(docs.Catalog, docs.CatalogID, "", ""), `"id": "security",
      "name": "Cyber security",`, `"id": "security-2",
      "name": "Cyber security",`, 1))
	if status != 400 || !strings.Contains(fmt.Sprint(out["error"]), "and 2 people are still its owners or members. Change those first and take their roles, then it can be removed.") {
		t.Fatalf("%d %v", status, out)
	}
}

func TestTheDetailsOfAGroupAreChangedByItsOwners(t *testing.T) {
	e := setup(t, nil)
	before := e.version(docs.Catalog, docs.CatalogID)
	details := map[string]any{"description": "Our cloud & more.", "contacts": map[string]any{"email": "gcp@example.com", "slack": " #gcp ", "page": "", "form": "https://forms.example.com/gcp"}}
	for _, c := range []struct {
		who, path string
		status    int
		want      string
	}{
		{morgan, "/api/groups/platforms/google-cloud/details", 403, "Only an owner of the platform “Google Cloud”, a lists manager or an admin can change its details."},
		{sam, "/api/groups/platforms/google-cloud/details", 403, "Only an owner of the platform “Google Cloud”, a lists manager or an admin can change its details."},
		{jordan, "/api/groups/platforms/azure/details", 403, "Only an owner of the platform “Azure”, a lists manager or an admin can change its details."},
		{casey, "/api/groups/platforms/google-cloud/details", 403, "Only an owner of the platform “Google Cloud”, a lists manager or an admin can change its details."},
		{riley, "/api/groups/teams/cloud-platform-team/details", 403, "Only an Owner of the team “Cloud Platform team”, a lists manager or an admin can change its details."},
		{jordan, "/api/groups/categories/cloud/details", 404, "That does not exist."},
		{jordan, "/api/groups/platforms/nope/details", 404, "There is no platform “nope” in the lists."},
	} {
		status, out := e.as(c.who).do("PUT", c.path, details)
		if status != c.status || out["error"] != c.want {
			t.Errorf("%s %s: %d %v", c.who, c.path, status, out)
		}
	}
	if e.version(docs.Catalog, docs.CatalogID).Version != before.Version {
		t.Fatal("a refused change saved the lists")
	}
	j := e.as(jordan)
	for body, want := range map[string]string{
		`{"name": "Hacked"}`:              "Only the description and how to reach them can be changed here.",
		`{"id": "x", "description": "x"}`: "Only the description and how to reach them can be changed here.",
		`{}`:                              "Say what to change: the description, the contact or how to reach them.",
		`{"contacts": {"page": "javascript:alert(1)"}}`:       "Their page must be a link that starts with http:// or https://.",
		`{"contacts": {"form": "data:text/html,hi"}}`:         "The request form must be a link that starts with http:// or https://.",
		`{"contacts": {"slackUrl": "//evil.example.com"}}`:    "The link to the Slack channel must be a link that starts with http:// or https://.",
		`{"contacts": {"email": "nobody"}}`:                   "The group email is not an email address.",
		`{"contacts": {"phone": "1"}}`:                        "There is no way to reach them called “phone”. Use email, slack, slackUrl, chat, chatUrl, confluence, page or form.",
		`{"contacts": "#gcp"}`:                                "How to reach them must be a set of fields: email, slack, slackUrl, chat, chatUrl, confluence, page, form.",
		`{"description": 5}`:                                  "The description must be a text.",
		`{"description": "` + strings.Repeat("x", 601) + `"}`: "The description is 601 characters long; it can be at most 600.",
		`{"contacts": {"slack": "#a\u0007"}}`:                 "The Slack channel contains control characters. Remove them and try again.",
	} {
		status, out := j.do("PUT", "/api/groups/platforms/google-cloud/details", body)
		if status != 400 || out["error"] != want {
			t.Errorf("%s: %d %v", body, status, out)
		}
	}
	status, out := j.do("PUT", "/api/groups/platforms/google-cloud/details", details)
	wantStatus(t, status, 200, out)
	after := e.version(docs.Catalog, docs.CatalogID)
	if num(out["version"]) != after.Version || after.Version != before.Version+1 {
		t.Fatalf("%v %d", out["version"], after.Version)
	}
	// only that entry changed, and only its three fields
	gcpBefore := `      "id": "google-cloud",
      "name": "Google Cloud",
      "contacts": {
        "email": "cloud-platform@example.com",
        "slack": "#cloud-platform",
        "slackUrl": "https://example.slack.com/archives/C0CLOUDPLAT",
        "confluence": "https://example.atlassian.net/wiki/spaces/CLOUD",
        "form": "https://forms.example.com/cloud-platform/request"
      },
      "description": "Google Cloud as the company runs it: projects, networks and the guard rails around them. Ask the Cloud Platform team for a project, quota or access."`
	gcpAfter := `      "id": "google-cloud",
      "name": "Google Cloud",
      "contacts": {
        "email": "gcp@example.com",
        "slack": "#gcp",
        "form": "https://forms.example.com/gcp"
      },
      "description": "Our cloud & more."`
	if !strings.Contains(string(before.Body), gcpBefore) || strings.Replace(string(before.Body), gcpBefore, gcpAfter, 1) != string(after.Body) {
		t.Fatalf("the lists changed elsewhere:\n%s", after.Body)
	}
	// null or "" removes a field; the description of a team by one of its Owners (its tribe stays)
	status, out = e.as(casey).do("PUT", "/api/groups/teams/cloud-platform-team/details", `{"contact": null, "contacts": {}, "description": ""}`)
	wantStatus(t, status, 200, out)
	if !strings.Contains(string(e.version(docs.Catalog, docs.CatalogID).Body), `{
      "id": "cloud-platform-team",
      "name": "Cloud Platform team",
      "tribe": "cloud-tribe"
    }`) {
		t.Fatalf("%s", e.version(docs.Catalog, docs.CatalogID).Body)
	}
	// a lists manager and an admin may change any group
	for _, who := range []string{alex, dana} {
		status, out = e.as(who).do("PUT", "/api/groups/practices/security/details", map[string]any{"contact": "Desk 4 by " + who})
		wantStatus(t, status, 200, out)
	}
	// logged like a save of the lists, naming the group and the person; the version keeps it as its note
	entries, err := e.deps.Audit.Before(bg, 0, 10)
	must(t, err)
	var log []string
	for _, en := range entries {
		log = append(log, en.Action+" "+en.Target+": "+en.Detail)
	}
	if !strings.HasPrefix(strings.Join(log, "\n"), "lists.save catalog: version 5: Details of the practice “Cyber security” changed by Dana Admin: other ways to reach them\n"+
		"lists.save catalog: version 4: Details of the practice “Cyber security” changed by Alex Editor: other ways to reach them\n"+
		"lists.save catalog: version 3: Details of the team “Cloud Platform team” changed by Casey Owner: description, Group email, Slack channel, Slack channel link\n"+
		"lists.save catalog: version 2: Details of the platform “Google Cloud” changed by Jordan Platform: description, Group email, Slack channel, Slack channel link, Confluence page, Request form") {
		t.Fatalf("%s", strings.Join(log, "\n"))
	}
	// skills follow: the platform is named with how to reach it
	content, err := e.deps.Skills.Content(bg, "process-"+gcp, 0)
	must(t, err)
	if !strings.Contains(content, "- Platform: Google Cloud (Group email: gcp@example.com; Slack: #gcp; Request form: https://forms.example.com/gcp)") {
		t.Fatalf("%s", content)
	}
	// a save of the lists from before meets the details as somebody else's change
	status, out = e.as(alex).do("PUT", fmt.Sprintf("/api/catalog?base=%d", before.Version), string(before.Body))
	if status != 409 || !strings.Contains(fmt.Sprint(out["error"]), "changed the lists") {
		t.Fatalf("%d %v", status, out)
	}
	// the lists' own check refuses such a link in a save of the lists too
	status, out = e.as(alex).do("PUT", "/api/catalog", strings.Replace(string(e.version(docs.Catalog, docs.CatalogID).Body), `"form": "https://forms.example.com/gcp"`, `"form": "javascript:alert(1)"`, 1))
	if status != 400 {
		t.Fatalf("%d %v", status, out)
	}
}

func TestDetailsSurviveSavesOfTheListsAtTheSameTime(t *testing.T) {
	e := setup(t, nil)
	groups := []string{"platforms/azure", "platforms/apigee", "practices/engineering", "teams/dns-team"}
	owners := map[string]string{"platforms/azure": dana, "platforms/apigee": dana, "practices/engineering": jordan, "teams/dns-team": alex}
	var wg sync.WaitGroup
	errs := make(chan string, 20)
	for _, g := range groups {
		wg.Add(1)
		go func(g string) {
			defer wg.Done()
			status, out := e.as(owners[g]).do("PUT", "/api/groups/"+g+"/details", map[string]any{"description": "Described: " + g})
			if status != 200 {
				errs <- fmt.Sprintf("%s: %d %v", g, status, out)
			}
		}(g)
	}
	// meanwhile a lists manager saves the lists, as Admin › Lists does: from the version read,
	// again from the newest when somebody was faster
	wg.Add(1)
	go func() {
		defer wg.Done()
		a := e.as(alex)
		for try := 0; try < 20; try++ {
			d := e.version(docs.Catalog, docs.CatalogID)
			body := strings.Replace(string(d.Body), `"name": "ServiceNow",`, `"name": "ServiceNow (ITSM)",`, 1)
			status, _ := a.do("PUT", fmt.Sprintf("/api/catalog?base=%d", d.Version), body)
			if status == 200 {
				return
			}
		}
		errs <- "the lists manager never got a save in"
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	final := string(e.version(docs.Catalog, docs.CatalogID).Body)
	for _, g := range groups {
		if !strings.Contains(final, `"description": "Described: `+g+`"`) {
			t.Errorf("lost: %s", g)
		}
	}
	if strings.Count(final, `"ServiceNow (ITSM)"`) != 1 {
		t.Error("lost the lists manager's change")
	}
	if v := e.version(docs.Catalog, docs.CatalogID).Version; v != 6 {
		t.Errorf("version %d", v)
	}
}

// A draft may be placed where somebody is only a member; whoever makes it visible to readers for
// the first time must own its whole placement, as when creating a published document directly.
func TestTheFirstPublicationNeedsTheWholePlacement(t *testing.T) {
	e := setup(t, nil)
	// riley owns the practice Cyber security and is only a member of Google Cloud
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: riley, Role: rbac.PlatformMember, Scope: "google-cloud", GrantedBy: "test"}))
	shared := func(id, status, practice string) string {
		return strings.Replace(e.variant(id, status, "Shared "+id), `"platform": "google-cloud",`, `"platform": "google-cloud", "practice": "`+practice+`",`, 1)
	}
	const both = "Only somebody who owns both the platform “Google Cloud” and the practice “Cyber security”, or a process editor, can publish this process."
	r := e.as(riley)
	status, out := r.do("PUT", "/api/processes/rx1?base=0", shared("rx1", "active", "security"))
	if status != 403 || out["error"] != both+" Save it as a draft for them." {
		t.Fatalf("directly: %d %v", status, out)
	}
	status, out = r.do("PUT", "/api/processes/rx1?base=0", shared("rx1", "draft", "security"))
	wantStatus(t, status, 200, out)
	// 1. a plain save
	status, out = r.do("PUT", "/api/processes/rx1?base=1", shared("rx1", "active", "security"))
	if status != 403 || out["error"] != both+" Save it as a draft for them." {
		t.Fatalf("plain save: %d %v", status, out)
	}
	// 2. its working draft, then Publish
	status, out = r.do("PUT", "/api/processes/rx1/draft?rev=0&base=1", shared("rx1", "active", "security"))
	wantStatus(t, status, 200, out)
	status, out = r.do("POST", "/api/processes/rx1/publish?rev=1", nil)
	if status != 403 || out["error"] != both+" Your draft is saved for them." {
		t.Fatalf("publish: %d %v", status, out)
	}
	// 3. stored from its working draft
	status, out = r.do("PUT", "/api/processes/rx1?base=1&draft=1", shared("rx1", "active", "security"))
	if status != 403 || out["error"] != both+" Your draft is saved for them." {
		t.Fatalf("draft=R: %d %v", status, out)
	}
	if _, raw, _ := e.as(sam).raw("GET", "/api/processes", nil, false); strings.Contains(string(raw), "rx1") {
		t.Fatal("readers see it")
	}

	// the cooperative case: a member places a draft on a platform and a practice; an owner of one
	// of the two cannot publish it, an owner of both and a process editor can
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: casey, Role: rbac.PlatformOwner, Scope: "google-cloud", GrantedBy: "test"}))
	m := e.as(morgan)
	for _, id := range []string{"co1", "co2", "co3"} {
		status, out = m.do("PUT", "/api/processes/"+id+"?base=0", shared(id, "draft", "engineering"))
		wantStatus(t, status, 200, out)
		status, out = m.do("PUT", draftPath(docs.Process, id, "draft", 0), shared(id, "draft", "engineering"))
		wantStatus(t, status, 200, out)
	}
	status, out = e.as(casey).do("POST", draftPath(docs.Process, "co1", "publish", 1), nil)
	if status != 403 || out["error"] != "Only somebody who owns both the platform “Google Cloud” and the practice “Engineering”, or a process editor, can publish this process. Your draft is saved for them." {
		t.Fatalf("an owner of one: %d %v", status, out)
	}
	status, out = e.as(casey).do("PUT", "/api/processes/co1?base=1", shared("co1", "active", "engineering"))
	if status != 403 || out["error"] != "Only somebody who owns both the platform “Google Cloud” and the practice “Engineering”, or a process editor, can publish this process. Save it as a draft for them." {
		t.Fatalf("%d %v", status, out)
	}
	status, out = e.as(morgan).do("POST", draftPath(docs.Process, "co1", "publish", 1), nil)
	if status != 403 || !strings.HasPrefix(out["error"].(string), "Only somebody who owns both") {
		t.Fatalf("the member: %d %v", status, out)
	}
	status, out = e.as(jordan).do("POST", draftPath(docs.Process, "co2", "publish", 1), nil)
	wantStatus(t, status, 200, out)
	status, out = e.as(alex).do("POST", draftPath(docs.Process, "co3", "publish", 1), nil)
	wantStatus(t, status, 200, out)

	// standards too: the code-review standard is in the practice Engineering; a draft of it on Google Cloud
	std := strings.Replace(strings.Replace(e.body(docs.Standard, iac, `"id": "`+iac+`"`, `"id": "sx1"`), `"status": "active"`, `"status": "draft"`, 1), `"title": "`, `"title": "Draft `, 1)
	status, out = m.do("PUT", "/api/standards/sx1?base=0", std)
	wantStatus(t, status, 200, out)
	status, out = e.as(casey).do("PUT", "/api/standards/sx1?base=1", strings.Replace(std, `"status": "draft"`, `"status": "active"`, 1))
	if status != 403 || out["error"] != "Only somebody who owns both the platform “Google Cloud” and the practice “Engineering”, or a standards editor, can publish this standard. Save it as a draft for them." {
		t.Fatalf("standard: %d %v", status, out)
	}
	status, out = e.as(jordan).do("PUT", "/api/standards/sx1?base=1", strings.Replace(std, `"status": "draft"`, `"status": "active"`, 1))
	wantStatus(t, status, 200, out)
}

// A member's working draft may move a published document into their practice; whoever publishes
// it needs the right to that move.
func TestPublishingAMovedWorkingDraftChecksTheMove(t *testing.T) {
	e := setup(t, nil)
	must(t, e.deps.Roles.Grant(bg, rbac.Assignment{Email: riley, Role: rbac.PlatformOwner, Scope: "google-cloud", GrantedBy: "test"}))
	moved := e.body(docs.Process, gcp, `"platform": "google-cloud",`, `"platform": "google-cloud", "practice": "engineering",`)
	status, out := e.as(morgan).do("PUT", drafts+"?rev=0", moved)
	wantStatus(t, status, 200, out)
	status, out = e.as(riley).do("POST", "/api/processes/"+gcp+"/publish?rev=1", nil)
	if status != 403 || out["error"] != "Only an owner of the practice “Engineering”, or a process editor, can put this process in that practice or take it out of it." {
		t.Fatalf("%d %v", status, out)
	}
	status, out = e.as(jordan).do("POST", "/api/processes/"+gcp+"/publish?rev=1", nil)
	wantStatus(t, status, 200, out)
}

func TestMembersWorkOnStandardsToo(t *testing.T) {
	e := setup(t, nil)
	m := e.as(morgan)
	std := strings.Replace(e.body(docs.Standard, iac, `"id": "`+iac+`"`, `"id": "sx2"`), `"status": "active"`, `"status": "draft"`, 1)
	status, out := m.do("PUT", "/api/standards/sx2?base=0", std)
	wantStatus(t, status, 200, out)
	status, out = m.do("PUT", draftPath(docs.Standard, iac, "draft", 0), e.body(docs.Standard, iac, `"summary": "`, `"summary": "Changed. `))
	wantStatus(t, status, 200, out)
	status, out = m.do("GET", "/api/standards/"+iac+"/draft", nil)
	wantStatus(t, status, 200, out)
	status, out = m.do("POST", draftPath(docs.Standard, iac, "publish", 1), nil)
	if status != 403 || out["error"] != "Only an owner of the platform “Google Cloud”, an owner of the practice “Engineering”, or a standards editor, can publish this standard. Your draft is saved for them." {
		t.Fatalf("%d %v", status, out)
	}
	status, _ = m.do("DELETE", draftPath(docs.Standard, iac, "draft", 1), nil)
	wantStatus(t, status, 204, nil)
	// logging is in the practice Cyber security only: not theirs
	status, out = m.do("PUT", draftPath(docs.Standard, logging, "draft", 0), e.body(docs.Standard, logging, "", ""))
	wantStatus(t, status, 404, out)
	status, out = e.as(sam).do("GET", "/api/standards/sx2/draft", nil)
	wantStatus(t, status, 404, out)
}

func TestAddressesWithInvisibleCharactersAreRefused(t *testing.T) {
	e := setup(t, nil)
	for _, bad := range []string{"pat​@example.com", "pat@exa‮mple.com", "pat\u007f@example.com", "pat\u0007@example.com", "\ufeffpat@example.com"} {
		status, out := e.as(jordan).do("POST", "/api/groups/platforms/google-cloud/members", map[string]string{"email": bad})
		if status != 400 || out["error"] != "That is not an email address." {
			t.Errorf("member %q: %d %v", bad, status, out)
		}
		status, out = e.as(dana).do("POST", "/api/admin/access", map[string]string{"email": bad, "role": "platform-member", "scope": "google-cloud"})
		if status != 400 {
			t.Errorf("access %q: %d %v", bad, status, out)
		}
		status, out = e.as(dana).do("PUT", "/api/admin/users/"+url.PathEscape(bad), map[string]any{"roles": []map[string]string{{"role": "process-editor", "scope": ""}}})
		if status != 400 || out["error"] != "That is not an email address." {
			t.Errorf("users %q: %d %v", bad, status, out)
		}
	}
	// an address an earlier version stored can still be taken out
	for _, role := range []string{rbac.PlatformMember, rbac.ProcessEditor} {
		scope := ""
		if role == rbac.PlatformMember {
			scope = "google-cloud"
		}
		_, err := e.deps.Roles.Pool.Exec(bg, `insert into role_assignments (email, role, scope, granted_by) values ($1, $2, $3, 'old')`, "old​@example.com", role, scope)
		must(t, err)
	}
	status, out := e.as(jordan).do("DELETE", "/api/groups/platforms/google-cloud/members?email="+url.QueryEscape("old​@example.com"), nil)
	if status != 200 || out["note"] != nil {
		t.Fatalf("%d %v", status, out)
	}
	status, raw, _ := e.as(dana).raw("DELETE", "/api/admin/users/"+url.PathEscape("old​@example.com"), nil, true)
	if status != 204 {
		t.Fatalf("%d %s", status, raw)
	}
	if u, _ := e.deps.Roles.UserOf(bg, "old​@example.com"); len(u.Roles) != 0 {
		t.Fatalf("%+v", u)
	}
}

func TestAnEmptySetOfContactsIsLeftOut(t *testing.T) {
	e := setup(t, nil)
	body := e.body(docs.Catalog, docs.CatalogID, `"name": "Azure",`, `"name": "Azure", "contacts": {},`)
	status, out := e.as(alex).do("PUT", "/api/catalog", body)
	if status != 400 || !strings.Contains(fmt.Sprint(out["error"]), "contacts") {
		t.Fatalf("%d %v", status, out)
	}
	// the details call leaves an empty one out by itself
	status, out = e.as(alex).do("PUT", "/api/groups/platforms/azure/details", `{"contacts": {"slack": ""}}`)
	wantStatus(t, status, 200, out)
	if strings.Contains(string(e.version(docs.Catalog, docs.CatalogID).Body), `"contacts": {}`) {
		t.Fatal("an empty object was stored")
	}
}

// The record of a details change names only what changed, each detail by its label; a change
// that changes nothing stores nothing.
func TestADetailsChangeNamesOnlyWhatChanged(t *testing.T) {
	e := setup(t, nil)
	before := e.version(docs.Catalog, docs.CatalogID)
	j := e.as(jordan)
	same := `{"description": "Google Cloud as the company runs it: projects, networks and the guard rails around them. Ask the Cloud Platform team for a project, quota or access.",
		"contacts": {"form": "https://forms.example.com/cloud-platform/request", "email": "cloud-platform@example.com", "slack": "#cloud-platform",
		"slackUrl": "https://example.slack.com/archives/C0CLOUDPLAT", "confluence": "https://example.atlassian.net/wiki/spaces/CLOUD"}}`
	status, out := j.do("PUT", "/api/groups/platforms/google-cloud/details", same)
	if status != 200 || num(out["version"]) != before.Version || e.version(docs.Catalog, docs.CatalogID).Version != before.Version {
		t.Fatalf("nothing changed, yet: %d %v", status, out["version"])
	}
	status, out = j.do("PUT", "/api/groups/platforms/google-cloud/details", strings.Replace(same, `"form":`, `"page": "https://intranet.example.com/gcp", "chat": "Cloud", "form":`, 1))
	wantStatus(t, status, 200, out)
	entries, err := e.deps.Audit.Before(bg, 0, 10)
	must(t, err)
	var log []string
	for _, en := range entries {
		if en.Action == "lists.save" {
			log = append(log, en.Detail)
		}
	}
	if strings.Join(log, "\n") != "version 2: Details of the platform “Google Cloud” changed by Jordan Platform: Google Chat space, Their page" {
		t.Fatalf("%v", log)
	}
}

// Publishing changes somebody else saved last records them: in the version and the activity log.
func TestAPublicationRecordsWhoSavedTheChanges(t *testing.T) {
	e := setup(t, nil)
	m, j := e.as(morgan), e.as(jordan)
	// unpublished changes by morgan, published by jordan
	status, out := m.do("PUT", drafts+"?rev=0", e.body(docs.Process, gcp, `"summary": "`, `"summary": "Morgan's words. `))
	wantStatus(t, status, 200, out)
	status, out = j.do("POST", "/api/processes/"+gcp+"/publish?rev=1&note=Looks+right", nil)
	wantStatus(t, status, 200, out)
	// a never-published draft by morgan, stored as the document, published by jordan with a plain save
	status, out = m.do("PUT", "/api/processes/m1?base=0", e.variant("m1", "draft", "Morgan's process"))
	wantStatus(t, status, 200, out)
	status, out = j.do("PUT", "/api/processes/m1?base=1", e.variant("m1", "active", "Morgan's process"))
	wantStatus(t, status, 200, out)
	// one through its working draft (draft=R)
	status, out = m.do("PUT", "/api/processes/m2?base=0", e.variant("m2", "draft", "Second"))
	wantStatus(t, status, 200, out)
	status, out = m.do("PUT", draftPath(docs.Process, "m2", "draft", 0), e.variant("m2", "draft", "Second, newer"))
	wantStatus(t, status, 200, out)
	status, out = j.do("PUT", "/api/processes/m2?base=1&draft=1", e.variant("m2", "active", "Second, newer"))
	wantStatus(t, status, 200, out)
	// jordan's own changes, published by jordan: nobody else to name
	status, out = j.do("PUT", drafts+"?rev=0", e.body(docs.Process, gcp, `"summary": "`, `"summary": "Jordan's words. `))
	wantStatus(t, status, 200, out)
	status, out = j.do("POST", "/api/processes/"+gcp+"/publish?rev=1", nil)
	wantStatus(t, status, 200, out)

	for id, want := range map[string]string{gcp: "3: - | 2: morgan@example.com Morgan Member | 1: - ", "m1": "2: morgan@example.com Morgan Member ", "m2": "2: morgan@example.com Morgan Member "} { // a reader sees no draft versions
		_, out := e.as(sam).do("GET", "/api/history/process/"+id, nil)
		var got []string
		for _, v := range out["versions"].([]any) {
			v := v.(map[string]any)
			who := "-"
			if v["changesBy"] != nil {
				who = fmt.Sprint(v["changesBy"], " ", v["changesByName"])
			}
			got = append(got, fmt.Sprint(num(v["version"]), ": ", who))
			if v["savedBy"] != jordan && num(v["version"]) > 1 {
				t.Errorf("%s: the publisher is the one who saved: %v", id, v)
			}
		}
		if strings.Join(got, " | ")+" " != want {
			t.Errorf("%s: %s", id, strings.Join(got, " | "))
		}
	}
	entries, err := e.deps.Audit.Before(bg, 0, 20)
	must(t, err)
	var log []string
	for _, en := range entries {
		if en.Action == "process.publish" {
			log = append(log, en.Target+" "+en.Detail)
		}
	}
	if strings.Join(log, "\n") != gcp+" version 3\n"+
		"m2 version 2; the changes were last saved by Morgan Member\n"+
		"m1 version 2; the changes were last saved by Morgan Member\n"+
		gcp+" version 2: Looks right; the changes were last saved by Morgan Member" {
		t.Fatalf("%s", strings.Join(log, "\n"))
	}
}
