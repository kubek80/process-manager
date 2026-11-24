package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// ---------- the stored documents, as far as this server reads them

type resource struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Kind        string `json:"kind,omitempty"`
	Description string `json:"description,omitempty"`
}

type rawReview struct {
	IntervalMonths float64 `json:"intervalMonths"`
	LastReviewedAt string  `json:"lastReviewedAt"`
	ReviewedBy     string  `json:"reviewedBy"`
}

// common is what processes and standards share.
type common struct {
	ID           string     `json:"id"`
	Title        string     `json:"title"`
	Summary      string     `json:"summary"`
	Owner        string     `json:"owner"`
	Category     string     `json:"category"`
	Practice     string     `json:"practice"`
	Platform     string     `json:"platform"`
	Status       string     `json:"status"`
	ReplacedBy   string     `json:"replacedBy"`
	UpdatedAt    string     `json:"updatedAt"`
	Tags         []string   `json:"tags"`
	Paths        []string   `json:"paths"`
	Tiers        []string   `json:"tiers"`
	Environments []string   `json:"environments"`
	Languages    []string   `json:"languages"`
	Review       *rawReview `json:"review"`
	Resources    []resource `json:"resources"`
}

type rawStep struct {
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
}

type rawProcess struct {
	common
	Rigour            string   `json:"rigour"`
	EstimatedDuration string   `json:"estimatedDuration"`
	Standards         []string `json:"standards"`
	Prerequisites     []struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		URL         string `json:"url"`
		ProcessID   string `json:"processId"`
	} `json:"prerequisites"`
	Actors []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		TeamID      string `json:"teamId"`
	} `json:"actors"`
	Steps []rawStep `json:"steps"`
}

type rawRequirement struct {
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
	Environments []string `json:"environments"`
	Languages    []string `json:"languages"`
	ProcessID    string   `json:"processId"`
}

type rawStandard struct {
	common
	Scope              string           `json:"scope"`
	ExceptionProcessID string           `json:"exceptionProcessId"`
	Requirements       []rawRequirement `json:"requirements"`
}

// entry is one stored process or standard.
type entry struct {
	kind    string
	doc     docs.Doc
	c       *common
	process *rawProcess
	std     *rawStandard
	// published is when readers could first see it (zero: never published, or not known)
	published time.Time
}

func (e *entry) status() string {
	if e.c.Status == "" {
		return "active"
	}
	return e.c.Status
}
func (e *entry) draft() bool  { return e.c.Status == "draft" }
func (e *entry) active() bool { return e.c.Status == "" || e.c.Status == "active" }

// library is everything one call reads: the lists and every process and standard, drafts
// included only so that a reference to one can be told apart from nothing - they are never
// shown.
type library struct {
	lists docs.Lists
	all   map[string]*entry // "process/<id>", "standard/<id>"
	order []*entry          // processes, then standards, each by id
}

func (s *Server) load(ctx context.Context) (*library, error) {
	lists, err := s.o.Docs.Lists(ctx)
	if err != nil {
		return nil, err
	}
	l := &library{lists: lists, all: map[string]*entry{}}
	for _, kind := range []string{docs.Process, docs.Standard} {
		list, err := s.o.Docs.List(ctx, kind)
		if err != nil {
			return nil, err
		}
		published, err := s.o.Docs.Published(ctx, kind)
		if err != nil {
			return nil, err
		}
		for _, d := range list {
			e := &entry{kind: kind, doc: d, published: published[d.ID]}
			if kind == docs.Process {
				e.process = &rawProcess{}
				if json.Unmarshal(d.Body, e.process) != nil {
					continue
				}
				e.c = &e.process.common
			} else {
				e.std = &rawStandard{}
				if json.Unmarshal(d.Body, e.std) != nil {
					continue
				}
				e.c = &e.std.common
			}
			if e.c.ID == "" {
				e.c.ID = d.ID
			}
			l.all[kind+"/"+d.ID] = e
			l.order = append(l.order, e)
		}
	}
	return l, nil
}

