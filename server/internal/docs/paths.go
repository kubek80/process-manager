package docs

import (
	"fmt"
	"strings"
)

// PathNames names the paths a document is for, in the order it gives them, each with its other
// names (the entry's "alsoCalled"): "Greenfield, Paved path (also called golden path, paved
// road)". An id that is not in the list is named by its id. Empty when it names none. The
// architecture patterns a document is tagged with are named the same way (PatternNames).
func PathNames(list []Named, ids []string) string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		n, ok := find(list, id)
		if !ok {
			out = append(out, id)
			continue
		}
		name := n.Name
		if also := OtherNames(n); len(also) > 0 {
			name += " (also called " + strings.Join(also, ", ") + ")"
		}
		out = append(out, name)
	}
	return strings.Join(out, ", ")
}

// PatternNames names the architecture patterns a document is tagged with, as PathNames names
// the paths: "Event-driven (also called event-based, EDA), Microservices".
func PatternNames(list []Named, ids []string) string { return PathNames(list, ids) }

// OtherNames are the other names of an entry of the paths or the architecture patterns, trimmed, without empty ones.
func OtherNames(n Named) []string {
	var out []string
	for _, a := range n.AlsoCalled {
		if a = strings.TrimSpace(a); a != "" {
			out = append(out, a)
		}
	}
	return out
}

// otherNameClashes: an other name of a path belongs to one path only, and is no other path's
// name, whatever its case, so that a search or an agent can tell which path is meant. In the
// app's words (otherNameClashes in src/lib/paths.ts).
func otherNameClashes(paths []Named) []string {
	return nameClashes("paths", "path", "paths", paths)
}

// otherPatternNameClashes: the same for the architecture patterns (patternNameClashes in
// src/lib/patterns.ts).
func otherPatternNameClashes(patterns []Named) []string {
	return nameClashes("patterns", "architecture pattern", "architecture patterns", patterns)
}

func nameClashes(key, one, many string, entries []Named) []string {
	var out []string
	k := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	for i, e := range entries {
		for _, also := range OtherNames(e) {
			for j, o := range entries {
				if j == i {
					continue
				}
				if k(o.Name) == k(also) {
					out = append(out, fmt.Sprintf("%s[%d].alsoCalled: The %s “%s” is also called “%s”, which is the name of the %s “%s”: take it off “%s”.", key, i, one, e.Name, also, one, o.Name, e.Name))
					break
				}
				same := false
				for _, y := range OtherNames(o) {
					same = same || k(y) == k(also)
				}
				if j < i && same {
					out = append(out, fmt.Sprintf("%s[%d].alsoCalled: The %s “%s” and “%s” are both also called “%s”: keep it on one of them.", key, i, many, o.Name, e.Name, also))
					break
				}
			}
		}
	}
	return out
}
