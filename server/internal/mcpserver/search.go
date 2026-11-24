package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// SearchInput is what both search tools take.
type SearchInput struct {
	Query       string `json:"query,omitempty" jsonschema:"what the person wants, in their words; leave out to list everything that passes the filters"`
	Category    string `json:"category,omitempty" jsonschema:"id or name of a category, e.g. cloud"`
	Practice    string `json:"practice,omitempty" jsonschema:"id or name of a practice, e.g. security"`
	Platform    string `json:"platform,omitempty" jsonschema:"id or name of a platform, e.g. google-cloud"`
	Owner       string `json:"owner,omitempty" jsonschema:"id or name of the owning team"`
	Rigour      string `json:"rigour,omitempty" jsonschema:"mandatory, recommended or optional (for standards also must, should, may: at least one requirement of that level)"`
	Tier        string `json:"tier,omitempty" jsonschema:"id or name of the application tier the person's application has; only what applies to it is returned"`
	Environment string `json:"environment,omitempty" jsonschema:"id or name of the environment, e.g. production; only what applies there is returned"`
	Language    string `json:"language,omitempty" jsonschema:"id or name of the programming language; only what applies to it is returned"`
	Path        string `json:"path,omitempty" jsonschema:"id, name or other name of the path the work is on (greenfield: something new; brownfield: something that exists; paved path, also called golden path: the ready-made way; or another from get_catalog). Only what applies to that path is returned: what is made for it AND what is not tied to any path (most documents name no path, as they apply to everyone). This differs from the portal's Path filter, which keeps only what is made for the path"`
	Limit       int    `json:"limit,omitempty" jsonschema:"how many results at most, 1 to 50; default 10"`
}

// Match is a part of a document where the query was found.
type Match struct {
	Part    string `json:"part" jsonschema:"summary, step, prerequisite, requirement or scope"`
	Item    string `json:"item,omitempty" jsonschema:"the step id or requirement id; for a prerequisite its position from 0"`
	Label   string `json:"label"`
	Snippet string `json:"snippet,omitempty"`
}

// RequirementBrief is a requirement in a search result.
type RequirementBrief struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Level string `json:"level" jsonschema:"must, should or may"`
}

// SearchResult is one process or standard found.
type SearchResult struct {
	Header
	Rigour       string             `json:"rigour,omitempty" jsonschema:"process: mandatory, recommended or optional"`
	Requirements []RequirementBrief `json:"requirements,omitempty" jsonschema:"standard: the requirements that apply (to the profile, when one was given)"`
	Score        float64            `json:"score,omitempty" jsonschema:"how well it matches the query; higher is better"`
	Matches      []Match            `json:"matches,omitempty" jsonschema:"where inside it the query was found, best first, at most 3"`
}

// SearchOutput is the answer of both search tools.
type SearchOutput struct {
	Total    int               `json:"total" jsonschema:"how many match; results holds the first ones. With totalAtLeast it is a lower bound"`
	AtLeast  bool              `json:"totalAtLeast,omitempty" jsonschema:"true: more matched than could be counted; total is at least this many"`
	Results  []SearchResult    `json:"results"`
	RankedBy string            `json:"rankedBy" jsonschema:"meaning (search by meaning), words (every word of the query found), words-fallback (search by meaning was not available this time, see note: every word of the query found) or title (no query)"`
	Note     string            `json:"note,omitempty"`
	Filters  map[string]string `json:"filters" jsonschema:"the filters as understood, by id"`
}

const (
	defaultLimit = 10
	maxLimit     = 50
	maxMatches   = 3
)

// filters is a SearchInput with the list values resolved to ids.
type filters struct {
	category, practice, platform, owner, rigour string
	profile                                     Profile
}

// resolve finds a list entry by id or by name, ignoring case and accents.
func resolve(list []docs.Named, value, what, plural string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	want := fold(value)
	for _, n := range list {
		if fold(n.ID) == want {
			return n.ID, nil
		}
	}
	for _, n := range list {
		if fold(n.Name) == want {
			return n.ID, nil
		}
	}
	return "", problemf("There is no %s “%s”. Use get_catalog to see the %s.", what, value, plural)
}

