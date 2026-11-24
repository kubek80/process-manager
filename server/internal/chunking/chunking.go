// Package chunking splits a process or a standard into the pieces that search by meaning
// compares with a question.
//
// The split is parent-child. The PARENT is the whole process or standard. Its CHILDREN are its
// summary, each step, each prerequisite ("before you start"), each requirement and, for a
// standard, its scope. Every child's Text starts with what the parent is ("Process: Request a
// GCP project"), so a child can be embedded and understood on its own; Label is what a person
// calls the part ("Step 3: Approve the budget") and Item points at the exact step or
// requirement, so search can link to it.
//
// Which parts become children and the largest size of one child are settings (Options). The
// result depends only on the body, the lists and the options: same input, same chunks, in the
// reading order of the document. Nothing here talks to a database or the network.
package chunking

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// The parts a document can be split into.
const (
	Summary      = "summary"
	Step         = "step"
	Prerequisite = "prerequisite"
	Requirement  = "requirement"
	Scope        = "scope"
)

// AllParts are the parts in the order they are listed by default.
var AllParts = []string{Summary, Step, Prerequisite, Requirement, Scope}

// DefaultMaxChars is the largest size of one child, in characters, when nothing is set.
const DefaultMaxChars = 2000

// Chunk is one child of a document.
type Chunk struct {
	Kind, DocID string // "process" | "standard", the document id
	Part        string // "summary" | "step" | "prerequisite" | "requirement" | "scope"
	Item        string // step id or requirement id; "" for summary and scope; the position ("0", "1"…) for a prerequisite
	Label       string // what a person calls it, e.g. "Step 3: Approve the monthly budget"
	Text        string // what is embedded: starts with the parent's kind and title
}

// Options choose which parts become children and the largest size of one. A zero field means
// its default: all parts, DefaultMaxChars.
type Options struct {
	Parts    []string
	MaxChars int
}

// Default returns all parts and DefaultMaxChars.
func Default() Options {
	return Options{Parts: append([]string(nil), AllParts...), MaxChars: DefaultMaxChars}
}

// ParseParts reads a comma-separated list of parts, e.g. "summary,step". Spaces and repeats are
// ignored; an empty string means all parts; an unknown part is an error.
func ParseParts(s string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, p := range strings.Split(s, ",") {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if !known(p) {
			return nil, fmt.Errorf("%q is not a part a document can be split into; the parts are %s", p, strings.Join(AllParts, ", "))
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return append([]string(nil), AllParts...), nil
	}
	return out, nil
}

func known(p string) bool {
	for _, k := range AllParts {
		if p == k {
			return true
		}
	}
	return false
}

func (o Options) resolve() (map[string]bool, int, error) {
	parts := o.Parts
	if len(parts) == 0 {
		parts = AllParts
	}
	want := map[string]bool{}
	for _, p := range parts {
		if !known(p) {
			return nil, 0, fmt.Errorf("%q is not a part a document can be split into; the parts are %s", p, strings.Join(AllParts, ", "))
		}
		want[p] = true
	}
	max := o.MaxChars
	if max <= 0 {
		max = DefaultMaxChars
	}
	return want, max, nil
}

// Version changes whenever the text of the chunks is put together differently, so that an
// index can tell that every stored chunk has to be embedded again.
const Version = 3

// The shapes below read only what the chunks need; every field is optional here, so a body
// that lacks one never panics. The format itself is checked elsewhere (docs.Check).

type where struct {
	Tiers        []string `json:"tiers"`
	Environments []string `json:"environments"`
	Languages    []string `json:"languages"`
}

type common struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Summary  string   `json:"summary"`
	Owner    string   `json:"owner"`
	Category string   `json:"category"`
	Platform string   `json:"platform"`
	Practice string   `json:"practice"`
	Tags     []string `json:"tags"`
	// Paths: what the whole document is for (greenfield, paved path…); a requirement has none.
	Paths []string `json:"paths"`
	where
}

type resource struct {
	Title string `json:"title"`
}

type process struct {
	common
	Rigour            string   `json:"rigour"`
	EstimatedDuration string   `json:"estimatedDuration"`
	Standards         []string `json:"standards"`
	Prerequisites     []struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		ProcessID   string `json:"processId"`
	} `json:"prerequisites"`
	Actors []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
	} `json:"actors"`
	Steps []struct {
		ID           string     `json:"id"`
		Title        string     `json:"title"`
		Actor        string     `json:"actor"`
		Tool         string     `json:"tool"`
		Description  string     `json:"description"`
		Instructions []string   `json:"instructions"`
		Outcome      string     `json:"outcome"`
		Duration     string     `json:"duration"`
		URLLabel     string     `json:"urlLabel"`
		Resources    []resource `json:"resources"`
		SubProcessID string     `json:"subProcessId"`
	} `json:"steps"`
}

