package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"runtime/debug"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// problem is an error an agent can act on: its text is shown as it is. Any other error is
// logged and the agent is told that something went wrong on the server.
type problem string

func (p problem) Error() string { return string(p) }

func problemf(format string, args ...any) error { return problem(fmt.Sprintf(format, args...)) }

// errTimeout is the answer when a call took longer than the server allows.
var errTimeout = problem("That took too long. Try again, or narrow it down.")

// errServer is the answer when something unexpected went wrong.
var errServer = problem("Something went wrong on the server. Try again later.")

// tool registers a tool whose answer is a short text for people and the structured result,
// also as JSON text for clients that do not read structured results. Every call has a
// deadline shorter than the HTTP server's write timeout and is answered when it passes, even
// if the work does not stop; a panic is caught, logged with the tool's name (never its
// arguments) and answered with a plain error, so one bad call cannot take the server down.
func tool[In, Out any](s *Server, srv *mcp.Server, t *mcp.Tool, fn func(ctx context.Context, req *mcp.CallToolRequest, in In) (Out, string, error)) {
	mcp.AddTool(srv, t, func(ctx context.Context, req *mcp.CallToolRequest, in In) (*mcp.CallToolResult, Out, error) {
		var zero Out
		ctx, cancel := context.WithTimeout(ctx, s.o.CallTimeout)
		defer cancel()
		type answer struct {
			out  Out
			text string
			err  error
		}
		done := make(chan answer, 1)
		go func() {
			defer func() {
				if v := recover(); v != nil {
					s.o.Log.Error("tool failed unexpectedly", "tool", t.Name, "panic", fmt.Sprint(v), "stack", string(debug.Stack()))
					done <- answer{err: errServer}
				}
			}()
			out, text, err := fn(ctx, req, in)
			done <- answer{out, text, err}
		}()
		var a answer
		select {
		case a = <-done:
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				s.o.Log.Warn("tool call took too long and was answered with an error", "tool", t.Name, "limit", s.o.CallTimeout.String())
				return nil, zero, errTimeout
			}
			return nil, zero, errServer
		}
		if a.err != nil {
			var p problem
			if errors.As(a.err, &p) {
				return nil, zero, p
			}
			if errors.Is(a.err, context.DeadlineExceeded) {
				return nil, zero, errTimeout
			}
			if ctx.Err() == nil {
				s.o.Log.Error("tool failed", "tool", t.Name, "error", a.err)
			}
			return nil, zero, errServer
		}
		data, err := json.Marshal(a.out)
		if err != nil {
			return nil, zero, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: a.text}, &mcp.TextContent{Text: string(data)}}}, a.out, nil
	})
}

func readOnly(title string) *mcp.ToolAnnotations {
	f := false
	return &mcp.ToolAnnotations{Title: title, ReadOnlyHint: true, IdempotentHint: true, OpenWorldHint: &f}
}

// IDInput names one document.
type IDInput struct {
	ID string `json:"id" jsonschema:"the id, e.g. request-gcp-project; from search_processes or search_standards"`
}

// StandardInput names one standard and, optionally, the application it is read for.
type StandardInput struct {
	ID          string `json:"id" jsonschema:"the id of the standard, e.g. secure-logging; from search_standards"`
	Tier        string `json:"tier,omitempty" jsonschema:"id or name of the application's tier; only the requirements that apply are returned"`
	Environment string `json:"environment,omitempty" jsonschema:"id or name of the environment, e.g. production"`
	Language    string `json:"language,omitempty" jsonschema:"id or name of the programming language"`
}

// StepsInput names a process and a participant.
type StepsInput struct {
	ID    string `json:"id" jsonschema:"the id of the process; from search_processes"`
	Actor string `json:"actor,omitempty" jsonschema:"id or name of the participant (lane); default me, the person the agent acts for"`
}

// SkillInput names a generated skill or review agent.
type SkillInput struct {
	ID      string `json:"id" jsonschema:"the id of the skill or review agent, from the skills of get_process or get_standard, e.g. process-request-gcp-project"`
	Version int    `json:"version,omitempty" jsonschema:"a version number; default the latest"`
}

func notFound(kind, id string) error {
	if kind == docs.Standard {
		return problemf("There is no standard “%s”. Use search_standards to find the id.", id)
	}
	return problemf("There is no process “%s”. Use search_processes to find the id.", id)
}

