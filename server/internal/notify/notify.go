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
	"strings"
	"sync"
	"time"
)

// Event is one thing worth telling someone.
type Event struct {
	Type         string `json:"type"`       // "feedback.created" or "feedback.resolved"
	TargetKind   string `json:"targetKind"` // "process" or "standard"; the fields below keep their names for both
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
// this as is; other chat tools need a small relay. Sending happens in the background, so a
// slow chat tool never slows down the person who gives feedback.
type Webhook struct {
	URL    string
	Client *http.Client
	Logger *slog.Logger
	// Backoff is how long to wait before each further attempt after a failure.
	Backoff []time.Duration

	pending sync.WaitGroup
}

func NewWebhook(url string, logger *slog.Logger) *Webhook {
	return &Webhook{URL: url, Client: &http.Client{Timeout: 5 * time.Second}, Logger: logger, Backoff: []time.Duration{time.Second, 5 * time.Second}}
}

// escape keeps text that people typed from being read as chat markup: in Slack "<!channel>"
// would alert everyone.
var escape = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

func (w *Webhook) Notify(ctx context.Context, e Event) {
	body, _ := json.Marshal(struct {
		Text string `json:"text"`
		Event
	}{escape.Replace(e.Message()), e})
	// the request that caused the event may be over before this is delivered
	ctx = context.WithoutCancel(ctx)
	w.pending.Add(1)
	go func() {
		defer w.pending.Done()
		var last string
		for attempt := 0; ; attempt++ {
			retry, problem := w.post(ctx, body)
			if problem == "" {
				return
			}
			last = problem
			if !retry || attempt >= len(w.Backoff) {
				break
			}
			time.Sleep(w.Backoff[attempt])
		}
		w.Logger.Error(last, "type", e.Type, "to", e.To)
	}()
}

// post sends once. problem is empty on success; retry says whether trying again can help.
func (w *Webhook) post(ctx context.Context, body []byte) (retry bool, problem string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return false, "notification not sent: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := w.Client.Do(req)
	if err != nil {
		return true, "notification not sent: " + err.Error()
	}
	res.Body.Close()
	if res.StatusCode >= 300 {
		return res.StatusCode >= 500 || res.StatusCode == http.StatusTooManyRequests, fmt.Sprintf("notification refused: status %d", res.StatusCode)
	}
	return false, ""
}

// Wait returns when everything handed to Notify has been delivered or given up on.
func (w *Webhook) Wait() { w.pending.Wait() }
