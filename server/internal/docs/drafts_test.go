package docs_test

import (
	"bytes"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/docs"
)

func TestWhatADraftMustSatisfy(t *testing.T) {
	big := `{"id":"secure-logging","summary":"` + strings.Repeat("x", docs.MaxDraftBytes) + `"}`
	// as large as a sizeable published document, and larger once re-indented: fine
	wide := `{"id":"secure-logging","requirements":[` + strings.TrimSuffix(strings.Repeat(`{"id":"R","statement":"`+strings.Repeat("y", 200)+`"},`, 2000), ",") + `]}`
	deep := `{"id":"secure-logging","x":` + strings.Repeat("[", 5000) + strings.Repeat("]", 5000) + `}`
	deepEnough := `{"id":"secure-logging","x":` + strings.Repeat("[", docs.MaxDraftDepth-1) + strings.Repeat("]", docs.MaxDraftDepth-1) + `}`
	bracketsInText := `{"id":"secure-logging","x":"` + strings.Repeat("[{", 100) + `\"[["}`
	for _, c := range []struct {
		name, body, want string
	}{
		{"unfinished: no title, no requirements", `{"id":"secure-logging","requirements":[{"id":"","level":"nonsense"}]}`, ""},
		{"an array", `[{"id":"secure-logging"}]`, "The draft must be a whole process or standard in JSON."},
		{"null", `null`, "The draft must be a whole process or standard in JSON."},
		{"not JSON", `{"id":"secure-logging",`, "The draft must be a whole process or standard in JSON."},
		{"another id", `{"id":"other"}`, "The id in the draft must stay “secure-logging”."},
		{"an id that is not text", `{"id":7}`, "The id in the draft must stay “secure-logging”."},
		{"no id", `{"title":"x"}`, "The id in the draft must stay “secure-logging”."},
		{"NUL written out", `{"id":"secure-logging","title":"a\u0000b"}`, "The draft contains characters that cannot be stored. Remove them and try again."},
		{"NUL as a byte", "{\"id\":\"secure-logging\",\"title\":\"a\x00b\"}", "The draft must be a whole process or standard in JSON."},
		{"half a surrogate pair", `{"id":"secure-logging","title":"a\ud800b"}`, "The draft contains characters that cannot be stored. Remove them and try again."},
		{"the other half alone", `{"id":"secure-logging","title":"\udc00"}`, "The draft contains characters that cannot be stored. Remove them and try again."},
		{"not UTF-8", "{\"id\":\"secure-logging\",\"title\":\"\xff\"}", "The draft contains characters that cannot be stored. Remove them and try again."},
		{"a whole surrogate pair and escapes", `{"id":"secure-logging","title":"\ud83d\ude00 \\u0000 \" \\ \n"}`, ""},
		{"too large", big, "The draft is too large to save (more than 1 MB). Shorten it and try again."},
		{"large", wide, ""},
		{"deep", deep, "The draft has too many parts inside one another (more than 32 levels) to be saved."},
		{"deep enough", deepEnough, ""},
		{"brackets in a text", bracketsInText, ""},
	} {
		_, err := docs.CheckDraftBody("secure-logging", []byte(c.body))
		switch {
		case c.want == "" && err != nil:
			t.Errorf("%s: refused: %v", c.name, err)
		case c.want != "" && (!errors.Is(err, docs.ErrInvalid) || strings.TrimPrefix(err.Error(), "invalid: ") != c.want):
			t.Errorf("%s: %v, want %q", c.name, err, c.want)
		}
	}
}

func TestOnlyReviewDiffers(t *testing.T) {
	a := `{"id":"x","title":"T","review":{"intervalMonths":6,"lastReviewedAt":"2026-01-01"}}`
	if !docs.OnlyReviewDiffers([]byte(a), []byte(`{"title":"T","id":"x","review":{"intervalMonths":6,"lastReviewedAt":"2026-11-18","reviewedBy":"Casey"}}`)) {
		t.Error("a review confirmation (and another key order) counts as a real change")
	}
	if !docs.OnlyReviewDiffers([]byte(`{"id":"x"}`), []byte(`{"id":"x","review":{"intervalMonths":6}}`)) {
		t.Error("a first review counts as a real change")
	}
	if docs.OnlyReviewDiffers([]byte(a), []byte(strings.Replace(a, `"T"`, `"U"`, 1))) {
		t.Error("a changed title is not seen")
	}
}

