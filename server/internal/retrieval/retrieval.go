// Package retrieval keeps the search index of published processes and standards and searches
// it by meaning.
//
// Every process and standard is cut into parts (children): its summary, each step, each
// prerequisite, each requirement and the scope of a standard. Each part is turned into a vector
// by an embedding provider and stored in Postgres with pgvector. A search turns the question
// into a vector, finds the nearest parts and groups them by the document they belong to.
//
// Only published documents (active and retired) are in the index: a draft or a deleted
// document has no parts, and a search checks the current state of every document it returns,
// so a document that just became a draft is never returned, even before its parts are removed.
//
// The provider may be slow or hang. Nothing here holds a database connection while it waits
// for the provider: a sync embeds first, then writes in a short transaction after checking that
// the document did not change meanwhile; a search embeds the question before it reads.
//
// The table depends on the pgvector extension, which may live in any schema; every use of its
// type, operator and operator class is qualified with that schema.
package retrieval

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

// ErrProvider marks a failure of the embedding provider (it could not be reached, refused, or
// did not answer in time).
var ErrProvider = errors.New("the embeddings provider could not be reached")

// ErrNotSetUp is returned when the index cannot be searched: it has not been built yet, it is
// still being built, it is not in use (search by meaning was switched off), or it was built with
// other settings than this program's.
var ErrNotSetUp = errors.New("the search index is not set up")

// ErrOtherSettings is returned by a sync when the index belongs to settings other than this
// program's (another server, or -migrate, switched it): nothing is written.
var ErrOtherSettings = errors.New("the search index was built with other settings of search by meaning")

// providerError carries the provider's own message, which already says what went wrong, and
// counts as ErrProvider.
type providerError struct{ err error }

func (e providerError) Error() string {
	msg := e.err.Error()
	if strings.HasPrefix(msg, "embeddings:") || strings.Contains(msg, "embeddings provider") {
		return msg
	}
	return ErrProvider.Error() + ": " + msg
}
func (e providerError) Is(target error) bool { return target == ErrProvider }
func (e providerError) Unwrap() error        { return e.err }

// Locks that keep several servers from doing the same work at once (the numbers continue those
// of the db package). Each is held only for quick database work, never while the provider is asked.
const (
	lockEnsure = 7461010
	// per document, inside the transaction that writes its parts
	lockDocSpace = 7463
)

// layout is the version of the tables below. A change of it rebuilds the index like a change
// of settings does.
const layout = 3

// Time limits. One call to the provider (a document's new parts, or a question) gets
// embedTimeout; the probe before an index is switched to new settings gets the same.
const (
	embedTimeout = 30 * time.Second
	// a document that changes while its parts are embedded is read and embedded again, this often
	syncAttempts = 3
	// above this many parts a search uses the vector index (approximate) instead of comparing
	// every part (exact)
	exactParts = 50000
	// the vector index looks at this many parts at most (the largest value pgvector accepts)
	maxCandidates = 1000
)

// Hit is one part of a document that matched.
type Hit struct {
	Part    string  `json:"part"`
	Item    string  `json:"item"`
	Label   string  `json:"label"`
	Snippet string  `json:"snippet"`
	Score   float64 `json:"score"`
}

// Result is one document that matched: its score is that of its best part.
type Result struct {
	Kind  string  `json:"kind"`
	ID    string  `json:"id"`
	Score float64 `json:"score"`
	Hits  []Hit   `json:"hits"` // best first, at most MaxHits
	// Status is the document's status as stored now: "active" (also for an empty status) or
	// "retired". Drafts are never returned.
	Status string `json:"-"`
}

// Page is the answer of SearchPage: the documents found, best first, and whether more
// documents matched than were returned.
type Page struct {
	Results   []Result
	Truncated bool
}

// MaxHits is the largest number of parts returned for one document.
const MaxHits = 3

// MaxLimit is the largest number of documents one search returns.
const MaxLimit = 500

// Report says what a rebuild did.
type Report struct {
	Documents int // processes and standards looked at
	Embedded  int // parts turned into vectors (new or changed)
	Unchanged int // parts that were kept as they were
	Removed   int // parts that no longer exist (deleted, draft, or the part itself is gone)
	Failed    int // documents that could not be brought up to date and are tried again later
}

func (r Report) String() string {
	s := fmt.Sprintf("%d documents, %d parts embedded, %d unchanged, %d removed", r.Documents, r.Embedded, r.Unchanged, r.Removed)
	if r.Failed > 0 {
		s += fmt.Sprintf(", %d documents not brought up to date (tried again later)", r.Failed)
	}
	return s
}

// Index is the search index. A nil *Index, or one without an embedder, is switched off: it
// indexes nothing and finds nothing.
type Index struct {
	pool  *pgxpool.Pool
	store *docs.Store
	emb   embedding.Embedder
	opts  chunking.Options
	log   *slog.Logger
	cache *queryCache

	mu       sync.Mutex
	schema   string  // where the extension lives, once found
	minScore float64 // < 0: the floor of the provider

	rebuilding  sync.Mutex  // one rebuild at a time in this program
	switching   atomic.Bool // the stored index has other settings: CatchUp switches it
	toldOthers  atomic.Bool // "another server owns the index" was logged
	embedBudget time.Duration
}

