package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
)

func TestTheOwningTeamConfirmsTheReviewOfWhatItOwns(t *testing.T) {
	e := setup(t, nil)
	today := time.Now().UTC().Format("2006-01-02")
	before, _ := e.deps.Docs.Get(bg, docs.Process, gcp)

	// casey is in the team that owns the process: that is exactly who is asked to review it
	status, body := e.as(casey).do("POST", "/api/processes/"+gcp+"/review", nil)
	if status != 200 || body["version"] != float64(2) || body["updatedBy"] != casey || body["changed"] != true {
		t.Fatalf("the owner's review: %d %v", status, body)
	}
	after, _ := e.deps.Docs.Get(bg, docs.Process, gcp)
	var doc struct {
		Review struct {
			IntervalMonths int    `json:"intervalMonths"`
			LastReviewedAt string `json:"lastReviewedAt"`
			ReviewedBy     string `json:"reviewedBy"`
		} `json:"review"`
		UpdatedAt string `json:"updatedAt"`
	}
	must(t, json.Unmarshal(after.Body, &doc))
	if doc.Review.LastReviewedAt != today || doc.Review.ReviewedBy != "Casey Owner" || doc.Review.IntervalMonths != 6 {
		t.Fatalf("review: %+v", doc.Review)
	}
	// nothing else moved: the same fields in the same order, only the review differs
	strip := func(b []byte) string {
		s := string(b)
		from, to := strings.Index(s, `"review": {`), 0
		to = from + strings.Index(s[from:], "}")
		return s[:from] + s[to:]
	}
	if strip(before.Body) != strip(after.Body) {
		t.Fatalf("the review changed more than the review:\n%s", after.Body[:400])
	}
	// it is a version with a note, and in the activity log
	versions, _ := e.deps.Docs.History(bg, docs.Process, gcp)
	if versions[0].Note != "Reviewed: confirmed as still correct" || versions[0].SavedBy != casey {
		t.Fatalf("version: %+v", versions[0])
	}
	entries, _ := e.deps.Audit.Recent(bg, 1)
	if entries[0].Action != "process.review" || entries[0].Target != gcp || entries[0].Email != casey {
		t.Fatalf("activity: %+v", entries[0])
	}
	// confirming twice on the same day changes nothing
	status, body = e.as(casey).do("POST", "/api/processes/"+gcp+"/review", nil)
	if status != 200 || body["changed"] != false || body["version"] != float64(2) {
		t.Fatalf("a second review today: %d %v", status, body)
	}
}

func TestWhoMayConfirmAReview(t *testing.T) {
	e := setup(t, nil)
	cases := []struct {
		who, path string
		want      int
	}{
		{sam, "/api/processes/" + gcp + "/review", 403},       // a reader
		{casey, "/api/processes/" + repoP + "/review", 403},   // owner of another team
		{casey, "/api/standards/" + logging + "/review", 403}, // not her team
		{riley, "/api/processes/" + gcp + "/review", 403},     // a standards editor is no process owner
		{alex, "/api/processes/" + gcp + "/review", 200},      // edits every process
		{riley, "/api/standards/" + logging + "/review", 200}, // owns its practice and its team
		{riley, "/api/standards/" + review + "/review", 403},  // a standard of another practice and team
		{dana, "/api/standards/" + review + "/review", 200},   // admin
		{dana, "/api/processes/does-not-exist/review", 404},
	}
	for _, c := range cases {
		status, body := e.as(c.who).do("POST", c.path, nil)
		if status != c.want {
			t.Errorf("%s %s: %d, want %d (%v)", c.who, c.path, status, c.want, body)
		}
	}
}

func TestAReviewNeedsSomethingInUseAndTheVersionOnScreen(t *testing.T) {
	e := setup(t, nil)
	// somebody changed it since the owner opened it: she is asked to look again first
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.body(docs.Process, gcp, "Request a GCP project", "Request a Google Cloud project"))
	wantStatus(t, status, 200, body)
	status, body = e.as(casey).do("POST", "/api/processes/"+gcp+"/review?base=1", nil)
	if status != 409 || body["conflict"] == nil {
		t.Fatalf("a review of an outdated version: %d %v", status, body)
	}
	// a draft is not reviewed
	draft := strings.Replace(e.body(docs.Process, gcp, "", ""), `"status": "active"`, `"status": "draft"`, 1)
	if !strings.Contains(draft, `"status": "draft"`) {
		draft = strings.Replace(draft, `"title":`, `"status": "draft", "title":`, 1)
	}
	status, body = e.as(alex).do("PUT", "/api/processes/"+gcp, draft)
	wantStatus(t, status, 200, body)
	status, body = e.as(casey).do("POST", "/api/processes/"+gcp+"/review", nil)
	wantStatus(t, status, 400, body)
	// and for somebody who cannot see the draft it does not exist
	status, body = e.as(sam).do("POST", "/api/processes/"+gcp+"/review", nil)
	wantStatus(t, status, 404, body)
}

