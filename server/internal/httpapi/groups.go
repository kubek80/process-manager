package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

// Groups: the teams, platforms and practices of the lists, as their owners look after them -
// the members of a platform or practice, and the details of one group (its description and how
// to reach it). Owners themselves are given and taken by admins only (Admin › Access).

// groupBodyLimit bounds the body of a call here: an email, or a description and a few links.
const groupBodyLimit = 16 << 10

// group is one team, platform or practice named in the address.
type group struct {
	key   string // "teams", "platforms" or "practices"
	noun  string // "team", "platform", "practice"
	entry docs.Named
}

var groupNouns = map[string]string{"teams": "team", "platforms": "platform", "practices": "practice"}

// the roles of the owners and of the members of each kind of group
var (
	ownerRole  = map[string]string{"teams": rbac.Owner, "platforms": rbac.PlatformOwner, "practices": rbac.PracticeOwner}
	memberRole = map[string]string{"platforms": rbac.PlatformMember, "practices": rbac.PracticeMember}
)

// groupOf finds the group in the address. It answers the request when there is none.
func (a *api) groupOf(w http.ResponseWriter, r *http.Request, lists docs.Lists, withMembers bool) (group, bool) {
	key, id := r.PathValue("kind"), r.PathValue("id")
	noun, ok := groupNouns[key]
	if !ok || (withMembers && memberRole[key] == "") || !docs.ValidID(id) {
		writeError(w, 404, "That does not exist.")
		return group{}, false
	}
	n, ok := find(lists.ByKey(key), id)
	if !ok {
		writeError(w, 404, fmt.Sprintf("There is no %s “%s” in the lists.", noun, id))
		return group{}, false
	}
	return group{key: key, noun: noun, entry: n}, true
}

// ownsGroup: the person is an owner of this group (for a team: has the Owner role for it).
func ownsGroup(s session, g group) bool {
	switch g.key {
	case "teams":
		return slicesContains(s.Owns, g.entry.ID)
	case "platforms":
		return slicesContains(s.Platforms, g.entry.ID)
	case "practices":
		return slicesContains(s.Practices, g.entry.ID)
	}
	return false
}

func slicesContains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// the name of a group in a sentence: the platform “Google Cloud”
func (g group) named() string { return fmt.Sprintf("the %s “%s”", g.noun, g.entry.Name) }

// people is everyone with a role for the group: its owners and its members.
func (a *api) people(ctx context.Context, g group) ([]rbac.Member, error) {
	all, err := a.Roles.Members(ctx)
	if err != nil {
		return nil, err
	}
	out := []rbac.Member{}
	for _, m := range all {
		if m.Scope == g.entry.ID && (m.Role == ownerRole[g.key] || m.Role == memberRole[g.key]) {
			out = append(out, m)
		}
	}
	return out, nil
}

