import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const api: CodeCategory = {
  id: "api",
  area: "server",
  title: "The server and its API",
  summary:
    "One Go program (`server/cmd/server`) reads its settings from the environment, upgrades the database, fills an empty one, and then serves the JSON API under `/api/`, the sign-in under `/auth/`, the health checks and, when `PM_STATIC_DIR` is set, the built app. " +
    "Every route is declared in one place, `httpapi.New` in `api.go`; the handlers live in one file per subject. Errors are mapped to a status and one plain sentence in `fail`.",
  requirements: [
    "Every route is declared in `httpapi.New` (api.go); an unknown `/api/…` path answers 404 `{\"error\": \"no such API endpoint\"}`.",
    "Every JSON answer is written by `writeJSON` with `Cache-Control: no-store`; every error is `{\"error\": \"<one plain sentence>\"}`.",
    "An error the handler does not expect is logged with method and path and answered 500 \"Something went wrong on the server.\"; its cause is never sent to the browser.",
    "`/healthz` answers 200 while the process runs; `/readyz` answers 503 when the database does not answer within 2 seconds.",
    "Every request under `/api/` and `/auth/` is logged with method, path, status and time, and gets 30 seconds; a body of a change is limited to 1 MB (413).",
    "The server refuses to start with settings that do not fit, and says every problem at once (`config.Load`).",
    "Before it serves, the server upgrades the tables and converts older content under the migrations' lock, and fills an empty database from `PM_SEED_DIR` under its own lock, so several instances can start together.",
    "On stop it stops taking requests, gives those in progress 15 seconds, and waits for background work (skills, index, notifications) before the database is closed.",
    "A path of the built app that is not a file answers `index.html` (the app routes on the hash), except under `/assets/` or with a file ending, which answer 404; while the app's files are missing the answer is a plain 503 page.",
    "Search by meaning is prepared quickly before serving; catching up the index runs in the background, so a slow provider never delays the start.",
  ],
  charts: [
    {
      caption: "What `run` in `server/cmd/server/main.go` does from start to serving, and on stop.",
      process: flow("code-api-start", "Starting the server", "From the settings to the first request, and the way out.",
        [["server", "Server"], ["pg", "Postgres"], ["provider", "Embedding provider"], ["idp", "Identity provider"]],
        [
          s("config", "Read and check the settings", "server", "verify", ["connect"], "config.Load"),
          s("connect", "Wait for the database", "pg", "wait", ["upgrade"], "up to 30 s"),
          s("upgrade", "Upgrade tables, convert content", "pg", "automation", ["prepare"], "migrations' lock"),
          s("prepare", "Fill if empty, regenerate skills", "pg", "automation", ["index"], "LockPrepare"),
          s("index", "Set up the search index tables", "pg", "automation", ["catchup"], "only when on"),
          s("catchup", "Catch the index up in background", "provider", "automation", ["schemas"], "retried every 5 min"),
          s("schemas", "Load the JSON schemas", "server", "task", ["discover"], "PM_SCHEMA_DIR"),
          s("discover", "Discover the sign-in provider", "idp", "automation", ["listen"], "not with PM_AUTH=dev"),
          s("listen", "Listen and serve", "server", "automation", ["stop"], "PM_ADDR or PORT"),
          s("stop", "Asked to stop?", "server", "decision", [["drain", "SIGTERM"]]),
          s("drain", "Finish requests, wait for work", "server", "wait", [], "15 s grace"),
        ]),
    },
    {
      caption: "How one API request is answered: the guard, the route, the handler, and the mapping of errors in `fail`.",
      process: flow("code-api-request", "One API request", "From the mux to the answer.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Send /api/… request", "browser", "task", ["guard"]),
          s("guard", "Apply the guard", "server", "verify", ["route"], "headers, CSRF, 30 s, log"),
          s("route", "Route known?", "server", "decision", [["who", "Yes"], ["r404", "No"]]),
          s("r404", "Answer 404 no such endpoint", "server", "communication", []),
          s("who", "Find the person and rights", "pg", "automation", ["handle"], "user() or admin()"),
          s("handle", "Run the handler", "server", "code", ["ok"], "one file per subject"),
          s("ok", "Did it work?", "server", "decision", [["json", "Yes"], ["fail", "No"]]),
          s("fail", "Map the error to status", "server", "automation", ["json"], "404, 400, 409, 413, 500"),
          s("json", "Answer JSON, no-store", "server", "communication", []),
        ]),
    },
  ],
  start: "server/internal/httpapi/api.go",
  files: [
    {
      path: "server/internal/httpapi/api.go",
      role: "Every route of the server (`New`), the request guard, sessions, /api/me, sign-in and sign-out, /healthz, /readyz and the built app.",
      requirements: [
        { text: "The one list of routes: content, working drafts, feedback, views, bookmarks, upvotes, requests, skills, search, icons, theme, groups, admin.", at: "func New(d Deps) http.Handler {" },
        { text: "/healthz: alive. /readyz: alive and the database answers within 2 seconds (503 otherwise).", at: "mux.HandleFunc(\"GET /readyz\", func(w http.ResponseWriter, r *http.Request) {" },
        { text: "Any other /api/ path is 404 in JSON, never the app page.", at: "mux.HandleFunc(\"/api/\", func(w http.ResponseWriter, _ *http.Request) { writeError(w, 404, \"no such API endpoint\") })" },
        { text: "Known errors become 404, 400, 409 or 413 with a plain sentence; anything else is logged and answered 500 without its cause.", at: "func (a *api) fail(w http.ResponseWriter, r *http.Request, err error) {" },
        { text: "Every JSON answer is no-store.", at: "func writeJSON(w http.ResponseWriter, status int, v any) {" },
        { text: "A missing file is 404, not the app page, so an older browser never gets HTML for a script; assets are cached for a year.", at: "if strings.HasPrefix(r.URL.Path, \"/assets/\") || filepath.Ext(r.URL.Path) != \"\" {" },
        { text: "While the app's files are not in place, a plain 503 page; looked up on every request, so they count as soon as they arrive.", at: "const notInPlacePage = " },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "Routes: GET /api/processes, /api/standards, /api/catalog; PUT and DELETE /api/{processes|standards}/{id}; PUT /api/catalog; POST …/{id}/review; GET /api/history/{kind}/{id}[/{version}].",
      requirements: [
        { text: "Every save of a document, whatever the call, goes through save and docs.Store.Save: rights, format, checker, the lists still in use, icons, then the version.", at: "func (a *api) save(w http.ResponseWriter, r *http.Request, sv saving) {" },
        { text: "A conflict names who saved or deleted first, by name where known (409).", at: "func (a *api) conflict(w http.ResponseWriter, r *http.Request, kind, id string, c *docs.Conflict) {" },
        { text: "After a change the skills are regenerated and the search index follows; the answer waits for the skills at most 20 seconds and never for the index.", at: "func (a *api) syncSkills(ctx context.Context, kind, id string) {" },
        { text: "The lists are served as a bare document with their version in X-Document-Version (0 and the empty lists when none are stored).", at: "func (a *api) getCatalog(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/versions_test.go", "server/internal/httpapi/api_test.go"],
    },
    {
      path: "server/internal/httpapi/drafts.go",
      role: "Routes: GET, PUT and DELETE /api/{processes|standards}/{id}/draft, POST …/{id}/publish.",
      requirements: [
        { text: "rev is required: the revision of the working draft a change was made from (0 to start one).", at: "func revOf(r *http.Request) (int, bool) {" },
        { text: "No working draft is 204 for somebody who may draft the document, 404 for everybody else.", at: "w.WriteHeader(http.StatusNoContent)" },
        { text: "Saving a working draft is not written to Activity (it happens every few seconds); discarding and publishing are.", at: "// saving a draft is not in the activity log: it happens every few seconds" },
      ],
      tests: ["server/internal/httpapi/drafts_test.go"],
    },
    {
      path: "server/internal/httpapi/feedback.go",
      role: "Routes: GET and POST /api/feedback, PATCH and DELETE /api/feedback/{id}, POST and DELETE /api/feedback/{id}/also-hit.",
      requirements: [
        { text: "New feedback is checked (known target and item, kind, 3 to 2000 characters), limited per person and hour (429), answered 201, and announced to the owning team.", at: "func (a *api) createFeedback(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/feedback_limit_test.go"],
    },
    {
      path: "server/internal/httpapi/engagement.go",
      role: "Routes: GET /api/engagement, POST /api/views/{kind}/{id}, PUT and DELETE /api/bookmarks/… and /api/upvotes/….",
      requirements: [
        { text: "Counting a view never gets in the way of reading: a failure is logged and the numbers are answered as they are.", at: "func (a *api) recordView(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/engagement_test.go"],
    },
    {
      path: "server/internal/httpapi/requests.go",
      role: "Routes: GET and POST /api/requests, PUT and DELETE /api/requests/{id}/vote, PUT /api/requests/{id}/state, DELETE /api/requests/{id}.",
      requirements: [
        { text: "A request: a process or a standard, a title of 5 to 120 and a description of 10 to 1000 characters, a platform and a practice (when given) from the lists; at most 10 a person an hour (429).", at: "func (a *api) createRequest(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/requests_test.go"],
    },
    {
      path: "server/internal/httpapi/search.go",
      role: "Route: GET /api/search (search by meaning), and the per-person brake shared with icon uploads.",
      requirements: [
        { text: "404 while search by meaning is off; 1 to 500 results, a question of at most 1000 characters; 60 searches a person a minute (429 with Retry-After).", at: "func (a *api) search(w http.ResponseWriter, r *http.Request) {" },
        { text: "A provider that cannot be reached is 502, an index that is not ready 503: both say to search by words meanwhile.", at: "case errors.Is(err, retrieval.ErrProvider):" },
        { text: "The brake counts per person in a fixed window and forgets finished windows once it holds more than 10000.", at: "func (b *brake) allow(who string, now time.Time) bool {" },
      ],
      tests: ["server/internal/httpapi/search_test.go"],
    },
    {
      path: "server/internal/httpapi/icons.go",
      role: "Routes: POST /api/icons, GET /api/icons/{id}; the format check of a save of the lists.",
      requirements: [
        { text: "An icon is served with its own policy (nothing runs, sandbox) and cached for good under its fingerprint (ETag, 304).", at: "const iconPolicy = \"default-src 'none'; style-src 'unsafe-inline'; sandbox\"" },
        { text: "Uploads are read no further than 64 KB and limited to 60 a person an hour.", at: "func (a *api) uploadIcon(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/icons_test.go"],
    },
    {
      path: "server/internal/httpapi/theme.go",
      role: "Routes: GET /api/theme and /api/theme/logo (no sign-in), GET and PUT /api/admin/theme.",
      requirements: [
        { text: "A change of the look is made from a revision; a newer one wins with 409 and what is stored now; every problem is one sentence (400).", at: "func (a *api) putTheme(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/theme_test.go"],
    },
    {
      path: "server/internal/httpapi/groups.go",
      role: "Routes: POST and DELETE /api/groups/{platforms|practices}/{id}/members, PUT /api/groups/{teams|platforms|practices}/{id}/details.",
      requirements: [
        { text: "A change of details is applied to the newest stored lists and saved through docs.Store.Save; when somebody saved the lists at the same moment it is applied again, up to 10 times.", at: "const detailsTries = 10" },
        { text: "Only that one entry's description and contacts change; every other byte of the lists stays.", at: "func withDetails(body []byte, key, id string, set map[string]json.RawMessage) ([]byte, bool, error) {" },
      ],
      tests: ["server/internal/httpapi/groups_test.go"],
    },
    {
      path: "server/internal/httpapi/admin.go",
      role: "Routes: GET, POST and DELETE /api/admin/access, GET /api/members, GET /api/admin/audit, GET /api/admin/system, and the skills routes GET /api/skills[/{id}[/versions/{n}|/download]], PUT /api/skills/{id}/extra.",
      requirements: [
        { text: "The activity log is read page by page: at most 499 entries a page, one more read to say whether there is an older page.", at: "func (a *api) listAudit(w http.ResponseWriter, r *http.Request) {" },
        { text: "The system page: provider, address, notifications, counts, and whether the portal can show its source; a number that cannot be read is an error, not a zero.", at: "func (a *api) system(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go"],
    },
    {
      path: "server/internal/httpapi/users.go",
      role: "Routes: GET /api/admin/users, PUT and DELETE /api/admin/users/{email}; where people's names come from.",
      requirements: [
        { text: "The server keeps no list of people: a name is the newest one a person had in the activity log, feedback or requests (and the built-in users in development).", at: "func (a *api) names(ctx context.Context, emails []string) (map[string]string, error) {" },
        { text: "At most 200 roles in one call.", at: "const maxRoles = 200" },
      ],
      tests: ["server/internal/httpapi/users_test.go"],
    },
    {
      path: "server/internal/httpapi/statistics.go",
      role: "Routes: GET /api/admin/statistics and /api/admin/statistics.csv.",
      requirements: [
        { text: "Periods 7, 30, 90, 365 days or all (400 otherwise), ending today in UTC.", at: "var periods = map[string]int{\"7\": 7, \"30\": 30, \"90\": 90, \"365\": 365, \"all\": 0}" },
        { text: "The spreadsheet starts with a byte order mark, ends lines with CRLF, and guards every text cell against being read as a formula.", at: "func csvCell(s string) string {" },
      ],
      tests: ["server/internal/httpapi/statistics_test.go"],
    },
    {
      path: "server/internal/httpapi/source.go",
      role: "Route: GET /api/admin/source?path=… for Admin › Code map: one source file of the checkout named by PM_SOURCE_DIR.",
      requirements: [
        { text: "No PM_SOURCE_DIR (or not a folder): 404 for every path; otherwise one identical 404 for a path that is not allowed, missing or not a regular file.", at: "func (a *api) source(w http.ResponseWriter, r *http.Request) {" },
        { text: "At most 400 KB a file; the answer is {path, text, bytes} with no-store, and reading is not written to Activity.", at: "const maxSourceBytes = 400 * 1024" },
      ],
    },
    {
      path: "server/cmd/server/main.go",
      role: "The program: settings, database, upgrade, first fill, the one-off commands (-import, -export, -migrate, -reindex, -reset, -seed), and serving until stopped.",
      requirements: [
        { text: "The order of a start: settings, database (waited for up to 30 s), upgrade, one-off commands, first fill under a lock, index set-up, schemas, sign-in provider, serve.", at: "func run(log *slog.Logger, o options) error {" },
        { text: "Tables are upgraded and older content converted under the migrations' lock, on every start and by -migrate alike.", at: "func upgradeDatabase(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) ([]string, upgrade.Report, error) {" },
        { text: "An empty database is filled from PM_SEED_DIR once; development users without roles get theirs; unused icons are removed; skills are regenerated.", at: "func prepare(ctx context.Context, cfg config.Config, st stores, log *slog.Logger) error {" },
        { text: "Imported files get the same checks as a save in the portal: the format, then that the parts fit together.", at: "st.validate = func(kind string, body []byte) error {" },
        { text: "Slow or stuck clients cannot hold a connection: header 10 s, read 30 s, write 60 s, idle 2 min.", at: "ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 2 * time.Minute," },
        { text: "Stopping waits for requests in progress (15 s) and for background work before the database is closed.", at: "func serve(ctx context.Context, srv *http.Server, log *slog.Logger, drain func(), info ...any) error {" },
        { text: "-reset deletes feedback, views, bookmarks, upvotes, downloads and requests, and only with PM_AUTH=dev.", at: "if cfg.Auth != config.AuthDev {" },
        { text: "PM_LOG_FORMAT=json gives one JSON object per line; text otherwise.", at: "if os.Getenv(\"PM_LOG_FORMAT\") == \"json\" {" },
      ],
      tests: ["server/cmd/server/main_test.go", "server/cmd/server/migrate_test.go", "server/cmd/server/hang_test.go", "server/cmd/server/reindex_test.go", "server/cmd/server/icons_test.go"],
    },
    {
      path: "server/cmd/server/seed.go",
      role: "-seed with PM_AUTH=dev: made-up views, upvotes, bookmarks, downloads and requests for a local database that has none.",
      requirements: [
        { text: "Adds nothing as soon as anything was recorded; drafts get no samples; the numbers are random but the same for the same content.", at: "func seedEngagement(ctx context.Context, st stores, log *slog.Logger, now time.Time) error {" },
      ],
      tests: ["server/cmd/server/seed_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Every setting of the server, read from the environment, with every problem said at once.",
      requirements: [
        { text: "The listen address: PM_ADDR, else 0.0.0.0:$PORT when PORT is set (Cloud Run), else 127.0.0.1:8080.", at: "c.Addr = \"127.0.0.1:8080\"" },
        { text: "DATABASE_URL and PM_AUTH are required; PM_LOG_FORMAT is text or json; PM_NOTIFY is log or webhook (with PM_NOTIFY_WEBHOOK_URL).", at: "problems = append(problems, \"DATABASE_URL is required\")" },
        { text: "Search by meaning: PM_EMBEDDINGS off (default), builtin or vertex; 768 dimensions by default, at most 2000; parts of at most PM_CHUNK_MAX_CHARS (200 to 20000).", at: "func LoadEmbeddings(getenv func(string) string) (Embeddings, error) {" },
        { text: "PM_SOURCE_DIR, when set, must be an absolute path; empty means the portal shows no source.", at: "get(\"PM_SOURCE_DIR\", \"\")" },
      ],
      tests: ["server/internal/config/config_test.go"],
    },
  ],
};
