package upgrade

import "encoding/json"

// The list of paths that lists stored before there were paths are given, once (see Lists):
// the same three entries as the sample lists (catalog/catalog.json).
var DefaultPaths = json.RawMessage(`[{"id":"greenfield","name":"Greenfield","alsoCalled":["green field"],"symbol":"sprout","description":"Something new is built from scratch, with no system to fit into yet."},` +
	`{"id":"brownfield","name":"Brownfield","alsoCalled":["brown field"],"symbol":"buildings","description":"Something that already exists is changed, extended or moved."},` +
	`{"id":"paved-path","name":"Paved path","alsoCalled":["golden path","paved road"],"symbol":"road","description":"The ready-made, supported way, also called the golden path: templates and platforms that already meet the standards."}]`)

// defaultPathCount is how many entries DefaultPaths has.
const defaultPathCount = 3

const (
	// PathsNote is what the history of the lists says when the paths were all that was added.
	PathsNote = "Added the list of paths"
	// PathsSummary is what the activity log says about it.
	PathsSummary = "added the list of paths: Greenfield, Brownfield and Paved path"
)
