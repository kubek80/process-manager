package docs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// Working drafts: unpublished changes to a PUBLISHED process or standard (status active or
// deprecated), kept beside it, one per document and shared by everyone who may edit it. The
// document, its versions, its skills and the search index know nothing of it until it is
// published - which is an ordinary save (Save with PublishDraft), so there is still exactly one
// way a version comes into being. A document that was never published (status "draft") has no
// working draft: it is saved the ordinary way.

// MaxDraftBytes is the largest working draft that is stored, measured on the body as it was
// sent: the same limit as for any save (the server refuses a larger request before it is read).
const MaxDraftBytes = 1 << 20

// MaxDraftDepth is how many levels of objects and lists inside one another a draft may have. A
// process or standard needs about six; the limit only stops bodies built to be expensive.
const MaxDraftDepth = 32

// WorkingDraft is the unpublished changes to one document.
type WorkingDraft struct {
	Kind, ID  string
	Body      json.RawMessage
	Base      int // the version of the document the draft was started from (or moved on to)
	Revision  int // grows with every save of the draft
	UpdatedAt time.Time
	UpdatedBy string
	// UpdatedByName is the name of whoever saved it last, as the sign-in gave it; "" when unknown.
	UpdatedByName string
}

// Info is what a list says about the draft.
func (d WorkingDraft) Info() DraftInfo {
	return DraftInfo{UpdatedAt: d.UpdatedAt, UpdatedBy: d.UpdatedBy, UpdatedByName: d.UpdatedByName}
}

// DraftInfo is what a list says about a working draft: who saved it last (email, and the name
// when it is known), and when.
type DraftInfo struct {
	UpdatedAt     time.Time `json:"updatedAt"`
	UpdatedBy     string    `json:"updatedBy"`
	UpdatedByName string    `json:"updatedByName,omitempty"`
}

// DraftRule says what a save does when the document has a working draft.
type DraftRule int

const (
	// KeepDraft: the working draft stays as it is; its base is not moved, so publishing it later
	// meets the ordinary version conflict (or is rebased, when only a review confirmation came
	// in between). For saves that are no person's editing: imports, the conversion of older
	// content, review confirmations (which move the base themselves, see MoveDraftBaseIn). When such a save makes the document unpublished
	// (status "draft"), the working draft is dropped and that is logged: only a published
	// document has one.
	KeepDraft DraftRule = iota
	// RefuseIfDraft: the save is refused with a *DraftPending. For people's ordinary saves:
	// changes to a document that has unpublished changes go through those, and unpublishing or
	// retiring it waits until they are published or discarded.
	RefuseIfDraft
	// PublishDraft: the save publishes the working draft of revision Change.Revision and removes
	// it in the same transaction. When it is gone or has another revision: *DraftConflict.
	PublishDraft
)

var (
	// ErrNeverPublished: a working draft is only for a published document.
	ErrNeverPublished = errors.New("the document was never published")
)

// DraftPending refuses an ordinary save while the document has unpublished changes.
type DraftPending struct {
	Draft     WorkingDraft
	Status    string // of the stored document
	NewStatus string // of the refused save
}

func (d *DraftPending) Error() string {
	return fmt.Sprintf("the document has unpublished changes by %s", d.Draft.UpdatedBy)
}

// DraftConflict is returned when a working draft was saved, published or discarded by somebody
// else since the caller read it. Current is nil when there is none any more.
type DraftConflict struct{ Current *WorkingDraft }

func (c *DraftConflict) Error() string {
	if c.Current == nil {
		return "the working draft no longer exists"
	}
	return fmt.Sprintf("the working draft was changed in the meantime: it is now at revision %d", c.Current.Revision)
}

// StatusOf reads the status of a process or standard; "" counts as active.
func StatusOf(body []byte) string {
	var head struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(body, &head)
	return head.Status
}

// Published reports whether a document is published: active (or without a status) or retired.
func Published(body []byte) bool { return StatusOf(body) != "draft" }

