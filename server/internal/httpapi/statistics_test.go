package httpapi

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/engagement"
)

type statsAnswer struct {
	Period string
	From   string
	To     string
	Totals map[string]int
	Rows   []struct {
		Kind, ID, Title, Status, Owner, Platform, Practice, Category                   string
		Views, People, Downloads, Upvotes, UpvotesTotal, FeedbackOpen, FeedbackHandled int
	}
	Groups map[string][]struct {
		ID, Name                                                      string
		Documents, Views, People, Downloads, Upvotes, FeedbackHandled int
	}
	Trend []struct {
		Week                           string
		Days, Views, People, Downloads int
	}
}

func (e *env) stats(period string) statsAnswer {
	e.t.Helper()
	status, raw, _ := e.as(dana).raw("GET", "/api/admin/statistics?period="+period, nil, false)
	if status != 200 {
		e.t.Fatalf("statistics: %d %s", status, raw)
	}
	var out statsAnswer
	must(e.t, json.Unmarshal(raw, &out))
	return out
}

// history fills a few months of activity on the GCP process, dated relative to today.
func (e *env) history() {
	e.t.Helper()
	pool := e.deps.Docs.Pool
	now := time.Now()
	ago := func(days int) time.Time { return now.Add(-time.Duration(days) * 24 * time.Hour) }
	for _, v := range []struct {
		email string
		days  int
	}{{sam, 0}, {alex, 0}, {sam, 10}, {riley, 100}} {
		_, _, err := e.deps.Engagement.RecordView(bg, docs.Process, gcp, v.email, ago(v.days))
		must(e.t, err)
	}
	_, err := e.deps.Engagement.CountDownload(bg, "process-"+gcp, docs.Process, gcp, sam, engagement.ViaDownload, now)
	must(e.t, err)
	_, err = e.deps.Engagement.CountDownload(bg, "process-"+gcp, docs.Process, gcp, "", engagement.ViaExport, ago(40))
	must(e.t, err)
	for _, u := range []struct {
		email string
		days  int
	}{{sam, 0}, {alex, 50}} {
		_, err := pool.Exec(bg, `insert into upvotes (email, kind, id, created_at) values ($1, 'process', $2, $3)`, u.email, gcp, ago(u.days))
		must(e.t, err)
	}
	for _, f := range []struct {
		created  int
		resolved int // -1: open
	}{{0, 0}, {60, 45}, {3, -1}} {
		var resolved any
		if f.resolved >= 0 {
			resolved = ago(f.resolved)
		}
		_, err := pool.Exec(bg, `insert into feedback (target_kind, target_id, kind, body, author_email, author_name, created_at, resolved_at)
			values ('process', $1, 'broken', 'x', $2, 'Sam', $3, $4)`, gcp, sam, ago(f.created), resolved)
		must(e.t, err)
	}
	e.as(sam).request(docs.Process, "Something else entirely", "", "")
}

func TestStatisticsAreForAdmins(t *testing.T) {
	e := setup(t, nil)
	for _, who := range []string{sam, alex, riley} {
		for _, p := range []string{"/api/admin/statistics", "/api/admin/statistics.csv"} {
			status, body := e.as(who).do("GET", p, nil)
			wantError(t, status, body, 403, "Only admins can do that.")
		}
	}
	for _, p := range []string{"/api/admin/statistics?period=14", "/api/admin/statistics.csv?period=forever"} {
		status, body := e.as(dana).do("GET", p, nil)
		wantError(t, status, body, 400, "Choose a period of 7, 30, 90 or 365 days, or all.")
	}
}

