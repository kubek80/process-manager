// Package upgrade converts a database filled by an earlier version of the server to what this
// version expects. Each conversion runs at start and by -migrate, under the lock of the
// migrations, and finds nothing to do when it has run before.
package upgrade

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

// By is who the converted versions are saved by, and Note what their history says.
const (
	By   = "system"
	Name = "Process Manager"
	Note = "Moved to the new lists"
)

// Lists moves an older database to the lists of practices, platforms and categories:
//
//   - a team of kind "platform" is also added to the platforms, one of kind "practice" or
//     "security" to the practices (same id, name, contact and description, cut to the limits
//     of the format); every team loses its kind and stays a team;
//   - when the lists have no categories yet, every category text of a published process or
//     standard becomes an entry: the same text (trimmed, whatever its case) is one category, a
//     different text that gives the same id gets the next free one ("cloud-2"); a text used
//     only by drafts or deleted documents is dropped from them, and so is an empty one;
//   - a process or standard owned by such a platform or practice team belongs to it, unless it
//     already says which platform or practice it belongs to;
//   - the stored older versions get the same changes in place, without new versions, so that
//     one can be put back;
//   - a standards editor limited to a unit becomes the owner of the platform or practice made
//     from that unit; one limited to anything else loses the role, and the log says so;
//   - the lists always have the three new lists, empty if need be;
//   - lists stored before there were paths get the list of paths with its three entries
//     (Greenfield, Brownfield, Paved path), once: lists that have the key "paths" are never
//     given them again, also when an admin removed every entry (the app always saves the key).
//     Documents without paths are valid as they are and are not rewritten.
//
// Everything is one transaction, saved as new versions by By with Note, and recorded in the
// activity log. A document the save refuses is skipped with a warning; one that names a
// category, platform or practice that is not in the lists is left as it is and reported. A
// database that is already converted is left as it is.
func Lists(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) error {
	_, err := Convert(ctx, pool, log)
	return err
}

// Convert is Lists that also says what it did. The report is empty when the transaction did
// not commit.
func Convert(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) (Report, error) {
	var r Report
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var err error
		r, err = lists(ctx, tx, log)
		return err
	})
	if err != nil {
		return Report{}, err
	}
	return r, nil
}

// Report is what one conversion changed. The zero value means there was nothing to convert.
type Report struct {
	Converted      bool // something was written
	Lists          bool // the lists were saved as a new version
	Documents      int  // processes and standards saved as a new version
	Versions       int  // older versions adjusted in place
	Practices      int  // entries added to the lists
	Platforms      int
	Categories     int
	Paths          int // entries of the list of paths, added because the lists had none
	RolesConverted int
	RolesRemoved   int
}

// String says in one line what happened, in plain words.
func (r Report) String() string {
	if !r.Converted {
		return "nothing to convert: the content already fits this version"
	}
	// only what happened
	var parts []string
	if r.Documents > 0 || r.Versions > 0 {
		parts = append(parts, fmt.Sprintf("%d documents moved to the new lists (%d older versions adjusted)", r.Documents, r.Versions))
	}
	var added []string
	for _, a := range []struct {
		n    int
		noun string
	}{{r.Practices, "practices"}, {r.Platforms, "platforms"}, {r.Categories, "categories"}} {
		if a.n > 0 {
			added = append(added, fmt.Sprintf("%d %s", a.n, a.noun))
		}
	}
	if len(added) > 0 {
		parts = append(parts, "added "+strings.Join(added, ", "))
	}
	if r.RolesConverted > 0 || r.RolesRemoved > 0 {
		parts = append(parts, fmt.Sprintf("%d roles converted, %d removed", r.RolesConverted, r.RolesRemoved))
	}
	if r.Paths > 0 {
		parts = append(parts, fmt.Sprintf("added the list of paths with %d entries", r.Paths))
	}
	if r.Lists {
		parts = append(parts, "the lists were updated")
	} else {
		parts = append(parts, "the lists were left as they were")
	}
	return strings.Join(parts, "; ")
}

// a team as the earlier version knew it
type oldTeam struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Contact     string `json:"contact"`
	Description string `json:"description"`
}

