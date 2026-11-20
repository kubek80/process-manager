package mcpserver

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// repo is the root of the repository, where the sample content lives.
var repo = filepath.Join("..", "..", "..")

func sampleLists(t *testing.T) docs.Lists {
	t.Helper()
	var l docs.Lists
	data, err := os.ReadFile(filepath.Join(repo, "catalog", "catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &l); err != nil {
		t.Fatal(err)
	}
	return l
}

func sample(t *testing.T, kind, id string) *entry {
	t.Helper()
	folder := map[string]string{docs.Process: "processes", docs.Standard: "standards"}[kind]
	data, err := os.ReadFile(filepath.Join(repo, folder, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	return entryOf(t, kind, data)
}

func entryOf(t *testing.T, kind string, body []byte) *entry {
	t.Helper()
	e := &entry{kind: kind}
	var err error
	if kind == docs.Process {
		e.process = &rawProcess{}
		err = json.Unmarshal(body, e.process)
		e.c = &e.process.common
	} else {
		e.std = &rawStandard{}
		err = json.Unmarshal(body, e.std)
		e.c = &e.std.common
	}
	if err != nil {
		t.Fatal(err)
	}
	e.doc = docs.Doc{Kind: kind, ID: e.c.ID, Version: 1, Body: body}
	return e
}

func TestFiltersAcceptIdsAndNamesInAnyCase(t *testing.T) {
	l := sampleLists(t)
	for _, in := range []SearchInput{
		{Platform: "google-cloud", Owner: "cloud-platform-team", Category: "cloud"},
		{Platform: "Google Cloud", Owner: "CLOUD PLATFORM TEAM", Category: " Cloud "},
	} {
		f, err := resolveFilters(l, in)
		if err != nil {
			t.Fatal(err)
		}
		if f.platform != "google-cloud" || f.owner != "cloud-platform-team" || f.category != "cloud" {
			t.Fatalf("%+v", f)
		}
	}
	f, err := resolveFilters(l, SearchInput{Tier: "Tier 1", Environment: "PRODUCTION", Language: "javascript / typescript", Rigour: "must"})
	if err != nil || f.profile != (Profile{Tier: "tier-1", Environment: "production", Language: "javascript"}) || f.rigour != "mandatory" {
		t.Fatalf("%+v %v", f, err)
	}
	if _, err := resolveFilters(l, SearchInput{Platform: "Mars"}); err == nil || err.Error() != "There is no platform “Mars”. Use get_catalog to see the platforms." {
		t.Fatalf("%v", err)
	}
	if _, err := resolveFilters(l, SearchInput{Rigour: "sometimes"}); err == nil || !strings.Contains(err.Error(), "mandatory, recommended or optional") {
		t.Fatalf("%v", err)
	}
}

func TestFiltersOnProcesses(t *testing.T) {
	l := sampleLists(t)
	gcp := sample(t, docs.Process, "request-gcp-project")          // all tiers, mandatory, google-cloud
	akamai := sample(t, docs.Process, "onboard-site-to-akamai")    // tier-0 and tier-1, staging and production
	library := sample(t, docs.Process, "publish-internal-library") // go and javascript, recommended
	cases := []struct {
		in   SearchInput
		want []bool // gcp, akamai, library
	}{
		{SearchInput{}, []bool{true, true, true}},
		{SearchInput{Rigour: "mandatory"}, []bool{true, true, false}},
		{SearchInput{Rigour: "recommended"}, []bool{false, false, true}},
		{SearchInput{Tier: "tier-3"}, []bool{true, false, true}},
		{SearchInput{Environment: "development"}, []bool{true, false, true}},
		{SearchInput{Environment: "production", Tier: "tier-0"}, []bool{true, true, true}},
		{SearchInput{Language: "python"}, []bool{true, true, false}},
		{SearchInput{Platform: "akamai"}, []bool{false, true, false}},
		{SearchInput{Practice: "engineering"}, []bool{false, false, true}},
		{SearchInput{Owner: "Edge & CDN team"}, []bool{false, true, false}},
		{SearchInput{Category: "cloud"}, []bool{true, false, false}},
	}
	for _, c := range cases {
		f, err := resolveFilters(l, c.in)
		if err != nil {
			t.Fatal(err)
		}
		var got []bool
		for _, e := range []*entry{gcp, akamai, library} {
			ok, _ := f.passes(e)
			got = append(got, ok)
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%+v: got %v, want %v", c.in, got, c.want)
		}
	}
	// only active documents are searched
	gcp.c.Status = "deprecated"
	if ok, _ := (filters{}).passes(gcp); ok {
		t.Fatal("a retired process was found")
	}
	gcp.c.Status = "draft"
	if ok, _ := (filters{}).passes(gcp); ok {
		t.Fatal("a draft was found")
	}
}

func TestAStandardMatchesARigourWhenARequirementThatAppliesHasThatLevel(t *testing.T) {
	l := sampleLists(t)
	logging := sample(t, docs.Standard, "secure-logging") // SEC-LOG-03 must tier-0/1, SEC-LOG-04 must production, SEC-LOG-05 should
	ids := func(rs []rawRequirement) string {
		var out []string
		for _, r := range rs {
			out = append(out, r.ID)
		}
		return strings.Join(out, ",")
	}
	f, _ := resolveFilters(l, SearchInput{Rigour: "should"})
	if ok, apply := f.passes(logging); !ok || len(apply) != 5 {
		t.Fatalf("should: %v %v", ok, ids(apply))
	}
	f, _ = resolveFilters(l, SearchInput{Rigour: "optional"})
	if ok, _ := f.passes(logging); ok {
		t.Fatal("no requirement is optional")
	}
	// a profile leaves out the requirements that do not apply
	f, _ = resolveFilters(l, SearchInput{Tier: "tier-3", Environment: "development"})
	if ok, apply := f.passes(logging); !ok || ids(apply) != "SEC-LOG-01,SEC-LOG-02,SEC-LOG-05" {
		t.Fatalf("profile: %v %v", ok, ids(apply))
	}
	// a standard none of whose requirements applies is not found
	only := sample(t, docs.Standard, "secure-logging")
	only.std.Requirements = only.std.Requirements[3:4] // production only
	if ok, _ := f.passes(only); ok {
		t.Fatal("found without a requirement that applies")
	}
}

func TestTheWordMatch(t *testing.T) {
	l := sampleLists(t)
	gcp := sample(t, docs.Process, "request-gcp-project")
	score := func(e *entry, q string) int { return wordScore(fieldsOf(e, l), partsOf(e, l), wordsOf(q)) }
	if score(gcp, "budget") == 0 || score(gcp, "GCP") == 0 || score(gcp, "terraform") == 0 || score(gcp, "Google Cloud") == 0 {
		t.Fatal("not found by words it holds")
	}
	if score(gcp, "budget kubernetes") != 0 {
		t.Fatal("every word must be found")
	}
	// the title counts more than a step; a phrase at the start of the title most
	if !(score(gcp, "request") > score(gcp, "budget")) || !(score(gcp, "request a gcp") > score(gcp, "gcp request")) {
		t.Fatal("ranking")
	}
	// accents and case do not matter
	if fold("Résumé ÉTÉ") != "resume ete" || score(gcp, "BÜDGET") != 0 && score(gcp, "budgét") == 0 {
		t.Fatal("folding")
	}
	ms := wordMatches(partsOf(gcp, l), wordsOf("budget"))
	if len(ms) == 0 || ms[0] != (Match{Part: "step", Item: "approve-budget", Label: "Step 3: Approve the monthly budget"}) {
		t.Fatalf("%+v", ms)
	}
	// a word not in the label gives a snippet of the text that matched
	ms = wordMatches(partsOf(gcp, l), wordsOf("charged"))
	if len(ms) != 1 || ms[0].Part != "prerequisite" || ms[0].Item != "1" || !strings.Contains(ms[0].Snippet, "charged") {
		t.Fatalf("%+v", ms)
	}
	logging := sample(t, docs.Standard, "secure-logging")
	ms = wordMatches(partsOf(logging, l), wordsOf("laptops"))
	if len(ms) != 1 || ms[0].Part != "scope" || ms[0].Label != "Scope" {
		t.Fatalf("%+v", ms)
	}
	ms = wordMatches(partsOf(logging, l), wordsOf("SEC-LOG-02"))
	if len(ms) != 1 || ms[0].Item != "SEC-LOG-02" || ms[0].Label != "SEC-LOG-02: No personal data in logs" {
		t.Fatalf("%+v", ms)
	}
}

func TestExcerptCutsAtWholeWords(t *testing.T) {
	long := strings.Repeat("alpha beta gamma ", 10) + "needle " + strings.Repeat("delta epsilon ", 10)
	got := excerpt(long, []string{"needle"})
	if !strings.HasPrefix(got, "…") || !strings.HasSuffix(got, "…") || !strings.Contains(got, "needle") || strings.Contains(got, "  ") {
		t.Fatalf("%q", got)
	}
	inner := strings.Trim(got, "…")
	for _, w := range strings.Fields(inner) {
		if !strings.Contains("alpha beta gamma needle delta epsilon", w) {
			t.Fatalf("cut inside a word: %q", got)
		}
	}
	if excerpt("short text", []string{"x"}) != "short text" {
		t.Fatal("short")
	}
}

func TestFlowOrderFollowsTheSteps(t *testing.T) {
	gcp := sample(t, docs.Process, "request-gcp-project")
	var got []string
	for _, i := range flowOrder(gcp.process.Steps) {
		got = append(got, gcp.process.Steps[i].ID)
	}
	want := "decide-project-details raise-request approve-budget review-request details-ok add-project-config clarify-request review-pull-request create-project verify-access"
	if strings.Join(got, " ") != want {
		t.Fatalf("%v", got)
	}
	// a step nothing leads to is not lost, and a loop does not repeat
	steps := []rawStep{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	steps[0].Next = append(steps[0].Next, struct {
		To    string `json:"to"`
		Label string `json:"label"`
	}{To: "a"})
	if got := flowOrder(steps); !reflect.DeepEqual(got, []int{0, 1, 2}) {
		t.Fatalf("%v", got)
	}
}

func TestReviewState(t *testing.T) {
	now := time.Date(2026, 11, 18, 15, 0, 0, 0, time.UTC)
	e := &entry{c: &common{}}
	if r := reviewOf(e, now); r.State != "none" || r.Overdue {
		t.Fatalf("%+v", r)
	}
	e.c.Review = &rawReview{IntervalMonths: 6}
	if r := reviewOf(e, now); r.State != "overdue" || r.Label != "Never reviewed" {
		t.Fatalf("%+v", r)
	}
	// never reviewed: counted from when it was first published, as in the portal
	e.published = time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC)
	if r := reviewOf(e, now); r.State != "ok" || r.Overdue || r.DueAt != "2027-05-18" || r.Label != "First review due 2027-05-18" {
		t.Fatalf("just published: %+v", r)
	}
	e.published = time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)
	if r := reviewOf(e, now); r.State != "overdue" || r.Label != "Review overdue since 2026-11-01" {
		t.Fatalf("published long ago: %+v", r)
	}
	e.published = time.Time{}
	e.c.Review.LastReviewedAt = "2026-05-17"
	if r := reviewOf(e, now); r.State != "overdue" || !r.Overdue || r.DueAt != "2026-11-17" || r.Label != "Review overdue since 2026-11-17" {
		t.Fatalf("%+v", r)
	}
	e.c.Review.LastReviewedAt = "2026-05-18"
	if r := reviewOf(e, now); r.State != "soon" || r.Overdue {
		t.Fatalf("%+v", r)
	}
	e.c.Review.LastReviewedAt = "2026-11-01"
	if r := reviewOf(e, now); r.State != "ok" {
		t.Fatalf("%+v", r)
	}
	e.c.Review.LastReviewedAt = "someday"
	if r := reviewOf(e, now); !r.Overdue {
		t.Fatalf("%+v", r)
	}
	// a retired document has no review to do
	e.c.Review.LastReviewedAt, e.c.Status = "2020-01-01", "deprecated"
	if r := reviewOf(e, now); r.State != "none" {
		t.Fatalf("%+v", r)
	}
}

func TestSecretsAndAddresses(t *testing.T) {
	good := "k7Qp2Lx9Vb4Nz8Rt1Wm6Hs3Jd5Fg0YcE"
	for secret, ok := range map[string]bool{
		"":          true,
		good:        true,
		"too-short": false,
		"change-me-change-me-change-me-change-me": false,
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":    false,
		"k7Qp2Lx9Vb4Nz8Rt 1Wm6Hs3Jd5Fg0Yc":        false,
	} {
		if (CheckSecret(secret) == "") != ok {
			t.Errorf("%q: %q", secret, CheckSecret(secret))
		}
	}
	for addr, ok := range map[string]bool{"127.0.0.1:8081": true, "localhost:8081": true, "[::1]:8081": true, "0.0.0.0:8081": false, ":8081": false, "10.1.2.3:8081": false} {
		if (CheckListen(addr, "") == "") != ok {
			t.Errorf("%s without a secret: %q", addr, CheckListen(addr, ""))
		}
		if CheckListen(addr, good) != "" {
			t.Errorf("%s with a secret: %q", addr, CheckListen(addr, good))
		}
	}
}
