package docs_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
)

var ctx = context.Background()

const vpn = `{"schemaVersion":"1.0","id":"request-vpn","title":"Request VPN","owner":"network-team","zebra":1,"alpha":2,
 "steps":[{"id":"raise","title":"Raise it","actor":"me","type":"form","next":[{"to":"done"}]},{"id":"done","title":"Done","actor":"me","type":"verify","next":[]}]}`
const logging = `{"schemaVersion":"1.0","id":"secure-logging","title":"Secure logging","owner":"security","status":"active",
 "requirements":[{"id":"SEC-LOG-01","title":"No secrets","level":"must","statement":"Never log secrets."},{"id":"SEC-LOG-02","title":"No PII","level":"must","statement":"Never log personal data."}]}`
const lists = `{"tiers":[{"id":"tier-0","name":"Tier 0"}],"environments":[{"id":"production","name":"Production"}],"languages":[],
 "teams":[{"id":"security","name":"Cyber Security","kind":"security","contact":"Slack #security"}],"tools":[{"id":"github","name":"GitHub","url":"https://github.example.com"}]}`

func newStore(t *testing.T) *docs.Store { return &docs.Store{Pool: dbtest.NewPool(t)} }

func TestPutKeepsKeyOrderAndVersions(t *testing.T) {
	s := newStore(t)
	d, changed, err := s.Put(ctx, docs.Process, "request-vpn", []byte(vpn), "alex@example.com")
	if err != nil || !changed || d.Version != 1 || d.UpdatedBy != "alex@example.com" || d.UpdatedAt.IsZero() {
		t.Fatalf("first save: %+v %v %v", d, changed, err)
	}
	text := string(d.Body)
	if !strings.Contains(text, "\n  \"id\": \"request-vpn\"") || strings.Index(text, `"zebra"`) > strings.Index(text, `"alpha"`) {
		t.Fatalf("must be re-indented with the key order kept:\n%s", text)
	}
	// the same content, formatted differently, is not a new version
	d, changed, err = s.Put(ctx, docs.Process, "request-vpn", []byte("  "+strings.ReplaceAll(vpn, ":", ": ")), "sam@example.com")
	if err != nil || changed || d.Version != 1 || d.UpdatedBy != "alex@example.com" {
		t.Fatalf("unchanged save: %+v %v %v", d, changed, err)
	}
	d, changed, _ = s.Put(ctx, docs.Process, "request-vpn", []byte(strings.Replace(vpn, "Request VPN", "Request VPN access", 1)), "casey@example.com")
	if !changed || d.Version != 2 || d.UpdatedBy != "casey@example.com" {
		t.Fatalf("second save: %+v", d)
	}
	got, err := s.Get(ctx, docs.Process, "request-vpn")
	if err != nil || got.Version != 2 || !strings.Contains(string(got.Body), "Request VPN access") {
		t.Fatalf("get: %+v %v", got, err)
	}
}

func TestPutRejects(t *testing.T) {
	s := newStore(t)
	cases := map[string][3]string{
		"bad id":             {docs.Process, "../etc/passwd", vpn},
		"upper case id":      {docs.Process, "Request-VPN", vpn},
		"id mismatch":        {docs.Process, "other-id", vpn},
		"not json":           {docs.Process, "request-vpn", "{nope"},
		"not an object":      {docs.Process, "request-vpn", `["request-vpn"]`},
		"unknown kind":       {"skill", "request-vpn", vpn},
		"catalog wrong id":   {docs.Catalog, "lists", lists},
		"very long id":       {docs.Process, strings.Repeat("a", 81), vpn},
		"catalog not object": {docs.Catalog, docs.CatalogID, `[]`},
	}
	for name, c := range cases {
		if _, _, err := s.Put(ctx, c[0], c[1], []byte(c[2]), "x"); !errors.Is(err, docs.ErrInvalid) {
			t.Errorf("%s: want ErrInvalid, got %v", name, err)
		}
	}
	if n, _ := s.Count(ctx); n != 0 {
		t.Fatalf("rejected input stored %d documents", n)
	}
}

