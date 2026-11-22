import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// The two searches - by words in the browser, by meaning on the server - and how the search
// page puts them together.

export const search: CodeCategory = {
  id: "search",
  area: "data",
  title: "Searching",
  summary:
    "There are two searches. The word search runs in the browser over the processes and standards the person already has: every word must be found, and the field it is found in decides the score. " +
    "The search by meaning runs on the server (GET /api/search): the question becomes a vector and the nearest parts of published documents are returned, grouped by document. " +
    "The search page shows either, or both fused by reciprocal rank; filters, counts and pages always work in the browser, on the same list.",
  requirements: [
    "The word search finds a document only when every word of the query is in it, case and accents ignored; each word scores by the best field it is in (title 100, id 60, tags 60, names of category, practice, platform and owner 40, summary 20, a step, prerequisite, requirement or the scope 5), plus 50 when the title starts with the query (25 when it contains a query of two or more words).",
    "Filters: several values of one filter are any of them, different filters all of them; every option says how many results it would give with the other choices.",
    "GET /api/search answers 404 when search by meaning is off, 400 for a question over 1000 characters or a limit outside 1 to 500, 429 (Retry-After: 60) after 60 searches of one person in a minute, 502 when the provider cannot be reached and 503 while the index is not ready; an empty question gets an empty list.",
    "GET /api/search never returns a draft or a deleted document: the index has no parts of them, and the search joins documents and drops status draft. Drafts the person may see are found by the word search only.",
    "A part less similar than the floor is no match: PM_SEARCH_MIN_SCORE, else 0.20 for builtin and 0.60 for vertex. A document's score is its best part's (1 - cosine distance, three places), with up to 3 parts.",
    "The app keeps of the server's answer only the documents it has and the places they still have (fromMeaning); Both orders by reciprocal rank fusion, 1 / (60 + place) from each list.",
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
          s("ask", "Run the search with Both", "browser", "form", ["words"], "Enter or Search"),
          s("words", "Search the words in the page", "browser", "code", ["kept"], "search(): every word"),
          s("kept", "Answer kept for this content?", "browser", "decision", [["keep", "Yes"], ["call", "No"]]),
          s("call", "Ask GET /api/search, limit 500", "browser", "communication", ["brake"]),
          s("brake", "Within 60 searches a minute?", "server", "decision", [["embed", "Yes"], ["busy", "No"]]),
          s("busy", "Answer 429, Retry-After 60", "server", "communication", []),
          s("embed", "Turn the question into a vector", "provider", "automation", ["near"], "kept 5 min"),
          s("near", "Find the nearest published parts", "pg", "automation", ["group"], "no drafts, above the floor"),
          s("group", "Group by document, best 3 parts", "server", "code", ["keep"], "score of the best part"),
          s("keep", "Keep what the page has", "browser", "code", ["fuse"], "fromMeaning"),
          s("fuse", "Fuse both lists by rank", "browser", "code", ["filter"], "1 / (60 + place)"),
          s("filter", "Filter, count and page the list", "browser", "code", [], "search() with found"),
        ],
      ),
      caption:
        "SearchPage → useMeaningSearch → searchByMeaning (src/lib/store.ts) → httpapi search → retrieval SearchPage. With Words only the first two steps run; with Meaning the word list is left out of the fusion. The question is embedded before any database connection is taken.",
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
          note: "Words are not required: \"project\" alone brings Apigee and the standard above the 0.20 floor.",
        },
        {
          label: "What the page keeps (fromMeaning)",
          where: "src/lib/meaning.ts",
          shape: `{kind: "process", id: "request-gcp-project", score: 0.523, by: ["meaning"],
 hits: [{where: "summary", label: "Summary", snippet: …}, {where: "step", item: "create-project", label: "Create the project", …}, …]}`,
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
        { text: "The weights of the fields; a word in none of them makes the score 0.", at: "const WEIGHT = { title: 100, id: 60, tags: 60, names: 40, summary: 20, inside: 5 } as const;" },
        { text: "Every word must be found; the title starting with the query adds 50, containing it 25.", at: "function scoreOf(d: Doc, words: string[]): number {" },
        { text: "Accents and case do not matter.", at: "export const fold = (s: string) =>" },
        { text: "A draft is searched only when drafts allows it; the pages pass true, since the server sends only drafts the person may see.", at: "(d.status !== \"draft\" || (typeof drafts === \"function\" ? drafts(kind, d) : drafts)) && appliesTo(d, profile);" },
        { text: "With found (meaning, or both) the query is not searched again: exactly those documents, in that order.", at: "export function search(input: SearchInput): SearchOutput {" },
        { text: "A filter value in an address that names nothing that exists is dropped.", at: "export function knownFilters(" },
      ],
      tests: ["src/lib/__tests__/search.test.ts", "src/lib/__tests__/searchScreens.test.ts", "e2e/search.spec.ts"],
    },
    {
      path: "src/lib/meaning.ts",
      role: "The app's side of search by meaning: when the server is asked, how its answer becomes cards, and how Both fuses the two lists.",
      requirements: [
        { text: "Only documents the page has, once each, in the server's order.", at: "export function fromMeaning(" },
        { text: "Both: 1 / (60 + place) from each list, added.", at: "export const FUSION_K = 60;" },
        { text: "With Meaning and Both the address (and the request) changes only when the search is run.", at: "export const typingMovesAddress =" },
        { text: "Answers are kept 2 minutes, at most 30, per query and per content stamp.", at: "const KEEP_MS = 2 * 60 * 1000;" },
        { text: "404 means switched off, 429 busy, 503 not ready; anything else is \"not available\".", at: "export function problemOf(e: unknown): MeaningProblem {" },
      ],
      tests: ["src/lib/__tests__/meaning.test.ts", "e2e/meaning.spec.ts"],
    },
    {
      path: "server/internal/httpapi/search.go",
      role: "GET /api/search, its limits and errors, and what /api/me says about search by meaning.",
      requirements: [
        { text: "60 searches per person per minute, counted in memory per server.", at: "const searchesPerMinute = 60" },
        { text: "Off: 404; a bad limit or a long question: 400; a blank question: an empty list without asking anything.", at: "func (a *api) search(w http.ResponseWriter, r *http.Request) {" },
        { text: "Not ready: 503 with a sentence that offers the word search.", at: "writeError(w, 503, \"Search by meaning is not ready yet. Try again in a moment, or search by words.\")" },
        { text: "/api/me says whether it is on, whether questions leave the company, and the provider kind.", at: "func (a *api) searchInfo() map[string]any {" },
      ],
      tests: ["server/internal/httpapi/search_test.go"],
    },
    {
      path: "server/internal/retrieval/retrieval.go",
      role: "SearchPage: embeds the question, reads the nearest parts in one transaction and groups them by document.",
      requirements: [
        { text: "Not ready is said without asking the provider; the question is embedded before a connection is taken.", at: "func (ix *Index) SearchPage(ctx context.Context, query string, limit int) (Page, error) {" },
        { text: "Whatever the index holds, only what is not a draft now is returned.", at: "where coalesce(d.body->>'status', '') <> 'draft' and n.distance <= $2" },
        { text: "The floor of each provider; PM_SEARCH_MIN_SCORE overrides it.", at: "var floors = map[string]float64{" },
        { text: "Score = 1 - distance, kept between 0 and 1, three places.", at: "func score(distance float64) float64 {" },
        { text: "Question vectors are kept 5 minutes, at most 500.", at: "cache: newQueryCache(500, 5*time.Minute)" },
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
      role: "The call to /api/search (and every other call of the app).",
      requirements: [{ text: "Asks for 500 results; an older server that refuses that is asked for 100.", at: "export async function searchByMeaning(q: string, limit = 500)" }],
    },
    {
      path: "src/components/SearchPage.tsx",
      role: "The search page: the mode switch (Words, Meaning, Both), the plan of what is shown, and the closest by meaning when words find nothing.",
      requirements: [
        { text: "The word search here includes the drafts the person may see; the search by meaning never has them.", at: "const drafts = true;" },
        { text: "Both is the fusion of the word list and the server's list.", at: "return fuse(byWords, byMeaning);" },
      ],
      tests: ["e2e/search.spec.ts", "e2e/meaning.spec.ts"],
    },
    {
      path: "server/internal/mcpserver/search.go",
      role: "The MCP server's word match, written to match the portal's (same weights and bonus), used when search by meaning is off or falls back.",
      requirements: [{ text: "Same weights as src/lib/search.ts; a change there must be made here too.", at: "// ---------- the word match, as the portal's search does it (src/lib/search.ts)" }],
      tests: ["server/internal/mcpserver/search_test.go"],
    },
  ],
  start: "src/lib/search.ts",
};
