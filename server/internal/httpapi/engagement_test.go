package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/engagement"
)

type engagementAnswer struct {
	Counts map[string]map[string]engagement.Counts `json:"counts"`
	Mine   struct {
		Bookmarks []engagement.Bookmark `json:"bookmarks"`
		Upvotes   []engagement.Ref      `json:"upvotes"`
	} `json:"mine"`
}

func (c *client) engagement() engagementAnswer {
	c.e.t.Helper()
	status, raw, _ := c.raw("GET", "/api/engagement", nil, false)
	if status != 200 {
		c.e.t.Fatalf("engagement: %d %s", status, raw)
	}
	var out engagementAnswer
	must(c.e.t, json.Unmarshal(raw, &out))
	if out.Mine.Bookmarks == nil || out.Mine.Upvotes == nil || out.Counts[docs.Process] == nil || out.Counts[docs.Standard] == nil {
		c.e.t.Fatalf("lists must not be null: %s", raw)
	}
	return out
}

func (c *client) noContent(method, path string) {
	c.e.t.Helper()
	status, raw, _ := c.raw(method, path, nil, true)
	if status != 204 {
		c.e.t.Fatalf("%s %s: %d %s", method, path, status, raw)
	}
}

func mustDate(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse("2006-01-02", s)
	must(t, err)
	return d
}

func TestAViewCountsOncePerPersonPerDay(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	for i := 0; i < 3; i++ {
		s.noContent("POST", "/api/views/process/"+gcp)
	}
	e.as(alex).noContent("POST", "/api/views/process/"+gcp)
	e.as(alex).noContent("POST", "/api/views/standard/"+logging)
	got := s.engagement()
	if c := got.Counts[docs.Process][gcp]; c.Views != 2 || c.People != 2 {
		t.Fatalf("process: %+v", c)
	}
	if c := got.Counts[docs.Standard][logging]; c.Views != 1 || c.People != 1 {
		t.Fatalf("standard: %+v", c)
	}
	if _, ok := got.Counts[docs.Process][repoP]; ok {
		t.Fatal("a document with nothing yet is left out")
	}
	// another day is another view by the same person
	must(t, e.deps.Engagement.RecordView(bg, docs.Process, gcp, "SAM@example.com", engagement.Day(mustDate(t, "2026-01-05"))))
	if c := s.engagement().Counts[docs.Process][gcp]; c.Views != 3 || c.People != 2 {
		t.Fatalf("emails are compared in lower case: %+v", c)
	}
	for _, path := range []string{"/api/views/process/nope", "/api/views/catalog/catalog", "/api/views/process/Bad_Id", "/api/views/feedback/" + gcp} {
		if status, body := s.do("POST", path, nil); status != 404 || body["error"] != "That does not exist." {
			t.Errorf("%s: %d %v", path, status, body)
		}
	}
}

func TestCountingAViewNeverFailsThePage(t *testing.T) {
	e := setup(t, nil)
	_, err := e.deps.Docs.Pool.Exec(bg, `drop table document_views`)
	must(t, err)
	e.as(sam).noContent("POST", "/api/views/process/"+gcp)
	if !strings.Contains(e.logged.String(), "view not counted") {
		t.Fatalf("not logged: %s", e.logged)
	}
}

func TestBookmarksFollowThePerson(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	s.noContent("PUT", "/api/bookmarks/process/"+gcp)
	s.noContent("PUT", "/api/bookmarks/process/"+gcp) // twice is once
	s.noContent("PUT", "/api/bookmarks/standard/"+logging)
	// another browser of the same person
	mine := e.as(sam).engagement().Mine.Bookmarks
	if len(mine) != 2 || mine[0].Kind != docs.Standard || mine[0].ID != logging || mine[1].ID != gcp || mine[0].At.IsZero() {
		t.Fatalf("bookmarks: %+v", mine)
	}
	if len(e.as(alex).engagement().Mine.Bookmarks) != 0 {
		t.Fatal("bookmarks are per person")
	}
	s.noContent("DELETE", "/api/bookmarks/process/"+gcp)
	s.noContent("DELETE", "/api/bookmarks/process/"+gcp)
	s.noContent("DELETE", "/api/bookmarks/process/never-existed") // dropping always works
	if mine := s.engagement().Mine.Bookmarks; len(mine) != 1 || mine[0].ID != logging {
		t.Fatalf("after removing: %+v", mine)
	}
	if status, body := s.do("PUT", "/api/bookmarks/process/never-existed", nil); status != 404 {
		t.Fatalf("%d %v", status, body)
	}
}

func TestUpvotesAreOnePerPersonAndCanBeTakenBack(t *testing.T) {
	e := setup(t, nil)
	vote := func(who, method string, want int) {
		t.Helper()
		status, body := e.as(who).do(method, "/api/upvotes/standard/"+review, nil)
		if status != 200 || body["upvotes"] != float64(want) {
			t.Fatalf("%s %s: %d %v, want %d", who, method, status, body, want)
		}
	}
	vote(sam, "PUT", 1)
	vote(sam, "PUT", 1)
	vote(alex, "PUT", 2)
	vote(sam, "DELETE", 1)
	vote(sam, "DELETE", 1)
	got := e.as(alex).engagement()
	if got.Counts[docs.Standard][review].Upvotes != 1 || len(got.Mine.Upvotes) != 1 || got.Mine.Upvotes[0] != (engagement.Ref{Kind: docs.Standard, ID: review}) {
		t.Fatalf("%+v", got)
	}
	if len(e.as(sam).engagement().Mine.Upvotes) != 0 {
		t.Fatal("sam took the vote back")
	}
	if status, _ := e.as(sam).do("PUT", "/api/upvotes/standard/nope", nil); status != 404 {
		t.Fatalf("unknown: %d", status)
	}
}

