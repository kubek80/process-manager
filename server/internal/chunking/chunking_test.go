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
		Tools:        []docs.Named{{ID: "servicenow", Name: "ServiceNow"}},
		Teams:        []docs.Named{{ID: "fin", Name: "Finance team"}},
		Categories:   []docs.Named{{ID: "money", Name: "Money"}},
		Tiers:        []docs.Named{{ID: "tier-0", Name: "Tier 0"}, {ID: "tier-1", Name: "Tier 1"}},
		Environments: []docs.Named{{ID: "production", Name: "Production"}},
		Languages:    []docs.Named{{ID: "go", Name: "Go"}},
	}
	p := `{"id":"pay","title":"Pay an invoice","summary":"Get a supplier paid.","owner":"fin","category":"money","tags":["ap"],
	  "rigour":"recommended","tiers":["tier-0"],"languages":["go"],"estimatedDuration":"2 days","standards":["finance-rules"],
	  "actors":[{"id":"me","name":"You","description":"The reader."},{"id":"boss","name":"Budget owner","description":"Owns the money."}],
	  "prerequisites":[{"title":"Approved cost centre","description":"Ask finance.","processId":"open-cost-centre"}],
	  "steps":[{"id":"raise","title":"Raise it","actor":"me","next":[]},
	           {"id":"approve","title":"Approve the monthly budget","actor":"boss","tool":"servicenow","description":"The owner looks.",
	            "instructions":["Open the request","Press approve"],"outcome":"Approved request","duration":"1 day",
	            "url":"https://x.example.com","urlLabel":"Open the queue","resources":[{"title":"Approval guide","url":"https://y.example.com"}],
	            "subProcessId":"approve-spend","next":[]}]}`
	cs, err := Chunks(docs.Process, []byte(p), lists, Options{})
	if err != nil {
		t.Fatal(err)
	}
	want := "Process: Pay an invoice\nGet a supplier paid.\nHow binding: recommended, the expected way; another way needs a good reason\n" +
		"Where it applies: tiers Tier 0; all environments; programming languages Go\nLead time: 2 days\n" +
		"Helps to meet the standards: finance-rules\nTags: ap\nCategory: Money\nOwned by: Finance team"
	if cs[0].Text != want {
		t.Errorf("summary text\n%q\nwant\n%q", cs[0].Text, want)
	}
	want = "Process: Pay an invoice\nBefore you start: Approved cost centre\nAsk finance.\nComes from the process: open-cost-centre"
	if cs[1].Text != want || cs[1].Label != "Before you start: Approved cost centre" {
		t.Errorf("prerequisite %+v", cs[1])
	}
	if cs[2].Text != "Process: Pay an invoice\nStep 1: Raise it\nDone by: You" {
		t.Errorf("the reader's own lane: %q", cs[2].Text)
	}
	want = "Process: Pay an invoice\nStep 2: Approve the monthly budget\nDone by: Budget owner\nAbout Budget owner: Owns the money.\n" +
		"Tool: ServiceNow\nThe owner looks.\nInstructions:\n- Open the request\n- Press approve\nOutcome: Approved request\n" +
		"Takes: 1 day\nUses the process: approve-spend\nLink: Open the queue\nResources: Approval guide"
	if cs[3].Text != want || cs[3].Item != "approve" || cs[3].Label != "Step 2: Approve the monthly budget" {
		t.Errorf("step %+v\nwant text\n%q", cs[3], want)
	}

	s := `{"id":"logs","title":"Secure logging","summary":"Rules for logs.","scope":"All services.","environments":["production"],
	  "requirements":[{"id":"SEC-LOG-01","title":"No secrets in logs","level":"must","statement":"Never log secrets.",
	  "rationale":"Logs leak.","guidance":["Mask headers"],"verification":{"method":"review","description":"Reviewers check."},
	  "tiers":["tier-0","tier-1"],"languages":["go"],"processId":"rotate-secret",
	  "review":{"lookFor":["apiKey in a log call"]},"examples":{"good":["log(key.ID)"],"bad":["log(key)"]}},
	  {"id":"SEC-LOG-02","title":"Keep logs","level":"should","statement":"Keep logs a year.","verification":{"method":"manual"}}]}`
	cs, err = Chunks(docs.Standard, []byte(s), lists, Options{})
	if err != nil {
		t.Fatal(err)
	}
	want = "Standard: Secure logging\nRules for logs.\nRequirements: 2 (1 mandatory, 1 recommended)\n" +
		"Where it applies: all tiers; environments Production; all programming languages"
	if cs[0].Text != want {
		t.Errorf("summary text\n%q\nwant\n%q", cs[0].Text, want)
	}
	if len(cs) != 4 || cs[1].Part != Scope || cs[1].Label != "Scope" || cs[1].Text != "Standard: Secure logging\nScope: All services." {
		t.Fatalf("scope %+v", cs)
	}
	want = "Standard: Secure logging\nSEC-LOG-01: No secrets in logs\nLevel: mandatory (must)\n" +
		"Applies only to: tiers Tier 0, Tier 1; programming languages Go\nNever log secrets.\nWhy: Logs leak.\n" +
		"How to comply:\n- Mask headers\nA process that helps: rotate-secret\nHow it is checked: in code review. Reviewers check.\n" +
		"A reviewer looks for: apiKey in a log call\nGood example: log(key.ID)\nBad example, do not do this: log(key)"
	if cs[2].Text != want || cs[2].Item != "SEC-LOG-01" || cs[2].Label != "SEC-LOG-01: No secrets in logs" {
		t.Errorf("requirement\n%q\nwant\n%q", cs[2].Text, want)
	}
	want = "Standard: Secure logging\nSEC-LOG-02: Keep logs\nLevel: recommended (should)\nKeep logs a year.\n" +
		"How it is checked: by a person, outside code review"
	if cs[3].Text != want {
		t.Errorf("requirement\n%q\nwant\n%q", cs[3].Text, want)
	}
}

