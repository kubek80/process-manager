package httpapi

import (
	"sync"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
)

// Reports sent at the same time cannot slip past the limit: the count and the insert happen
// under a lock of the person.
func TestTheFeedbackLimitHoldsForReportsSentAtOnce(t *testing.T) {
	e := setup(t, nil)
	c := e.as(sam)
	const tries = 2 * feedback.MaxPerHour
	statuses := make([]int, tries)
	var wg sync.WaitGroup
	for i := range tries {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i], _ = c.do("POST", "/api/feedback", map[string]string{"targetKind": docs.Process, "targetId": gcp, "kind": "broken", "text": "All at once"})
		}()
	}
	wg.Wait()
	stored, refused := 0, 0
	for _, s := range statuses {
		switch s {
		case 201:
			stored++
		case 429:
			refused++
		default:
			t.Fatalf("status %d", s)
		}
	}
	if stored != feedback.MaxPerHour || refused != tries-feedback.MaxPerHour {
		t.Fatalf("%d stored, %d refused", stored, refused)
	}
	if n, _ := e.deps.Feedback.CountSince(bg, sam, time.Now().Add(-time.Hour)); n != feedback.MaxPerHour {
		t.Fatalf("%d in the database", n)
	}
}