// published returns a process or standard that is not a draft; nil for a draft and for
// nothing alike.
func (l *library) published(kind, id string) *entry {
	e := l.all[kind+"/"+id]
	if e == nil || e.draft() {
		return nil
	}
	return e
}

// ---------- what agents get

// Ref is an entry of one of the lists.
type Ref struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Contact     string         `json:"contact,omitempty" jsonschema:"how to reach them: channel, mailbox, queue (a free line)"`
	Contacts    *docs.Contacts `json:"contacts,omitempty" jsonschema:"how to reach a team, platform or practice, each way on its own: email (group email), slack (channel name), slackUrl, chat (Google Chat space), chatUrl, confluence, page (their own page), form (where to ask them for something)"`
	URL         string         `json:"url,omitempty"`
	Description string         `json:"description,omitempty"`
}

// DocRef points at another process or standard. A title is only given for a published one.
type DocRef struct {
	Kind    string `json:"kind" jsonschema:"process or standard"`
	ID      string `json:"id"`
	Title   string `json:"title,omitempty" jsonschema:"missing when it is not available"`
	Retired bool   `json:"retired,omitempty"`
	Link    string `json:"link,omitempty"`
}

// Review is whether the owner still confirms the document.
type Review struct {
	State          string `json:"state" jsonschema:"none (no review planned), ok, soon (due within 30 days) or overdue"`
	Overdue        bool   `json:"overdue" jsonschema:"true: the owner has not confirmed it is still correct; still valid, warn the person"`
	DueAt          string `json:"dueAt,omitempty"`
	LastReviewedAt string `json:"lastReviewedAt,omitempty"`
	IntervalMonths int    `json:"intervalMonths,omitempty"`
	Label          string `json:"label"`
}

// AppliesTo narrows a document or requirement. An empty list means all of them.
type AppliesTo struct {
	Tiers        []Ref `json:"tiers" jsonschema:"application tiers; empty: all tiers"`
	Environments []Ref `json:"environments" jsonschema:"environments; empty: all environments"`
	Languages    []Ref `json:"languages" jsonschema:"programming languages; empty: does not depend on the language"`
}

// Resource is a link that helps.
type Resource struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Kind        string `json:"kind,omitempty" jsonschema:"skill, repository, template, documentation or other"`
	Description string `json:"description,omitempty"`
}

// Header is what every answer says about a process or standard.
type Header struct {
	Kind       string    `json:"kind" jsonschema:"process or standard"`
	ID         string    `json:"id"`
	Title      string    `json:"title"`
	Summary    string    `json:"summary"`
	Version    int       `json:"version" jsonschema:"the stored version; cite it"`
	Status     string    `json:"status" jsonschema:"active or deprecated (retired)"`
	Retired    bool      `json:"retired" jsonschema:"true: do not follow it; use replacedBy when given"`
	ReplacedBy *DocRef   `json:"replacedBy,omitempty"`
	Owner      *Ref      `json:"owner,omitempty" jsonschema:"the team that owns it, with its contact"`
	Category   *Ref      `json:"category,omitempty"`
	Practice   *Ref      `json:"practice,omitempty"`
	Platform   *Ref      `json:"platform,omitempty"`
	AppliesTo  AppliesTo `json:"appliesTo"`
	Paths      []PathRef `json:"paths" jsonschema:"the paths it is meant for (greenfield: something new is built; brownfield: something that exists is changed or moved; paved path, also called the golden path: the ready-made, supported way). A document names paths only when it is meant only for that kind of work; empty: it applies whatever the path"`
	Review     Review    `json:"review"`
	UpdatedAt  string    `json:"updatedAt,omitempty"`
	Link       string    `json:"link,omitempty" jsonschema:"the page in the portal"`
}

// PathRef is a path a document is meant for.
type PathRef struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	AlsoCalled  []string `json:"alsoCalled,omitempty" jsonschema:"other words for it, e.g. golden path for the paved path"`
	Description string   `json:"description,omitempty"`
}

func pathRefs(list []docs.Named, ids []string) []PathRef {
	out := []PathRef{}
	for _, id := range ids {
		r := PathRef{ID: id, Name: id}
		for _, n := range list {
			if n.ID == id {
				r = PathRef{ID: n.ID, Name: n.Name, AlsoCalled: docs.OtherNames(n), Description: n.Description}
			}
		}
		out = append(out, r)
	}
	return out
}

