package chunking

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// sample is one file of the sample or demo content with the lists it is written against.
type sample struct {
	path, kind string
	body       []byte
	lists      docs.Lists
}

func readLists(t *testing.T, path string) docs.Lists {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var l docs.Lists
	if err := json.Unmarshal(raw, &l); err != nil {
		t.Fatal(err)
	}
	return l
}

func samples(t *testing.T) []sample {
	t.Helper()
	root := filepath.Join("..", "..", "..")
	var out []sample
	for _, set := range []string{root, filepath.Join(root, "demo")} {
		lists := readLists(t, filepath.Join(set, "catalog", "catalog.json"))
		for _, k := range []struct{ dir, kind string }{{"processes", docs.Process}, {"standards", docs.Standard}} {
			files, _ := filepath.Glob(filepath.Join(set, k.dir, "*.json"))
			if len(files) == 0 {
				t.Fatalf("no files in %s/%s", set, k.dir)
			}
			for _, f := range files {
				b, err := os.ReadFile(f)
				if err != nil {
					t.Fatal(err)
				}
				out = append(out, sample{f, k.kind, b, lists})
			}
		}
	}
	return out
}

type fullDoc struct {
	ID            string            `json:"id"`
	Title         string            `json:"title"`
	Scope         string            `json:"scope"`
	Prerequisites []json.RawMessage `json:"prerequisites"`
	Actors        []struct{ ID, Name string }
	Steps         []struct{ ID, Title, Actor, Tool string }
	Requirements  []struct{ ID, Title, Level string }
}

func TestEverySampleFile(t *testing.T) {
	for _, s := range samples(t) {
		t.Run(s.path, func(t *testing.T) {
			var d fullDoc
			if err := json.Unmarshal(s.body, &d); err != nil {
				t.Fatal(err)
			}
			cs, err := Chunks(s.kind, s.body, s.lists, Options{})
			if err != nil {
				t.Fatal(err)
			}
			head := "Process: "
			if s.kind == docs.Standard {
				head = "Standard: "
			}
			head += d.Title + "\n"
			count := map[string]int{}
			for _, c := range cs {
				count[c.Part]++
				if c.Kind != s.kind || c.DocID != d.ID {
					t.Errorf("%+v: wrong parent", c)
				}
				if !strings.HasPrefix(c.Text, head) || strings.TrimSpace(strings.TrimPrefix(c.Text, head)) == "" {
					t.Errorf("%s %s: text does not start with the parent or has nothing after it: %q", c.Part, c.Item, c.Text)
				}
				if c.Label == "" {
					t.Errorf("%s %s: no label", c.Part, c.Item)
				}
				if n := utf8.RuneCountInString(c.Text); n > DefaultMaxChars {
					t.Errorf("%s %s: %d characters", c.Part, c.Item, n)
				}
			}
			if count[Summary] != 1 || cs[0].Part != Summary || cs[0].Label != "Summary" || cs[0].Item != "" {
				t.Errorf("summary: %+v", cs[0])
			}
			if s.kind == docs.Process {
				if count[Step] != len(d.Steps) || count[Prerequisite] != len(d.Prerequisites) {
					t.Errorf("parts %v, want %d steps and %d prerequisites", count, len(d.Steps), len(d.Prerequisites))
				}
				lanes := map[string]string{}
				for _, a := range d.Actors {
					lanes[a.ID] = a.Name
				}
				steps := byPart(cs, Step)
				for i, st := range d.Steps {
					c := steps[i]
					if c.Item != st.ID || c.Label != fmt.Sprintf("Step %d: %s", i+1, st.Title) {
						t.Errorf("step %d: item %q label %q", i, c.Item, c.Label)
					}
					if !strings.Contains(c.Text, "Done by: "+lanes[st.Actor]) {
						t.Errorf("step %s: lane name missing: %q", st.ID, c.Text)
					}
					if st.Tool != "" && !strings.Contains(c.Text, "Tool: "+docs.Name(s.lists.Tools, st.Tool)) {
						t.Errorf("step %s: tool name missing: %q", st.ID, c.Text)
					}
				}
				for i, c := range byPart(cs, Prerequisite) {
					if c.Item != strconv.Itoa(i) || !strings.HasPrefix(c.Label, "Before you start: ") {
						t.Errorf("prerequisite %d: %+v", i, c)
					}
				}
			} else {
				wantScope := 0
				if strings.TrimSpace(d.Scope) != "" {
					wantScope = 1
				}
				if count[Requirement] != len(d.Requirements) || count[Scope] != wantScope {
					t.Errorf("parts %v, want %d requirements", count, len(d.Requirements))
				}
				for i, r := range d.Requirements {
					c := byPart(cs, Requirement)[i]
					if c.Item != r.ID || c.Label != r.ID+": "+r.Title {
						t.Errorf("requirement %d: item %q label %q", i, c.Item, c.Label)
					}
					if !strings.Contains(c.Text, "Level: "+level(r.Level)) {
						t.Errorf("requirement %s: level missing: %q", r.ID, c.Text)
					}
				}
			}
			again, _ := Chunks(s.kind, s.body, s.lists, Options{})
			if !reflect.DeepEqual(cs, again) {
				t.Error("not deterministic")
			}
		})
	}
}

