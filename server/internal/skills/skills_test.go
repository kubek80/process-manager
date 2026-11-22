package skills_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/skills"
)

var ctx = context.Background()

const repo = "../../.."

func read(t *testing.T, rel string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(repo, rel))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// a context built from the sample content of the repository
func sampleContext(t *testing.T) (*docs.Store, skills.Context) {
	t.Helper()
	d := &docs.Store{Pool: dbtest.NewPool(t)}
	if _, problems, err := d.ImportDir(ctx, repo, "import", nil); err != nil || len(problems) > 0 {
		t.Fatalf("import: %v %v", problems, err)
	}
	c, err := skills.NewContext(ctx, d)
	if err != nil {
		t.Fatal(err)
	}
	return d, c
}

func wantAll(t *testing.T, text string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if !strings.Contains(text, p) {
			t.Errorf("missing %q", p)
		}
	}
}

func TestProcessSkill(t *testing.T) {
	_, c := sampleContext(t)
	out, err := skills.ForProcess(read(t, "processes/request-gcp-project.json"), c, nil)
	if err != nil || len(out) != 1 {
		t.Fatalf("got %d, %v", len(out), err)
	}
	g := out[0]
	if g.ID != "process-request-gcp-project" || g.Kind != skills.KindSkill || g.Title != "Process: Request a GCP project" {
		t.Fatalf("meta: %+v", g)
	}
	wantAll(t, g.Body,
		"---\nname: process-request-gcp-project\ndescription: \"Follow the company process “Request a GCP project”",
		"# Process: Request a GCP project",
		"- Owner: Cloud Platform team (Group email: cloud-platform@example.com; Slack: #cloud-platform (https://example.slack.com/archives/C0CLOUDPLAT); Other: Slack #cloud-platform)\n- Category: Cloud\n- Platform: Google Cloud (Group email: cloud-platform@example.com; Slack: #cloud-platform (https://example.slack.com/archives/C0CLOUDPLAT); Confluence: https://example.atlassian.net/wiki/spaces/CLOUD; Request form: https://forms.example.com/cloud-platform/request; Other: Slack #cloud-platform)\n"+
			"- Rigour: Mandatory - this is the only allowed way to get this done.\n- Applies to: all tiers; any language; all environments\n",
		"Never perform a step of another participant, and never approve anything.",
		"## Before you start",
		"If missing: follow the process “Request a repository” (skill `process-request-github-repository`).",
		"Skill that does this for you: Skill: add a GCP project <https://github.example.com/platform/gcp-project-factory/tree/main/.claude/skills/add-project>",
		"1. **You** - Decide the project details (task, 15 min)",
		"   - Build the name as <app>-<env>, e.g. payments-dev.",
		"2. **You** - Raise the 'New GCP project' request (subprocess, in ServiceNow)",
		"follow the skill `process-raise-servicenow-request`",
		"3. **Budget owner** - Approve the monthly budget (approval, up to 2 working days)",
		"   - If “Yes”: go to step 7.",
		"   - If “No”: go to step 6.",
		"   - Then go to step 4.", // the loop back after clarifying
		"   - This ends the process.",
		"## Standards this process helps to meet\n\n- Infrastructure as code (skill `standard-infrastructure-as-code`)",
	)
	// instructions of other people's steps are not for the agent
	if strings.Contains(g.Body, "**Budget owner** - Approve the monthly budget (approval, up to 2 working days)\n   - ") &&
		!strings.Contains(g.Body, "4. **Cloud Platform team**") {
		t.Error("steps of others must not carry actions")
	}
	// the front matter must stay one line each, whatever the summary contains
	if head := strings.SplitN(g.Body, "---\n\n", 2)[0]; strings.Count(head, "\n") != 3 {
		t.Errorf("front matter:\n%s", head)
	}
}