func TestForPublishingKeepsThePublishedStatusAndReviewRecord(t *testing.T) {
	published := `{"id":"x","title":"Old","updatedAt":"2026-01-01","status":"deprecated","replacedBy":"y","review":{"intervalMonths":6,"lastReviewedAt":"2026-11-18","reviewedBy":"Casey"}}`
	for _, c := range []struct{ draft, want string }{
		// "status" in the draft is ignored: publishing neither un-retires nor hides; the review
		// record is the published one, the rhythm the draft's
		{`{"id":"x","title":"New","status":"active","review":{"intervalMonths":12}}`,
			`{"id":"x","title":"New","status":"deprecated","review":{"intervalMonths":12,"lastReviewedAt":"2026-11-18","reviewedBy":"Casey"}}`},
		{`{"id":"x","title":"New","status":"draft","review":{"reviewedBy":"Me","intervalMonths":3,"lastReviewedAt":"2020-01-01"}}`,
			`{"id":"x","title":"New","status":"deprecated","review":{"reviewedBy":"Casey","intervalMonths":3,"lastReviewedAt":"2026-11-18"}}`},
		// no review in the draft: the record is not lost
		{`{"id":"x","title":"New","status":"draft"}`,
			`{"id":"x","title":"New","status":"deprecated","review":{"intervalMonths":6,"lastReviewedAt":"2026-11-18","reviewedBy":"Casey"}}`},
		// no status in the draft: it goes before the review, or after updatedAt
		{`{"id":"x","updatedAt":"2026-02-02","title":"New","review":{"intervalMonths":1}}`,
			`{"id":"x","updatedAt":"2026-02-02","title":"New","status":"deprecated","review":{"intervalMonths":1,"lastReviewedAt":"2026-11-18","reviewedBy":"Casey"}}`},
	} {
		got, err := docs.ForPublishing([]byte(c.draft), []byte(published))
		want, _ := docs.Pretty([]byte(c.want))
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s:\n%s\nwant\n%s (%v)", c.draft, got, want, err)
		}
	}
	// a published document without a status or a review record: the draft's review stays, minus
	// a record the draft made up
	got, err := docs.ForPublishing([]byte(`{"id":"x","status":"draft","title":"New","review":{"intervalMonths":2,"lastReviewedAt":"2020-01-01"}}`), []byte(`{"id":"x","review":{"intervalMonths":6}}`))
	want, _ := docs.Pretty([]byte(`{"id":"x","title":"New","review":{"intervalMonths":2}}`))
	if err != nil || !bytes.Equal(got, want) {
		t.Errorf("%s (%v)", got, err)
	}
	// a document that was never published: publishing makes it active
	got, err = docs.ForPublishing([]byte(`{"id":"x","status":"draft","title":"New"}`), []byte(`{"id":"x","status":"draft","title":"Old"}`))
	want, _ = docs.Pretty([]byte(`{"id":"x","status":"active","title":"New"}`))
	if err != nil || !bytes.Equal(got, want) {
		t.Errorf("never published: %s (%v)", got, err)
	}
	got, err = docs.ForPublishing([]byte(`{"id":"x","title":"New"}`), []byte(`{"id":"x"}`))
	want, _ = docs.Pretty([]byte(`{"id":"x","title":"New"}`))
	if err != nil || !bytes.Equal(got, want) {
		t.Errorf("%s (%v)", got, err)
	}
}