// rigourOf accepts the rigours and the levels of requirements.
func rigourOf(v string) (string, error) {
	switch fold(strings.TrimSpace(v)) {
	case "":
		return "", nil
	case "mandatory", "must":
		return "mandatory", nil
	case "recommended", "should":
		return "recommended", nil
	case "optional", "may":
		return "optional", nil
	}
	return "", problemf("There is no rigour “%s”. Use mandatory, recommended or optional (must, should or may).", v)
}

var levelRigour = map[string]string{"must": "mandatory", "should": "recommended", "may": "optional"}

func resolveFilters(l docs.Lists, in SearchInput) (filters, error) {
	var f filters
	var err error
	steps := []struct {
		out              *string
		list             []docs.Named
		value, one, many string
	}{
		{&f.category, l.Categories, in.Category, "category", "categories"},
		{&f.practice, l.Practices, in.Practice, "practice", "practices"},
		{&f.platform, l.Platforms, in.Platform, "platform", "platforms"},
		{&f.owner, l.Teams, in.Owner, "team", "teams"},
		{&f.profile.Tier, l.Tiers, in.Tier, "tier", "tiers"},
		{&f.profile.Environment, l.Environments, in.Environment, "environment", "environments"},
		{&f.profile.Language, l.Languages, in.Language, "language", "languages"},
	}
	for _, s := range steps {
		if *s.out, err = resolve(s.list, s.value, s.one, s.many); err != nil {
			return f, err
		}
	}
	if f.profile.Path, err = resolvePath(l.Paths, in.Path); err != nil {
		return f, err
	}
	f.rigour, err = rigourOf(in.Rigour)
	return f, err
}

// resolvePath finds a path by id or name, or by one of its other names (the entry's
// "alsoCalled": "golden path" for the paved path), ignoring case and accents. The lists'
// check keeps an other name to one path.
func resolvePath(list []docs.Named, value string) (string, error) {
	id, err := resolve(list, value, "path", "paths")
	if err == nil {
		return id, nil
	}
	want := fold(strings.TrimSpace(value))
	for _, n := range list {
		for _, also := range docs.OtherNames(n) {
			if fold(also) == want {
				return n.ID, nil
			}
		}
	}
	return "", err
}

func (f filters) shown() map[string]string {
	out := map[string]string{}
	for k, v := range map[string]string{"category": f.category, "practice": f.practice, "platform": f.platform, "owner": f.owner, "rigour": f.rigour,
		"tier": f.profile.Tier, "environment": f.profile.Environment, "language": f.profile.Language, "path": f.profile.Path} {
		if v != "" {
			out[k] = v
		}
	}
	return out
}

// passes says whether an active document passes the filters; for a standard it also returns
// the requirements that apply to the profile.
func (f filters) passes(e *entry) (bool, []rawRequirement) {
	c := e.c
	if !e.active() {
		return false, nil
	}
	if (f.category != "" && c.Category != f.category) || (f.practice != "" && c.Practice != f.practice) ||
		(f.platform != "" && c.Platform != f.platform) || (f.owner != "" && c.Owner != f.owner) {
		return false, nil
	}
	if !f.profile.applies(c.Tiers, c.Environments, c.Languages) || !f.profile.onPath(c.Paths) {
		return false, nil
	}
	if e.kind == docs.Process {
		return f.rigour == "" || e.process.Rigour == f.rigour, nil
	}
	var apply []rawRequirement
	rigour := f.rigour == ""
	for _, r := range e.std.Requirements {
		if !f.profile.applies(r.Tiers, r.Environments, r.Languages) {
			continue
		}
		apply = append(apply, r)
		if levelRigour[r.Level] == f.rigour {
			rigour = true
		}
	}
	// with a profile, a standard none of whose requirements applies has nothing to say
	if len(apply) == 0 && !f.profile.empty() {
		return false, nil
	}
	return rigour, apply
}

// ---------- the word match, as the portal's search does it (src/lib/search.ts)

