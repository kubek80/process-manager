package content

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const sample = `{"schemaVersion":"1.0","id":"request-vpn","title":"Request VPN","owner":"network-team","zebra":1,"alpha":2,
 "steps":[{"id":"raise","title":"Raise it","actor":"me","type":"form","next":[{"to":"done"}]},{"id":"done","title":"Done","actor":"me","type":"verify","next":[]}]}`

func newStore(t *testing.T) *Store {
	t.Helper()
	return &Store{Dir: t.TempDir()}
}

func TestEmptyStore(t *testing.T) {
	s := newStore(t)
	list, broken, err := s.Processes()
	if err != nil || len(list) != 0 || len(broken) != 0 {
		t.Fatalf("got %v %v %v", list, broken, err)
	}
	cat, err := s.Catalog()
	if err != nil || !strings.Contains(string(cat), `"teams":[]`) {
		t.Fatalf("got %s %v", cat, err)
	}
	if _, ok := s.Info("request-vpn"); ok {
		t.Fatal("missing process reported as present")
	}
	if _, ok := s.Team("network-team"); ok {
		t.Fatal("missing team reported as present")
	}
}

func TestPutProcessKeepsKeyOrderAndFormats(t *testing.T) {
	s := newStore(t)
	if err := s.PutProcess("request-vpn", []byte(sample)); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(filepath.Join(s.Dir, "processes", "request-vpn.json"))
	text := string(data)
	if !strings.HasSuffix(text, "}\n") || !strings.Contains(text, "\n  \"id\": \"request-vpn\"") {
		t.Fatalf("not pretty printed:\n%s", text)
	}
	if strings.Index(text, `"zebra"`) > strings.Index(text, `"alpha"`) {
		t.Fatal("key order was changed")
	}
	if _, err := os.Stat(filepath.Join(s.Dir, "processes", "request-vpn.json.tmp")); err == nil {
		t.Fatal("temporary file left behind")
	}
	list, broken, err := s.Processes()
	if err != nil || len(list) != 1 || len(broken) != 0 {
		t.Fatalf("got %d %v %v", len(list), broken, err)
	}
}

func TestPutProcessRejects(t *testing.T) {
	s := newStore(t)
	cases := map[string][2]string{
		"bad id":        {"../etc/passwd", sample},
		"upper case id": {"Request-VPN", sample},
		"id mismatch":   {"other-id", sample},
		"not json":      {"request-vpn", "{nope"},
		"not an object": {"request-vpn", `["request-vpn"]`},
		"empty":         {"", sample},
		"trailing dash": {"request-", sample},
		"very long id":  {strings.Repeat("a", 81), sample},
	}
	for name, c := range cases {
		if err := s.PutProcess(c[0], []byte(c[1])); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: want ErrInvalid, got %v", name, err)
		}
	}
	if entries, _ := os.ReadDir(filepath.Join(s.Dir, "processes")); len(entries) != 0 {
		t.Fatalf("rejected input wrote files: %v", entries)
	}
}

func TestProcessesReportsBrokenFilesAndSkipsOthers(t *testing.T) {
	s := newStore(t)
	dir := filepath.Join(s.Dir, "processes")
	os.MkdirAll(filepath.Join(dir, "sub.json"), 0o755)
	os.WriteFile(filepath.Join(dir, "b.json"), []byte(sample), 0o644)
	os.WriteFile(filepath.Join(dir, "a.json"), []byte("{broken"), 0o644)
	os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("hi"), 0o644)
	list, broken, err := s.Processes()
	if err != nil || len(list) != 1 || len(broken) != 1 || broken[0].File != "a.json" {
		t.Fatalf("got %d %+v %v", len(list), broken, err)
	}
}

func TestDeleteProcess(t *testing.T) {
	s := newStore(t)
	s.PutProcess("request-vpn", []byte(sample))
	if err := s.DeleteProcess("request-vpn"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteProcess("request-vpn"); err != nil {
		t.Fatalf("deleting twice must be fine: %v", err)
	}
	if err := s.DeleteProcess("../x"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
}

func TestCatalogAndTeam(t *testing.T) {
	s := newStore(t)
	if err := s.PutCatalog([]byte(`{"tiers":[],"languages":[],"teams":[{"id":"network-team","name":"Network team","contact":"Slack #network"}],"tools":[]}`)); err != nil {
		t.Fatal(err)
	}
	team, ok := s.Team("network-team")
	if !ok || team.Name != "Network team" || team.Contact != "Slack #network" {
		t.Fatalf("got %+v %v", team, ok)
	}
	if _, ok := s.Team("nobody"); ok {
		t.Fatal("unknown team found")
	}
	if _, ok := s.Team(""); ok {
		t.Fatal("empty team id found")
	}
	if err := s.PutCatalog([]byte(`[1,2]`)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("want ErrInvalid, got %v", err)
	}
	os.WriteFile(filepath.Join(s.Dir, "catalog", "catalog.json"), []byte("{broken"), 0o644)
	if _, err := s.Catalog(); err == nil {
		t.Fatal("broken catalog must be an error")
	}
	if _, ok := s.Team("network-team"); ok {
		t.Fatal("team found in a broken catalog")
	}
}

func TestInfoAndStepFingerprint(t *testing.T) {
	s := newStore(t)
	s.PutProcess("request-vpn", []byte(sample))
	info, ok := s.Info("request-vpn")
	if !ok || info.Title != "Request VPN" || info.Owner != "network-team" || len(info.Steps) != 2 || info.Titles["raise"] != "Raise it" {
		t.Fatalf("got %+v %v", info, ok)
	}
	before := info.Steps["raise"]

	// Reordering keys and reformatting must not change the fingerprint...
	reordered := strings.Replace(sample, `{"id":"raise","title":"Raise it","actor":"me"`, `{ "actor":"me",  "title":"Raise it","id":"raise"`, 1)
	s.PutProcess("request-vpn", []byte(reordered))
	info, _ = s.Info("request-vpn")
	if info.Steps["raise"] != before {
		t.Fatal("fingerprint changed although the step's content did not")
	}
	// ...but changing the content must, and only for that step.
	done := info.Steps["done"]
	s.PutProcess("request-vpn", []byte(strings.Replace(sample, "Raise it", "Raise the request", 1)))
	info, _ = s.Info("request-vpn")
	if info.Steps["raise"] == before || info.Steps["done"] != done {
		t.Fatal("fingerprint must change for the edited step only")
	}

	if _, ok := s.Info("../request-vpn"); ok {
		t.Fatal("unsafe id accepted")
	}
	os.WriteFile(filepath.Join(s.Dir, "processes", "bad.json"), []byte("{broken"), 0o644)
	if _, ok := s.Info("bad"); ok {
		t.Fatal("broken process reported as readable")
	}
}
