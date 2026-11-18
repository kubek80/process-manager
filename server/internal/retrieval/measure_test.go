package retrieval

import (
	"os"
	"testing"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

func TestMeasureFloor(t *testing.T) {
	if os.Getenv("MEASURE") == "" {
		t.Skip()
	}
	pool, store := filled(t, true)
	ix := New(pool, store, embedding.Builtin(768), chunking.Options{}, quiet)
	floors["builtin"] = 0
	must(t, ix.Ensure(bg))
	for _, q := range []string{
		"how do I get a google cloud project", "new GCP project", "put my website behind akamai", "publish an api",
		"no passwords in logs", "who reviews my pull request", "terraform for infrastructure", "create a github repository",
		"a secret leaked", "production is down", "load test my service", "kubernetes namespace", "monitoring and alerts",
		"azure subscription", "servicenow ticket", "share a library with other teams", "classify customer data", "break glass emergency access",
		"chocolate cake recipe", "weather in paris tomorrow", "football results last night", "how tall is mount everest", "best pizza near me", "sing a song about dogs",
		"holiday booking", "parking at the office", "lunch menu", "my laptop is slow",
	} {
		res, err := ix.Search(bg, q, 5)
		must(t, err)
		line := q + " =>"
		for i, r := range res {
			if i == 3 {
				break
			}
			line += " " + r.ID + ":" + ftoa(r.Score) + "(" + r.Hits[0].Label + ")"
		}
		t.Log(line)
	}
}

func ftoa(f float64) string { return string(rune('0'+int(f*10)%10)) + string(rune('0'+int(f*100)%10)) + string(rune('0'+int(f*1000)%10)) }