func draftIn(ctx context.Context, q pgx.Tx, kind, id string) (*WorkingDraft, error) {
	d := WorkingDraft{}
	err := q.QueryRow(ctx, `select kind, id, body, base, revision, updated_at, updated_by, updated_by_name from working_drafts where kind = $1 and id = $2`, kind, id).
		Scan(&d.Kind, &d.ID, &d.Body, &d.Base, &d.Revision, &d.UpdatedAt, &d.UpdatedBy, &d.UpdatedByName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func dropDraftIn(ctx context.Context, tx pgx.Tx, kind, id string, log *slog.Logger) error {
	var by string
	err := tx.QueryRow(ctx, `delete from working_drafts where kind = $1 and id = $2 returning updated_by`, kind, id).Scan(&by)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if log == nil {
		log = slog.Default()
	}
	log.Warn("unpublished changes dropped: the document is no longer published, and only a published document keeps unpublished changes",
		"kind", kind, "id", id, "lastSavedBy", by)
	return nil
}

// GetDraft returns the working draft of a document, or ErrNotFound.
func (s *Store) GetDraft(ctx context.Context, kind, id string) (WorkingDraft, error) {
	var d WorkingDraft
	err := s.Pool.QueryRow(ctx, `select kind, id, body, base, revision, updated_at, updated_by, updated_by_name from working_drafts where kind = $1 and id = $2`, kind, id).
		Scan(&d.Kind, &d.ID, &d.Body, &d.Base, &d.Revision, &d.UpdatedAt, &d.UpdatedBy, &d.UpdatedByName)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

// Drafts says which documents of one kind have a working draft, by id: one query for a list.
func (s *Store) Drafts(ctx context.Context, kind string) (map[string]DraftInfo, error) {
	rows, err := s.Pool.Query(ctx, `select id, updated_at, updated_by, updated_by_name from working_drafts where kind = $1`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]DraftInfo{}
	for rows.Next() {
		var id string
		var d DraftInfo
		if err := rows.Scan(&id, &d.UpdatedAt, &d.UpdatedBy, &d.UpdatedByName); err != nil {
			return nil, err
		}
		out[id] = d
	}
	return out, rows.Err()
}

// DraftChange is one save of a working draft.
type DraftChange struct {
	Kind, ID string
	Body     []byte
	By       string
	ByName   string // the name of whoever saves, "" when not known
	// Revision is the revision the change was made from; 0 means "I am starting one": refused
	// when one exists.
	Revision int
	// Base, when given with Revision 0, starts the draft on that version of the document: the
	// current one or an older one (somebody re-creates their draft on the version their work
	// came from, after it was discarded or published meanwhile; publishing it then meets the
	// newer version). With Revision > 0 it moves the draft onto that version, which must be the
	// current one (the person took over what was published since). nil: a new draft starts from
	// the current version, an existing one keeps its base.
	Base *int
	// Check runs under the lock with the stored document, before anything is written: rights.
	Check func(current Doc) error
}

// CheckDraftBody is what a working draft must satisfy to be stored. It need not pass the format
// or the checker - an unfinished draft can be saved - but it must be a JSON object whose "id" is
// the id in the address, hold only text that can be stored, be at most MaxDraftBytes long as
// sent and at most MaxDraftDepth levels deep. It returns the body as stored (re-indented, the
// order of the keys kept).
func CheckDraftBody(id string, body []byte) ([]byte, error) {
	if len(body) > MaxDraftBytes {
		return nil, fmt.Errorf("%w: The draft is too large to save (more than %d MB). Shorten it and try again.", ErrInvalid, MaxDraftBytes>>20)
	}
	trimmed := bytes.TrimSpace(body)
	if depthOf(trimmed) > MaxDraftDepth {
		return nil, fmt.Errorf("%w: The draft has too many parts inside one another (more than %d levels) to be saved.", ErrInvalid, MaxDraftDepth)
	}
	if len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(trimmed) {
		return nil, fmt.Errorf("%w: The draft must be a whole process or standard in JSON.", ErrInvalid)
	}
	if !utf8.Valid(trimmed) || !storableJSON(trimmed) {
		return nil, fmt.Errorf("%w: The draft contains characters that cannot be stored. Remove them and try again.", ErrInvalid)
	}
	var head struct {
		ID any `json:"id"`
	}
	if err := json.Unmarshal(trimmed, &head); err != nil {
		return nil, fmt.Errorf("%w: The draft must be a whole process or standard in JSON.", ErrInvalid)
	}
	if got, _ := head.ID.(string); got != id {
		return nil, fmt.Errorf("%w: The id in the draft must stay “%s”.", ErrInvalid, id)
	}
	return Pretty(trimmed)
}

// depthOf is the deepest nesting of objects and lists in a JSON text (brackets inside strings do
// not count). It reads the text once and stops early, whatever the text is.
func depthOf(b []byte) int {
	depth, deepest, inString := 0, 0, false
	for i := 0; i < len(b); i++ {
		c := b[i]
		switch {
		case inString && c == '\\':
			i++
		case c == '"':
			inString = !inString
		case inString:
		case c == '{' || c == '[':
			depth++
			if depth > deepest {
				deepest = depth
				if deepest > MaxDraftDepth {
					return deepest
				}
			}
		case c == '}' || c == ']':
			depth--
		}
	}
	return deepest
}

// storableJSON reports whether every text in valid JSON can be stored and read back as text:
// no NUL character, also not written as \u0000, and no half of a surrogate pair on its own.
func storableJSON(b []byte) bool {
	if bytes.IndexByte(b, 0) >= 0 {
		return false
	}
	inString, pendingHigh := false, false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if !inString {
			if c == '"' {
				inString = true
			}
			continue
		}
		switch {
		case c == '"':
			if pendingHigh {
				return false
			}
			inString = false
		case c == '\\' && i+1 < len(b):
			i++
			if b[i] != 'u' {
				if pendingHigh {
					return false
				}
				continue
			}
			if i+4 >= len(b) {
				return false
			}
			var r rune
			for _, h := range b[i+1 : i+5] {
				r <<= 4
				switch {
				case h >= '0' && h <= '9':
					r |= rune(h - '0')
				case h >= 'a' && h <= 'f':
					r |= rune(h-'a') + 10
				case h >= 'A' && h <= 'F':
					r |= rune(h-'A') + 10
				default:
					return false
				}
			}
			i += 4
			switch {
			case r == 0:
				return false
			case r >= 0xD800 && r <= 0xDBFF:
				if pendingHigh {
					return false
				}
				pendingHigh = true
			case r >= 0xDC00 && r <= 0xDFFF:
				if !pendingHigh {
					return false
				}
				pendingHigh = false
			default:
				if pendingHigh {
					return false
				}
			}
		default:
			if pendingHigh {
				return false
			}
		}
	}
	return !pendingHigh
}

// SaveDraft stores a working draft. It returns ErrNotFound when the document does not exist,
// ErrNeverPublished when it was never published, a *DraftConflict when c.Revision is not the
// stored revision, and a *Conflict when c.Base is not the current version.
func (s *Store) SaveDraft(ctx context.Context, c DraftChange) (WorkingDraft, error) {
	var out WorkingDraft
	if c.Kind != Process && c.Kind != Standard || !ValidID(c.ID) {
		return out, ErrNotFound
	}
	pretty, err := CheckDraftBody(c.ID, c.Body)
	if err != nil {
		return out, err
	}
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		// the same lock as a save of the document: publishing and saving the draft take turns
		if err := lock(ctx, tx, c.Kind, c.ID); err != nil {
			return err
		}
		cur, err := current(ctx, tx, c.Kind, c.ID)
		if err != nil {
			return err
		}
		if cur == nil {
			return ErrNotFound
		}
		if c.Check != nil {
			if err := c.Check(*cur); err != nil {
				return err
			}
		}
		if !Published(cur.Body) {
			return ErrNeverPublished
		}
		have, err := draftIn(ctx, tx, c.Kind, c.ID)
		if err != nil {
			return err
		}
		switch {
		case have == nil && c.Revision != 0, have != nil && c.Revision != have.Revision:
			return &DraftConflict{Current: have}
		case c.Base != nil && *c.Base > cur.Version, c.Base != nil && c.Revision > 0 && *c.Base != cur.Version:
			return &Conflict{Current: *cur, Exists: true}
		case c.Base != nil && *c.Base < cur.Version:
			// an older version: one of this document, not of one deleted before it
			var ok bool
			if err := tx.QueryRow(ctx, `select exists (select 1 from document_versions where kind = $1 and id = $2 and version = $3 and body is not null)
				and not exists (select 1 from document_versions where kind = $1 and id = $2 and version > $3 and body is null)`, c.Kind, c.ID, *c.Base).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return fmt.Errorf("%w: The version the draft was started from is not a version of this %s.", ErrInvalid, c.Kind)
			}
		}
		base := cur.Version
		switch {
		case c.Base != nil:
			base = *c.Base
		case have != nil:
			base = have.Base
		}
		return tx.QueryRow(ctx, `insert into working_drafts (kind, id, body, base, revision, updated_by, updated_by_name) values ($1, $2, $3, $4, $5, $6, $7)
			on conflict (kind, id) do update set body = excluded.body, base = excluded.base, revision = excluded.revision,
				updated_by = excluded.updated_by, updated_by_name = excluded.updated_by_name, updated_at = now()
			returning kind, id, body, base, revision, updated_at, updated_by, updated_by_name`, c.Kind, c.ID, pretty, base, c.Revision+1, c.By, c.ByName).
			Scan(&out.Kind, &out.ID, &out.Body, &out.Base, &out.Revision, &out.UpdatedAt, &out.UpdatedBy, &out.UpdatedByName)
	})
	if err != nil {
		return WorkingDraft{}, err
	}
	return out, nil
}