// One sample process and one sample standard, word for word: what a change of the sample or of
// the chunk layout does to the embedded text is visible in review.
func TestSampleTexts(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	lists := readLists(t, filepath.Join(root, "catalog", "catalog.json"))
	get := func(kind, file, item string, part string) string {
		b, err := os.ReadFile(filepath.Join(root, file))
		if err != nil {
			t.Fatal(err)
		}
		cs, err := Chunks(kind, b, lists, Options{})
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range cs {
			if c.Part == part && c.Item == item {
				return c.Text
			}
		}
		t.Fatalf("%s: no %s %q", file, part, item)
		return ""
	}
	cases := []struct{ kind, file, part, item, want string }{
		{docs.Process, "processes/request-gcp-project.json", Summary, "", `Process: Request a GCP project
Get a new Google Cloud project created by the project factory, attached to the right folder and billing account, with your team as owners.
How binding: mandatory, the only allowed way to get this done
Where it applies: all tiers; all environments; any programming language
Lead time: 3-5 working days
Helps to meet the standards: infrastructure-as-code
Tags: gcp, cloud, terraform
Category: Cloud
Platform: Google Cloud
Owned by: Cloud Platform team
Meant for the paths: Paved path (also called golden path, paved road)`},
		{docs.Process, "processes/request-gcp-project.json", Step, "add-project-config", `Process: Request a GCP project
Step 7: Add your project to the project factory
Done by: You
Tool: GitHub
Instructions:
- Create a branch named after your request number.
- Copy projects/_template.yaml to projects/<project-name>.yaml.
- Fill in name, folder, billing, owner group and labels.
- Open a pull request and put the request number in the title.
Outcome: Open pull request
Takes: 20 min
Link: Open gcp-project-factory
Resources: Skill: add a GCP project`},
		{docs.Standard, "standards/secure-logging.json", Summary, "", `Standard: Secure logging
What services must and must not write to their logs, so that incidents can be investigated without logs becoming a leak.
Requirements: 5 (4 mandatory, 1 recommended)
Where it applies: all tiers; all environments; all programming languages
Tags: logging, secrets, audit
Category: Security
Practice: Cyber security
Owned by: Cyber Security`},
		{docs.Standard, "standards/secure-logging.json", Requirement, "SEC-LOG-01", `Standard: Secure logging
SEC-LOG-01: No secrets in logs
Level: mandatory (must)
Passwords, API keys, tokens, private keys and session ids are never written to logs, traces or error messages.
Why: Logs are read by many people and copied to many systems. A secret in a log has to be treated as leaked.
How to comply:
- Log the name of a credential, never its value.
- Mask the Authorization header and cookies before logging a request.
- Use the logging library's redaction list for known secret field names.
How it is checked: automatically, by a pipeline or scanner. Secret scanner on log statements in the build pipeline, plus code review.
A reviewer looks for: A variable named like password, secret, token, apiKey or authorization passed to a log call
A reviewer looks for: Whole request, header or config objects printed with %v, %+v, JSON.stringify or similar
A reviewer looks for: Secrets interpolated into error messages that are later logged
Good example: log.Info("calling billing API", "key_id", key.ID)
Bad example, do not do this: log.Info("calling billing API", "key", apiKey)
Bad example, do not do this: fmt.Printf("request: %+v", req) // prints the Authorization header`},
	}
	for _, c := range cases {
		if got := get(c.kind, c.file, c.item, c.part); got != c.want {
			t.Errorf("%s %s %s:\n%s\n---- want\n%s", c.file, c.part, c.item, got, c.want)
		}
	}
}