// New creates the index. e == nil switches it off.
func New(pool *pgxpool.Pool, store *docs.Store, e embedding.Embedder, c chunking.Options, log *slog.Logger) *Index {
	if c.MaxChars == 0 && len(c.Parts) == 0 {
		c = chunking.Default()
	}
	if log == nil {
		log = slog.Default()
	}
	return &Index{pool: pool, store: store, emb: e, opts: c, log: log, cache: newQueryCache(500, 5*time.Minute), minScore: -1, embedBudget: embedTimeout}
}

// SetMinScore overrides the floor of the provider (PM_SEARCH_MIN_SCORE): parts less similar
// than this are not matches. A negative value keeps the provider's floor.
func (ix *Index) SetMinScore(f float64) {
	if ix == nil {
		return
	}
	ix.mu.Lock()
	ix.minScore = f
	ix.mu.Unlock()
}

// Enabled reports whether search by meaning is switched on.
func (ix *Index) Enabled() bool { return ix != nil && ix.emb != nil }

// Provider names the embeddings provider and model ("builtin", "vertex:gemini-embedding-001"),
// "" when switched off.
func (ix *Index) Provider() string {
	if !ix.Enabled() {
		return ""
	}
	return ix.emb.Name()
}

// ProviderKind is the provider without its model: "builtin" or "vertex"; "" when switched off.
func (ix *Index) ProviderKind() string {
	name, _, _ := strings.Cut(ix.Provider(), ":")
	return name
}

// Outside reports whether text leaves the server to be embedded (documents and questions).
func (ix *Index) Outside() bool { return ix.Enabled() && ix.emb.Outside() }

// settings is what the stored vectors depend on: when any of it changes, every vector is made again.
func (ix *Index) settings() (provider string, dims int, chunks string) {
	parts := append([]string(nil), ix.opts.Parts...)
	sort.Strings(parts)
	return ix.emb.Name(), ix.emb.Dimensions(), fmt.Sprintf("parts=%s;max=%d;layout=%d", strings.Join(parts, ","), ix.opts.MaxChars, layout)
}

// embed asks the provider, within the time limit, holding no database connection.
func (ix *Index) embed(ctx context.Context, texts []string, p embedding.Purpose) ([][]float32, error) {
	ctx, cancel := context.WithTimeout(ctx, ix.embedBudget)
	defer cancel()
	got, err := ix.emb.Embed(ctx, texts, p)
	if err == nil && len(got) != len(texts) {
		err = fmt.Errorf("it answered %d vectors for %d texts", len(got), len(texts))
	}
	if err != nil {
		if ctx.Err() != nil && !strings.Contains(err.Error(), "time") {
			err = fmt.Errorf("no answer within %s: %w", ix.embedBudget, err)
		}
		return nil, providerError{err}
	}
	return got, nil
}

// ---------- the extension

// AdminStatement is what a database administrator runs when the server may not install pgvector.
const AdminStatement = "CREATE EXTENSION IF NOT EXISTS vector;"

