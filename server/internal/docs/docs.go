// Package docs stores the content of the portal: processes, standards and the lists.
// Every save is a new version; nothing is ever overwritten without a trace.
package docs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Kinds of document.
const (
	Process  = "process"
	Standard = "standard"
	Catalog  = "catalog"
	// CatalogID is the id of the single catalog document.
	CatalogID = "catalog"
)

var (
	// ErrInvalid marks input the caller must fix.
	ErrInvalid = errors.New("invalid")
	// ErrNotFound is returned when a document or version does not exist.
	ErrNotFound = errors.New("not found")

	idPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
)

// ValidID reports whether id is a well-formed document id.
func ValidID(id string) bool { return len(id) <= 80 && idPattern.MatchString(id) }

// ValidKind reports whether kind is one this store holds.
func ValidKind(kind string) bool { return kind == Process || kind == Standard || kind == Catalog }

// Doc is the current version of a document.
type Doc struct {
	Kind      string
	ID        string
	Version   int
	Body      json.RawMessage
	UpdatedAt time.Time
	UpdatedBy string
	// CreatedAt is when the document was added: when its first version was saved (since it was
	// last deleted, if it ever was).
	CreatedAt time.Time
}

// Version describes one saved version.
type Version struct {
	Version int       `json:"version"`
	SavedAt time.Time `json:"savedAt"`
	SavedBy string    `json:"savedBy"`
	Note    string    `json:"note"` // what changed, in the words of whoever saved it
	Deleted bool      `json:"deleted"`
	// What the document belonged to and its status in this version: who may see it follows
	// from them (a version that was a draft stays with the people who work on the document).
	Owner    string `json:"-"`
	Platform string `json:"-"`
	Practice string `json:"-"`
	Status   string `json:"-"`
}

// Storable reports whether text can be stored: the database refuses a NUL character and
// anything that is not valid UTF-8.
func Storable(text string) bool { return utf8.ValidString(text) && !strings.ContainsRune(text, 0) }

// Conflict is returned when a change was made from a version that is no longer the current
// one: somebody else saved (or deleted) in between. Current is the zero Doc when the document
// does not exist.
type Conflict struct {
	Current Doc
	Exists  bool
}

func (c *Conflict) Error() string {
	if !c.Exists {
		return "the document no longer exists"
	}
	return fmt.Sprintf("the document was changed in the meantime: it is now at version %d", c.Current.Version)
}

// MaxNote is the longest note kept with a version.
const MaxNote = 300

// Change is one save.
type Change struct {
	Kind, ID string
	Body     []byte
	By       string // email of whoever saves
	Note     string // what changed; optional
	// Base is the version the change was made from. nil skips the check (imports); 0 means
	// "I am creating this": the save is refused when the document already exists.
	Base *int
	// Check runs under the lock with the stored document (nil when there is none), before
	// anything is written: the place for rights that depend on the stored owner.
	Check func(current *Doc) error
	// After runs in the same transaction when a new version was written.
	After func(ctx context.Context, tx pgx.Tx, saved Doc) error
	// Drafts says what happens when the document has a working draft (see DraftRule).
	Drafts DraftRule
	// Revision is the revision of the working draft that is published (Drafts: PublishDraft).
	Revision int
	// Log is told when a working draft is dropped; nil: the default logger.
	Log *slog.Logger
}

// Removal is one delete.
type Removal struct {
	Kind, ID string
	By       string
	Base     *int
	Check    func(current *Doc) error
	After    func(ctx context.Context, tx pgx.Tx) error
}

