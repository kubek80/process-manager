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
	"time"
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
	hook := NewWebhook(srv.URL, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// the request that reported the feedback is over before the message is delivered
	ctx, cancel := context.WithCancel(context.Background())
	hook.Notify(ctx, created)
	cancel()
	hook.Wait()
	if contentType != "application/json" || got["text"] != created.Message() || got["type"] != "feedback.created" || got["processId"] != "request-gcp-project" {
		t.Fatalf("got %v (%s)", got, contentType)
	}
	// what people type cannot become chat markup
	loud := created
	loud.Text = "<!channel> look & see"
	hook.Notify(context.Background(), loud)
	hook.Wait()
	if text := got["text"].(string); strings.Contains(text, "<!channel>") || !strings.Contains(text, "&lt;!channel&gt; look &amp; see") {
		t.Fatalf("not escaped: %q", text)
	}
	if got["text"].(string) == loud.Text || got["kind"] != "broken" {
		t.Fatalf("event fields: %v", got)
	}
}

func TestWebhookTriesAgainWhenTheOtherSideIsDown(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(503)
		}
	}))
	defer srv.Close()
	var buf bytes.Buffer
	hook := NewWebhook(srv.URL, slog.New(slog.NewTextHandler(&buf, nil)))
	hook.Backoff = []time.Duration{0, 0}
	hook.Notify(context.Background(), created)
	hook.Wait()
	if calls != 3 || buf.Len() != 0 {
		t.Fatalf("%d calls, log: %s", calls, buf.String())
	}
	// a plain refusal is not tried again
	calls = -10
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++; w.WriteHeader(400) }))
	defer refusing.Close()
	hook.URL = refusing.URL
	hook.Notify(context.Background(), created)
	hook.Wait()
	if calls != -9 || !strings.Contains(buf.String(), "notification refused: status 400") {
		t.Fatalf("%d calls, log: %s", calls, buf.String())
	}
}

func TestWebhookFailuresAreLoggedNotReturned(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) }))
	defer refusing.Close()
	send := func(url string) {
		hook := NewWebhook(url, logger)
		hook.Backoff = nil
		hook.Notify(context.Background(), created)
		hook.Wait()
	}
	send(refusing.URL)
	if !strings.Contains(buf.String(), "notification refused") {
		t.Fatalf("refusal not logged: %s", buf.String())
	}
	buf.Reset()
	send("http://127.0.0.1:1/unreachable")
	if !strings.Contains(buf.String(), "notification not sent") {
		t.Fatalf("failure not logged: %s", buf.String())
	}
	buf.Reset()
	send("://bad")
	if !strings.Contains(buf.String(), "notification not sent") {
		t.Fatalf("bad URL not logged: %s", buf.String())
	}
}
