package httpapi

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/notify"
)

// maxFeedbackPerHour is how much one person can report in an hour.
const maxFeedbackPerHour = 30

type author struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// itemView is a feedback item as one particular user sees it.
type itemView struct {
	ID          string     `json:"id"`
	TargetKind  string     `json:"targetKind"` // "process" or "standard"
	TargetID    string     `json:"targetId"`
	ItemID      string     `json:"itemId,omitempty"` // step or requirement
	Kind        string     `json:"kind"`
	Text        string     `json:"text"`
	Author      author     `json:"author"`
	CreatedAt   time.Time  `json:"createdAt"`
	Resolved    bool       `json:"resolved"`
	ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy  string     `json:"resolvedBy,omitempty"`
	AlsoHit     int        `json:"alsoHit"`
	AlsoHitByMe bool       `json:"alsoHitByMe"`
	Stale       bool       `json:"stale"`     // the step or requirement changed or disappeared since
	Mine        bool       `json:"mine"`      // written by the current user
	CanManage   bool       `json:"canManage"` // the current user may mark it fixed or delete it
}

// viewer turns stored items into views, reading each document at most once per request.
type viewer struct {
	a       *api
	r       *http.Request
	s       session
	targets map[string]*docs.Target
}

func (a *api) viewer(r *http.Request) *viewer {
	return &viewer{a: a, r: r, s: who(r), targets: map[string]*docs.Target{}}
}

func (v *viewer) target(kind, id string) *docs.Target {
	key := kind + "/" + id
	if cached, ok := v.targets[key]; ok {
		return cached
	}
	var out *docs.Target
	if kind == docs.Process || kind == docs.Standard {
		if d, err := v.a.Docs.Get(v.r.Context(), kind, id); err == nil {
			if t, ok := docs.TargetOf(d); ok {
				out = &t
			}
		}
	}
	v.targets[key] = out
	return out
}

// hidden: feedback on a draft is for the people who can see the draft.
func (v *viewer) hidden(kind, id string) bool {
	t := v.target(kind, id)
	return t != nil && t.Status == "draft" && !v.s.CanManageFeedback(kind, t.Owner)
}

// canManage: whoever may edit the process or standard, and the team or unit that owns it.
func (v *viewer) canManage(kind, id string) bool {
	owner := ""
	if t := v.target(kind, id); t != nil {
		owner = t.Owner
	}
	return v.s.CanManageFeedback(kind, owner)
}

func (v *viewer) view(it feedback.Item) itemView {
	out := itemView{
		ID: it.ID, TargetKind: it.TargetKind, TargetID: it.TargetID, ItemID: it.ItemID, Kind: it.Kind, Text: it.Text,
		Author: author{it.AuthorName, it.AuthorEmail}, CreatedAt: it.CreatedAt,
		Resolved: it.ResolvedAt != nil, ResolvedAt: it.ResolvedAt, ResolvedBy: it.ResolvedBy,
		AlsoHit: len(it.AlsoHit), Mine: strings.EqualFold(it.AuthorEmail, v.s.Email), CanManage: v.canManage(it.TargetKind, it.TargetID),
	}
	for _, e := range it.AlsoHit {
		if strings.EqualFold(e, v.s.Email) {
			out.AlsoHitByMe = true
		}
	}
	if it.ItemID != "" && it.ItemHash != "" && it.ResolvedAt == nil {
		t := v.target(it.TargetKind, it.TargetID)
		out.Stale = t == nil || t.Items[it.ItemID] != it.ItemHash
	}
	return out
}