// find finds a document an agent may read; a draft is not found, as nothing is.
func (s *Server) find(ctx context.Context, kind, id string) (*library, *entry, error) {
	id = strings.TrimSpace(id)
	l, err := s.load(ctx)
	if err != nil {
		return nil, nil, err
	}
	e := l.published(kind, id)
	if e == nil {
		return nil, nil, notFound(kind, id)
	}
	return l, e, nil
}

func (s *Server) addTools(srv *mcp.Server) {
	tool(s, srv, &mcp.Tool{
		Name:        "search_processes",
		Annotations: readOnly("Search processes"),
		Description: "Find the company's ACTIVE processes - how to get something done, e.g. \"get a GCP project\", \"onboard a site to Akamai\". " +
			"Give the person's need as query and/or filters (ids or names, any case). With tier, environment or language only processes that apply to that application are returned; with path (greenfield, brownfield, paved path = golden path) only those for that path or for any path. " +
			"Returns id, title, summary, version, owner team with contact, category, practice, platform, rigour (mandatory = the only allowed way), where it applies, review state, and the matching steps. " +
			"Then read one with get_process or get_my_steps.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in SearchInput) (SearchOutput, string, error) {
		out, err := s.search(ctx, docs.Process, s.caller(req), in)
		return out, searchText(out, "process", "processes"), err
	})
	tool(s, srv, &mcp.Tool{
		Name:        "search_standards",
		Annotations: readOnly("Search standards"),
		Description: "Find the company's ACTIVE standards - rules that applications, code and infrastructure must meet, e.g. logging, code review, infrastructure as code. " +
			"Give a query and/or filters (ids or names, any case). rigour finds standards with at least one requirement of that level (must = mandatory, should = recommended, may = optional). " +
			"With tier, environment or language only standards and requirements that apply to that application are returned; with path only standards for that path or for any path. " +
			"Returns each standard with version, owner, review state, the requirements that apply (id, title, level) and the matching requirements. Then read one with get_standard.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in SearchInput) (SearchOutput, string, error) {
		out, err := s.search(ctx, docs.Standard, s.caller(req), in)
		return out, searchText(out, "standard", "standards"), err
	})
	tool(s, srv, &mcp.Tool{
		Name:        "get_process",
		Annotations: readOnly("Read a process"),
		Description: "The complete process with its version: prerequisites, the participants (lanes; the first is always me, the person you act for), every step with instructions, tool, link, outcome and what follows, " +
			"the standards it helps to meet and its generated skills. Teams, categories, practices, platforms and tools come with names, contacts and links. " +
			"A retired process is marked (retired, replacedBy); an overdue review is marked (review.overdue). To get only the steps of one participant, use get_my_steps.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in IDInput) (Process, string, error) {
		l, e, err := s.find(ctx, docs.Process, in.ID)
		if err != nil {
			return Process{}, "", err
		}
		p := s.process(ctx, l, e)
		return p, processText(p), nil
	})
	tool(s, srv, &mcp.Tool{
		Name:        "get_standard",
		Annotations: readOnly("Read a standard"),
		Description: "The complete standard with its version: scope, every requirement with level (must cannot be waived by you), statement, rationale, guidance, examples, how it is verified, what a reviewer looks for, " +
			"and the process to ask for an exception. Give tier, environment and/or language of the application to get only the requirements that apply. " +
			"A retired standard is marked (retired, replacedBy); an overdue review is marked (review.overdue).",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in StandardInput) (Standard, string, error) {
		l, e, err := s.find(ctx, docs.Standard, in.ID)
		if err != nil {
			return Standard{}, "", err
		}
		f, err := resolveFilters(l.lists, SearchInput{Tier: in.Tier, Environment: in.Environment, Language: in.Language})
		if err != nil {
			return Standard{}, "", err
		}
		st := s.standard(ctx, l, e, f.profile)
		return st, standardText(st), nil
	})
	tool(s, srv, &mcp.Tool{
		Name:        "get_my_steps",
		Annotations: readOnly("Steps of one participant"),
		Description: "Only the steps of one participant of a process (default me, the person you act for), in the order the process flows, each with instructions, tool, link, outcome, resources, " +
			"what it waits for before (the steps that lead to it) and what comes after. agentMayDo tells which steps you may do yourself: steps of me that are not approvals. Wait for the others and report.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in StepsInput) (MySteps, string, error) {
		l, e, err := s.find(ctx, docs.Process, in.ID)
		if err != nil {
			return MySteps{}, "", err
		}
		out, err := s.mySteps(l, e, in.Actor)
		if err != nil {
			return MySteps{}, "", err
		}
		return out, myStepsText(out), nil
	})
	tool(s, srv, &mcp.Tool{
		Name:        "get_skill",
		Annotations: readOnly("Read a generated skill"),
		Description: "The text of a generated skill (how to follow a process, or how to write code that meets a standard) or review agent (how to check a pull request against a standard), latest version by default. " +
			"The ids are listed under skills by get_process and get_standard. Skills are generated from the documents by templates; each names its own version and the version of its source.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in SkillInput) (SkillOut, string, error) {
		out, err := s.skill(ctx, in)
		if err != nil {
			return SkillOut{}, "", err
		}
		return out, out.Content, nil
	})
	tool(s, srv, &mcp.Tool{
		Name:        "get_catalog",
		Annotations: readOnly("Read the lists"),
		Description: "The lists processes and standards refer to: teams, practices and platforms (with contact and, when you present the shared secret, members), categories, tools (with link), application tiers, paths (greenfield, brownfield, paved path and any the company added, with their other names), environments, programming languages, architecture patterns, and the services teams perform on request (each with its team, front-door form and description as plain text). " +
			"Use it to find the ids and names the search filters take.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (Catalog, string, error) {
		out, err := s.catalog(ctx)
		return out, catalogText(out), err
	})
}

