package docs

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// The format of a document is checked against the JSON schema. This file checks what a schema
// cannot: that the parts of a document fit together, and that it only names tiers, languages,
// environments, categories, practices and platforms that exist. These are the same rules the checker in the browser treats as
// errors (src/lib/validate.ts); what the browser only warns about is allowed here too.

type dims struct {
	Tiers        []string `json:"tiers"`
	Languages    []string `json:"languages"`
	Environments []string `json:"environments"`
}

// belongs is where a process or standard sits: its category, practice and platform. The
// owner is a team; a team that is not in the lists is only a warning in the app.
type belongs struct {
	Category string `json:"category"`
	Practice string `json:"practice"`
	Platform string `json:"platform"`
}

func (b belongs) check(l Lists, add func(string, ...any)) {
	one := func(field, noun, plural, id string, list []Named) {
		if id != "" && !has(list, id) {
			add("%s: %q is not a known %s. Known %s: %s", field, id, noun, plural, ids(list))
		}
	}
	one("category", "category", "categories", b.Category, l.Categories)
	one("practice", "practice", "practices", b.Practice, l.Practices)
	one("platform", "platform", "platforms", b.Platform, l.Platforms)
}

// lifecycle is what a process and a standard record about their review.
type lifecycle struct {
	Review *struct {
		LastReviewedAt string `json:"lastReviewedAt"`
	} `json:"review"`
}

// check: the format only says what a date looks like; "2026-13-45" looks like one.
func (l lifecycle) check(add func(string, ...any)) {
	if l.Review == nil || l.Review.LastReviewedAt == "" {
		return
	}
	if _, err := time.Parse("2006-01-02", l.Review.LastReviewedAt); err != nil {
		add("review.lastReviewedAt: %q is not a date", l.Review.LastReviewedAt)
	}
}

type processShape struct {
	ID string `json:"id"`
	lifecycle
	dims
	belongs
	Owner         string   `json:"owner"`
	ReplacedBy    string   `json:"replacedBy"`
	Standards     []string `json:"standards"`
	Prerequisites []struct {
		ProcessID string `json:"processId"`
	} `json:"prerequisites"`
	Actors []struct {
		ID     string `json:"id"`
		TeamID string `json:"teamId"`
	} `json:"actors"`
	Steps []struct {
		ID           string `json:"id"`
		Actor        string `json:"actor"`
		Type         string `json:"type"`
		Tool         string `json:"tool"`
		SubProcessID string `json:"subProcessId"`
		Next         []struct {
			To    string `json:"to"`
			Label string `json:"label"`
		} `json:"next"`
	} `json:"steps"`
}

type standardShape struct {
	ID string `json:"id"`
	lifecycle
	dims
	belongs
	Owner              string `json:"owner"`
	ReplacedBy         string `json:"replacedBy"`
	ExceptionProcessID string `json:"exceptionProcessId"`
	Requirements       []struct {
		ID string `json:"id"`
		dims
		ProcessID string `json:"processId"`
	} `json:"requirements"`
}

func has(list []Named, id string) bool {
	for _, n := range list {
		if n.ID == id {
			return true
		}
	}
	return false
}

func ids(list []Named) string {
	out := make([]string, 0, len(list))
	for _, n := range list {
		out = append(out, n.ID)
	}
	if len(out) == 0 {
		return "(none)"
	}
	return strings.Join(out, ", ")
}

func (d dims) check(at string, l Lists, add func(string, ...any)) {
	for i, id := range d.Tiers {
		if !has(l.Tiers, id) {
			add("%stiers[%d]: %q is not a known tier. Known tiers: %s", at, i, id, ids(l.Tiers))
		}
	}
	for i, id := range d.Languages {
		if !has(l.Languages, id) {
			add("%slanguages[%d]: %q is not a known language. Known languages: %s", at, i, id, ids(l.Languages))
		}
	}
	for i, id := range d.Environments {
		if !has(l.Environments, id) {
			add("%senvironments[%d]: %q is not a known environment. Known environments: %s", at, i, id, ids(l.Environments))
		}
	}
}

