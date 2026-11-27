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
// log says so). A team that named both a pillar and a tribe stays in its pillar; the pillar is put
// in that tribe only when it is in no tribe yet, the tribe exists and every team of the pillar that
// names a tribe names that one (else the log says why not). Lists in which no team names a tribe
// are left exactly as they are, so it runs once.

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
	// a team that names both a pillar and a tribe stays in its pillar; that pillar is given the
	// tribe only when it names none itself and its teams that name a tribe all name the same one
	// that exists: anything else would be a guess
	tribesOfPillar := map[string]map[string]bool{} // pillar id -> the tribes its teams name
	for _, item := range teams {
		if o, err := parse(item); err == nil && o.str("pillar") != "" {
			if _, had := o.get("tribe"); had {
				if tribesOfPillar[o.str("pillar")] == nil {
					tribesOfPillar[o.str("pillar")] = map[string]bool{}
				}
				tribesOfPillar[o.str("pillar")][o.str("tribe")] = true
			}
		}
	}
	original := len(pillars.entries) // the pillars the lists had: only these can be given a tribe
	givenTribe := map[string]bool{}
	giveTribe := func(team, pillar, tribe string) {
		if givenTribe[pillar] {
			return
		}
		at := -1
		for i, e := range pillars.entries[:original] {
			if o, err := parse(e); err == nil && o.str("id") == pillar {
				at = i
				if o.str("tribe") != "" {
					log.Warn("team named both a pillar and a tribe: it stays in its pillar, which is in a tribe of its own", "team", team, "pillar", pillar, "tribe", tribe, "pillarTribe", o.str("tribe"))
					return
				}
			}
		}
		switch _, known := tribeName[tribe]; {
		case at < 0:
			log.Warn("team named both a pillar and a tribe: the pillar is not in the lists, and the tribe is left out", "team", team, "pillar", pillar, "tribe", tribe)
		case !known:
			log.Warn("team named both a pillar and a tribe: it stays in its pillar; the tribe is not in the lists", "team", team, "pillar", pillar, "tribe", tribe)
		case len(tribesOfPillar[pillar]) != 1:
			log.Warn("team named both a pillar and a tribe: it stays in its pillar; the teams of that pillar name different tribes, so the pillar is put in none", "team", team, "pillar", pillar, "tribe", tribe)
		default:
			o, _ := parse(pillars.entries[at])
			pillars.entries[at] = o.with("tribe", raw(tribe)).bytes()
			givenTribe[pillar] = true
			log.Info("team named both a pillar and a tribe: it stays in its pillar, and the pillar is put in that tribe", "team", team, "pillar", pillar, "tribe", tribe)
		}
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
			giveTribe(id, o.str("pillar"), tribe)
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