type standard struct {
	common
	Scope        string `json:"scope"`
	Requirements []struct {
		ID           string   `json:"id"`
		Title        string   `json:"title"`
		Level        string   `json:"level"`
		Statement    string   `json:"statement"`
		Rationale    string   `json:"rationale"`
		Guidance     []string `json:"guidance"`
		ProcessID    string   `json:"processId"`
		Verification struct {
			Method      string `json:"method"`
			Description string `json:"description"`
		} `json:"verification"`
		Review struct {
			LookFor []string `json:"lookFor"`
		} `json:"review"`
		Examples struct {
			Good []string `json:"good"`
			Bad  []string `json:"bad"`
		} `json:"examples"`
		where
	} `json:"requirements"`
}

// Chunks returns the children of one process or standard, in reading order: summary, then
// (process) prerequisites and steps, or (standard) scope and requirements. A kind other than
// process or standard, a body that is not a JSON object, or an unknown part is an error.
//
// Only the body and the lists are known here, not other documents: a sub-process, the process
// that produces a prerequisite and the standards a process helps to meet are named by their
// id (an id is a few words joined by dashes, so it still matches as words).
func Chunks(kind string, body []byte, lists docs.Lists, o Options) ([]Chunk, error) {
	want, max, err := o.resolve()
	if err != nil {
		return nil, err
	}
	b := builder{kind: kind, max: max, want: want, lists: lists}
	switch kind {
	case docs.Process:
		var p process
		if err := json.Unmarshal(body, &p); err != nil {
			return nil, fmt.Errorf("not a process: %v", err)
		}
		b.id, b.head = p.ID, "Process: "+clean(p.Title)
		b.add(Summary, "", "Summary", append([]section{
			{text: line("", p.Summary)},
			{text: line("How binding", rigour(p.Rigour))},
			{text: line("Where it applies", b.applies(p.where, true))},
			{text: line("Lead time", p.EstimatedDuration)},
			{text: line("Helps to meet the standards", joined(p.Standards))},
		}, b.belongs(p.common)...)...)
		for i, q := range p.Prerequisites {
			b.add(Prerequisite, strconv.Itoa(i), "Before you start: "+clean(q.Title),
				section{text: line("Before you start", q.Title)}, section{text: line("", q.Description)},
				section{text: line("Comes from the process", q.ProcessID)})
		}
		type lane struct{ name, about string }
		lanes := map[string]lane{}
		for _, a := range p.Actors {
			lanes[a.ID] = lane{a.Name, a.Description}
		}
		for i, s := range p.Steps {
			who, ok := lanes[s.Actor]
			if !ok || who.name == "" {
				who.name = s.Actor
			}
			if s.Actor == "me" {
				who.about = "" // the reader: the same on every step, says nothing about this one
			}
			tool := ""
			if s.Tool != "" {
				tool = docs.Name(lists.Tools, s.Tool)
			}
			var titles []string
			for _, r := range s.Resources {
				titles = append(titles, r.Title)
			}
			label := fmt.Sprintf("Step %d: %s", i+1, clean(s.Title))
			b.add(Step, s.ID, label,
				section{text: line("", label)},
				section{text: line("Done by", who.name)},
				section{text: line("About "+clean(who.name), who.about), drop: 1},
				section{text: line("Tool", tool)},
				section{text: line("", s.Description)},
				section{text: list("Instructions", s.Instructions)},
				section{text: line("Outcome", s.Outcome)},
				section{text: line("Takes", s.Duration), drop: 1},
				section{text: line("Uses the process", s.SubProcessID)},
				section{text: line("Link", s.URLLabel), drop: 2},
				section{text: line("Resources", joined(titles)), drop: 2})
		}
	case docs.Standard:
		var s standard
		if err := json.Unmarshal(body, &s); err != nil {
			return nil, fmt.Errorf("not a standard: %v", err)
		}
		b.id, b.head = s.ID, "Standard: "+clean(s.Title)
		b.add(Summary, "", "Summary", append([]section{
			{text: line("", s.Summary)},
			{text: line("Requirements", requirementCount(s))},
			{text: line("Where it applies", b.applies(s.where, false))},
		}, b.belongs(s.common)...)...)
		if strings.TrimSpace(s.Scope) != "" {
			b.add(Scope, "", "Scope", section{text: line("Scope", s.Scope)})
		}
		for _, r := range s.Requirements {
			label := clean(r.ID) + ": " + clean(r.Title)
			secs := []section{
				{text: line("", label)},
				{text: line("Level", level(r.Level))},
				{text: line("Applies only to", b.narrowed(r.where))},
				{text: line("", r.Statement)},
				{text: line("Why", r.Rationale)},
				{text: list("How to comply", r.Guidance)},
				{text: line("A process that helps", r.ProcessID)},
				{text: line("How it is checked", checked(r.Verification.Method, r.Verification.Description))},
			}
			// When the size limit bites, the examples go first, then the review hints.
			for _, h := range r.Review.LookFor {
				secs = append(secs, section{text: line("A reviewer looks for", h), drop: 1})
			}
			for _, e := range r.Examples.Good {
				secs = append(secs, section{text: line("Good example", e), drop: 2})
			}
			for _, e := range r.Examples.Bad {
				secs = append(secs, section{text: line("Bad example, do not do this", e), drop: 2})
			}
			b.add(Requirement, r.ID, label, secs...)
		}
	default:
		return nil, fmt.Errorf("%q is neither a process nor a standard", kind)
	}
	return b.out, nil
}

