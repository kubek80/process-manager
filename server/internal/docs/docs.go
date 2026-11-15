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
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

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
}

// Version describes one saved version.
type Version struct {
	Version int       `json:"version"`
	SavedAt time.Time `json:"savedAt"`
	SavedBy string    `json:"savedBy"`
	Deleted bool      `json:"deleted"`
}

type Store struct{ Pool *pgxpool.Pool }

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
	rows, err := s.Pool.Query(ctx, `select kind, id, version, body, updated_at, updated_by from documents where kind = $1 order by id`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Doc{}
	for rows.Next() {
		var d Doc
		if err := rows.Scan(&d.Kind, &d.ID, &d.Version, &d.Body, &d.UpdatedAt, &d.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Get returns one document.
func (s *Store) Get(ctx context.Context, kind, id string) (Doc, error) {
	var d Doc
	err := s.Pool.QueryRow(ctx, `select kind, id, version, body, updated_at, updated_by from documents where kind = $1 and id = $2`, kind, id).
		Scan(&d.Kind, &d.ID, &d.Version, &d.Body, &d.UpdatedAt, &d.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

// Put saves a document as a new version. The body must be a JSON object; except for the
// catalog its "id" must equal id. Saving an unchanged body creates no version (changed=false).
func (s *Store) Put(ctx context.Context, kind, id string, body []byte, by string) (doc Doc, changed bool, err error) {
	if !ValidKind(kind) || !ValidID(id) || (kind == Catalog && id != CatalogID) {
		return doc, false, fmt.Errorf("%w: id %q", ErrInvalid, id)
	}
	var head struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &head); err != nil {
		return doc, false, fmt.Errorf("%w: not a JSON object: %v", ErrInvalid, err)
	}
	if kind != Catalog && head.ID != id {
		return doc, false, fmt.Errorf("%w: the id in the document (%q) must match the address (%q)", ErrInvalid, head.ID, id)
	}
	pretty, err := Pretty(body)
	if err != nil {
		return doc, false, err
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var current []byte
		err := tx.QueryRow(ctx, `select body from documents where kind = $1 and id = $2 for update`, kind, id).Scan(&current)
		if err == nil && bytes.Equal(current, pretty) {
			return nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		// continue the numbering even if the document was deleted in between
		var next int
		if err := tx.QueryRow(ctx, `select coalesce(max(version), 0) + 1 from document_versions where kind = $1 and id = $2`, kind, id).Scan(&next); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into documents (kind, id, version, body, updated_by) values ($1, $2, $3, $4, $5)
			on conflict (kind, id) do update set version = excluded.version, body = excluded.body, updated_by = excluded.updated_by, updated_at = now()`,
			kind, id, next, pretty, by); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `insert into document_versions (kind, id, version, body, saved_by) values ($1, $2, $3, $4, $5)`, kind, id, next, pretty, by)
		changed = err == nil
		return err
	})
	if err != nil {
		return doc, false, err
	}
	doc, err = s.Get(ctx, kind, id)
	return doc, changed, err
}

// Delete removes a document and records the deletion in its history.
func (s *Store) Delete(ctx context.Context, kind, id, by string) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `delete from documents where kind = $1 and id = $2`, kind, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		_, err = tx.Exec(ctx, `insert into document_versions (kind, id, version, body, saved_by)
			select $1, $2, coalesce(max(version), 0) + 1, null, $3 from document_versions where kind = $1 and id = $2`, kind, id, by)
		return err
	})
}

// History lists the versions of a document, newest first.
func (s *Store) History(ctx context.Context, kind, id string) ([]Version, error) {
	rows, err := s.Pool.Query(ctx, `select version, saved_at, saved_by, body is null from document_versions where kind = $1 and id = $2 order by version desc`, kind, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		var v Version
		if err := rows.Scan(&v.Version, &v.SavedAt, &v.SavedBy, &v.Deleted); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
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

// Count returns how many documents exist; zero means the database has never been filled.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from documents`).Scan(&n)
	return n, err
}

// folders maps the kinds to their folder in an import or export directory.
var folders = map[string]string{Process: "processes", Standard: "standards"}

// ImportDir loads processes/*.json, standards/*.json and catalog/catalog.json from dir.
// It returns how many documents were added or changed. Files that are not valid are reported
// and skipped; nothing is deleted.
func (s *Store) ImportDir(ctx context.Context, dir, by string) (changed int, problems []string, err error) {
	put := func(kind, id, file string) {
		data, readErr := os.ReadFile(file)
		if readErr != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", file, readErr))
			return
		}
		_, did, putErr := s.Put(ctx, kind, id, data, by)
		if putErr != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", file, putErr))
			return
		}
		if did {
			changed++
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
	Kind   string
	ID     string
	Title  string
	Owner  string            // team or unit id
	Status string            // "" counts as active
	Items  map[string]string // step or requirement id -> fingerprint of its content
	Titles map[string]string // step or requirement id -> title
}

// TargetOf reads a process or standard. ok is false for anything else or unparsable bodies.
func TargetOf(d Doc) (Target, bool) {
	if d.Kind != Process && d.Kind != Standard {
		return Target{}, false
	}
	var p struct {
		Title        string            `json:"title"`
		Owner        string            `json:"owner"`
		Status       string            `json:"status"`
		Steps        []json.RawMessage `json:"steps"`
		Requirements []json.RawMessage `json:"requirements"`
	}
	if json.Unmarshal(d.Body, &p) != nil {
		return Target{}, false
	}
	t := Target{Kind: d.Kind, ID: d.ID, Title: p.Title, Owner: p.Owner, Status: p.Status, Items: map[string]string{}, Titles: map[string]string{}}
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
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind,omitempty"`
	Contact string `json:"contact,omitempty"`
	URL     string `json:"url,omitempty"`
}

// Lists is the catalog document.
type Lists struct {
	Tiers        []Named `json:"tiers"`
	Environments []Named `json:"environments"`
	Languages    []Named `json:"languages"`
	Teams        []Named `json:"teams"`
	Tools        []Named `json:"tools"`
}

// EmptyCatalog is served before any lists exist.
const EmptyCatalog = `{"tiers":[],"environments":[],"languages":[],"teams":[],"tools":[]}`

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

// Team finds a team or unit.
func (l Lists) Team(id string) (Named, bool) {
	for _, t := range l.Teams {
		if t.ID == id {
			return t, true
		}
	}
	return Named{}, false
}
