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

// The shapes below read only what the chunks need; every field is optional here, so a body
// that lacks one never panics. The format itself is checked elsewhere (docs.Check).

type common struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Summary  string   `json:"summary"`
	Owner    string   `json:"owner"`
	Category string   `json:"category"`
	Platform string   `json:"platform"`
	Practice string   `json:"practice"`
	Tags     []string `json:"tags"`
}

type process struct {
	common
	Prerequisites []struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	} `json:"prerequisites"`
	Actors []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"actors"`
	Steps []struct {
		ID           string   `json:"id"`
		Title        string   `json:"title"`
		Actor        string   `json:"actor"`
		Tool         string   `json:"tool"`
		Description  string   `json:"description"`
		Instructions []string `json:"instructions"`
		Outcome      string   `json:"outcome"`
	} `json:"steps"`
}

type standard struct {
	common
	Scope        string `json:"scope"`
	Requirements []struct {
		ID        string   `json:"id"`
		Title     string   `json:"title"`
		Level     string   `json:"level"`
		Statement string   `json:"statement"`
		Rationale string   `json:"rationale"`
		Guidance  []string `json:"guidance"`
	} `json:"requirements"`
}

// Chunks returns the children of one process or standard, in reading order: summary, then
// (process) prerequisites and steps, or (standard) scope and requirements. A kind other than
// process or standard, a body that is not a JSON object, or an unknown part is an error.
func Chunks(kind string, body []byte, lists docs.Lists, o Options) ([]Chunk, error) {
	want, max, err := o.resolve()
	if err != nil {
		return nil, err
	}
	b := builder{kind: kind, max: max, want: want}
	switch kind {
	case docs.Process:
		var p process
		if err := json.Unmarshal(body, &p); err != nil {
			return nil, fmt.Errorf("not a process: %v", err)
		}
		b.id, b.head = p.ID, "Process: "+clean(p.Title)
		b.summary(p.common, lists)
		for i, q := range p.Prerequisites {
			b.add(Prerequisite, strconv.Itoa(i), "Before you start: "+clean(q.Title),
				line("Before you start", q.Title), line("", q.Description))
		}
		lanes := map[string]string{}
		for _, a := range p.Actors {
			lanes[a.ID] = a.Name
		}
		for i, s := range p.Steps {
			who := lanes[s.Actor]
			if who == "" {
				who = s.Actor
			}
			tool := ""
			if s.Tool != "" {
				tool = docs.Name(lists.Tools, s.Tool)
			}
			label := fmt.Sprintf("Step %d: %s", i+1, clean(s.Title))
			b.add(Step, s.ID, label,
				line("", label), line("Done by", who), line("Tool", tool), line("", s.Description),
				list("Instructions", s.Instructions), line("Outcome", s.Outcome))
		}
	case docs.Standard:
		var s standard
		if err := json.Unmarshal(body, &s); err != nil {
			return nil, fmt.Errorf("not a standard: %v", err)
		}
		b.id, b.head = s.ID, "Standard: "+clean(s.Title)
		b.summary(s.common, lists)
		if strings.TrimSpace(s.Scope) != "" {
			b.add(Scope, "", "Scope", line("Scope", s.Scope))
		}
		for _, r := range s.Requirements {
			label := clean(r.ID) + ": " + clean(r.Title)
			b.add(Requirement, r.ID, label,
				line("", label), line("Level", level(r.Level)), line("", r.Statement),
				line("Why", r.Rationale), list("How to comply", r.Guidance))
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

type builder struct {
	kind, id, head string
	max            int
	want           map[string]bool
	out            []Chunk
}

func (b *builder) summary(c common, l docs.Lists) {
	named := func(list []docs.Named, id string) string {
		if id == "" {
			return ""
		}
		return docs.Name(list, id)
	}
	var tags []string
	for _, t := range c.Tags {
		if t = clean(t); t != "" {
			tags = append(tags, t)
		}
	}
	b.add(Summary, "", "Summary",
		line("", c.Summary), line("Tags", strings.Join(tags, ", ")),
		line("Category", named(l.Categories, c.Category)), line("Platform", named(l.Platforms, c.Platform)),
		line("Practice", named(l.Practices, c.Practice)), line("Owned by", named(l.Teams, c.Owner)))
}

// add makes one child when its part is wanted. The text is the parent's heading followed by
// the non-empty lines.
func (b *builder) add(part, item, label string, lines ...string) {
	if !b.want[part] {
		return
	}
	text := []string{b.head}
	for _, l := range lines {
		if l != "" {
			text = append(text, l)
		}
	}
	b.out = append(b.out, Chunk{
		Kind: b.kind, DocID: b.id, Part: part, Item: item, Label: label,
		Text: cut(strings.Join(text, "\n"), b.max),
	})
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
// title, who does it, the statement); what is cut is the tail of long instruction or guidance
// lists. With the schema's own limits a part rarely reaches the default size.
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