// lock serialises every change to one document, including creating it: without it two first
// saves of the same id race for version 1.
func lock(ctx context.Context, tx pgx.Tx, kind, id string) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 7461))`, kind+"/"+id)
	return err
}

func current(ctx context.Context, tx pgx.Tx, kind, id string) (*Doc, error) {
	d := Doc{}
	err := tx.QueryRow(ctx, `select kind, id, version, body, updated_at, updated_by, created_at from documents where kind = $1 and id = $2`, kind, id).
		Scan(&d.Kind, &d.ID, &d.Version, &d.Body, &d.UpdatedAt, &d.UpdatedBy, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func checkBase(base *int, cur *Doc) error {
	if base == nil {
		return nil
	}
	have := 0
	if cur != nil {
		have = cur.Version
	}
	if *base == have {
		return nil
	}
	if cur == nil {
		return &Conflict{}
	}
	return &Conflict{Current: *cur, Exists: true}
}

type Store struct {
	Pool *pgxpool.Pool
	// Log is told what an import does to working drafts; nil: the default logger.
	Log *slog.Logger
}

// Pretty re-indents JSON without changing the order of the keys.
func Pretty(body []byte) ([]byte, error) {
	var buf bytes.Buffer
	if err := json.Indent(&buf, bytes.TrimSpace(body), "", "  "); err != nil {
		return nil, fmt.Errorf("%w: not valid JSON: %v", ErrInvalid, err)
	}
	return buf.Bytes(), nil
}

// List returns the current documents of one kind, ordered by id.
func (s *Store) List(ctx context.Context, kind string) ([]Doc, error) {
	rows, err := s.Pool.Query(ctx, `select kind, id, version, body, updated_at, updated_by, created_at from documents where kind = $1 order by id`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Doc{}
	for rows.Next() {
		var d Doc
		if err := rows.Scan(&d.Kind, &d.ID, &d.Version, &d.Body, &d.UpdatedAt, &d.UpdatedBy, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Get returns one document.
func (s *Store) Get(ctx context.Context, kind, id string) (Doc, error) {
	var d Doc
	err := s.Pool.QueryRow(ctx, `select kind, id, version, body, updated_at, updated_by, created_at from documents where kind = $1 and id = $2`, kind, id).
		Scan(&d.Kind, &d.ID, &d.Version, &d.Body, &d.UpdatedAt, &d.UpdatedBy, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

// Put saves a document as a new version without checking what it was based on. See Save.
// A working draft of the document is kept (see KeepDraft).
func (s *Store) Put(ctx context.Context, kind, id string, body []byte, by string) (Doc, bool, error) {
	return s.Save(ctx, Change{Kind: kind, ID: id, Body: body, By: by, Log: s.Log})
}

// Save stores a document as a new version. The body must be a JSON object; except for the
// catalog its "id" must equal the id. Saving an unchanged body creates no version
// (changed=false). A *Conflict is returned when c.Base is not the current version.
func (s *Store) Save(ctx context.Context, c Change) (doc Doc, changed bool, err error) {
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		doc, changed, err = SaveIn(ctx, tx, c)
		return err
	})
	if err != nil {
		return Doc{}, false, err
	}
	return doc, changed, nil
}

// SaveIn is Save inside a transaction of the caller, for changes that must go together with
// others (converting an older database).
func SaveIn(ctx context.Context, tx pgx.Tx, c Change) (doc Doc, changed bool, err error) {
	kind, id := c.Kind, c.ID
	if !ValidKind(kind) || !ValidID(id) || (kind == Catalog && id != CatalogID) {
		return doc, false, fmt.Errorf("%w: id %q", ErrInvalid, id)
	}
	var head struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(c.Body, &head); err != nil {
		return doc, false, fmt.Errorf("%w: not a JSON object: %v", ErrInvalid, err)
	}
	if kind != Catalog && head.ID != id {
		return doc, false, fmt.Errorf("%w: the id in the document (%q) must match the address (%q)", ErrInvalid, head.ID, id)
	}
	if !utf8.Valid(c.Body) {
		return doc, false, fmt.Errorf("%w: the document contains characters that are not valid text", ErrInvalid)
	}
	pretty, err := Pretty(c.Body)
	if err != nil {
		return doc, false, err
	}
	if !Storable(c.Note) {
		return doc, false, fmt.Errorf("%w: the note contains characters that are not valid text", ErrInvalid)
	}
	note := strings.TrimSpace(c.Note)
	if r := []rune(note); len(r) > MaxNote {
		note = string(r[:MaxNote])
	}
	if err := lock(ctx, tx, kind, id); err != nil {
		return doc, false, err
	}
	cur, err := current(ctx, tx, kind, id)
	if err != nil {
		return doc, false, err
	}
	if c.Check != nil {
		if err := c.Check(cur); err != nil {
			return doc, false, err
		}
	}
	// a draft that was published or discarded by someone else in the meantime is said first:
	// that, rather than a newer version, is what the person needs to know
	var draft *WorkingDraft
	if c.Drafts != KeepDraft && cur != nil {
		if draft, err = draftIn(ctx, tx, kind, id); err != nil {
			return doc, false, err
		}
	}
	if c.Drafts == PublishDraft && (draft == nil || draft.Revision != c.Revision) {
		return doc, false, &DraftConflict{Current: draft}
	}
	if err := checkBase(c.Base, cur); err != nil {
		return doc, false, err
	}
	switch {
	case c.Drafts == RefuseIfDraft && draft != nil:
		return doc, false, &DraftPending{Draft: *draft, Status: StatusOf(cur.Body), NewStatus: StatusOf(pretty)}
	case c.Drafts == PublishDraft:
		if _, err := tx.Exec(ctx, `delete from working_drafts where kind = $1 and id = $2`, kind, id); err != nil {
			return doc, false, err
		}
	}
	if cur != nil && bytes.Equal(cur.Body, pretty) {
		return *cur, false, nil
	}
	// continue the numbering even if the document was deleted in between
	var next int
	if err := tx.QueryRow(ctx, `select coalesce(max(version), 0) + 1 from document_versions where kind = $1 and id = $2`, kind, id).Scan(&next); err != nil {
		return doc, false, err
	}
	err = tx.QueryRow(ctx, `insert into documents (kind, id, version, body, updated_by) values ($1, $2, $3, $4, $5)
		on conflict (kind, id) do update set version = excluded.version, body = excluded.body, updated_by = excluded.updated_by, updated_at = now()
		returning kind, id, version, body, updated_at, updated_by, created_at`, kind, id, next, pretty, c.By).
		Scan(&doc.Kind, &doc.ID, &doc.Version, &doc.Body, &doc.UpdatedAt, &doc.UpdatedBy, &doc.CreatedAt)
	if err != nil {
		return doc, false, err
	}
	if _, err := tx.Exec(ctx, `insert into document_versions (kind, id, version, body, saved_by, note) values ($1, $2, $3, $4, $5, $6)`, kind, id, next, pretty, c.By, note); err != nil {
		return doc, false, err
	}
	// Only a published document has a working draft. A save that is allowed to go past one
	// (an import, the conversion of older content) and makes the document unpublished drops it.
	if c.Drafts == KeepDraft && cur != nil && StatusOf(pretty) == "draft" {
		if err := dropDraftIn(ctx, tx, kind, id, c.Log); err != nil {
			return doc, false, err
		}
	}
	if c.After != nil {
		if err := c.After(ctx, tx, doc); err != nil {
			return doc, false, err
		}
	}
	return doc, true, nil
}

// Delete removes a document and records the deletion in its history. See Remove.
func (s *Store) Delete(ctx context.Context, kind, id, by string) error {
	return s.Remove(ctx, Removal{Kind: kind, ID: id, By: by})
}

// Remove deletes a document and records the deletion in its history.
func (s *Store) Remove(ctx context.Context, r Removal) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, r.Kind, r.ID); err != nil {
			return err
		}
		cur, err := current(ctx, tx, r.Kind, r.ID)
		if err != nil {
			return err
		}
		if cur == nil {
			return ErrNotFound
		}
		if r.Check != nil {
			if err := r.Check(cur); err != nil {
				return err
			}
		}
		if err := checkBase(r.Base, cur); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from documents where kind = $1 and id = $2`, r.Kind, r.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into document_versions (kind, id, version, body, saved_by)
			select $1, $2, coalesce(max(version), 0) + 1, null, $3 from document_versions where kind = $1 and id = $2`, r.Kind, r.ID, r.By); err != nil {
			return err
		}
		if r.After != nil {
			return r.After(ctx, tx)
		}
		return nil
	})
}

// History lists the versions of a document, newest first.
func (s *Store) History(ctx context.Context, kind, id string) ([]Version, error) {
	rows, err := s.Pool.Query(ctx, `select version, saved_at, saved_by, note, body is null, coalesce(body->>'owner', ''),
		coalesce(body->>'platform', ''), coalesce(body->>'practice', ''), coalesce(body->>'status', '')
		from document_versions where kind = $1 and id = $2 order by version desc`, kind, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		var v Version
		if err := rows.Scan(&v.Version, &v.SavedAt, &v.SavedBy, &v.Note, &v.Deleted, &v.Owner, &v.Platform, &v.Practice, &v.Status); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// LastDeletion returns the version that records the most recent deletion of a document, or 0
// when it was never deleted.
func (s *Store) LastDeletion(ctx context.Context, kind, id string) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select coalesce(max(version), 0) from document_versions where kind = $1 and id = $2 and body is null`, kind, id).Scan(&n)
	return n, err
}