// Check reports what is wrong inside a document that already matches its schema. The result
// is nil or an error that wraps ErrInvalid and names up to three problems.
func Check(kind string, body []byte, l Lists) error {
	var problems []string
	add := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	switch kind {
	case Process:
		var p processShape
		if err := json.Unmarshal(body, &p); err != nil {
			return fmt.Errorf("%w: not a process: %v", ErrInvalid, err)
		}
		p.dims.check("", l, add)
		p.belongs.check(l, add)
		p.lifecycle.check(add)
		if p.ReplacedBy != "" && p.ReplacedBy == p.ID {
			add("replacedBy: A process cannot replace itself: choose another one under “Use instead”.")
		}
		actors := map[string]bool{}
		for i, a := range p.Actors {
			if actors[a.ID] {
				add("actors[%d].id: Two participants have the same id “%s”: repair it in the JSON.", i, a.ID)
			}
			actors[a.ID] = true
		}
		steps := map[string]bool{}
		for i, s := range p.Steps {
			if steps[s.ID] {
				add("steps[%d].id: Two steps have the same id “%s”: repair it in the JSON.", i, s.ID)
			}
			steps[s.ID] = true
		}
		for i, s := range p.Steps {
			if !actors[s.Actor] {
				add("steps[%d].actor: Who does it (“%s”) is not one of the participants: choose who does it.", i, s.Actor)
			}
			seen := map[string]bool{}
			for j, n := range s.Next {
				switch {
				case !steps[n.To]:
					add("steps[%d].next[%d].to: This way on leads to a step that does not exist (“%s”): choose where it goes.", i, j, n.To)
				case n.To == s.ID:
					add("steps[%d].next[%d].to: A step cannot lead to itself: choose another step.", i, j)
				case seen[n.To]:
					add("steps[%d].next[%d].to: Another answer already leads to this step: let each lead somewhere else.", i, j)
				}
				seen[n.To] = true
			}
			if s.Type == "decision" {
				if len(s.Next) < 2 {
					add("steps[%d].next: This decision needs at least two answers that lead somewhere.", i)
				}
				for _, n := range s.Next {
					if n.Label == "" {
						add("steps[%d].next: Every answer of a decision needs a name, such as Approved or Rejected.", i)
						break
					}
				}
			}
			if s.Type == "subprocess" && s.SubProcessID == "" {
				add("steps[%d].subProcessId: A sub-process step needs the process it stands for: choose it under “Explained by sub-process”.", i)
			}
			if s.SubProcessID != "" && s.SubProcessID == p.ID {
				add("steps[%d].subProcessId: A process cannot be its own sub-process.", i)
			}
		}
		for i, q := range p.Prerequisites {
			if q.ProcessID != "" && q.ProcessID == p.ID {
				add("prerequisites[%d].processId: A process cannot be needed before itself: choose another process that provides it.", i)
			}
		}
	case Standard:
		var s standardShape
		if err := json.Unmarshal(body, &s); err != nil {
			return fmt.Errorf("%w: not a standard: %v", ErrInvalid, err)
		}
		s.dims.check("", l, add)
		s.belongs.check(l, add)
		s.lifecycle.check(add)
		if s.ReplacedBy != "" && s.ReplacedBy == s.ID {
			add("replacedBy: A standard cannot replace itself: choose another one under “Use instead”.")
		}
		seen := map[string]bool{}
		for i, r := range s.Requirements {
			if seen[r.ID] {
				add("requirements[%d].id: duplicate requirement id %q", i, r.ID)
			}
			seen[r.ID] = true
			r.dims.check(fmt.Sprintf("requirements[%d].", i), l, add)
		}
	case Catalog:
		var c Lists
		if err := json.Unmarshal(body, &c); err != nil {
			return fmt.Errorf("%w: not the lists: %v", ErrInvalid, err)
		}
		// in the app's words (duplicateSentence in src/lib/validate.ts): an id never changes, so one is removed
		for _, key := range ListKeys {
			list := c.ByKey(key)
			first := map[string]string{}
			for i, n := range list {
				if name, seen := first[n.ID]; seen {
					both := ""
					switch a, b := strings.TrimSpace(name), strings.TrimSpace(n.Name); {
					case a == "" || b == "":
					case a == b:
						both = fmt.Sprintf(", both called “%s”", a)
					default:
						both = fmt.Sprintf(" (“%s” and “%s”)", a, b)
					}
					add("%s[%d].id: Two %s have the id “%s”%s: remove one of them.", key, i, key, n.ID, both)
					continue
				}
				first[n.ID] = n.Name
			}
		}
		// links people follow are http:// or https:// only, also when the format was not checked
		for _, g := range []struct {
			noun string
			list []Named
		}{{"team", c.Teams}, {"practice", c.Practices}, {"platform", c.Platforms}} {
			for _, n := range g.list {
				problems = append(problems, n.Contacts.Problems(EntryWords(g.noun, n))...)
			}
		}
		sort.Strings(problems) // the lists are visited in no fixed order
	}
	if len(problems) == 0 {
		return nil
	}
	more := ""
	if len(problems) > 3 {
		more = fmt.Sprintf(" (and %d more)", len(problems)-3)
		problems = problems[:3]
	}
	return fmt.Errorf("%w: %s%s", ErrInvalid, strings.Join(problems, "; "), more)
}