// DiscardDraft throws a working draft away. revision must be the stored one (*DraftConflict
// otherwise, also when there is none any more); ErrNotFound when the document does not exist.
// check runs under the lock with the stored document; after in the same transaction.
func (s *Store) DiscardDraft(ctx context.Context, kind, id string, revision int, check func(current Doc) error, after func(ctx context.Context, tx pgx.Tx, discarded WorkingDraft) error) error {
	if kind != Process && kind != Standard || !ValidID(id) {
		return ErrNotFound
	}
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		if err := lock(ctx, tx, kind, id); err != nil {
			return err
		}
		cur, err := current(ctx, tx, kind, id)
		if err != nil {
			return err
		}
		if cur == nil {
			return ErrNotFound
		}
		if check != nil {
			if err := check(*cur); err != nil {
				return err
			}
		}
		have, err := draftIn(ctx, tx, kind, id)
		if err != nil {
			return err
		}
		if have == nil || have.Revision != revision {
			return &DraftConflict{Current: have}
		}
		if _, err := tx.Exec(ctx, `delete from working_drafts where kind = $1 and id = $2`, kind, id); err != nil {
			return err
		}
		if after != nil {
			return after(ctx, tx, *have)
		}
		return nil
	})
}

// OnlyReviewDiffers reports whether two versions of a document differ in nothing but the review
// fields (a review confirmation): formatting and the order of the keys do not count.
func OnlyReviewDiffers(a, b []byte) bool {
	var x, y map[string]any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	delete(x, "review")
	delete(y, "review")
	return reflect.DeepEqual(x, y)
}

