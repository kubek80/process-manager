import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// The two searches - by words in the browser, by meaning on the server - and how the search
// page puts them together.

export const search: CodeCategory = {
  id: "search",
  area: "data",
  title: "Searching",
  summary:
    "People search by words in the browser and by meaning on the server; the search page shows either, or both fused into one list. " +
    "The word search runs over the processes and standards the person already has: every word must be found, and the field it is found in decides the score. " +
    "The search by meaning (`GET /api/search`) turns the question into a vector and returns the nearest parts of published documents, grouped by document. Filters, counts and pages always work in the browser, on the same list.",
  requirements: [
    "The word search finds a document only when every word of the query is in it, case and accents ignored; each word scores by the best field it is in (title 100, id 60, tags 60, names of category, practice, platform and owner 40, summary 20, a step, prerequisite, requirement or the scope 5), plus 50 when the title starts with the query (25 when it contains a query of two or more words).",
    "Filters: several values of one filter are any of them, different filters all of them; every option says how many results it would give with the other choices.",
    "`GET /api/search` answers 404 when search by meaning is off, 400 for a question over 1000 characters or a limit outside 1 to 500, 429 (`Retry-After: 60`) after 60 searches of one person in a minute, 502 when the provider cannot be reached and 503 while the index is not ready; an empty question gets an empty list.",
    "`GET /api/search` never returns a draft or a deleted document: the index has no parts of them, and the search joins `documents` and drops status `draft`. Drafts the person may see are found by the word search only.",
    "A part less similar than the floor is no match: `PM_SEARCH_MIN_SCORE`, else 0.20 for `builtin` and 0.60 for `vertex`. A document's score is its best part's (1 - cosine distance, three places), with up to 3 parts.",
    "The app keeps of the server's answer only the documents it has and the places they still have (`fromMeaning`); Both orders by reciprocal rank fusion, 1 / (60 + place) from each list.",
    "With Meaning and Both the server is asked only when the search is run (Enter, the button, a change of mode), never while typing; the app keeps answers 2 minutes per query and content, the server keeps question vectors 5 minutes (at most 500).",
    "The query, the filters, the page and a mode other than Words live in the address; only the person's last mode is also remembered in the browser.",
  ],
  charts: [
    {
      process: flow(
        "code-search-both",
        "One question, searched both ways",
        "The search page with Both: words in the browser, meaning on the server, one list.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"], ["provider", "Embedding provider"]],
        [
          s("ask", "Run the search with Both", "browser", "task", ["words"], "Enter or Search"),
          s("words", "Search the words in the page", "browser", "automation", ["call"], "search(): every word"),
          s("call", "Ask GET /api/search", "browser", "communication", ["brake"], "limit 500; a kept answer is reused"),
          s("brake", "Within 60 searches a minute?", "server", "decision", [["embed", "Yes"], ["busy", "No"]]),
          s("busy", "Answer 429, Retry-After 60", "server", "communication", []),
          s("embed", "Turn the question into a vector", "provider", "communication", ["near"], "kept 5 min"),
          s("near", "Find the nearest published parts", "pg", "automation", ["fuse"], "no drafts, above the floor"),
          s("fuse", "Fuse both lists, then filter and count", "browser", "automation", [], "1 / (60 + place)"),
        ],
      ),
      caption:
        "`SearchPage` → `useMeaningSearch` → `searchByMeaning` (`src/lib/store.ts`) → `search` in `httpapi/search.go` → `retrieval.Index.SearchPage`, which groups the parts by document (best 3, the score of the best). The page keeps only the documents it has (`fromMeaning`), fuses, and runs `search()` with `found` for filters, counts and pages. With Words only the first two steps run; with Meaning the word list is left out of the fusion. The question is embedded before any database connection is taken.",
    },
  ],
  examples: [
    {
      title: "\"new google cloud project\" through both searches",
      caption: "Real results on the sample content (builtin provider). The word search and the search by meaning find different things; Both puts them together.",
      stages: [
        {
          label: "By words, in the browser",
          where: "src/lib/search.ts",
          shape: `request-gcp-project   score 220
  project → title "Request a GCP project"      100
  cloud   → tags  "gcp cloud terraform"         60
  google  → names "… Google Cloud …" (platform)  40
  new     → summary "Get a new Google Cloud …"   20
  hits: Raise the 'New GCP project' request · Google group for your team · Decide the project details
(nothing else has all four words)`,
          note: "No bonus: the title neither starts with nor contains the whole query.",
        },
        {
          label: "By meaning, on the server (first three)",
          where: "server/internal/retrieval/retrieval.go",
          shape: `GET /api/search?q=new%20google%20cloud%20project&limit=500
request-gcp-project      0.523  Summary · Step 9: Create the project · Step 7: Add your project to the project factory
onboard-api-to-apigee    0.316  Before you start: GCP project for the backend
infrastructure-as-code   0.291  Summary   (a standard)
…`,
          note: "Not every word is needed: Apigee's prerequisite shares only the word \"project\", the standard's summary \"google\" and \"cloud\"; both score above the 0.20 floor.",
        },
        {
          label: "What the page keeps (fromMeaning)",
          where: "src/lib/meaning.ts",
          shape: `{kind: "process", id: "request-gcp-project", score: 0.523, by: ["meaning"],
 hits: [{where: "summary", label: "Summary"},
        {where: "step", item: "create-project", label: "Create the project", snippet: "The pipeline runs on merge and creates the project, …"},
        {where: "step", item: "add-project-config", label: "Add your project to the project factory", snippet: "Copy projects/_template.yaml to …"}]}`,
          note: "Labels come from the document the page has, not from the server; a step the page's copy no longer has is left out; the summary's snippet is dropped when it repeats the summary on the card.",
        },
        {
          label: "Both: reciprocal rank fusion",
          where: "src/lib/meaning.ts",
          shape: `request-gcp-project     1/61 (words) + 1/61 (meaning) = 0.0328   by: words, meaning
onboard-api-to-apigee   1/62 (meaning)                  = 0.0161   by: meaning
infrastructure-as-code  1/63 (meaning)                  = 0.0159   by: meaning`,
          note: "Then search() runs with found = this list: the filters, counts, \"My application\" and paging work on it exactly as on a word search.",
        },
      ],
    },
  ],
  files: [
    {
      path: "src/lib/search.ts",
      role: "The word search, the filters with their counts, \"My application\", and showing where a word was found. Used by the lists, the search page, Home and group pages.",
      requirements: [
        { text: "The weights of the fields. `server/internal/mcpserver/search.go` has a copy of them for agents; nothing checks that the two stay equal, so a change here must be made there too.", at: "const WEIGHT = { title: 100, id: 60, tags: 60, names: 40, summary: 20, inside: 5 } as const;" },
        { text: "One word found nowhere makes the whole score 0: the word search never shows a document that lacks a word of the query.", at: "if (!best) return 0;" },
        { text: "The whole query at the start of the title adds 50 (inside it, for two words or more, 25), so the obvious document comes first.", at: "if (words.length && title.startsWith(phrase)) total += 50;" },
        { text: "Within one filter any chosen value passes, across filters all must; `skip` leaves one filter out so that its own options can be counted.", at: "return k === skip || !chosen?.length || d.values[k].some((v) => (chosen as string[]).includes(v));" },
        { text: "A draft is searched only when `drafts` allows it. The pages pass true: which drafts the page has at all is decided by the server (`canSee` in `server/internal/httpapi/content.go`); here it is only applied.", at: "(d.status !== \"draft\" || (typeof drafts === \"function\" ? drafts(kind, d) : drafts)) && appliesTo(d, profile);" },
        { text: "With `found` (meaning, or both) the query is not searched again: exactly those documents, in that order, so the filters and counts work on the server's ranking.", at: "const given = input.found ? new Map(" },
        { text: "A filter value in an address that names nothing that exists is dropped.", at: "export function knownFilters(" },
      ],
      tests: ["src/lib/__tests__/search.test.ts", "src/lib/__tests__/searchScreens.test.ts", "e2e/search.spec.ts"],
    },
    {
      path: "src/lib/meaning.ts",
      role: "The app's side of search by meaning: when the server is asked, how its answer becomes cards, and how Both fuses the two lists.",
      requirements: [
        { text: "A result the page does not have is left out (a draft it may not see, something deleted since), and each document only once.", at: "if (!doc || seen.has(key)) continue;" },
        { text: "Both: each list gives a document 1 / (60 + its place), added; being high in either list counts, being in both counts more.", at: "const part = 1 / (k + i + 1);" },
        { text: "The server is asked only with Meaning or Both and a non-empty question: each search may call a paid outside service.", at: "export const needsServer =" },
        { text: "Answers are kept 2 minutes, at most 30, per query and per content stamp: after a save the next search asks again.", at: "const KEEP_MS = 2 * 60 * 1000;" },
        { text: "404 means switched off (the page falls back to words), 429 busy, 503 not ready; anything else is \"not available\".", at: "if (status === 404) return { kind: \"off\", message };" },
      ],
      tests: ["src/lib/__tests__/meaning.test.ts", "e2e/meaning.spec.ts"],
    },
    {
      path: "server/internal/httpapi/search.go",
      role: "`GET /api/search`, its limits and errors, and what `/api/me` says about search by meaning.",
      requirements: [
        { text: "60 searches per person per minute, counted in memory per server, before the provider is asked: one person cannot run up the bill of an outside service.", at: "if !a.searches.allow(who(r).Email, time.Now()) {" },
        { text: "A limit outside 1 to 500 is refused with 400.", at: "if err != nil || n < 1 || n > retrieval.MaxLimit {" },
        { text: "A blank question answers an empty list without asking the provider or counting against the brake.", at: "if !blank(q) {" },
        { text: "Not ready: 503 with a sentence that offers the word search.", at: "writeError(w, 503, \"Search by meaning is not ready yet. Try again in a moment, or search by words.\")" },
        { text: "`/api/me` says whether it is on, whether questions leave the company, and the provider kind: the page tells people when their question goes to Google.", at: "func (a *api) searchInfo() map[string]any {" },
      ],
      tests: ["server/internal/httpapi/search_test.go"],
    },
    {
      path: "server/internal/retrieval/retrieval.go",
      role: "`SearchPage`: embeds the question, reads the nearest parts in one transaction and groups them by document.",
      requirements: [
        { text: "An index that is not ready is said before the provider is asked: no paid call for a search that cannot be answered.", at: "if err := ix.ready(ctx, ix.pool); err != nil {" },
        { text: "The question is embedded before the transaction starts: a slow provider never holds a database connection.", at: "vec, err := ix.queryVector(ctx, query)" },
        { text: "Whatever the index holds, only what is not a draft now is returned: a document that just became a draft is not found even before its parts are removed (`TestSearchGroupsByDocumentAndNeverReturnsADraft`).", at: "where coalesce(d.body->>'status', '') <> 'draft' and n.distance <= $2" },
        { text: "Up to 50,000 parts every part is compared (exact, nothing missed); above that the HNSW index is used and the answer may be marked truncated.", at: "approximate := estimate > exactParts" },
        { text: "`PM_SEARCH_MIN_SCORE` overrides the floor of the provider (0.20 builtin, 0.60 vertex, 0.5 otherwise).", at: "if m >= 0 {" },
        { text: "Score = 1 - distance, kept between 0 and 1, three places.", at: "func score(distance float64) float64 {" },
        { text: "Question vectors are kept 5 minutes, at most 500: the same question does not call the provider again.", at: "cache: newQueryCache(500, 5*time.Minute)" },
      ],
      tests: ["server/internal/retrieval/retrieval_test.go", "server/internal/retrieval/hang_test.go"],
    },
    {
      path: "server/internal/retrieval/content.go",
      role: "The snippet under a result: the sentence of the part's readable text that shares most words with the question.",
      requirements: [{ text: "Cut at a word near 200 characters; empty when the part has no readable text (a step with only a title).", at: "const SnippetLength = 200" }],
      tests: ["server/internal/retrieval/retrieval_test.go"],
    },
    {
      path: "src/lib/store.ts",
      role: "The call to `/api/search` (and every other call of the app).",
      requirements: [{ text: "Asks for 500 results; only a 400 from an older server makes it ask again for 100, any other error goes to the page.", at: "if (!(e instanceof ApiError && e.status === 400 && limit > 100)) throw e;" }],
    },
    {
      path: "src/components/SearchPage.tsx",
      role: "The search page: the mode switch (Words, Meaning, Both), the plan of what is shown, and the closest by meaning when words find nothing.",
      requirements: [
        { text: "The word search here includes the drafts the person may see (the server sent only those); the search by meaning never has them.", at: "const drafts = true;" },
        { text: "Both is the fusion of the word list and the server's list.", at: "return fuse(byWords, byMeaning);" },
      ],
      tests: ["e2e/search.spec.ts", "e2e/meaning.spec.ts"],
    },
    {
      path: "server/internal/mcpserver/search.go",
      role: "The MCP server's word match, written to match the portal's (same weights and bonus), used when search by meaning is off or falls back.",
      requirements: [{ text: "A copy of the weights of `src/lib/search.ts`, not shared code: a change there must be made here too, or agents and people rank differently.", at: "weightTitle   = 100" }],
      tests: ["server/internal/mcpserver/search_test.go"],
    },
  ],
  start: "src/lib/search.ts",
};