func (a *api) listFeedback(w http.ResponseWriter, r *http.Request) {
	items, err := a.Feedback.List(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	v := a.viewer(r)
	out := map[string]map[string][]itemView{docs.Process: {}, docs.Standard: {}}
	for _, it := range items {
		if out[it.TargetKind] == nil || v.hidden(it.TargetKind, it.TargetID) {
			continue
		}
		out[it.TargetKind][it.TargetID] = append(out[it.TargetKind][it.TargetID], v.view(it))
	}
	writeJSON(w, 200, out)
}

func (a *api) createFeedback(w http.ResponseWriter, r *http.Request) {
	var in struct {
		TargetKind string `json:"targetKind"`
		TargetID   string `json:"targetId"`
		ItemID     string `json:"itemId"`
		Kind       string `json:"kind"`
		Text       string `json:"text"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if in.TargetKind == "" {
		in.TargetKind = docs.Process
	}
	s := who(r)
	v := a.viewer(r)
	var t *docs.Target
	if docs.ValidID(in.TargetID) {
		t = v.target(in.TargetKind, in.TargetID)
	}
	what, part := "process", "step"
	if in.TargetKind == docs.Standard {
		what, part = "standard", "requirement"
	}
	switch {
	case t == nil, v.hidden(in.TargetKind, in.TargetID):
		writeError(w, 400, "That "+what+" does not exist.")
		return
	case in.ItemID != "" && t.Items[in.ItemID] == "":
		writeError(w, 400, "That "+part+" does not exist in this "+what+".")
		return
	case !feedback.ValidKind(in.Kind):
		writeError(w, 400, "Choose what kind of feedback this is: "+strings.Join(feedback.Kinds, ", ")+".")
		return
	case utf8.RuneCountInString(in.Text) < 3:
		writeError(w, 400, "Say in a sentence what happened.")
		return
	case utf8.RuneCountInString(in.Text) > 2000:
		writeError(w, 400, "Keep the feedback under 2000 characters.")
		return
	}
	// a brake on a script (or a very bad day): the owner team is notified about every item
	if n, err := a.Feedback.CountSince(r.Context(), s.Email, time.Now().Add(-time.Hour)); err != nil {
		a.fail(w, r, err)
		return
	} else if n >= maxFeedbackPerHour {
		writeError(w, 429, "You have reported a lot in the last hour. Please try again later.")
		return
	}
	item, err := a.Feedback.Create(r.Context(), feedback.New{
		TargetKind: in.TargetKind, TargetID: in.TargetID, ItemID: in.ItemID, Kind: in.Kind, Text: in.Text,
		AuthorEmail: s.Email, AuthorName: s.Name, ItemHash: t.Items[in.ItemID],
	})
	if err != nil {
		a.fail(w, r, err)
		return
	}
	e := a.event("feedback.created", item, t, s.Name)
	e.To = "the owner"
	if lists, err := a.Docs.Lists(r.Context()); err == nil {
		if team, ok := lists.Team(t.Owner); ok {
			e.To, e.Contact = team.Name, team.Contact
		}
	}
	a.Notifier.Notify(r.Context(), e)
	writeJSON(w, 201, v.view(item))
}

func (a *api) event(kind string, it feedback.Item, t *docs.Target, actor string) notify.Event {
	page := "/#/p/"
	if it.TargetKind == docs.Standard {
		page = "/#/s/"
	}
	e := notify.Event{Type: kind, TargetKind: it.TargetKind, ProcessID: it.TargetID, Kind: it.Kind, Text: it.Text, Author: it.AuthorName, Actor: actor,
		URL: a.Cfg.BaseURL + page + it.TargetID + "/feedback"}
	if t != nil {
		e.ProcessTitle = t.Title
		e.StepTitle = t.Titles[it.ItemID]
	}
	return e
}

func (a *api) alsoHit(on bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s := who(r)
		it, err := a.Feedback.Get(r.Context(), r.PathValue("id"))
		if err == nil && strings.EqualFold(it.AuthorEmail, s.Email) {
			writeError(w, 400, "You reported this yourself.")
			return
		}
		if err == nil {
			it, err = a.Feedback.SetAlsoHit(r.Context(), it.ID, s.Email, on)
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		writeJSON(w, 200, a.viewer(r).view(it))
	}
}

func (a *api) resolveFeedback(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Resolved *bool `json:"resolved"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	if in.Resolved == nil {
		writeError(w, 400, `Send {"resolved": true} or {"resolved": false}.`)
		return
	}
	s := who(r)
	v := a.viewer(r)
	it, err := a.Feedback.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if !v.canManage(it.TargetKind, it.TargetID) {
		writeError(w, 403, "Only the people who own or edit this can do that.")
		return
	}
	wasOpen := it.ResolvedAt == nil
	it, err = a.Feedback.SetResolved(r.Context(), it.ID, *in.Resolved, s.Name)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if *in.Resolved != !wasOpen {
		action := "feedback.reopen"
		if *in.Resolved {
			action = "feedback.fixed"
		}
		a.record(r, action, it.TargetKind+" "+it.TargetID, "reported by "+it.AuthorEmail)
	}
	if *in.Resolved && wasOpen && !strings.EqualFold(it.AuthorEmail, s.Email) {
		e := a.event("feedback.resolved", it, v.target(it.TargetKind, it.TargetID), s.Name)
		e.To = it.AuthorEmail
		a.Notifier.Notify(r.Context(), e)
	}
	writeJSON(w, 200, v.view(it))
}

func (a *api) deleteFeedback(w http.ResponseWriter, r *http.Request) {
	s := who(r)
	it, err := a.Feedback.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if !strings.EqualFold(it.AuthorEmail, s.Email) && !a.viewer(r).canManage(it.TargetKind, it.TargetID) {
		writeError(w, 403, "You can only delete your own feedback.")
		return
	}
	if err := a.Feedback.Delete(r.Context(), it.ID); err != nil {
		a.fail(w, r, err)
		return
	}
	// removing what somebody else wrote is worth a trace; removing your own is not
	if !strings.EqualFold(it.AuthorEmail, s.Email) {
		a.record(r, "feedback.delete", it.TargetKind+" "+it.TargetID, "reported by "+it.AuthorEmail)
	}
	w.WriteHeader(http.StatusNoContent)
}