func (a *api) answerPeople(w http.ResponseWriter, r *http.Request, g group, note string) {
	list, err := a.people(r.Context(), g)
	if err == nil {
		err = a.withMemberNames(r.Context(), list)
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	out := map[string]any{"members": list}
	if note != "" {
		out["note"] = note
	}
	writeJSON(w, 200, out)
}

// memberCall reads what every change of the members starts with: the group, the right to
// change its members (an admin, or an owner of that same group), and the person's address.
func (a *api) memberCall(w http.ResponseWriter, r *http.Request, email string) (group, string, bool) {
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return group{}, "", false
	}
	g, ok := a.groupOf(w, r, lists, true)
	if !ok {
		return g, "", false
	}
	if s := who(r); !s.Admin && !ownsGroup(s, g) {
		writeError(w, 403, fmt.Sprintf("Only an owner of %s, or an admin, can add or remove its members.", g.named()))
		return g, "", false
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !docs.Storable(email) || rbac.Check(rbac.Assignment{Email: email, Role: rbac.Admin}) != nil {
		writeError(w, 400, "That is not an email address.")
		return g, "", false
	}
	return g, email, true
}

// roleOf says which role for the group the person has: owner, member or none ("").
func (a *api) roleOf(ctx context.Context, g group, email string) (string, error) {
	u, err := a.Roles.UserOf(ctx, email)
	if err != nil {
		return "", err
	}
	found := ""
	for _, as := range u.Roles {
		if as.Scope != g.entry.ID {
			continue
		}
		switch as.Role {
		case ownerRole[g.key]:
			return "owner", nil
		case memberRole[g.key]:
			found = "member"
		}
	}
	return found, nil
}

// addMember: POST /api/groups/{platforms|practices}/{id}/members {"email"}.
func (a *api) addMember(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, groupBodyLimit)
	var in struct {
		Email string `json:"email"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	g, email, ok := a.memberCall(w, r, in.Email)
	if !ok {
		return
	}
	has, err := a.roleOf(r.Context(), g, email)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if has != "" {
		a.answerPeople(w, r, g, fmt.Sprintf("%s is already %s of %s: nothing changed.", email, map[string]string{"owner": "an owner", "member": "a member"}[has], g.named()))
		return
	}
	role := memberRole[g.key]
	if err := a.Roles.Grant(r.Context(), rbac.Assignment{Email: email, Role: role, Scope: g.entry.ID, GrantedBy: who(r).Email}); err != nil {
		a.fail(w, r, err)
		return
	}
	a.record(r, "access.grant", email, rbac.Label(role)+" for the "+g.noun+" "+g.entry.Name)
	a.answerPeople(w, r, g, "")
}

// removeMember: DELETE /api/groups/{platforms|practices}/{id}/members?email=…
func (a *api) removeMember(w http.ResponseWriter, r *http.Request) {
	g, email, ok := a.memberCall(w, r, r.URL.Query().Get("email"))
	if !ok {
		return
	}
	role := memberRole[g.key]
	err := a.Roles.Revoke(r.Context(), email, role, g.entry.ID)
	if errors.Is(err, rbac.ErrNotGiven) {
		a.answerPeople(w, r, g, fmt.Sprintf("%s is not a member of %s: nothing changed.", email, g.named()))
		return
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	a.record(r, "access.revoke", email, rbac.Label(role)+" for the "+g.noun+" "+g.entry.Name)
	a.answerPeople(w, r, g, "")
}

// detailsInput is what PUT …/details may change. A field left out is not changed; null or ""
// removes it.
type detailsInput struct {
	Description json.RawMessage `json:"description"`
	Contact     json.RawMessage `json:"contact"`
	Contacts    json.RawMessage `json:"contacts"`
}

// detailsTries bounds how often a change of the details is applied again on the newest lists
// when somebody else saved them at the same moment.
const detailsTries = 10

// putDetails: PUT /api/groups/{teams|platforms|practices}/{id}/details. Changes the
// description and how to reach one group, and nothing else, on the newest stored lists; saved
// as a new version of the lists through docs.Store.Save, with every check a save of the lists
// gets.
func (a *api) putDetails(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, groupBodyLimit)
	var raw map[string]json.RawMessage
	if err := readJSON(r, &raw); err != nil {
		a.fail(w, r, err)
		return
	}
	for k := range raw {
		if k != "description" && k != "contact" && k != "contacts" {
			writeError(w, 400, "Only the description and how to reach them can be changed here.")
			return
		}
	}
	lists, err := a.Docs.Lists(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	g, ok := a.groupOf(w, r, lists, false)
	if !ok {
		return
	}
	s := who(r)
	if !s.Admin && !s.Catalog && !ownsGroup(s, g) {
		owner := "an owner"
		if g.key == "teams" {
			owner = "an Owner"
		}
		writeError(w, 403, fmt.Sprintf("Only %s of %s, a lists manager or an admin can change its details.", owner, g.named()))
		return
	}
	set, problem := detailsOf(raw)
	if problem != "" {
		writeError(w, 400, problem)
		return
	}
	if len(set) == 0 {
		writeError(w, 400, "Say what to change: the description, the contact or how to reach them.")
		return
	}
	var changed []string
	for _, f := range []string{"description", "contacts", "contact"} {
		if _, ok := set[f]; ok {
			changed = append(changed, map[string]string{"description": "description", "contacts": "how to reach them", "contact": "other ways to reach them"}[f])
		}
	}
	note := fmt.Sprintf("Details of %s changed by %s: %s", g.named(), nameOrEmail(s), strings.Join(changed, ", "))
	for try := 1; ; try++ {
		cur, err := a.Docs.Get(r.Context(), docs.Catalog, docs.CatalogID)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		body, found, err := withDetails(cur.Body, g.key, g.entry.ID, set)
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if !found { // removed from the lists meanwhile
			writeError(w, 404, fmt.Sprintf("There is no %s “%s” in the lists.", g.noun, g.entry.ID))
			return
		}
		var now docs.Lists
		err = a.validateFormat(docs.Catalog, body)
		if err == nil {
			err = json.Unmarshal(body, &now)
		}
		if err == nil {
			err = docs.Check(docs.Catalog, body, now)
		}
		if err == nil {
			err = a.knownIcons(r.Context(), body)
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		base := cur.Version
		doc, didChange, err := a.Docs.Save(r.Context(), docs.Change{
			Kind: docs.Catalog, ID: docs.CatalogID, Body: body, By: s.Email, Note: note, Base: &base, Log: a.Log,
			After: func(ctx context.Context, tx pgx.Tx, saved docs.Doc) error {
				return audit.AddIn(ctx, tx, s.Email, s.Name, "lists.save", docs.CatalogID, fmt.Sprintf("version %d: %s", saved.Version, note))
			},
		})
		var c *docs.Conflict
		if errors.As(err, &c) && try < detailsTries {
			continue // somebody saved the lists at the same moment: apply the change to theirs
		}
		if errors.As(err, &c) {
			writeError(w, 409, "The lists are being changed by others right now. Try again in a moment.")
			return
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		if didChange {
			a.syncSkills(r.Context(), docs.Catalog, docs.CatalogID)
		}
		w.Header().Set(VersionHeader, fmt.Sprint(doc.Version))
		writeJSON(w, 200, map[string]any{"catalog": json.RawMessage(doc.Body), "version": doc.Version})
		return
	}
}

func nameOrEmail(s session) string {
	if n := strings.TrimSpace(s.Name); n != "" {
		return n
	}
	return s.Email
}

// detailsOf reads the fields to change: each is a JSON value to set, or nil to remove the field.
// The problem is a plain sentence.
func detailsOf(raw map[string]json.RawMessage) (map[string]json.RawMessage, string) {
	set := map[string]json.RawMessage{}
	text := func(field, what string, max int) string {
		v, ok := raw[field]
		if !ok {
			return ""
		}
		if isNull(v) {
			set[field] = nil
			return ""
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return what + " must be a text."
		}
		s, problem := docs.CheckText(s, what, field == "description")
		if problem != "" {
			return problem
		}
		if n := utf8.RuneCountInString(s); n > max {
			return fmt.Sprintf("%s is %d characters long; it can be at most %d.", what, n, max)
		}
		if s == "" {
			set[field] = nil
		} else {
			set[field] = plainJSON(s)
		}
		return ""
	}
	if p := text("description", "The description", 600); p != "" {
		return nil, p
	}
	if p := text("contact", "The other ways to reach them", 120); p != "" {
		return nil, p
	}
	if v, ok := raw["contacts"]; ok {
		if isNull(v) {
			set["contacts"] = nil
			return set, ""
		}
		c, problem := contactsOf(v)
		if problem != "" {
			return nil, problem
		}
		if c.Empty() {
			set["contacts"] = nil
		} else {
			set["contacts"] = plainJSON(c)
		}
	}
	return set, ""
}

// plainJSON writes a value as JSON as the app does, without escaping <, > and &.
func plainJSON(v any) json.RawMessage {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	return bytes.TrimSpace(b.Bytes())
}

func isNull(v json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(v), []byte("null")) }

// contactsOf reads how to reach a group: every field optional, "" or null leaves it out, an
// unknown field is refused. Links are http:// or https:// only.
func contactsOf(v json.RawMessage) (*docs.Contacts, string) {
	var in map[string]json.RawMessage
	if err := json.Unmarshal(v, &in); err != nil {
		return nil, "How to reach them must be a set of fields: email, slack, slackUrl, chat, chatUrl, confluence, page, form."
	}
	var c docs.Contacts
	fields := []struct {
		key, what string
		max       int
		to        *string
	}{
		{"email", "The group email", 120, &c.Email},
		{"slack", "The Slack channel", 80, &c.Slack},
		{"slackUrl", "The link to the Slack channel", 300, &c.SlackURL},
		{"chat", "The Google Chat space", 80, &c.Chat},
		{"chatUrl", "The link to the Google Chat space", 300, &c.ChatURL},
		{"confluence", "The Confluence page", 300, &c.Confluence},
		{"page", "Their page", 300, &c.Page},
		{"form", "The request form", 300, &c.Form},
	}
	known := map[string]bool{}
	for _, f := range fields {
		known[f.key] = true
		v, ok := in[f.key]
		if !ok || isNull(v) {
			continue
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, f.what + " must be a text."
		}
		s, problem := docs.CheckText(s, f.what, false)
		if problem != "" {
			return nil, problem
		}
		if n := utf8.RuneCountInString(s); n > f.max {
			return nil, fmt.Sprintf("%s is %d characters long; it can be at most %d.", f.what, n, f.max)
		}
		*f.to = s
	}
	for k := range in {
		if !known[k] {
			return nil, fmt.Sprintf("There is no way to reach them called “%s”. Use email, slack, slackUrl, chat, chatUrl, confluence, page or form.", k)
		}
	}
	if c.Email != "" && !docs.ValidEmail(c.Email) {
		return nil, "The group email is not an email address."
	}
	for _, l := range []struct{ what, v string }{
		{"The link to the Slack channel", c.SlackURL}, {"The link to the Google Chat space", c.ChatURL},
		{"The Confluence page", c.Confluence}, {"Their page", c.Page}, {"The request form", c.Form},
	} {
		if l.v != "" && !docs.ValidLink(l.v) {
			return nil, l.what + " must be a link that starts with http:// or https://."
		}
	}
	return &c, ""
}

// withDetails changes the fields of one entry of the stored lists and nothing else: every
// other entry, list and field stays byte for byte, in its order. found is false when the entry
// is not there.
func withDetails(body []byte, key, id string, set map[string]json.RawMessage) ([]byte, bool, error) {
	top, err := ordered(body)
	if err != nil {
		return nil, false, err
	}
	i := top.index(key)
	if i < 0 {
		return body, false, nil
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(top[i].value, &entries); err != nil {
		return nil, false, err
	}
	found := false
	for j, e := range entries {
		var head struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(e, &head) != nil || head.ID != id {
			continue
		}
		o, err := ordered(e)
		if err != nil {
			return nil, false, err
		}
		for _, f := range []string{"contact", "contacts", "description"} {
			if v, ok := set[f]; ok {
				o = o.with(f, v)
			}
		}
		entries[j] = o.bytes()
		found = true
	}
	if !found {
		return body, false, nil
	}
	parts := make([][]byte, len(entries))
	for n, e := range entries {
		parts[n] = e
	}
	top[i].value = append(append([]byte("["), bytes.Join(parts, []byte(","))...), ']')
	out, err := docs.Pretty(top.bytes())
	return out, true, err
}

// object is a JSON object with its keys in their order.
type object []member

type member struct {
	key   string
	value json.RawMessage
}

func ordered(b []byte) (object, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, fmt.Errorf("%w: not a JSON object", docs.ErrInvalid)
	}
	var o object
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return nil, err
		}
		k, _ := t.(string)
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, err
		}
		o = append(o, member{k, v})
	}
	return o, nil
}

func (o object) index(key string) int {
	for i, m := range o {
		if m.key == key {
			return i
		}
	}
	return -1
}

// fieldOrder is the order the app writes the fields of an entry in; a new field goes after the
// last one present that comes before it.
var fieldOrder = []string{"id", "name", "contact", "contacts", "url", "icon", "description"}

// with sets a field (nil: removes it).
func (o object) with(key string, v json.RawMessage) object {
	i := o.index(key)
	switch {
	case v == nil && i >= 0:
		return append(o[:i:i], o[i+1:]...)
	case v == nil:
		return o
	case i >= 0:
		o[i].value = v
		return o
	}
	at := len(o)
	rank := map[string]int{}
	for n, k := range fieldOrder {
		rank[k] = n + 1
	}
	if r := rank[key]; r > 0 {
		at = 0
		for n, m := range o {
			if rm := rank[m.key]; rm > 0 && rm < r {
				at = n + 1
			}
		}
	}
	out := append(object{}, o[:at]...)
	out = append(out, member{key, v})
	return append(out, o[at:]...)
}

func (o object) bytes() []byte {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, m := range o {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(m.key)
		b.Write(k)
		b.WriteByte(':')
		b.Write(m.value)
	}
	b.WriteByte('}')
	return b.Bytes()
}