func byPart(cs []Chunk, part string) []Chunk {
	var out []Chunk
	for _, c := range cs {
		if c.Part == part {
			out = append(out, c)
		}
	}
	return out
}

func TestTextOfAStepAndARequirement(t *testing.T) {
	lists := docs.Lists{
		Tools:      []docs.Named{{ID: "servicenow", Name: "ServiceNow"}},
		Teams:      []docs.Named{{ID: "fin", Name: "Finance team"}},
		Categories: []docs.Named{{ID: "money", Name: "Money"}},
	}
	p := `{"id":"pay","title":"Pay an invoice","summary":"Get a supplier paid.","owner":"fin","category":"money","tags":["ap"],
	  "actors":[{"id":"me","name":"You"},{"id":"boss","name":"Budget owner"}],
	  "prerequisites":[{"title":"Approved cost centre","description":"Ask finance."}],
	  "steps":[{"id":"raise","title":"Raise it","actor":"me","next":[]},
	           {"id":"approve","title":"Approve the monthly budget","actor":"boss","tool":"servicenow","description":"The owner looks.",
	            "instructions":["Open the request","Press approve"],"outcome":"Approved request","next":[]}]}`
	cs, err := Chunks(docs.Process, []byte(p), lists, Options{})
	if err != nil {
		t.Fatal(err)
	}
	want := "Process: Pay an invoice\nGet a supplier paid.\nTags: ap\nCategory: Money\nOwned by: Finance team"
	if cs[0].Text != want {
		t.Errorf("summary text\n%q\nwant\n%q", cs[0].Text, want)
	}
	if cs[1].Text != "Process: Pay an invoice\nBefore you start: Approved cost centre\nAsk finance." || cs[1].Label != "Before you start: Approved cost centre" {
		t.Errorf("prerequisite %+v", cs[1])
	}
	want = "Process: Pay an invoice\nStep 2: Approve the monthly budget\nDone by: Budget owner\nTool: ServiceNow\nThe owner looks.\nInstructions:\n- Open the request\n- Press approve\nOutcome: Approved request"
	if cs[3].Text != want || cs[3].Item != "approve" || cs[3].Label != "Step 2: Approve the monthly budget" {
		t.Errorf("step %+v\nwant text\n%q", cs[3], want)
	}

	s := `{"id":"logs","title":"Secure logging","summary":"Rules for logs.","scope":"All services.",
	  "requirements":[{"id":"SEC-LOG-01","title":"No secrets in logs","level":"must","statement":"Never log secrets.",
	  "rationale":"Logs leak.","guidance":["Mask headers"],"verification":{"method":"review"}}]}`
	cs, err = Chunks(docs.Standard, []byte(s), lists, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(cs) != 3 || cs[1].Part != Scope || cs[1].Label != "Scope" || cs[1].Text != "Standard: Secure logging\nScope: All services." {
		t.Fatalf("scope %+v", cs)
	}
	want = "Standard: Secure logging\nSEC-LOG-01: No secrets in logs\nLevel: mandatory (must)\nNever log secrets.\nWhy: Logs leak.\nHow to comply:\n- Mask headers"
	if cs[2].Text != want || cs[2].Item != "SEC-LOG-01" || cs[2].Label != "SEC-LOG-01: No secrets in logs" {
		t.Errorf("requirement %+v", cs[2])
	}
}

func TestMissingFieldsAndBadInput(t *testing.T) {
	for _, body := range []string{`{}`, `{"steps":[{}],"prerequisites":[{}]}`, `{"requirements":[{}],"scope":"  "}`, `{"tags":null}`} {
		for _, kind := range []string{docs.Process, docs.Standard} {
			cs, err := Chunks(kind, []byte(body), docs.Lists{}, Options{})
			if err != nil {
				t.Fatalf("%s %s: %v", kind, body, err)
			}
			for _, c := range cs {
				if c.Text == "" || c.Label == "" {
					t.Errorf("%s %s: empty chunk %+v", kind, body, c)
				}
			}
		}
	}
	if _, err := Chunks(docs.Catalog, []byte(`{}`), docs.Lists{}, Options{}); err == nil {
		t.Error("a catalog was split")
	}
	if _, err := Chunks(docs.Process, []byte(`[1]`), docs.Lists{}, Options{}); err == nil {
		t.Error("an array was read as a process")
	}
	if _, err := Chunks(docs.Process, []byte(`{}`), docs.Lists{}, Options{Parts: []string{"chapter"}}); err == nil {
		t.Error("an unknown part was accepted")
	}
}

func TestParseParts(t *testing.T) {
	got, err := ParseParts(" step, Summary ,step,")
	if err != nil || !reflect.DeepEqual(got, []string{"step", "summary"}) {
		t.Errorf("%v %v", got, err)
	}
	if got, err := ParseParts(""); err != nil || !reflect.DeepEqual(got, AllParts) {
		t.Errorf("empty: %v %v", got, err)
	}
	if _, err := ParseParts("summary,chapter"); err == nil || !strings.Contains(err.Error(), "chapter") {
		t.Errorf("unknown part: %v", err)
	}
	if d := Default(); !reflect.DeepEqual(d.Parts, AllParts) || d.MaxChars != DefaultMaxChars {
		t.Errorf("default %+v", d)
	}
}

func TestOptionsChooseParts(t *testing.T) {
	for _, s := range samples(t) {
		cs, err := Chunks(s.kind, s.body, s.lists, Options{Parts: []string{Step, Requirement}})
		if err != nil {
			t.Fatal(err)
		}
		if len(cs) == 0 {
			t.Fatalf("%s: nothing", s.path)
		}
		for _, c := range cs {
			if c.Part != Step && c.Part != Requirement {
				t.Errorf("%s: unexpected part %s", s.path, c.Part)
			}
		}
	}
}

func TestSizeLimit(t *testing.T) {
	for _, limit := range []int{40, 120, 300} {
		for _, s := range samples(t) {
			full, _ := Chunks(s.kind, s.body, s.lists, Options{})
			cs, err := Chunks(s.kind, s.body, s.lists, Options{MaxChars: limit})
			if err != nil {
				t.Fatal(err)
			}
			if len(cs) != len(full) {
				t.Fatalf("%s: %d chunks with a limit, %d without", s.path, len(cs), len(full))
			}
			for i, c := range cs {
				if n := utf8.RuneCountInString(c.Text); n > limit || strings.TrimSpace(c.Text) == "" {
					t.Errorf("%s %s: %d characters with limit %d", s.path, c.Item, n, limit)
				}
				if c.Item != full[i].Item || !strings.HasPrefix(full[i].Text, c.Text) {
					t.Errorf("%s %s: the cut text is not the start of the full one", s.path, c.Item)
				}
				// never mid-word: the cut ends where the full text has a boundary.
				if rest := full[i].Text[len(c.Text):]; rest != "" && !strings.ContainsAny(rest[:1], " \n") && !isWordLonger(full[i].Text, c.Text) {
					t.Errorf("%s %s: cut mid-word: %q | %q", s.path, c.Item, c.Text[max(0, len(c.Text)-20):], rest[:min(20, len(rest))])
				}
			}
		}
	}
}

// isWordLonger: the text had no boundary within the limit (a single long word), the only case
// where a cut inside a word is allowed.
func isWordLonger(full, cut string) bool { return !strings.ContainsAny(cut, " \n") }

func TestCut(t *testing.T) {
	cases := []struct {
		in   string
		max  int
		want string
	}{
		{"short", 10, "short"},
		{"One two three. Four five six", 20, "One two three."},
		{"One two. Three four five", 20, "One two. Three four"},
		{"alpha beta gamma delta", 13, "alpha beta"},
		{"alpha beta gamma", 10, "alpha beta"},
		{"supercalifragilistic", 5, "super"},
		{"ééé ééé", 5, "ééé"},
	}
	for _, c := range cases {
		if got := cut(c.in, c.max); got != c.want {
			t.Errorf("cut(%q, %d) = %q, want %q", c.in, c.max, got, c.want)
		}
	}
}