// level puts a requirement's level in the words the portal uses.
func level(l string) string {
	switch l {
	case "must":
		return "mandatory (must)"
	case "should":
		return "recommended (should)"
	case "may":
		return "optional (may)"
	}
	return l
}

// rigour puts how binding a process is in words.
func rigour(r string) string {
	switch r {
	case "mandatory":
		return "mandatory, the only allowed way to get this done"
	case "recommended":
		return "recommended, the expected way; another way needs a good reason"
	case "optional":
		return "optional, a help that may be used"
	}
	return r
}

// checked says how a requirement is checked.
func checked(method, description string) string {
	var how string
	switch method {
	case "automated":
		how = "automatically, by a pipeline or scanner"
	case "review":
		how = "in code review"
	case "manual":
		how = "by a person, outside code review"
	default:
		how = clean(method)
	}
	d := clean(description)
	switch {
	case how == "":
		return d
	case d == "":
		return how
	}
	return how + ". " + d
}

// requirementCount is "5 (3 mandatory, 2 recommended)".
func requirementCount(s standard) string {
	if len(s.Requirements) == 0 {
		return ""
	}
	n := map[string]int{}
	for _, r := range s.Requirements {
		n[r.Level]++
	}
	var parts []string
	for _, l := range []struct{ key, word string }{{"must", "mandatory"}, {"should", "recommended"}, {"may", "optional"}} {
		if n[l.key] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", n[l.key], l.word))
		}
	}
	out := strconv.Itoa(len(s.Requirements))
	if len(parts) > 0 {
		out += " (" + strings.Join(parts, ", ") + ")"
	}
	return out
}

// joined is a comma-separated list of the non-empty items.
func joined(items []string) string {
	var out []string
	for _, it := range items {
		if it = clean(it); it != "" {
			out = append(out, it)
		}
	}
	return strings.Join(out, ", ")
}

// section is one line (or block) of a child's text. drop says what goes first when the text
// is longer than the limit: 2 first, then 1; 0 is never dropped, only cut at the end.
type section struct {
	text string
	drop int
}

type builder struct {
	kind, id, head string
	max            int
	want           map[string]bool
	lists          docs.Lists
	out            []Chunk
}

func (b *builder) name(list []docs.Named, id string) string {
	if id == "" {
		return ""
	}
	return docs.Name(list, id)
}

// belongs: tags, category, platform, practice, owning team and the paths it is for, by name
// (a path with what else it is called: "Paved path (also called golden path, paved road)").
func (b *builder) belongs(c common) []section {
	l := b.lists
	return []section{
		{text: line("Tags", joined(c.Tags))},
		{text: line("Category", b.name(l.Categories, c.Category))},
		{text: line("Platform", b.name(l.Platforms, c.Platform))},
		{text: line("Practice", b.name(l.Practices, c.Practice))},
		{text: line("Owned by", b.name(l.Teams, c.Owner))},
		{text: line("Meant for the paths", docs.PathNames(l.Paths, c.Paths))},
	}
}

// applies is where a document applies, in words: "all tiers; environments Production; all
// programming languages". A standard that is not narrowed to languages says "all programming
// languages" too; a process says it does not depend on the language.
func (b *builder) applies(w where, process bool) string {
	l := b.lists
	one := func(ids []string, list []docs.Named, noun, all string) string {
		if len(ids) == 0 {
			return all
		}
		return noun + " " + strings.Join(docs.Names(list, ids), ", ")
	}
	langs := "all programming languages"
	if process {
		langs = "any programming language"
	}
	return strings.Join([]string{
		one(w.Tiers, l.Tiers, "tiers", "all tiers"),
		one(w.Environments, l.Environments, "environments", "all environments"),
		one(w.Languages, l.Languages, "programming languages", langs),
	}, "; ")
}

