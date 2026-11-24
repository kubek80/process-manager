package docs

import "strings"

// PathAlso is what else people call a path, by its picture, so that those words find what is
// on that path: "golden path" finds what is on the paved path. The app says the same
// (PATH_ALSO in src/lib/paths.ts).
var PathAlso = map[string][]string{
	"road":      {"golden path", "paved road"},
	"sprout":    {"green field"},
	"buildings": {"brown field"},
}

// PathNames names the paths a document is for, in the order it gives them, each with what else
// it is called: "Greenfield, Paved path (also called golden path, paved road)". An id that is
// not in the list is named by its id. Empty when it names none.
func PathNames(list []Named, ids []string) string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		n, ok := find(list, id)
		if !ok {
			out = append(out, id)
			continue
		}
		name := n.Name
		if also := PathAlso[n.Symbol]; len(also) > 0 {
			name += " (also called " + strings.Join(also, ", ") + ")"
		}
		out = append(out, name)
	}
	return strings.Join(out, ", ")
}
