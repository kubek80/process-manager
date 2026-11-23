import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// The MCP server: a second program that gives AI agents the published content.

export const mcp: CodeCategory = {
  id: "mcp",
  area: "data",
  title: "The MCP server",
  summary:
    "A second program, `server/cmd/mcp`, gives AI agents the portal's published processes, standards, lists and skills over MCP. " +
    "It speaks the Model Context Protocol (streamable HTTP, `POST /mcp`), reads the portal's database with the portal's settings, never creates or upgrades a table, only searches the index the portal server built, and writes nothing but feedback (`report_problem`). " +
    "Until agents sign in through a gateway, a shared secret or \"this machine only\" stands in for sign-in; a draft is, for an agent, something that does not exist.",
  requirements: [
    "It refuses to start on a database whose newest recorded migration is older than the newest it was built with (`db.Current`), and never runs a migration, `Ensure` or `CatchUp`.",
    "Without `PM_MCP_SECRET` it refuses to listen on an address other than this machine and answers a call from elsewhere with 403; the person headers are removed, so nothing can be written.",
    "With `PM_MCP_SECRET` (at least 32 visible ASCII characters, not a placeholder, at least 10 different characters) every call must carry `Authorization: Bearer <secret>` (scheme in any case); a missing or wrong one gets the same 401, compared in constant time on SHA-256 hashes.",
    "An agent may name the person it acts for (`X-PM-Person`) only with the secret; the address must be an email of the sign-in domains when they are set (400 otherwise). Only then is `report_problem` listed and callable.",
    "No answer ever reveals a draft or a working draft: drafts are left out of searches, `get_process` and `get_standard` answer \"There is no …\" for them, references to them carry the id only (as for an id that does not exist), the skill of a draft does not exist, and `report_problem` treats a draft as missing.",
    "The search tools return active documents only; with a query and search by meaning on they use the portal's index (at most 5 seconds, then the word match with a note), braked to 60 a minute per person or calling address.",
    "The review state of every document is worked out as the portal does (`reviewOf` in `src/lib/lifecycle.ts`): a document never reviewed counts its first review from when it was first published (`docs.Store.Published`).",
    "Every tool call is answered within 45 seconds, a panic is caught and answered with a plain error, and neither queries, emails nor the secret are written to the log.",
    "`report_problem` goes through the same checks and the same hourly limit (30 per person, counted with the portal's feedback, under a lock of the person) as feedback in the portal, and notifies the owning team.",
  ],
  charts: [
    {
      process: flow(
        "code-mcp-search",
        "An agent searches processes",
        "search_processes with a query, from the guard to the answer.",
        [["agent", "Agent"], ["mcp", "MCP server"], ["pg", "Postgres"]],
        [
          s("call", "Call search_processes with a query", "agent", "communication", ["guard"], "POST /mcp"),
          s("guard", "Let through by the guard?", "mcp", "verify", [["load", "Yes"], ["refuse", "No"]], "secret or this machine"),
          s("refuse", "Answer 401 or 403", "mcp", "communication", [], "no tool runs"),
          s("load", "Read the lists and every document", "pg", "automation", ["on"], "drafts left out"),
          s("on", "Search by meaning on?", "mcp", "decision", [["inTime", "Yes"], ["words", "No"]]),
          s("inTime", "Did the index answer within 5 s?", "mcp", "decision", [["answer", "Yes"], ["words", "No: words-fallback"]]),
          s("words", "Match by words as the portal does", "mcp", "automation", ["answer"]),
          s("answer", "Answer with version, review and link", "mcp", "communication", [], "active ones the filters pass"),
        ],
      ),
      caption:
        "`guard` → `search` → `byMeaning` (through the adapter `meaning` in `server/cmd/mcp/main.go`, which keeps only active results) or `byWords`. Before the index is asked, the brake allows 60 such searches a minute per caller (\"Too many searches…\" beyond). The index is only read: one that is not ready, built with other settings or whose provider fails also falls back to words.",
    },
    {
      process: flow(
        "code-mcp-report",
        "An agent reports a problem",
        "report_problem on behalf of a person: the one thing the MCP server writes.",
        [["agent", "Agent"], ["mcp", "MCP server"], ["pg", "Postgres"], ["team", "Owning team"]],
        [
          s("call", "Call report_problem for a person", "agent", "communication", ["person"], "secret + X-PM-Person"),
          s("person", "Person named with the secret?", "mcp", "verify", [["exists", "Yes"], ["refuse", "No: not offered"]]),
          s("exists", "Published, with that step?", "mcp", "verify", [["limit", "Yes"], ["refuse", "No"]], "a draft counts as missing"),
          s("limit", "Under 30 this hour for the person?", "pg", "verify", [["store", "Yes"], ["refuse", "No"]], "under a lock of the person"),
          s("refuse", "Refuse with a plain sentence", "mcp", "communication", []),
          s("store", "Store it as the person's feedback", "pg", "document", ["notify"], "feedback"),
          s("notify", "Tell the owning team", "team", "communication", [], "as the portal does"),
        ],
      ),
      caption:
        "`report.go`: `docs.CheckText`, 3 to 2000 characters, a known kind (broken, outdated, unclear, idea), then `feedback.Store.Report`, which counts and inserts under a lock of the person, and the portal's notifier.",
    },
  ],
  examples: [
    {
      title: "search_processes, by meaning",
      caption: "What an agent sends and gets back for the sample content (abridged).",
      stages: [
        {
          label: "The call",
          where: "server/internal/mcpserver/tools.go",
          shape: `POST /mcp   Authorization: Bearer <secret>
{"method": "tools/call", "params": {"name": "search_processes",
  "arguments": {"query": "new google cloud project", "limit": 3}}}`,
        },
        {
          label: "The portal's index, through the adapter",
          where: "server/cmd/mcp/main.go",
          shape: `retrieval.Index.SearchPage(ctx, "new google cloud project", 500)
→ request-gcp-project 0.523, onboard-api-to-apigee 0.316, infrastructure-as-code 0.291, …
→ only status active, as mcpserver.Found (kind, id, score, hits)`,
          note: "The search tool for processes keeps only processes that pass the filters: the standard is dropped there.",
        },
        {
          label: "The structured answer",
          where: "server/internal/mcpserver/search.go",
          shape: `{"total": 3,
 "results": [
  {"kind": "process", "id": "request-gcp-project", "title": "Request a GCP project", "summary": "Get a new Google Cloud project …",
   "version": 1, "status": "active", "retired": false, "owner": {"id": "cloud-platform-team", "name": "Cloud Platform team", …},
   "category": {…}, "platform": {…}, "appliesTo": {"tiers": [], "environments": [], "languages": []},
   "review": {"state": "ok", "overdue": false, "dueAt": "2027-05-03", "lastReviewedAt": "2026-11-03", "intervalMonths": 6, "label": "Next review 2027-05-03"},
   "updatedAt": "2026-11-13", "link": "http://localhost:5173/#/p/request-gcp-project", "rigour": "mandatory", "score": 0.523,
   "matches": [{"part": "summary", "label": "Summary", "snippet": "Get a new Google Cloud project …"},
               {"part": "step", "item": "create-project", "label": "Step 9: Create the project", "snippet": "The pipeline runs on merge …"}, …]},
  {"kind": "process", "id": "onboard-api-to-apigee", …, "score": 0.316}],
 "rankedBy": "meaning", "filters": {}}`,
          note: "With search by meaning off `rankedBy` is `words`; when it does not answer in 5 seconds, `words-fallback` with a `note`.",
        },
      ],
    },
  ],
  files: [
    {
      path: "server/cmd/mcp/main.go",
      role: "The MCP command: its settings, the check of the database, the adapter to the portal's index, and serving.",
      requirements: [
        { text: "A database the portal server has not prepared (no tables, or an older version) stops the start with a plain message: the MCP server would otherwise read tables that are not there yet (`TestRefusesADatabaseThePortalHasNotPrepared`).", at: "if err := db.Current(ctx, pool); err != nil {" },
        { text: "The index is only checked with `Ready`, never set up: an index that is not ready is logged and words take over. `Ensure` or `CatchUp` here could rebuild the portal's index with this program's settings.", at: "if err := index.Ready(ctx); err != nil {" },
        { text: "Results that are not active (retired) are dropped before the tools see them; the search tools check again.", at: "if r.Status != \"active\" { // the search tools return active documents only (the server checks again)" },
        { text: "The write timeout is 15 seconds longer than the call timeout, so every call gets its answer instead of a cut connection.", at: "WriteTimeout: mcpserver.DefaultCallTimeout + 15*time.Second" },
      ],
      tests: ["server/cmd/mcp/main_test.go"],
    },
    {
      path: "server/internal/mcpserver/mcpserver.go",
      role: "The server: the guard that stands in for sign-in, the person an agent acts for, the two tool sets and the instructions every agent gets.",
      requirements: [
        { text: "A secret shorter than 32 characters is refused at start: the secret is the only thing between the network and every published document.", at: "if len(secret) < MinSecret {" },
        { text: "A secret with fewer than 10 different characters (or an example value) is refused as too simple.", at: "return len(distinct) < 10" },
        { text: "Without a secret the server refuses to start on an address other than this machine.", at: "if secret == \"\" && !Loopback(addr) {" },
        { text: "Without a secret a call that does not come from this machine gets 403, also behind a proxy on another machine.", at: "if !Loopback(r.RemoteAddr) {" },
        { text: "Without a secret the person headers are removed: nobody can file feedback in another person's name.", at: "r.Header.Del(HeaderPerson)" },
        { text: "The bearer secret is compared on SHA-256 hashes in constant time, with the same 401 for a wrong secret and a wrong scheme: the answer time and text reveal nothing (`TestWrongSecretAnswersAreTheSameForEveryScheme`).", at: "if subtle.ConstantTimeCompare(got[:], want[:]) != 1 || !ok {" },
        { text: "Only people of the sign-in domains can be acted for, when the domains are set.", at: "if len(s.o.EmailDomains) > 0 {" },
        { text: "A request gets the tool set with `report_problem` only when a valid person came with the secret; read from every request, nothing kept between calls.", at: "if s.person(r.Header).Email != \"\" {" },
        { text: "A request body is at most 1 MB.", at: "MaxRequestBodyBytes: 1 << 20," },
      ],
      tests: ["server/internal/mcpserver/server_test.go", "server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "server/internal/mcpserver/tools.go",
      role: "The read tools: `search_processes`, `search_standards`, `get_process`, `get_standard`, `get_my_steps`, `get_skill`, `get_catalog`.",
      requirements: [
        { text: "Every call has a deadline (45 s by default) shorter than the HTTP write timeout, and is answered when it passes even if the work goes on (`TestEveryCallIsAnsweredWithinItsDeadline`).", at: "ctx, cancel := context.WithTimeout(ctx, s.o.CallTimeout)" },
        { text: "A panic is caught and answered with \"Something went wrong\"; the log names the tool, never its arguments (`TestAToolThatPanicsDoesNotTakeTheServerDown`).", at: "if v := recover(); v != nil {" },
        { text: "`get_process`, `get_standard` and `get_my_steps` find only published documents: a draft gets the same \"There is no …\" as an id that does not exist.", at: "e := l.published(kind, id)" },
        { text: "The skill of a draft, or of something deleted, does not exist for an agent, even though `skills` still has its row.", at: "if l.published(sk.SourceKind, sk.SourceID) == nil {" },
        { text: "Emails of owners and members go only to callers with the secret.", at: "show := s.o.Secret != \"\" && s.o.Roles != nil" },
      ],
      tests: ["server/internal/mcpserver/server_test.go"],
    },
    {
      path: "server/internal/mcpserver/content.go",
      role: "What agents get: every published document read once per call, lists resolved to names, the review state, references without drafts.",
      requirements: [
        { text: "Drafts are read only to tell them apart from nothing and are never returned; working drafts are never read at all (only `documents` through `docs.Store`).", at: "if e == nil || e.draft() {" },
        { text: "A reference gives a title and link only for a published document: a reference to a draft looks exactly like one to an id that does not exist.", at: "if e := l.published(kind, id); e != nil {" },
        { text: "A document never reviewed counts its first review from its first publication, as `reviewOf` in `src/lib/lifecycle.ts` does; only without that date is it overdue at once. A change of the rule must be made in both.", at: "if first && e.published.IsZero() {" },
        { text: "An agent has no reader's day: today and the first publication are UTC days, while the portal counts in the reader's day, so near midnight a review can show as due a day earlier or later for an agent than for a reader far from UTC.", at: "today, _ := time.Parse(time.DateOnly, now.UTC().Format(time.DateOnly))" },
        { text: "An agent may do only steps of `me` that are not approvals.", at: "AgentMayDo: st.Actor == \"me\" && st.Type != \"approval\"," },
      ],
      tests: ["server/internal/mcpserver/server_test.go", "server/internal/mcpserver/search_test.go"],
    },
    {
      path: "server/internal/mcpserver/search.go",
      role: "The two search tools: filters by id or name, search by meaning through the index with a fallback to words, and the word match.",
      requirements: [
        { text: "Only active documents pass the search tools (retired ones are left out, drafts never get here).", at: "if !e.active() {" },
        { text: "Searches that use the provider are braked per caller (the person, else the address) before the index is asked: a busy agent cannot run up the bill of an outside service.", at: "if ok, wait := s.brake.allow(caller, time.Now()); !ok {" },
        { text: "Search by meaning gets `MeaningTimeout` (5 s); then the word match answers with a note, even if the index never returns (`TestAProviderThatHangsGivesWayToWords`).", at: "wait, cancel := context.WithTimeout(ctx, s.o.MeaningTimeout)" },
        { text: "The index is asked for 500 documents, so the filters leave something over.", at: "const searchDepth = 500" },
      ],
      tests: ["server/internal/mcpserver/search_test.go", "server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "server/internal/mcpserver/report.go",
      role: "`report_problem`: feedback filed by an agent on behalf of the person it acts for.",
      requirements: [
        { text: "A call without a person is refused even though the tool is not listed then: a client that calls it anyway writes nothing.", at: "if who.Email == \"\" { // the tool is not listed then; a call all the same is refused" },
        { text: "A draft, a deleted document and an unknown step or requirement are refused as missing.", at: "case !found || t.Status == \"draft\":" },
        { text: "The limit per person is shared with the portal (`feedback.Store.Report`).", at: "it, err := s.o.Feedback.Report(ctx, feedback.New{" },
      ],
      tests: ["server/internal/mcpserver/server_test.go", "server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "server/internal/mcpserver/brake.go",
      role: "Counts calls per caller in fixed one-minute windows, for searches that use the embedding provider.",
      requirements: [{ text: "Beyond the maximum in a window the call is refused with how long to wait; windows that are over are forgotten once more than 10,000 callers are kept.", at: "if w.n >= b.max {" }],
      tests: ["server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "scripts/mcp.mjs",
      role: "`npm run mcp`: builds `server/cmd/mcp` and runs it against the development database with search by meaning `builtin`.",
      requirements: [{ text: "Listens on 127.0.0.1:8081 unless `PM_MCP_ADDR` says otherwise: without a secret it must stay on this machine.", at: "PM_MCP_ADDR: process.env.PM_MCP_ADDR ?? \"127.0.0.1:8081\"," }],
    },
    {
      path: "server/internal/db/db.go",
      role: "`Current`: the read-only check the MCP command makes before it starts.",
      requirements: [{ text: "Compares only the newest migration recorded with the newest this program has, and changes nothing.", at: "if have < Latest() {" }],
      tests: ["server/internal/db/db_test.go"],
    },
    {
      path: "server/internal/feedback/store.go",
      role: "The store of feedback, which `report_problem` writes to (as the portal does).",
      requirements: [{ text: "The count of the last hour and the insert run under a lock of the person (space 7465): reports sent at the same moment from the portal and from agents cannot slip past the 30 (`TestParallelReportsKeepTheLimit`).", at: "hashtextextended($1, 7465)" }],
    },
  ],
  start: "server/cmd/mcp/main.go",
};
