package retrieval

import (
	"fmt"
	"os"
	"testing"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

// Questions with the document a person would want first, on the sample and the demo content.
var sensible = map[string]string{
	"how do I get a google cloud project": "request-gcp-project",
	"new GCP project":                     "request-gcp-project",
	"put my website behind akamai":        "onboard-site-to-akamai",
	"publish an api":                      "onboard-api-to-apigee",
	"no passwords in logs":                "secure-logging",
	"create a github repository":          "request-github-repository",
	"kubernetes namespace":                "request-kubernetes-namespace",
	"monitoring and alerts":               "set-up-service-monitoring",
	"azure subscription":                  "request-azure-landing-zone",
	"servicenow ticket":                   "raise-servicenow-request",
	"break glass emergency access":        "request-break-glass-access",
}

// Questions that have nothing to do with the content.
var unrelated = []string{
	"chocolate cake recipe", "weather in paris tomorrow", "football results last night", "how tall is mount everest",
	"best pizza near me", "sing a song about dogs", "holiday booking", "lunch menu",
}

func builtinIndex(t *testing.T) *Index {
	t.Helper()
	pool, store := filled(t, true)
	ix := New(pool, store, embedding.Builtin(768), chunking.Options{}, quiet)
	build(t, ix)
	return ix
}

func TestTheBuiltinEmbedderFindsTheRightDocument(t *testing.T) {
	ix := builtinIndex(t)
	for q, want := range sensible {
		res, err := ix.Search(bg, q, 10)
		must(t, err)
		if len(res) == 0 || res[0].ID != want {
			t.Errorf("%q: %v, want %s first", q, ids(res), want)
		}
	}
	for _, q := range unrelated {
		res, err := ix.Search(bg, q, 10)
		must(t, err)
		if len(res) != 0 {
			t.Errorf("%q has nothing to do with the content, found %v (best %.3f)", q, ids(res), res[0].Score)
		}
	}
}

func ids(res []Result) []string {
	out := []string{}
	for _, r := range res {
		out = append(out, r.ID)
	}
	return out
}

// TestMeasureFloor prints the best scores of sensible and unrelated questions, without a floor:
// MEASURE_FLOOR=1 go test -run MeasureFloor -v ./internal/retrieval/
func TestMeasureFloor(t *testing.T) {
	if os.Getenv("MEASURE_FLOOR") == "" {
		t.Skip("set MEASURE_FLOOR=1 to measure")
	}
	old := floors["builtin"]
	floors["builtin"] = 0
	defer func() { floors["builtin"] = old }()
	ix := builtinIndex(t)
	show := func(kind, q string) {
		res, err := ix.Search(bg, q, 3)
		must(t, err)
		line := fmt.Sprintf("%-9s %-40q", kind, q)
		for _, r := range res {
			line += fmt.Sprintf(" %s %.3f (%s);", r.ID, r.Score, r.Hits[0].Label)
		}
		t.Log(line)
	}
	for q := range sensible {
		show("sensible", q)
	}
	for _, q := range unrelated {
		show("unrelated", q)
	}
}
