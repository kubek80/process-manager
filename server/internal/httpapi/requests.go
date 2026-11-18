package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/requests"
)

// maxRequestsPerHour is how many requests one person can make in an hour.
const maxRequestsPerHour = 10

// requestView is a request as one particular user sees it.
type requestView struct {
	ID          int64     `json:"id"`
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Platform    string    `json:"platform"`
	Practice    string    `json:"practice"`
	RequestedBy author    `json:"requestedBy"`
	CreatedAt   time.Time `json:"createdAt"`
	State       string    `json:"state"`
	StateNote   string    `json:"stateNote"`
	StateBy     string    `json:"stateBy"`
	StateAt     string    `json:"stateAt"` // RFC 3339, or "" while the state was never changed
	LinkedID    string    `json:"linkedId"`
	LinkedGone  bool      `json:"linkedGone"` // the document that answered it was deleted since
	Votes       int       `json:"votes"`
	VotedByMe   bool      `json:"votedByMe"`
	Mine        bool      `json:"mine"`
	CanManage   bool      `json:"canManage"`
}

// canManageRequest: whoever could create what is asked for - admins, process editors for a
// process, standards editors for a standard, and the owners of the platform or practice it names.
func canManageRequest(s session, q requests.Request) bool {
	return s.CanEdit(q.Kind, rbac.Belongs{Platform: q.Platform, Practice: q.Practice})
}

func viewRequest(s session, q requests.Request, hide hidden) requestView {
	out := requestView{
		ID: q.ID, Kind: q.Kind, Title: q.Title, Description: q.Description, Platform: q.Platform, Practice: q.Practice,
		RequestedBy: author{q.ByName, q.ByEmail}, CreatedAt: q.CreatedAt, State: q.State, StateNote: q.StateNote, StateBy: q.StateBy,
		LinkedID: q.LinkedID, LinkedGone: q.LinkedGone, Votes: q.Votes, VotedByMe: q.VotedByMe,
		Mine: strings.EqualFold(q.ByEmail, s.Email), CanManage: canManageRequest(s, q),
	}
	if q.StateAt != nil {
		out.StateAt = q.StateAt.UTC().Format(time.RFC3339)
	}
	// The document that answers it may have become a draft again: its id is not passed on to
	// people who cannot see it. (A deleted one is no longer linked: LinkedGone says so.)
	if q.LinkedID != "" && hide.has(q.Kind, q.LinkedID) {
		out.LinkedID = ""
	}
	return out
}

func requestID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

// requestTarget names a request in the activity log.
func requestTarget(id int64) string { return fmt.Sprintf("request %d", id) }

func (a *api) listRequests(w http.ResponseWriter, r *http.Request) {
	s := who(r)
	list, err := a.Requests.List(r.Context(), s.Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	hide, err := a.hiddenFor(r.Context(), s)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	out := make([]requestView, 0, len(list))
	for _, q := range list {
		out = append(out, viewRequest(s, q, hide))
	}
	writeJSON(w, 200, map[string]any{"requests": out})
}

// writeRequest answers with one request as the caller sees it.
func (a *api) writeRequest(w http.ResponseWriter, r *http.Request, status int, q requests.Request) {
	s := who(r)
	hide, err := a.hiddenFor(r.Context(), s)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, status, viewRequest(s, q, hide))
}