func ref(list []docs.Named, id string) *Ref {
	if id == "" {
		return nil
	}
	for _, n := range list {
		if n.ID == id {
			return &Ref{ID: n.ID, Name: n.Name, Contact: n.Contact, Contacts: contactsOf(n), URL: n.URL}
		}
	}
	return &Ref{ID: id, Name: id}
}

// contactsOf is how to reach an entry, nil when nothing is given.
func contactsOf(n docs.Named) *docs.Contacts {
	if n.Contacts.Empty() {
		return nil
	}
	c := *n.Contacts
	return &c
}

func refs(list []docs.Named, ids []string) []Ref {
	out := []Ref{}
	for _, id := range ids {
		out = append(out, *ref(list, id))
	}
	return out
}

func (s *Server) link(kind, id string) string {
	if s.o.BaseURL == "" {
		return ""
	}
	page := "/#/p/"
	if kind == docs.Standard {
		page = "/#/s/"
	}
	return s.o.BaseURL + page + id
}

// docRef points at another document without giving away a draft.
func (s *Server) docRef(l *library, kind, id string) *DocRef {
	if id == "" {
		return nil
	}
	r := &DocRef{Kind: kind, ID: id}
	if e := l.published(kind, id); e != nil {
		r.Title, r.Retired, r.Link = e.c.Title, !e.active(), s.link(kind, id)
	}
	return r
}

func (s *Server) header(l *library, e *entry) Header {
	c := e.c
	h := Header{
		Kind: e.kind, ID: e.doc.ID, Title: c.Title, Summary: c.Summary, Version: e.doc.Version, Status: e.status(), Retired: e.c.Status == "deprecated",
		Owner: ref(l.lists.Teams, c.Owner), Category: ref(l.lists.Categories, c.Category), Practice: ref(l.lists.Practices, c.Practice), Platform: ref(l.lists.Platforms, c.Platform),
		AppliesTo: AppliesTo{Tiers: refs(l.lists.Tiers, c.Tiers), Environments: refs(l.lists.Environments, c.Environments), Languages: refs(l.lists.Languages, c.Languages)},
		Paths:     pathRefs(l.lists.Paths, c.Paths),
		Review:    reviewOf(e, s.o.Now()), UpdatedAt: c.UpdatedAt, Link: s.link(e.kind, e.doc.ID),
	}
	if h.Retired {
		h.ReplacedBy = s.docRef(l, e.kind, c.ReplacedBy)
	}
	return h
}

// reviewOf works out the review state as the portal does (src/lib/lifecycle.ts).
func reviewOf(e *entry, now time.Time) Review {
	r := e.c.Review
	if r == nil || !e.active() {
		return Review{State: "none", Label: "No review planned"}
	}
	out := Review{LastReviewedAt: r.LastReviewedAt, IntervalMonths: int(r.IntervalMonths)}
	// never reviewed: the first review is counted from when it was first published
	first := r.LastReviewedAt == ""
	if first && e.published.IsZero() {
		out.State, out.Overdue, out.Label = "overdue", true, "Never reviewed"
		return out
	}
	last, err := time.Parse(time.DateOnly, r.LastReviewedAt)
	if first {
		last, err = time.Parse(time.DateOnly, e.published.UTC().Format(time.DateOnly))
	}
	if err != nil {
		out.State, out.Overdue, out.Label = "overdue", true, "Review date cannot be read"
		return out
	}
	due := last.AddDate(0, int(r.IntervalMonths), 0)
	out.DueAt = due.Format(time.DateOnly)
	// An agent has no reader's day: today and the first publication are UTC days here, while the
	// portal counts in the reader's own day. Near midnight a review can show as due a day
	// earlier or later for an agent than for a reader far from UTC.
	today, _ := time.Parse(time.DateOnly, now.UTC().Format(time.DateOnly))
	days := int(due.Sub(today).Hours() / 24)
	switch {
	case days < 0:
		out.State, out.Overdue, out.Label = "overdue", true, "Review overdue since "+out.DueAt
	case days <= 30:
		out.State, out.Label = "soon", "Review due "+out.DueAt
	default:
		out.State, out.Label = "ok", "Next review "+out.DueAt
	}
	if first && out.State != "overdue" {
		out.Label = "First review due " + out.DueAt
	}
	return out
}

