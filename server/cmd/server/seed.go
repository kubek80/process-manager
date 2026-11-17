package main

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/engagement"
	"github.com/kubek80/process-manager/server/internal/requests"
)

// seedWeeks is how far back the sample views, upvotes and downloads go.
const seedWeeks = 12

// seedEngagement gives a local development database that has no views, bookmarks, upvotes,
// downloads or requests at all a believable amount of them, so that the statistics and the
// requests are not empty when somebody tries the app. It never adds to what is there: as soon as
// anything was recorded, it does nothing. The numbers are random but the same on every database
// with the same content. Besides the built-in users, a few dozen made-up colleagues
// (colleague-01@example.com, ...) view and upvote, so that "people" is more than six.
func seedEngagement(ctx context.Context, st stores, log *slog.Logger, now time.Time) error {
	empty, err := st.engagement.Empty(ctx)
	if err != nil || !empty {
		return err
	}
	type doc struct {
		kind, id, title string
		weight          float64
	}
	rng := rand.New(rand.NewPCG(2026, 11))
	var all []doc
	exists := map[string]bool{}
	for _, kind := range []string{docs.Process, docs.Standard} {
		list, err := st.docs.List(ctx, kind)
		if err != nil {
			return err
		}
		for _, d := range list {
			t, ok := docs.TargetOf(d)
			if !ok {
				continue
			}
			exists[kind+"/"+d.ID] = true
			if t.Status == "draft" { // drafts are read by the few who work on them: left out
				continue
			}
			all = append(all, doc{kind: kind, id: d.ID, title: t.Title, weight: 0.02 + rng.Float64()*0.14})
		}
	}
	if len(all) == 0 {
		return nil // nothing to attach samples to
	}

	builtIn := []string{}
	for _, u := range auth.DevUsers {
		builtIn = append(builtIn, u.Email)
	}
	people := append([]string{}, builtIn...)
	for i := 1; i <= 30; i++ {
		people = append(people, fmt.Sprintf("colleague-%02d@example.com", i))
	}
	today := engagement.Day(now)
	days := seedWeeks * 7
	// a moment on a day some days ago, during working hours
	at := func(daysAgo int) time.Time {
		t := today.AddDate(0, 0, -daysAgo).Add(time.Duration(8*60+rng.IntN(9*60)) * time.Minute)
		if t.After(now) {
			t = now.Add(-time.Duration(rng.IntN(60)+1) * time.Minute)
		}
		return t
	}

	// views: more on working days, and a little more every week
	var kinds, ids, dayList, emails []string
	for _, d := range all {
		for ago := days - 1; ago >= 0; ago-- {
			day := today.AddDate(0, 0, -ago)
			chance := d.weight * (0.55 + 0.45*float64(days-ago)/float64(days))
			if wd := day.Weekday(); wd == time.Saturday || wd == time.Sunday {
				chance *= 0.15
			}
			for _, p := range people {
				if rng.Float64() < chance {
					kinds, ids, dayList, emails = append(kinds, d.kind), append(ids, d.id), append(dayList, day.Format("2006-01-02")), append(emails, p)
				}
			}
		}
	}
	pool := st.engagement.Pool
	if _, err := pool.Exec(ctx, `insert into document_views (kind, id, day, email)
		select * from unnest($1::text[], $2::text[], $3::text[]::date[], $4::text[]) on conflict do nothing`, kinds, ids, dayList, emails); err != nil {
		return err
	}

	// upvotes and bookmarks: some for every built-in user, upvotes from colleagues too
	upvotes, bookmarks := 0, 0
	for i, p := range people {
		for _, d := range all {
			chance := 0.08 + d.weight
			if i < len(builtIn) {
				chance = 0.3
			}
			if rng.Float64() < chance {
				if _, err := pool.Exec(ctx, `insert into upvotes (email, kind, id, created_at) values ($1, $2, $3, $4) on conflict do nothing`,
					p, d.kind, d.id, at(rng.IntN(days))); err != nil {
					return err
				}
				upvotes++
			}
			if i < len(builtIn) && rng.Float64() < 0.25 {
				if _, err := pool.Exec(ctx, `insert into bookmarks (email, kind, id, created_at) values ($1, $2, $3, $4) on conflict do nothing`,
					p, d.kind, d.id, at(rng.IntN(days))); err != nil {
					return err
				}
				bookmarks++
			}
		}
	}

	// a few downloads of the skills and review agents in use
	downloads := 0
	list, err := st.skills.List(ctx)
	if err != nil {
		return err
	}
	for _, sk := range list {
		if !sk.Active {
			continue
		}
		for n := rng.IntN(7); n > 0; n-- {
			if err := st.engagement.CountDownload(ctx, sk.ID, sk.SourceKind, sk.SourceID, engagement.ViaDownload, at(rng.IntN(days))); err != nil {
				return err
			}
			downloads++
		}
	}

	added, err := seedRequests(ctx, st, now, exists)
	if err != nil {
		return err
	}
	log.Info("sample engagement added", "views", len(kinds), "upvotes", upvotes, "bookmarks", bookmarks, "downloads", downloads, "requests", added)
	return nil
}