// MoveDraftBaseIn moves the working draft of a document from version from onto version to, in
// the transaction of a review confirmation that made version to out of version from: the draft
// is then still based on what readers see, and its revision and body stay as they are. A draft
// based on an even older version keeps that base: something else changed in between.
func MoveDraftBaseIn(ctx context.Context, tx pgx.Tx, kind, id string, from, to int) error {
	_, err := tx.Exec(ctx, `update working_drafts set base = $4 where kind = $1 and id = $2 and base = $3`, kind, id, from, to)
	return err
}

// ForPublishing prepares a working draft for publishing over the published document. The status
// is the published one (publishing neither un-retires nor hides anything; "status" in the draft
// is ignored). The review record - when it was last confirmed and by whom - is the published
// one too: a confirmation is made on the published document, never in a draft. The rest of
// "review" (how often it is reviewed) comes from the draft. A draft without "review" keeps the
// published review when that records a confirmation, so that the record is not lost. The order
// of the keys is kept.
func ForPublishing(draft, published []byte) ([]byte, error) {
	pub, err := fieldsOf(published)
	if err != nil {
		return nil, err
	}
	out, err := fieldsOf(draft)
	if err != nil {
		return nil, err
	}
	out = out.set("status", pub.get("status"), "review", "updatedAt")
	review, err := mergeReview(out.get("review"), pub.get("review"))
	if err != nil {
		return nil, err
	}
	out = out.set("review", review, "", "status")
	return out.join()
}

// mergeReview is the review of a published draft: see ForPublishing. nil: none.
func mergeReview(draft, published json.RawMessage) (json.RawMessage, error) {
	var pub fields
	if published != nil {
		if p, err := fieldsOf(published); err == nil {
			pub = p
		}
	}
	if draft == nil || bytes.Equal(bytes.TrimSpace(draft), []byte("null")) {
		if pub.get("lastReviewedAt") != nil {
			return published, nil
		}
		return draft, nil
	}
	d, err := fieldsOf(draft)
	if err != nil {
		return draft, nil // not an object: left to the format to refuse
	}
	d = d.set("lastReviewedAt", pub.get("lastReviewedAt"), "reviewedBy", "intervalMonths")
	d = d.set("reviewedBy", pub.get("reviewedBy"), "", "lastReviewedAt")
	merged, err := d.join()
	return merged, err
}