// notice is the sentence an agent must not miss about a document.
func notice(h Header) string {
	var parts []string
	if h.Retired {
		p := "This " + h.Kind + " is retired: do not follow it."
		if h.ReplacedBy != nil {
			name := h.ReplacedBy.ID
			if h.ReplacedBy.Title != "" {
				name = h.ReplacedBy.Title + " (" + h.ReplacedBy.ID + ")"
			}
			p += " Use " + name + " instead."
		}
		parts = append(parts, p)
	}
	if h.Review.Overdue {
		parts = append(parts, "Its review is overdue ("+h.Review.Label+"): it is still valid, but tell the person that the owner has not confirmed it recently.")
	}
	return strings.Join(parts, " ")
}

// ---------- processes

// Prerequisite is something that must be true before step 1.
type Prerequisite struct {
	Title       string  `json:"title"`
	Description string  `json:"description,omitempty"`
	URL         string  `json:"url,omitempty"`
	Process     *DocRef `json:"process,omitempty" jsonschema:"another process that produces it"`
}

// Actor is one lane of a process.
type Actor struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Team        *Ref   `json:"team,omitempty"`
}

// Next is the way from one step to the next.
type Next struct {
	To    string `json:"to" jsonschema:"id of the following step"`
	Label string `json:"label,omitempty" jsonschema:"the condition for this path"`
}

// Step is one step of a process.
type Step struct {
	ID           string     `json:"id"`
	Number       int        `json:"number" jsonschema:"position in reading order, from 1"`
	Title        string     `json:"title"`
	Actor        Actor      `json:"actor"`
	Type         string     `json:"type"`
	AgentMayDo   bool       `json:"agentMayDo" jsonschema:"true only for steps of me that are not approvals; anything else the agent waits for and reports"`
	Description  string     `json:"description,omitempty"`
	Instructions []string   `json:"instructions"`
	Tool         *Ref       `json:"tool,omitempty"`
	URL          string     `json:"url,omitempty"`
	URLLabel     string     `json:"urlLabel,omitempty"`
	Duration     string     `json:"duration,omitempty"`
	Outcome      string     `json:"outcome,omitempty"`
	SubProcess   *DocRef    `json:"subProcess,omitempty" jsonschema:"another process that describes this step"`
	Resources    []Resource `json:"resources"`
	Next         []Next     `json:"next" jsonschema:"steps that follow; empty: the process ends here"`
}

// SkillRef names a generated skill or review agent.
type SkillRef struct {
	ID    string `json:"id" jsonschema:"pass it to get_skill"`
	Kind  string `json:"kind" jsonschema:"skill or review-agent"`
	Title string `json:"title"`
}

// Process is a complete process.
type Process struct {
	Header
	Notice            string         `json:"notice,omitempty" jsonschema:"what the agent must tell the person: retired or review overdue"`
	Rigour            string         `json:"rigour,omitempty" jsonschema:"mandatory: the only allowed way; recommended; optional"`
	EstimatedDuration string         `json:"estimatedDuration,omitempty"`
	Tags              []string       `json:"tags"`
	Prerequisites     []Prerequisite `json:"prerequisites"`
	Actors            []Actor        `json:"actors" jsonschema:"the lanes; the first is always me, the person the agent acts for"`
	Steps             []Step         `json:"steps"`
	Standards         []DocRef       `json:"standards" jsonschema:"standards this process helps to meet"`
	Resources         []Resource     `json:"resources"`
	Skills            []SkillRef     `json:"skills" jsonschema:"generated skills for this process"`
}

func resources(list []resource) []Resource {
	out := []Resource{}
	for _, r := range list {
		out = append(out, Resource(r))
	}
	return out
}

