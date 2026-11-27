package richtext_test

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/richtext"
)

type htmlCase struct{ HTML, Problem string }
type linkCase struct {
	Link      string
	Web, Href bool
}

func read[T any](t *testing.T, file string) []T {
	t.Helper()
	var doc struct{ Cases []T }
	b, err := os.ReadFile("testdata/" + file)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	return doc.Cases
}

// The shared cases (testdata/html.json, also read by the app's richText.test.ts): what may be
// stored, and every hostile input refused in exactly the words the app uses.
func TestSharedRichTextCases(t *testing.T) {
	cases := read[htmlCase](t, "html.json")
	if len(cases) < 60 {
		t.Fatalf("%d cases", len(cases))
	}
	for _, c := range cases {
		if got := richtext.Problem(c.HTML); got != c.Problem {
			t.Errorf("%q: got %q, want %q", c.HTML, got, c.Problem)
		}
	}
}

// The shared links (testdata/links.json): one rule for every link, on both sides.
func TestSharedLinkCases(t *testing.T) {
	for _, c := range read[linkCase](t, "links.json") {
		if got := richtext.WebLink(c.Link); got != c.Web {
			t.Errorf("WebLink(%q) = %v", c.Link, got)
		}
		if got := richtext.ValidHref(c.Link); got != c.Href {
			t.Errorf("ValidHref(%q) = %v", c.Link, got)
		}
	}
	// lengths are characters, not bytes
	long := "https://x.example/" + strings.Repeat("é", 1982)
	if !richtext.ValidHref(long) || richtext.ValidHref(long+"é") {
		t.Fatal("2000 characters, counted as characters")
	}
}

// The rule as a sentence of the lists, and the size.
func TestCheckSaysWhatAndWhere(t *testing.T) {
	what := "the service “DNS record change”"
	if got := richtext.Check("<script>x</script>", what); got != "The description of the service “DNS record change” contains a script, which cannot be shown: remove it, or paste the text again." {
		t.Fatalf("got %q", got)
	}
	long := "<p>" + strings.Repeat("a", richtext.MaxLength) + "</p>"
	if got := richtext.Check(long, what); !strings.HasPrefix(got, "Shorten the description of the service “DNS record change” to at most 20000 characters") {
		t.Fatalf("got %q", got)
	}
	if got := richtext.Check("<p>fine</p>", what); got != "" {
		t.Fatalf("got %q", got)
	}
	if got := richtext.Problem("<p>a\xffb</p>"); got != "characters that are not text" {
		t.Fatalf("got %q", got)
	}
}

func TestPlainText(t *testing.T) {
	in := `<h3>What you get</h3><p>A <strong>record</strong> &amp; a <a href="https://x.example">link</a>.</p><ul><li>one</li><li>two</li></ul><p>a<br>b</p>`
	if got := richtext.PlainText(in); got != "What you get\nA record & a link.\none\ntwo\na\nb" {
		t.Fatalf("got %q", got)
	}
	// whatever is stored: no script's text, no control character reaches an agent
	if got := richtext.PlainText("<script>alert(1)</script><p>o\x1b[31mk\x01</p>"); got != "o[31mk" {
		t.Fatalf("got %q", got)
	}
}
