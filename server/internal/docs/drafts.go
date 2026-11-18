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

// MaxDraftBytes is the largest working draft that is stored, measured as stored (re-indented).
const MaxDraftBytes = 512 << 10

// WorkingDraft is the unpublished changes to one document.
type WorkingDraft struct {
	Kind, ID  string
	Body      json.RawMessage
	Base      int // the version of the document the draft was started from (or moved on to)
	Revision  int // grows with every save of the draft
	UpdatedAt time.Time
	UpdatedBy string
}

// DraftInfo is what a list says about a working draft: who saved it last, and when.
type DraftInfo struct {
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy string    `json:"updatedBy"`
}

// DraftRule says what a save does when the document has a working draft.
type DraftRule int

const (
	// KeepDraft: the working draft stays as it is; its base is not moved, so publishing it later
	// meets the ordinary version conflict (or is rebased, when only a review confirmation came
	// in between). For saves that are no person's editing: imports, the conversion of older
	// content, review confirmations. When such a save makes the document unpublished
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
	err := q.QueryRow(ctx, `select kind, id, body, base, revision, updated_at, updated_by from working_drafts where kind = $1 and id = $2`, kind, id).
		Scan(&d.Kind, &d.ID, &d.Body, &d.Base, &d.Revision, &d.UpdatedAt, &d.UpdatedBy)
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
	err := s.Pool.QueryRow(ctx, `select kind, id, body, base, revision, updated_at, updated_by from working_drafts where kind = $1 and id = $2`, kind, id).
		Scan(&d.Kind, &d.ID, &d.Body, &d.Base, &d.Revision, &d.UpdatedAt, &d.UpdatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

// Drafts says which documents of one kind have a working draft, by id: one query for a list.
func (s *Store) Drafts(ctx context.Context, kind string) (map[string]DraftInfo, error) {
	rows, err := s.Pool.Query(ctx, `select id, updated_at, updated_by from working_drafts where kind = $1`, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]DraftInfo{}
	for rows.Next() {
		var id string
		var d DraftInfo
		if err := rows.Scan(&id, &d.UpdatedAt, &d.UpdatedBy); err != nil {
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
	// Revision is the revision the change was made from; 0 means "I am starting one": refused
	// when one exists.
	Revision int
	// Base, when given, moves the draft onto that version of the document, which must be the
	// current one (the person took over what was published since). nil: a new draft starts from
	// the current version, an existing one keeps its base.
	Base *int
	// Check runs under the lock with the stored document, before anything is written: rights.
	Check func(current Doc) error
}

// CheckDraftBody is what a working draft must satisfy to be stored. It need not pass the format
// or the checker - an unfinished draft can be saved - but it must be a JSON object whose "id" is
// the id in the address, hold only text that can be stored, and be at most MaxDraftBytes long
// as stored. It returns the body as stored (re-indented, the order of the keys kept).
func CheckDraftBody(id string, body []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(body)
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
	pretty, err := Pretty(trimmed)
	if err != nil {
		return nil, err
	}
	if len(pretty) > MaxDraftBytes {
		return nil, fmt.Errorf("%w: The draft is too large to save (more than %d KB). Shorten it and try again.", ErrInvalid, MaxDraftBytes>>10)
	}
	return pretty, nil
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
		case c.Base != nil && *c.Base != cur.Version:
			return &Conflict{Current: *cur, Exists: true}
		}
		base := cur.Version
		switch {
		case c.Base != nil:
			base = *c.Base
		case have != nil:
			base = have.Base
		}
		return tx.QueryRow(ctx, `insert into working_drafts (kind, id, body, base, revision, updated_by) values ($1, $2, $3, $4, $5, $6)
			on conflict (kind, id) do update set body = excluded.body, base = excluded.base, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = now()
			returning kind, id, body, base, revision, updated_at, updated_by`, c.Kind, c.ID, pretty, base, c.Revision+1, c.By).
			Scan(&out.Kind, &out.ID, &out.Body, &out.Base, &out.Revision, &out.UpdatedAt, &out.UpdatedBy)
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

// ForPublishing prepares a working draft for publishing over the published document: the status
// is the published one (publishing neither un-retires nor hides anything; "status" in the draft
// is ignored), and with takeReview the review fields are the published ones (the draft is
// rebased over a review confirmation). The order of the keys is kept.
func ForPublishing(draft, published []byte, takeReview bool) ([]byte, error) {
	pub, err := fieldsOf(published)
	if err != nil {
		return nil, err
	}
	out, err := fieldsOf(draft)
	if err != nil {
		return nil, err
	}
	out = out.set("status", pub.get("status"), "review", "updatedAt")
	if takeReview {
		out = out.set("review", pub.get("review"), "", "status")
	}
	return out.join()
}
