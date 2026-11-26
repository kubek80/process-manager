package skills_test

import (
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/skills"
)

// A skill and a review agent name the architecture patterns their document is tagged with, with
// the patterns' other names, right after the paths; a document tagged with none has no such line.
func TestSkillsNameTheirArchitecturePatterns(t *testing.T) {
	_, c := sampleContext(t)
	out, err := skills.ForProcess(read(t, "processes/onboard-api-to-apigee.json"), c, nil)
	if err != nil || len(out) != 1 {
		t.Fatalf("got %d, %v", len(out), err)
	}
	wantAll(t, out[0].Body, "- Meant for the paths: Paved path (also called golden path, paved road)\n- Architecture patterns: API-first (also called contract-first, API-led)\n")

	// no sample standard is tagged: one that is, on the skill and on the review agent
	body := strings.Replace(string(read(t, "standards/infrastructure-as-code.json")), `"scope":`, `"patterns": ["microservices", "serverless"], "scope":`, 1)
	std, err := skills.ForStandard([]byte(body), c, nil)
	if err != nil || len(std) != 2 {
		t.Fatalf("got %d, %v", len(std), err)
	}
	for _, g := range std {
		wantAll(t, g.Body, "- Architecture patterns: Microservices (also called microservice architecture), Serverless (also called functions as a service, FaaS)\n")
	}

	none, err := skills.ForProcess(read(t, "processes/raise-servicenow-request.json"), c, nil)
	if err != nil || len(none) != 1 {
		t.Fatalf("got %d, %v", len(none), err)
	}
	if strings.Contains(none[0].Body, "Architecture patterns") {
		t.Fatalf("a process tagged with none names patterns:\n%s", none[0].Body)
	}
}