func TestStatisticsOfAPeriod(t *testing.T) {
	e := setup(t, nil)
	e.history()
	today := engagement.Day(time.Now())

	week := e.stats("7")
	if week.Period != "7" || week.To != today.Format("2006-01-02") || week.From != today.AddDate(0, 0, -6).Format("2006-01-02") {
		t.Fatalf("period: %s %s %s", week.Period, week.From, week.To)
	}
	want := map[string]int{"views": 2, "people": 2, "downloads": 1, "upvotes": 1, "feedbackOpened": 2, "feedbackHandled": 1, "requests": 1}
	for k, v := range want {
		if week.Totals[k] != v {
			t.Errorf("7 days, %s: %d, want %d", k, week.Totals[k], v)
		}
	}
	if len(week.Rows) != 10 {
		t.Fatalf("rows: %d", len(week.Rows))
	}
	top := week.Rows[0]
	if top.ID != gcp || top.Kind != "process" || top.Title != "Request a GCP project" || top.Status != "active" || top.Owner != "cloud-platform-team" ||
		top.Platform != "google-cloud" || top.Category != "cloud" || top.Views != 2 || top.People != 2 || top.Downloads != 1 || top.Upvotes != 1 ||
		top.UpvotesTotal != 2 || top.FeedbackOpen != 1 || top.FeedbackHandled != 1 {
		t.Fatalf("row: %+v", top)
	}
	var platform *struct {
		ID, Name                                                      string
		Documents, Views, People, Downloads, Upvotes, FeedbackHandled int
	}
	for i, g := range week.Groups["platform"] {
		if g.ID == "google-cloud" {
			platform = &week.Groups["platform"][i]
		}
	}
	if platform == nil || platform.Name != "Google Cloud" || platform.Documents != 2 || platform.Views != 2 || platform.People != 2 || platform.Downloads != 1 {
		t.Fatalf("platform group: %+v", week.Groups["platform"])
	}
	if len(week.Groups["team"]) == 0 || len(week.Groups["practice"]) == 0 || week.Groups["team"][0].ID != "cloud-platform-team" {
		t.Fatalf("groups: %+v", week.Groups)
	}
	// the GCP process has no practice: it is in "None", which comes last; every team owns something
	practices := week.Groups["practice"]
	if none := practices[len(practices)-1]; none.ID != "" || none.Name != "None" || none.Views != 2 || none.People != 2 || none.Documents == 0 {
		t.Fatalf("no practice: %+v", practices)
	}
	for _, g := range week.Groups["team"] {
		if g.ID == "" {
			t.Fatalf("no None without documents: %+v", g)
		}
	}
	// the days of each week that fall in the period
	days := 0
	for _, w := range week.Trend {
		if w.Days < 1 || w.Days > 7 {
			t.Fatalf("days: %+v", w)
		}
		days += w.Days
	}
	if days != 7 {
		t.Fatalf("7 days in the trend: %d", days)
	}
	// the trend: weeks from Monday, oldest first, the last one is this week
	last := week.Trend[len(week.Trend)-1]
	if last.Week != engagement.Monday(today).Format("2006-01-02") || week.Trend[0].Week > last.Week {
		t.Fatalf("trend: %+v", week.Trend)
	}
	views := 0
	for _, w := range week.Trend {
		views += w.Views
		if d, _ := time.Parse("2006-01-02", w.Week); d.Weekday() != time.Monday {
			t.Fatalf("not a Monday: %s", w.Week)
		}
	}
	if views != 2 {
		t.Fatalf("trend views: %d", views)
	}

	month := e.stats("30")
	if month.Totals["views"] != 3 || month.Totals["people"] != 2 || month.Totals["feedbackHandled"] != 1 || len(month.Trend) < 5 {
		t.Fatalf("30 days: %+v, %d weeks", month.Totals, len(month.Trend))
	}
	quarter := e.stats("90")
	if quarter.Totals["downloads"] != 2 || quarter.Totals["upvotes"] != 2 || quarter.Totals["feedbackOpened"] != 3 || quarter.Totals["feedbackHandled"] != 2 {
		t.Fatalf("90 days: %+v", quarter.Totals)
	}
	all := e.stats("all")
	if all.Totals["views"] != 4 || all.Totals["people"] != 3 || all.From != today.AddDate(0, 0, -100).Format("2006-01-02") {
		t.Fatalf("all: %s %+v", all.From, all.Totals)
	}
	if def := e.stats(""); def.Period != "30" {
		t.Fatalf("default: %s", def.Period)
	}
}

func TestStatisticsSayWhatBelongsToDeletedDocuments(t *testing.T) {
	e := setup(t, nil)
	e.as(sam).view(docs.Process, library)
	e.as(alex).view(docs.Process, gcp)
	if status, _, _ := e.as(sam).raw("GET", "/api/skills/process-"+library+"/download", nil, false); status != 200 {
		t.Fatal(status)
	}
	status, body := e.as(alex).do("DELETE", "/api/processes/"+library, nil)
	wantStatus(t, status, 200, body)
	st := e.stats("7")
	if st.Totals["views"] != 2 || st.Totals["deletedViews"] != 1 || st.Totals["downloads"] != 1 || st.Totals["deletedDownloads"] != 1 || st.Totals["people"] != 2 {
		t.Fatalf("%+v", st.Totals)
	}
	sum := 0
	for _, r := range st.Rows {
		sum += r.Views
	}
	if sum != st.Totals["views"]-st.Totals["deletedViews"] {
		t.Fatalf("rows %d", sum)
	}
}