// findSchema returns the schema of the pgvector extension, "" when it is not installed.
func findSchema(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (schema, version string, err error) {
	err = q.QueryRow(ctx, `select n.nspname, e.extversion from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'`).Scan(&schema, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return schema, version, err
}

// vectorSchema returns the quoted schema of the extension, looking it up the first time.
func (ix *Index) vectorSchema(ctx context.Context) (string, error) {
	ix.mu.Lock()
	defer ix.mu.Unlock()
	if ix.schema != "" {
		return ix.schema, nil
	}
	schema, _, err := findSchema(ctx, ix.pool)
	if err != nil {
		return "", err
	}
	if schema == "" {
		return "", fmt.Errorf("%w: the database extension pgvector is not installed", ErrNotSetUp)
	}
	ix.schema = pgx.Identifier{schema}.Sanitize()
	return ix.schema, nil
}

// supported reports whether a pgvector version has what the index uses (HNSW came with 0.5).
func supported(version string) bool {
	major, rest, _ := strings.Cut(version, ".")
	minor, _, _ := strings.Cut(rest, ".")
	ma, err1 := strconv.Atoi(major)
	mi, err2 := strconv.Atoi(minor)
	return err1 == nil && err2 == nil && (ma > 0 || mi >= 5)
}

// ensureExtension finds the extension or installs it.
func (ix *Index) ensureExtension(ctx context.Context) (string, error) {
	schema, version, err := findSchema(ctx, ix.pool)
	if err != nil {
		return "", err
	}
	if schema == "" {
		if _, err := ix.pool.Exec(ctx, `create extension if not exists vector with schema public`); err != nil {
			return "", fmt.Errorf("search by meaning needs the PostgreSQL extension pgvector (version 0.5 or later) in this database, "+
				"and the server could not install it (%v). A database administrator has to run, in this database: %s "+
				"Or switch search by meaning off with PM_EMBEDDINGS=off", err, AdminStatement)
		}
		if schema, version, err = findSchema(ctx, ix.pool); err != nil {
			return "", err
		}
	}
	if !supported(version) {
		return "", fmt.Errorf("search by meaning needs pgvector 0.5 or later, this database has %s. A database administrator has to run: ALTER EXTENSION vector UPDATE;", version)
	}
	q := pgx.Identifier{schema}.Sanitize()
	ix.mu.Lock()
	ix.schema = q
	ix.mu.Unlock()
	return q, nil
}

// ---------- the tables

const settingsTable = `create table if not exists search_settings (
	key int primary key default 1 check (key = 1),
	provider text not null,
	dimensions int not null,
	chunks text not null,
	built_at timestamptz not null default now())`

// complete is false while the index is being built, and when it is not in use (search by
// meaning was switched off and the index may be out of date): a search then answers "not set up".
const settingsComplete = `alter table search_settings add column if not exists complete boolean not null default false`

// markComplete records that the index holds everything once nothing waits any more.
const markComplete = `update search_settings set complete = true where not complete and not exists (select 1 from search_pending)`

// Ensure makes the index usable, doing only quick work in the database: the extension, the
// tables, the vector index. A new index is created empty, with every document marked to be
// embedded; CatchUp fills it. When the stored index was built with other settings (provider,
// model, size, parts) nothing is dropped here: the index is switched by CatchUp, once the new
// provider answers. Several servers may run it at once.
func (ix *Index) Ensure(ctx context.Context) error {
	if !ix.Enabled() {
		return nil
	}
	return db.WithLock(ctx, ix.pool, lockEnsure, func() error {
		vs, err := ix.ensureExtension(ctx)
		if err != nil {
			return err
		}
		return ix.ensureTables(ctx, vs, false)
	})
}

// ensureTables creates the tables, and drops and creates them when the settings changed and
// force is set. Without force a change of settings is only noted (ix.switching).
func (ix *Index) ensureTables(ctx context.Context, vs string, force bool) error {
	provider, dims, chunks := ix.settings()
	return pgx.BeginFunc(ctx, ix.pool, func(tx pgx.Tx) error {
		for _, stmt := range []string{settingsTable, settingsComplete} {
			if _, err := tx.Exec(ctx, stmt); err != nil {
				return err
			}
		}
		var sp, sc string
		var sd int
		var complete bool
		// for update: a sync that checks the settings waits until this is decided
		err := tx.QueryRow(ctx, `select provider, dimensions, chunks, complete from search_settings where key = 1 for update`).Scan(&sp, &sd, &sc, &complete)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		stored := err == nil
		var exists bool
		if err := tx.QueryRow(ctx, `select to_regclass('search_chunks') is not null and to_regclass('search_pending') is not null`).Scan(&exists); err != nil {
			return err
		}
		same := stored && sp == provider && sd == dims && sc == chunks
		switch {
		case exists && same:
			ix.switching.Store(false)
			if !complete {
				// not in use for a while, or a build that did not finish: everything is looked at again
				_, err := tx.Exec(ctx, `insert into search_pending (kind, doc_id, reason) select kind, id, 'catching up' from documents
					where kind in ('process', 'standard') on conflict do nothing`)
				if err == nil {
					_, err = tx.Exec(ctx, markComplete)
				}
				return err
			}
			return nil
		case exists && stored && !force:
			ix.switching.Store(true)
			ix.log.Warn("search by meaning: the settings changed since the search index was built. It is built again in the background as soon as the new provider answers; until it is ready, search by meaning answers \"not ready yet\" and the old index stays as it is",
				"index", fmt.Sprintf("%s, %d dimensions, %s", sp, sd, sc), "settings", fmt.Sprintf("%s, %d dimensions, %s", provider, dims, chunks))
			return nil
		}
		if stored && !same {
			ix.log.Warn("search by meaning: the search index is dropped and built again with the new settings; search by meaning answers \"not ready yet\" until it is done",
				"before", fmt.Sprintf("%s, %d dimensions, %s", sp, sd, sc), "now", fmt.Sprintf("%s, %d dimensions, %s", provider, dims, chunks))
		}
		stmts := []string{
			`drop table if exists search_chunks`,
			`drop table if exists search_pending`,
			fmt.Sprintf(`create table search_chunks (
				kind text not null,
				doc_id text not null,
				part text not null,
				item text not null,
				seq int not null,
				label text not null,
				snippet text not null, -- the readable text of the part, without metadata
				content_hash text not null, -- of the provider, the size and the embedded text
				status text not null,
				embedding %s.vector(%d) not null,
				updated_at timestamptz not null default now(),
				primary key (kind, doc_id, part, item, seq))`, vs, dims),
			fmt.Sprintf(`create index search_chunks_embedding on search_chunks using hnsw (embedding %s.vector_cosine_ops)`, vs),
			`create table search_pending (
				kind text not null,
				doc_id text not null,
				since timestamptz not null default now(),
				reason text not null default '',
				primary key (kind, doc_id))`,
			// everything is to be embedded: should this server stop before it is done, the next
			// start or the periodic retry finishes the work
			`insert into search_pending (kind, doc_id, reason) select kind, id, 'new index' from documents where kind in ('process', 'standard')`,
		}
		for _, s := range stmts {
			if _, err := tx.Exec(ctx, s); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `insert into search_settings (key, provider, dimensions, chunks, complete) values (1, $1, $2, $3, false)
			on conflict (key) do update set provider = excluded.provider, dimensions = excluded.dimensions, chunks = excluded.chunks, complete = false, built_at = now()`, provider, dims, chunks); err != nil {
			return err
		}
		ix.switching.Store(false)
		_, err = tx.Exec(ctx, markComplete) // nothing to embed: ready at once
		return err
	})
}

// MarkUnused is for a server that runs with search by meaning switched off: an index left from
// earlier is no longer kept up to date, so it is marked as not in use and no program (an MCP
// server with other settings, say) searches it. Switched on again, the index is caught up
// before it is searched. It reports whether there was an index in use.
func (ix *Index) MarkUnused(ctx context.Context) (bool, error) {
	if ix == nil || ix.pool == nil {
		return false, nil
	}
	var exists bool
	if err := ix.pool.QueryRow(ctx, `select to_regclass('search_settings') is not null`).Scan(&exists); err != nil || !exists {
		return false, err
	}
	if _, err := ix.pool.Exec(ctx, settingsComplete); err != nil {
		return false, err
	}
	tag, err := ix.pool.Exec(ctx, `update search_settings set complete = false where complete`)
	return err == nil && tag.RowsAffected() > 0, err
}

// Ready reports whether this program can search the index: nil, or an ErrNotSetUp that says
// why not. It only reads.
func (ix *Index) Ready(ctx context.Context) error {
	if !ix.Enabled() {
		return fmt.Errorf("%w: search by meaning is switched off", ErrNotSetUp)
	}
	return ix.ready(ctx, ix.pool)
}

func (ix *Index) ready(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) error {
	provider, dims, chunks := ix.settings()
	var exists bool
	if err := q.QueryRow(ctx, `select to_regclass('search_settings') is not null and to_regclass('search_chunks') is not null`).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: it has not been built yet", ErrNotSetUp)
	}
	var sp, sc string
	var sd int
	var complete bool
	err := q.QueryRow(ctx, `select provider, dimensions, chunks, complete from search_settings where key = 1`).Scan(&sp, &sd, &sc, &complete)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("%w: it has not been built yet", ErrNotSetUp)
	case err != nil && strings.Contains(err.Error(), "complete"):
		return fmt.Errorf("%w: it was built by an earlier version and is caught up when the portal server starts", ErrNotSetUp)
	case err != nil:
		return err
	case sp != provider || sd != dims || sc != chunks:
		return fmt.Errorf("%w: it was built with other settings of search by meaning (%s, %d dimensions); the portal server builds it again when it starts with these settings", ErrNotSetUp, sp, sd)
	case !complete:
		return fmt.Errorf("%w: it is being built, or it was not in use and is being caught up", ErrNotSetUp)
	}
	return nil
}

