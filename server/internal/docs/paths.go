package docs

import (
	"fmt"
	"strings"
)

// PathNames names the paths a document is for, in the order it gives them, each with its other
// names (the entry's "alsoCalled"): "Greenfield, Paved path (also called golden path, paved
// road)". An id that is not in the list is named by its id. Empty when it names none.
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

// OtherNames are the other names of an entry of the paths, trimmed, without empty ones.
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
	var out []string
	key := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	for i, e := range paths {
		for _, also := range OtherNames(e) {
			for j, o := range paths {
				if j == i {
					continue
				}
				if key(o.Name) == key(also) {
					out = append(out, fmt.Sprintf("paths[%d].alsoCalled: The path “%s” is also called “%s”, which is the name of the path “%s”: take it off “%s”.", i, e.Name, also, o.Name, e.Name))
					break
				}
				same := false
				for _, y := range OtherNames(o) {
					same = same || key(y) == key(also)
				}
				if j < i && same {
					out = append(out, fmt.Sprintf("paths[%d].alsoCalled: The paths “%s” and “%s” are both also called “%s”: keep it on one of them.", i, o.Name, e.Name, also))
					break
				}
			}
		}
	}
	return out
}