func TestPlacementIsOnlyWhatIsSet(t *testing.T) {
	_, c := sampleContext(t)
	// both a practice and a platform, rigour recommended
	out, _ := skills.ForProcess(read(t, "processes/publish-internal-library.json"), c, nil)
	wantAll(t, out[0].Body, "- Category: Source control\n- Practice: Engineering (Group email: engineering-practice@example.com; Slack: #engineering-practice; Google Chat: Engineering practice (https://chat.google.com/room/AAAAengineering); Confluence: https://example.atlassian.net/wiki/spaces/ENG; Other: Slack #engineering-practice)\n- Platform: GitHub (Slack #devex)\n- Rigour: Recommended - this is the expected way; another way needs a good reason.\n")
	// nothing set: no lines; an id that is not in the lists (yet) is shown as it is
	body := strings.NewReplacer(`"category": "cloud",`, "", `"platform": "google-cloud",`, `"practice": "not-listed",`, `"rigour": "mandatory",`, "").
		Replace(string(read(t, "processes/request-gcp-project.json")))
	out, _ = skills.ForProcess([]byte(body), c, nil)
	if strings.Contains(out[0].Body, "- Category:") || strings.Contains(out[0].Body, "- Platform:") || strings.Contains(out[0].Body, "- Rigour:") ||
		!strings.Contains(out[0].Body, "- Practice: not-listed\n") {
		t.Fatalf("placement:\n%s", out[0].Body[:600])
	}
	// the same source gives the same text
	again, _ := skills.ForProcess([]byte(body), c, nil)
	if again[0].Body != out[0].Body {
		t.Fatal("generation must be repeatable")
	}
	std, _ := skills.ForStandard(read(t, "standards/infrastructure-as-code.json"), c, nil)
	wantAll(t, std[0].Body, "- Category: Cloud\n- Practice: Engineering (Group email: engineering-practice@example.com; Slack: #engineering-practice; Google Chat: Engineering practice (https://chat.google.com/room/AAAAengineering); Confluence: https://example.atlassian.net/wiki/spaces/ENG; Other: Slack #engineering-practice)\n- Platform: Google Cloud (Group email: cloud-platform@example.com; Slack: #cloud-platform (https://example.slack.com/archives/C0CLOUDPLAT); Confluence: https://example.atlassian.net/wiki/spaces/CLOUD; Request form: https://forms.example.com/cloud-platform/request; Other: Slack #cloud-platform)\n")
	if strings.Contains(std[0].Body, "- Rigour:") {
		t.Fatal("a standard has no rigour of its own")
	}
}

func TestProcessSkillParallelPathsAndExtra(t *testing.T) {
	_, c := sampleContext(t)
	out, _ := skills.ForProcess(read(t, "processes/onboard-site-to-akamai.json"), c, map[string]string{"process-onboard-site-to-akamai": "  Ask in #edge-cdn before starting.  "})
	wantAll(t, out[0].Body,
		"- Applies to: tiers Tier 0, Tier 1; any language; environments Staging, Production",
		"   - Also continue with step 3 (in parallel).",
		"## Additional guidance\n\nAsk in #edge-cdn before starting.\n",
	)
}

func TestNoSkillForDraftsRetiredOrBrokenSources(t *testing.T) {
	_, c := sampleContext(t)
	for _, status := range []string{"draft", "deprecated"} {
		body := strings.Replace(string(read(t, "processes/request-gcp-project.json")), `"status": "active"`, `"status": "`+status+`"`, 1)
		if out, err := skills.ForProcess([]byte(body), c, nil); err != nil || len(out) != 0 {
			t.Errorf("process %s: %d %v", status, len(out), err)
		}
		body = strings.Replace(string(read(t, "standards/secure-logging.json")), `"status": "active"`, `"status": "`+status+`"`, 1)
		if out, err := skills.ForStandard([]byte(body), c, nil); err != nil || len(out) != 0 {
			t.Errorf("standard %s: %d %v", status, len(out), err)
		}
	}
	if _, err := skills.ForProcess([]byte("{nope"), c, nil); err == nil {
		t.Error("broken process must be an error")
	}
	if _, err := skills.ForStandard([]byte("[]"), c, nil); err == nil {
		t.Error("broken standard must be an error")
	}
	// a status left out counts as active
	if out, _ := skills.ForStandard([]byte(`{"id":"s","title":"S","summary":"x","owner":"nobody","requirements":[{"id":"A-1","title":"T","level":"may","statement":"Do it.","verification":{"method":"manual"}}]}`), c, nil); len(out) != 1 {
		t.Errorf("no status: %d items", len(out))
	}
}

