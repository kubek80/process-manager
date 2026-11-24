package docs_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// the lists with the three paths
const withPaths = `{"tiers":[{"id":"tier-0","name":"Tier 0"}],"paths":[{"id":"greenfield","name":"Greenfield","symbol":"sprout"},{"id":"brownfield","name":"Brownfield","symbol":"buildings"},{"id":"paved-path","name":"Paved path","symbol":"road"}],
"environments":[],"languages":[],"teams":[{"id":"network-team","name":"Network"},{"id":"security","name":"Security"}],"tools":[]}`

func TestPathsMustBeInTheLists(t *testing.T) {
	l := listsOf(t, withPaths)
	if len(l.Paths) != 3 || l.Paths[2].Symbol != "road" || len(l.ByKey("paths")) != 3 {
		t.Fatalf("paths: %+v", l.Paths)
	}
	process := strings.Replace(vpn, `"steps":`, `"actors":[{"id":"me","name":"You"}],"steps":`, 1)
	on := func(body, field, value string) []byte {
		return []byte(strings.Replace(body, `"owner":"`+field, `"paths":`+value+`,"owner":"`+field, 1))
	}
	for _, c := range []struct {
		kind  string
		body  []byte
		wrong string
	}{
		{docs.Process, on(process, "network-team", `["greenfield","paved-path"]`), ""},
		{docs.Standard, on(logging, "security", `["brownfield"]`), ""},
		{docs.Process, on(process, "network-team", `[]`), ""},
		{docs.Process, on(process, "network-team", `["greenfield","golden-path"]`), `paths[1]: "golden-path" is not a known path. Known paths: greenfield, brownfield, paved-path`},
		{docs.Standard, on(logging, "security", `["Greenfield"]`), `paths[0]: "Greenfield" is not a known path`},
	} {
		err := docs.Check(c.kind, c.body, l)
		if c.wrong == "" && err != nil {
			t.Errorf("%s %s: %v", c.kind, c.body[:60], err)
		}
		if c.wrong != "" && (!errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), c.wrong)) {
			t.Errorf("%s: want %q, got %v", c.kind, c.wrong, err)
		}
	}
	// lists stored before there were paths: no path can be named
	if err := docs.Check(docs.Process, on(process, "network-team", `["greenfield"]`), listsOf(t, lists)); err == nil || !strings.Contains(err.Error(), "Known paths: (none)") {
		t.Fatalf("missing paths count as empty: %v", err)
	}
}

func TestPathsAreUsesAndCanBeRemoved(t *testing.T) {
	process := strings.Replace(vpn, `"owner":"network-team"`, `"paths":["greenfield"],"owner":"network-team"`, 1)
	if u := docs.UsesOf(docs.Process, []byte(process)); !u.Lists["paths"]["greenfield"] || len(u.Lists["paths"]) != 1 {
		t.Fatalf("process uses: %+v", u.Lists)
	}
	std := strings.Replace(logging, `"owner":"security"`, `"paths":["paved-path","brownfield"],"owner":"security"`, 1)
	if u := docs.UsesOf(docs.Standard, []byte(std)); !u.Lists["paths"]["paved-path"] || !u.Lists["paths"]["brownfield"] {
		t.Fatalf("standard uses: %+v", u.Lists)
	}
	after := strings.Replace(withPaths, `{"id":"brownfield","name":"Brownfield","symbol":"buildings"},`, "", 1)
	if removed := docs.Removed(listsOf(t, withPaths), listsOf(t, after)); strings.Join(removed, ",") != "paths/brownfield" {
		t.Fatalf("removed: %v", removed)
	}
	// two paths with the same id
	twice := strings.Replace(withPaths, `"name":"Brownfield"`, `"name":"Brownfield"},{"id":"greenfield","name":"New"`, 1)
	if err := docs.Check(docs.Catalog, []byte(twice), docs.Lists{}); err == nil || !strings.Contains(err.Error(), "Two paths have the id “greenfield” (“Greenfield” and “New”): remove one of them.") {
		t.Fatalf("duplicate path: %v", err)
	}
}

// The other names of a path belong to its entry; one is claimed by one path only and is no
// other path's name, in the app's words (otherNameClashes in src/lib/paths.ts).
func TestOtherNamesOfThePaths(t *testing.T) {
	l := docs.Lists{Paths: []docs.Named{
		{ID: "paved-path", Name: "Paved path", Symbol: "road", AlsoCalled: []string{"golden path", " ", "paved road"}},
		{ID: "toll", Name: "Toll road", Symbol: "road"},
	}}
	if got := docs.PathNames(l.Paths, []string{"toll", "paved-path", "gone"}); got != "Toll road, Paved path (also called golden path, paved road), gone" {
		t.Fatalf("%q", got)
	}
	clash := func(body string) error {
		return docs.Check(docs.Catalog, []byte(`{"tiers":[],"environments":[],"languages":[],"teams":[],"tools":[],"paths":`+body+`}`), docs.Lists{})
	}
	if err := clash(`[{"id":"a","name":"A","alsoCalled":["x"]},{"id":"b","name":"B","alsoCalled":["y"]}]`); err != nil {
		t.Fatal(err)
	}
	for body, want := range map[string]string{
		`[{"id":"a","name":"Paved path","alsoCalled":["golden path"]},{"id":"b","name":"Lift","alsoCalled":["Golden Path"]}]`: "paths[1].alsoCalled: The paths “Paved path” and “Lift” are both also called “Golden Path”: keep it on one of them.",
		`[{"id":"a","name":"Brownfield"},{"id":"b","name":"Lift","alsoCalled":["brownfield"]}]`:                               "paths[1].alsoCalled: The path “Lift” is also called “brownfield”, which is the name of the path “Brownfield”: take it off “Lift”.",
	} {
		if err := clash(body); !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: %v", body, err)
		}
	}
}
