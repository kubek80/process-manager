package retrieval

import (
	"testing"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/docs"
)

// A document that gains a path changes only the text of its summary part: the start-up catch-up
// (a rebuild that keeps the settings, chunking.Version included) embeds that one part again and
// keeps every other, so search by meaning stays available. No full rebuild is needed.
func TestAPathChangesOnlyTheSummaryPart(t *testing.T) {
	pool, store := filled(t, false)
	f := newFake()
	ix := New(pool, store, f, chunking.Options{}, quiet)
	build(t, ix)
	all := expected(t, store, chunking.Default())
	_, _, before := ix.settings()

	edit(t, store, docs.Process, "raise-servicenow-request", `"summary":`, `"paths": ["brownfield"], "summary":`)
	f.reset()
	r, err := ix.Rebuild(bg)
	must(t, err)
	if calls, texts := f.counts(); calls != 1 || texts != 1 || r.Embedded != 1 || r.Unchanged != all-1 {
		t.Fatalf("%d calls, %d texts, %+v", calls, texts, r)
	}
	// the one embedded is the summary of that document
	var part string
	must(t, pool.QueryRow(bg, `select part from search_chunks where doc_id = 'raise-servicenow-request' order by updated_at desc limit 1`).Scan(&part))
	if part != "summary" {
		t.Fatalf("re-embedded: %s", part)
	}
	if _, _, after := ix.settings(); after != before {
		t.Fatalf("the settings changed: %q -> %q", before, after)
	}
}