func strs(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

func (s *Server) actors(l *library, p *rawProcess) map[string]Actor {
	out := map[string]Actor{}
	for _, a := range p.Actors {
		var team *Ref
		if a.TeamID != "" {
			team = ref(l.lists.Teams, a.TeamID)
		}
		out[a.ID] = Actor{ID: a.ID, Name: a.Name, Description: a.Description, Team: team}
	}
	return out
}

func (s *Server) step(l *library, lanes map[string]Actor, i int, st rawStep) Step {
	who, ok := lanes[st.Actor]
	if !ok {
		who = Actor{ID: st.Actor, Name: st.Actor}
	}
	out := Step{
		ID: st.ID, Number: i + 1, Title: st.Title, Actor: who, Type: st.Type, AgentMayDo: st.Actor == "me" && st.Type != "approval",
		Description: st.Description, Instructions: strs(st.Instructions), URL: st.URL, URLLabel: st.URLLabel, Duration: st.Duration, Outcome: st.Outcome,
		SubProcess: s.docRef(l, docs.Process, st.SubProcessID), Resources: resources(st.Resources), Next: []Next{},
	}
	if st.Tool != "" {
		out.Tool = ref(l.lists.Tools, st.Tool)
	}
	for _, n := range st.Next {
		out.Next = append(out.Next, Next{To: n.To, Label: n.Label})
	}
	return out
}

func (s *Server) process(ctx context.Context, l *library, e *entry) Process {
	p := e.process
	out := Process{
		Header: s.header(l, e), Rigour: p.Rigour, EstimatedDuration: p.EstimatedDuration, Tags: strs(p.Tags),
		Prerequisites: []Prerequisite{}, Actors: []Actor{}, Steps: []Step{}, Standards: []DocRef{}, Resources: resources(p.Resources),
		Skills: s.skillsOf(ctx, e),
	}
	out.Notice = notice(out.Header)
	for _, q := range p.Prerequisites {
		out.Prerequisites = append(out.Prerequisites, Prerequisite{Title: q.Title, Description: q.Description, URL: q.URL, Process: s.docRef(l, docs.Process, q.ProcessID)})
	}
	lanes := s.actors(l, p)
	for _, a := range p.Actors {
		out.Actors = append(out.Actors, lanes[a.ID])
	}
	for i, st := range p.Steps {
		out.Steps = append(out.Steps, s.step(l, lanes, i, st))
	}
	for _, id := range p.Standards {
		out.Standards = append(out.Standards, *s.docRef(l, docs.Standard, id))
	}
	return out
}

// skillsOf lists the skills generated from a published document that are in use.
func (s *Server) skillsOf(ctx context.Context, e *entry) []SkillRef {
	out := []SkillRef{}
	if s.o.Skills == nil {
		return out
	}
	ids := []string{skills.ProcessSkillID(e.doc.ID)}
	if e.kind == docs.Standard {
		ids = []string{skills.StandardSkillID(e.doc.ID), skills.ReviewAgentID(e.doc.ID)}
	}
	for _, id := range ids {
		sk, err := s.o.Skills.Get(ctx, id)
		if err != nil || !sk.Active || sk.SourceKind != e.kind || sk.SourceID != e.doc.ID {
			continue
		}
		out = append(out, SkillRef{ID: sk.ID, Kind: sk.Kind, Title: sk.Title})
	}
	return out
}

// ---------- standards

// Profile is the application an agent works on: only what applies to it is returned. Path is
// the path of the work (a whole document names paths; a requirement does not).
type Profile struct {
	Tier, Environment, Language, Path string // ids
}

func (p Profile) empty() bool {
	return p.Tier == "" && p.Environment == "" && p.Language == "" && p.Path == ""
}

// onPath reports whether a document for these paths applies to the profile's path: one that
// names none applies whatever the path.
func (p Profile) onPath(paths []string) bool {
	if p.Path == "" || len(paths) == 0 {
		return true
	}
	for _, id := range paths {
		if id == p.Path {
			return true
		}
	}
	return false
}

// applies reports whether something narrowed to these lists applies to the profile.
func (p Profile) applies(tiers, environments, languages []string) bool {
	ok := func(ids []string, want string) bool {
		if want == "" || len(ids) == 0 {
			return true
		}
		for _, id := range ids {
			if id == want {
				return true
			}
		}
		return false
	}
	return ok(tiers, p.Tier) && ok(environments, p.Environment) && ok(languages, p.Language)
}

// Requirement is one rule of a standard.
type Requirement struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Level        string    `json:"level" jsonschema:"must (mandatory; cannot be waived by the agent), should (recommended) or may (optional)"`
	Statement    string    `json:"statement"`
	Rationale    string    `json:"rationale,omitempty"`
	Guidance     []string  `json:"guidance" jsonschema:"how to comply"`
	GoodExamples []string  `json:"goodExamples"`
	BadExamples  []string  `json:"badExamples"`
	Verification string    `json:"verification" jsonschema:"automated, review or manual"`
	VerifiedBy   string    `json:"verifiedBy,omitempty"`
	LookFor      []string  `json:"lookFor" jsonschema:"signs of a violation in a pull request"`
	Paths        []string  `json:"paths" jsonschema:"file patterns where it matters; empty: all files"`
	Severity     string    `json:"severity,omitempty"`
	AppliesTo    AppliesTo `json:"appliesTo"`
	Process      *DocRef   `json:"process,omitempty" jsonschema:"a process that helps to meet it"`
}

