package httpapi

import (
	"strings"
	"testing"
)

// A tribe that teams are part of, and a domain that tribes are part of, cannot be removed: the
// refusal names who is still in it. Taken out of it in the same save, it can go. A team in a tribe
// the lists do not have is refused; the sample's tribes and domains load as they are.
func TestUsedTribesAndDomainsCannotBeRemoved(t *testing.T) {
	e := setup(t, nil)
	status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("tribes", "cloud-tribe")))
	if status != 400 || out["error"] != "cannot remove what is still in use: “cloud-tribe” is still used by the team “Azure Platform team”, the team “Cloud Platform team”. Change those first." {
		t.Fatalf("removing a tribe with teams: %d %v", status, out)
	}
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("domains", "engineering-enablement")))
	if status != 400 || !strings.Contains(out["error"].(string), "“engineering-enablement” is still used by the tribe “Developer tools”") {
		t.Fatalf("removing a domain with tribes: %d %v", status, out)
	}
	// the team taken out of the tribe in the same save: the tribe can go
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		for _, n := range c["teams"].([]any) {
			if m := n.(map[string]any); m["tribe"] == "developer-tools-tribe" {
				delete(m, "tribe")
			}
		}
		dropEntry("tribes", "developer-tools-tribe")(c)
	}))
	wantStatus(t, status, 200, out)
	// now no tribe is in Engineering enablement, a domain without tribes, which is fine, and can go
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("domains", "engineering-enablement")))
	wantStatus(t, status, 200, out)
	// a team in a tribe that is not in the list
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["teams"].([]any)[0].(map[string]any)["tribe"] = "nowhere"
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "teams[0].tribe: The team “API Platform team” is part of the tribe “nowhere”, which is not in the list of tribes: choose another tribe, or none.") {
		t.Fatalf("an unknown tribe: %d %v", status, out)
	}
	// a team owner changing the details of the team keeps its tribe (see groups_test); readers get the lists with them
	status, out = e.as(sam).do("GET", "/api/catalog", nil)
	wantStatus(t, status, 200, out)
	if len(out["tribes"].([]any)) != 3 || len(out["domains"].([]any)) != 1 {
		t.Fatalf("%v %v", out["tribes"], out["domains"])
	}
}