func TestStandardSkillAndReviewAgent(t *testing.T) {
	_, c := sampleContext(t)
	out, err := skills.ForStandard(read(t, "standards/secure-logging.json"), c, map[string]string{"review-secure-logging": "Ignore test fixtures."})
	if err != nil || len(out) != 2 {
		t.Fatalf("got %d, %v", len(out), err)
	}
	skill, agent := out[0], out[1]
	if skill.ID != "standard-secure-logging" || skill.Kind != skills.KindSkill || agent.ID != "review-secure-logging" || agent.Kind != skills.KindReview {
		t.Fatalf("ids: %s %s", skill.ID, agent.ID)
	}
	wantAll(t, skill.Body,
		"name: standard-secure-logging\n",
		"# Standard: Secure logging",
		"- Issued by: Cyber Security (Slack #security)\n- Category: Security\n- Practice: Cyber security (Group email: security@example.com; Slack: #security; Request form: https://forms.example.com/security/ask; Other: Slack #security)\n- Applies to: ",
		"- Scope: All services and jobs",
		"- Meet every **MUST**. If you cannot, stop and tell the person",
		"### SEC-LOG-01 · No secrets in logs · MUST",
		"Why: Logs are read by many people",
		"- Log the name of a credential, never its value.",
		"Good:\n\n```\nlog.Info(\"calling billing API\", \"key_id\", key.ID)\n```",
		"Bad:\n\n```\nlog.Info(\"calling billing API\", \"key\", apiKey)\n```",
		"Checked: automated - Secret scanner on log statements in the build pipeline, plus code review.",
		"### SEC-LOG-03 · Log security events · MUST",
		"Applies only to: tiers Tier 0, Tier 1.",
		"Applies only to: environments Production.",
		"### SEC-LOG-05 · Structured logs · SHOULD",
		"## Exceptions\n\nA MUST can only be waived by the team that issued the standard. Ask Cyber Security (Slack #security).",
		"## Background\n\n- Link: Information security policy <https://wiki.example.com/security/policy>",
	)
	if strings.Contains(skill.Body, "Ignore test fixtures.") {
		t.Error("extra guidance of the agent leaked into the skill")
	}
	wantAll(t, agent.Body,
		"name: review-secure-logging\n", "tools: Read, Grep, Glob, Bash\n",
		"- Issued by: Cyber Security (Slack #security)\n- Category: Security\n- Practice: Cyber security (Group email: security@example.com; Slack: #security; Request form: https://forms.example.com/security/ask; Other: Slack #security)\n",
		"You review changes against the standard **Secure logging**. You only read; you never change files.",
		"### SEC-LOG-01 · No secrets in logs · MUST · report as blocker",
		"- A variable named like password, secret, token, apiKey or authorization passed to a log call",
		"Suggest as the fix: Log the name of a credential, never its value.",
		"### SEC-LOG-03 · Log security events · MUST · report as warning", // severity set by the author
		"Only for: tiers Tier 0, Tier 1.",
		"### SEC-LOG-05 · Structured logs · SHOULD · report as info",
		"Files: `**/*.go`, `**/*.ts`, `**/*.js`, `**/*.py`",
		"## Not checked in this review",
		"- SEC-LOG-04 Central log shipping in production (automated: Platform policy check on the deployment.)",
		"[blocker|warning|info] REQUIREMENT-ID path/to/file:line - what is wrong - how to fix it",
		"`Blocks merge: yes`",
		"No violations of “Secure logging” found.",
		"## Additional guidance\n\nIgnore test fixtures.",
	)
	if strings.Contains(agent.Body, "### SEC-LOG-04") {
		t.Error("a requirement without review hints must not be checked by the agent")
	}
}