// Standard is a complete standard.
type Standard struct {
	Header
	Notice           string        `json:"notice,omitempty" jsonschema:"what the agent must tell the person: retired or review overdue"`
	Scope            string        `json:"scope,omitempty"`
	ExceptionProcess *DocRef       `json:"exceptionProcess,omitempty" jsonschema:"the process to ask for an exception"`
	Tags             []string      `json:"tags"`
	Requirements     []Requirement `json:"requirements" jsonschema:"with a profile: only those that apply"`
	LeftOut          int           `json:"leftOut" jsonschema:"requirements left out because they do not apply to the profile"`
	Resources        []Resource    `json:"resources"`
	Skills           []SkillRef    `json:"skills" jsonschema:"generated skill and review agent for this standard"`
}

func (s *Server) requirement(l *library, r rawRequirement) Requirement {
	out := Requirement{
		ID: r.ID, Title: r.Title, Level: r.Level, Statement: r.Statement, Rationale: r.Rationale, Guidance: strs(r.Guidance),
		GoodExamples: strs(r.Examples.Good), BadExamples: strs(r.Examples.Bad), Verification: r.Verification.Method, VerifiedBy: r.Verification.Description,
		LookFor: []string{}, Paths: []string{},
		AppliesTo: AppliesTo{Tiers: refs(l.lists.Tiers, r.Tiers), Environments: refs(l.lists.Environments, r.Environments), Languages: refs(l.lists.Languages, r.Languages)},
		Process:   s.docRef(l, docs.Process, r.ProcessID),
	}
	if r.Review != nil {
		out.LookFor, out.Paths, out.Severity = strs(r.Review.LookFor), strs(r.Review.Paths), r.Review.Severity
	}
	return out
}

func (s *Server) standard(ctx context.Context, l *library, e *entry, p Profile) Standard {
	st := e.std
	out := Standard{
		Header: s.header(l, e), Scope: st.Scope, ExceptionProcess: s.docRef(l, docs.Process, st.ExceptionProcessID), Tags: strs(st.Tags),
		Requirements: []Requirement{}, Resources: resources(st.Resources), Skills: s.skillsOf(ctx, e),
	}
	out.Notice = notice(out.Header)
	for _, r := range st.Requirements {
		if !p.applies(r.Tiers, r.Environments, r.Languages) {
			out.LeftOut++
			continue
		}
		out.Requirements = append(out.Requirements, s.requirement(l, r))
	}
	return out
}

// ---------- text for people reading along

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

func (h Header) line() string {
	b := fmt.Sprintf("%s “%s” (%s, version %d", h.Kind, h.Title, h.ID, h.Version)
	if h.Owner != nil {
		b += ", owned by " + h.Owner.Name
	}
	return b + ")"
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
