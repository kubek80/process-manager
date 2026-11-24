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
		{"paved-path", "Infrastructure as code"},
		{"greenfield", "Request a GCP project"},
		{"brownfield", "Onboard a site to Akamai"},
	} {
		status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("paths", c.id)))
		if status != 400 || !strings.Contains(out["error"].(string), "“"+c.id+"” is still used by") || !strings.Contains(out["error"].(string), c.usedBy) {
			t.Errorf("removing paths/%s: %d %v", c.id, status, out)
		}
	}
	// a path of its own, nothing names it: it can go again
	status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["paths"] = append(c["paths"].([]any), map[string]any{"id": "lift-and-shift", "name": "Lift and shift", "symbol": "bridge"})
	}))
	wantStatus(t, status, 200, out)
	// a picture the portal does not draw is refused by the format
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["paths"].([]any)[3].(map[string]any)["symbol"] = "unicorn"
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "paths/3/symbol") {
		t.Fatalf("an unknown picture: %d %v", status, out)
	}
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("paths", "lift-and-shift")))
	wantStatus(t, status, 200, out)

	// a process that names a path not in the list is refused
	body := strings.Replace(e.body("process", "request-gcp-project", "", ""), `"paved-path"`, `"golden-path"`, 1)
	status, out = e.as(alex).do("PUT", "/api/processes/request-gcp-project", body)
	if status != 400 || !strings.Contains(out["error"].(string), `"golden-path" is not a known path`) {
		t.Fatalf("an unknown path: %d %v", status, out)
	}
}
