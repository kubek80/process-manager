import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// The MCP server: a second program that gives AI agents the published content.

export const mcp: CodeCategory = {
  id: "mcp",
  area: "data",
  title: "The MCP server",
  summary:
    "A second program in the same Go module (server/cmd/mcp) gives AI agents the portal's published processes, standards, lists and skills over the Model Context Protocol (streamable HTTP, POST /mcp). " +
    "It reads the portal's database with the portal's settings, never creates or upgrades a table, only searches the index the portal server built, and writes nothing but feedback (report_problem). " +
    "Until agents sign in through a gateway, a shared secret or \"this machine only\" stands in for sign-in; a draft is, for an agent, something that does not exist.",
  requirements: [
    "It refuses to start on a database whose schema_migrations lacks a migration of its version (db.Current), and never runs a migration, Ensure or CatchUp.",
    "Without PM_MCP_SECRET it refuses to listen on an address other than this machine and answers a call from elsewhere with 403; the person headers are removed, so nothing can be written.",
    "With PM_MCP_SECRET (at least 32 visible ASCII characters, not a placeholder, at least 10 different characters) every call must carry Authorization: Bearer <secret> (scheme in any case); a missing or wrong one gets the same 401, compared in constant time on SHA-256 hashes.",
    "An agent may name the person it acts for (X-PM-Person) only with the secret; the address must be an email of the sign-in domains when they are set (400 otherwise). Only then is report_problem listed and callable.",
    "No answer ever reveals a draft or a working draft: drafts are left out of searches, get_process and get_standard answer \"There is no …\" for them, references to them carry the id only (as for an id that does not exist), the skill of a draft does not exist, and report_problem treats a draft as missing.",
    "The search tools return active documents only; with a query and search by meaning on they use the portal's index (at most 5 seconds, then the word match with a note), braked to 60 a minute per person or calling address.",
    "The review state of every document is worked out as the portal does (reviewOf in src/lib/lifecycle.ts): a document never reviewed counts its first review from when it was first published (docs.Store.Published).",
    "Every tool call is answered within 45 seconds, a panic is caught and answered with a plain error, and neither queries, emails nor the secret are written to the log.",
    "report_problem goes through the same checks and the same hourly limit (30 per person, counted with the portal's feedback, under a lock of the person) as feedback in the portal, and notifies the owning team.",
  ],
  charts: [
    {
      process: flow(
        "code-mcp-search",
        "An agent searches processes",
        "search_processes with a query, from the guard to the answer.",
        [["agent", "Agent"], ["mcp", "MCP server"], ["pg", "Postgres"], ["provider", "Embedding provider"]],
        [
          s("call", "Call search_processes with a query", "agent", "communication", ["guard"], "POST /mcp"),
          s("guard", "Let through by the guard?", "mcp", "decision", [["load", "Yes"], ["refuse", "No"]]),
          s("refuse", "Answer 401 or 403", "mcp", "communication", [], "no tool runs"),
          s("load", "Read the lists and every document", "pg", "automation", ["on"], "drafts left out"),
          s("on", "Search by meaning on?", "mcp", "decision", [["brake", "Yes"], ["words", "No"]]),
          s("brake", "Within 60 searches a minute?", "mcp", "decision", [["index", "Yes"], ["tooMany", "No"]]),
          s("tooMany", "Answer: too many searches", "mcp", "communication", [], "try again in N s"),
          s("index", "Search the portal's index", "provider", "automation", ["inTime"], "question → vector"),
          s("inTime", "Answered within 5 seconds?", "mcp", "decision", [["keep", "Yes"], ["words", "No: words-fallback"]]),
          s("keep", "Keep active ones the filters pass", "mcp", "code", ["answer"], "in the index's order"),
          s("words", "Match by words as the portal does", "mcp", "code", ["answer"]),
          s("answer", "Answer with version, review and link", "mcp", "automation", [], "structured and as text"),
        ],
      ),
      caption:
        "mcpserver guard → search → byMeaning (through the adapter meaning in server/cmd/mcp/main.go, which keeps only active results) or byWords. The index is only read: an index that is not ready, built with other settings or whose provider fails also falls back to words.",
    },
    {
      process: flow(
        "code-mcp-report",
        "An agent reports a problem",
        "report_problem on behalf of a person: the one thing the MCP server writes.",
        [["agent", "Agent"], ["mcp", "MCP server"], ["pg", "Postgres"], ["team", "Owning team"]],
        [
          s("call", "Call report_problem for a person", "agent", "communication", ["person"], "secret + X-PM-Person"),
          s("person", "Person named with the secret?", "mcp", "decision", [["read", "Yes"], ["noTool", "No"]]),
          s("noTool", "Refuse: the tool is not offered", "mcp", "communication", []),
          s("read", "Read the process or standard", "pg", "automation", ["exists"]),
          s("exists", "Published, with that step?", "mcp", "decision", [["limit", "Yes"], ["missing", "No"]]),
          s("missing", "Answer: there is no such process", "mcp", "communication", [], "a draft too"),
          s("limit", "Under 30 this hour for the person?", "pg", "decision", [["store", "Yes"], ["later", "No"]]),
          s("later", "Answer: try again later", "mcp", "communication", []),
          s("store", "Store it as the person's feedback", "pg", "automation", ["notify"], "feedback"),
          s("notify", "Tell the owning team", "team", "communication", [], "as the portal does"),
        ],
      ),
      caption:
        "report.go: docs.CheckText, 3 to 2000 characters, a known kind (broken, outdated, unclear, idea), then feedback.Store.Report, which counts and inserts under a lock of the person, and the portal's notifier.",
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
          shape: `{"total": …, "rankedBy": "meaning", "filters": {},
 "results": [
  {"kind": "process", "id": "request-gcp-project", "title": "Request a GCP project", "version": 1,
   "status": "active", "retired": false, "rigour": "mandatory", "owner": {"id": "cloud-platform-team", "name": "Cloud Platform team", …},
   "review": {"state": "ok", "overdue": false, "dueAt": "2027-05-03", "lastReviewedAt": "2026-11-03", "intervalMonths": 6, "label": "Next review 2027-05-03"},
   "link": "http://localhost:5173/#/p/request-gcp-project", "score": 0.523,
   "matches": [{"part": "summary", "label": "Summary", "snippet": "Get a new Google Cloud project …"}, …]},
  {"kind": "process", "id": "onboard-api-to-apigee", …}]}`,
          note: "With search by meaning off rankedBy is \"words\"; when it does not answer in 5 seconds, \"words-fallback\" with a note.",
        },
      ],
    },
  ],
  files: [
    {
      path: "server/cmd/mcp/main.go",
      role: "The MCP command: its settings, the check of the database, the adapter to the portal's index, and serving.",
      requirements: [
        { text: "Refuses a database the portal server has not prepared; never migrates.", at: "func checkDatabase(ctx context.Context, pool *pgxpool.Pool) error {" },
        { text: "Uses the index only to search; an index that is not ready is logged and words take over.", at: "// the portal server builds the index; this command only reads it (never Ensure or CatchUp)" },
        { text: "The search tools get active documents only.", at: "if r.Status != \"active\" { // the search tools return active documents only (the server checks again)" },
        { text: "The write timeout is longer than the call timeout, so every call gets its answer.", at: "WriteTimeout: mcpserver.DefaultCallTimeout + 15*time.Second" },
      ],
      tests: ["server/cmd/mcp/main_test.go"],
    },
    {
      path: "server/internal/mcpserver/mcpserver.go",
      role: "The server: the guard that stands in for sign-in, the person an agent acts for, the two tool sets and the instructions every agent gets.",
      requirements: [
        { text: "A secret must be long, not a placeholder and of visible ASCII.", at: "func CheckSecret(secret string) string {" },
        { text: "Without a secret only this machine may listen and call.", at: "func CheckListen(addr, secret string) string {" },
        { text: "Without a secret the person headers are removed; with one the bearer secret is compared in constant time on hashes.", at: "func (s *Server) guard(next http.Handler) http.Handler {" },
        { text: "Stateless: whom an agent acts for is read from every request; report_problem only on the acting server.", at: "Stateless:           true," },
      ],
      tests: ["server/internal/mcpserver/server_test.go", "server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "server/internal/mcpserver/tools.go",
      role: "The read tools: search_processes, search_standards, get_process, get_standard, get_my_steps, get_skill, get_catalog.",
      requirements: [
        { text: "Every call has a deadline, a panic is caught, and only a problem's own sentence reaches the agent.", at: "func tool[In, Out any](s *Server, srv *mcp.Server, t *mcp.Tool, fn func(ctx context.Context, req *mcp.CallToolRequest, in In) (Out, string, error)) {" },
        { text: "A draft is not found, as nothing is.", at: "func (s *Server) find(ctx context.Context, kind, id string) (*library, *entry, error) {" },
        { text: "A skill of a draft, or of something deleted, does not exist for an agent.", at: "// a skill of a draft, or of something deleted, does not exist for an agent" },
        { text: "Emails of owners and members only for callers with the secret.", at: "show := s.o.Secret != \"\" && s.o.Roles != nil" },
      ],
      tests: ["server/internal/mcpserver/server_test.go"],
    },
    {
      path: "server/internal/mcpserver/content.go",
      role: "What agents get: every published document read once per call, lists resolved to names, the review state, references without drafts.",
      requirements: [
        { text: "Drafts are read only to tell them apart from nothing; never shown.", at: "func (l *library) published(kind, id string) *entry {" },
        { text: "A reference gives a title and link only for a published document.", at: "func (s *Server) docRef(l *library, kind, id string) *DocRef {" },
        { text: "The review state as the portal works it out, the first review counted from the first publication.", at: "func reviewOf(e *entry, now time.Time) Review {" },
        { text: "An agent may do only steps of me that are not approvals.", at: "AgentMayDo: st.Actor == \"me\" && st.Type != \"approval\"," },
      ],
      tests: ["server/internal/mcpserver/server_test.go", "server/internal/mcpserver/search_test.go"],
    },
    {
      path: "server/internal/mcpserver/search.go",
      role: "The two search tools: filters by id or name, search by meaning through the index with a fallback to words, and the word match.",
      requirements: [
        { text: "Only active documents pass; with a profile, a standard none of whose requirements applies is left out.", at: "func (f filters) passes(e *entry) (bool, []rawRequirement) {" },
        { text: "Search by meaning gets MeaningTimeout (5 s); then the word match answers, with a note why.", at: "func (s *Server) byMeaning(ctx context.Context, query string, pool []candidate) (found []candidate, truncated bool, err error) {" },
        { text: "The index is asked for 500 documents, so the filters leave something over.", at: "const searchDepth = 500" },
      ],
      tests: ["server/internal/mcpserver/search_test.go", "server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "server/internal/mcpserver/report.go",
      role: "report_problem: feedback filed by an agent on behalf of the person it acts for.",
      requirements: [
        { text: "A draft, a deleted document and an unknown step or requirement are refused as missing.", at: "case !found || t.Status == \"draft\":" },
        { text: "The limit per person is shared with the portal.", at: "it, err := s.o.Feedback.Report(ctx, feedback.New{" },
      ],
      tests: ["server/internal/mcpserver/server_test.go", "server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "server/internal/mcpserver/brake.go",
      role: "Counts calls per caller in fixed one-minute windows, for searches that use the embedding provider.",
      requirements: [{ text: "Refuses beyond max in the period and says how long to wait.", at: "func (b *brake) allow(key string, now time.Time) (bool, time.Duration) {" }],
      tests: ["server/internal/mcpserver/robust_test.go"],
    },
    {
      path: "scripts/mcp.mjs",
      role: "npm run mcp: builds server/cmd/mcp and runs it against the development database with search by meaning builtin.",
      requirements: [{ text: "Listens on 127.0.0.1:8081 unless PM_MCP_ADDR says otherwise.", at: "PM_MCP_ADDR: process.env.PM_MCP_ADDR ?? \"127.0.0.1:8081\"," }],
    },
    {
      path: "server/internal/db/db.go",
      role: "Current: the read-only check the MCP command makes before it starts.",
      requirements: [{ text: "Compares the newest migration recorded with the newest this program has; changes nothing.", at: "func Current(ctx context.Context, pool *pgxpool.Pool) error {" }],
      tests: ["server/internal/db/db_test.go"],
    },
    {
      path: "server/internal/feedback/store.go",
      role: "The store of feedback, which report_problem writes to (as the portal does).",
      requirements: [{ text: "At most 30 items per person and hour, counted and inserted under a lock of the person.", at: "func (s *Store) Report(ctx context.Context, n New) (Item, error) { return s.create(ctx, n, MaxPerHour) }" }],
    },
  ],
  start: "server/cmd/mcp/main.go",
};
