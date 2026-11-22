// Package skills turns processes and standards into instructions for AI coding assistants:
// skills (how to do the work) and review agents (how to check a pull request). Generation is
// plain templating, no AI involved, so the same source always gives the same text.
package skills

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// Kinds of generated item.
const (
	KindSkill  = "skill"
	KindReview = "review-agent"
)

type resource struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Kind        string `json:"kind"`
	Description string `json:"description"`
}

type process struct {
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	Summary           string   `json:"summary"`
	Owner             string   `json:"owner"`
	Category          string   `json:"category"`
	Practice          string   `json:"practice"`
	Platform          string   `json:"platform"`
	Rigour            string   `json:"rigour"`
	EstimatedDuration string   `json:"estimatedDuration"`
	Status            string   `json:"status"`
	Tiers             []string `json:"tiers"`
	Languages         []string `json:"languages"`
	Environments      []string `json:"environments"`
	Standards         []string `json:"standards"`
	Prerequisites     []struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		URL         string `json:"url"`
		ProcessID   string `json:"processId"`
	} `json:"prerequisites"`
	Actors []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"actors"`
	Steps []struct {
		ID           string     `json:"id"`
		Title        string     `json:"title"`
		Actor        string     `json:"actor"`
		Type         string     `json:"type"`
		Description  string     `json:"description"`
		Instructions []string   `json:"instructions"`
		Tool         string     `json:"tool"`
		URL          string     `json:"url"`
		URLLabel     string     `json:"urlLabel"`
		Duration     string     `json:"duration"`
		Outcome      string     `json:"outcome"`
		SubProcessID string     `json:"subProcessId"`
		Resources    []resource `json:"resources"`
		Next         []struct {
			To    string `json:"to"`
			Label string `json:"label"`
		} `json:"next"`
	} `json:"steps"`
	Resources []resource `json:"resources"`
}

type requirement struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Level     string   `json:"level"`
	Statement string   `json:"statement"`
	Rationale string   `json:"rationale"`
	Guidance  []string `json:"guidance"`
	Examples  struct {
		Good []string `json:"good"`
		Bad  []string `json:"bad"`
	} `json:"examples"`
	Verification struct {
		Method      string `json:"method"`
		Description string `json:"description"`
	} `json:"verification"`
	Review *struct {
		LookFor  []string `json:"lookFor"`
		Paths    []string `json:"paths"`
		Severity string   `json:"severity"`
	} `json:"review"`
	Tiers        []string `json:"tiers"`
	Languages    []string `json:"languages"`
	Environments []string `json:"environments"`
	ProcessID    string   `json:"processId"`
}

type standard struct {
	ID                 string        `json:"id"`
	Title              string        `json:"title"`
	Summary            string        `json:"summary"`
	Owner              string        `json:"owner"`
	Category           string        `json:"category"`
	Practice           string        `json:"practice"`
	Platform           string        `json:"platform"`
	Scope              string        `json:"scope"`
	Status             string        `json:"status"`
	Tiers              []string      `json:"tiers"`
	Languages          []string      `json:"languages"`
	Environments       []string      `json:"environments"`
	ExceptionProcessID string        `json:"exceptionProcessId"`
	Resources          []resource    `json:"resources"`
	Requirements       []requirement `json:"requirements"`
}

// Context is what the generators need besides the document itself.
type Context struct {
	Lists docs.Lists
	// Titles of the processes and standards that exist, by "process/<id>" and "standard/<id>".
	Titles map[string]string
	// Inactive marks the drafts and retired ones among them: they have no skill to point to.
	Inactive map[string]bool
	// Drafts marks the ones that are not published. Skills are read by everyone, so a skill
	// must not give away the title of a draft: it names it by its id, which the document that
	// refers to it shows anyway.
	Drafts map[string]bool
}

// skill is the pointer to the skill of another document, or nothing when that document does
// not exist, is a draft or is retired - a pointer to a skill that is not there misleads.
func (c Context) skill(kind, id, skillID string) string {
	key := kind + "/" + id
	if c.Titles[key] == "" || c.Inactive[key] {
		return ""
	}
	return " (skill `" + skillID + "`)"
}

// Generated is one skill or review agent, without its version footer.
type Generated struct {
	ID    string
	Kind  string
	Title string
	Body  string
}

// IDs of the items generated from a source.
func ProcessSkillID(id string) string  { return "process-" + id }
func StandardSkillID(id string) string { return "standard-" + id }
func ReviewAgentID(id string) string   { return "review-" + id }

func active(status string) bool { return status == "" || status == "active" }

// yamlString quotes a value for the front matter.
func yamlString(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

func frontMatter(name, description string, more ...string) string {
	var b strings.Builder
	b.WriteString("---\nname: " + name + "\ndescription: " + yamlString(description) + "\n")
	for _, line := range more {
		b.WriteString(line + "\n")
	}
	b.WriteString("---\n\n")
	return b.String()
}

func (c Context) appliesTo(tiers, languages, environments []string) string {
	part := func(label string, list []docs.Named, ids []string, all string) string {
		if len(ids) == 0 {
			return all
		}
		return label + " " + strings.Join(docs.Names(list, ids), ", ")
	}
	return strings.Join([]string{
		part("tiers", c.Lists.Tiers, tiers, "all tiers"),
		part("languages", c.Lists.Languages, languages, "any language"),
		part("environments", c.Lists.Environments, environments, "all environments"),
	}, "; ")
}

func (c Context) team(id string) string {
	t, ok := c.Lists.Team(id)
	if !ok {
		if id == "" {
			return "no owner set"
		}
		return id
	}
	return withReach(t)
}

// withReach is the name of an entry of the lists with how to reach it, when that is given:
// "Cloud Platform team (Group email: cloud@example.com; Slack: #cloud-platform)".
func withReach(n docs.Named) string {
	if reach := n.Reach(); reach != "" {
		return n.Name + " (" + reach + ")"
	}
	return n.Name
}

// named is an entry of a list by name, with how to reach it; the id when it is not in the list.
func named(list []docs.Named, id string) string {
	for _, n := range list {
		if n.ID == id {
			return withReach(n)
		}
	}
	return id
}

// rigour says in plain words how binding a process is.
var rigour = map[string]string{
	"mandatory":   "Mandatory - this is the only allowed way to get this done.",
	"recommended": "Recommended - this is the expected way; another way needs a good reason.",
	"optional":    "Optional - a help that may be used.",
}

// placement writes the lines that say where a process or standard sits: its category,
// practice and platform, by name, each only when it is set.
func (c Context) placement(b *strings.Builder, category, practice, platform string) {
	if category != "" {
		fmt.Fprintf(b, "- Category: %s\n", docs.Name(c.Lists.Categories, category))
	}
	if practice != "" {
		fmt.Fprintf(b, "- Practice: %s\n", named(c.Lists.Practices, practice))
	}
	if platform != "" {
		fmt.Fprintf(b, "- Platform: %s\n", named(c.Lists.Platforms, platform))
	}
}

func extraSection(extra string) string {
	if strings.TrimSpace(extra) == "" {
		return ""
	}
	return "\n## Additional guidance\n\n" + strings.TrimSpace(extra) + "\n"
}

func writeResources(b *strings.Builder, indent string, list []resource) {
	for _, r := range list {
		label := "Link"
		if r.Kind == "skill" {
			label = "Skill that does this for you"
		}
		fmt.Fprintf(b, "%s- %s: %s <%s>", indent, label, r.Title, r.URL)
		if r.Description != "" {
			b.WriteString(" - " + r.Description)
		}
		b.WriteString("\n")
	}
}

// ForProcess generates the "follow this process" skill. Drafts and retired processes get none.
func ForProcess(body []byte, c Context, extra map[string]string) ([]Generated, error) {
	var p process
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, err
	}
	if !active(p.Status) || len(p.Steps) == 0 {
		return nil, nil
	}
	id := ProcessSkillID(p.ID)
	actor := map[string]string{}
	for _, a := range p.Actors {
		actor[a.ID] = a.Name
	}
	number := map[string]int{}
	for i, s := range p.Steps {
		number[s.ID] = i + 1
	}

	var b strings.Builder
	b.WriteString(frontMatter(id, fmt.Sprintf("Follow the company process “%s” on behalf of a person: %s Use when someone asks for this, or asks how to get it.", p.Title, p.Summary)))
	fmt.Fprintf(&b, "# Process: %s\n\n%s\n\n", p.Title, p.Summary)
	fmt.Fprintf(&b, "- Owner: %s\n", c.team(p.Owner))
	c.placement(&b, p.Category, p.Practice, p.Platform)
	if text := rigour[p.Rigour]; text != "" {
		fmt.Fprintf(&b, "- Rigour: %s\n", text)
	}
	fmt.Fprintf(&b, "- Applies to: %s\n", c.appliesTo(p.Tiers, p.Languages, p.Environments))
	if p.EstimatedDuration != "" {
		fmt.Fprintf(&b, "- Typical lead time: %s\n", p.EstimatedDuration)
	}
	b.WriteString(`
