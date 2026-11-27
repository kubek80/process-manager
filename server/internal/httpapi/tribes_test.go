package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/upgrade"
)

// A pillar that teams are part of, a tribe that pillars are part of and a domain that tribes are
// part of cannot be removed: the refusal names who is still in it. Taken out of it in the same
// save, it can go. A team in a pillar the lists do not have, or a pillar in an unknown tribe, is
// refused; a team that names a tribe (the shape before pillars) is refused by the format.
func TestUsedPillarsTribesAndDomainsCannotBeRemoved(t *testing.T) {
	e := setup(t, nil)
	status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("pillars", "cloud-foundations")))
	if status != 400 || out["error"] != "cannot remove what is still in use: “cloud-foundations” is still used by the team “Azure Platform team”, the team “Cloud Platform team”. Change those first." {
		t.Fatalf("removing a pillar with teams: %d %v", status, out)
	}
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("tribes", "connectivity-tribe")))
	if status != 400 || out["error"] != "cannot remove what is still in use: “connectivity-tribe” is still used by the pillar “Core network”, the pillar “Edge and APIs”. Change those first." {
		t.Fatalf("removing a tribe with pillars: %d %v", status, out)
	}
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("domains", "engineering-enablement")))
	if status != 400 || !strings.Contains(out["error"].(string), "“engineering-enablement” is still used by the tribe “Developer tools”") {
		t.Fatalf("removing a domain with tribes: %d %v", status, out)
	}
	// the team taken out of the pillar in the same save: the pillar can go
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		for _, n := range c["teams"].([]any) {
			if m := n.(map[string]any); m["pillar"] == "engineering-productivity" {
				delete(m, "pillar")
			}
		}
		dropEntry("pillars", "engineering-productivity")(c)
	}))
	wantStatus(t, status, 200, out)
	// now no pillar is in Developer tools, a tribe without pillars, which is fine, and can go; then its domain
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("tribes", "developer-tools-tribe")))
	wantStatus(t, status, 200, out)
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("domains", "engineering-enablement")))
	wantStatus(t, status, 200, out)
	// a team in a pillar that is not in the list, a pillar in a tribe that is not
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["teams"].([]any)[0].(map[string]any)["pillar"] = "nowhere"
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "teams[0].pillar: The team “API Platform team” is part of the pillar “nowhere”, which is not in the list of pillars: choose another pillar, or none.") {
		t.Fatalf("an unknown pillar: %d %v", status, out)
	}
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["pillars"].([]any)[0].(map[string]any)["tribe"] = "nowhere"
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "pillars[0].tribe: The pillar “Cloud foundations” is part of the tribe “nowhere”, which is not in the list of tribes: choose another tribe, or none.") {
		t.Fatalf("an unknown tribe: %d %v", status, out)
	}
	// a team straight in a tribe no longer fits the format
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["teams"].([]any)[0].(map[string]any)["tribe"] = "cloud-tribe"
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "teams/0") {
		t.Fatalf("a team in a tribe: %d %v", status, out)
	}
	status, out = e.as(sam).do("GET", "/api/catalog", nil)
	wantStatus(t, status, 200, out)
	if len(out["pillars"].([]any)) != 5 || len(out["tribes"].([]any)) != 3 || len(out["domains"].([]any)) != 1 {
		t.Fatalf("%v %v %v", out["pillars"], out["tribes"], out["domains"])
	}
}

// Yesterday's lists (teams straight in a tribe), converted at start, as the server then serves
// them: every team that was in a tribe is in a pillar of that tribe, and the lists can be saved.
func TestListsBeforePillarsAreServedConverted(t *testing.T) {
	e := setup(t, nil)
	var lists map[string]any
	must(t, json.Unmarshal([]byte(e.body(docs.Catalog, docs.CatalogID, "", "")), &lists))
	delete(lists, "pillars")
	for _, n := range lists["teams"].([]any) {
		m := n.(map[string]any)
		if m["pillar"] == "cloud-foundations" {
			m["tribe"] = "cloud-tribe"
		}
		delete(m, "pillar")
	}
	old, _ := json.Marshal(lists)
	if _, _, err := e.deps.Docs.Put(bg, docs.Catalog, docs.CatalogID, old, "yesterday"); err != nil {
		t.Fatal(err)
	}
	report, err := upgrade.Convert(bg, e.deps.Docs.Pool, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil || report.Pillars != 1 || report.TeamsInPillars != 2 {
		t.Fatalf("%+v %v", report, err)
	}
	status, out := e.as(sam).do("GET", "/api/catalog", nil)
	wantStatus(t, status, 200, out)
	pillars := out["pillars"].([]any)
	if len(pillars) != 1 || pillars[0].(map[string]any)["id"] != "cloud-tribe" || pillars[0].(map[string]any)["name"] != "Cloud" || pillars[0].(map[string]any)["tribe"] != "cloud-tribe" {
		t.Fatalf("pillars: %v", pillars)
	}
	for _, n := range out["teams"].([]any) {
		m := n.(map[string]any)
		if _, has := m["tribe"]; has {
			t.Fatalf("a team still names a tribe: %v", m)
		}
		if (m["id"] == "cloud-platform-team" || m["id"] == "azure-platform-team") != (m["pillar"] == "cloud-tribe") {
			t.Fatalf("team: %v", m)
		}
	}
	// and the converted lists are saved again as they are
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(map[string]any) {}))
	wantStatus(t, status, 200, out)
}
