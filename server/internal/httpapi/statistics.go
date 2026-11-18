package httpapi

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/engagement"
)

// periods: the choices of the statistics, in days; "all" is everything recorded.
var periods = map[string]int{"7": 7, "30": 30, "90": 90, "365": 365, "all": 0}

const dateOnly = "2006-01-02"

type statTotals struct {
	Views           int `json:"views"`
	People          int `json:"people"`
	Downloads       int `json:"downloads"`
	Upvotes         int `json:"upvotes"`
	FeedbackOpened  int `json:"feedbackOpened"`
	FeedbackHandled int `json:"feedbackHandled"`
	Requests        int `json:"requests"`
	// the part of views and downloads that belongs to documents deleted since
	DeletedViews     int `json:"deletedViews"`
	DeletedDownloads int `json:"deletedDownloads"`
}

// statRow is one process or standard. Views, people, downloads, upvotes and feedbackHandled are
// within the period; upvotesTotal and feedbackOpen are as of now.
type statRow struct {
	Kind            string `json:"kind"`
	ID              string `json:"id"`
	Title           string `json:"title"`
	Status          string `json:"status"`
	Owner           string `json:"owner"`
	Platform        string `json:"platform"`
	Practice        string `json:"practice"`
	Category        string `json:"category"`
	Views           int    `json:"views"`
	People          int    `json:"people"`
	Downloads       int    `json:"downloads"`
	Upvotes         int    `json:"upvotes"`
	UpvotesTotal    int    `json:"upvotesTotal"`
	FeedbackOpen    int    `json:"feedbackOpen"`
	FeedbackHandled int    `json:"feedbackHandled"`
}

type statGroup struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Documents       int    `json:"documents"`
	Views           int    `json:"views"`
	People          int    `json:"people"`
	Downloads       int    `json:"downloads"`
	Upvotes         int    `json:"upvotes"`
	FeedbackHandled int    `json:"feedbackHandled"`
}

type statWeek struct {
	Week      string `json:"week"`
	Days      int    `json:"days"` // how many of its days fall in the period (1-7)
	Views     int    `json:"views"`
	People    int    `json:"people"`
	Downloads int    `json:"downloads"`
}

type statistics struct {
	Period string                 `json:"period"`
	From   string                 `json:"from"`
	To     string                 `json:"to"`
	Totals statTotals             `json:"totals"`
	Rows   []statRow              `json:"rows"`
	Groups map[string][]statGroup `json:"groups"`
	Trend  []statWeek             `json:"trend"`

	lists docs.Lists
}

// periodStart is the first day of a period that ends today (UTC): "7" is today and the six
// days before it.
func periodStart(days int, today time.Time) time.Time {
	return today.AddDate(0, 0, -(days - 1))
}

// collectStatistics works out the statistics for the period in the address. Admins see every
// document, drafts included; the status of each row says what it is.
func (a *api) collectStatistics(w http.ResponseWriter, r *http.Request) (*statistics, bool) {
	period := r.URL.Query().Get("period")
	if period == "" {
		period = "30"
	}
	days, ok := periods[period]
	if !ok {
		writeError(w, 400, "Choose a period of 7, 30, 90 or 365 days, or all.")
		return nil, false
	}
	ctx := r.Context()
	now := time.Now()
	today := engagement.Day(now)
	from := periodStart(days, today)
	if days == 0 {
		var err error
		if from, err = a.Engagement.Earliest(ctx, now); err != nil {
			a.fail(w, r, err)
			return nil, false
		}
	}
	p, err := a.Engagement.PeriodFrom(ctx, from, now)
	if err != nil {
		a.fail(w, r, err)
		return nil, false
	}
	lists, err := a.Docs.Lists(ctx)
	if err != nil {
		a.fail(w, r, err)
		return nil, false
	}
	out := &statistics{
		Period: period, From: from.Format(dateOnly), To: today.Format(dateOnly), lists: lists,
		Totals: statTotals{Views: p.Views, People: p.People, Downloads: p.Downloads, Upvotes: p.Upvotes,
			FeedbackOpened: p.FeedbackOpened, FeedbackHandled: p.FeedbackHandled, Requests: p.Requests,
			DeletedViews: p.DeletedViews, DeletedDownloads: p.DeletedDownloads},
		Rows: []statRow{}, Trend: []statWeek{},
	}
	groups := map[string]map[string]*statGroup{"platform": {}, "practice": {}, "team": {}}
	listOf := map[string][]docs.Named{"platform": lists.Platforms, "practice": lists.Practices, "team": lists.Teams}
	for key, list := range listOf {
		for _, n := range list {
			groups[key][n.ID] = &statGroup{ID: n.ID, Name: n.Name}
		}
	}
	add := func(key, id string, row statRow) {
		g := groups[key][id]
		switch {
		case g != nil:
		case id == "": // documents without a platform, practice or owning team
			g = &statGroup{ID: "", Name: "None"}
		default: // named by a document but no longer in the lists: shown by its id
			g = &statGroup{ID: id, Name: id}
		}
		groups[key][id] = g
		g.Documents++
		g.Views += row.Views
		g.Downloads += row.Downloads
		g.Upvotes += row.Upvotes
		g.FeedbackHandled += row.FeedbackHandled
	}
	for _, kind := range []string{docs.Process, docs.Standard} {
		list, err := a.Docs.List(ctx, kind)
		if err != nil {
			a.fail(w, r, err)
			return nil, false
		}
		for _, d := range list {
			var head struct {
				Title    string `json:"title"`
				Status   string `json:"status"`
				Owner    string `json:"owner"`
				Platform string `json:"platform"`
				Practice string `json:"practice"`
				Category string `json:"category"`
			}
			_ = json.Unmarshal(d.Body, &head)
			if head.Status == "" {
				head.Status = "active"
			}
			row := statRow{Kind: kind, ID: d.ID, Title: head.Title, Status: head.Status, Owner: head.Owner,
				Platform: head.Platform, Practice: head.Practice, Category: head.Category}
			k := engagement.Key{Kind: kind, ID: d.ID}
			if c := p.Docs[k]; c != nil {
				row.Views, row.People, row.Downloads, row.Upvotes = c.Views, c.People, c.Downloads, c.Upvotes
				row.UpvotesTotal, row.FeedbackOpen, row.FeedbackHandled = c.UpvotesTotal, c.FeedbackOpen, c.FeedbackHandled
			}
			out.Rows = append(out.Rows, row)
			add("platform", row.Platform, row)
			add("practice", row.Practice, row)
			add("team", row.Owner, row)
		}
	}
	sort.SliceStable(out.Rows, func(i, j int) bool {
		a, b := out.Rows[i], out.Rows[j]
		if a.Views != b.Views {
			return a.Views > b.Views
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return strings.ToLower(a.Title) < strings.ToLower(b.Title)
	})
	out.Groups = map[string][]statGroup{}
	for key, byID := range groups {
		list := make([]statGroup, 0, len(byID))
		for id, g := range byID {
			if c := p.Groups[key][id]; c != nil {
				g.People = c.People // different people, counted in the database
			}
			list = append(list, *g)
		}
		sort.Slice(list, func(i, j int) bool {
			if (list[i].ID == "") != (list[j].ID == "") {
				return list[j].ID == "" // "None" comes last
			}
			if list[i].Views != list[j].Views {
				return list[i].Views > list[j].Views
			}
			return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name)
		})
		out.Groups[key] = list
	}
	for _, wk := range p.Weeks {
		out.Trend = append(out.Trend, statWeek{Week: wk.Week.Format(dateOnly), Days: wk.Days, Views: wk.Views, People: wk.People, Downloads: wk.Downloads})
	}
	return out, true
}

