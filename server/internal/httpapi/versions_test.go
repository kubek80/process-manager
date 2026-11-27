package httpapi

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

func metaFor(t *testing.T, c *client, path, id string) map[string]any {
	t.Helper()
	status, body := c.do("GET", path, nil)
	wantStatus(t, status, 200, body)
	meta, _ := body["meta"].(map[string]any)
	m, _ := meta[id].(map[string]any)
	return m
}

func TestEveryDocumentCarriesItsVersion(t *testing.T) {
	e := setup(t, nil)
	if m := metaFor(t, e.as(sam), "/api/processes", repoP); m["version"] != float64(1) || m["updatedBy"] != "import" || m["updatedAt"] == nil {
		t.Fatalf("meta after the import: %v", m)
	}
	note := "Shorter title, asked for by the platform team"
	status, body := e.as(alex).do("PUT", "/api/processes/"+repoP+"?base=1&note="+url.QueryEscape(note), e.body(docs.Process, repoP, "Request a repository", "Request a repo"))
	if status != 200 || body["version"] != float64(2) || body["changed"] != true || body["updatedBy"] != alex {
		t.Fatalf("save: %d %v", status, body)
	}
	if m := metaFor(t, e.as(sam), "/api/processes", repoP); m["version"] != float64(2) || m["updatedBy"] != alex {
		t.Fatalf("meta after the save: %v", m)
	}
	// the note is kept with the version and in the activity log
	_, h := e.as(sam).do("GET", "/api/history/process/"+repoP, nil)
	latest := h["versions"].([]any)[0].(map[string]any)
	if latest["version"] != float64(2) || latest["note"] != note || latest["savedBy"] != alex {
		t.Fatalf("history: %v", latest)
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Detail != "version 2: "+note {
		t.Fatalf("activity: %q", entries[0].Detail)
	}
	// saving the same content again is not a new version
	status, body = e.as(alex).do("PUT", "/api/processes/"+repoP+"?base=2", e.body(docs.Process, repoP, "", ""))
	if status != 200 || body["version"] != float64(2) || body["changed"] != false {
		t.Fatalf("unchanged save: %d %v", status, body)
	}
	// the lists carry theirs in a header
	_, _, header := e.as(sam).raw("GET", "/api/catalog", nil, false)
	if header.Get(VersionHeader) != "1" {
		t.Fatalf("lists version header: %q", header.Get(VersionHeader))
	}
	if status, body := e.as(alex).do("PUT", "/api/processes/"+repoP+"?base=x", "{}"); status != 400 {
		t.Fatalf("a base that is not a number: %d %v", status, body)
	}
}

func TestASaveFromAnOutdatedVersionIsRefused(t *testing.T) {
	e := setup(t, nil)
	first := e.body(docs.Process, repoP, "Request a repository", "Request a repo")
	second := e.body(docs.Process, repoP, "Request a repository", "Ask for a repository")
	status, body := e.as(alex).do("PUT", "/api/processes/"+repoP+"?base=1", first)
	wantStatus(t, status, 200, body)
	// dana still has version 1 open
	status, body = e.as(dana).do("PUT", "/api/processes/"+repoP+"?base=1", second)
	c, _ := body["conflict"].(map[string]any)
	if status != 409 || c["exists"] != true || c["version"] != float64(2) || c["updatedBy"] != alex || c["updatedByName"] != "Alex Editor" || c["status"] != "active" || body["error"] != "Alex Editor saved a newer version (version 2) while you were working on this." {
		t.Fatalf("conflict: %d %v", status, body)
	}
	if d, _ := e.deps.Docs.Get(bg, docs.Process, repoP); d.Version != 2 || !strings.Contains(string(d.Body), "Request a repo\"") {
		t.Fatalf("the refused save changed something: v%d", d.Version)
	}
	// after looking at version 2 she saves on top of it
	status, body = e.as(dana).do("PUT", "/api/processes/"+repoP+"?base=2", second)
	if status != 200 || body["version"] != float64(3) {
		t.Fatalf("save on the current version: %d %v", status, body)
	}
	// "I am creating this" is refused when it exists already
	status, body = e.as(alex).do("PUT", "/api/processes/"+repoP+"?base=0", second)
	wantStatus(t, status, 409, body)
	// the lists are protected the same way
	status, body = e.as(alex).do("PUT", "/api/catalog?base=7", e.body(docs.Catalog, docs.CatalogID, "", ""))
	if status != 409 || !strings.Contains(body["error"].(string), "lists") {
		t.Fatalf("lists conflict: %d %v", status, body)
	}
	// deleting what somebody else changed in the meantime
	status, body = e.as(alex).do("DELETE", "/api/processes/"+repoP+"?base=1", nil)
	wantStatus(t, status, 409, body)
	// and saving what somebody else deleted
	status, body = e.as(alex).do("DELETE", "/api/processes/"+repoP+"?base=3", nil)
	wantStatus(t, status, 200, body)
	status, body = e.as(dana).do("PUT", "/api/processes/"+repoP+"?base=3", second)
	c, _ = body["conflict"].(map[string]any)
	if status != 409 || c["exists"] != false {
		t.Fatalf("save of a deleted process: %d %v", status, body)
	}
}

func TestSavesAtTheSameTimeNeverLoseAVersion(t *testing.T) {
	e := setup(t, nil)
	editor := e.as(alex)
	// eight people create the same new process at once: exactly one wins, nobody gets an error page
	fresh := strings.ReplaceAll(e.body(docs.Process, repoP, "", ""), repoP, "brand-new")
	var wg sync.WaitGroup
	statuses := make([]int, 8)
	for i := range statuses {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i], _ = editor.do("PUT", "/api/processes/brand-new?base=0", strings.Replace(fresh, "Request a repository", fmt.Sprintf("New process %d", i), 1))
		}()
	}
	wg.Wait()
	created := 0
	for _, s := range statuses {
		switch s {
		case 200:
			created++
		case 409:
		default:
			t.Errorf("status %d", s)
		}
	}
	if d, _ := e.deps.Docs.Get(bg, docs.Process, "brand-new"); created != 1 || d.Version != 1 {
		t.Fatalf("created %d times, now at version %d", created, d.Version)
	}
	// without a base every save goes through, each as its own version, and the skill follows the last one
	for i := range statuses {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i], _ = editor.do("PUT", "/api/processes/brand-new", strings.Replace(fresh, "Request a repository", fmt.Sprintf("Edit %d", i), 1))
		}()
	}
	wg.Wait()
	d, _ := e.deps.Docs.Get(bg, docs.Process, "brand-new")
	versions, _ := e.deps.Docs.History(bg, docs.Process, "brand-new")
	if d.Version != 9 || len(versions) != 9 {
		t.Fatalf("version %d with %d entries in the history", d.Version, len(versions))
	}
	target, _ := docs.TargetOf(d)
	content, _ := e.deps.Skills.Content(bg, "process-brand-new", 0)
	if !strings.Contains(content, "# Process: "+target.Title+"\n") {
		t.Fatalf("the skill is not generated from the stored version %q:\n%s", target.Title, content[:300])
	}
}