// caller is who makes a call, for the brake on searches: the person the agent acts for when
// known, otherwise the address the call came from.
func (s *Server) caller(req *mcp.CallToolRequest) string {
	if req == nil || req.Extra == nil || req.Extra.Header == nil {
		return "unknown"
	}
	if p := s.person(req.Extra.Header); p.Email != "" {
		return "person:" + p.Email
	}
	return "address:" + req.Extra.Header.Get(headerCaller)
}

// ---------- get_my_steps

// StepRef is a step another step waits for or leads to.
type StepRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Actor string `json:"actor" jsonschema:"name of the participant who does it"`
	Label string `json:"label,omitempty" jsonschema:"the condition for this path"`
}

// MyStep is a step of the chosen participant.
type MyStep struct {
	Step
	Before []StepRef `json:"before" jsonschema:"the steps that lead to this one: wait for them"`
	After  []StepRef `json:"after" jsonschema:"the steps that follow"`
}

// MySteps is the answer of get_my_steps.
type MySteps struct {
	Process Header   `json:"process"`
	Notice  string   `json:"notice,omitempty"`
	Actor   Actor    `json:"actor"`
	Steps   []MyStep `json:"steps" jsonschema:"in the order the process flows"`
}

func (s *Server) mySteps(l *library, e *entry, who string) (MySteps, error) {
	p := e.process
	lanes := s.actors(l, p)
	who = strings.TrimSpace(who)
	if who == "" {
		who = "me"
	}
	var chosen *Actor
	for _, a := range p.Actors {
		if fold(a.ID) == fold(who) {
			x := lanes[a.ID]
			chosen = &x
		}
	}
	if chosen == nil {
		for _, a := range p.Actors {
			if fold(a.Name) == fold(who) {
				x := lanes[a.ID]
				chosen = &x
				break
			}
		}
	}
	if chosen == nil {
		names := []string{}
		for _, a := range p.Actors {
			names = append(names, a.ID+" ("+a.Name+")")
		}
		return MySteps{}, problemf("The process “%s” has no participant “%s”. Its participants are: %s.", e.doc.ID, who, strings.Join(names, ", "))
	}
	out := MySteps{Process: s.header(l, e), Actor: *chosen, Steps: []MyStep{}}
	out.Notice = notice(out.Process)

	index := map[string]int{}
	for i, st := range p.Steps {
		index[st.ID] = i
	}
	refOf := func(id, label string) StepRef {
		i, ok := index[id]
		if !ok {
			return StepRef{ID: id, Title: id, Label: label}
		}
		st := p.Steps[i]
		a := lanes[st.Actor].Name
		if a == "" {
			a = st.Actor
		}
		return StepRef{ID: st.ID, Title: st.Title, Actor: a, Label: label}
	}
	before := map[string][]StepRef{}
	for _, st := range p.Steps {
		for _, n := range st.Next {
			before[n.To] = append(before[n.To], refOf(st.ID, n.Label))
		}
	}
	for _, i := range flowOrder(p.Steps) {
		st := p.Steps[i]
		if st.Actor != chosen.ID {
			continue
		}
		m := MyStep{Step: s.step(l, lanes, i, st), Before: before[st.ID], After: []StepRef{}}
		if m.Before == nil {
			m.Before = []StepRef{}
		}
		for _, n := range st.Next {
			m.After = append(m.After, refOf(n.To, n.Label))
		}
		out.Steps = append(out.Steps, m)
	}
	return out, nil
}

