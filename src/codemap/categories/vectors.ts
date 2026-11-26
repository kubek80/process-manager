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
    "After a save, each published process or standard is cut into parts, and every part is stored with its vector in `search_chunks`. " +
    "The parts are its summary, each prerequisite, each step, each requirement and the scope, each written as a text that stands on its own; only texts that changed are embedded again, and the vectors sit in a pgvector column with an HNSW index for cosine distance. " +
    "This happens in the background (`syncSkills` → `syncIndex` → `retrieval.Index.Sync`): a save never waits for it, and nothing waits for the embedding provider while holding a database connection. Only what readers see is indexed: a never-published document, a deleted one and every working draft have no rows.",
  requirements: [
    "Only published processes and standards (status `active`, `deprecated` or none) have parts; a never-published document and a deleted one have none (`partsOf` returns nothing, so a sync removes their rows), and `working_drafts` is never read by the index.",
    "A save never waits for the index: `syncIndex` runs in a goroutine on a context that does not end with the request (`context.WithoutCancel`), bounded by 10 minutes (`indexTimeout`).",
    "Nothing waits for the provider while holding a database connection: a sync reads without a transaction, embeds, then writes in one short transaction; a search embeds the question before it reads.",
    "All parts of one document are written in one transaction, under the lock `hashtextextended('<kind>/<id>', 7466)`, and only when the document still has the version that was embedded; otherwise the sync starts over, at most 3 times.",
    "Only parts whose text changed are embedded again: `content_hash` is SHA-256 of provider name, dimensions and text; an unchanged part keeps its vector and only its label, snippet and status are rewritten.",
    "When a sync fails (the provider cannot be reached, or the index belongs to other settings) the earlier parts stay searchable and the document is marked in `search_pending`; marked documents are tried again every 5 minutes and at every start.",
    "The vectors depend on the settings: provider and model, dimensions, the parts, the largest part, the table layout (3) and `chunking.Version` (2). With other settings the old index stays until the new provider has answered one probe; only then are the tables dropped and built again. A server whose settings differ from the stored ones writes nothing.",
    "A change of the lists re-syncs every document: names of teams, tools, categories, platforms, practices, tiers, environments and languages are in the part texts.",
    "Every use of the vector type, the operator `<=>` and the operator class `vector_cosine_ops` is qualified with the schema pgvector lives in (found in `pg_extension`): the extension may live outside the server's search path.",
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
          s("start", "Start the sync in the background", "server", "automation", ["read"], "syncIndex, 10 min limit"),
          s("read", "Read the document's version and body", "pg", "automation", ["published"], "no transaction"),
          s("published", "Is it published?", "server", "decision", [["cut", "Yes"], ["write", "No: no parts"]]),
          s("cut", "Cut it into parts, compare stored hashes", "server", "automation", ["embed"], "chunking.Chunks, content_hash"),
          s("embed", "Embed the new texts in one call", "provider", "communication", ["ok"], "none new: no call; no connection held"),
          s("ok", "Did the provider answer in 30 s?", "server", "decision", [["write", "Yes"], ["mark", "No"]]),
          s("write", "Write all parts if still unchanged", "pg", "document", [], "search_chunks, one transaction"),
          s("mark", "Keep old parts, mark the document", "pg", "document", [], "search_pending"),
        ],
      ),
      caption:
        "`retrieval.Index.Sync` → `syncDoc` → `write`. The write locks the document's parts, checks that the settings and the document's version are still the ones embedded, then upserts changed parts, deletes the ones that are gone and unmarks the document. If the document changed meanwhile the sync reads it again, at most 3 rounds, reusing the vectors it already has. A change of the lists runs `Rebuild` instead: every document this way.",
    },
    {
      process: flow(
        "code-vectors-start",
        "Building and catching up at start",
        "What a start does with the index, before and after it begins to serve.",
        [["server", "Server"], ["pg", "Postgres"], ["provider", "Embedding provider"]],
        [
          s("ensure", "Set up pgvector and the tables", "pg", "automation", ["serve"], "Ensure, before serving"),
          s("serve", "Start serving requests", "server", "automation", ["switching"], "searches: 503 until ready"),
          s("switching", "Settings to switch?", "server", "decision", [["probe", "Yes"], ["rebuild", "No"]]),
          s("probe", "Did the new provider answer a probe?", "server", "decision", [["drop", "Yes"], ["later", "No"]]),
          s("drop", "Drop and create the tables", "pg", "document", ["rebuild"], "all marked: new index"),
          s("rebuild", "Sync every document", "server", "automation", ["retry"], "unchanged parts kept"),
          s("retry", "Retry marked documents", "server", "wait", [], "every 5 min"),
          s("later", "Keep the old index, try again", "server", "wait", [], "every 5 min"),
        ],
      ),
      caption:
        "`prepareIndex` runs `Ensure` (lock 7461010) before the server listens: a new index is created empty with every document marked; other settings are only noted, nothing is dropped; an index with these settings that is not complete (a build that did not finish, or one marked unused) gets every document marked 'catching up'. `LogCatchUp` (`CatchUp` → `Rebuild`) and `RetryEvery` run in the background. `-migrate`, `-import` and `-reindex` run the same catch-up in the foreground.",
    },
  ],
  examples: [
    {
      title: "request-gcp-project, from its row to a search result",
      caption: "The sample process at every stage, with the `builtin` provider at 768 dimensions (real output; long values shortened with …).",
      stages: [
        {
          label: "Stored in `documents` (version 1)",
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
                 "type": "approval", "duration": "up to 2 working days", …}, … 10 steps ]
}`,
          note: "`syncDoc` reads `version` and `body` with one select, outside any transaction, and the stored `content_hash` values of the document.",
        },
        {
          label: "Cut into 15 parts (1 summary, 4 prerequisites, 10 steps)",
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
          note: "Every text starts with the parent (`Process: <title>`) and names list entries by name (Cloud, Google Cloud, Cloud Platform team). Other documents are named by id. Each text is far below `PM_CHUNK_MAX_CHARS` (2000), so nothing is dropped or cut.",
        },
        {
          label: "Turned into vectors (`builtin`)",
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
          note: "`builtin` matches words and parts of words, not meaning; Vertex AI (`gemini-embedding-001`) would return a dense vector of the same size.",
        },
        {
          label: "A row of `search_chunks`",
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
          note: "`snippet` is the readable text only (`readContent`), not the embedded text. The sample content gives 110 rows for 10 documents.",
        },
        {
          label: "The SQL of a search (pgvector in schema `extensions`)",
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
          note: "Above 50,000 parts it sets `hnsw.ef_search = 1000` and adds `limit 1000` (approximate). The join drops a document that became a draft or was deleted before its parts were removed.",
        },
        {
          label: "The scored result, as `GET /api/search?q=new+google+cloud+project&limit=3` answers",
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
          note: "`score` = 1 - cosine distance, rounded to 3 places; a document's score is its best part's, with up to 3 parts; the snippet is the sentence that shares most words with the question. `truncated`: more documents matched than the limit of 3.",
        },
      ],
    },
  ],
  files: [
    {
      path: "server/internal/retrieval/retrieval.go",
      role: "The index: its tables, keeping them in step with the documents (`Sync`, `Rebuild`, `CatchUp`, `Retry`) and searching them.",
      requirements: [
        { text: "Every input the vectors depend on is in this string (provider and model, size, parts, largest part, layout, `chunking.Version`); `ready` refuses to search an index whose stored string differs. A new input left out here would mix vectors of two settings in one index.", at: "fmt.Sprintf(\"parts=%s;max=%d;layout=%d;text=%d\"" },
        { text: "With other settings `Ensure` drops nothing: a start with a provider that cannot be reached keeps the old index searchable by servers with the old settings (`TestNewSettingsDropNothingWhileTheNewProviderIsDown`).", at: "case exists && stored && !force:" },
        { text: "A missing pgvector is created in schema `public` when the database user may; a version below 0.5 (no HNSW) is refused with the statement an administrator has to run.", at: "if !supported(version) {" },
        { text: "The vector index is HNSW for cosine distance, with the operator class of the extension's schema.", at: "create index search_chunks_embedding on search_chunks using hnsw" },
        { text: "A document has parts only when it exists and its status is not `draft`; for anything else the write removes every stored part. This is what keeps drafts out of search by meaning.", at: "published := d.exists && json.Unmarshal(d.body, &head) == nil && head.Status != \"draft\"" },
        { text: "Only texts whose hash is not stored and not already embedded in an earlier round go to the provider: an unchanged document costs no call.", at: "if !have[w.hash] && vectors[w.hash] == nil && !contains(hashes, w.hash) {" },
        { text: "The hash covers the provider name, the size and the text: a vector of another model or size is never taken for this one.", at: "sha256.Sum256([]byte(ix.emb.Name()" },
        { text: "The provider is asked between the read and the write, with no connection or transaction held: a hanging provider cannot use up the pool and stop saves (`TestAHangingProviderHoldsNoDatabaseConnection`).", at: "got, err := ix.embed(ctx, texts, embedding.Document)" },
        { text: "At most 3 rounds of read, embed, write when the document keeps changing meanwhile; then the document is marked and tried again later.", at: "for attempt := 0; attempt < syncAttempts; attempt++ {" },
        { text: "The write reads the settings row `for share`: a switch to new settings waits for it, and a server with other settings writes nothing (`TestAServerWithOtherSettingsWritesNothing`).", at: "from search_settings where key = 1 for share" },
        { text: "Under the document's lock the version must still be the one embedded, else the round starts again: vectors of an old text are never stored for a newer version (`TestADocumentThatChangesWhileItIsEmbeddedIsReadAgain`).", at: "if now.exists != read.exists || now.version != read.version {" },
        { text: "With new settings the provider must answer a probe before anything is dropped.", at: "if _, err := ix.embed(ctx, []string{\"Process: probe\"}, embedding.Document); err != nil {" },
      ],
      tests: ["server/internal/retrieval/retrieval_test.go", "server/internal/retrieval/hang_test.go", "server/internal/retrieval/measure_test.go"],
    },
    {
      path: "server/internal/chunking/chunking.go",
      role: "Cuts a process or standard into parts and writes the text of each: pure, no database, no network.",
      requirements: [
        { text: "Every part's text starts with its parent (\"Process: <title>\"), so a part matches on its own: a step that never names its process can still be found by the process's subject.", at: "b.id, b.head = p.ID, \"Process: \"+clean(p.Title)" },
        { text: "A step's text carries who does it, the lane's description (not for `me`), the tool by name, description, instructions, outcome, duration, sub-process, link label and resource titles. A field readers should find by meaning must be added here and in `src/lib/search.ts`.", at: "label := fmt.Sprintf(\"Step %d: %s\", i+1, clean(s.Title))" },
        { text: "A requirement's text carries its level, where it is narrowed, statement, why, guidance, the helping process, how it is checked, review hints and examples.", at: "label := clean(r.ID) + \": \" + clean(r.Title)" },
        { text: "Too long: lines marked drop 2 go first (examples; link and resources), then drop 1 (review hints; the lane's description and the duration), then the end is cut. A part is never split into two, so one long step cannot crowd the short ones out of the best three hits.", at: "for utf8.RuneCountInString(text) > b.max {" },
        { text: "The cut ends after the last sentence or line in the second half of the limit, else at a word, never inside a word unless one word is longer than the limit.", at: "if i := lastSentenceEnd(prefix); i >= half {" },
        { text: "`PM_CHUNK_MAX_CHARS` defaults to 2000 characters, far below Vertex AI's 2048 tokens.", at: "const DefaultMaxChars = 2000" },
        { text: "The paths a document is for, by name with their other names, in its summary part: \"golden path\" finds the paved path by meaning too. A field worth finding goes here as well as into `src/lib/search.ts`. Test: `chunking/paths_test.go`.", at: "{text: line(\"Meant for the paths\", docs.PathNames(l.Paths, c.Paths))}," },
        { text: "The architecture patterns a document is tagged with, by name with their other names, in its summary part; a document tagged with none gets no line, so its text and vector stay as they were and `Version` stays (`chunking/patterns_test.go`).", at: "{text: line(\"Architecture patterns\", docs.PatternNames(l.Patterns, c.Patterns))}," },
        { text: "Must change with a change of how the texts are written that the fingerprints would not show: it is part of the settings, so the index embeds everything again (and search by meaning answers \"not ready\" until it has). A new line in some parts, such as the paths', needs no change: their texts change, and the start's catch-up embeds only those parts again (`retrieval/paths_test.go`).", at: "const Version = 2" },
      ],
      tests: ["server/internal/chunking/chunking_test.go"],
    },
    {
      path: "server/internal/embedding/embedding.go",
      role: "One interface for the providers (`builtin`, `vertex`, off) and their defaults.",
      requirements: [
        { text: "Every vector is scaled to length 1 here, so the index's cosine distance and a plain dot product agree whatever the provider returns.", at: "out[i] = float32(x / n)" },
        { text: "The squares are summed with a conversion that stops a fused multiply-add: the same text gives the same bits on every processor, which the builtin tests rely on.", at: "sum += float64(x * x)" },
        { text: "`off` or empty gives no embedder: every index method then does nothing and `GET /api/search` answers 404.", at: "if provider == \"\" || provider == \"off\" {" },
        { text: "768 dimensions unless `PM_EMBEDDINGS_DIMENSIONS` says otherwise.", at: "DefaultDimensions = 768" },
      ],
      tests: ["server/internal/embedding/embedding_test.go"],
    },
    {
      path: "server/internal/embedding/builtin.go",
      role: "The provider inside the server: a hashing embedder of words and three-letter pieces of words, for development, tests and CI.",
      requirements: [
        { text: "Words of one or two letters add no pieces: they would otherwise match parts of every longer word.", at: "if len(r) < 5 {" },
        { text: "The sign of a feature comes from the hash's top bit, so features that land in the same position cancel out on average instead of adding up.", at: "if x>>63 == 1 {" },
        { text: "Longer words count more: 0.6 for one letter up to 2.0 from eight, plus 0.5 with a digit (a stand-in for rarer, without a stored word list).", at: "x := 0.4 + float64(0.2*float64(n))" },
        { text: "Accents are removed before hashing (\"café\" = \"cafe\"); a change of the Unicode tables could change vectors.", at: "if unicode.Is(unicode.Mn, r) {" },
      ],
      tests: ["server/internal/embedding/embedding_test.go"],
    },
    {
      path: "server/internal/embedding/vertex.go",
      role: "Google Vertex AI: the `:predict` method of `gemini-embedding-001` (by default), with retries and time limits. Never called by tests or CI.",
      requirements: [
        { text: "`gemini-embedding` models get one text per request (4 at a time); other models up to 250.", at: "if strings.HasPrefix(v.model, \"gemini-embedding\") {" },
        { text: "One `Embed` call takes at most 20 s plus 2 s per further text; retrieval's own limit of 30 s per call (`embedTimeout`) is the shorter one as soon as more than 6 texts are embedded at once.", at: "return ceilingBase + time.Duration(max(n-1, 0))*ceilingPerText" },
        { text: "At most 3 tries, only for timeouts, broken connections, 429 and 5xx; a 400, 401, 403 or 404 ends at once.", at: "if attempt == maxAttempts {" },
        { text: "A vector of another size than `PM_EMBEDDINGS_DIMENSIONS` is refused: it would not fit the column.", at: "if len(p.Embeddings.Values) != v.dims {" },
      ],
      tests: ["server/internal/embedding/embedding_test.go"],
    },
    {
      path: "server/internal/retrieval/content.go",
      role: "The readable text of each part (stored as `snippet`) and the sentence of it shown under a search result.",
      requirements: [
        { text: "A prerequisite's readable text is its description only: one without a description has an empty snippet (the comment beside the field says \"description, else title\"; the code takes the description). A step's is its description, else instructions, else outcome; a requirement's its statement.", at: "c.prerequisites = append(c.prerequisites, p.Description)" },
        { text: "The snippet is the sentence sharing most words (3 letters or more) with the question; on a tie the first one, cut near 200 characters.", at: "if n > top {" },
      ],
      tests: ["server/internal/retrieval/retrieval_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "Where a change starts the index's sync: `syncSkills` calls `syncIndex` after every save, publish, review, delete and change of the lists.",
      requirements: [
        { text: "The work runs on a context the request cannot cancel: a person closing the tab after saving must not leave the index behind.", at: "ctx = context.WithoutCancel(ctx)" },
        { text: "A failed sync is only logged here: the save has already been answered, and `Sync` has marked the document for the retry (`TestASaveWorksWhileTheProviderIsDown`).", at: "if err := a.Index.Sync(ctx, kind, id); err != nil {" },
        { text: "One sync may take at most 10 minutes (a change of the lists goes through every document).", at: "ctx, cancel := context.WithTimeout(ctx, indexTimeout)" },
      ],
      tests: ["server/internal/httpapi/search_test.go"],
    },
    {
      path: "server/cmd/server/main.go",
      role: "When the index is set up and caught up: before serving, in the background after it, and in `-migrate`, `-import` and `-reindex`.",
      requirements: [
        { text: "Before the server listens only `Ensure` runs (or, with search off, `MarkUnused`): the provider is never asked, so a slow or unreachable provider cannot stop a start (`TestTheServerListensWhileTheProviderHangs`).", at: "func prepareIndex(ctx context.Context, st stores, log *slog.Logger) error {" },
        { text: "Catching up and the retries run in a goroutine after the server starts listening; searches answer 503 until the index is complete.", at: "st.index.LogCatchUp(ctx)" },
        { text: "Marked documents are tried again every 5 minutes.", at: "const indexRetry = 5 * time.Minute" },
      ],
      tests: ["server/cmd/server/reindex_test.go", "server/cmd/server/hang_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Reads the settings of search by meaning for the server and the MCP server alike.",
      requirements: [
        { text: "`PM_CHUNK_PARTS` defaults to all parts; `PM_CHUNK_MAX_CHARS` is accepted from 200 to 20000 (default 2000). Both are part of the index's settings: changing either rebuilds the index.", at: "e.Parts = chunking.Default().Parts" },
        { text: "`PM_EMBEDDINGS_DIMENSIONS` is accepted from 64 to 2000, the largest vector pgvector can index with HNSW (the embedding package itself would allow 3072).", at: "if err != nil || n < minDimensions || n > maxDimensions {" },
      ],
    },
  ],
  start: "server/internal/retrieval/retrieval.go",
};
