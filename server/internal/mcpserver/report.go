package mcpserver

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/notify"
)

// ReportInput is what report_problem takes.
type ReportInput struct {
	TargetKind string `json:"targetKind" jsonschema:"process or standard"`
	TargetID   string `json:"targetId" jsonschema:"the id of the process or standard"`
	ItemID     string `json:"itemId,omitempty" jsonschema:"the step id (process) or requirement id (standard) the problem is about; leave out for the whole document"`
	Kind       string `json:"kind" jsonschema:"broken (does not work), outdated (no longer true), unclear (hard to follow) or idea (a suggestion)"`
	Text       string `json:"text" jsonschema:"what happened, in a sentence or two, 3 to 2000 characters, written for the owning team"`
}

// Report is the stored feedback.
type Report struct {
	ID         string    `json:"id"`
	TargetKind string    `json:"targetKind"`
	TargetID   string    `json:"targetId"`
	ItemID     string    `json:"itemId,omitempty"`
	Kind       string    `json:"kind"`
	Author     string    `json:"author" jsonschema:"the email of the person it was filed for"`
	CreatedAt  time.Time `json:"createdAt"`
	NotifiedTo string    `json:"notifiedTo" jsonschema:"the team that was told"`
	Link       string    `json:"link,omitempty" jsonschema:"where the owners see it in the portal"`
}

func (s *Server) addReport(srv *mcp.Server) {
	f := false
	tool(s, srv, &mcp.Tool{
		Name:        "report_problem",
		Annotations: &mcp.ToolAnnotations{Title: "Report a problem", DestructiveHint: &f, OpenWorldHint: &f},
		Description: "File feedback about a process or standard (or one step or requirement of it) on behalf of the person you act for, the same as the flag in the portal: " +
			"the owning team is told and sees it with that person as the author. Use it when a step does not work, something is outdated or unclear, or for a suggestion. " +
			"Say what happened in plain words. Each person can report at most " + strconv.Itoa(feedback.MaxPerHour) + " items an hour, in the portal and through agents together.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in ReportInput) (Report, string, error) {
		var h = req.Extra
		who := actor{}
		if h != nil {
			who = s.person(h.Header)
		}
		if who.Email == "" { // the tool is not listed then; a call all the same is refused
			return Report{}, "", problem("Reporting a problem needs the person you act for: send the " + HeaderPerson + " header together with the shared secret.")
		}
		out, err := s.report(ctx, who, in)
		if err != nil {
			return Report{}, "", err
		}
		text := "Reported to " + out.NotifiedTo + " on behalf of " + who.Email + "."
		return out, text, nil
	})
}

func (s *Server) report(ctx context.Context, who actor, in ReportInput) (Report, error) {
	kind := strings.TrimSpace(in.TargetKind)
	if kind == "" {
		kind = docs.Process
	}
	if kind != docs.Process && kind != docs.Standard {
		return Report{}, problem("targetKind must be process or standard.")
	}
	id, item := strings.TrimSpace(in.TargetID), strings.TrimSpace(in.ItemID)
	what, part := "process", "step"
	if kind == docs.Standard {
		what, part = "standard", "requirement"
	}
	// the same checks as feedback in the portal (httpapi/feedback.go)
	var t docs.Target
	found := false
	if docs.ValidID(id) {
		if d, err := s.o.Docs.Get(ctx, kind, id); err == nil {
			t, found = docs.TargetOf(d)
		} else if !errors.Is(err, docs.ErrNotFound) {
			return Report{}, err
		}
	}
	text, textProblem := docs.CheckText(in.Text, "The text", true)
	switch {
	case !found || t.Status == "draft":
		return Report{}, notFound(kind, id)
	case item != "" && t.Items[item] == "":
		return Report{}, problemf("The %s “%s” has no %s “%s”. Use get_%s to see the ids of its %ss.", what, id, part, item, what, part)
	case !feedback.ValidKind(in.Kind):
		return Report{}, problem("Choose what kind of problem this is: " + strings.Join(feedback.Kinds, ", ") + ".")
	case textProblem != "":
		return Report{}, problem(textProblem)
	case utf8.RuneCountInString(text) < 3:
		return Report{}, problem("Say in a sentence what happened.")
	case utf8.RuneCountInString(text) > 2000:
		return Report{}, problem("Keep the text under 2000 characters.")
	}
	// the limit per person is shared with the portal, and counted under a lock of the person
	it, err := s.o.Feedback.Report(ctx, feedback.New{
		TargetKind: kind, TargetID: id, ItemID: item, Kind: in.Kind, Text: text,
		AuthorEmail: who.Email, AuthorName: who.Name, ItemHash: t.Items[item],
	})
	if errors.Is(err, feedback.ErrTooMany) {
		return Report{}, problem("This person has reported a lot in the last hour. Try again later.")
	}
	if errors.Is(err, feedback.ErrNoTarget) { // deleted in between
		return Report{}, notFound(kind, id)
	}
	if err != nil {
		return Report{}, err
	}
	s.o.Log.Info("problem reported by an agent", "target", kind+" "+id)

	// tell the owning team, as the portal does
	page := "/#/p/"
	if kind == docs.Standard {
		page = "/#/s/"
	}
	link := ""
	if s.o.BaseURL != "" {
		link = s.o.BaseURL + page + id + "/feedback"
	}
	e := notify.Event{Type: "feedback.created", TargetKind: kind, ProcessID: id, ProcessTitle: t.Title, StepTitle: t.Titles[item], Kind: it.Kind, Text: it.Text,
		Author: it.AuthorName, Actor: it.AuthorName, To: "the owner", URL: link}
	if lists, err := s.o.Docs.Lists(ctx); err == nil {
		if team, ok := lists.Team(t.Owner); ok {
			e.To, e.Contact = team.Name, team.Reach()
		}
	}
	s.o.Notifier.Notify(ctx, e)
	return Report{ID: it.ID, TargetKind: kind, TargetID: id, ItemID: item, Kind: it.Kind, Author: it.AuthorEmail, CreatedAt: it.CreatedAt, NotifiedTo: e.To, Link: link}, nil
}