// flowOrder is the order the steps are reached from the first one, following each step's
// next in turn (breadth first); steps nothing leads to follow in reading order.
func flowOrder(steps []rawStep) []int {
	index := map[string]int{}
	for i, st := range steps {
		if _, dup := index[st.ID]; !dup {
			index[st.ID] = i
		}
	}
	seen := make([]bool, len(steps))
	var out []int
	queue := []int{}
	for start := 0; start < len(steps); start++ {
		if seen[start] {
			continue
		}
		seen[start] = true
		queue = append(queue, start)
		for len(queue) > 0 {
			i := queue[0]
			queue = queue[1:]
			out = append(out, i)
			for _, n := range steps[i].Next {
				if j, ok := index[n.To]; ok && !seen[j] {
					seen[j] = true
					queue = append(queue, j)
				}
			}
		}
	}
	return out
}

// ---------- get_skill

// SkillOut is a generated skill or review agent.
type SkillOut struct {
	ID            string `json:"id"`
	Kind          string `json:"kind" jsonschema:"skill or review-agent"`
	Title         string `json:"title"`
	Source        DocRef `json:"source" jsonschema:"the process or standard it is generated from"`
	Version       int    `json:"version" jsonschema:"the version of the skill returned"`
	LatestVersion int    `json:"latestVersion"`
	SourceVersion int    `json:"sourceVersion" jsonschema:"the version of the process or standard it was generated from"`
	Active        bool   `json:"active" jsonschema:"false: withdrawn because its source is retired; do not follow it"`
	Path          string `json:"path" jsonschema:"where the file belongs in a repository"`
	Content       string `json:"content" jsonschema:"the text (Markdown)"`
}

func (s *Server) skill(ctx context.Context, in SkillInput) (SkillOut, error) {
	id := strings.TrimSpace(in.ID)
	missing := problemf("There is no skill “%s”. The skills of a process or standard are listed by get_process and get_standard.", id)
	if s.o.Skills == nil || !docs.ValidID(id) {
		return SkillOut{}, missing
	}
	sk, err := s.o.Skills.Get(ctx, id)
	if errors.Is(err, skills.ErrNotFound) {
		return SkillOut{}, missing
	}
	if err != nil {
		return SkillOut{}, err
	}
	// a skill of a draft, or of something deleted, does not exist for an agent
	l, err := s.load(ctx)
	if err != nil {
		return SkillOut{}, err
	}
	if l.published(sk.SourceKind, sk.SourceID) == nil {
		return SkillOut{}, missing
	}
	versions, err := s.o.Skills.Versions(ctx, id)
	if err != nil {
		return SkillOut{}, err
	}
	if len(versions) == 0 {
		return SkillOut{}, missing
	}
	want := versions[0]
	if in.Version != 0 {
		found := false
		for _, v := range versions {
			if v.Version == in.Version {
				want, found = v, true
			}
		}
		if !found {
			return SkillOut{}, problemf("The skill “%s” has no version %d. Its latest version is %d.", id, in.Version, versions[0].Version)
		}
	}
	content, err := s.o.Skills.Content(ctx, id, want.Version)
	if errors.Is(err, skills.ErrNotFound) {
		return SkillOut{}, missing
	}
	if err != nil {
		return SkillOut{}, err
	}
	return SkillOut{
		ID: sk.ID, Kind: sk.Kind, Title: sk.Title, Source: *s.docRef(l, sk.SourceKind, sk.SourceID), Version: want.Version, LatestVersion: versions[0].Version,
		SourceVersion: want.SourceVersion, Active: sk.Active, Path: sk.Path, Content: content,
	}, nil
}