// entry is an entry of the practices, platforms or categories, written in the order the app
// writes its fields.
func entry(id, name, contact, description string) json.RawMessage {
	o := object{{"id", raw(id)}, {"name", raw(name)}}
	if contact != "" {
		o = append(o, field{"contact", raw(contact)})
	}
	if description != "" {
		o = append(o, field{"description", raw(description)})
	}
	return o.bytes()
}

// named is the id of each entry of one of the new lists, and the entries themselves.
type named struct {
	ids     map[string]bool
	entries []json.RawMessage
	added   []string
}

func readList(cat object, key string) (*named, error) {
	n := &named{ids: map[string]bool{}}
	if v, ok := cat.get(key); ok {
		if err := json.Unmarshal(v, &n.entries); err != nil {
			return nil, fmt.Errorf("%s: %w", key, err)
		}
		for _, e := range n.entries {
			var head struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(e, &head)
			n.ids[head.ID] = true
		}
	}
	return n, nil
}

func (n *named) add(id string, e json.RawMessage) {
	if n.ids[id] {
		return
	}
	n.ids[id] = true
	n.entries = append(n.entries, e)
	n.added = append(n.added, id)
}

func (n *named) value() json.RawMessage {
	if len(n.entries) == 0 {
		return json.RawMessage(`[]`)
	}
	b, _ := json.Marshal(n.entries)
	return b
}

