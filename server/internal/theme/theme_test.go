package theme_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/theme"
)

var ctx = context.Background()

func TestParseKeepsOnlyWhatWasChosen(t *testing.T) {
	look, problems := theme.Parse([]byte(`{"name": " Acme ", "brand": "#AABBCC", "appearance": "device"}`))
	if len(problems) != 0 || look != (theme.Look{Name: "Acme", Brand: "#aabbcc", Appearance: "device"}) {
		t.Fatalf("%+v %v", look, problems)
	}
	if look, problems := theme.Parse([]byte(`{}`)); len(problems) != 0 || look != (theme.Look{}) {
		t.Fatalf("empty: %+v %v", look, problems)
	}
	// forty characters are fine, also when they are not ASCII
	if _, problems := theme.Parse([]byte(`{"name": "` + strings.Repeat("ä", 40) + `"}`)); len(problems) != 0 {
		t.Fatal(problems)
	}
	for _, body := range []string{`null`, `{} {}`, `"x"`} {
		if _, problems := theme.Parse([]byte(body)); len(problems) != 1 {
			t.Fatalf("%s: %v", body, problems)
		}
	}
	// a very long unknown setting is quoted shortened
	_, problems = theme.Parse([]byte(`{"` + strings.Repeat("k", 100) + `": 1}`))
	if len(problems) != 1 || !strings.Contains(problems[0], strings.Repeat("k", 39)+"…") {
		t.Fatal(problems)
	}
}

func TestParseTakesTheButtonsTheStatesAndTheFont(t *testing.T) {
	look, problems := theme.Parse([]byte(`{"mainButton": "#15803D", "otherButtons": "#0369a1", "success": "#166534", "warning": "#EA580C", "info": "#2563eb", "problem": "#b91c1c", "font": "roboto"}`))
	want := theme.Look{MainButton: "#15803d", OtherButtons: "#0369a1", Success: "#166534", Warning: "#ea580c", Info: "#2563eb", Problem: "#b91c1c", Font: "roboto"}
	if len(problems) != 0 || look != want {
		t.Fatalf("%+v %v", look, problems)
	}
	_, problems = theme.Parse([]byte(`{"mainButton": "green", "success": "#12345", "warning": 7, "info": "#2563eb", "problem": "#xyzxyz", "font": "Comic Sans"}`))
	wantProblems := []string{
		"The colour of warnings must be a text.",
		"The colour of main buttons must be written as # and six digits or letters a-f, e.g. #4f46e5.",
		"The colour of success must be written as # and six digits or letters a-f, e.g. #4f46e5.",
		"The colour of problems must be written as # and six digits or letters a-f, e.g. #4f46e5.",
		"The font must be “roboto”; leave it out to use the default font (Inter).",
	}
	if strings.Join(problems, "|") != strings.Join(wantProblems, "|") {
		t.Fatalf("%q", problems)
	}
	if _, problems := theme.Parse([]byte(`{"font": ""}`)); len(problems) != 1 {
		t.Fatal(problems)
	}
}

func TestDescribeSaysWhatChanged(t *testing.T) {
	logo, other := strings.Repeat("a", 64), strings.Repeat("b", 64)
	for _, c := range []struct {
		old, new theme.Look
		want     string
	}{
		{theme.Look{}, theme.Look{}, "nothing changed"},
		{theme.Look{Brand: "#000000"}, theme.Look{}, "back to the default look"},
		{theme.Look{}, theme.Look{Logo: logo}, "logo added"},
		{theme.Look{Logo: logo}, theme.Look{Logo: other}, "logo replaced"},
		{theme.Look{Logo: logo, Name: "A"}, theme.Look{Name: "A"}, "logo removed"},
		{theme.Look{Name: "A", Process: "#111111"}, theme.Look{Name: "B", Standard: "#222222", Appearance: "device"},
			"name “B”; colour of processes back to the default (teal); colour of standards #222222; appearance for new visitors as the device is set"},
		{theme.Look{Success: "#166534", Font: "roboto"}, theme.Look{MainButton: "#15803d", OtherButtons: "#0369a1", Warning: "#ea580c", Info: "#2563eb", Problem: "#b91c1c"},
			"colour of main buttons #15803d; colour of other buttons #0369a1; colour of success back to the default (green); colour of warnings #ea580c; colour of information #2563eb; colour of problems #b91c1c; font back to the default (Inter)"},
		{theme.Look{}, theme.Look{Font: "roboto"}, "font Roboto"},
		{theme.Look{Name: "A", Appearance: "dark"}, theme.Look{Brand: "#0055aa"}, "name back to the default (“Process Manager”); brand colour #0055aa; appearance for new visitors back to the default (light)"},
	} {
		if got := theme.Describe(c.old, c.new); got != c.want {
			t.Errorf("%+v -> %+v: %q", c.old, c.new, got)
		}
	}
}

func TestSavesAreRefusedFromAnOutdatedRevision(t *testing.T) {
	s := &theme.Store{Pool: dbtest.NewPool(t)}
	got, err := s.Get(ctx)
	if err != nil || got.Revision != 0 || got.Look != (theme.Look{}) || got.UpdatedAt != nil {
		t.Fatalf("nothing saved: %+v %v", got, err)
	}
	// many admins save the first look at once: exactly one gets through
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins, conflicts := 0, 0
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := s.Save(ctx, theme.Look{Brand: "#123456"}, 0, "dana@example.com", "Dana Admin")
			var c *theme.Conflict
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				wins++
			case errors.As(err, &c) && c.Current.Revision == 1:
				conflicts++
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if wins != 1 || conflicts != 5 {
		t.Fatalf("wins %d, conflicts %d", wins, conflicts)
	}
	now, before, err := s.Save(ctx, theme.Look{Name: "Acme"}, 1, "x@example.com", "")
	if err != nil || now.Revision != 2 || before.Look.Brand != "#123456" || before.UpdatedByName != "Dana Admin" || now.UpdatedAt == nil {
		t.Fatalf("second: %+v %+v %v", now, before, err)
	}
	_, _, err = s.Save(ctx, theme.Look{}, 1, "y@example.com", "")
	var c *theme.Conflict
	if !errors.As(err, &c) || c.Current.Revision != 2 || c.Current.UpdatedBy != "x@example.com" || c.Current.Look.Name != "Acme" {
		t.Fatalf("outdated: %v", err)
	}
	got, _ = s.Get(ctx)
	if got.Revision != 2 || got.Look != (theme.Look{Name: "Acme"}) {
		t.Fatalf("stored: %+v", got)
	}
}
