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
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

// ErrProvider marks a failure of the embedding provider (it could not be reached, or refused).
var ErrProvider = errors.New("the embeddings provider could not be reached")

// ErrNotSetUp is returned by a search when the index has not been created yet, or was built with
// other settings than this server's.
var ErrNotSetUp = errors.New("the search index is not set up")

// Locks that keep several servers from doing the same work at once (the numbers continue those
// of the db package).
const (
	lockEnsure  = 7461010
	lockRebuild = 7461011
	// per document, inside the transaction of one sync
	lockDocSpace = 7463
)

// layout is the version of the tables below. A change of it rebuilds the index like a change
// of settings does.
const layout = 1

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

// MaxHits is the largest number of parts returned for one document.
const MaxHits = 3

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

	mu     sync.Mutex
	schema string // where the extension lives, once found
}

// New creates the index. e == nil switches it off.
func New(pool *pgxpool.Pool, store *docs.Store, e embedding.Embedder, c chunking.Options, log *slog.Logger) *Index {
	if c.MaxChars == 0 && len(c.Parts) == 0 {
		c = chunking.Default()
	}
	if log == nil {
		log = slog.Default()
	}
	return &Index{pool: pool, store: store, emb: e, opts: c, log: log, cache: newQueryCache(500, 5*time.Minute)}
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

// Outside reports whether text leaves the server to be embedded (documents and questions).
func (ix *Index) Outside() bool { return ix.Enabled() && ix.emb.Outside() }

// settings is what the stored vectors depend on: when any of it changes, every vector is made again.
func (ix *Index) settings() (provider string, dims int, chunks string) {
	parts := append([]string(nil), ix.opts.Parts...)
	sort.Strings(parts)
	return ix.emb.Name(), ix.emb.Dimensions(), fmt.Sprintf("parts=%s;max=%d;layout=%d", strings.Join(parts, ","), ix.opts.MaxChars, layout)
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

// Ensure makes the index usable: the extension, the tables and the vector index. When the
// stored vectors were made with other settings (provider, model, size, parts) everything is
// removed and built again. Several servers may run it at once. A provider that cannot be
// reached does not make it fail: what could not be embedded is tried again later.
func (ix *Index) Ensure(ctx context.Context) error {
	_, _, err := ix.ensure(ctx)
	if errors.Is(err, ErrProvider) {
		ix.log.Warn("search by meaning: the search index could not be filled because the embeddings provider cannot be reached; it is tried again in a few minutes", "error", err)
		return nil
	}
	return err
}

// CatchUp is Ensure followed by a rebuild: the index is usable and holds everything that is
// published now. The report covers both. An ErrProvider means the index is usable but not
// complete; what is missing is tried again later.
func (ix *Index) CatchUp(ctx context.Context) (Report, error) {
	r, built, err := ix.ensure(ctx)
	if err != nil || built {
		return r, err
	}
	return ix.Rebuild(ctx)
}

// ensure is Ensure that says whether it built the index anew, and what that did.
func (ix *Index) ensure(ctx context.Context) (Report, bool, error) {
	if !ix.Enabled() {
		return Report{}, false, nil
	}
	fresh := false
	err := db.WithLock(ctx, ix.pool, lockEnsure, func() error {
		vs, err := ix.ensureExtension(ctx)
		if err != nil {
			return err
		}
		fresh, err = ix.ensureTables(ctx, vs)
		return err
	})
	if err != nil || !fresh {
		return Report{}, false, err
	}
	r, err := ix.Rebuild(ctx)
	if err == nil {
		ix.log.Info("search index built", "provider", ix.emb.Name(), "result", r.String())
	}
	return r, true, err
}

// ensureTables creates the tables, or drops and creates them when the settings changed. It
// reports whether the index is new and has to be filled.
func (ix *Index) ensureTables(ctx context.Context, vs string) (bool, error) {
	provider, dims, chunks := ix.settings()
	fresh := false
	err := pgx.BeginFunc(ctx, ix.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `create table if not exists search_settings (
			key int primary key default 1 check (key = 1),
			provider text not null,
			dimensions int not null,
			chunks text not null,
			built_at timestamptz not null default now())`); err != nil {
			return err
		}
		var sp, sc string
		var sd int
		err := tx.QueryRow(ctx, `select provider, dimensions, chunks from search_settings where key = 1`).Scan(&sp, &sd, &sc)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var exists bool
		if err := tx.QueryRow(ctx, `select to_regclass('search_chunks') is not null and to_regclass('search_pending') is not null`).Scan(&exists); err != nil {
			return err
		}
		if exists && err == nil && sp == provider && sd == dims && sc == chunks {
			return nil
		}
		if sp != "" {
			ix.log.Warn("the settings of search by meaning changed: the search index is built again",
				"before", fmt.Sprintf("%s, %d dimensions, %s", sp, sd, sc), "now", fmt.Sprintf("%s, %d dimensions, %s", provider, dims, chunks))
		}
		fresh = true
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
				snippet text not null,
				content_hash text not null,
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
		_, err = tx.Exec(ctx, `insert into search_settings (key, provider, dimensions, chunks) values (1, $1, $2, $3)
			on conflict (key) do update set provider = excluded.provider, dimensions = excluded.dimensions, chunks = excluded.chunks, built_at = now()`, provider, dims, chunks)
		return err
	})
	return fresh, err
}

