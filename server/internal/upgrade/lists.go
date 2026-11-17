// Package upgrade converts a database filled by an earlier version of the server to what this
// version expects. Each conversion runs at start, under the lock of the migrations, and finds
// nothing to do when it has run before.
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
//     "security" to the practices (same id, name, contact and description); every team loses
//     its kind and stays a team;
//   - every free-text category of a process or standard becomes an entry of the categories
//     (its id made from the text) and the document names that id;
//   - a process or standard owned by such a platform or practice team belongs to it, unless it
//     already says which platform or practice it belongs to;
//   - a standards editor limited to a unit becomes the owner of the platform or practice made
//     from that unit; one limited to anything else loses the role, and the log says so;
//   - the lists always have the three new lists, empty if need be.
//
// Everything is one transaction, saved as new versions by By with Note, and recorded in the
// activity log. A database that is already converted is left as it is.
func Lists(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return lists(ctx, tx, log) })
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

func lists(ctx context.Context, tx pgx.Tx, log *slog.Logger) error {
	// no save of a server that is still running may come in between reading the documents and
	// writing them back
	if _, err := tx.Exec(ctx, `lock table documents in share row exclusive mode`); err != nil {
		return err
	}
	var catBody []byte
	err := tx.QueryRow(ctx, `select body from documents where kind = $1 and id = $2`, docs.Catalog, docs.CatalogID).Scan(&catBody)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	type doc struct {
		kind, id string
		body     []byte
	}
	var all []doc
	rows, err := tx.Query(ctx, `select kind, id, body from documents where kind in ($1, $2) order by kind = $2, id`, docs.Process, docs.Standard)
	if err != nil {
		return err
	}
	for rows.Next() {
		var d doc
		if err := rows.Scan(&d.kind, &d.id, &d.body); err != nil {
			rows.Close()
			return err
		}
		all = append(all, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if catBody == nil && len(all) == 0 {
		return nil // an empty database is filled with content of this version
	}

	// ----- the lists
	if catBody == nil {
		catBody = []byte(docs.EmptyCatalog) // written only when a category has to be added
	}
	cat, err := parse(catBody)
	if err != nil {
		return fmt.Errorf("the lists: %w", err)
	}
	practices, err := readList(cat, "practices")
	if err != nil {
		return err
	}
	platforms, err := readList(cat, "platforms")
	if err != nil {
		return err
	}
	categories, err := readList(cat, "categories")
	if err != nil {
		return err
	}
	kindOf := map[string]string{} // team id -> "platform" or "practice"
	catChanged := false
	if v, ok := cat.get("teams"); ok {
		var teams []json.RawMessage
		if err := json.Unmarshal(v, &teams); err != nil {
			return fmt.Errorf("teams: %w", err)
		}
		for i, raw := range teams {
			var t oldTeam
			if err := json.Unmarshal(raw, &t); err != nil {
				return fmt.Errorf("teams: %w", err)
			}
			o, err := parse(raw)
			if err != nil {
				return fmt.Errorf("teams: %w", err)
			}
			if _, had := o.get("kind"); !had {
				continue
			}
			teams[i] = o.without("kind").bytes()
			catChanged = true
			switch t.Kind {
			case "platform":
				kindOf[t.ID] = "platform"
				platforms.add(t.ID, entry(t.ID, t.Name, t.Contact, t.Description))
			case "practice", "security":
				kindOf[t.ID] = "practice"
				practices.add(t.ID, entry(t.ID, t.Name, t.Contact, t.Description))
			}
		}
		b, _ := json.Marshal(teams)
		cat = cat.with("teams", b)
	}

	// ----- the documents
	type change struct {
		kind, id string
		body     []byte
	}
	var changes []change
	// every free-text category becomes an entry, in the order of their ids; texts that differ
	// only in how they are written ("Cloud", "cloud") share one, named as a person wrote it
	categoryOf := map[string]string{} // free text -> id
	nameOf := map[string]string{}     // new id -> name
	var newIDs []string
	for _, d := range all {
		var head struct {
			Category string `json:"category"`
		}
		if json.Unmarshal(d.body, &head) != nil || head.Category == "" || categories.ids[head.Category] {
			continue
		}
		text := head.Category
		id := slug(text)
		categoryOf[text] = id
		if categories.ids[id] {
			continue
		}
		name := truncate(strings.Join(strings.Fields(text), " "), 40)
		if _, seen := nameOf[id]; !seen {
			newIDs = append(newIDs, id)
			nameOf[id] = name
		} else if nameOf[id] == id && name != id {
			nameOf[id] = name
		}
	}
	sort.Strings(newIDs)
	for _, id := range newIDs {
		categories.add(id, entry(id, nameOf[id], "", ""))
	}
	for _, d := range all {
		o, err := parse(d.body)
		if err != nil {
			log.Warn("not converted: not a JSON object", "kind", d.kind, "id", d.id)
			continue
		}
		changed := false
		if id, ok := categoryOf[o.str("category")]; ok {
			o = o.with("category", raw(id))
			changed = true
		}
		owner := o.str("owner")
		if kindOf[owner] == "practice" && o.str("practice") == "" {
			o = o.after("practice", raw(owner), "owner", "category")
			changed = true
		}
		if kindOf[owner] == "platform" && o.str("platform") == "" {
			o = o.after("platform", raw(owner), "owner", "category", "practice")
			changed = true
		}
		if changed {
			changes = append(changes, change{d.kind, d.id, o.bytes()})
		}
	}

	// ----- the lists always carry the three new lists
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

	// ----- roles: a standards editor of one unit becomes the owner of its platform or practice
	type role struct{ email, scope, by string }
	var scoped []role
	rows, err = tx.Query(ctx, `select email, scope, granted_by from role_assignments where role = $1 and scope <> '' order by email, scope`, rbac.StandardsEditor)
	if err != nil {
		return err
	}
	for rows.Next() {
		var r role
		if err := rows.Scan(&r.email, &r.scope, &r.by); err != nil {
			rows.Close()
			return err
		}
		scoped = append(scoped, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if !catChanged && len(changes) == 0 && len(scoped) == 0 {
		return nil
	}

	if catChanged {
		if _, _, err := docs.SaveIn(ctx, tx, docs.Change{Kind: docs.Catalog, ID: docs.CatalogID, Body: cat.bytes(), By: By, Note: Note}); err != nil {
			return fmt.Errorf("the lists: %w", err)
		}
	}
	for _, c := range changes {
		if _, _, err := docs.SaveIn(ctx, tx, docs.Change{Kind: c.kind, ID: c.id, Body: c.body, By: By, Note: Note}); err != nil {
			return fmt.Errorf("%s %s: %w", c.kind, c.id, err)
		}
	}
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
			return err
		}
		old := rbac.StandardsEditor + " for " + r.scope
		if newRole == "" {
			log.Warn("role removed: it was limited to something that is neither a platform nor a practice", "email", r.email, "role", rbac.StandardsEditor, "scope", r.scope)
			if err := audit.AddIn(ctx, tx, By, Name, "access.revoke", r.email, old+": no platform or practice "+r.scope); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.Exec(ctx, `insert into role_assignments (email, role, scope, granted_by) values ($1, $2, $3, $4) on conflict do nothing`,
			r.email, newRole, r.scope, r.by); err != nil {
			return err
		}
		detail := fmt.Sprintf("%s became %s for %s %s", old, newRole, rbac.ScopeNoun(newRole), r.scope)
		log.Info("role converted", "email", r.email, "from", old, "to", newRole+" for "+r.scope)
		if err := audit.AddIn(ctx, tx, By, Name, "access.grant", r.email, detail); err != nil {
			return err
		}
	}
	summary := fmt.Sprintf("%d documents moved to the new lists; added %d practices, %d platforms, %d categories; %d roles converted",
		len(changes), len(practices.added), len(platforms.added), len(categories.added), len(scoped))
	log.Info("database converted to practices, platforms and categories", "documents", len(changes), "practices", len(practices.added),
		"platforms", len(platforms.added), "categories", len(categories.added), "roles", len(scoped))
	return audit.AddIn(ctx, tx, By, Name, "content.convert", "lists", summary)
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