// ---------- keeping the index up to date

// syncResult counts what one sync did.
type syncResult struct{ embedded, unchanged, removed int }

// Sync brings the parts of one document in line with what is stored now: a draft or a deleted
// document loses its parts, a published one gets new or changed parts embedded (in one call to
// the provider) and parts that are gone removed - written in one transaction, so a search never
// sees half a document. When it fails (the provider cannot be reached, or the index belongs to
// other settings) the earlier parts stay and the document is marked: the next start, a rebuild
// or the periodic retry picks it up again. The catalog has no parts of its own, but its names
// appear in the text of the parts: a sync of the catalog goes through every document.
func (ix *Index) Sync(ctx context.Context, kind, id string) error {
	if !ix.Enabled() {
		return nil
	}
	if kind == docs.Catalog {
		_, err := ix.Rebuild(ctx)
		return err
	}
	if kind != docs.Process && kind != docs.Standard {
		return nil
	}
	_, err := ix.sync(ctx, kind, id, nil)
	return err
}

// sync is Sync with the lists already read (nil: read them).
func (ix *Index) sync(ctx context.Context, kind, id string, lists *docs.Lists) (syncResult, error) {
	res, err := ix.syncDoc(ctx, kind, id, lists)
	if err != nil {
		ix.markPending(ctx, kind, id, err)
		if errors.Is(err, ErrOtherSettings) && !ix.toldOthers.Swap(true) {
			ix.log.Warn("search by meaning: the search index now belongs to other settings (another server, or a -migrate, uses another provider, model, size or parts). This server no longer writes to it or searches it; restart it with the same settings",
				"error", err)
		}
	}
	return res, err
}

func (ix *Index) markPending(ctx context.Context, kind, id string, cause error) {
	reason := cause.Error()
	if r := []rune(reason); len(r) > 500 {
		reason = string(r[:500])
	}
	// on a context of its own: a cancelled request must not keep the mark from being written
	mctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if _, err := ix.pool.Exec(mctx, `insert into search_pending (kind, doc_id, reason) values ($1, $2, $3)
		on conflict (kind, doc_id) do update set reason = excluded.reason`, kind, id, reason); err != nil {
		ix.log.Error("search by meaning: a document could not be marked to be tried again; it is caught up at the next start", "kind", kind, "id", id, "error", err)
	}
}

type storedChunk struct {
	hash, label, snippet, status string
}

type chunkKey struct {
	part, item string
	seq        int
}

// hashOf identifies a vector: the provider and model, the size and the text it was made from.
func (ix *Index) hashOf(text string) string {
	sum := sha256.Sum256([]byte(ix.emb.Name() + "\x00" + strconv.Itoa(ix.emb.Dimensions()) + "\x00" + text))
	return hex.EncodeToString(sum[:16])
}

// docState is a document as read for a sync.
type docState struct {
	exists  bool
	version int
	body    []byte
}

func readDoc(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, kind, id string) (docState, error) {
	var d docState
	err := q.QueryRow(ctx, `select version, body from documents where kind = $1 and id = $2`, kind, id).Scan(&d.version, &d.body)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, nil
	}
	d.exists = err == nil
	return d, err
}

type want struct {
	key  chunkKey
	c    chunking.Chunk
	hash string
}