func TestDraftsAreOnlyForThePeopleWhoWorkOnThem(t *testing.T) {
	e := setup(t, nil)
	draft := func(kind, id string) string {
		body := e.body(kind, id, "", "")
		if strings.Contains(body, `"status": "active"`) {
			return strings.Replace(body, `"status": "active"`, `"status": "draft"`, 1)
		}
		return strings.Replace(body, `"title":`, `"status": "draft", "title":`, 1)
	}
	item := e.as(sam).report(docs.Process, gcp, "", "Reported while it was still published")
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, draft(docs.Process, gcp))
	wantStatus(t, status, 200, body)
	status, body = e.as(riley).do("PUT", "/api/standards/"+logging, draft(docs.Standard, logging))
	wantStatus(t, status, 200, body)

	sees := func(who, path, key, id string) bool {
		_, body := e.as(who).do("GET", path, nil)
		for _, d := range body[key].([]any) {
			if d.(map[string]any)["id"] == id {
				return true
			}
		}
		return false
	}
	for who, want := range map[string]bool{sam: false, riley: false, alex: true, casey: true, dana: true} { // casey's team owns it
		if got := sees(who, "/api/processes", "processes", gcp); got != want {
			t.Errorf("%s sees the draft process: %v", who, got)
		}
	}
	for who, want := range map[string]bool{sam: false, alex: false, riley: true, dana: true} {
		if got := sees(who, "/api/standards", "standards", logging); got != want {
			t.Errorf("%s sees the draft standard: %v", who, got)
		}
	}
	if m := metaFor(t, e.as(sam), "/api/processes", gcp); m != nil {
		t.Errorf("the version of a hidden draft leaks: %v", m)
	}
	// feedback on a draft: not listed for readers, and they cannot add any
	if got := len(e.as(sam).items(docs.Process, gcp)); got != 0 {
		t.Errorf("a reader sees %d feedback items of a draft", got)
	}
	if got := e.as(alex).items(docs.Process, gcp); len(got) != 1 || got[0]["id"] != item["id"] {
		t.Errorf("the editor sees %v", got)
	}
	status, body = e.as(sam).do("POST", "/api/feedback", map[string]string{"targetKind": docs.Process, "targetId": gcp, "kind": "broken", "text": "Found it by its link"})
	wantStatus(t, status, 400, body)
	if len(e.notes.events) != 1 {
		t.Errorf("notifications: %d", len(e.notes.events))
	}
}