func lists(ctx context.Context, tx pgx.Tx, log *slog.Logger) (Report, error) {
	// no save of a server that is still running may come in between reading the documents and
	// writing them back
	if _, err := tx.Exec(ctx, `lock table documents in share row exclusive mode`); err != nil {
		return Report{}, err
	}
	var catBody []byte
	err := tx.QueryRow(ctx, `select body from documents where kind = $1 and id = $2`, docs.Catalog, docs.CatalogID).Scan(&catBody)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Report{}, err
	}
	type doc struct {
		kind, id string
		body     []byte
	}
	var all []doc
	rows, err := tx.Query(ctx, `select kind, id, body from documents where kind in ($1, $2) order by kind = $2, id`, docs.Process, docs.Standard)
	if err != nil {
		return Report{}, err
	}
	for rows.Next() {
		var d doc
		if err := rows.Scan(&d.kind, &d.id, &d.body); err != nil {
			rows.Close()
			return Report{}, err
		}
		all = append(all, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Report{}, err
	}
	if catBody == nil && len(all) == 0 {
		return Report{}, nil // an empty database is filled with content of this version
	}

	// ----- the lists
	noCatalog := catBody == nil
	if noCatalog {
		catBody = []byte(docs.EmptyCatalog)
	}
	cat, err := parse(catBody)
	if err != nil {
		return Report{}, fmt.Errorf("the lists: %w", err)
	}
	if noCatalog {
		cat = cat.without("paths") // lists made here for older content get the paths below
	}
	// Before this version the lists had no categories: the categories of processes were free
	// text. Only then are they turned into entries; later, an unknown one is only reported.
	_, hasCategories := cat.get("categories")
	old := noCatalog || !hasCategories
	practices, err := readList(cat, "practices")
	if err != nil {
		return Report{}, err
	}
	platforms, err := readList(cat, "platforms")
	if err != nil {
		return Report{}, err
	}
	categories, err := readList(cat, "categories")
	if err != nil {
		return Report{}, err
	}
	kindOf := map[string]string{}   // team id -> "platform" or "practice"
	teamName := map[string]string{} // team id -> name
	catChanged := false
	if v, ok := cat.get("teams"); ok {
		var teams []json.RawMessage
		if err := json.Unmarshal(v, &teams); err != nil {
			return Report{}, fmt.Errorf("teams: %w", err)
		}
		for i, raw := range teams {
			var t oldTeam
			if err := json.Unmarshal(raw, &t); err != nil {
				return Report{}, fmt.Errorf("teams: %w", err)
			}
			if t.Name != "" {
				teamName[t.ID] = t.Name
			}
			o, err := parse(raw)
			if err != nil {
				return Report{}, fmt.Errorf("teams: %w", err)
			}
			if _, had := o.get("kind"); !had {
				continue
			}
			teams[i] = o.without("kind").bytes()
			catChanged = true
			copied := func() json.RawMessage {
				name := fit(log, "name of "+t.ID, t.Name, 60)
				if name == "" {
					name = t.ID
				}
				return entry(t.ID, name, fit(log, "contact of "+t.ID, t.Contact, 120), fit(log, "description of "+t.ID, t.Description, 200))
			}
			switch t.Kind {
			case "platform":
				kindOf[t.ID] = "platform"
				platforms.add(t.ID, copied())
			case "practice", "security":
				kindOf[t.ID] = "practice"
				practices.add(t.ID, copied())
			}
		}
		b, _ := json.Marshal(teams)
		cat = cat.with("teams", b)
	}

	// ----- the categories: from what readers can see, the same text (whatever its case or the
	// spaces around it) being one category, a different text getting an id of its own
	type parsed struct {
		kind, id string
		o        object
		draft    bool
	}
	var docsNow []parsed
	for _, d := range all {
		o, err := parse(d.body)
		if err != nil {
			log.Warn("not converted: not a JSON object", "kind", d.kind, "id", d.id)
			continue
		}
		docsNow = append(docsNow, parsed{d.kind, d.id, o, o.str("status") == "draft"})
	}
	categoryOf := map[string]string{} // trimmed lower-case text -> id
	firstText := map[string]string{}  // trimmed lower-case text -> the text as first seen
	if old {
		used := map[string]bool{}
		for id := range categories.ids {
			used[id] = true
		}
		var newIDs []string
		nameOf := map[string]string{}
		for _, d := range docsNow {
			text := strings.TrimSpace(d.o.str("category"))
			if d.draft || text == "" {
				continue
			}
			key := strings.ToLower(text)
			if id, ok := categoryOf[key]; ok {
				if firstText[key] != text {
					log.Info("category texts written differently became one category", "first", firstText[key], "also", text, "id", id)
					if firstText[key] == strings.ToLower(firstText[key]) && text != strings.ToLower(text) {
						nameOf[id] = fit(log, "category "+id, text, 40) // named as a person writes it
					}
				}
				continue
			}
			base := slug(text)
			id := base
			for n := 2; used[id]; n++ {
				suffix := fmt.Sprintf("-%d", n)
				id = strings.TrimRight(truncate(base, 80-len(suffix)), "-") + suffix
			}
			if id != base {
				log.Info("category got a numbered id: another text already has the plain one", "text", text, "id", id)
			}
			used[id] = true
			categoryOf[key], firstText[key] = id, text
			nameOf[id] = fit(log, "category "+id, text, 40)
			newIDs = append(newIDs, id)
		}
		sort.Strings(newIDs)
		for _, id := range newIDs {
			categories.add(id, entry(id, nameOf[id], "", ""))
		}
	}
	// recategorise moves a free-text category to its id, or drops it when no published
	// document uses the text. It reports whether something changed.
	recategorise := func(o object, what string) (object, bool) {
		value, had := o.get("category")
		if !old || !had {
			return o, false
		}
		var text string
		_ = json.Unmarshal(value, &text)
		id, ok := categoryOf[strings.ToLower(strings.TrimSpace(text))]
		if !ok {
			if strings.TrimSpace(text) != "" && what != "" {
				log.Warn("category dropped: only drafts or deleted documents use it, so it is not published as an entry of the lists", "document", what, "category", text)
			}
			return o.without("category"), true
		}
		if id == text {
			return o, false
		}
		return o.with("category", raw(id)), true
	}
	// place puts a document on the platform or in the practice of its former owner unit
	place := func(o object) (object, bool) {
		changed := false
		owner := o.str("owner")
		if kindOf[owner] == "practice" && o.str("practice") == "" {
			o = o.after("practice", raw(owner), "owner", "category")
			changed = true
		}
		if kindOf[owner] == "platform" && o.str("platform") == "" {
			o = o.after("platform", raw(owner), "owner", "category", "practice")
			changed = true
		}
		return o, changed
	}

	// ----- the documents
	type change struct {
		kind, id string
		body     []byte
	}
	var changes []change
	for _, d := range docsNow {
		o, recategorised := recategorise(d.o, d.kind+" "+d.id)
		o, placed := place(o)
		if recategorised || placed {
			changes = append(changes, change{d.kind, d.id, o.bytes()})
		}
		// what this conversion does not decide is left alone, but said
		if c := o.str("category"); c != "" && !categories.ids[c] {
			log.Warn("document names a category that is not in the lists", "kind", d.kind, "id", d.id, "category", c)
		}
		if p := o.str("platform"); p != "" && !platforms.ids[p] {
			log.Warn("document names a platform that is not in the lists", "kind", d.kind, "id", d.id, "platform", p)
		}
		if p := o.str("practice"); p != "" && !practices.ids[p] {
			log.Warn("document names a practice that is not in the lists", "kind", d.kind, "id", d.id, "practice", p)
		}
	}

	// ----- the lists always carry the three new lists
	if old {
		catChanged = true
	}
	for _, l := range []struct {
		key   string
		list  *named
		after []string
	}{
		{"practices", practices, []string{"teams"}},
		{"platforms", platforms, []string{"teams", "practices"}},
		{"categories", categories, []string{"teams", "practices", "platforms"}},
	} {
		if _, had := cat.get(l.key); !had || len(l.list.added) > 0 {
			cat = cat.after(l.key, l.list.value(), l.after...)
			catChanged = true
		}
	}

	// ----- the paths: lists from before there were paths get the list with its three entries.
	// "Never again" rests on the key "paths" being present in the stored lists: the app always
	// saves it, also empty when an admin removed every path. Lists saved without the key (by a
	// client that leaves it out, or imported from files made before there were paths) get the
	// three entries again at the next start.
	movedLists := catChanged
	pathsAdded := 0
	if _, had := cat.get("paths"); !had {
		cat = cat.after("paths", DefaultPaths, "tiers")
		catChanged = true
		pathsAdded = defaultPathCount
	}

	// ----- roles: a standards editor of one unit becomes the owner of its platform or practice
	type role struct{ email, scope, by string }
	var scoped []role
	rows, err = tx.Query(ctx, `select email, scope, granted_by from role_assignments where role = $1 and scope <> '' order by email, scope`, rbac.StandardsEditor)
	if err != nil {
		return Report{}, err
	}
	for rows.Next() {
		var r role
		if err := rows.Scan(&r.email, &r.scope, &r.by); err != nil {
			rows.Close()
			return Report{}, err
		}
		scoped = append(scoped, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Report{}, err
	}

	if !catChanged && len(changes) == 0 && len(scoped) == 0 {
		return Report{}, nil
	}

	// ----- the history: older versions are converted in place, without new versions, so
	// that putting one back neither fails on its category nor takes it off its platform
	versions, workingDrafts := 0, 0
	if old || len(kindOf) > 0 {
		type version struct {
			kind, id string
			n        int
			body     []byte
		}
		var list []version
		rows, err := tx.Query(ctx, `select kind, id, version, body from document_versions where kind in ($1, $2) and body is not null order by kind, id, version`, docs.Process, docs.Standard)
		if err != nil {
			return Report{}, err
		}
		for rows.Next() {
			var v version
			if err := rows.Scan(&v.kind, &v.id, &v.n, &v.body); err != nil {
				rows.Close()
				return Report{}, err
			}
			list = append(list, v)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return Report{}, err
		}
		for _, v := range list {
			o, err := parse(v.body)
			if err != nil {
				continue
			}
			o, recategorised := recategorise(o, "")
			o, placed := place(o)
			if !recategorised && !placed {
				continue
			}
			pretty, err := docs.Pretty(o.bytes())
			if err != nil {
				continue
			}
			if _, err := tx.Exec(ctx, `update document_versions set body = $4 where kind = $1 and id = $2 and version = $3`, v.kind, v.id, v.n, string(pretty)); err != nil {
				return Report{}, err
			}
			versions++
		}
		// working drafts get the same changes in place (their revision stays): publishing one, or
		// saving a never-published document from it, then meets the converted lists
		type draft struct {
			kind, id string
			body     []byte
		}
		var drafts []draft
		rows, err = tx.Query(ctx, `select kind, id, body from working_drafts order by kind, id`)
		if err != nil {
			return Report{}, err
		}
		for rows.Next() {
			var d draft
			if err := rows.Scan(&d.kind, &d.id, &d.body); err != nil {
				rows.Close()
				return Report{}, err
			}
			drafts = append(drafts, d)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return Report{}, err
		}
		for _, d := range drafts {
			o, err := parse(d.body)
			if err != nil {
				continue // left as it is: publishing it is refused by the checks of a save
			}
			o, recategorised := recategorise(o, "")
			o, placed := place(o)
			if !recategorised && !placed {
				continue
			}
			pretty, err := docs.Pretty(o.bytes())
			if err != nil {
				continue
			}
			if _, err := tx.Exec(ctx, `update working_drafts set body = $3 where kind = $1 and id = $2`, d.kind, d.id, string(pretty)); err != nil {
				return Report{}, err
			}
			workingDrafts++
		}
	}

	// adding the paths alone is said as such in the history of the lists and in the activity log
	onlyPaths := pathsAdded > 0 && !movedLists && len(changes) == 0 && len(scoped) == 0
	if catChanged {
		note := Note
		if onlyPaths {
			note = PathsNote
		}
		if _, _, err := docs.SaveIn(ctx, tx, docs.Change{Kind: docs.Catalog, ID: docs.CatalogID, Body: cat.bytes(), By: By, Note: note}); err != nil {
			return Report{}, fmt.Errorf("the lists: %w", err)
		}
	}
	saved := 0
	for _, c := range changes {
		// one document that cannot be saved must not keep the server from starting
		sp, err := tx.Begin(ctx)
		if err != nil {
			return Report{}, err
		}
		if _, _, err := docs.SaveIn(ctx, sp, docs.Change{Kind: c.kind, ID: c.id, Body: c.body, By: By, Note: Note}); err != nil {
			_ = sp.Rollback(ctx)
			log.Warn("not converted: the document cannot be saved", "kind", c.kind, "id", c.id, "error", err)
			continue
		}
		if err := sp.Commit(ctx); err != nil {
			return Report{}, err
		}
		saved++
	}
	converted, dropped := 0, 0
	for _, r := range scoped {
		newRole := ""
		switch {
		case kindOf[r.scope] == "platform":
			newRole = rbac.PlatformOwner
		case kindOf[r.scope] == "practice":
			newRole = rbac.PracticeOwner
		case platforms.ids[r.scope]:
			newRole = rbac.PlatformOwner
		case practices.ids[r.scope]:
			newRole = rbac.PracticeOwner
		}
		if _, err := tx.Exec(ctx, `delete from role_assignments where email = $1 and role = $2 and scope = $3`, r.email, rbac.StandardsEditor, r.scope); err != nil {
			return Report{}, err
		}
		scopeName := r.scope
		if n := teamName[r.scope]; n != "" {
			scopeName = n
		}
		was := rbac.Label(rbac.StandardsEditor) + " for " + scopeName
		if newRole == "" {
			dropped++
			log.Warn("role removed: it was limited to something that is neither a platform nor a practice", "email", r.email, "role", rbac.StandardsEditor, "scope", r.scope)
			if err := audit.AddIn(ctx, tx, By, Name, "access.revoke", r.email, was+" removed: it is neither a platform nor a practice"); err != nil {
				return Report{}, err
			}
			continue
		}
		if _, err := tx.Exec(ctx, `insert into role_assignments (email, role, scope, granted_by) values ($1, $2, $3, $4) on conflict do nothing`,
			r.email, newRole, r.scope, r.by); err != nil {
			return Report{}, err
		}
		converted++
		detail := fmt.Sprintf("%s became %s for the %s %s", was, rbac.Label(newRole), rbac.ScopeNoun(newRole), scopeName)
		log.Info("role converted", "email", r.email, "from", was, "to", rbac.Label(newRole)+" for "+r.scope)
		if err := audit.AddIn(ctx, tx, By, Name, "access.grant", r.email, detail); err != nil {
			return Report{}, err
		}
	}
	summary := fmt.Sprintf("%d documents moved to the new lists (%d older versions and %d working drafts adjusted); added %d practices, %d platforms, %d categories; %d roles converted, %d removed",
		saved, versions, workingDrafts, len(practices.added), len(platforms.added), len(categories.added), converted, dropped)
	if pathsAdded > 0 {
		log.Info("the list of paths added", "entries", pathsAdded)
		if onlyPaths {
			summary = PathsSummary
		} else {
			summary += "; " + PathsSummary
		}
	}
	log.Info("database converted to practices, platforms and categories", "documents", saved, "versions", versions, "workingDrafts", workingDrafts, "practices", len(practices.added),
		"platforms", len(platforms.added), "categories", len(categories.added), "rolesConverted", converted, "rolesRemoved", dropped)
	report := Report{Converted: true, Lists: catChanged, Documents: saved, Versions: versions, Practices: len(practices.added),
		Platforms: len(platforms.added), Categories: len(categories.added), Paths: pathsAdded, RolesConverted: converted, RolesRemoved: dropped}
	return report, audit.AddIn(ctx, tx, By, Name, "content.convert", "lists", summary)
}

// fit makes a text fit a limit of the format: spaces collapsed, cut to n characters. A cut is
// logged, with the whole text.
func fit(log *slog.Logger, what, text string, n int) string {
	t := strings.Join(strings.Fields(text), " ")
	if len([]rune(t)) > n {
		log.Warn("text cut to fit the lists", "what", what, "text", text, "limit", n)
		t = strings.TrimSpace(truncate(t, n))
	}
	return t
}

// slug makes an id out of a free text: "Source control" -> "source-control".
func slug(text string) string {
	plain, _, _ := transform.String(transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC), text)
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(plain) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			if dash && b.Len() > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r)
			dash = false
		} else {
			dash = true
		}
	}
	s := b.String()
	if len(s) > 80 {
		s = strings.TrimRight(s[:80], "-")
	}
	if s == "" {
		return "category"
	}
	return s
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