func TestStandardDefaultsAndExceptionProcess(t *testing.T) {
	_, c := sampleContext(t)
	out, _ := skills.ForStandard(read(t, "standards/infrastructure-as-code.json"), c, nil)
	wantAll(t, out[0].Body,
		"Follow the process “Raise a ServiceNow request” (skill `process-raise-servicenow-request`).",
		"Helpful process: “Request a GCP project” (skill `process-request-gcp-project`).",
		"Applies only to: environments Test, Staging, Production.",
	)
	// severity follows the level when the author did not set one
	body := `{"id":"s","title":"S","summary":"x","owner":"security","requirements":[
	 {"id":"A-1","title":"Must","level":"must","statement":"x","verification":{"method":"review"},"review":{"lookFor":["a"]}},
	 {"id":"A-2","title":"Should","level":"should","statement":"x","verification":{"method":"review"},"review":{"lookFor":["b"]}},
	 {"id":"A-3","title":"May","level":"may","statement":"x","verification":{"method":"review"},"review":{"lookFor":["c"]}}]}`
	out, _ = skills.ForStandard([]byte(body), c, nil)
	wantAll(t, out[1].Body, "A-1 · Must · MUST · report as blocker", "A-2 · Should · SHOULD · report as warning", "A-3 · May · MAY · report as info")
	if strings.Contains(out[1].Body, "## Not checked in this review") {
		t.Error("nothing is skipped here")
	}
	// no review hints at all: a skill, but no agent
	out, _ = skills.ForStandard([]byte(`{"id":"s","title":"S","summary":"x","owner":"","requirements":[{"id":"A-1","title":"T","level":"must","statement":"x","verification":{"method":"manual"}}]}`), c, nil)
	if len(out) != 1 || !strings.Contains(out[0].Body, "- Issued by: no owner set") {
		t.Fatalf("got %d items", len(out))
	}
}

func TestSyncVersionsOnlyWhenTheTextChanges(t *testing.T) {
	d, _ := sampleContext(t)
	s := &skills.Store{Pool: d.Pool}
	if err := s.SyncAll(ctx, d); err != nil {
		t.Fatal(err)
	}
	list, err := s.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// 7 processes -> 7 skills; 3 standards -> 3 skills + 3 review agents
	byKind := map[string]int{}
	for _, sk := range list {
		byKind[sk.SourceKind+"/"+sk.Kind]++
		if !sk.Active || sk.Version != 1 {
			t.Errorf("%s: active=%v version=%d", sk.ID, sk.Active, sk.Version)
		}
	}
	if byKind["process/skill"] != 7 || byKind["standard/skill"] != 3 || byKind["standard/review-agent"] != 3 {
		t.Fatalf("generated: %v", byKind)
	}
	sk, err := s.Get(ctx, "review-secure-logging")
	if err != nil || sk.Path != ".claude/agents/review-secure-logging.md" || sk.Title != "Review: Secure logging" {
		t.Fatalf("get: %+v %v", sk, err)
	}
	if p, _ := s.Get(ctx, "process-request-gcp-project"); p.Path != ".claude/skills/process-request-gcp-project/SKILL.md" {
		t.Fatalf("path: %s", p.Path)
	}
	content, _ := s.Content(ctx, "standard-secure-logging", 0)
	wantAll(t, content, "Generated by Process Manager from the standard `secure-logging`, version 1. This is version 1 of the generated text. Do not edit")

	// nothing changed: no new versions
	if err := s.SyncAll(ctx, d); err != nil {
		t.Fatal(err)
	}
	if again, _ := s.Get(ctx, "standard-secure-logging"); again.Version != 1 {
		t.Fatalf("re-sync created version %d", again.Version)
	}

	// the standard changes: its skill and its review agent get version 2, nothing else moves
	c, _ := skills.NewContext(ctx, d)
	body := strings.Replace(string(read(t, "standards/secure-logging.json")), "never written to logs", "never ever written to logs", 1)
	d.Put(ctx, docs.Standard, "secure-logging", []byte(body), "riley")
	if err := s.SyncSource(ctx, docs.Standard, "secure-logging", c); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]int{"standard-secure-logging": 2, "review-secure-logging": 2, "standard-code-review": 1, "process-request-gcp-project": 1} {
		if got, _ := s.Get(ctx, id); got.Version != want {
			t.Errorf("%s: version %d, want %d", id, got.Version, want)
		}
	}
	latest, _ := s.Content(ctx, "standard-secure-logging", 0)
	first, _ := s.Content(ctx, "standard-secure-logging", 1)
	if !strings.Contains(latest, "never ever written") || strings.Contains(first, "never ever written") || !strings.Contains(latest, "version 2. This is version 2 of the generated text.") {
		t.Fatal("versions must keep their own text")
	}
	versions, _ := s.Versions(ctx, "standard-secure-logging")
	if len(versions) != 2 || versions[0].Version != 2 || versions[0].SourceVersion != 2 || versions[1].SourceVersion != 1 {
		t.Fatalf("versions: %+v", versions)
	}
	if _, err := s.Content(ctx, "standard-secure-logging", 9); !errors.Is(err, skills.ErrNotFound) {
		t.Fatalf("unknown version: %v", err)
	}
	if _, err := s.Get(ctx, "nope"); !errors.Is(err, skills.ErrNotFound) {
		t.Fatalf("unknown skill: %v", err)
	}
}