func (a *api) statistics(w http.ResponseWriter, r *http.Request) {
	if st, ok := a.collectStatistics(w, r); ok {
		writeJSON(w, 200, st)
	}
}

// csvCell keeps a text from being read as a formula by a spreadsheet: a cell that starts with a
// tab, carriage return or line feed, or whose first character after spaces is =, +, - or @, gets
// an apostrophe in front.
func csvCell(s string) string {
	if s == "" {
		return s
	}
	if strings.ContainsRune("\t\r\n", rune(s[0])) {
		return "'" + s
	}
	if rest := strings.TrimLeftFunc(s, unicode.IsSpace); rest != "" && strings.ContainsRune("=+-@", rune(rest[0])) {
		return "'" + s
	}
	return s
}

// statusWords are the words the app uses for a status (STATUS_LABEL in src/lib/lifecycle.ts).
var statusWords = map[string]string{"active": "Active", "draft": "Draft", "deprecated": "Retired"}

// statisticsCSV is the same as statistics, one line per process or standard, for a spreadsheet.
// Names are used where the lists have them. The file starts with a byte order mark so that
// spreadsheets read it as UTF-8, and lines end with CRLF.
func (a *api) statisticsCSV(w http.ResponseWriter, r *http.Request) {
	st, ok := a.collectStatistics(w, r)
	if !ok {
		return
	}
	name := "statistics-last-" + st.Period + "-days-" + st.To + ".csv"
	if st.Period == "all" {
		name = "statistics-all-time-" + st.To + ".csv"
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
	out := csv.NewWriter(w)
	out.UseCRLF = true
	_ = out.Write([]string{"Type", "Title", "Id", "Status", "Owning team", "Platform", "Practice", "Category",
		"Views", "People", "Skill downloads", "Upvotes in the period", "Upvotes in total", "Open feedback", "Feedback handled in the period"})
	nameIn := func(list []docs.Named, id string) string {
		if id == "" {
			return ""
		}
		if n := docs.Name(list, id); n != "" {
			return n
		}
		return id
	}
	for _, row := range st.Rows {
		kind := "Process"
		if row.Kind == docs.Standard {
			kind = "Standard"
		}
		status := statusWords[row.Status]
		if status == "" {
			status = row.Status
		}
		num := strconv.Itoa
		_ = out.Write([]string{kind, csvCell(row.Title), csvCell(row.ID), csvCell(status),
			csvCell(nameIn(st.lists.Teams, row.Owner)), csvCell(nameIn(st.lists.Platforms, row.Platform)),
			csvCell(nameIn(st.lists.Practices, row.Practice)), csvCell(nameIn(st.lists.Categories, row.Category)),
			num(row.Views), num(row.People), num(row.Downloads), num(row.Upvotes), num(row.UpvotesTotal), num(row.FeedbackOpen), num(row.FeedbackHandled)})
	}
	out.Flush()
	if err := out.Error(); err != nil {
		a.Log.Warn("statistics file not completed", "error", err)
	}
}