// partsOf cuts a document into the parts the index should hold (none for a draft or a deleted one).
func (ix *Index) partsOf(kind, id string, d docState, lists docs.Lists) (all []want, status string, readable content, err error) {
	var head struct {
		Status string `json:"status"`
	}
	published := d.exists && json.Unmarshal(d.body, &head) == nil && head.Status != "draft"
	readable = readContent(kind, d.body)
	status = head.Status
	if status == "" {
		status = "active"
	}
	if !published {
		return nil, status, readable, nil
	}
	chunks, err := chunking.Chunks(kind, d.body, lists, ix.opts)
	if err != nil {
		return nil, status, readable, fmt.Errorf("the %s %q could not be cut into parts: %w", kind, id, err)
	}
	seen := map[[2]string]int{}
	for _, c := range chunks {
		pi := [2]string{c.Part, c.Item}
		all = append(all, want{key: chunkKey{part: c.Part, item: c.Item, seq: seen[pi]}, c: c, hash: ix.hashOf(c.Text)})
		seen[pi]++
	}
	return all, status, readable, nil
}

// errChanged: the document changed while its parts were embedded; the sync starts over.
var errChanged = errors.New("the document changed while it was being indexed")

func (ix *Index) syncDoc(ctx context.Context, kind, id string, lists *docs.Lists) (syncResult, error) {
	var res syncResult
	vs, err := ix.vectorSchema(ctx)
	if err != nil {
		return res, err
	}
	if lists == nil {
		l, err := ix.store.Lists(ctx)
		if err != nil {
			return res, err
		}
		lists = &l
	}
	vectors := map[string][]float32{} // by hash; kept across attempts
	for attempt := 0; attempt < syncAttempts; attempt++ {
		// 1. read, without a transaction: the document and the hashes stored for it
		d, err := readDoc(ctx, ix.pool, kind, id)
		if err != nil {
			return res, err
		}
		all, status, readable, err := ix.partsOf(kind, id, d, *lists)
		if err != nil {
			return res, err
		}
		have := map[string]bool{}
		if len(all) > 0 {
			rows, err := ix.pool.Query(ctx, `select content_hash from search_chunks where kind = $1 and doc_id = $2`, kind, id)
			if err != nil {
				return res, err
			}
			for rows.Next() {
				var h string
				if err := rows.Scan(&h); err != nil {
					rows.Close()
					return res, err
				}
				have[h] = true
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return res, err
			}
		}
		// 2. embed what is new, holding no connection
		var texts, hashes []string
		for _, w := range all {
			if !have[w.hash] && vectors[w.hash] == nil && !contains(hashes, w.hash) {
				texts = append(texts, w.c.Text)
				hashes = append(hashes, w.hash)
			}
		}
		if len(texts) > 0 {
			got, err := ix.embed(ctx, texts, embedding.Document)
			if err != nil {
				return res, err
			}
			for i, h := range hashes {
				vectors[h] = got[i]
			}
		}
		// 3. write, if the document is still what was embedded
		res, err = ix.write(ctx, vs, kind, id, d, all, status, readable, vectors)
		if errors.Is(err, errChanged) {
			continue
		}
		return res, err
	}
	return res, fmt.Errorf("%w %d times in a row; it is tried again later", errChanged, syncAttempts)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// write stores the parts of one document in one short transaction.
func (ix *Index) write(ctx context.Context, vs, kind, id string, read docState, all []want, status string, readable content, vectors map[string][]float32) (syncResult, error) {
	var res syncResult
	err := pgx.BeginFunc(ctx, ix.pool, func(tx pgx.Tx) error {
		res = syncResult{}
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, $2))`, kind+"/"+id, lockDocSpace); err != nil {
			return err
		}
		// the index must still belong to these settings; for share: a switch waits until this is written
		provider, dims, chunks := ix.settings()
		var sp, sc string
		var sd int
		err := tx.QueryRow(ctx, `select provider, dimensions, chunks from search_settings where key = 1 for share`).Scan(&sp, &sd, &sc)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (sp != provider || sd != dims || sc != chunks)) {
			return fmt.Errorf("%w (the index: %s, %d dimensions; this server: %s, %d dimensions)", ErrOtherSettings, sp, sd, provider, dims)
		}
		if err != nil {
			return err
		}
		now, err := readDoc(ctx, tx, kind, id)
		if err != nil {
			return err
		}
		if now.exists != read.exists || now.version != read.version {
			return errChanged
		}

		stored := map[chunkKey]storedChunk{}
		rows, err := tx.Query(ctx, `select part, item, seq, content_hash, label, snippet, status from search_chunks where kind = $1 and doc_id = $2`, kind, id)
		if err != nil {
			return err
		}
		for rows.Next() {
			var k chunkKey
			var s storedChunk
			if err := rows.Scan(&k.part, &k.item, &k.seq, &s.hash, &s.label, &s.snippet, &s.status); err != nil {
				rows.Close()
				return err
			}
			stored[k] = s
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		keep := map[chunkKey]bool{}
		for _, w := range all {
			keep[w.key] = true
			snippet := readable.of(w.key.part, w.key.item) // the readable text; cut to a snippet when searched
			old, ok := stored[w.key]
			if !ok || old.hash != w.hash {
				v := vectors[w.hash]
				if v == nil {
					return errChanged // another sync changed the stored parts meanwhile
				}
				if _, err := tx.Exec(ctx, fmt.Sprintf(`insert into search_chunks (kind, doc_id, part, item, seq, label, snippet, content_hash, status, embedding)
					values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::%s.vector)
					on conflict (kind, doc_id, part, item, seq) do update set label = excluded.label, snippet = excluded.snippet,
						content_hash = excluded.content_hash, status = excluded.status, embedding = excluded.embedding, updated_at = now()`, vs),
					kind, id, w.key.part, w.key.item, w.key.seq, w.c.Label, snippet, w.hash, status, vectorText(v)); err != nil {
					return err
				}
				res.embedded++
				continue
			}
			res.unchanged++
			if old.label != w.c.Label || old.snippet != snippet || old.status != status {
				if _, err := tx.Exec(ctx, `update search_chunks set label = $6, snippet = $7, status = $8, updated_at = now()
					where kind = $1 and doc_id = $2 and part = $3 and item = $4 and seq = $5`,
					kind, id, w.key.part, w.key.item, w.key.seq, w.c.Label, snippet, status); err != nil {
					return err
				}
			}
		}
		for k := range stored {
			if keep[k] {
				continue
			}
			if _, err := tx.Exec(ctx, `delete from search_chunks where kind = $1 and doc_id = $2 and part = $3 and item = $4 and seq = $5`, kind, id, k.part, k.item, k.seq); err != nil {
				return err
			}
			res.removed++
		}
		if _, err := tx.Exec(ctx, `delete from search_pending where kind = $1 and doc_id = $2`, kind, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, markComplete)
		return err
	})
	return res, err
}

// vectorText writes a vector the way pgvector reads it.
func vectorText(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 10)
	b.WriteByte('[')
	for i, x := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(x), 'g', -1, 32))
	}
	b.WriteByte(']')
	return b.String()
}

// CatchUp brings the index up to date with everything stored; it is what a start runs in the
// background, and -migrate and -reindex in the foreground. When the stored index was built with
// other settings, it first asks the new provider once: only when that answers is the old index
// dropped and a new one built; otherwise the old index and its settings stay, a warning is
// logged and ErrProvider returned (the next start or retry tries again). Parts that did not
// change are not embedded again. An ErrProvider means the index is usable but not complete;
// what is missing is tried again later.
func (ix *Index) CatchUp(ctx context.Context) (Report, error) {
	if !ix.Enabled() {
		return Report{}, nil
	}
	if ix.switching.Load() {
		if _, err := ix.embed(ctx, []string{"Process: probe"}, embedding.Document); err != nil {
			ix.log.Warn("search by meaning: the new provider cannot be reached, so the search index is not switched to the new settings. The old index stays as it was; it is tried again in a few minutes and at the next start",
				"provider", ix.emb.Name(), "error", err)
			return Report{}, err
		}
		err := db.WithLock(ctx, ix.pool, lockEnsure, func() error {
			vs, err := ix.ensureExtension(ctx)
			if err != nil {
				return err
			}
			return ix.ensureTables(ctx, vs, true)
		})
		if err != nil {
			return Report{}, err
		}
	}
	return ix.Rebuild(ctx)
}

// Rebuild brings every document up to date: parts that did not change are kept, everything else
// is embedded, and parts of documents that no longer exist (or became drafts) are removed. A
// document that fails is marked and tried again later; when the provider cannot be reached at
// all, or the index belongs to other settings, the rebuild stops early and returns the error,
// with every document left marked. Progress is logged.
func (ix *Index) Rebuild(ctx context.Context) (Report, error) {
	if !ix.Enabled() {
		return Report{}, nil
	}
	ix.rebuilding.Lock()
	defer ix.rebuilding.Unlock()
	return ix.rebuild(ctx)
}

func (ix *Index) rebuild(ctx context.Context) (Report, error) {
	var r Report
	lists, err := ix.store.Lists(ctx)
	if err != nil {
		return r, err
	}
	// every process and standard, and everything that has parts or a mark without a document
	targets := map[[2]string]bool{}
	var order [][2]string
	add := func(kind, id string) {
		k := [2]string{kind, id}
		if !targets[k] {
			targets[k] = true
			order = append(order, k)
		}
	}
	for _, kind := range []string{docs.Process, docs.Standard} {
		list, err := ix.store.List(ctx, kind)
		if err != nil {
			return r, err
		}
		for _, d := range list {
			add(d.Kind, d.ID)
		}
	}
	rows, err := ix.pool.Query(ctx, `select distinct kind, doc_id from search_chunks union select kind, doc_id from search_pending order by 1, 2`)
	if err != nil {
		return r, err
	}
	for rows.Next() {
		var kind, id string
		if err := rows.Scan(&kind, &id); err != nil {
			rows.Close()
			return r, err
		}
		add(kind, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return r, err
	}

	r.Documents = len(order)
	last := time.Now()
	for i, k := range order {
		res, err := ix.sync(ctx, k[0], k[1], &lists)
		if err != nil {
			r.Failed++
			if errors.Is(err, ErrProvider) || errors.Is(err, ErrOtherSettings) || ctx.Err() != nil {
				// no point in trying the rest now: mark them for the retry
				for _, rest := range order[i+1:] {
					ix.markPending(ctx, rest[0], rest[1], err)
					r.Failed++
				}
				return r, err
			}
			ix.log.Error("search by meaning: a document could not be indexed; it is tried again later", "kind", k[0], "id", k[1], "error", err)
			continue
		}
		r.Embedded += res.embedded
		r.Unchanged += res.unchanged
		r.Removed += res.removed
		if time.Since(last) > 10*time.Second {
			last = time.Now()
			ix.log.Info("search by meaning: bringing the search index up to date", "documents done", i+1, "of", len(order), "parts embedded", r.Embedded)
		}
	}
	return r, nil
}

// Retry brings the documents up to date whose last sync failed. It returns how many it caught up.
func (ix *Index) Retry(ctx context.Context) (int, error) {
	if !ix.Enabled() {
		return 0, nil
	}
	rows, err := ix.pool.Query(ctx, `select kind, doc_id from search_pending order by since`)
	if err != nil {
		return 0, err
	}
	var todo [][2]string
	for rows.Next() {
		var kind, id string
		if err := rows.Scan(&kind, &id); err != nil {
			rows.Close()
			return 0, err
		}
		todo = append(todo, [2]string{kind, id})
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(todo) == 0 {
		return 0, err
	}
	lists, err := ix.store.Lists(ctx)
	if err != nil {
		return 0, err
	}
	done := 0
	var failed error
	for _, k := range todo {
		_, err := ix.sync(ctx, k[0], k[1], &lists)
		switch {
		case err == nil:
			done++
		case errors.Is(err, ErrProvider) || errors.Is(err, ErrOtherSettings) || ctx.Err() != nil:
			return done, err // the provider is still down: the rest stays marked
		default:
			failed = err // this one document; the others may still work
		}
	}
	return done, failed
}

// Pending returns how many documents wait to be tried again.
func (ix *Index) Pending(ctx context.Context) (int, error) {
	if !ix.Enabled() {
		return 0, nil
	}
	var n int
	err := ix.pool.QueryRow(ctx, `select count(*) from search_pending`).Scan(&n)
	return n, err
}

// RetryEvery tries the marked documents again at the given interval until ctx ends; while the
// index still waits to be switched to new settings, it tries that instead.
func (ix *Index) RetryEvery(ctx context.Context, every time.Duration) {
	if !ix.Enabled() {
		return
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		// to be switched to new settings, or marked as not in use by a server with search by
		// meaning off: built again or caught up
		if ix.switching.Load() || errors.Is(ix.Ready(ctx), ErrNotSetUp) {
			if err := ix.Ensure(ctx); err != nil {
				ix.log.Error("search by meaning: the search index could not be set up; it is tried again in a few minutes", "error", err)
				continue
			}
			ix.LogCatchUp(ctx)
			continue
		}
		n, err := ix.Retry(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			ix.log.Warn("search by meaning: documents that could not be indexed earlier still cannot be; trying again later", "caught up", n, "error", err)
		case n > 0:
			ix.log.Info("search by meaning: documents that could not be indexed earlier are now up to date", "documents", n)
		}
	}
}

// LogCatchUp runs CatchUp and says in the log how it went. It is what a start runs in the
// background.
func (ix *Index) LogCatchUp(ctx context.Context) {
	if !ix.Enabled() {
		return
	}
	start := time.Now()
	r, err := ix.CatchUp(ctx)
	took := time.Since(start).Round(time.Second).String()
	switch {
	case ctx.Err() != nil:
	case errors.Is(err, ErrProvider):
		ix.log.Warn("search by meaning: the search index could not be brought up to date because the embeddings provider cannot be reached; searches use what is indexed, and what is missing is tried again in a few minutes",
			"result", r.String(), "error", err)
	case errors.Is(err, ErrOtherSettings):
		// logged once by sync
	case err != nil:
		ix.log.Error("search by meaning: the search index could not be brought up to date; it is tried again in a few minutes", "error", err)
	case r.Embedded > 0 || r.Removed > 0:
		ix.log.Info("search by meaning: the search index is up to date", "result", r.String(), "took", took)
	}
}

// ---------- searching

// floors are the lowest similarity at which a part counts as a match at all, per provider: even
// unrelated texts have some similarity. PM_SEARCH_MIN_SCORE overrides them.
//
// builtin: measured on the sample and demo content (TestMeasureFloor). The best part for a
// sensible question scores 0.30 to 0.77; for questions that have nothing to do with the content
// ("chocolate cake recipe", "weather in paris tomorrow", ...) the best part mostly scores 0.06 to
// 0.17, a few unlucky ones about 0.3. 0.20 drops almost all of the noise and keeps the weaker
// but still sensible second and third documents (0.20 to 0.30).
// vertex: not measured here (tests never call Google). gemini-embedding-001 gives unrelated
// texts a similarity of about 0.5 to 0.6; 0.60 is a starting point to check on real content.
var floors = map[string]float64{
	"builtin": 0.20,
	"vertex":  0.60,
}

// Floor returns the lowest score of a match: PM_SEARCH_MIN_SCORE, or the floor of the provider.
func (ix *Index) Floor() float64 {
	if !ix.Enabled() {
		return 0
	}
	ix.mu.Lock()
	m := ix.minScore
	ix.mu.Unlock()
	if m >= 0 {
		return m
	}
	if f, ok := floors[ix.ProviderKind()]; ok {
		return f
	}
	return 0.5
}

// MaxQuery is the longest question accepted, in characters.
const MaxQuery = 1000

// Search finds the published documents whose parts are closest in meaning to the query, best
// first, at most limit of them; each with up to MaxHits parts, best first.
func (ix *Index) Search(ctx context.Context, query string, limit int) ([]Result, error) {
	p, err := ix.SearchPage(ctx, query, limit)
	return p.Results, err
}

// SearchPage is Search that also says whether more documents matched than limit (at most
// MaxLimit).
func (ix *Index) SearchPage(ctx context.Context, query string, limit int) (Page, error) {
	page := Page{Results: []Result{}}
	query = strings.Join(strings.Fields(query), " ")
	if !ix.Enabled() || query == "" {
		return page, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}
	if r := []rune(query); len(r) > MaxQuery {
		query = string(r[:MaxQuery])
	}
	vs, err := ix.vectorSchema(ctx)
	if err != nil {
		return page, err
	}
	// not ready: say so without asking the provider
	if err := ix.ready(ctx, ix.pool); err != nil {
		return page, err
	}
	// the question is embedded while no connection is held
	vec, err := ix.queryVector(ctx, query)
	if err != nil {
		return page, err
	}
	floor := ix.Floor()
	err = pgx.BeginFunc(ctx, ix.pool, func(tx pgx.Tx) error {
		if err := ix.ready(ctx, tx); err != nil {
			return err
		}
		// Up to exactParts parts every part is compared (exact, nothing is missed). Above, the
		// vector index finds the nearest maxCandidates parts; if all of them match, there may be more.
		var estimate float64
		if err := tx.QueryRow(ctx, `select reltuples from pg_class where oid = to_regclass('search_chunks')`).Scan(&estimate); err != nil {
			return err
		}
		approximate := estimate > exactParts
		limitSQL := ""
		if approximate {
			if _, err := tx.Exec(ctx, `select set_config('hnsw.ef_search', $1, true)`, strconv.Itoa(maxCandidates)); err != nil {
				return err
			}
			limitSQL = " limit " + strconv.Itoa(maxCandidates)
		} else if _, err := tx.Exec(ctx, `select set_config('enable_indexscan', 'off', true)`); err != nil {
			return err
		}
		// nearest parts first; then only what is published right now, whatever the index holds
		rows, err := tx.Query(ctx, fmt.Sprintf(`with near as (
				select kind, doc_id, part, item, label, snippet, embedding OPERATOR(%[1]s.<=>) $1::%[1]s.vector as distance
				from search_chunks order by embedding OPERATOR(%[1]s.<=>) $1::%[1]s.vector%[2]s)
			select n.kind, n.doc_id, n.part, n.item, n.label, n.snippet, n.distance, coalesce(nullif(d.body->>'status', ''), 'active')
			from near n join documents d on d.kind = n.kind and d.id = n.doc_id
			where coalesce(d.body->>'status', '') <> 'draft' and n.distance <= $2
			order by n.distance, n.kind, n.doc_id, n.part, n.item`, vs, limitSQL),
			vectorText(vec), 1-floor)
		if err != nil {
			return err
		}
		defer rows.Close()
		at := map[[2]string]int{}
		matched := 0
		for rows.Next() {
			var kind, id, status string
			var h Hit
			var distance float64
			if err := rows.Scan(&kind, &id, &h.Part, &h.Item, &h.Label, &h.Snippet, &distance, &status); err != nil {
				return err
			}
			matched++
			h.Score = score(distance)
			key := [2]string{kind, id}
			i, ok := at[key]
			if !ok {
				if len(page.Results) >= limit {
					page.Truncated = true
					continue
				}
				at[key] = len(page.Results)
				page.Results = append(page.Results, Result{Kind: kind, ID: id, Score: h.Score, Status: status})
				i = len(page.Results) - 1
			}
			if len(page.Results[i].Hits) < MaxHits {
				h.Snippet = Snippet(h.Snippet, query)
				page.Results[i].Hits = append(page.Results[i].Hits, h)
			}
		}
		if approximate && matched >= maxCandidates {
			page.Truncated = true
		}
		return rows.Err()
	})
	if err != nil {
		return Page{Results: []Result{}}, err
	}
	return page, nil
}

// score turns a cosine distance into a number from 0 to 1, higher is closer, rounded to three places.
func score(distance float64) float64 {
	s := 1 - distance
	if s < 0 {
		s = 0
	}
	if s > 1 {
		s = 1
	}
	return float64(int(s*1000+0.5)) / 1000
}

func (ix *Index) queryVector(ctx context.Context, query string) ([]float32, error) {
	if v, ok := ix.cache.get(query); ok {
		return v, nil
	}
	got, err := ix.embed(ctx, []string{query}, embedding.Query)
	if err != nil {
		return nil, err
	}
	ix.cache.put(query, got[0])
	return got[0], nil
}

// ---------- the cache of question vectors

// queryCache keeps the vectors of recent questions for a while, so the same question does not
// call the provider again and again.
type queryCache struct {
	mu      sync.Mutex
	max     int
	ttl     time.Duration
	entries map[string]cacheEntry
	now     func() time.Time
}

type cacheEntry struct {
	v  []float32
	at time.Time
}

func newQueryCache(max int, ttl time.Duration) *queryCache {
	return &queryCache{max: max, ttl: ttl, entries: map[string]cacheEntry{}, now: time.Now}
}

func (c *queryCache) get(q string) ([]float32, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[q]
	if !ok || c.now().Sub(e.at) > c.ttl {
		delete(c.entries, q)
		return nil, false
	}
	return e.v, true
}

func (c *queryCache) put(q string, v []float32) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	if len(c.entries) >= c.max {
		// drop what is too old; if that is not enough, the oldest
		var oldest string
		var at time.Time
		for k, e := range c.entries {
			if now.Sub(e.at) > c.ttl {
				delete(c.entries, k)
				continue
			}
			if oldest == "" || e.at.Before(at) {
				oldest, at = k, e.at
			}
		}
		if len(c.entries) >= c.max {
			delete(c.entries, oldest)
		}
	}
	c.entries[q] = cacheEntry{v: v, at: now}
}