// ---------- get_catalog

// Group is a team, practice or platform.
type Group struct {
	Ref
	Members []string `json:"members,omitempty" jsonschema:"emails of the people with a role for it; only given to callers that present the shared secret"`
	// Drafters: the members of a platform or practice, who write drafts its owners publish.
	Drafters []string `json:"drafters,omitempty" jsonschema:"platforms and practices: emails of its members, who may write drafts that an owner publishes; only given to callers that present the shared secret"`
}

// Catalog is the answer of get_catalog.
type Catalog struct {
	Teams        []Group      `json:"teams" jsonschema:"own processes and standards; members are its owners"`
	Practices    []Group      `json:"practices" jsonschema:"disciplines such as security; members may change what belongs to it"`
	Platforms    []Group      `json:"platforms" jsonschema:"what teams build on; members may change what belongs to it"`
	Categories   []Ref        `json:"categories"`
	Tools        []Ref        `json:"tools" jsonschema:"systems used in steps, with their link"`
	Tiers        []Ref        `json:"tiers" jsonschema:"application tiers, most critical first"`
	Paths        []PathRef    `json:"paths" jsonschema:"the paths a process or standard can be meant for: greenfield, brownfield, paved path (golden path) and any the company added"`
	Environments []Ref        `json:"environments"`
	Languages    []Ref        `json:"languages"`
	Patterns     []PatternRef `json:"patterns" jsonschema:"the architecture patterns processes and standards can be tagged with (such as event-driven or microservices); empty when the company lists none"`
	Services     []Service    `json:"services" jsonschema:"what teams do for others on request, each with the team that performs it and its front-door form; a process step can request one; empty when the company lists none"`
	MembersShown bool         `json:"membersShown" jsonschema:"false: members are only given to callers that present the shared secret"`
}

func plain(list []docs.Named) []Ref {
	out := []Ref{}
	for _, n := range list {
		out = append(out, Ref{ID: n.ID, Name: n.Name, Contact: n.Contact, Contacts: contactsOf(n), URL: n.URL, Description: n.Description})
	}
	return out
}

func (s *Server) catalog(ctx context.Context) (Catalog, error) {
	lists, err := s.o.Docs.Lists(ctx)
	if err != nil {
		return Catalog{}, err
	}
	// People's emails are for those who sign in to the portal. Until agents sign in through a
	// gateway, the shared secret is the closest thing: without it (an agent on this machine
	// that nobody vouched for) the members are left out.
	// (With a secret configured, the guard lets no call through without it.)
	show := s.o.Secret != "" && s.o.Roles != nil
	members := map[string][]string{}
	if show {
		list, err := s.o.Roles.Members(ctx)
		if err != nil {
			return Catalog{}, err
		}
		for _, m := range list {
			key := m.Role + "/" + m.Scope
			members[key] = append(members[key], m.Email)
		}
	}
	groups := func(list []docs.Named, role, member string) []Group {
		out := []Group{}
		for _, r := range plain(list) {
			g := Group{Ref: r}
			if show {
				g.Members = members[role+"/"+r.ID]
				if g.Members == nil {
					g.Members = []string{}
				}
				if member != "" {
					g.Drafters = members[member+"/"+r.ID]
					if g.Drafters == nil {
						g.Drafters = []string{}
					}
				}
			}
			out = append(out, g)
		}
		return out
	}
	return Catalog{
		Teams: groups(lists.Teams, rbac.Owner, ""), Practices: groups(lists.Practices, rbac.PracticeOwner, rbac.PracticeMember), Platforms: groups(lists.Platforms, rbac.PlatformOwner, rbac.PlatformMember),
		Categories: plain(lists.Categories), Tools: plain(lists.Tools), Tiers: plain(lists.Tiers), Environments: plain(lists.Environments), Languages: plain(lists.Languages),
		Paths:        pathRefs(lists.Paths, idsOf(lists.Paths)),
		Patterns:     patternRefs(lists.Patterns, idsOf(lists.Patterns)),
		Services:     services(lists),
		MembersShown: show,
	}, nil
}