func TestADraftNeverShowsInCountsBookmarksOrUpvotes(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	s.noContent("POST", "/api/views/process/"+gcp)
	s.noContent("PUT", "/api/bookmarks/process/"+gcp)
	if status, _ := s.do("PUT", "/api/upvotes/process/"+gcp, nil); status != 200 {
		t.Fatal(status)
	}
	// it becomes a draft: for sam it no longer exists
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.asDraft(docs.Process, gcp, "SECRET"))
	wantStatus(t, status, 200, body)
	got := s.engagement()
	if _, ok := got.Counts[docs.Process][gcp]; ok || len(got.Mine.Bookmarks) != 0 || len(got.Mine.Upvotes) != 0 {
		t.Fatalf("the draft shows: %+v", got)
	}
	for _, req := range [][2]string{{"POST", "/api/views/process/" + gcp}, {"PUT", "/api/bookmarks/process/" + gcp}, {"PUT", "/api/upvotes/process/" + gcp}, {"DELETE", "/api/upvotes/process/" + gcp}} {
		if status, body := s.do(req[0], req[1], nil); status != 404 || body["error"] != "That does not exist." {
			t.Errorf("%s %s: %d %v", req[0], req[1], status, body)
		}
	}
	// the people who work on it see it, with what was recorded while it was published
	c := e.as(casey) // owner role of its team
	c.noContent("POST", "/api/views/process/"+gcp)
	if got := c.engagement().Counts[docs.Process][gcp]; got.Views != 2 || got.Upvotes != 1 {
		t.Fatalf("casey: %+v", got)
	}
	// published again, sam finds the bookmark and the vote where they were
	status, body = e.as(alex).do("PUT", "/api/processes/"+gcp, strings.Replace(e.body(docs.Process, gcp, `"status": "draft"`, `"status": "active"`), "SECRET", "Request a GCP project", 1))
	wantStatus(t, status, 200, body)
	if got := s.engagement(); len(got.Mine.Bookmarks) != 1 || len(got.Mine.Upvotes) != 1 {
		t.Fatalf("after publishing: %+v", got.Mine)
	}
}

func TestDownloadsOfTheSkillAndTheReviewAgentCountForTheirDocument(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	for _, id := range []string{"standard-" + logging, "review-" + logging, "review-" + logging, "process-" + gcp} {
		if status, raw, _ := s.raw("GET", "/api/skills/"+id+"/download", nil, false); status != 200 {
			t.Fatalf("%s: %d %s", id, status, raw)
		}
	}
	// reading an older version is not a download
	if status, _ := s.do("GET", "/api/skills/review-"+logging+"/versions/1", nil); status != 200 {
		t.Fatal(status)
	}
	got := s.engagement()
	if got.Counts[docs.Standard][logging].Downloads != 3 || got.Counts[docs.Process][gcp].Downloads != 1 {
		t.Fatalf("%+v", got.Counts)
	}
}

func TestHandledFeedbackIsCounted(t *testing.T) {
	e := setup(t, nil)
	a := e.as(sam).report(docs.Process, gcp, "", "The first problem.")
	e.as(sam).report(docs.Process, gcp, "", "The second problem.")
	status, body := e.as(casey).do("PATCH", "/api/feedback/"+a["id"].(string), fix(true))
	wantStatus(t, status, 200, body)
	if got := e.as(sam).engagement().Counts[docs.Process][gcp]; got.Handled != 1 {
		t.Fatalf("%+v", got)
	}
}

func TestDeletingADocumentDropsItsBookmarksAndVotesButNotThePast(t *testing.T) {
	e := setup(t, nil)
	s := e.as(sam)
	s.noContent("POST", "/api/views/process/"+library)
	s.noContent("PUT", "/api/bookmarks/process/"+library)
	if status, _ := s.do("PUT", "/api/upvotes/process/"+library, nil); status != 200 {
		t.Fatal(status)
	}
	if status, raw, _ := s.raw("GET", "/api/skills/process-"+library+"/download", nil, false); status != 200 {
		t.Fatalf("%d %s", status, raw)
	}
	before := e.as(sam).engagement().Counts[docs.Process][library]
	original := e.body(docs.Process, library, "", "")
	status, body := e.as(alex).do("DELETE", "/api/processes/"+library, nil)
	wantStatus(t, status, 200, body)
	var n int
	must(t, e.deps.Docs.Pool.QueryRow(bg, `select (select count(*) from bookmarks) + (select count(*) from upvotes)`).Scan(&n))
	if n != 0 {
		t.Fatalf("%d bookmarks and upvotes left", n)
	}
	// the statistics of the period keep the view and the download
	_, stats := e.as(dana).do("GET", "/api/admin/statistics?period=7", nil)
	totals := stats["totals"].(map[string]any)
	if totals["views"] != float64(1) || totals["downloads"] != float64(1) || before.Views != 1 {
		t.Fatalf("totals: %v (before %+v)", totals, before)
	}
	// something new under the same id starts from nothing
	status, body = e.as(alex).do("PUT", "/api/processes/"+library, original)
	wantStatus(t, status, 200, body)
	if got, ok := s.engagement().Counts[docs.Process][library]; ok {
		t.Fatalf("the new document inherited %+v", got)
	}
	s.noContent("POST", "/api/views/process/"+library) // the same day: the old view does not stand in the way
	if got := s.engagement().Counts[docs.Process][library]; got.Views != 1 || got.Downloads != 0 {
		t.Fatalf("%+v", got)
	}
	_, stats = e.as(dana).do("GET", "/api/admin/statistics?period=7", nil)
	if totals := stats["totals"].(map[string]any); totals["views"] != float64(2) || totals["people"] != float64(1) {
		t.Fatalf("totals: %v", totals)
	}
}