// EntryWords names an entry of the lists in a sentence as the app does (listEntryWords in
// src/lib/editing.ts): by its name, else by its id, never by its place: `the platform “Google Cloud”`.
func EntryWords(noun string, n Named) string {
	if name := strings.TrimSpace(n.Name); name != "" {
		return fmt.Sprintf("the %s “%s”", noun, name)
	}
	if id := strings.TrimSpace(n.ID); id != "" {
		return fmt.Sprintf("the %s with the id “%s”", noun, id)
	}
	return fmt.Sprintf("a %s without a name", noun)
}

// ListKeys are the keys of the lists in the catalog document, in the order it has them.
var ListKeys = []string{"tiers", "environments", "languages", "teams", "practices", "platforms", "categories", "tools"}

// Uses is what one process or standard takes from the lists and which other documents it
// names. Keys of Lists: see ListKeys.
type Uses struct {
	Lists map[string]map[string]bool
	Docs  map[string]bool // "process/<id>" and "standard/<id>"
}

// UsesOf reads the references out of a process or standard. Anything else uses nothing.
func UsesOf(kind string, body []byte) Uses {
	u := Uses{Lists: map[string]map[string]bool{}, Docs: map[string]bool{}}
	list := func(key string, ids ...string) {
		for _, id := range ids {
			if id == "" {
				continue
			}
			if u.Lists[key] == nil {
				u.Lists[key] = map[string]bool{}
			}
			u.Lists[key][id] = true
		}
	}
	doc := func(kind, id string) {
		if id != "" {
			u.Docs[kind+"/"+id] = true
		}
	}
	dim := func(d dims) {
		list("tiers", d.Tiers...)
		list("languages", d.Languages...)
		list("environments", d.Environments...)
	}
	where := func(b belongs) {
		list("categories", b.Category)
		list("practices", b.Practice)
		list("platforms", b.Platform)
	}
	switch kind {
	case Process:
		var p processShape
		if json.Unmarshal(body, &p) != nil {
			return u
		}
		dim(p.dims)
		where(p.belongs)
		list("teams", p.Owner)
		doc(Process, p.ReplacedBy)
		for _, sid := range p.Standards {
			doc(Standard, sid)
		}
		for _, q := range p.Prerequisites {
			doc(Process, q.ProcessID)
		}
		for _, a := range p.Actors {
			list("teams", a.TeamID)
		}
		for _, s := range p.Steps {
			list("tools", s.Tool)
			doc(Process, s.SubProcessID)
		}
	case Standard:
		var s standardShape
		if json.Unmarshal(body, &s) != nil {
			return u
		}
		dim(s.dims)
		where(s.belongs)
		list("teams", s.Owner)
		doc(Standard, s.ReplacedBy)
		doc(Process, s.ExceptionProcessID)
		for _, r := range s.Requirements {
			dim(r.dims)
			doc(Process, r.ProcessID)
		}
	}
	return u
}

// Removed lists the entries of the old lists that the new lists no longer have, as
// "<list>/<id>" in a stable order.
func Removed(old, new Lists) []string {
	var out []string
	diff := func(key string, a, b []Named) {
		for _, n := range a {
			if !has(b, n.ID) {
				out = append(out, key+"/"+n.ID)
			}
		}
	}
	for _, key := range ListKeys {
		diff(key, old.ByKey(key), new.ByKey(key))
	}
	sort.Strings(out)
	return out
}