func (a *api) createRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind        string `json:"kind"`
		Title       string `json:"title"`
		Description string `json:"description"`
		Platform    string `json:"platform"`
		Practice    string `json:"practice"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	in.Platform = strings.TrimSpace(in.Platform)
	in.Practice = strings.TrimSpace(in.Practice)
	if !countedKind(in.Kind) {
		writeError(w, 400, "Say whether a process or a standard is requested.")
		return
	}
	var problem string
	if in.Title, problem = docs.CheckText(in.Title, "The title", false); problem != "" {
		writeError(w, 400, problem)
		return
	}
	if in.Description, problem = docs.CheckText(in.Description, "The description", true); problem != "" {
		writeError(w, 400, problem)
		return
	}
	title, text := utf8.RuneCountInString(in.Title), utf8.RuneCountInString(in.Description)
	switch {
	case title < 5 || title > 120:
		writeError(w, 400, "Give the request a title of 5 to 120 characters.")
		return
	case text < 10 || text > 1000:
		writeError(w, 400, "Describe what is needed and why in 10 to 1000 characters.")
		return
	}
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if _, ok := lists.Platform(in.Platform); in.Platform != "" && !ok {
		writeError(w, 400, "There is no platform “"+in.Platform+"” in the lists.")
		return
	}
	if _, ok := lists.Practice(in.Practice); in.Practice != "" && !ok {
		writeError(w, 400, "There is no practice “"+in.Practice+"” in the lists.")
		return
	}
	s := who(r)
	// a brake on a script (or a very bad day), like the one on feedback: checked and stored in one
	// step per person, and counting what was withdrawn in the hour as well
	q, err := a.Requests.Create(r.Context(), requests.New{
		Kind: in.Kind, Title: in.Title, Description: in.Description, Platform: in.Platform, Practice: in.Practice,
		ByEmail: s.Email, ByName: s.Name,
	}, maxRequestsPerHour)
	if errors.Is(err, requests.ErrTooMany) {
		writeError(w, 429, "You have made a lot of requests in the last hour. Please try again later.")
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	a.record(r, "request.create", requestTarget(q.ID), fmt.Sprintf("Asked for a %s: “%s”", noun[q.Kind], q.Title))
	a.writeRequest(w, r, 201, q)
}

func (a *api) voteRequest(on bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := requestID(r)
		if !ok {
			writeError(w, 404, "That request does not exist.")
			return
		}
		n, err := a.Requests.SetVote(r.Context(), id, who(r).Email, on)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		writeJSON(w, 200, map[string]int{"votes": n})
	}
}

// stateWords are the states as the activity log names them.
var stateWords = map[string]string{
	requests.Open: "Open", requests.Planned: "Planned", requests.Done: "Done", requests.Declined: "Declined",
}

func (a *api) setRequestState(w http.ResponseWriter, r *http.Request) {
	id, ok := requestID(r)
	if !ok {
		writeError(w, 404, "That request does not exist.")
		return
	}
	var in struct {
		State    string `json:"state"`
		Note     string `json:"note"`
		LinkedID string `json:"linkedId"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	s := who(r)
	q, err := a.Requests.Get(r.Context(), id, s.Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if !canManageRequest(s, q) {
		editors := "process editors"
		if q.Kind == docs.Standard {
			editors = "standards editors"
		}
		writeError(w, 403, "Only admins, "+editors+" and the owners of the platform or practice it names can change the state of this request.")
		return
	}
	in.LinkedID = strings.TrimSpace(in.LinkedID)
	if !requests.ValidState(in.State) {
		writeError(w, 400, "The state must be open, planned, done or declined.")
		return
	}
	var problem string
	if in.Note, problem = docs.CheckText(in.Note, "The note", true); problem != "" {
		writeError(w, 400, problem)
		return
	}
	switch {
	case utf8.RuneCountInString(in.Note) > 1000:
		writeError(w, 400, "Keep the note under 1000 characters.")
		return
	case in.State == requests.Declined && in.Note == "":
		writeError(w, 400, "Say why the request is declined.")
		return
	case in.State == requests.Done && in.LinkedID == "":
		writeError(w, 400, "Choose the "+noun[q.Kind]+" that answers this request.")
		return
	}
	detail := fmt.Sprintf("“%s”: %s", q.Title, stateWords[in.State])
	if in.State == requests.Done {
		// an existing, published document of the same kind: everyone who reads the request can
		// follow the link. A retired one is published too (it is still there to read).
		var d docs.Doc
		err := docs.ErrNotFound
		if docs.ValidID(in.LinkedID) {
			d, err = a.Docs.Get(r.Context(), q.Kind, in.LinkedID)
		}
		if errors.Is(err, docs.ErrNotFound) || (err == nil && !canSee(s, q.Kind, d.Body)) {
			writeError(w, 400, "There is no "+noun[q.Kind]+" “"+in.LinkedID+"”.")
			return
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if _, status := headOf(d.Body); status == "draft" {
			writeError(w, 400, "Only a published "+noun[q.Kind]+" can answer a request. Publish it first.")
			return
		}
		title := in.LinkedID
		if t, ok := docs.TargetOf(d); ok && t.Title != "" {
			title = t.Title
		}
		detail += fmt.Sprintf(", answered by the %s “%s”", noun[q.Kind], title)
	}
	if in.Note != "" {
		detail += ". Note: " + in.Note
	}
	q, err = a.Requests.SetState(r.Context(), id, in.State, in.Note, in.LinkedID, s.Name, s.Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	a.record(r, "request.state", requestTarget(id), detail)
	a.writeRequest(w, r, 200, q)
}

func (a *api) deleteRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := requestID(r)
	if !ok {
		writeError(w, 404, "That request does not exist.")
		return
	}
	s := who(r)
	q, err := a.Requests.Get(r.Context(), id, s.Email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	mine := strings.EqualFold(q.ByEmail, s.Email)
	if !mine && !s.Admin {
		writeError(w, 403, "You can only withdraw your own request.")
		return
	}
	// the requester only while it is open; checked again as it is deleted
	err = a.Requests.Delete(r.Context(), id, !s.Admin)
	if errors.Is(err, requests.ErrNotOpen) {
		writeError(w, 409, "This request is no longer open, so it cannot be withdrawn.")
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	how := "withdrawn by the requester"
	if !mine {
		how = "removed (asked for by " + q.ByEmail + ")"
	}
	a.record(r, "request.delete", requestTarget(id), fmt.Sprintf("“%s”: %s", q.Title, how))
	w.WriteHeader(http.StatusNoContent)
}