// ---------- the short texts

func searchText(out SearchOutput, one, many string) string {
	if out.Total == 0 {
		return "No active " + many + " match. Try fewer words or filters."
	}
	var b strings.Builder
	if out.AtLeast {
		b.WriteString("At least ")
	}
	fmt.Fprintf(&b, "%s match", plural(out.Total, "active "+one, "active "+many))
	if out.Total > len(out.Results) {
		fmt.Fprintf(&b, " (the first %d are shown)", len(out.Results))
	}
	b.WriteString(":")
	for _, r := range out.Results {
		fmt.Fprintf(&b, "\n- %s (%s, version %d)", r.Title, r.ID, r.Version)
		if r.Rigour != "" {
			b.WriteString(", " + r.Rigour)
		}
		if r.Review.Overdue {
			b.WriteString(", review overdue")
		}
		for _, m := range r.Matches {
			b.WriteString("; " + m.Label)
		}
	}
	if out.Note != "" {
		b.WriteString("\n" + out.Note)
	}
	return b.String()
}

func processText(p Process) string {
	var b strings.Builder
	b.WriteString(strings.ToUpper(p.Kind[:1]) + p.Header.line()[1:] + ": " + p.Summary)
	if p.Rigour != "" {
		b.WriteString(" Rigour: " + p.Rigour + ".")
	}
	fmt.Fprintf(&b, " %s, %s.", plural(len(p.Prerequisites), "prerequisite", "prerequisites"), plural(len(p.Steps), "step", "steps"))
	if p.Notice != "" {
		b.WriteString(" " + p.Notice)
	}
	return b.String()
}

func standardText(st Standard) string {
	var b strings.Builder
	b.WriteString(strings.ToUpper(st.Kind[:1]) + st.Header.line()[1:] + ": " + st.Summary)
	count := map[string]int{}
	for _, r := range st.Requirements {
		count[r.Level]++
	}
	fmt.Fprintf(&b, " %s", plural(len(st.Requirements), "requirement", "requirements"))
	var levels []string
	for _, l := range sortedKeys(count) {
		levels = append(levels, fmt.Sprintf("%d %s", count[l], l))
	}
	if len(levels) > 0 {
		b.WriteString(" (" + strings.Join(levels, ", ") + ")")
	}
	if st.LeftOut > 0 {
		fmt.Fprintf(&b, "; %s left out because %s not apply", plural(st.LeftOut, "requirement", "requirements"), map[bool]string{true: "it does", false: "they do"}[st.LeftOut == 1])
	}
	b.WriteString(".")
	if st.Notice != "" {
		b.WriteString(" " + st.Notice)
	}
	return b.String()
}

func myStepsText(m MySteps) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s in %s:", plural(len(m.Steps), "step of "+m.Actor.Name, "steps of "+m.Actor.Name), m.Process.line())
	for _, st := range m.Steps {
		fmt.Fprintf(&b, "\n%d. %s", st.Number, st.Title)
		if !st.AgentMayDo {
			b.WriteString(" (not for the agent: wait and report)")
		}
	}
	if m.Notice != "" {
		b.WriteString("\n" + m.Notice)
	}
	return b.String()
}

func catalogText(c Catalog) string {
	return fmt.Sprintf("%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s.",
		plural(len(c.Teams), "team", "teams"), plural(len(c.Practices), "practice", "practices"), plural(len(c.Platforms), "platform", "platforms"),
		plural(len(c.Categories), "category", "categories"), plural(len(c.Tools), "tool", "tools"), plural(len(c.Tiers), "tier", "tiers"),
		plural(len(c.Paths), "path", "paths"), plural(len(c.Environments), "environment", "environments"), plural(len(c.Languages), "language", "languages"),
		plural(len(c.Patterns), "architecture pattern", "architecture patterns"), plural(len(c.Services), "service", "services"))
}

// idsOf is the ids of a list, in its order.
func idsOf(list []docs.Named) []string {
	out := make([]string, 0, len(list))
	for _, n := range list {
		out = append(out, n.ID)
	}
	return out
}

func services(l docs.Lists) []Service {
	out := []Service{}
	for _, sv := range l.Services {
		out = append(out, *serviceOf(l, sv.ID))
	}
	return out
}