func TestWithReviewKeepsEverythingElse(t *testing.T) {
	body := []byte(`{"id": "x", "title": "T", "status": "active", "steps": [{"id": "a", "z": 1, "b": 2}], "tags": ["k"]}`)
	out, err := docs.WithReview(body, "2026-11-16", `Kim "K" Lee`, 6)
	must(t, err)
	want := `{
  "id": "x",
  "title": "T",
  "status": "active",
  "review": {
    "intervalMonths": 6,
    "lastReviewedAt": "2026-11-16",
    "reviewedBy": "Kim \"K\" Lee"
  },
  "steps": [
    {
      "id": "a",
      "z": 1,
      "b": 2
    }
  ],
  "tags": [
    "k"
  ]
}`
	if string(out) != want {
		t.Fatalf("got:\n%s", out)
	}
	// an existing rhythm is kept
	out, err = docs.WithReview([]byte(`{"review": {"intervalMonths": 24, "lastReviewedAt": "2020-01-01"}, "id": "x"}`), "2026-11-16", "", 6)
	must(t, err)
	if !strings.Contains(string(out), `"intervalMonths": 24`) || !strings.Contains(string(out), `"lastReviewedAt": "2026-11-16"`) || strings.Contains(string(out), "reviewedBy") || strings.Index(string(out), `"review"`) > strings.Index(string(out), `"id"`) {
		t.Fatalf("got:\n%s", out)
	}
	if _, err := docs.WithReview([]byte(`[1]`), "2026-11-16", "x", 6); err == nil {
		t.Fatal("a list is not a document")
	}
}

func TestAReviewNeverPutsOlderContentBack(t *testing.T) {
	e := setup(t, nil)
	// naming a version that does not exist yet must not get a review accepted when it then comes to exist
	for _, base := range []string{"2", "7", "0"} {
		status, body := e.as(casey).do("POST", "/api/processes/"+gcp+"/review?base="+base, nil)
		if status != 409 {
			t.Errorf("base=%s: %d %v", base, status, body)
		}
	}
	if d, _ := e.deps.Docs.Get(bg, docs.Process, gcp); d.Version != 1 {
		t.Fatalf("a refused review was stored: v%d", d.Version)
	}
	status, body := e.as(casey).do("POST", "/api/processes/"+gcp+"/review?base=1", nil)
	wantStatus(t, status, 200, body)
}

func TestALongNameDoesNotStopAReview(t *testing.T) {
	long := strings.Repeat("Maximilian-Alexander ", 4) + "von Hohenzollern-Sigmaringen" // far beyond the 60 the format allows
	got := reviewerName(long)
	if n := len([]rune(got)); n != 60 || !strings.HasSuffix(got, "…") || !strings.HasPrefix(got, "Maximilian-Alexander Max") {
		t.Fatalf("%d characters: %q", n, got)
	}
	if reviewerName("Casey Owner") != "Casey Owner" {
		t.Fatal("a short name must stay as it is")
	}
	// and the stored document with such a name still matches the format
	e := setup(t, nil)
	d, _ := e.deps.Docs.Get(bg, docs.Process, gcp)
	body, err := docs.WithReview(d.Body, "2026-11-16", got, 6)
	must(t, err)
	must(t, e.deps.Schemas.Validate(docs.Process, body))
}

func TestAReviewDateHasToBeADate(t *testing.T) {
	e := setup(t, nil)
	bad := strings.Replace(e.body(docs.Process, gcp, "", ""), `"lastReviewedAt": "2026-11-03"`, `"lastReviewedAt": "2026-13-45"`, 1)
	if !strings.Contains(bad, "2026-13-45") {
		t.Fatal("the sample process has another review date than this test expects")
	}
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, bad)
	if status != 400 || !strings.Contains(body["error"].(string), "is not a date") {
		t.Fatalf("%d %v", status, body)
	}
	// a rhythm written as a decimal is still that rhythm after a review
	out, err := docs.WithReview([]byte(`{"id": "x", "review": {"intervalMonths": 24.0}}`), "2026-11-16", "", 6)
	must(t, err)
	if !strings.Contains(string(out), `"intervalMonths": 24,`) {
		t.Fatalf("got %s", out)
	}
}