func TestStatisticsShowDraftsToAdminsAsDrafts(t *testing.T) {
	e := setup(t, nil)
	status, body := e.as(alex).do("PUT", "/api/processes/"+gcp, e.asDraft(docs.Process, gcp, "SECRET"))
	wantStatus(t, status, 200, body)
	for _, r := range e.stats("7").Rows {
		if r.ID == gcp && (r.Status != "draft" || r.Title != "SECRET") {
			t.Fatalf("%+v", r)
		}
	}
}

func TestStatisticsAsASpreadsheet(t *testing.T) {
	e := setup(t, nil)
	e.history()
	status, body := e.as(dana).do("PUT", "/api/standards/"+review, e.body(docs.Standard, review, `"status": "active"`, `"status": "deprecated"`))
	wantStatus(t, status, 200, body)
	tricky := e.body(docs.Process, repoP, `"title": "Request a repository"`, `"title": "=HYPERLINK(\"http://x\", \"Click\"), then; more"`)
	status, body = e.as(alex).do("PUT", "/api/processes/"+repoP, tricky)
	wantStatus(t, status, 200, body)

	status, raw, header := e.as(dana).raw("GET", "/api/admin/statistics.csv?period=7", nil, false)
	if status != 200 || !strings.HasPrefix(header.Get("Content-Type"), "text/csv") {
		t.Fatalf("%d %v", status, header)
	}
	today := engagement.Day(time.Now()).Format("2006-01-02")
	if got := header.Get("Content-Disposition"); got != `attachment; filename="statistics-last-7-days-`+today+`.csv"` {
		t.Fatalf("file name: %s", got)
	}
	if !bytes.HasPrefix(raw, []byte{0xEF, 0xBB, 0xBF}) || !bytes.Contains(raw, []byte("\r\n")) {
		t.Fatal("a spreadsheet needs the byte order mark and CRLF")
	}
	records, err := csv.NewReader(bytes.NewReader(raw[3:])).ReadAll()
	must(t, err)
	if len(records) != 11 || strings.Join(records[0], "|") != "Type|Title|Id|Status|Owning team|Platform|Practice|Category|Views|People|Skill downloads|Upvotes in the period|Upvotes in total|Open feedback|Feedback handled in the period" {
		t.Fatalf("header: %v (%d lines)", records[0], len(records))
	}
	if got := strings.Join(records[1], "|"); got != "Process|Request a GCP project|request-gcp-project|Active|Cloud Platform team|Google Cloud||Cloud|2|2|1|1|2|1|1" {
		t.Fatalf("first row: %s", got)
	}
	found := false
	for _, r := range records {
		if r[2] == review && r[3] != "Retired" {
			t.Fatalf("status in the words of the app: %v", r)
		}
		if r[2] == repoP {
			found = true
			if r[1] != `'=HYPERLINK("http://x", "Click"), then; more` {
				t.Fatalf("formula not guarded: %q", r[1])
			}
		}
	}
	if !found {
		t.Fatal("row missing")
	}
	_, _, header = e.as(dana).raw("GET", "/api/admin/statistics.csv?period=all", nil, false)
	if got := header.Get("Content-Disposition"); got != `attachment; filename="statistics-all-time-`+today+`.csv"` {
		t.Fatalf("file name: %s", got)
	}
}

func TestCSVCellGuard(t *testing.T) {
	for in, want := range map[string]string{"=1+1": "'=1+1", "+1": "'+1", "-1": "'-1", "@SUM(A1)": "'@SUM(A1)", "\tx": "'\tx", "plain": "plain", "": "", "a=b": "a=b",
		"  =1+1": "'  =1+1", " \u00a0@x": "' \u00a0@x", "\n=1": "'\n=1", "\rx": "'\rx", "  plain": "  plain", "x -1": "x -1"} {
		if got := csvCell(in); got != want {
			t.Errorf("%q: %q, want %q", in, got, want)
		}
	}
}
