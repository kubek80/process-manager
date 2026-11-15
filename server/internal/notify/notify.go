// Package notify tells people about feedback: the owner team when something is reported,
// the reporter when it is fixed.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Event is one thing worth telling someone.
type Event struct {
	Type         string `json:"type"` // "feedback.created" or "feedback.resolved"
	ProcessID    string `json:"processId"`
	ProcessTitle string `json:"processTitle"`
	StepTitle    string `json:"stepTitle,omitempty"`
	Kind         string `json:"kind"`
	Text         string `json:"text"`
	Author       string `json:"author"` // who reported it
	Actor        string `json:"actor"`  // who caused this event
	To           string `json:"to"`     // owner team (created) or the reporter (resolved)
	Contact      string `json:"contact,omitempty"`
	URL          string `json:"url"`
}

// Message is the one-line, human-readable form.
func (e Event) Message() string {
	where := e.ProcessTitle
	if e.StepTitle != "" {
		where += " › " + e.StepTitle
	}
	if e.Type == "feedback.resolved" {
		return fmt.Sprintf("Fixed: your feedback on “%s” was marked as fixed by %s. %s", where, e.Actor, e.URL)
	}
	to := e.To
	if e.Contact != "" {
		to += " (" + e.Contact + ")"
	}
	return fmt.Sprintf("New feedback for %s on “%s” [%s] from %s: %s %s", to, where, e.Kind, e.Author, e.Text, e.URL)
}

// Notifier delivers events. Delivery problems must never fail the user's request.
type Notifier interface {
	Notify(ctx context.Context, e Event)
}

// Log writes events to the server log. The default, and what local development uses.
type Log struct{ Logger *slog.Logger }

func (l Log) Notify(_ context.Context, e Event) {
	l.Logger.Info("notification", "type", e.Type, "to", e.To, "message", e.Message())
}

// Webhook posts {"text": ...} plus the event fields to a URL. Slack incoming webhooks accept
// this as is; other chat tools need a small relay.
type Webhook struct {
	URL    string
	Client *http.Client
	Logger *slog.Logger
}

func NewWebhook(url string, logger *slog.Logger) Webhook {
	return Webhook{URL: url, Client: &http.Client{Timeout: 5 * time.Second}, Logger: logger}
}

func (w Webhook) Notify(ctx context.Context, e Event) {
	body, _ := json.Marshal(struct {
		Text string `json:"text"`
		Event
	}{e.Message(), e})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		w.Logger.Error("notification not sent", "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := w.Client.Do(req)
	if err != nil {
		w.Logger.Error("notification not sent", "error", err)
		return
	}
	res.Body.Close()
	if res.StatusCode >= 300 {
		w.Logger.Error("notification refused", "status", res.StatusCode)
	}
}