// VersionBody returns the body of one saved version.
func (s *Store) VersionBody(ctx context.Context, kind, id string, version int) (json.RawMessage, error) {
	var body []byte
	err := s.Pool.QueryRow(ctx, `select body from document_versions where kind = $1 and id = $2 and version = $3`, kind, id, version).Scan(&body)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && body == nil) {
		return nil, ErrNotFound
	}
	return body, err
}

// CountKind returns how many documents of one kind exist.
func (s *Store) CountKind(ctx context.Context, kind string) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from documents where kind = $1`, kind).Scan(&n)
	return n, err
}

// Count returns how many documents exist; zero means the database has never been filled.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from documents`).Scan(&n)
	return n, err
}

// folders maps the kinds to their folder in an import or export directory.
var folders = map[string]string{Process: "processes", Standard: "standards"}

// ImportDir loads processes/*.json, standards/*.json and catalog/catalog.json from dir.
// It returns how many documents were added or changed. Files that validate refuses (nil: no
// check) are reported and skipped; nothing is deleted.
func (s *Store) ImportDir(ctx context.Context, dir, by string, validate func(kind string, body []byte) error) (changed int, problems []string, err error) {
	put := func(kind, id, file string) {
		data, readErr := os.ReadFile(file)
		if readErr != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", file, readErr))
			return
		}
		if validate != nil {
			if err := validate(kind, data); err != nil {
				problems = append(problems, fmt.Sprintf("%s: %v", file, err))
				return
			}
		}
		_, did, putErr := s.Put(ctx, kind, id, data, by)
		if putErr != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", file, putErr))
			return
		}
		if did {
			changed++
			// unpublished changes stay; publishing them later shows that the document moved on
			var by string
			if s.Pool.QueryRow(ctx, `select updated_by from working_drafts where kind = $1 and id = $2`, kind, id).Scan(&by) == nil {
				log := s.Log
				if log == nil {
					log = slog.Default()
				}
				log.Info("imported over a document that has unpublished changes: they are kept, and whoever publishes them is told that the document changed in the meantime",
					"kind", kind, "id", id, "lastSavedBy", by)
			}
		}
	}
	if file := filepath.Join(dir, "catalog", "catalog.json"); exists(file) {
		put(Catalog, CatalogID, file)
	}
	for _, kind := range []string{Process, Standard} {
		entries, readErr := os.ReadDir(filepath.Join(dir, folders[kind]))
		if readErr != nil {
			continue // a missing folder just means there is nothing of that kind
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			put(kind, strings.TrimSuffix(e.Name(), ".json"), filepath.Join(dir, folders[kind], e.Name()))
		}
	}
	return changed, problems, nil
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ExportDir writes every document to dir in the layout ImportDir reads: a backup that can be
// committed to git. Files of documents that no longer exist are removed.
func (s *Store) ExportDir(ctx context.Context, dir string) (int, error) {
	n := 0
	write := func(path string, body []byte) error {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		n++
		return os.WriteFile(path, append(bytes.TrimSpace(body), '\n'), 0o644)
	}
	if cat, err := s.Get(ctx, Catalog, CatalogID); err == nil {
		if err := write(filepath.Join(dir, "catalog", "catalog.json"), cat.Body); err != nil {
			return n, err
		}
	} else if !errors.Is(err, ErrNotFound) {
		return n, err
	}
	for _, kind := range []string{Process, Standard} {
		list, err := s.List(ctx, kind)
		if err != nil {
			return n, err
		}
		keep := map[string]bool{}
		for _, d := range list {
			keep[d.ID+".json"] = true
			if err := write(filepath.Join(dir, folders[kind], d.ID+".json"), d.Body); err != nil {
				return n, err
			}
		}
		entries, _ := os.ReadDir(filepath.Join(dir, folders[kind]))
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") && !keep[e.Name()] {
				if err := os.Remove(filepath.Join(dir, folders[kind], e.Name())); err != nil {
					return n, err
				}
			}
		}
	}
	return n, nil
}