// ---------- keeping the index up to date

// syncResult counts what one sync did.
type syncResult struct{ embedded, unchanged, removed int }

// Sync brings the parts of one document in line with what is stored now: a draft or a deleted
// document loses its parts, a published one gets new or changed parts embedded (in one call to
// the provider) and parts that are gone removed - all in one transaction, so a search never sees
// half a document. When it fails (the provider cannot be reached) the earlier parts stay and the
// document is marked: the next start, a rebuild or the periodic retry picks it up again.
// The catalog has no parts of its own, but its names appear in the text of the parts: a sync of
// the catalog goes through every document.
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

func hashText(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:16])
}

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
	err = pgx.BeginFunc(ctx, ix.pool, func(tx pgx.Tx) error {
		res = syncResult{}
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, $2))`, kind+"/"+id, lockDocSpace); err != nil {
			return err
		}
		var body []byte
		err := tx.QueryRow(ctx, `select body from documents where kind = $1 and id = $2`, kind, id).Scan(&body)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		var head struct {
			Status string `json:"status"`
		}
		published := err == nil && json.Unmarshal(body, &head) == nil && head.Status != "draft"
		var chunks []chunking.Chunk
		if published {
			if chunks, err = chunking.Chunks(kind, body, *lists, ix.opts); err != nil {
				return fmt.Errorf("the %s %q could not be cut into parts: %w", kind, id, err)
			}
		}
		status := head.Status
		if status == "" {
			status = "active"
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

		// what each part is now, and which of them need a new vector
		type want struct {
			key  chunkKey
			c    chunking.Chunk
			hash string
		}
		seen := map[[2]string]int{}
		var all []want
		var toEmbed []int
		for _, c := range chunks {
			pi := [2]string{c.Part, c.Item}
			k := chunkKey{part: c.Part, item: c.Item, seq: seen[pi]}
			seen[pi]++
			w := want{key: k, c: c, hash: hashText(c.Text)}
			if old, ok := stored[k]; !ok || old.hash != w.hash {
				toEmbed = append(toEmbed, len(all))
			}
			all = append(all, w)
		}
		vectors := map[int][]float32{}
		if len(toEmbed) > 0 {
			texts := make([]string, len(toEmbed))
			for i, n := range toEmbed {
				texts[i] = all[n].c.Text
			}
			got, err := ix.emb.Embed(ctx, texts, embedding.Document)
			if err != nil {
				return fmt.Errorf("%w: %v", ErrProvider, err)
			}
			if len(got) != len(texts) {
				return fmt.Errorf("%w: it answered %d vectors for %d texts", ErrProvider, len(got), len(texts))
			}
			for i, n := range toEmbed {
				vectors[n] = got[i]
			}
		}

		keep := map[chunkKey]bool{}
		for n, w := range all {
			keep[w.key] = true
			snippet := Snippet(w.c.Text, w.c.Label)
			if v, ok := vectors[n]; ok {
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
			if old := stored[w.key]; old.label != w.c.Label || old.snippet != snippet || old.status != status {
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
		_, err = tx.Exec(ctx, `delete from search_pending where kind = $1 and doc_id = $2`, kind, id)
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

// Rebuild brings every document up to date: parts that did not change are kept, everything else
// is embedded, and parts of documents that no longer exist (or became drafts) are removed. A
// document that fails is marked and tried again later; when the provider cannot be reached at
// all the rebuild stops early and returns the error, with every document left marked.
func (ix *Index) Rebuild(ctx context.Context) (Report, error) {
	var r Report
	if !ix.Enabled() {
		return r, nil
	}
	err := db.WithLock(ctx, ix.pool, lockRebuild, func() error {
		var err error
		r, err = ix.rebuild(ctx)
		return err
	})
	return r, err
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

	for i, k := range order {
		res, err := ix.sync(ctx, k[0], k[1], &lists)
		if err != nil {
			r.Failed++
			if errors.Is(err, ErrProvider) || ctx.Err() != nil {
				// no point in trying the rest now: mark them for the retry
				for _, rest := range order[i+1:] {
					ix.markPending(ctx, rest[0], rest[1], err)
					r.Failed++
				}
				r.Documents = len(order)
				return r, err
			}
			ix.log.Error("search by meaning: a document could not be indexed; it is tried again later", "kind", k[0], "id", k[1], "error", err)
			continue
		}
		r.Embedded += res.embedded
		r.Unchanged += res.unchanged
		r.Removed += res.removed
	}
	r.Documents = len(order)
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
		case errors.Is(err, ErrProvider) || ctx.Err() != nil:
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

// RetryEvery tries the marked documents again at the given interval until ctx ends.
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
		n, err := ix.Retry(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			ix.log.Warn("search by meaning: documents that could not be indexed earlier still cannot be; trying again later", "caught up", n, "error", err)
		case n > 0:
			ix.log.Info("search by meaning: documents that could not be indexed earlier are now up to date", "documents", n)
		}
	}
}

// ---------- searching

// floors are the lowest similarity at which a part counts as a match at all, per provider: even
// unrelated texts have some similarity.
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

// Floor returns the floor of the configured provider.
func (ix *Index) Floor() float64 {
	if !ix.Enabled() {
		return 0
	}
	name := ix.emb.Name()
	if p, _, ok := strings.Cut(name, ":"); ok {
		name = p
	}
	if f, ok := floors[name]; ok {
		return f
	}
	return 0.5
}

// MaxQuery is the longest question accepted, in characters.
const MaxQuery = 1000

// Search finds the published documents whose parts are closest in meaning to the query, best
// first, at most limit of them; each with up to MaxHits parts, best first.
func (ix *Index) Search(ctx context.Context, query string, limit int) ([]Result, error) {
	query = strings.Join(strings.Fields(query), " ")
	if !ix.Enabled() || query == "" {
		return []Result{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if r := []rune(query); len(r) > MaxQuery {
		query = string(r[:MaxQuery])
	}
	vs, err := ix.vectorSchema(ctx)
	if err != nil {
		return nil, err
	}
	vec, err := ix.queryVector(ctx, query)
	if err != nil {
		return nil, err
	}
	k := limit * 8
	if k < 100 {
		k = 100
	}
	if k > 1000 {
		k = 1000
	}
	floor := ix.Floor()
	out := []Result{}
	err = pgx.BeginFunc(ctx, ix.pool, func(tx pgx.Tx) error {
		provider, dims, chunks := ix.settings()
		var sp, sc string
		var sd int
		err := tx.QueryRow(ctx, `select provider, dimensions, chunks from search_settings where key = 1`).Scan(&sp, &sd, &sc)
		if err != nil || sp != provider || sd != dims || sc != chunks {
			return fmt.Errorf("%w: the portal server builds it when it starts with the same settings of search by meaning", ErrNotSetUp)
		}
		// the vector index looks at ef_search candidates at most: enough for the parts wanted
		if _, err := tx.Exec(ctx, `select set_config('hnsw.ef_search', $1, true)`, strconv.Itoa(k)); err != nil {
			return err
		}
		// nearest parts first; then only what is published right now, whatever the index holds
		rows, err := tx.Query(ctx, fmt.Sprintf(`with near as (
				select kind, doc_id, part, item, label, snippet, embedding OPERATOR(%[1]s.<=>) $1::%[1]s.vector as distance
				from search_chunks order by embedding OPERATOR(%[1]s.<=>) $1::%[1]s.vector limit $2)
			select n.kind, n.doc_id, n.part, n.item, n.label, n.snippet, n.distance, coalesce(nullif(d.body->>'status', ''), 'active')
			from near n join documents d on d.kind = n.kind and d.id = n.doc_id
			where coalesce(d.body->>'status', '') <> 'draft' and n.distance <= $3
			order by n.distance, n.kind, n.doc_id, n.part, n.item`, vs),
			vectorText(vec), k, 1-floor)
		if err != nil {
			return err
		}
		defer rows.Close()
		at := map[[2]string]int{}
		for rows.Next() {
			var kind, id, status string
			var h Hit
			var distance float64
			if err := rows.Scan(&kind, &id, &h.Part, &h.Item, &h.Label, &h.Snippet, &distance, &status); err != nil {
				return err
			}
			h.Score = score(distance)
			key := [2]string{kind, id}
			i, ok := at[key]
			if !ok {
				if len(out) >= limit {
					continue
				}
				at[key] = len(out)
				out = append(out, Result{Kind: kind, ID: id, Score: h.Score, Status: status})
				i = len(out) - 1
			}
			if len(out[i].Hits) < MaxHits {
				out[i].Hits = append(out[i].Hits, h)
			}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
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
	got, err := ix.emb.Embed(ctx, []string{query}, embedding.Query)
	if err == nil && len(got) != 1 {
		err = fmt.Errorf("it answered %d vectors for one question", len(got))
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProvider, err)
	}
	ix.cache.put(query, got[0])
	return got[0], nil
}

// ---------- snippets

// SnippetLength is about the longest snippet, in characters.
const SnippetLength = 200

// Snippet is the text of a part as a person reads it under a search result: without its first
// line (the kind and title of the document, which every part starts with) and without the label
// of the part when the text repeats it, the lines joined, cut at a word near SnippetLength
// characters.
func Snippet(text, label string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	if len(lines) > 1 {
		lines = lines[1:]
	}
	if label != "" && strings.HasPrefix(lines[0], label) {
		lines[0] = strings.TrimLeft(lines[0][len(label):], " \t:.-–—")
	}
	kept := lines[:0]
	for _, l := range lines {
		if l = strings.Join(strings.Fields(l), " "); l != "" {
			kept = append(kept, l)
		}
	}
	s := strings.Join(kept, " · ")
	r := []rune(s)
	if len(r) <= SnippetLength {
		return s
	}
	cut := string(r[:SnippetLength])
	if i := strings.LastIndex(cut, " "); i > SnippetLength/2 {
		cut = cut[:i]
	}
	return strings.TrimRight(cut, " ,;:.-–—·") + "…"
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
