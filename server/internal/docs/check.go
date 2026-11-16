package docs

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// The format of a document is checked against the JSON schema. This file checks what a schema
// cannot: that the parts of a document fit together, and that it only names tiers, languages
// and environments that exist. These are the same rules the checker in the browser treats as
// errors (src/lib/validate.ts); what the browser only warns about is allowed here too.

type dims struct {
	Tiers        []string `json:"tiers"`
	Languages    []string `json:"languages"`
	Environments []string `json:"environments"`
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
		p.lifecycle.check(add)
		if p.ReplacedBy != "" && p.ReplacedBy == p.ID {
			add("replacedBy: a process cannot replace itself")
		}
		actors := map[string]bool{}
		for i, a := range p.Actors {
			if actors[a.ID] {
				add("actors[%d].id: duplicate actor id %q", i, a.ID)
			}
			actors[a.ID] = true
		}
		steps := map[string]bool{}
		for i, s := range p.Steps {
			if steps[s.ID] {
				add("steps[%d].id: duplicate step id %q", i, s.ID)
			}
			steps[s.ID] = true
		}
		for i, s := range p.Steps {
			if !actors[s.Actor] {
				add("steps[%d].actor: %q is not one of the participants", i, s.Actor)
			}
			seen := map[string]bool{}
			for j, n := range s.Next {
				switch {
				case !steps[n.To]:
					add("steps[%d].next[%d].to: %q is not a step of this process", i, j, n.To)
				case n.To == s.ID:
					add("steps[%d].next[%d].to: a step cannot point to itself", i, j)
				case seen[n.To]:
					add("steps[%d].next[%d].to: %q is listed twice", i, j, n.To)
				}
				seen[n.To] = true
			}
			if s.Type == "decision" {
				if len(s.Next) < 2 {
					add("steps[%d].next: a decision needs at least two outgoing paths", i)
				}
				for _, n := range s.Next {
					if n.Label == "" {
						add("steps[%d].next: every path out of a decision needs a label", i)
						break
					}
				}
			}
			if s.Type == "subprocess" && s.SubProcessID == "" {
				add("steps[%d].subProcessId: a sub-process step must name the process", i)
			}
			if s.SubProcessID != "" && s.SubProcessID == p.ID {
				add("steps[%d].subProcessId: a process cannot use itself as a sub-process", i)
			}
		}
		for i, q := range p.Prerequisites {
			if q.ProcessID != "" && q.ProcessID == p.ID {
				add("prerequisites[%d].processId: a process cannot be its own prerequisite", i)
			}
		}
	case Standard:
		var s standardShape
		if err := json.Unmarshal(body, &s); err != nil {
			return fmt.Errorf("%w: not a standard: %v", ErrInvalid, err)
		}
		s.dims.check("", l, add)
		s.lifecycle.check(add)
		if s.ReplacedBy != "" && s.ReplacedBy == s.ID {
			add("replacedBy: a standard cannot replace itself")
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
		for key, list := range map[string][]Named{"tiers": c.Tiers, "environments": c.Environments, "languages": c.Languages, "teams": c.Teams, "tools": c.Tools} {
			seen := map[string]bool{}
			for i, n := range list {
				if seen[n.ID] {
					add("%s[%d].id: duplicate id %q", key, i, n.ID)
				}
				seen[n.ID] = true
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

// Uses is what one process or standard takes from the lists and which other documents it
// names. Keys of Lists: "tiers", "environments", "languages", "teams", "tools".
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
	switch kind {
	case Process:
		var p processShape
		if json.Unmarshal(body, &p) != nil {
			return u
		}
		dim(p.dims)
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
	diff("tiers", old.Tiers, new.Tiers)
	diff("environments", old.Environments, new.Environments)
	diff("languages", old.Languages, new.Languages)
	diff("teams", old.Teams, new.Teams)
	diff("tools", old.Tools, new.Tools)
	sort.Strings(out)
	return out
}