// ---------- reading documents

// Target is what feedback and permissions need to know about a process or a standard.
type Target struct {
	Kind     string
	ID       string
	Title    string
	Owner    string            // team id
	Platform string            // platform id
	Practice string            // practice id
	Status   string            // "" counts as active
	Items    map[string]string // step or requirement id -> fingerprint of its content
	Titles   map[string]string // step or requirement id -> title
}

// TargetOf reads a process or standard. ok is false for anything else or unparsable bodies.
func TargetOf(d Doc) (Target, bool) {
	if d.Kind != Process && d.Kind != Standard {
		return Target{}, false
	}
	var p struct {
		Title        string            `json:"title"`
		Owner        string            `json:"owner"`
		Platform     string            `json:"platform"`
		Practice     string            `json:"practice"`
		Status       string            `json:"status"`
		Steps        []json.RawMessage `json:"steps"`
		Requirements []json.RawMessage `json:"requirements"`
	}
	if json.Unmarshal(d.Body, &p) != nil {
		return Target{}, false
	}
	t := Target{Kind: d.Kind, ID: d.ID, Title: p.Title, Owner: p.Owner, Platform: p.Platform, Practice: p.Practice, Status: p.Status, Items: map[string]string{}, Titles: map[string]string{}}
	items := p.Steps
	if d.Kind == Standard {
		items = p.Requirements
	}
	for _, raw := range items {
		var item map[string]any
		if json.Unmarshal(raw, &item) != nil {
			continue
		}
		id, _ := item["id"].(string)
		if id == "" {
			continue
		}
		t.Items[id] = Fingerprint(item)
		t.Titles[id], _ = item["title"].(string)
	}
	return t, true
}

