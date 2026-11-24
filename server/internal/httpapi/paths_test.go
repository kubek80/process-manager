package httpapi

import (
	"strings"
	"testing"
)

// The paths (greenfield, brownfield, paved path) are a list like the tiers: a path that a
// process or standard names cannot be removed; one nothing names can; a save that names a path
// that is not in the list is refused.
func TestUsedPathsCannotBeRemoved(t *testing.T) {
	e := setup(t, nil)
	for _, c := range []struct{ id, usedBy string }{
		{"paved-path", "Request a GCP project"},
		{"greenfield", "Request a repository"},
	} {
		status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("paths", c.id)))
		if status != 400 || !strings.Contains(out["error"].(string), "“"+c.id+"” is still used by") || !strings.Contains(out["error"].(string), c.usedBy) {
			t.Errorf("removing paths/%s: %d %v", c.id, status, out)
		}
	}
	// a path of its own, nothing names it: it can go again
	status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["paths"] = append(c["paths"].([]any), map[string]any{"id": "lift-and-shift", "name": "Lift and shift", "symbol": "bridge", "alsoCalled": []string{"rehost"}})
	}))
	wantStatus(t, status, 200, out)
	// a picture the portal does not draw is refused by the format
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["paths"].([]any)[3].(map[string]any)["symbol"] = "unicorn"
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "paths/3/symbol") {
		t.Fatalf("an unknown picture: %d %v", status, out)
	}
	// an other name belongs to one path only, and is no other path's name
	for _, c := range []struct {
		also []string
		want string
	}{
		{[]string{"Golden Path"}, "paths[3].alsoCalled: The paths “Paved path” and “Lift and shift” are both also called “Golden Path”: keep it on one of them."},
		{[]string{"brownfield"}, "paths[3].alsoCalled: The path “Lift and shift” is also called “brownfield”, which is the name of the path “Brownfield”: take it off “Lift and shift”."},
		{[]string{"a", "a"}, "paths/3/alsoCalled"},
		{[]string{" "}, "paths/3/alsoCalled/0"},
		{[]string{"a", "b", "c", "d", "e", "f"}, "paths/3/alsoCalled"},
	} {
		status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(m map[string]any) {
			m["paths"].([]any)[3].(map[string]any)["alsoCalled"] = c.also
		}))
		if status != 400 || !strings.Contains(out["error"].(string), c.want) {
			t.Errorf("other names %v: %d %v", c.also, status, out)
		}
	}
	// brownfield is named by nothing in the sample: it can go, like the path of its own
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("paths", "lift-and-shift")))
	wantStatus(t, status, 200, out)
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("paths", "brownfield")))
	wantStatus(t, status, 200, out)

	// a process that names a path not in the list is refused
	body := strings.Replace(e.body("process", "request-gcp-project", "", ""), `"paved-path"`, `"golden-path"`, 1)
	status, out = e.as(alex).do("PUT", "/api/processes/request-gcp-project", body)
	if status != 400 || !strings.Contains(out["error"].(string), `"golden-path" is not a known path`) {
		t.Fatalf("an unknown path: %d %v", status, out)
	}
}