// When a requirement is too long, the examples are left out first (the bad ones before the
// good ones), then the review hints; the statement stays.
func TestWhatIsLeftOutFirst(t *testing.T) {
	long := strings.Repeat("word ", 40)
	s := `{"id":"x","title":"X","requirements":[{"id":"R-1","title":"Rule","level":"must","statement":"The statement stays.",
	  "verification":{"method":"review"},"review":{"lookFor":["hint one ` + long + `","hint two ` + long + `"]},
	  "examples":{"good":["good ` + long + `"],"bad":["bad ` + long + `"]}}]}`
	text := func(max int) string {
		cs, err := Chunks(docs.Standard, []byte(s), docs.Lists{}, Options{Parts: []string{Requirement}, MaxChars: max})
		if err != nil {
			t.Fatal(err)
		}
		if n := utf8.RuneCountInString(cs[0].Text); n > max {
			t.Fatalf("%d characters with limit %d", n, max)
		}
		return cs[0].Text
	}
	has := func(txt string, parts ...string) string {
		var out []string
		for _, p := range parts {
			if strings.Contains(txt, p) {
				out = append(out, p)
			}
		}
		return strings.Join(out, ",")
	}
	all := []string{"statement stays", "hint one", "hint two", "Good example", "Bad example"}
	for _, c := range []struct {
		max  int
		want string
	}{
		{5000, "statement stays,hint one,hint two,Good example,Bad example"},
		{900, "statement stays,hint one,hint two,Good example"},
		{700, "statement stays,hint one,hint two"},
		{400, "statement stays,hint one"},
		{200, "statement stays"},
	} {
		if got := has(text(c.max), all...); got != c.want {
			t.Errorf("limit %d keeps %s, want %s", c.max, got, c.want)
		}
	}
	// a step: links and resources first, then the lane's description and the duration
	p := `{"id":"p","title":"P","actors":[{"id":"me","name":"You"},{"id":"a","name":"Team","description":"About the team ` + long + `"}],
	  "steps":[{"id":"s","title":"Do it","actor":"a","description":"What happens.","duration":"1 day ` + long + `",
	  "urlLabel":"Open ` + long + `","resources":[{"title":"Guide","url":"https://x.example.com"}]}]}`
	cs, _ := Chunks(docs.Process, []byte(p), docs.Lists{}, Options{Parts: []string{Step}, MaxChars: 650})
	if got := has(cs[0].Text, "What happens", "About Team", "Takes", "Link", "Resources"); got != "What happens,About Team,Takes" {
		t.Errorf("step keeps %s:\n%s", got, cs[0].Text)
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
				if c.Item != full[i].Item || c.Label != full[i].Label {
					t.Errorf("%s %s: another part with a limit", s.path, c.Item)
				}
				if msg := shortened(full[i].Text, c.Text); msg != "" {
					t.Errorf("%s %s: %s", s.path, c.Item, msg)
				}
			}
		}
	}
}

// shortened checks that short is long with whole lines left out and the last kept line cut at
// a word boundary (or inside a single word longer than the limit); "" when it is.
func shortened(long, short string) string {
	have := strings.Split(long, "\n")
	keep := strings.Split(short, "\n")
	j := 0
	for n, k := range keep {
		for j < len(have) && have[j] != k && !(n == len(keep)-1 && strings.HasPrefix(have[j], k)) {
			j++
		}
		if j == len(have) {
			return fmt.Sprintf("line %q is not from the full text", k)
		}
		if have[j] != k {
			rest := have[j][len(k):]
			if !strings.HasPrefix(rest, " ") && strings.ContainsAny(k, " ") {
				return fmt.Sprintf("cut mid-word: %q | %q", k, rest)
			}
		}
		j++
	}
	return ""
}

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
