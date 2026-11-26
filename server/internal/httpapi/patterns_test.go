package httpapi

import (
	"strings"
	"testing"
)

// The architecture patterns are a list like the paths: a pattern a process or standard is tagged
// with cannot be removed (the refusal names what uses it); one nothing names can; a save that
// names a pattern that is not in the list is refused; the lists keep them as they were saved.
func TestUsedPatternsCannotBeRemoved(t *testing.T) {
	e := setup(t, nil)
	status, out := e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("patterns", "api-first")))
	if status != 400 || !strings.Contains(out["error"].(string), "“api-first” is still used by “Onboard an API to Apigee”") {
		t.Fatalf("removing patterns/api-first: %d %v", status, out)
	}
	// serverless tags nothing in the sample: it can go
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("patterns", "serverless")))
	wantStatus(t, status, 200, out)
	// a pattern of its own with other names; one that is another pattern's name is refused
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["patterns"] = append(c["patterns"].([]any), map[string]any{"id": "cell-based", "name": "Cell-based", "alsoCalled": []string{"cells"}})
	}))
	wantStatus(t, status, 200, out)
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["patterns"].([]any)[5].(map[string]any)["alsoCalled"] = []string{"microservices"}
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "patterns[5].alsoCalled: The architecture pattern “Cell-based” is also called “microservices”, which is the name of the architecture pattern “Microservices”") {
		t.Fatalf("a clash: %d %v", status, out)
	}
	// a pattern has no picture
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(func(c map[string]any) {
		c["patterns"].([]any)[0].(map[string]any)["symbol"] = "road"
	}))
	if status != 400 || !strings.Contains(out["error"].(string), "patterns/0") {
		t.Fatalf("a picture: %d %v", status, out)
	}

	// a process tagged with a pattern that is not in the list is refused; one in the list is kept
	body := e.body("process", "request-gcp-project", `{`, `{"patterns":["soa"],`)
	status, out = e.as(alex).do("PUT", "/api/processes/request-gcp-project", body)
	if status != 400 || !strings.Contains(out["error"].(string), `patterns[0]: "soa" is not a known architecture pattern`) {
		t.Fatalf("an unknown pattern: %d %v", status, out)
	}
	body = e.body("process", "request-gcp-project", `{`, `{"patterns":["microservices","cell-based"],`)
	status, out = e.as(alex).do("PUT", "/api/processes/request-gcp-project", body)
	wantStatus(t, status, 200, out)
	status, out = e.as(alex).do("PUT", "/api/catalog", e.catalogWith(dropEntry("patterns", "cell-based")))
	if status != 400 || !strings.Contains(out["error"].(string), "“cell-based” is still used by “Request a GCP project”") {
		t.Fatalf("removing a pattern just tagged: %d %v", status, out)
	}
}