// seedRequests adds a handful of requests in every state, with votes.
func seedRequests(ctx context.Context, st stores, now time.Time, exists map[string]bool) (int, error) {
	lists, err := st.docs.Lists(ctx)
	if err != nil {
		return 0, err
	}
	known := func(list []docs.Named, id string) string {
		for _, n := range list {
			if n.ID == id {
				return id
			}
		}
		return ""
	}
	samples := []struct {
		kind, title, description, platform, practice, by, byName string
		daysAgo                                                  int
		state, note, stateBy, linked                             string
		votes                                                    []string
	}{
		{kind: docs.Process, title: "Get a Kubernetes namespace on the shared cluster", by: "sam@example.com", byName: "Sam Consumer", daysAgo: 24,
			description: "Teams keep asking in chat how to get a namespace on the shared GKE cluster: who approves it, how quotas are set and how long it takes. A written process would save everyone a round of questions.",
			platform:    "google-cloud", votes: []string{"alex@example.com", "casey@example.com", "riley@example.com", "colleague-03@example.com", "colleague-11@example.com"}},
		{kind: docs.Standard, title: "Secrets in build pipelines", by: "jordan@example.com", byName: "Jordan Platform", daysAgo: 40,
			description: "We need clear rules for where pipeline secrets live, how they are rotated and what a reviewer should look for when a pipeline is changed.",
			practice:    "security", state: requests.Planned, note: "Drafting starts next month with the platform teams.", stateBy: "Riley Security",
			votes: []string{"sam@example.com", "dana@example.com", "colleague-07@example.com"}},
		{kind: docs.Process, title: "Put a public website behind the CDN", by: "casey@example.com", byName: "Casey Owner", daysAgo: 70,
			description: "Several teams need to put a website behind Akamai and do not know where to start or whom to ask for the DNS changes.",
			platform:    "akamai", state: requests.Done, note: "Written together with the edge team.", stateBy: "Alex Editor", linked: "onboard-site-to-akamai",
			votes: []string{"sam@example.com", "jordan@example.com"}},
		{kind: docs.Process, title: "Get read access to production logs", by: "riley@example.com", byName: "Riley Security", daysAgo: 33,
			description: "Developers on call need read access to production logs at night. How do they get it quickly without breaking the rules?",
			state:       requests.Declined, note: "This is an access request like any other: use the ServiceNow request process.", stateBy: "Alex Editor",
			votes: []string{"colleague-02@example.com"}},
		{kind: docs.Standard, title: "Naming of cloud resources", by: "alex@example.com", byName: "Alex Editor", daysAgo: 3,
			description: "Every team names projects, buckets and accounts differently, which makes costs and ownership hard to follow. A naming standard for all clouds would help.",
			practice:    "engineering", votes: []string{"jordan@example.com", "sam@example.com", "casey@example.com", "dana@example.com"}},
	}
	added := 0
	for _, s := range samples {
		q, err := st.requests.Create(ctx, requests.New{Kind: s.kind, Title: s.title, Description: s.description,
			Platform: known(lists.Platforms, s.platform), Practice: known(lists.Practices, s.practice), ByEmail: s.by, ByName: s.byName})
		if err != nil {
			return added, err
		}
		created := now.Add(-time.Duration(s.daysAgo)*24*time.Hour - 3*time.Hour)
		if _, err := st.requests.Pool.Exec(ctx, `update requests set created_at = $2 where id = $1`, q.ID, created); err != nil {
			return added, err
		}
		state := s.state
		if state == requests.Done && !exists[s.kind+"/"+s.linked] {
			state = requests.Planned // the document that answers it is not in this database
		}
		if state != "" {
			if _, err := st.requests.SetState(ctx, q.ID, state, s.note, s.linked, s.stateBy, s.by); err != nil {
				return added, err
			}
			if _, err := st.requests.Pool.Exec(ctx, `update requests set state_at = $2 where id = $1`, q.ID, created.Add(time.Duration(s.daysAgo/2+1)*24*time.Hour)); err != nil {
				return added, err
			}
		}
		for _, v := range s.votes {
			if _, err := st.requests.SetVote(ctx, q.ID, v, true); err != nil {
				return added, err
			}
		}
		added++
	}
	return added, nil
}