func raw(s string) json.RawMessage {
	b, _ := json.Marshal(s)
	return b
}

// ---------- JSON objects with their keys in the order they were written

type field struct {
	key   string
	value json.RawMessage
}

type object []field

func parse(body []byte) (object, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, fmt.Errorf("not a JSON object")
	}
	o := object{}
	for dec.More() {
		tok, err := dec.Token()
		key, ok := tok.(string)
		if err != nil || !ok {
			return nil, fmt.Errorf("not a JSON object")
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, err
		}
		o = append(o, field{key, v})
	}
	return o, nil
}

func (o object) index(key string) int {
	for i, f := range o {
		if f.key == key {
			return i
		}
	}
	return -1
}

func (o object) get(key string) (json.RawMessage, bool) {
	if i := o.index(key); i >= 0 {
		return o[i].value, true
	}
	return nil, false
}

func (o object) str(key string) string {
	v, _ := o.get(key)
	var s string
	_ = json.Unmarshal(v, &s)
	return s
}

// with sets a value in its place, or adds it at the end.
func (o object) with(key string, v json.RawMessage) object {
	if i := o.index(key); i >= 0 {
		out := append(object{}, o...)
		out[i].value = v
		return out
	}
	return append(append(object{}, o...), field{key, v})
}

// after sets a value in its place, or adds it right after the last of the keys given that is
// there (at the end when none is).
func (o object) after(key string, v json.RawMessage, keys ...string) object {
	if o.index(key) >= 0 {
		return o.with(key, v)
	}
	last := -1
	for _, k := range keys {
		if i := o.index(k); i > last {
			last = i
		}
	}
	at := len(o)
	if last >= 0 {
		at = last + 1
	}
	out := append(object{}, o[:at]...)
	out = append(out, field{key, v})
	return append(out, o[at:]...)
}

func (o object) without(key string) object {
	out := object{}
	for _, f := range o {
		if f.key != key {
			out = append(out, f)
		}
	}
	return out
}

func (o object) bytes() []byte {
	var b bytes.Buffer
	b.WriteString("{")
	for i, f := range o {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(string(raw(f.key)) + ":")
		b.Write(f.value)
	}
	b.WriteString("}")
	return b.Bytes()
}
