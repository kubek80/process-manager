package skills_test

import (
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/skills"
)

// A skill and a review agent say which paths their document is for, with the path's other names
// (the paved path is the golden path), and how to read that line; a document that names none has
// no such line.
func TestSkillsSayWhichPathsTheyAreFor(t *testing.T) {
	_, c := sampleContext(t)
	out, err := skills.ForProcess(read(t, "processes/request-github-repository.json"), c, nil)
	if err != nil || len(out) != 1 {
		t.Fatalf("got %d, %v", len(out), err)
	}
	wantAll(t, out[0].Body, "- Applies to: all tiers; any language; all environments\n- Meant for the paths: Greenfield (also called green field), Paved path (also called golden path, paved road)\n",
		`- A "Meant for the paths" line above means this process is written only for work on those paths (for example greenfield: building something new); without that line it applies whatever the path.`)

	// no sample standard names a path (they apply to everyone): one that does
	body := strings.Replace(string(read(t, "standards/infrastructure-as-code.json")), `"scope":`, `"paths": ["paved-path"], "scope":`, 1)
	std, err := skills.ForStandard([]byte(body), c, nil)
	if err != nil || len(std) != 2 {
		t.Fatalf("got %d, %v", len(std), err)
	}
	for _, g := range std {
		wantAll(t, g.Body, "- Meant for the paths: Paved path (also called golden path, paved road)\n", `A "Meant for the paths" line above means`)
	}

	none, err := skills.ForProcess(read(t, "processes/raise-servicenow-request.json"), c, nil)
	if err != nil || len(none) != 1 {
		t.Fatalf("got %d, %v", len(none), err)
	}
	if strings.Contains(none[0].Body, "- Meant for the paths:") {
		t.Fatalf("a process for any path names paths:\n%s", none[0].Body)
	}
}