func TestTheServerChecksThatADocumentFitsTogether(t *testing.T) {
	e := setup(t, nil)
	cases := map[string]string{
		"a next step that does not exist":      e.body(docs.Process, gcp, `"to": "raise-request"`, `"to": "no-such-step"`),
		"a participant that does not exist":    e.body(docs.Process, gcp, `"actor": "me"`, `"actor": "nobody"`),
		"a tier that is not in the lists":      strings.Replace(e.body(docs.Process, gcp, "", ""), `"title":`, `"tiers": ["tier-9"], "title":`, 1),
		"a process that replaces itself":       strings.Replace(e.body(docs.Process, gcp, "", ""), `"title":`, `"replacedBy": "`+gcp+`", "title":`, 1),
		"a step id that is used twice":         e.body(docs.Process, gcp, `"id": "verify-access"`, `"id": "raise-request"`),
		"a decision with one way out (label)":  e.body(docs.Process, gcp, `"label": "No"`, `"label": ""`),
		"a process as its own sub-process":     e.body(docs.Process, gcp, `"subProcessId": "raise-servicenow-request"`, `"subProcessId": "`+gcp+`"`),
		"an environment that is not in a list": strings.Replace(e.body(docs.Process, gcp, "", ""), `"title":`, `"environments": ["moon"], "title":`, 1),
	}
	for name, body := range cases {
		status, out := e.as(alex).do("PUT", "/api/processes/"+gcp, body)
		if status != 400 {
			t.Errorf("%s: %d %v", name, status, out)
		}
	}
	if d, _ := e.deps.Docs.Get(bg, docs.Process, gcp); d.Version != 1 {
		t.Fatalf("a refused save was stored: v%d", d.Version)
	}
	status, out := e.as(riley).do("PUT", "/api/standards/"+logging, e.body(docs.Standard, logging, `"id": "SEC-LOG-02"`, `"id": "SEC-LOG-01"`))
	if status != 400 || !strings.Contains(out["error"].(string), "duplicate requirement id") {
		t.Fatalf("a requirement id used twice: %d %v", status, out)
	}
	// what the checker in the browser only warns about is still allowed: a process that does not exist yet
	status, out = e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"subProcessId": "raise-servicenow-request"`, `"subProcessId": "planned-for-later"`))
	wantStatus(t, status, 200, out)
}

func TestListEntriesInUseCannotBeRemoved(t *testing.T) {
	e := setup(t, nil)
	without := func(entries ...string) string {
		body := e.body(docs.Catalog, docs.CatalogID, "", "")
		for _, entry := range entries {
			body = cut(t, body, entry)
		}
		return body
	}
	status, out := e.as(alex).do("PUT", "/api/catalog", without(`"id": "cloud-platform-team"`))
	if status != 400 || !strings.Contains(out["error"].(string), "still used by") || !strings.Contains(out["error"].(string), "Request a GCP project") {
		t.Fatalf("removing a team that owns a process: %d %v", status, out)
	}
	// a team that performs a service cannot go while the service names it
	status, out = e.as(alex).do("PUT", "/api/catalog", without(`"id": "network-team"`))
	if status != 400 || !strings.Contains(out["error"].(string), "“network-team” is still used by the service “Firewall rule change”") {
		t.Fatalf("removing a team that performs a service: %d %v", status, out)
	}
	// a team nothing refers to can go - unless a role is limited to it (here: with the service it performed)
	status, out = e.as(alex).do("PUT", "/api/catalog", without(`"id": "network-team"`, `"id": "firewall-rule-change"`))
	wantStatus(t, status, 200, out)
	if d, _ := e.deps.Docs.Get(bg, docs.Catalog, docs.CatalogID); d.Version != 2 {
		t.Fatalf("lists version %d", d.Version)
	}
}

// cut takes the entry of the lists that holds the given text out of their body.
func cut(t *testing.T, body, entry string) string {
	t.Helper()
	{
		start := strings.Index(body, entry)
		if start < 0 {
			t.Fatalf("the lists do not contain %s", entry)
		}
		open := strings.LastIndex(body[:start], "{")
		end, depth := open, 0 // the entry may hold an object of its own (contacts)
		for i := open; i < len(body); i++ {
			if body[i] == '{' {
				depth++
			} else if body[i] == '}' {
				if depth--; depth == 0 {
					end = i + 1
					break
				}
			}
		}
		rest := strings.TrimLeft(body[end:], " \n")
		if strings.HasPrefix(rest, ",") {
			return body[:open] + strings.TrimLeft(rest[1:], " \n")
		}
		return strings.TrimRight(strings.TrimRight(body[:open], " \n"), ",") + body[end:]
	}
}

func TestSkillsFollowTheDocumentsTheyMention(t *testing.T) {
	e := setup(t, nil)
	content := func(id string) string {
		c, err := e.deps.Skills.Content(bg, id, 0)
		must(t, err)
		return c
	}
	if c := content("process-" + gcp); !strings.Contains(c, "“Request a repository” (skill `process-"+repoP+"`)") {
		t.Fatalf("before: %s", c)
	}
	// renamed: the skills that mention it get the new name
	status, out := e.as(alex).do("PUT", "/api/processes/"+repoP, e.body(docs.Process, repoP, "Request a repository", "Get a repository"))
	wantStatus(t, status, 200, out)
	if c := content("process-" + gcp); !strings.Contains(c, "“Get a repository” (skill `process-"+repoP+"`)") {
		t.Fatalf("after the rename: %s", c)
	}
	// deleted: they no longer point at a skill that was withdrawn
	status, out = e.as(alex).do("DELETE", "/api/processes/"+repoP, nil)
	wantStatus(t, status, 200, out)
	c := content("process-" + gcp)
	if strings.Contains(c, "skill `process-"+repoP+"`") || !strings.Contains(c, "follow the process “"+repoP+"”.") {
		t.Fatalf("after the delete: %s", c)
	}
	if sk, _ := e.deps.Skills.Get(bg, "process-"+repoP); sk.Active {
		t.Fatal("the skill of the deleted process is still active")
	}
	// a skill that mentions nothing of this did not move
	if sk, _ := e.deps.Skills.Get(bg, "standard-"+logging); sk.Version != 1 {
		t.Fatalf("an unrelated skill moved: v%d", sk.Version)
	}

	// export removes the files of withdrawn skills, but never a file it did not write
	dir := t.TempDir()
	gone := filepath.Join(dir, ".claude", "skills", "process-"+repoP, "SKILL.md")
	mine := filepath.Join(dir, ".claude", "agents", "review-retired.md")
	for path, text := range map[string]string{gone: "old\n\n---\n\n" + "Generated by Pattern Catalog from the process `x`, version 1.", mine: "written by hand"} {
		must(t, os.MkdirAll(filepath.Dir(path), 0o755))
		must(t, os.WriteFile(path, []byte(text), 0o644))
	}
	_, err := e.deps.Skills.ExportDir(bg, dir)
	must(t, err)
	if _, err := os.Stat(gone); !os.IsNotExist(err) {
		t.Errorf("the withdrawn skill is still exported: %v", err)
	}
	if _, err := os.Stat(mine); err != nil {
		t.Errorf("a hand-written file was removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".claude", "skills", "process-"+gcp, "SKILL.md")); err != nil {
		t.Errorf("an active skill is missing: %v", err)
	}
}

func TestDeletingTakesTheFeedbackAndTheLogEntryAlong(t *testing.T) {
	e := setup(t, nil)
	e.as(sam).report(docs.Process, repoP, "", "This one is going away")
	status, out := e.as(alex).do("DELETE", "/api/processes/"+repoP, nil)
	wantStatus(t, status, 200, out)
	if items := e.as(alex).items(docs.Process, repoP); len(items) != 0 {
		t.Errorf("feedback left behind: %v", items)
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "process.delete" || entries[0].Target != repoP {
		t.Errorf("activity: %+v", entries[0])
	}
	versions, _ := e.deps.Docs.History(bg, docs.Process, repoP)
	if len(versions) != 2 || !versions[0].Deleted {
		t.Errorf("history: %+v", versions)
	}
	// only admins can still look at it
	if status, _ := e.as(alex).do("GET", "/api/history/process/"+repoP, nil); status != 404 {
		t.Errorf("an editor and a deleted process: %d", status)
	}
	if status, _ := e.as(dana).do("GET", "/api/history/process/"+repoP, nil); status != 200 {
		t.Errorf("an admin and a deleted process: %d", status)
	}
}