## How to use this skill

You act for the person who needs the result. In the steps below they are **You**.

- Do only the steps marked **You**, in order, using the exact actions given.
- Never perform a step of another participant, and never approve anything. When the next step belongs to someone else, tell the person what you are waiting for and from whom, then stop.
- Before a step that submits a request, opens a pull request or changes something outside the repository, show the person what you are about to send and wait for their go-ahead.
- If a step does not match reality, do not improvise. Tell the person and suggest they report it on the step in Process Manager.

`)
	if len(p.Prerequisites) > 0 {
		b.WriteString("## Before you start\n\nConfirm each of these with the person first.\n\n")
		for _, q := range p.Prerequisites {
			b.WriteString("- " + q.Title)
			if q.Description != "" {
				b.WriteString(" - " + q.Description)
			}
			if q.ProcessID != "" {
				fmt.Fprintf(&b, " If missing: follow the process “%s”%s.", c.title(docs.Process, q.ProcessID), c.skill(docs.Process, q.ProcessID, ProcessSkillID(q.ProcessID)))
			}
			if q.URL != "" {
				fmt.Fprintf(&b, " <%s>", q.URL)
			}
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}
	if len(p.Resources) > 0 {
		b.WriteString("## Shortcuts\n\n")
		writeResources(&b, "", p.Resources)
		b.WriteString("\n")
	}

	b.WriteString("## Steps\n\n")
	for i, s := range p.Steps {
		who := actor[s.Actor]
		if s.Actor == "me" {
			who = "You"
		} else if who == "" {
			who = s.Actor
		}
		fmt.Fprintf(&b, "%d. **%s** - %s", i+1, who, s.Title)
		meta := []string{s.Type}
		if s.Tool != "" {
			meta = append(meta, "in "+docs.Name(c.Lists.Tools, s.Tool))
		}
		if s.Duration != "" {
			meta = append(meta, s.Duration)
		}
		fmt.Fprintf(&b, " (%s)\n", strings.Join(meta, ", "))
		if s.Description != "" {
			fmt.Fprintf(&b, "   %s\n", s.Description)
		}
		if s.Actor == "me" {
			for _, ins := range s.Instructions {
				fmt.Fprintf(&b, "   - %s\n", ins)
			}
		}
		if s.SubProcessID != "" {
			if c.skill(docs.Process, s.SubProcessID, "") != "" {
				fmt.Fprintf(&b, "   - This step is the process “%s”: follow the skill `%s`.\n", c.title(docs.Process, s.SubProcessID), ProcessSkillID(s.SubProcessID))
			} else {
				fmt.Fprintf(&b, "   - This step is the process “%s”, which has no skill at the moment: ask the person how to do it.\n", c.title(docs.Process, s.SubProcessID))
			}
		}
		if s.URL != "" {
			label := s.URLLabel
			if label == "" {
				label = "Open"
			}
			fmt.Fprintf(&b, "   - %s: <%s>\n", label, s.URL)
		}
		writeResources(&b, "   ", s.Resources)
		if s.Outcome != "" {
			fmt.Fprintf(&b, "   - Result: %s\n", s.Outcome)
		}
		switch len(s.Next) {
		case 0:
			b.WriteString("   - This ends the process.\n")
		case 1:
			if number[s.Next[0].To] != i+2 {
				fmt.Fprintf(&b, "   - Then go to step %d.\n", number[s.Next[0].To])
			}
		default:
			for _, n := range s.Next {
				if n.Label != "" {
					fmt.Fprintf(&b, "   - If “%s”: go to step %d.\n", n.Label, number[n.To])
				} else {
					fmt.Fprintf(&b, "   - Also continue with step %d (in parallel).\n", number[n.To])
				}
			}
		}
	}

	if len(p.Standards) > 0 {
		b.WriteString("\n## Standards this process helps to meet\n\n")
		for _, sid := range p.Standards {
			fmt.Fprintf(&b, "- %s%s\n", c.title(docs.Standard, sid), c.skill(docs.Standard, sid, StandardSkillID(sid)))
		}
	}
	b.WriteString(extraSection(extra[id]))
	return []Generated{{ID: id, Kind: KindSkill, Title: "Process: " + p.Title, Body: b.String()}}, nil
}

func (c Context) title(kind, id string) string {
	if t := c.Titles[kind+"/"+id]; t != "" && !c.Drafts[kind+"/"+id] {
		return t
	}
	return id
}

func severity(r requirement) string {
	if r.Review != nil && r.Review.Severity != "" {
		return r.Review.Severity
	}
	switch r.Level {
	case "must":
		return "blocker"
	case "should":
		return "warning"
	}
	return "info"
}

func (c Context) narrowing(r requirement) string {
	if len(r.Tiers)+len(r.Languages)+len(r.Environments) == 0 {
		return ""
	}
	var parts []string
	if len(r.Tiers) > 0 {
		parts = append(parts, "tiers "+strings.Join(docs.Names(c.Lists.Tiers, r.Tiers), ", "))
	}
	if len(r.Languages) > 0 {
		parts = append(parts, "languages "+strings.Join(docs.Names(c.Lists.Languages, r.Languages), ", "))
	}
	if len(r.Environments) > 0 {
		parts = append(parts, "environments "+strings.Join(docs.Names(c.Lists.Environments, r.Environments), ", "))
	}
	return strings.Join(parts, "; ")
}

func codeBlocks(b *strings.Builder, label string, examples []string) {
	for _, e := range examples {
		fmt.Fprintf(b, "%s:\n\n```\n%s\n```\n\n", label, strings.TrimRight(e, "\n"))
	}
}

// ForStandard generates the compliance skill and, when at least one requirement says what to
// look for in a pull request, the review agent. Drafts and retired standards get none.
func ForStandard(body []byte, c Context, extra map[string]string) ([]Generated, error) {
	var s standard
	if err := json.Unmarshal(body, &s); err != nil {
		return nil, err
	}
	if !active(s.Status) || len(s.Requirements) == 0 {
		return nil, nil
	}
	team := c.team(s.Owner)
	exception := "Ask " + team + "."
	if s.ExceptionProcessID != "" {
		exception = fmt.Sprintf("Follow the process “%s”%s.", c.title(docs.Process, s.ExceptionProcessID), c.skill(docs.Process, s.ExceptionProcessID, ProcessSkillID(s.ExceptionProcessID)))
	}
	head := func(b *strings.Builder) {
		fmt.Fprintf(b, "- Issued by: %s\n", team)
		c.placement(b, s.Category, s.Practice, s.Platform)
		fmt.Fprintf(b, "- Applies to: %s\n", c.appliesTo(s.Tiers, s.Languages, s.Environments))
		if s.Scope != "" {
			fmt.Fprintf(b, "- Scope: %s\n", s.Scope)
		}
	}

	// ----- the skill: how to comply while writing
	skillID := StandardSkillID(s.ID)
	var b strings.Builder
	b.WriteString(frontMatter(skillID, fmt.Sprintf("Apply the company standard “%s” while writing or changing code and configuration: %s Use whenever the work is in its scope.", s.Title, s.Summary)))
	fmt.Fprintf(&b, "# Standard: %s\n\n%s\n\n", s.Title, s.Summary)
	head(&b)
	b.WriteString(`