func TestWorkingDraftsInTheStore(t *testing.T) {
	s := newStore(t)
	var logged bytes.Buffer
	s.Log = slog.New(slog.NewTextHandler(&logged, nil))
	if _, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "alex@example.com"); err != nil {
		t.Fatal(err)
	}
	draft := strings.Replace(logging, "Secure logging", "Secure logging, revised", 1)

	// a draft of something that does not exist, or was never published
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "nothing", Body: []byte(`{"id":"nothing"}`), By: "a"}); !errors.Is(err, docs.ErrNotFound) {
		t.Fatalf("nothing: %v", err)
	}
	if _, _, err := s.Put(ctx, docs.Process, "request-vpn", []byte(strings.Replace(vpn, `"zebra"`, `"status":"draft","zebra"`, 1)), "a"); err != nil {
		t.Fatal(err)
	}
	// a never-published document has a working draft too: what cannot be stored as itself yet
	unfinished := strings.Replace(vpn, `"zebra"`, `"status":"draft","title":"","zebra"`, 1)
	nd, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Process, ID: "request-vpn", Body: []byte(unfinished), By: "a"})
	if err != nil || nd.Revision != 1 || nd.Base != 1 {
		t.Fatalf("never published: %+v %v", nd, err)
	}
	one, fixed := 1, []byte(strings.Replace(vpn, `"zebra"`, `"status":"draft","note":"fixed","zebra"`, 1))
	var dc0 *docs.DraftConflict
	// an ordinary save is refused while it exists; one that replaces it needs its revision
	var pending0 *docs.DraftPending
	if _, _, err := s.Save(ctx, docs.Change{Kind: docs.Process, ID: "request-vpn", Body: fixed, By: "a", Base: &one, Drafts: docs.RefuseIfDraft}); !errors.As(err, &pending0) || pending0.Status != "draft" {
		t.Fatalf("saved past the working draft: %v", err)
	}
	if _, _, err := s.Save(ctx, docs.Change{Kind: docs.Process, ID: "request-vpn", Body: fixed, By: "a", Base: &one, Drafts: docs.ReplaceDraft, Revision: 2}); !errors.As(err, &dc0) || dc0.Current.Revision != 1 {
		t.Fatalf("replaced a newer revision: %v", err)
	}
	two0 := 2
	if _, _, err := s.Save(ctx, docs.Change{Kind: docs.Process, ID: "request-vpn", Body: fixed, By: "a", Base: &two0, Drafts: docs.ReplaceDraft, Revision: 1}); !errors.As(err, new(*docs.Conflict)) {
		t.Fatalf("replaced on a version that does not exist: %v", err)
	}
	if _, err := s.GetDraft(ctx, docs.Process, "request-vpn"); err != nil {
		t.Fatalf("a refused replace lost the draft: %v", err)
	}
	saved0, changed0, err := s.Save(ctx, docs.Change{Kind: docs.Process, ID: "request-vpn", Body: fixed, By: "a", Base: &one, Drafts: docs.ReplaceDraft, Revision: 1})
	if err != nil || !changed0 || saved0.Version != 2 || docs.StatusOf(saved0.Body) != "draft" {
		t.Fatalf("replace: %+v %v %v", saved0, changed0, err)
	}
	if _, err := s.GetDraft(ctx, docs.Process, "request-vpn"); !errors.Is(err, docs.ErrNotFound) {
		t.Fatalf("the replaced draft is still there: %v", err)
	}
	if _, _, err := s.Save(ctx, docs.Change{Kind: docs.Process, ID: "request-vpn", Body: fixed, By: "a", Base: &two0, Drafts: docs.ReplaceDraft, Revision: 1}); !errors.As(err, &dc0) || dc0.Current != nil {
		t.Fatalf("replaced twice: %v", err)
	}

	d, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "alex@example.com", ByName: "Alex Editor"})
	if err != nil || d.Revision != 1 || d.Base != 1 || d.UpdatedBy != "alex@example.com" || d.UpdatedByName != "Alex Editor" {
		t.Fatalf("start: %+v %v", d, err)
	}
	if got, _ := s.GetDraft(ctx, docs.Standard, "secure-logging"); got.UpdatedByName != "Alex Editor" {
		t.Fatalf("name not kept: %+v", got)
	}
	// the published document is untouched
	if cur, _ := s.Get(ctx, docs.Standard, "secure-logging"); cur.Version != 1 || strings.Contains(string(cur.Body), "revised") {
		t.Fatalf("the published document changed: %s", cur.Body)
	}
	if h, _ := s.History(ctx, docs.Standard, "secure-logging"); len(h) != 1 {
		t.Fatalf("the draft made a version: %+v", h)
	}
	if all, _ := s.Drafts(ctx, docs.Standard); len(all) != 1 || all["secure-logging"].UpdatedBy != "alex@example.com" || all["secure-logging"].UpdatedByName != "Alex Editor" {
		t.Fatalf("drafts: %+v", all)
	}
	// starting a second one, or saving from an old revision, is a conflict
	var dc *docs.DraftConflict
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "sam@example.com"}); !errors.As(err, &dc) || dc.Current.Revision != 1 {
		t.Fatalf("second start: %v", err)
	}
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "a", Revision: 5}); !errors.As(err, &dc) {
		t.Fatalf("old revision: %v", err)
	}
	// a check that refuses changes nothing
	refuse := errors.New("no")
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "a", Revision: 1, Check: func(docs.Doc) error { return refuse }}); !errors.Is(err, refuse) {
		t.Fatalf("check: %v", err)
	}

	// an import keeps the draft (its base stays: publishing it meets the newer version) and says so
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "standards"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "standards", "secure-logging.json"), []byte(strings.Replace(logging, "No PII", "No personal data", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	if n, problems, err := s.ImportDir(ctx, dir, "import", nil); err != nil || n != 1 || len(problems) > 0 {
		t.Fatal(n, problems, err)
	}
	if !strings.Contains(logged.String(), "imported over a document that has unpublished changes") {
		t.Fatalf("not logged: %s", logged.String())
	}
	d, err = s.GetDraft(ctx, docs.Standard, "secure-logging")
	if err != nil || d.Base != 1 || d.Revision != 1 {
		t.Fatalf("after the import: %+v %v", d, err)
	}
	// moving onto the current version must name the current version
	var c *docs.Conflict
	one, two := 1, 2
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "a", Revision: 1, Base: &one}); !errors.As(err, &c) || c.Current.Version != 2 {
		t.Fatalf("stale base: %v", err)
	}
	if d, err = s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "a", Revision: 1, Base: &two}); err != nil || d.Base != 2 || d.Revision != 2 {
		t.Fatalf("moved on: %+v %v", d, err)
	}

	// people's saves are refused while it exists; the review-like saves (KeepDraft) are not
	var pending *docs.DraftPending
	_, _, err = s.Save(ctx, docs.Change{Kind: docs.Standard, ID: "secure-logging", Body: []byte(strings.Replace(logging, `"active"`, `"draft"`, 1)), By: "b", Drafts: docs.RefuseIfDraft})
	if !errors.As(err, &pending) || pending.Status != "active" || pending.NewStatus != "draft" || pending.Draft.UpdatedBy != "a" {
		t.Fatalf("unpublish: %v", err)
	}

	// publishing: the right revision only, removed in the same transaction
	pub := []byte(strings.Replace(logging, "Secure logging", "Secure logging, revised", 1))
	if _, _, err := s.Save(ctx, docs.Change{Kind: docs.Standard, ID: "secure-logging", Body: pub, By: "a", Base: &two, Drafts: docs.PublishDraft, Revision: 1}); !errors.As(err, &dc) || dc.Current.Revision != 2 {
		t.Fatalf("publish an old revision: %v", err)
	}
	saved, changed, err := s.Save(ctx, docs.Change{Kind: docs.Standard, ID: "secure-logging", Body: pub, By: "a", Base: &two, Drafts: docs.PublishDraft, Revision: 2})
	if err != nil || !changed || saved.Version != 3 {
		t.Fatalf("publish: %+v %v %v", saved, changed, err)
	}
	if _, err := s.GetDraft(ctx, docs.Standard, "secure-logging"); !errors.Is(err, docs.ErrNotFound) {
		t.Fatalf("the draft is still there: %v", err)
	}
	if _, _, err := s.Save(ctx, docs.Change{Kind: docs.Standard, ID: "secure-logging", Body: pub, By: "a", Drafts: docs.PublishDraft, Revision: 2}); !errors.As(err, &dc) || dc.Current != nil {
		t.Fatalf("published twice: %v", err)
	}

	// an import that makes the document unpublished keeps the draft: a never-published document
	// has one too
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "a"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(strings.Replace(logging, `"active"`, `"draft"`, 1)), "import"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetDraft(ctx, docs.Standard, "secure-logging"); err != nil {
		t.Fatalf("dropped on an unpublished document: %v", err)
	}

	// discarding: the right revision only
	if _, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "import"); err != nil {
		t.Fatal(err)
	}
	if err := s.DiscardDraft(ctx, docs.Standard, "secure-logging", 7, nil, nil); !errors.As(err, &dc) {
		t.Fatalf("discard an old revision: %v", err)
	}
	if err := s.DiscardDraft(ctx, docs.Standard, "secure-logging", 1, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.DiscardDraft(ctx, docs.Standard, "secure-logging", 1, nil, nil); !errors.As(err, &dc) || dc.Current != nil {
		t.Fatalf("discarded twice: %v", err)
	}

	// deleting the document deletes its draft
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(draft), By: "a"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, docs.Standard, "secure-logging", "a"); err != nil {
		t.Fatal(err)
	}
	if all, _ := s.Drafts(ctx, docs.Standard); len(all) != 0 {
		t.Fatalf("left behind: %+v", all)
	}
	// who deleted it, when, and what it was
	del, err := s.LastDeleted(ctx, docs.Standard, "secure-logging")
	if err != nil || del.By != "a" || del.At.IsZero() || !strings.Contains(string(del.Last), "Secure logging") {
		t.Fatalf("last deleted: %+v %v", del, err)
	}
	if _, err := s.LastDeleted(ctx, docs.Process, "request-vpn"); !errors.Is(err, docs.ErrNotFound) {
		t.Fatalf("never deleted: %v", err)
	}
	if _, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LastDeleted(ctx, docs.Standard, "secure-logging"); !errors.Is(err, docs.ErrNotFound) {
		t.Fatalf("exists again: %v", err)
	}
}