// narrowed is where a requirement applies when it is narrowed; "" when it applies wherever
// its standard does.
func (b *builder) narrowed(w where) string {
	l := b.lists
	var out []string
	if len(w.Tiers) > 0 {
		out = append(out, "tiers "+strings.Join(docs.Names(l.Tiers, w.Tiers), ", "))
	}
	if len(w.Environments) > 0 {
		out = append(out, "environments "+strings.Join(docs.Names(l.Environments, w.Environments), ", "))
	}
	if len(w.Languages) > 0 {
		out = append(out, "programming languages "+strings.Join(docs.Names(l.Languages, w.Languages), ", "))
	}
	return strings.Join(out, "; ")
}

// add makes one child when its part is wanted: the parent's heading followed by the non-empty
// sections. When that is longer than the limit, sections are dropped (drop 2 first, the last
// one first, then drop 1) and what is left is cut at the end.
func (b *builder) add(part, item, label string, secs ...section) {
	if !b.want[part] {
		return
	}
	kept := []section{{text: b.head}}
	for _, s := range secs {
		if s.text != "" {
			kept = append(kept, s)
		}
	}
	text := join(kept)
	for utf8.RuneCountInString(text) > b.max {
		at := -1
		for i, s := range kept {
			if s.drop > 0 && (at < 0 || s.drop >= kept[at].drop) {
				at = i
			}
		}
		if at < 0 {
			break
		}
		kept = append(kept[:at], kept[at+1:]...)
		text = join(kept)
	}
	b.out = append(b.out, Chunk{
		Kind: b.kind, DocID: b.id, Part: part, Item: item, Label: label,
		Text: cut(text, b.max),
	})
}

func join(secs []section) string {
	t := make([]string, len(secs))
	for i, s := range secs {
		t[i] = s.text
	}
	return strings.Join(t, "\n")
}

// clean folds runs of white space (including line breaks) into one space.
func clean(s string) string { return strings.Join(strings.Fields(s), " ") }

// line is "Name: value", or just the value without a name; "" when the value is empty.
func line(name, value string) string {
	value = clean(value)
	if value == "" {
		return ""
	}
	if name == "" {
		return value
	}
	return name + ": " + value
}

// list is a named list of items, one per line; "" when there are none.
func list(name string, items []string) string {
	var out []string
	for _, it := range items {
		if it = clean(it); it != "" {
			out = append(out, "- "+it)
		}
	}
	if len(out) == 0 {
		return ""
	}
	return name + ":\n" + strings.Join(out, "\n")
}

// cut shortens a text to at most max characters (runes).
//
// A part that is too long is CUT, not split into several children. One child per step or
// requirement keeps search simple and honest: each hit is one part, a long step cannot crowd
// the short ones out of the best three hits, and the index has a fixed number of chunks per
// document. The beginning of a child carries what matters most for a match (the parent, the
// title, who does it, the statement); what is cut is the end (the last instructions and the
// outcome of a step; how a requirement is checked and the last of its guidance). Before anything is cut, the least important lines are left out (see builder.add:
// examples, then review hints of a requirement; links and resources, then the lane's
// description and the duration of a step). With the schema's own limits a part rarely
// reaches the default size.
//
// The cut is made at the end of the last sentence or line in the second half of the allowed
// size, otherwise at the last word boundary, never in the middle of a word. Only a single
// "word" longer than the whole limit is cut inside, as nothing else is possible.
func cut(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	// prefix = the first max runes; next = the rune after them.
	end := 0
	for i := 0; i < max; i++ {
		_, n := utf8.DecodeRuneInString(s[end:])
		end += n
	}
	prefix := s[:end]
	if r, _ := utf8.DecodeRuneInString(s[end:]); unicode.IsSpace(r) {
		return strings.TrimRightFunc(prefix, unicode.IsSpace)
	}
	half := len(prefix) / 2
	if i := lastSentenceEnd(prefix); i >= half {
		return strings.TrimRightFunc(prefix[:i], unicode.IsSpace)
	}
	if i := strings.LastIndexFunc(prefix, unicode.IsSpace); i > 0 {
		if t := strings.TrimRightFunc(prefix[:i], unicode.IsSpace); t != "" {
			return t
		}
	}
	return prefix
}

// lastSentenceEnd is the byte position just after the last ". ", "! ", "? " or line break in s,
// or -1.
func lastSentenceEnd(s string) int {
	best := -1
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\n':
			best = i
		case '.', '!', '?':
			if i+1 < len(s) && (s[i+1] == ' ' || s[i+1] == '\n') {
				best = i + 1
			}
		}
	}
	return best
}