## How to use this skill

- Meet every **MUST**. If you cannot, stop and tell the person; do not work around it.
- Meet every **SHOULD** unless there is a stated reason not to, and say what the reason is.
- **MAY** is optional good practice.
- A requirement that names tiers, languages or environments applies only there. If you do not know the tier or environment of the application, ask.
- When a change is driven by a requirement, name its id (for example in the pull request description).

## Requirements

`)
	for _, r := range s.Requirements {
		fmt.Fprintf(&b, "### %s · %s · %s\n\n%s\n\n", r.ID, r.Title, strings.ToUpper(r.Level), r.Statement)
		if n := c.narrowing(r); n != "" {
			fmt.Fprintf(&b, "Applies only to: %s.\n\n", n)
		}
		if r.Rationale != "" {
			fmt.Fprintf(&b, "Why: %s\n\n", r.Rationale)
		}
		if len(r.Guidance) > 0 {
			b.WriteString("How to comply:\n\n")
			for _, g := range r.Guidance {
				fmt.Fprintf(&b, "- %s\n", g)
			}
			b.WriteString("\n")
		}
		codeBlocks(&b, "Good", r.Examples.Good)
		codeBlocks(&b, "Bad", r.Examples.Bad)
		check := r.Verification.Method
		if r.Verification.Description != "" {
			check += " - " + r.Verification.Description
		}
		fmt.Fprintf(&b, "Checked: %s\n\n", check)
		if r.ProcessID != "" {
			fmt.Fprintf(&b, "Helpful process: “%s”%s.\n\n", c.title(docs.Process, r.ProcessID), c.skill(docs.Process, r.ProcessID, ProcessSkillID(r.ProcessID)))
		}
	}
	fmt.Fprintf(&b, "## Exceptions\n\nA MUST can only be waived by the team that issued the standard. %s\n", exception)
	if len(s.Resources) > 0 {
		b.WriteString("\n## Background\n\n")
		writeResources(&b, "", s.Resources)
	}
	b.WriteString(extraSection(extra[skillID]))
	out := []Generated{{ID: skillID, Kind: KindSkill, Title: "Standard: " + s.Title, Body: b.String()}}

	// ----- the review agent: what to look for in a pull request
	var checked, skipped []requirement
	for _, r := range s.Requirements {
		if r.Review != nil && len(r.Review.LookFor) > 0 {
			checked = append(checked, r)
		} else {
			skipped = append(skipped, r)
		}
	}
	if len(checked) == 0 {
		return out, nil
	}
	agentID := ReviewAgentID(s.ID)
	var a strings.Builder
	a.WriteString(frontMatter(agentID,
		fmt.Sprintf("Reviews a pull request or a diff against the company standard “%s”. Use when reviewing changes that fall in its scope, or when asked to check compliance with it.", s.Title),
		"tools: Read, Grep, Glob, Bash"))
	fmt.Fprintf(&a, "You review changes against the standard **%s**. You only read; you never change files.\n\n", s.Title)
	head(&a)
	a.WriteString(`
