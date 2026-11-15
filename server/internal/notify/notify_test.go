package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var created = Event{Type: "feedback.created", ProcessID: "request-gcp-project", ProcessTitle: "Request a GCP project", StepTitle: "Raise the request",
	Kind: "broken", Text: "Form renamed.", Author: "Sam", Actor: "Sam", To: "Cloud Platform team", Contact: "Slack #cloud-platform", URL: "http://pm/#/p/request-gcp-project/feedback"}

func TestMessage(t *testing.T) {
	m := created.Message()
	for _, want := range []string{"Cloud Platform team (Slack #cloud-platform)", "Request a GCP project › Raise the request", "[broken]", "from Sam", "Form renamed.", "http://pm/"} {
		if !strings.Contains(m, want) {
			t.Errorf("message %q lacks %q", m, want)
		}
	}
	resolved := created
	resolved.Type, resolved.Actor, resolved.StepTitle, resolved.Contact = "feedback.resolved", "Casey", "", ""
	m = resolved.Message()
	if !strings.HasPrefix(m, "Fixed: your feedback on “Request a GCP project” was marked as fixed by Casey.") {
		t.Errorf("resolved message: %q", m)
	}
}

func TestLogNotifier(t *testing.T) {
	var buf bytes.Buffer
	Log{Logger: slog.New(slog.NewTextHandler(&buf, nil))}.Notify(context.Background(), created)
	if !strings.Contains(buf.String(), "feedback.created") || !strings.Contains(buf.String(), "Form renamed.") {
		t.Fatalf("log output: %s", buf.String())
	}
}

func TestWebhookPostsTextAndEvent(t *testing.T) {
	var got map[string]any
	var contentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contentType = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &got)
	}))
	defer srv.Close()
	NewWebhook(srv.URL, slog.New(slog.NewTextHandler(io.Discard, nil))).Notify(context.Background(), created)
	if contentType != "application/json" || got["text"] != created.Message() || got["type"] != "feedback.created" || got["processId"] != "request-gcp-project" {
		t.Fatalf("got %v (%s)", got, contentType)
	}
}

func TestWebhookFailuresAreLoggedNotReturned(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }))
	defer refusing.Close()
	NewWebhook(refusing.URL, logger).Notify(context.Background(), created)
	if !strings.Contains(buf.String(), "notification refused") {
		t.Fatalf("refusal not logged: %s", buf.String())
	}
	buf.Reset()
	NewWebhook("http://127.0.0.1:1/unreachable", logger).Notify(context.Background(), created)
	if !strings.Contains(buf.String(), "notification not sent") {
		t.Fatalf("failure not logged: %s", buf.String())
	}
	buf.Reset()
	NewWebhook("://bad", logger).Notify(context.Background(), created)
	if !strings.Contains(buf.String(), "notification not sent") {
		t.Fatalf("bad URL not logged: %s", buf.String())
	}
}
