package httpapi

import (
	"bytes"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/skills"
)

func TestASkillOfAProcessTakenBackToDraftDoesNotExistForReaders(t *testing.T) {
	e := setup(t, nil)
	id := skills.ProcessSkillID(gcp)
	if status, body := e.as(sam).do("GET", "/api/skills/"+id, nil); status != 200 {
		t.Fatalf("published: %d %v", status, body)
	}
	// an editor takes the published process back to draft
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"status": "active"`, `"status": "draft"`))
	wantStatus(t, status, 200, body)
	must(t, e.deps.Skills.SyncAll(bg, e.deps.Docs))
	if sk, err := e.deps.Skills.Get(bg, id); err != nil || sk.Active {
		t.Fatalf("the skill: %+v %v", sk, err)
	}
	downloads := func() int {
		var n int
		_ = e.deps.Docs.Pool.QueryRow(bg, `select coalesce(sum(downloads), 0) from document_counts where kind = 'process' and id = $1`, gcp).Scan(&n)
		return n
	}
	before := downloads()

	// for a reader every route answers exactly as for a skill that never existed
	reader := e.as(sam)
	routes := []struct{ method, path, body string }{
		{"GET", "/api/skills/%s", ""},
		{"GET", "/api/skills/%s/versions/1", ""},
		{"GET", "/api/skills/%s/download", ""},
		{"PUT", "/api/skills/%s/extra", `{"extra": "more"}`},
	}
	for _, rt := range routes {
		var payload any
		if rt.body != "" {
			payload = rt.body
		}
		path := strings.Replace(rt.path, "%s", id, 1)
		status, raw, h := reader.raw(rt.method, path, payload, true)
		wantStatus, wantRaw, wantH := reader.raw(rt.method, strings.Replace(rt.path, "%s", "process-never-there", 1), payload, true)
		if status != 404 || status != wantStatus || !bytes.Equal(raw, wantRaw) || h.Get("Content-Type") != wantH.Get("Content-Type") {
			t.Errorf("%s %s: %d %s, for an unknown id %d %s", rt.method, path, status, raw, wantStatus, wantRaw)
		}
		if strings.Contains(string(raw), "GCP") || strings.Contains(string(raw), gcp+"`") {
			t.Errorf("%s %s gives it away: %s", rt.method, path, raw)
		}
	}
	_, list := reader.do("GET", "/api/skills", nil)
	for _, sk := range list["skills"].([]any) {
		if m := sk.(map[string]any); m["sourceId"] == gcp || m["id"] == id {
			t.Errorf("listed for a reader: %v", m)
		}
	}
	if downloads() != before {
		t.Errorf("a reader's download of a draft's skill was counted")
	}

	// the editor still has it, inactive; downloading it counts nothing
	editor := e.as(alex)
	if status, body := editor.do("GET", "/api/skills/"+id, nil); status != 200 || body["skill"].(map[string]any)["active"] != false {
		t.Errorf("editor: %d %v", status, body)
	}
	if status, _, _ := editor.raw("GET", "/api/skills/"+id+"/versions/1", nil, false); status != 200 {
		t.Errorf("editor, version: %d", status)
	}
	if status, raw, _ := editor.raw("GET", "/api/skills/"+id+"/download", nil, false); status != 200 || !strings.Contains(string(raw), "GCP") {
		t.Errorf("editor, download: %d", status)
	}
	if downloads() != before {
		t.Errorf("a download of a draft's skill was counted")
	}
	_, list = editor.do("GET", "/api/skills", nil)
	found := false
	for _, sk := range list["skills"].([]any) {
		found = found || sk.(map[string]any)["id"] == id
	}
	if !found {
		t.Errorf("not listed for the editor")
	}
}

func TestFeedbackOnADraftDoesNotExistForWhoCannotSeeIt(t *testing.T) {
	e := setup(t, nil)
	it := e.as(sam).report(docs.Process, gcp, "", "The form has moved.")
	id, _ := it["id"].(string)
	if id == "" {
		t.Fatalf("feedback: %v", it)
	}
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, `"status": "active"`, `"status": "draft"`))
	wantStatus(t, status, 200, body)
	for _, who := range []string{sam, riley} {
		c := e.as(who)
		for _, rt := range []struct{ method, suffix, body string }{
			{"PATCH", "", `{"resolved": true}`},
			{"DELETE", "", ""},
			{"POST", "/also-hit", ""},
			{"DELETE", "/also-hit", ""},
		} {
			var payload any
			if rt.body != "" {
				payload = rt.body
			}
			status, raw, _ := c.raw(rt.method, "/api/feedback/"+id+rt.suffix, payload, true)
			wantStatus, wantRaw, _ := c.raw(rt.method, "/api/feedback/00000000-0000-0000-0000-000000000000"+rt.suffix, payload, true)
			if status != 404 || status != wantStatus || !bytes.Equal(raw, wantRaw) {
				t.Errorf("%s: %s %s: %d %s, for an unknown id %d %s", who, rt.method, rt.suffix, status, raw, wantStatus, wantRaw)
			}
		}
	}
	// whoever may see the draft still manages it
	status, body = e.as(alex).do("PATCH", "/api/feedback/"+id, map[string]bool{"resolved": true})
	wantStatus(t, status, 200, body)
}