// fold puts text in lower case without accents: "Résumé" and "resume" are the same word.
func fold(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

// wordsOf returns the distinct words of a query, folded.
func wordsOf(q string) []string {
	seen := map[string]bool{}
	var out []string
	for _, w := range strings.Fields(fold(q)) {
		if !seen[w] {
			seen[w] = true
			out = append(out, w)
		}
	}
	return out
}

const (
	weightTitle   = 100
	weightID      = 60
	weightTags    = 60
	weightNames   = 40
	weightSummary = 20
	weightInside  = 5
)

type field struct {
	norm   string
	weight int
}

// part is a place inside a document the words are looked for.
type part struct {
	match Match
	texts []string
	norms []string
}

func newPart(m Match, texts ...string) part {
	p := part{match: m}
	for _, t := range texts {
		if t = strings.TrimSpace(t); t != "" {
			p.texts = append(p.texts, t)
			p.norms = append(p.norms, fold(t))
		}
	}
	return p
}

// partsOf lists the parts of a document with the labels the index gives them.
func partsOf(e *entry, l docs.Lists) []part {
	var out []part
	if e.kind == docs.Process {
		p := e.process
		for i, s := range p.Steps {
			tool := ""
			if s.Tool != "" {
				tool = docs.Name(l.Tools, s.Tool)
			}
			out = append(out, newPart(Match{Part: "step", Item: s.ID, Label: fmt.Sprintf("Step %d: %s", i+1, s.Title)}, s.Title, s.Description, tool))
		}
		for i, q := range p.Prerequisites {
			out = append(out, newPart(Match{Part: "prerequisite", Item: strconv.Itoa(i), Label: "Before you start: " + q.Title}, q.Title, q.Description))
		}
		return out
	}
	for _, r := range e.std.Requirements {
		out = append(out, newPart(Match{Part: "requirement", Item: r.ID, Label: r.ID + ": " + r.Title}, r.Title, r.ID, r.Statement))
	}
	if strings.TrimSpace(e.std.Scope) != "" {
		out = append(out, newPart(Match{Part: "scope", Label: "Scope"}, e.std.Scope))
	}
	return out
}

func fieldsOf(e *entry, l docs.Lists) []field {
	c := e.c
	// the paths with what else they are called: "golden path" finds what is on the paved path
	names := strings.Join([]string{name(l.Categories, c.Category), name(l.Practices, c.Practice), name(l.Platforms, c.Platform), name(l.Teams, c.Owner), docs.PathNames(l.Paths, c.Paths)}, " ")
	return []field{
		{fold(c.Title), weightTitle},
		{fold(e.doc.ID), weightID},
		{fold(strings.Join(c.Tags, " ")), weightTags},
		{fold(names), weightNames},
		{fold(c.Summary), weightSummary},
	}
}

func name(list []docs.Named, id string) string {
	if id == "" {
		return ""
	}
	return docs.Name(list, id)
}

// wordScore is how well a document matches the words: 0 when one of them is nowhere in it.
func wordScore(fields []field, parts []part, words []string) int {
	total := 0
	for _, w := range words {
		best := 0
		for _, f := range fields {
			if f.weight > best && strings.Contains(f.norm, w) {
				best = f.weight
			}
		}
		if best == 0 {
		inside:
			for _, p := range parts {
				for _, n := range p.norms {
					if strings.Contains(n, w) {
						best = weightInside
						break inside
					}
				}
			}
		}
		if best == 0 {
			return 0
		}
		total += best
	}
	// the whole query in the title, or the title starting with it, comes first
	title, phrase := fields[0].norm, strings.Join(words, " ")
	if len(words) > 0 && strings.HasPrefix(title, phrase) {
		total += 50
	} else if len(words) > 1 && strings.Contains(title, phrase) {
		total += 25
	}
	return total
}

// wordMatches are the parts that hold most of the words, best first.
func wordMatches(parts []part, words []string) []Match {
	type found struct {
		m     Match
		n, at int
	}
	var all []found
	for at, p := range parts {
		n := 0
		for _, w := range words {
			for _, t := range p.norms {
				if strings.Contains(t, w) {
					n++
					break
				}
			}
		}
		if n == 0 {
			continue
		}
		m := p.match
		inLabel := false
		for _, w := range words {
			if strings.Contains(fold(m.Label), w) {
				inLabel = true
			}
		}
		if !inLabel {
			for i, t := range p.norms {
				if containsAny(t, words) {
					m.Snippet = excerpt(p.texts[i], words)
					break
				}
			}
		}
		all = append(all, found{m, n, at})
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].n != all[j].n {
			return all[i].n > all[j].n
		}
		return all[i].at < all[j].at
	})
	out := []Match{}
	for i := 0; i < len(all) && i < maxMatches; i++ {
		out = append(out, all[i].m)
	}
	return out
}

