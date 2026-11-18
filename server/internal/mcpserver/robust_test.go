package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
)

func TestAProviderThatHangsGivesWayToWords(t *testing.T) {
	ix := &fakeIndex{on: true, hang: true}
	e := setup(t, "", ix, func(o *Options) { o.MeaningTimeout = 200 * time.Millisecond })
	cs := e.session(nil)
	var out SearchOutput
	start := time.Now()
	text := mustCall(t, cs, "search_processes", map[string]any{"query": "budget"}, &out)
	if time.Since(start) > 5*time.Second {
		t.Fatalf("took %s", time.Since(start))
	}
	if out.RankedBy != "words-fallback" || out.Total != 1 || !strings.Contains(out.Note, "did not answer in time") || !strings.Contains(text, "did not answer in time") {
		t.Fatalf("%s %+v", text, out)
	}
}

func TestEveryCallIsAnsweredWithinItsDeadline(t *testing.T) {
	e := setup(t, "", nil, func(o *Options) { o.CallTimeout = 200 * time.Millisecond })
	tool(e.srv, e.srv.readOnly, &mcp.Tool{Name: "stuck"}, func(context.Context, *mcp.CallToolRequest, struct{}) (struct{}, string, error) {
		select {} // ignores its context
	})
	start := time.Now()
	text, refused := call(t, e.session(nil), "stuck", nil, nil)
	if !refused || text != "That took too long. Try again, or narrow it down." || time.Since(start) > 5*time.Second {
		t.Fatalf("%v %q after %s", refused, text, time.Since(start))
	}
}

func TestAToolThatPanicsDoesNotTakeTheServerDown(t *testing.T) {
	e := setup(t, "", nil)
	tool(e.srv, e.srv.readOnly, &mcp.Tool{Name: "broken"}, func(_ context.Context, _ *mcp.CallToolRequest, in struct {
		Secret string `json:"secret"`
	}) (struct{}, string, error) {
		var m map[string]int
		m["boom"]++ // a nil map
		return struct{}{}, "", nil
	})
	cs := e.session(nil)
	text, refused := call(t, cs, "broken", map[string]any{"secret": "do-not-log-me"}, nil)
	if !refused || text != "Something went wrong on the server. Try again later." {
		t.Fatalf("%v %q", refused, text)
	}
	logged := e.log.String()
	if !strings.Contains(logged, "tool failed unexpectedly") || !strings.Contains(logged, "tool=broken") || strings.Contains(logged, "do-not-log-me") {
		t.Fatalf("%s", logged)
	}
	// still serving
	mustCall(t, cs, "get_catalog", nil, &Catalog{})
}

func TestTruncatedSearchSaysAtLeast(t *testing.T) {
	ix := &fakeIndex{on: true, truncated: true, found: []Found{{Kind: docs.Process, ID: "request-gcp-project", Score: 0.9}}}
	e := setup(t, "", ix)
	var out SearchOutput
	text := mustCall(t, e.session(nil), "search_processes", map[string]any{"query": "project"}, &out)
	if !out.AtLeast || out.Total != 1 || !strings.HasPrefix(text, "At least 1 active process match") {
		t.Fatalf("%s %+v", text, out)
	}
	ix.set(func(f *fakeIndex) { f.truncated = false })
	mustCall(t, e.session(nil), "search_processes", map[string]any{"query": "project"}, &out)
	if out.AtLeast {
		t.Fatalf("%+v", out)
	}
}

func TestSearchesThatUseTheProviderAreBraked(t *testing.T) {
	ix := &fakeIndex{on: true}
	e := setup(t, testSecret, ix, func(o *Options) { o.SearchesPerMinute = 3 })
	sam := e.session(e.authorised("sam@example.com"))
	for range 3 {
		mustCall(t, sam, "search_standards", map[string]any{"query": "logs"}, nil)
	}
	text, refused := call(t, sam, "search_processes", map[string]any{"query": "budget"}, nil)
	if !refused || !strings.HasPrefix(text, "Too many searches in the last minute (at most 3). Try again in ") || !strings.HasSuffix(text, " seconds.") {
		t.Fatalf("%v %q", refused, text)
	}
	// without a query, or without search by meaning, nothing is sent to the provider: no brake
	mustCall(t, sam, "search_processes", map[string]any{"platform": "akamai"}, nil)
	// another person has their own allowance; without a person it is the caller's address
	mustCall(t, e.session(e.authorised("alex@example.com")), "search_processes", map[string]any{"query": "budget"}, nil)
	anon := e.session(e.authorised(""))
	for range 3 {
		mustCall(t, anon, "search_processes", map[string]any{"query": "budget"}, nil)
	}
	if _, refused := call(t, anon, "search_processes", map[string]any{"query": "budget"}, nil); !refused {
		t.Fatal("the address was not braked")
	}
	// the window passes
	b := newBrake(1, time.Minute)
	now := time.Now()
	if ok, _ := b.allow("x", now); !ok {
		t.Fatal("first")
	}
	if ok, wait := b.allow("x", now.Add(10*time.Second)); ok || wait != 50*time.Second {
		t.Fatalf("%v %s", ok, wait)
	}
	if ok, _ := b.allow("x", now.Add(time.Minute)); !ok {
		t.Fatal("after a minute")
	}
}