func TestTodayIsTheDayOfTheZoneFromUTCMinus12ToPlus14(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		must(t, err)
		return v
	}
	cases := []struct {
		now, day string
		want     bool
	}{
		// just after midnight UTC: still yesterday at UTC-12 (Baker Island), already the same day in Auckland
		{"2026-11-23T00:05:00Z", "2026-11-22", true},
		{"2026-11-23T00:05:00Z", "2026-11-23", true},
		{"2026-11-23T00:05:00Z", "2026-11-24", false},
		// just before midnight UTC: Kiritimati (UTC+14) and Auckland (UTC+13) are already in tomorrow
		{"2026-11-23T23:55:00Z", "2026-11-24", true},
		{"2026-11-23T23:55:00Z", "2026-11-23", true},
		{"2026-11-23T23:55:00Z", "2026-11-22", false},
		// at 10:00 UTC it is the 24th from UTC+14 on, the 22nd nowhere
		{"2026-11-23T10:00:00Z", "2026-11-24", true},
		{"2026-11-23T09:59:00Z", "2026-11-24", false},
		{"2026-11-23T12:00:00Z", "2026-11-22", false},
		{"2026-11-23T11:59:00Z", "2026-11-22", true},
		// a wrong clock, or not a day at all
		{"2026-11-23T12:00:00Z", "2026-12-23", false},
		{"2026-11-23T12:00:00Z", "2026-11-31", false},
		{"2026-11-23T12:00:00Z", "2026-11-3", false},
		{"2026-11-23T12:00:00Z", "", false},
	}
	for _, c := range cases {
		if got := docs.TodaySomewhere(c.day, at(c.now)); got != c.want {
			t.Errorf("%s at %s: %v, want %v", c.day, c.now, got, c.want)
		}
	}
}

func TestAReviewIsRecordedOnThePersonsOwnDay(t *testing.T) {
	e := setup(t, nil)
	lastReviewed := func() string {
		d, _ := e.deps.Docs.Get(bg, docs.Process, gcp)
		var doc struct {
			Review struct {
				LastReviewedAt string `json:"lastReviewedAt"`
			} `json:"review"`
		}
		must(t, json.Unmarshal(d.Body, &doc))
		return doc.Review.LastReviewedAt
	}
	// the day at UTC+14 is today for somebody on Earth right now (Kiritimati): taken as it is
	ahead := time.Now().UTC().Add(14 * time.Hour).Format(time.DateOnly)
	status, body := e.as(casey).do("POST", "/api/processes/"+gcp+"/review?day="+ahead, nil)
	if status != 200 || lastReviewed() != ahead {
		t.Fatalf("a review from far ahead of UTC: %d %v, stored %s", status, body, lastReviewed())
	}
	// somebody behind UTC confirms on their own, earlier, day: the review date does not go back
	behind := time.Now().UTC().Add(-12 * time.Hour).Format(time.DateOnly)
	status, body = e.as(alex).do("POST", "/api/processes/"+gcp+"/review?day="+behind, nil)
	if status != 200 || lastReviewed() != ahead {
		t.Fatalf("a review from behind UTC: %d %v, stored %s", status, body, lastReviewed())
	}
	// a day that is today nowhere is a wrong clock: the review is still recorded, on the server's
	// own day (UTC), and never on the wrong day
	utc := time.Now().UTC().Format(time.DateOnly)
	for _, day := range []string{time.Now().UTC().AddDate(0, 0, 3).Format(time.DateOnly), "2020-01-01", "tomorrow"} {
		e := setup(t, nil)
		status, body := e.as(casey).do("POST", "/api/processes/"+gcp+"/review?day="+day, nil)
		d, _ := e.deps.Docs.Get(bg, docs.Process, gcp)
		if status != 200 || !strings.Contains(string(d.Body), `"lastReviewedAt": "`+utc+`"`) {
			t.Errorf("day %s: %d %v", day, status, body)
		}
	}
}

func TestWithReviewNeverMovesTheReviewDateBack(t *testing.T) {
	out, err := docs.WithReview([]byte(`{"id": "x", "review": {"intervalMonths": 6, "lastReviewedAt": "2026-11-24"}}`), "2026-11-23", "Kim", 6)
	must(t, err)
	if !strings.Contains(string(out), `"lastReviewedAt": "2026-11-24"`) || !strings.Contains(string(out), `"reviewedBy": "Kim"`) {
		t.Fatalf("got %s", out)
	}
	// an unreadable old date is replaced
	out, err = docs.WithReview([]byte(`{"id": "x", "review": {"intervalMonths": 6, "lastReviewedAt": "9999-99-99"}}`), "2026-11-23", "", 6)
	must(t, err)
	if !strings.Contains(string(out), `"lastReviewedAt": "2026-11-23"`) {
		t.Fatalf("got %s", out)
	}
}