## What to do

1. Get the change: the pull request diff, or ` + "`git diff`" + ` against the main branch.
2. For each requirement below, look at the changed lines in the files it names (all changed files if none are named) for the listed signs. Read enough of the surrounding code to be sure.
3. Skip a requirement that is limited to tiers, languages or environments the change is not about. If you cannot tell, check it and say that you assumed it applies.
4. Report as described at the end. Report only violations of these requirements; this review is not about style or anything else.

## Requirements to check

`)
	for _, r := range checked {
		fmt.Fprintf(&a, "### %s · %s · %s · report as %s\n\n%s\n\nLook for:\n\n", r.ID, r.Title, strings.ToUpper(r.Level), severity(r), r.Statement)
		for _, l := range r.Review.LookFor {
			fmt.Fprintf(&a, "- %s\n", l)
		}
		if len(r.Review.Paths) > 0 {
			fmt.Fprintf(&a, "\nFiles: `%s`\n", strings.Join(r.Review.Paths, "`, `"))
		}
		if n := c.narrowing(r); n != "" {
			fmt.Fprintf(&a, "\nOnly for: %s.\n", n)
		}
		if len(r.Guidance) > 0 {
			fmt.Fprintf(&a, "\nSuggest as the fix: %s\n", r.Guidance[0])
		}
		a.WriteString("\n")
	}
	if len(skipped) > 0 {
		a.WriteString("## Not checked in this review\n\nThese are verified another way. Do not report on them.\n\n")
		for _, r := range skipped {
			how := r.Verification.Method
			if r.Verification.Description != "" {
				how += ": " + r.Verification.Description
			}
			fmt.Fprintf(&a, "- %s %s (%s)\n", r.ID, r.Title, how)
		}
		a.WriteString("\n")
	}
	a.WriteString("## How to report\n\nOne line per finding, most severe first:\n\n```\n[blocker|warning|info] REQUIREMENT-ID path/to/file:line - what is wrong - how to fix it\n```\n\n")
	fmt.Fprintf(&a, "Then one closing line: `Blocks merge: yes` if there is at least one blocker, otherwise `Blocks merge: no`.\nIf you find nothing, say: `No violations of “%s” found.`\n\nNever invent a requirement or an id. A blocker can only be waived through an exception: %s\n", s.Title, exception)
	a.WriteString(extraSection(extra[agentID]))
	return append(out, Generated{ID: agentID, Kind: KindReview, Title: "Review: " + s.Title, Body: a.String()}), nil
}