func TestCreatedAtIsWhenTheDocumentWasAdded(t *testing.T) {
	s := newStore(t)
	first, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "a")
	if err != nil || first.CreatedAt.IsZero() || time.Since(first.CreatedAt) > time.Minute {
		t.Fatalf("%+v %v", first, err)
	}
	time.Sleep(10 * time.Millisecond)
	second, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(strings.Replace(logging, "No PII", "No personal data", 1)), "a")
	if err != nil || !second.CreatedAt.Equal(first.CreatedAt) || !second.UpdatedAt.After(first.UpdatedAt) {
		t.Fatalf("a new version changed when it was added: %+v", second)
	}
	list, _ := s.List(ctx, docs.Standard)
	if len(list) != 1 || !list[0].CreatedAt.Equal(first.CreatedAt) {
		t.Fatalf("list: %+v", list)
	}
	// deleted and created again: added anew
	if err := s.Delete(ctx, docs.Standard, "secure-logging", "a"); err != nil {
		t.Fatal(err)
	}
	again, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "a")
	if err != nil || !again.CreatedAt.After(first.CreatedAt) {
		t.Fatalf("again: %+v %v", again, err)
	}
}

func TestADraftCanBeStartedOnAnOlderVersion(t *testing.T) {
	s := newStore(t)
	for _, title := range []string{"One", "Two", "Three"} {
		if _, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(strings.Replace(logging, "Secure logging", title, 1)), "a"); err != nil {
			t.Fatal(err)
		}
	}
	at := func(n int) *int { return &n }
	var c *docs.Conflict
	// later than the current version: the ordinary conflict
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(logging), By: "a", Base: at(4)}); !errors.As(err, &c) || c.Current.Version != 3 {
		t.Fatalf("later: %v", err)
	}
	// not a version of it
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(logging), By: "a", Base: at(0)}); !errors.Is(err, docs.ErrInvalid) {
		t.Fatalf("version 0: %v", err)
	}
	d, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(logging), By: "a", Base: at(2)})
	if err != nil || d.Base != 2 || d.Revision != 1 {
		t.Fatalf("older: %+v %v", d, err)
	}
	// moving an existing draft must name the current version, as before
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(logging), By: "a", Revision: 1, Base: at(2)}); !errors.As(err, &c) {
		t.Fatalf("move to an older one: %v", err)
	}
	// publishing it meets the newer version
	if _, _, err := s.Save(ctx, docs.Change{Kind: docs.Standard, ID: "secure-logging", Body: []byte(logging), By: "a", Base: at(d.Base), Drafts: docs.PublishDraft, Revision: 1}); !errors.As(err, &c) || c.Current.Version != 3 {
		t.Fatalf("publish: %v", err)
	}
	if err := s.DiscardDraft(ctx, docs.Standard, "secure-logging", 1, nil, nil); err != nil {
		t.Fatal(err)
	}
	// versions from before a deletion belong to another document
	if err := s.Delete(ctx, docs.Standard, "secure-logging", "a"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveDraft(ctx, docs.DraftChange{Kind: docs.Standard, ID: "secure-logging", Body: []byte(logging), By: "a", Base: at(2)}); !errors.Is(err, docs.ErrInvalid) {
		t.Fatalf("before the deletion: %v", err)
	}
}