func containsAny(text string, words []string) bool {
	for _, w := range words {
		if strings.Contains(text, w) {
			return true
		}
	}
	return false
}

// excerpt is a short piece of the text around the first word found, cut at whole words.
func excerpt(text string, words []string) string {
	const room = 70
	t := []rune(strings.Join(strings.Fields(text), " "))
	if len(t) <= room*2 {
		return string(t)
	}
	folded := []rune(fold(string(t)))
	first, end := -1, -1
	if len(folded) == len(t) { // folding kept the positions: find the word
		f := string(folded)
		for _, w := range words {
			if i := strings.Index(f, w); i >= 0 {
				at := len([]rune(f[:i]))
				if first < 0 || at < first {
					first, end = at, at+len([]rune(w))
				}
			}
		}
	}
	if first < 0 {
		return strings.TrimRight(string(t[:room*2]), " ") + "…"
	}
	start := max(0, first-room)
	stop := min(len(t), end+room)
	if start > 0 {
		for i := start; i < first; i++ {
			if t[i] == ' ' {
				start = i + 1
				break
			}
		}
	}
	if stop < len(t) {
		for i := stop; i > end; i-- {
			if t[i] == ' ' {
				stop = i
				break
			}
		}
	}
	out := string(t[start:stop])
	if start > 0 {
		out = "…" + out
	}
	if stop < len(t) {
		out += "…"
	}
	return out
}

// ---------- the search

type candidate struct {
	e       *entry
	apply   []rawRequirement
	score   float64
	matches []Match
}

// search runs one search. caller is who asks (the person, otherwise the address), for the brake
// on searches that use the embeddings provider.
func (s *Server) search(ctx context.Context, kind, caller string, in SearchInput) (SearchOutput, error) {
	l, err := s.load(ctx)
	if err != nil {
		return SearchOutput{}, err
	}
	f, err := resolveFilters(l.lists, in)
	if err != nil {
		return SearchOutput{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	limit = min(limit, maxLimit)

	var pool []candidate
	for _, e := range l.order {
		if e.kind != kind {
			continue
		}
		if ok, apply := f.passes(e); ok {
			pool = append(pool, candidate{e: e, apply: apply})
		}
	}
	out := SearchOutput{Results: []SearchResult{}, Filters: f.shown()}
	query := strings.TrimSpace(in.Query)
	var found []candidate
	switch {
	case query == "":
		out.RankedBy = "title"
		found = pool
		sort.SliceStable(found, func(i, j int) bool {
			a, b := fold(found[i].e.c.Title), fold(found[j].e.c.Title)
			return a < b || (a == b && found[i].e.doc.ID < found[j].e.doc.ID)
		})
	case s.o.Index != nil && s.o.Index.Enabled():
		if ok, wait := s.brake.allow(caller, time.Now()); !ok {
			return SearchOutput{}, problemf("Too many searches in the last minute (at most %d). Try again in %d seconds.", s.o.SearchesPerMinute, int(wait.Seconds())+1)
		}
		found, out.AtLeast, err = s.byMeaning(ctx, query, pool)
		if err == nil {
			out.RankedBy = "meaning"
			break
		}
		if ctx.Err() != nil { // the call itself is over: nothing to fall back for
			return SearchOutput{}, ctx.Err()
		}
		out.AtLeast = false
		switch {
		case errors.Is(err, ErrIndexNotReady):
			// as long as the portal server has not built the index this happens on every search
			level := slog.LevelDebug
			if s.notReady.CompareAndSwap(false, true) {
				level = slog.LevelInfo
			}
			s.o.Log.Log(ctx, level, "the search index is not built yet: agents search by words until the portal server has built it with the same settings")
			out.Note = "Search by meaning is not ready yet; these results are a word match."
		case errors.Is(err, errMeaningTimeout):
			s.o.Log.Warn("search by meaning did not answer in time; searching by words", "limit", s.o.MeaningTimeout.String())
			out.Note = "Search by meaning did not answer in time; these results are a word match."
		case errors.Is(err, ErrIndexProvider):
			s.o.Log.Warn("search by meaning failed: the embeddings provider could not be reached; searching by words")
			out.Note = "Search by meaning is not available right now (the service that compares meanings could not be reached); these results are a word match."
		default:
			s.o.Log.Warn("search by meaning failed; searching by words", "error", err)
			out.Note = "Search by meaning is not available right now; these results are a word match."
		}
		out.RankedBy = "words-fallback"
		found = byWords(l, query, pool)
	default:
		out.RankedBy = "words"
		found = byWords(l, query, pool)
	}
	out.Total = len(found)
	for i := 0; i < len(found) && i < limit; i++ {
		out.Results = append(out.Results, s.result(l, found[i]))
	}
	return out, nil
}

func byWords(l *library, query string, pool []candidate) []candidate {
	words := wordsOf(query)
	var out []candidate
	for _, c := range pool {
		parts := partsOf(c.e, l.lists)
		score := wordScore(fieldsOf(c.e, l.lists), parts, words)
		if score == 0 {
			continue
		}
		c.score = float64(score)
		c.matches = dropLeftOut(c, wordMatches(parts, words))
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score > out[j].score
		}
		a, b := fold(out[i].e.c.Title), fold(out[j].e.c.Title)
		return a < b || (a == b && out[i].e.doc.ID < out[j].e.doc.ID)
	})
	return out
}