func TestExtraGuidanceSurvivesAndVersions(t *testing.T) {
	d, c := sampleContext(t)
	s := &skills.Store{Pool: d.Pool}
	s.SyncAll(ctx, d)
	if err := s.SetExtra(ctx, "review-code-review", "Generated files are exempt from REV-03."); err != nil {
		t.Fatal(err)
	}
	if err := s.SetExtra(ctx, "nope", "x"); !errors.Is(err, skills.ErrNotFound) {
		t.Fatalf("unknown skill: %v", err)
	}
	doc, _ := d.Get(ctx, docs.Standard, "code-review")
	s.SyncSource(ctx, docs.Standard, "code-review", c)
	agent, _ := s.Get(ctx, "review-code-review")
	skill, _ := s.Get(ctx, "standard-code-review")
	if agent.Version != 2 || agent.Extra != "Generated files are exempt from REV-03." || skill.Version != 1 {
		t.Fatalf("agent v%d, skill v%d", agent.Version, skill.Version)
	}
	// the source changes later: the guidance is still there
	d.Put(ctx, docs.Standard, "code-review", []byte(strings.Replace(string(doc.Body), "about 400", "about 300", 1)), "x")
	s.SyncSource(ctx, docs.Standard, "code-review", c)
	content, _ := s.Content(ctx, "review-code-review", 0)
	wantAll(t, content, "about 300", "Generated files are exempt from REV-03.", "version 2. This is version 3 of the generated text.")
}

func TestWithdrawnWhenTheSourceIsRetiredOrDeleted(t *testing.T) {
	d, c := sampleContext(t)
	s := &skills.Store{Pool: d.Pool}
	s.SyncAll(ctx, d)

	// retired: both items are withdrawn but keep their history
	doc, _ := d.Get(ctx, docs.Standard, "secure-logging")
	d.Put(ctx, docs.Standard, "secure-logging", []byte(strings.Replace(string(doc.Body), `"status": "active"`, `"status": "deprecated"`, 1)), "riley")
	s.SyncSource(ctx, docs.Standard, "secure-logging", c)
	for _, id := range []string{"standard-secure-logging", "review-secure-logging"} {
		sk, _ := s.Get(ctx, id)
		if sk.Active || sk.Version != 1 {
			t.Errorf("%s after retiring: %+v", id, sk)
		}
	}
	// active again with the same text: back, without a new version
	d.Put(ctx, docs.Standard, "secure-logging", doc.Body, "riley")
	s.SyncSource(ctx, docs.Standard, "secure-logging", c)
	if sk, _ := s.Get(ctx, "standard-secure-logging"); !sk.Active || sk.Version != 1 {
		t.Fatalf("after reactivating: %+v", sk)
	}

	// deleted in the portal: SyncAll notices
	d.Delete(ctx, docs.Process, "request-gcp-project", "alex")
	if err := s.SyncAll(ctx, d); err != nil {
		t.Fatal(err)
	}
	if sk, _ := s.Get(ctx, "process-request-gcp-project"); sk.Active {
		t.Fatal("the skill of a deleted process must be withdrawn")
	}
	list, _ := s.List(ctx)
	if list[len(list)-1].ID != "process-request-gcp-project" {
		t.Fatal("withdrawn skills are listed last")
	}

	// export writes only what is active, in the layout a repository expects
	out := t.TempDir()
	n, err := s.ExportDir(ctx, out)
	if err != nil || n != 12 {
		t.Fatalf("export: %d %v", n, err)
	}
	for _, rel := range []string{".claude/skills/standard-secure-logging/SKILL.md", ".claude/agents/review-code-review.md", ".claude/skills/process-request-github-repository/SKILL.md"} {
		if _, err := os.Stat(filepath.Join(out, rel)); err != nil {
			t.Errorf("missing %s", rel)
		}
	}
	if _, err := os.Stat(filepath.Join(out, ".claude/skills/process-request-gcp-project/SKILL.md")); err == nil {
		t.Error("a withdrawn skill was exported")
	}
}
