import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// From a row of documents to rows of search_chunks with vectors. The shapes in the example are
// real: the sample content imported into a test database, cut, embedded with builtin (768
// dimensions) and searched (output of a temporary test, not kept in the repository).

export const vectors: CodeCategory = {
  id: "vectors",
  area: "data",
  title: "From tables to vectors",
  summary:
    "After every change of a process or standard the server cuts the stored document into parts - its summary, each prerequisite, each step, each requirement, the scope - writes each part as a text that stands on its own, turns the texts that changed into vectors and stores one row per part in search_chunks, with a pgvector column and an HNSW index for cosine distance. " +
    "This happens in the background (syncSkills → syncIndex → retrieval.Index.Sync): a save never waits for it, and nothing waits for the embedding provider while holding a database connection. " +
    "Only what readers see is indexed: a never-published document, a deleted one and every working draft have no rows.",
  requirements: [
    "Only published processes and standards (status active, deprecated or none) have parts; a never-published document and a deleted one have none (partsOf returns nothing, so a sync removes their rows), and working_drafts is never read by the index.",
    "A save never waits for the index: syncIndex runs in a goroutine on a context that does not end with the request (context.WithoutCancel), bounded by 10 minutes (indexTimeout).",
    "Nothing waits for the provider while holding a database connection: a sync reads without a transaction, embeds, then writes in one short transaction; a search embeds the question before it reads.",
    "All parts of one document are written in one transaction, under the lock hashtextextended('<kind>/<id>', 7466), and only when the document still has the version that was embedded; otherwise the sync starts over, at most 3 times.",
    "Only parts whose text changed are embedded again: content_hash is SHA-256 of provider name, dimensions and text; an unchanged part keeps its vector and only its label, snippet and status are rewritten.",
    "When a sync fails (the provider cannot be reached, or the index belongs to other settings) the earlier parts stay searchable and the document is marked in search_pending; marked documents are tried again every 5 minutes and at every start.",
    "The vectors depend on the settings: provider and model, dimensions, the parts, the largest part, the table layout (3) and chunking.Version (2). With other settings the old index stays until the new provider has answered one probe; only then are the tables dropped and built again. A server whose settings differ from the stored ones writes nothing.",
    "A change of the lists re-syncs every document: names of teams, tools, categories, platforms, practices, tiers, environments and languages are in the part texts.",
    "Every use of the vector type, the operator <=> and the operator class vector_cosine_ops is qualified with the schema pgvector lives in (found in pg_extension): the extension may live outside the server's search path.",
    "Cutting and the builtin provider are deterministic: the same body, lists and options give the same parts in reading order; the same text gives the same vector on every machine.",
  ],
  charts: [
    {
      process: flow(
        "code-vectors-after-save",
        "Indexing after a save",
        "What follows a committed save of a process or standard, in the background.",
        [["server", "Server"], ["pg", "Postgres"], ["provider", "Embedding provider"]],
        [
          s("commit", "Commit the save, answer the person", "server", "automation", ["start"], "the save is done"),
          s("start", "Start the sync in the background", "server", "code", ["read"], "syncIndex, 10 min limit"),
          s("read", "Read the document and its hashes", "pg", "automation", ["published"], "no transaction"),
          s("published", "Is it published?", "server", "decision", [["cut", "Yes"], ["write", "No: no parts"]]),
          s("cut", "Cut it into parts with their texts", "server", "code", ["anyNew"], "chunking.Chunks"),
          s("anyNew", "Any part with a new hash?", "server", "decision", [["embed", "Yes"], ["write", "No"]]),
          s("embed", "Embed the new texts in one call", "provider", "automation", ["ok"], "no connection held"),
          s("ok", "Did the provider answer in 30 s?", "server", "decision", [["write", "Yes"], ["mark", "No"]]),
          s("mark", "Keep old parts, mark the document", "pg", "automation", [], "search_pending"),
          s("write", "Lock the document, check its version", "pg", "code", ["changed"], "short transaction"),
          s("changed", "Changed while it was embedded?", "server", "decision", [["read", "Yes: again"], ["rows", "No"]]),
          s("rows", "Upsert, delete, unmark: commit", "pg", "automation", [], "search_chunks"),
        ],
      ),
      caption:
        "retrieval.Index.Sync → syncDoc → write. The vectors embedded in a round are kept by hash for the next round, so a document that changed meanwhile only embeds what is new again. A change of the lists runs Rebuild instead: every document this way.",
    },
    {
      process: flow(
        "code-vectors-start",
        "Building and catching up at start",
        "What a start does with the index, before and after it begins to serve.",
        [["server", "Server"], ["pg", "Postgres"], ["provider", "Embedding provider"]],
        [
          s("ensure", "Find or create pgvector and the tables", "pg", "automation", ["stored"], "Ensure, lock 7461010"),
          s("stored", "An index with these settings?", "server", "decision", [["serve", "Yes"], ["fresh", "None yet"], ["note", "Other settings"]]),
          s("fresh", "Create empty tables, mark everything", "pg", "automation", ["serve"], "search_pending"),
          s("note", "Note the switch, drop nothing", "server", "code", ["serve"]),
          s("serve", "Start serving requests", "server", "automation", ["switching"], "searches: 503 until ready"),
          s("switching", "Settings to switch?", "server", "decision", [["probe", "Yes"], ["rebuild", "No"]]),
          s("probe", "Embed one probe text", "provider", "automation", ["answered"], "Process: probe"),
          s("answered", "Did the provider answer?", "server", "decision", [["drop", "Yes"], ["later", "No"]]),
          s("later", "Keep the old index, try again later", "server", "wait", [], "every 5 min"),
          s("drop", "Drop and create the tables", "pg", "automation", ["rebuild"], "all marked: new index"),
          s("rebuild", "Sync every document", "server", "automation", ["retry"], "unchanged parts kept"),
          s("retry", "Retry marked documents", "server", "wait", [], "every 5 min"),
        ],
      ),
      caption:
        "prepareIndex runs Ensure before the server listens; LogCatchUp (CatchUp → Rebuild) and RetryEvery run in the background. An index with these settings that is not complete (a build that did not finish, or one marked unused) gets every document marked 'catching up' by Ensure. -migrate, -import and -reindex run the same catch-up in the foreground.",
    },
  ],
  examples: [
    {
      title: "request-gcp-project, from its row to a search result",
      caption: "The sample process at every stage, with the builtin provider at 768 dimensions (real output; long values shortened with …).",
      stages: [
        {
          label: "Stored in documents (version 1)",
          where: "server/internal/docs/docs.go",
          shape: `{
  "id": "request-gcp-project",
  "title": "Request a GCP project",
  "summary": "Get a new Google Cloud project created by the project factory, attached to the right folder and billing account, with your team as owners.",
  "owner": "cloud-platform-team", "category": "cloud", "platform": "google-cloud",
  "rigour": "mandatory", "estimatedDuration": "3-5 working days", "tags": ["gcp", "cloud", "terraform"],
  "status": "active", "standards": ["infrastructure-as-code"],
  "prerequisites": [{"title": "Application registered in the CMDB", "description": "You need the application ID (APP-xxxxx)."}, … 3 more],
  "actors": [{"id": "me", "name": "You", …}, {"id": "budget-owner", "name": "Budget owner", "description": "Owner of the cost centre."}, …],
  "steps": [ …, {"id": "approve-budget", "title": "Approve the monthly budget", "actor": "budget-owner",
                 "type": "approval", "duration": "up to 2 working days", …}, … 11 steps ]
}`,
          note: "syncDoc reads version and body with one select, outside any transaction, and the stored content_hash values of the document.",
        },
        {
          label: "Cut into 16 parts (1 summary, 4 prerequisites, 11 steps)",
          where: "server/internal/chunking/chunking.go",
          shape: `part=summary  item=""  label="Summary"  480 characters
Process: Request a GCP project
Get a new Google Cloud project created by the project factory, attached to the right folder and billing account, with your team as owners.
How binding: mandatory, the only allowed way to get this done
Where it applies: all tiers; all environments; any programming language
Lead time: 3-5 working days
Helps to meet the standards: infrastructure-as-code
Tags: gcp, cloud, terraform
Category: Cloud
Platform: Google Cloud
Owned by: Cloud Platform team

part=prerequisite  item="3"  label="Before you start: Access to the project-factory repository"
Process: Request a GCP project
Before you start: Access to the project-factory repository
Read access is enough; you contribute through a pull request.
Comes from the process: request-github-repository

part=step  item="approve-budget"  label="Step 3: Approve the monthly budget"
Process: Request a GCP project
Step 3: Approve the monthly budget
Done by: Budget owner
About Budget owner: Owner of the cost centre.
Takes: up to 2 working days`,
          note: "Every text starts with the parent (Process: <title>) and names list entries by name (Cloud, Google Cloud, Cloud Platform team). Other documents are named by id. Each text is far below PM_CHUNK_MAX_CHARS (2000), so nothing is dropped or cut.",
        },
        {
          label: "Turned into vectors (builtin)",
          where: "server/internal/embedding/builtin.go",
          shape: `Tokens("Process: Request a GCP project") = [process request a gcp project]
each word → FNV-64a("w:"+word) mod 768 (sign from the top bit), weight 0.6 … 2.0 by length
each 3-letter piece of "<word>" → FNV-64a("g:"+piece) mod 768, a share of the word's weight
then scaled to length 1

summary part:  256 of 768 positions non-zero
  [3]=-0.026644249 [4]=-0.05994956 [6]=0.019983187 [7]=-0.020554135 [12]=0.017762832 …
question "new google cloud project": 24 of 768 positions non-zero
  [23]=-0.11715833 [60]=0.23599035 [87]=0.1129741 [105]=0.49426168 …
dot product of the two = cosine similarity = 0.5233`,
          note: "builtin matches words and parts of words, not meaning; Vertex AI (gemini-embedding-001) would return a dense vector of the same size.",
        },
        {
          label: "A row of search_chunks",
          where: "server/internal/retrieval/retrieval.go",
          shape: `kind         | process
doc_id       | request-gcp-project
part         | summary
item         |
seq          | 0
label        | Summary
snippet      | Get a new Google Cloud project created by the project factory, attached to the right folder and billing account, with your team as owners.
content_hash | eb33f73e607bbc4b62d7df9ffb6b286b
status       | active
embedding    | [0,0,0,-0.026644249,-0.05994956,0,0.019983187,-0.020554135,0,0,0,0,0.017762832,…]   vector_dims = 768
updated_at   | 2026-11-22 14:04:20

search_settings: {"provider":"builtin","dimensions":768,
  "chunks":"parts=prerequisite,requirement,scope,step,summary;max=2000;layout=3;text=2","complete":true}`,
          note: "snippet is the readable text only (readContent), not the embedded text. The sample content gives 110 rows for 10 documents.",
        },
        {
          label: "The SQL of a search (pgvector in schema extensions)",
          where: "server/internal/retrieval/retrieval.go",
          shape: `select set_config('enable_indexscan', 'off', true);   -- 110 parts ≤ 50,000: compare every part, exactly
with near as (
  select kind, doc_id, part, item, label, snippet,
         embedding OPERATOR("extensions".<=>) $1::"extensions".vector as distance
  from search_chunks order by embedding OPERATOR("extensions".<=>) $1::"extensions".vector)
select n.kind, n.doc_id, n.part, n.item, n.label, n.snippet, n.distance,
       coalesce(nullif(d.body->>'status', ''), 'active')
from near n join documents d on d.kind = n.kind and d.id = n.doc_id
where coalesce(d.body->>'status', '') <> 'draft' and n.distance <= $2
order by n.distance, n.kind, n.doc_id, n.part, n.item
-- $1 = '[0,…,-0.11715833,…]' (the question's vector), $2 = 1 - 0.20 (the builtin floor)`,
          note: "Above 50,000 parts it sets hnsw.ef_search = 1000 and adds limit 1000 (approximate). The join drops a document that became a draft or was deleted before its parts were removed.",
        },
        {
          label: "The scored result, as GET /api/search?q=new+google+cloud+project&limit=3 answers",
          where: "server/internal/httpapi/search.go",
          shape: `{"results": [
  {"kind": "process", "id": "request-gcp-project", "score": 0.523, "hits": [
    {"part": "summary", "item": "", "label": "Summary", "snippet": "Get a new Google Cloud project created by …", "score": 0.523},
    {"part": "step", "item": "create-project", "label": "Step 9: Create the project",
     "snippet": "The pipeline runs on merge and creates the project, budget alert and IAM bindings.", "score": 0.396},
    {"part": "step", "item": "add-project-config", "label": "Step 7: Add your project to the project factory",
     "snippet": "Copy projects/_template.yaml to projects/<project-name>.yaml.", "score": 0.354}]},
  {"kind": "process", "id": "onboard-api-to-apigee", "score": 0.316, "hits": [
    {"part": "prerequisite", "item": "0", "label": "Before you start: GCP project for the backend",
     "snippet": "The backend must already run in a company GCP project.", "score": 0.316}]},
  {"kind": "standard", "id": "infrastructure-as-code", "score": 0.291, "hits": [
    {"part": "summary", "item": "", "label": "Summary", "snippet": "How cloud resources are created and changed, …", "score": 0.291}]}
 ],
 "truncated": true}`,
          note: "score = 1 - cosine distance, rounded to 3 places; a document's score is its best part's, with up to 3 parts; the snippet is the sentence that shares most words with the question. truncated: more documents matched than the limit of 3.",
        },
      ],
    },
  ],
  files: [
    {
      path: "server/internal/retrieval/retrieval.go",
      role: "The index: its tables, keeping them in step with the documents (Sync, Rebuild, CatchUp, Retry) and searching them.",
      requirements: [
        { text: "What the stored vectors depend on; a change of any of it rebuilds the index.", at: "func (ix *Index) settings() (provider string, dims int, chunks string) {" },
        { text: "Only quick database work: the extension, the tables, the vector index; nothing is dropped here when the settings differ.", at: "func (ix *Index) Ensure(ctx context.Context) error {" },
        { text: "The vector index is HNSW for cosine distance, with the operator class of the extension's schema.", at: "create index search_chunks_embedding on search_chunks using hnsw" },
        { text: "A draft or a deleted document has no parts.", at: "func (ix *Index) partsOf(" },
        { text: "Read, embed holding no connection, then write; up to 3 rounds when the document changes meanwhile.", at: "// 2. embed what is new, holding no connection" },
        { text: "The write checks under the document's lock that the settings and the version are still the ones embedded.", at: "if now.exists != read.exists || now.version != read.version {" },
        { text: "The catalog's sync goes through every document.", at: "func (ix *Index) Sync(ctx context.Context, kind, id string) error {" },
        { text: "With new settings, the provider must answer a probe before anything is dropped.", at: "func (ix *Index) CatchUp(ctx context.Context) (Report, error) {" },
      ],
      tests: ["server/internal/retrieval/retrieval_test.go", "server/internal/retrieval/hang_test.go", "server/internal/retrieval/measure_test.go"],
    },
    {
      path: "server/internal/chunking/chunking.go",
      role: "Cuts a process or standard into parts and writes the text of each: pure, no database, no network.",
      requirements: [
        { text: "Reading order: summary, then prerequisites and steps (process) or scope and requirements (standard). A step's text carries who does it, the lane's description (not for me), the tool by name, description, instructions, outcome, duration, sub-process, link label and resource titles; a requirement's its level, where it is narrowed, statement, why, guidance, the helping process, how it is checked, review hints and examples.", at: "func Chunks(kind string, body []byte, lists docs.Lists, o Options) ([]Chunk, error) {" },
        { text: "Too long: lines marked drop 2 go first (examples; link and resources), then drop 1 (review hints; the lane's description and the duration), then the end is cut. A part is never split into two.", at: "func (b *builder) add(part, item, label string, secs ...section) {" },
        { text: "The cut ends after the last sentence or line in the second half of the limit, else at a word, never inside a word unless one word is longer than the limit.", at: "func cut(s string, max int) string {" },
        { text: "PM_CHUNK_MAX_CHARS defaults to 2000 characters.", at: "const DefaultMaxChars = 2000" },
        { text: "Changes with every change of how the texts are written, so the index embeds everything again.", at: "const Version = 2" },
      ],
      tests: ["server/internal/chunking/chunking_test.go"],
    },
    {
      path: "server/internal/embedding/embedding.go",
      role: "One interface for the providers (builtin, vertex, off) and their defaults.",
      requirements: [
        { text: "Every vector has length 1, so cosine similarity is a dot product; texts are never logged.", at: "type Embedder interface {" },
        { text: "768 dimensions unless PM_EMBEDDINGS_DIMENSIONS says otherwise.", at: "DefaultDimensions = 768" },
        { text: "off or empty gives no embedder: search by meaning is switched off.", at: "func New(ctx context.Context, o Options) (Embedder, error) {" },
      ],
      tests: ["server/internal/embedding/embedding_test.go"],
    },
    {
      path: "server/internal/embedding/builtin.go",
      role: "The provider inside the server: a hashing embedder of words and three-letter pieces of words, for development, tests and CI.",
      requirements: [
        { text: "A word and each 3-letter piece of <word> are hashed with FNV-64a into one of the positions, signed by the hash's top bit; words of one or two letters add no pieces.", at: "func (b builtin) vector(text string) []float32 {" },
        { text: "Longer words count more: 0.6 for one letter up to 2.0 from eight, plus 0.5 with a digit.", at: "func rarity(w string) float64 {" },
        { text: "Lower case, accents removed, split on anything that is not a letter or digit; the purpose (document or question) makes no difference.", at: "func Tokens(text string) []string {" },
      ],
      tests: ["server/internal/embedding/embedding_test.go"],
    },
    {
      path: "server/internal/embedding/vertex.go",
      role: "Google Vertex AI: the :predict method of gemini-embedding-001 (by default), with retries and time limits. Never called by tests or CI.",
      requirements: [
        { text: "gemini-embedding models get one text per request (4 at a time); other models up to 250.", at: "func (v *vertex) perRequest() int {" },
        { text: "One Embed call takes at most 20 s plus 2 s per further text; retrieval's own limit of 30 s per call is shorter for documents of more than 6 parts.", at: "func embedCeiling(n int) time.Duration {" },
        { text: "At most 3 tries, only for timeouts, broken connections, 429 and 5xx.", at: "func (v *vertex) call(ctx context.Context, texts []string, task string) ([][]float32, error) {" },
        { text: "Every vector is checked for its size and scaled to length 1.", at: "out[i] = normalise(p.Embeddings.Values)" },
      ],
      tests: ["server/internal/embedding/embedding_test.go"],
    },
    {
      path: "server/internal/retrieval/content.go",
      role: "The readable text of each part (stored as snippet) and the sentence of it shown under a search result.",
      requirements: [
        { text: "A step's readable text is its description, else its instructions, else its outcome; a requirement's its statement; a prerequisite's its description only (the comment beside the field says \"description, else title\", the code takes the description).", at: "prerequisites  []string          // description, else title" },
        { text: "The snippet is the sentence sharing most words (3 letters or more) with the question, cut near 200 characters.", at: "func Snippet(text, query string) string {" },
      ],
      tests: ["server/internal/retrieval/retrieval_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "Where a change starts the index's sync: syncSkills calls syncIndex after every save, publish, review, delete and change of the lists.",
      requirements: [
        { text: "The work does not depend on the person's request still running.", at: "ctx = context.WithoutCancel(ctx)" },
        { text: "The sync runs in the background and only logs a failure; the document is marked and tried again.", at: "func (a *api) syncIndex(ctx context.Context, kind, id string) {" },
        { text: "One sync may take at most 10 minutes (the catalog goes through every document).", at: "const indexTimeout = 10 * time.Minute" },
      ],
      tests: ["server/internal/httpapi/search_test.go"],
    },
    {
      path: "server/cmd/server/main.go",
      role: "When the index is set up and caught up: before serving, in the background after it, and in -migrate, -import and -reindex.",
      requirements: [
        { text: "Before serving only Ensure runs (or, with search off, MarkUnused); the provider is not asked.", at: "func prepareIndex(ctx context.Context, st stores, log *slog.Logger) error {" },
        { text: "Catching up and the retries run in the background while the server serves.", at: "st.index.LogCatchUp(ctx)" },
        { text: "Marked documents are tried again every 5 minutes.", at: "const indexRetry = 5 * time.Minute" },
      ],
      tests: ["server/cmd/server/reindex_test.go", "server/cmd/server/hang_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Reads the settings of search by meaning for the server and the MCP server alike.",
      requirements: [
        { text: "PM_CHUNK_PARTS (default all parts) and PM_CHUNK_MAX_CHARS (200 to 20000, default 2000) become the chunking options; PM_EMBEDDINGS_DIMENSIONS is accepted from 64 to 2000, the largest vector pgvector can index.", at: "func (e Embeddings) ChunkOptions() chunking.Options {" },
      ],
    },
  ],
  start: "server/internal/retrieval/retrieval.go",
};
