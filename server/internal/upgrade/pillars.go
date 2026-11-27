package upgrade

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
)

// Pillars: lists stored by the version before pillars put teams straight in tribes (a team named
// its "tribe"). Teams are now in pillars and pillars in tribes. For every tribe that teams named,
// one pillar in that tribe is added, named like the tribe, and those teams are put in it; "tribe"
// leaves the teams. A team that named a tribe the lists do not have ends up in no pillar (and the
// log says so). Lists in which no team names a tribe are left exactly as they are, so it runs once.

const (
	// PillarsNote is what the history of the lists says when putting the teams in pillars was all that changed.
	PillarsNote = "Put the teams in pillars"
	// PillarsSummary is what the activity log says about it (%d: the pillars added).
	PillarsSummary = "put the teams that were in a tribe in pillars: %d pillars added, one in each such tribe"
)

// PillarsFromTribes converts the body of the lists (see above), for a conversion at start and for
// an import of files in the earlier shape. It gives the body unchanged, and 0 and 0, when no
// team names a tribe.
func PillarsFromTribes(body []byte, log *slog.Logger) (out []byte, pillarsAdded, teamsMoved int, err error) {
	cat, err := parse(body)
	if err != nil {
		return body, 0, 0, fmt.Errorf("the lists: %w", err)
	}
	cat, pillarsAdded, teamsMoved, changed, err := pillarsFromTribes(cat, log)
	if err != nil || !changed {
		return body, 0, 0, err
	}
	return cat.bytes(), pillarsAdded, teamsMoved, nil
}

func pillarsFromTribes(cat object, log *slog.Logger) (object, int, int, bool, error) {
	if log == nil {
		log = slog.Default()
	}
	v, ok := cat.get("teams")
	if !ok {
		return cat, 0, 0, false, nil
	}
	var teams []json.RawMessage
	if err := json.Unmarshal(v, &teams); err != nil {
		return cat, 0, 0, false, fmt.Errorf("teams: %w", err)
	}
	tribes, err := readList(cat, "tribes")
	if err != nil {
		return cat, 0, 0, false, err
	}
	tribeName := map[string]string{}
	for _, e := range tribes.entries {
		var t struct{ ID, Name string }
		_ = json.Unmarshal(e, &t)
		tribeName[t.ID] = t.Name
	}
	pillars, err := readList(cat, "pillars")
	if err != nil {
		return cat, 0, 0, false, err
	}
	pillarOf := map[string]string{} // tribe id -> the pillar added for it
	changed, moved := false, 0
	for i, item := range teams {
		o, err := parse(item)
		if err != nil {
			return cat, 0, 0, false, fmt.Errorf("teams: %w", err)
		}
		if _, had := o.get("tribe"); !had {
			continue
		}
		changed = true
		tribe, id := o.str("tribe"), o.str("id")
		o = o.without("tribe")
		switch name, known := tribeName[tribe]; {
		case o.str("pillar") != "":
			log.Warn("team named both a pillar and a tribe: it stays in its pillar", "team", id, "tribe", tribe)
		case !known:
			log.Warn("team named a tribe that is not in the lists: it is now in no pillar", "team", id, "tribe", tribe)
		default:
			pillar, done := pillarOf[tribe]
			if !done {
				// the tribe's id, or with a number when the pillars already have it
				base := tribe
				pillar = base
				for n := 2; pillars.ids[pillar]; n++ {
					suffix := fmt.Sprintf("-%d", n)
					pillar = strings.TrimRight(truncate(base, 80-len(suffix)), "-") + suffix
				}
				if name == "" {
					name = tribe
				}
				pillars.add(pillar, object{{"id", raw(pillar)}, {"name", raw(fit(log, "name of the pillar "+pillar, name, 60))}, {"tribe", raw(tribe)}}.bytes())
				pillarOf[tribe] = pillar
				log.Info("pillar added for the teams that were in a tribe", "pillar", pillar, "tribe", tribe)
			}
			o = o.with("pillar", raw(pillar))
			moved++
		}
		teams[i] = o.bytes()
	}
	if !changed {
		return cat, 0, 0, false, nil
	}
	b, _ := json.Marshal(teams)
	cat = cat.with("teams", b)
	cat = cat.after("pillars", pillars.value(), "teams")
	return cat, len(pillars.added), moved, true, nil
}