func TestListGetDeleteAndHistory(t *testing.T) {
	s := newStore(t)
	s.Put(ctx, docs.Process, "request-vpn", []byte(vpn), "alex")
	s.Put(ctx, docs.Process, "a-first", []byte(strings.Replace(vpn, "request-vpn", "a-first", 1)), "alex")
	s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "riley")
	list, err := s.List(ctx, docs.Process)
	if err != nil || len(list) != 2 || list[0].ID != "a-first" {
		t.Fatalf("list: %+v %v", list, err)
	}
	if standards, _ := s.List(ctx, docs.Standard); len(standards) != 1 {
		t.Fatal("kinds must be kept apart")
	}
	if _, err := s.Get(ctx, docs.Process, "secure-logging"); !errors.Is(err, docs.ErrNotFound) {
		t.Fatalf("a standard is not a process: %v", err)
	}

	s.Put(ctx, docs.Process, "request-vpn", []byte(strings.Replace(vpn, "Raise it", "Raise the request", 1)), "casey")
	if err := s.Delete(ctx, docs.Process, "request-vpn", "dana"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, docs.Process, "request-vpn", "dana"); !errors.Is(err, docs.ErrNotFound) {
		t.Fatalf("deleting twice: %v", err)
	}
	// re-creating continues the numbering, so history stays in one line
	d, _, _ := s.Put(ctx, docs.Process, "request-vpn", []byte(vpn), "alex")
	if d.Version != 4 {
		t.Fatalf("version after delete and re-create: %d", d.Version)
	}
	h, err := s.History(ctx, docs.Process, "request-vpn")
	if err != nil || len(h) != 4 || h[0].Version != 4 || !h[1].Deleted || h[1].SavedBy != "dana" || h[3].SavedBy != "alex" {
		t.Fatalf("history: %+v %v", h, err)
	}
	old, err := s.VersionBody(ctx, docs.Process, "request-vpn", 2)
	if err != nil || !strings.Contains(string(old), "Raise the request") {
		t.Fatalf("version 2: %s %v", old, err)
	}
	for _, v := range []int{3, 99} { // the deletion marker and a version that never existed
		if _, err := s.VersionBody(ctx, docs.Process, "request-vpn", v); !errors.Is(err, docs.ErrNotFound) {
			t.Errorf("version %d: %v", v, err)
		}
	}
}

func TestListsAndNames(t *testing.T) {
	s := newStore(t)
	empty, err := s.Lists(ctx)
	if err != nil || len(empty.Teams) != 0 {
		t.Fatalf("no catalog yet: %+v %v", empty, err)
	}
	s.Put(ctx, docs.Catalog, docs.CatalogID, []byte(lists), "dana")
	l, err := s.Lists(ctx)
	if err != nil || len(l.Environments) != 1 {
		t.Fatalf("lists: %+v %v", l, err)
	}
	team, ok := l.Team("security")
	if !ok || team.Name != "Cyber Security" || team.Kind != "security" || team.Contact != "Slack #security" {
		t.Fatalf("team: %+v", team)
	}
	if _, ok := l.Team("nobody"); ok {
		t.Fatal("unknown team found")
	}
	if docs.Name(l.Tools, "github") != "GitHub" || docs.Name(l.Tools, "abacus") != "abacus" {
		t.Fatal("Name must fall back to the id")
	}
	if got := docs.Names(l.Tiers, []string{"tier-0", "tier-9"}); strings.Join(got, ",") != "Tier 0,tier-9" {
		t.Fatalf("names: %v", got)
	}
}