// searchDepth is how many documents are asked of the index: as many as it gives, so that the
// filters leave something over.
const searchDepth = 500

// errMeaningTimeout: search by meaning took longer than Options.MeaningTimeout.
var errMeaningTimeout = errors.New("search by meaning did not answer in time")

// byMeaning asks the index and keeps, in its order, what passed the filters. truncated says
// that the index found more than it returned. It gives up after Options.MeaningTimeout, even if
// the index does not stop (a provider that hangs).
func (s *Server) byMeaning(ctx context.Context, query string, pool []candidate) (found []candidate, truncated bool, err error) {
	type answer struct {
		hits      []Found
		truncated bool
		err       error
	}
	wait, cancel := context.WithTimeout(ctx, s.o.MeaningTimeout)
	defer cancel()
	done := make(chan answer, 1)
	go func() {
		defer func() {
			if v := recover(); v != nil {
				done <- answer{err: fmt.Errorf("search by meaning failed unexpectedly: %v", v)}
			}
		}()
		hits, more, err := s.o.Index.Search(wait, query, searchDepth)
		done <- answer{hits, more, err}
	}()
	var a answer
	select {
	case a = <-done:
	case <-wait.Done():
		if ctx.Err() != nil {
			return nil, false, ctx.Err()
		}
		return nil, false, errMeaningTimeout
	}
	if a.err != nil {
		if errors.Is(a.err, context.DeadlineExceeded) && ctx.Err() == nil {
			return nil, false, errMeaningTimeout
		}
		return nil, false, a.err
	}
	hits := a.hits
	in := map[string]candidate{}
	for _, c := range pool {
		in[c.e.kind+"/"+c.e.doc.ID] = c
	}
	var out []candidate
	for _, h := range hits {
		c, ok := in[h.Kind+"/"+h.ID]
		if !ok {
			continue // a draft, a retired one, or one the filters leave out
		}
		delete(in, h.Kind+"/"+h.ID)
		c.score = h.Score
		var ms []Match
		for _, x := range h.Hits {
			ms = append(ms, Match{Part: x.Part, Item: x.Item, Label: x.Label, Snippet: x.Snippet})
		}
		c.matches = dropLeftOut(c, ms)
		if len(c.matches) > maxMatches {
			c.matches = c.matches[:maxMatches]
		}
		out = append(out, c)
	}
	return out, a.truncated, nil
}

// dropLeftOut removes the matches in requirements that do not apply to the profile.
func dropLeftOut(c candidate, ms []Match) []Match {
	if c.e.kind != docs.Standard {
		return ms
	}
	apply := map[string]bool{}
	for _, r := range c.apply {
		apply[r.ID] = true
	}
	out := []Match{}
	for _, m := range ms {
		if m.Part == "requirement" && !apply[m.Item] {
			continue
		}
		out = append(out, m)
	}
	return out
}

func (s *Server) result(l *library, c candidate) SearchResult {
	r := SearchResult{Header: s.header(l, c.e), Score: c.score, Matches: c.matches}
	if c.e.kind == docs.Process {
		r.Rigour = c.e.process.Rigour
		return r
	}
	r.Requirements = []RequirementBrief{}
	for _, q := range c.apply {
		r.Requirements = append(r.Requirements, RequirementBrief{ID: q.ID, Title: q.Title, Level: q.Level})
	}
	return r
}