// Fingerprint changes whenever anything in the value changes. encoding/json sorts map keys,
// so formatting and key order do not affect it.
func Fingerprint(v any) string {
	canonical, _ := json.Marshal(v)
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:8])
}

// Named is an entry of one of the lists.
type Named struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Contact     string `json:"contact,omitempty"`
	URL         string `json:"url,omitempty"`
	Description string `json:"description,omitempty"`
}

// Lists is the catalog document. A list that is missing is empty.
type Lists struct {
	Tiers        []Named `json:"tiers"`
	Environments []Named `json:"environments"`
	Languages    []Named `json:"languages"`
	Teams        []Named `json:"teams"`
	Practices    []Named `json:"practices"`
	Platforms    []Named `json:"platforms"`
	Categories   []Named `json:"categories"`
	Tools        []Named `json:"tools"`
}

// EmptyCatalog is served before any lists exist.
const EmptyCatalog = `{"tiers":[],"environments":[],"languages":[],"teams":[],"practices":[],"platforms":[],"categories":[],"tools":[]}`

// Lists returns the catalog. A missing catalog is empty, not an error.
func (s *Store) Lists(ctx context.Context) (Lists, error) {
	var l Lists
	d, err := s.Get(ctx, Catalog, CatalogID)
	if errors.Is(err, ErrNotFound) {
		return l, nil
	}
	if err != nil {
		return l, err
	}
	return l, json.Unmarshal(d.Body, &l)
}

// Name looks an id up in a list and falls back to the id itself.
func Name(list []Named, id string) string {
	for _, n := range list {
		if n.ID == id {
			return n.Name
		}
	}
	return id
}

// Names resolves several ids, keeping their order.
func Names(list []Named, ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, Name(list, id))
	}
	return out
}

func find(list []Named, id string) (Named, bool) {
	for _, n := range list {
		if n.ID == id {
			return n, true
		}
	}
	return Named{}, false
}

// Team finds a team.
func (l Lists) Team(id string) (Named, bool) { return find(l.Teams, id) }

// Platform finds a platform.
func (l Lists) Platform(id string) (Named, bool) { return find(l.Platforms, id) }

// Practice finds a practice.
func (l Lists) Practice(id string) (Named, bool) { return find(l.Practices, id) }

// Category finds a category.
func (l Lists) Category(id string) (Named, bool) { return find(l.Categories, id) }

// ByKey returns one list by its key in the document ("teams", "platforms", ...).
func (l Lists) ByKey(key string) []Named {
	switch key {
	case "tiers":
		return l.Tiers
	case "environments":
		return l.Environments
	case "languages":
		return l.Languages
	case "teams":
		return l.Teams
	case "practices":
		return l.Practices
	case "platforms":
		return l.Platforms
	case "categories":
		return l.Categories
	case "tools":
		return l.Tools
	}
	return nil
}