func TestTheSchemeOfTheSecretIsCaseInsensitive(t *testing.T) {
	e := setup(t, testSecret, nil)
	for _, scheme := range []string{"Bearer", "bearer", "BEARER"} {
		if _, err := e.connect(map[string]string{"Authorization": scheme + " " + testSecret}); err != nil {
			t.Fatalf("%s: %v", scheme, err)
		}
	}
	if _, err := e.connect(map[string]string{"Authorization": "Basic " + testSecret}); err == nil {
		t.Fatal("another scheme was accepted")
	}
}

func TestOnlyPeopleOfTheSignInDomainsAndTheirNamesTamed(t *testing.T) {
	e := setup(t, testSecret, nil, func(o *Options) { o.EmailDomains = []string{"Example.com"} })
	// another domain: refused
	h := e.authorised("ceo@elsewhere.org")
	if _, err := e.connect(h); err == nil {
		t.Fatal("a person of another domain was accepted")
	}
	// a name that is not one line, or too long, gives way to the part before the @
	report := func(name string) feedback.Item {
		t.Helper()
		h := e.authorised("Sam.Consumer@EXAMPLE.com")
		h[HeaderPersonName] = name
		var r Report
		mustCall(t, e.session(h), "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "idea", "text": "A checklist would help."}, &r)
		it, err := e.fb.Get(context.Background(), r.ID)
		if err != nil {
			t.Fatal(err)
		}
		return it
	}
	if it := report("Sam Consumer"); it.AuthorName != "Sam Consumer" || it.AuthorEmail != "sam.consumer@example.com" {
		t.Fatalf("%+v", it)
	}
	for _, bad := range []string{"", "   ", strings.Repeat("Very important person ", 5), "Sam ‮(verified)", "Sam\u0007"} {
		if it := report(bad); it.AuthorName != "sam.consumer" {
			t.Fatalf("%q: %q", bad, it.AuthorName)
		}
	}
	// a header cannot hold a line break; the name check refuses control characters anyway
	if personName("Sam\nCEO", "sam@example.com") != "sam" {
		t.Fatal("a line break was kept")
	}
	if got := e.notes.events[0].Author; got != "Sam Consumer" {
		t.Fatalf("%q", got)
	}
}

func TestParallelReportsKeepTheLimit(t *testing.T) {
	e := setup(t, testSecret, nil)
	cs := e.session(e.authorised("sam@example.com"))
	const tries = 2 * feedback.MaxPerHour
	refused := make([]bool, tries)
	var wg sync.WaitGroup
	for i := range tries {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := cs.CallTool(context.Background(), &mcp.CallToolParams{Name: "report_problem", Arguments: map[string]any{
				"targetKind": "process", "targetId": "request-gcp-project", "kind": "broken", "text": fmt.Sprint("At once ", i)}})
			refused[i] = err != nil || res.IsError
		}()
	}
	wg.Wait()
	n := 0
	for _, r := range refused {
		if !r {
			n++
		}
	}
	if stored, _ := e.fb.Count(context.Background()); n != feedback.MaxPerHour || stored != feedback.MaxPerHour {
		t.Fatalf("%d answered as stored, %d stored", n, stored)
	}
}

func TestTheLogStaysQuietAndHoldsNoQueriesEmailsOrSecrets(t *testing.T) {
	ix := &fakeIndex{on: true, err: ErrIndexNotReady}
	e := setup(t, testSecret, ix)
	cs := e.session(e.authorised("sam@example.com"))
	for range 3 {
		mustCall(t, cs, "search_processes", map[string]any{"query": "supercalifragilistic"}, nil)
	}
	mustCall(t, cs, "report_problem", map[string]any{"targetKind": "process", "targetId": "request-gcp-project", "kind": "idea", "text": "A checklist would help."}, nil)
	logged := e.log.String()
	for _, secret := range []string{"supercalifragilistic", "sam@example.com", testSecret} {
		if strings.Contains(logged, secret) {
			t.Fatalf("%q was logged:\n%s", secret, logged)
		}
	}
	var info []string
	for _, line := range strings.Split(logged, "\n") {
		if strings.Contains(line, "level=INFO") {
			info = append(info, line)
		}
	}
	// the SDK's lines per connection are debug; "not built yet" is said once at INFO
	if strings.Count(logged, "not built yet") != 3 || len(info) != 2 || !strings.Contains(info[0], "not built yet") || !strings.Contains(info[1], "problem reported") {
		t.Fatalf("INFO lines:\n%s", strings.Join(info, "\n"))
	}
	if !strings.Contains(logged, "level=DEBUG") {
		t.Fatal("the SDK logged nothing at debug")
	}
}

func TestWrongSecretAnswersAreTheSameForEveryScheme(t *testing.T) {
	e := setup(t, testSecret, nil)
	for _, auth := range []string{"bearer wrong", "BEARER  ", "Bearer"} {
		req, _ := http.NewRequest("POST", e.url+"/mcp", strings.NewReader(`{}`))
		req.Header.Set("Authorization", auth)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 401 {
			t.Fatalf("%q: %d", auth, res.StatusCode)
		}
	}
}
