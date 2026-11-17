package docs_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/docs"
)

func listsOf(t *testing.T, body string) docs.Lists {
	t.Helper()
	var l docs.Lists
	if err := json.Unmarshal([]byte(body), &l); err != nil {
		t.Fatal(err)
	}
	return l
}

func TestCategoriesPracticesAndPlatformsMustBeInTheLists(t *testing.T) {
	l := listsOf(t, lists)
	vpn := strings.Replace(vpn, `"steps":`, `"actors":[{"id":"me","name":"You"}],"steps":`, 1)
	placed := strings.Replace(vpn, `"owner":"network-team"`, `"owner":"network-team","category":"cloud","practice":"security","platform":"google-cloud","rigour":"mandatory"`, 1)
	if err := docs.Check(docs.Process, []byte(placed), l); err != nil {
		t.Fatalf("known ids: %v", err)
	}
	for field, value := range map[string]string{"category": "Cloud", "practice": "engineering", "platform": "azure"} {
		body := strings.Replace(vpn, `"owner":"network-team"`, `"owner":"network-team","`+field+`":"`+value+`"`, 1)
		err := docs.Check(docs.Process, []byte(body), l)
		if !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), field+`: "`+value+`" is not a known `+field) {
			t.Errorf("process %s %q: %v", field, value, err)
		}
		std := strings.Replace(logging, `"owner":"security"`, `"owner":"security","`+field+`":"`+value+`"`, 1)
		if err := docs.Check(docs.Standard, []byte(std), l); !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), "is not a known "+field) {
			t.Errorf("standard %s %q: %v", field, value, err)
		}
	}
	// a team id is not a practice, even when a practice has the same id as another team
	if err := docs.Check(docs.Standard, []byte(strings.Replace(logging, `"owner":"security"`, `"owner":"security","platform":"security"`, 1)), l); err == nil {
		t.Fatal("a team id was accepted as a platform")
	}
	// an older catalog without the new lists: nothing can be named from them
	old := listsOf(t, `{"tiers":[],"environments":[],"languages":[],"teams":[],"tools":[]}`)
	if err := docs.Check(docs.Process, []byte(placed), old); err == nil || !strings.Contains(err.Error(), "Known categories: (none)") {
		t.Fatalf("missing lists count as empty: %v", err)
	}
}

func TestDuplicateIdsInTheNewLists(t *testing.T) {
	for _, key := range []string{"practices", "platforms", "categories"} {
		body := `{"tiers":[],"environments":[],"languages":[],"teams":[{"id":"a","name":"A"}],"` + key + `":[{"id":"a","name":"A"},{"id":"a","name":"B"}],"tools":[]}`
		err := docs.Check(docs.Catalog, []byte(body), docs.Lists{})
		if !errors.Is(err, docs.ErrInvalid) || !strings.Contains(err.Error(), key+`[1].id: duplicate id "a"`) {
			t.Errorf("%s: %v", key, err)
		}
	}
	// the same id in different lists is fine
	ok := `{"tiers":[],"environments":[],"languages":[],"teams":[{"id":"security","name":"A"}],"practices":[{"id":"security","name":"B"}],"platforms":[{"id":"security","name":"C"}],"categories":[{"id":"security","name":"D"}],"tools":[]}`
	if err := docs.Check(docs.Catalog, []byte(ok), docs.Lists{}); err != nil {
		t.Fatal(err)
	}
}

func TestUsesAndRemovedCoverTheNewLists(t *testing.T) {
	body := strings.Replace(vpn, `"owner":"network-team"`, `"owner":"network-team","category":"cloud","practice":"security","platform":"google-cloud"`, 1)
	u := docs.UsesOf(docs.Process, []byte(body))
	if !u.Lists["categories"]["cloud"] || !u.Lists["practices"]["security"] || !u.Lists["platforms"]["google-cloud"] || !u.Lists["teams"]["network-team"] {
		t.Fatalf("process uses: %+v", u.Lists)
	}
	std := strings.Replace(logging, `"owner":"security"`, `"owner":"security","category":"cloud","practice":"security"`, 1)
	if u := docs.UsesOf(docs.Standard, []byte(std)); !u.Lists["categories"]["cloud"] || !u.Lists["practices"]["security"] || u.Lists["platforms"] != nil {
		t.Fatalf("standard uses: %+v", u.Lists)
	}
	removed := docs.Removed(listsOf(t, lists), listsOf(t, `{"teams":[{"id":"security","name":"x"}]}`))
	want := "categories/cloud,environments/production,platforms/google-cloud,practices/security,tiers/tier-0,tools/github"
	if strings.Join(removed, ",") != want {
		t.Fatalf("removed: %v", removed)
	}
}