func TestTargetAndFingerprints(t *testing.T) {
	s := newStore(t)
	d, _, _ := s.Put(ctx, docs.Process, "request-vpn", []byte(vpn), "alex")
	target, ok := docs.TargetOf(d)
	if !ok || target.Title != "Request VPN" || target.Owner != "network-team" || len(target.Items) != 2 || target.Titles["raise"] != "Raise it" {
		t.Fatalf("process target: %+v", target)
	}
	before := target.Items["raise"]

	// reordering keys and reformatting must not change the fingerprint
	reordered := strings.Replace(vpn, `{"id":"raise","title":"Raise it","actor":"me"`, `{ "actor":"me",  "title":"Raise it","id":"raise"`, 1)
	d, _, _ = s.Put(ctx, docs.Process, "request-vpn", []byte(reordered), "alex")
	target, _ = docs.TargetOf(d)
	if target.Items["raise"] != before {
		t.Fatal("fingerprint changed although the step's content did not")
	}
	done := target.Items["done"]
	d, _, _ = s.Put(ctx, docs.Process, "request-vpn", []byte(strings.Replace(vpn, "Raise it", "Raise the request", 1)), "alex")
	target, _ = docs.TargetOf(d)
	if target.Items["raise"] == before || target.Items["done"] != done {
		t.Fatal("fingerprint must change for the edited step only")
	}

	std, _, _ := s.Put(ctx, docs.Standard, "secure-logging", []byte(logging), "riley")
	st, ok := docs.TargetOf(std)
	if !ok || st.Owner != "security" || st.Status != "active" || len(st.Items) != 2 || st.Titles["SEC-LOG-02"] != "No PII" {
		t.Fatalf("standard target: %+v", st)
	}
	cat, _, _ := s.Put(ctx, docs.Catalog, docs.CatalogID, []byte(lists), "dana")
	if _, ok := docs.TargetOf(cat); ok {
		t.Fatal("the catalog is not a feedback target")
	}
	if _, ok := docs.TargetOf(docs.Doc{Kind: docs.Process, Body: []byte(`[]`)}); ok {
		t.Fatal("an unparsable body is not a target")
	}
}

func TestImportAndExport(t *testing.T) {
	s := newStore(t)
	in := t.TempDir()
	write := func(rel, body string) {
		path := filepath.Join(in, rel)
		os.MkdirAll(filepath.Dir(path), 0o755)
		os.WriteFile(path, []byte(body), 0o644)
	}
	write("processes/request-vpn.json", vpn)
	write("processes/wrong-name.json", vpn) // the id inside does not match the file name
	write("processes/broken.json", "{nope")
	write("processes/notes.txt", "ignored")
	write("standards/secure-logging.json", logging)
	write("catalog/catalog.json", lists)

	n, problems, err := s.ImportDir(ctx, in, "import", nil)
	if err != nil || n != 3 || len(problems) != 2 {
		t.Fatalf("import: %d %v %v", n, problems, err)
	}
	if again, _, _ := s.ImportDir(ctx, in, "import", nil); again != 0 {
		t.Fatalf("importing the same files again changed %d documents", again)
	}
	if n, _, err := s.ImportDir(ctx, t.TempDir(), "import", nil); err != nil || n != 0 {
		t.Fatalf("empty folder: %d %v", n, err)
	}

	out := t.TempDir()
	os.MkdirAll(filepath.Join(out, "processes"), 0o755)
	os.WriteFile(filepath.Join(out, "processes", "gone.json"), []byte("{}"), 0o644) // a process deleted in the portal
	written, err := s.ExportDir(ctx, out)
	if err != nil || written != 3 {
		t.Fatalf("export: %d %v", written, err)
	}
	if _, err := os.Stat(filepath.Join(out, "processes", "gone.json")); err == nil {
		t.Fatal("export must remove files of documents that no longer exist")
	}
	data, _ := os.ReadFile(filepath.Join(out, "standards", "secure-logging.json"))
	if !strings.HasSuffix(string(data), "}\n") || !strings.Contains(string(data), `"id": "SEC-LOG-01"`) {
		t.Fatalf("exported file:\n%s", data)
	}
	// what was exported imports cleanly into an empty database
	fresh := newStore(t)
	if n, problems, _ := fresh.ImportDir(ctx, out, "import", nil); n != 3 || len(problems) != 0 {
		t.Fatalf("round trip: %d %v", n, problems)
	}
}
