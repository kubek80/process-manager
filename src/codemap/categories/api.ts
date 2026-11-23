import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const api: CodeCategory = {
  id: "api",
  area: "server",
  title: "The server and its API",
  summary:
    "Runs the one Go program that answers the portal's JSON API, the sign-in, the health checks and the built app. " +
    "`server/cmd/server` reads its settings from the environment, upgrades the database and fills an empty one before it serves. " +
    "Every route is declared in one place, `httpapi.New` in `api.go`; the handlers live in one file per subject, and errors are mapped to a status and one plain sentence in `fail`.",
  requirements: [
    "Every route is declared in `httpapi.New` (`api.go`); an unknown `/api/…` path answers 404 `{\"error\": \"no such API endpoint\"}`.",
    "Every JSON answer is written by `writeJSON` with `Cache-Control: no-store`; every error is `{\"error\": \"<one plain sentence>\"}`.",
    "An error the handler does not expect is logged with method and path and answered 500 \"Something went wrong on the server.\"; its cause is never sent to the browser.",
    "`/healthz` answers 200 while the process runs; `/readyz` answers 503 when the database does not answer within 2 seconds.",
    "Every request under `/api/` and `/auth/` is logged with method, path, status and time, and gets 30 seconds; a body of a change is limited to 1 MB (413).",
    "The server refuses to start with settings that do not fit, and says every problem at once (`config.Load`).",
    "Before it serves, the server upgrades the tables and converts older content under the migrations' lock, and fills an empty database from `PM_SEED_DIR` under its own lock, so several instances can start together.",
    "On stop it stops taking requests and waits for those in progress and for background work (skills, index, notifications), all within one 15-second grace period, before the database is closed.",
    "A path of the built app that is not a file answers `index.html` (the app routes on the hash), except under `/assets/` or with a file ending, which answer 404; while the app's files are missing the answer is a plain 503 page.",
    "Search by meaning is prepared quickly before serving; catching up the index runs in the background, so a slow provider never delays the start.",
  ],
  charts: [
    {
      caption: "What `run` in `server/cmd/server/main.go` does from start to serving. With search by meaning on, the index is caught up in the background after the start (and retried every 5 minutes); on stop the server finishes requests and background work within 15 seconds.",
      process: flow("code-api-start", "Starting the server", "From the settings to the first request.",
        [["server", "Server"], ["pg", "Postgres"], ["idp", "Identity provider"]],
        [
          s("config", "Read and check the settings", "server", "verify", ["connect"], "config.Load"),
          s("connect", "Wait for the database", "pg", "wait", ["upgrade"], "up to 30 s"),
          s("upgrade", "Upgrade tables, convert content", "pg", "automation", ["prepare"], "migrations' lock"),
          s("prepare", "Fill if empty, regenerate skills", "pg", "automation", ["index"], "LockPrepare"),
          s("index", "Set up the search index tables", "pg", "automation", ["schemas"], "only when on"),
          s("schemas", "Load the JSON schemas", "server", "task", ["discover"], "PM_SCHEMA_DIR"),
          s("discover", "Discover the sign-in provider", "idp", "communication", ["listen"], "not with PM_AUTH=dev"),
          s("listen", "Listen and serve", "server", "automation", [], "PM_ADDR or PORT"),
        ]),
    },
    {
      caption: "How one API request is answered after the guard (`signin`): the route, the person, the handler, and the mapping of errors in `fail` (404, 400, 409, 413, 500).",
      process: flow("code-api-request", "One API request", "From the mux to the answer.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Send /api/… request", "browser", "task", ["guard"]),
          s("guard", "Apply the guard", "server", "verify", ["route"], "headers, CSRF, 30 s, log"),
          s("route", "Route known?", "server", "decision", [["who", "Yes"], ["r404", "No"]]),
          s("r404", "Answer 404 no such endpoint", "server", "communication", []),
          s("who", "Find the person and rights", "pg", "task", ["handle"], "user() or admin()"),
          s("handle", "Did the handler succeed?", "server", "decision", [["json", "Yes"], ["fail", "No"]], "one file per subject"),
          s("fail", "Map the error to a status", "server", "automation", ["json"], "fail"),
          s("json", "Answer JSON, no-store", "server", "communication", []),
        ]),
    },
  ],
  start: "server/internal/httpapi/api.go",
  files: [
    {
      path: "server/internal/httpapi/api.go",
      role: "Every route of the server (`New`), the request guard, sessions, `/api/me`, sign-in and sign-out, `/healthz`, `/readyz` and the built app.",
      requirements: [
        { text: "The one list of routes, each wrapped in `user(…)` or `admin(…)` where it needs a person: a route added anywhere else would bypass the session check.", at: "func New(d Deps) http.Handler {" },
        { text: "`/readyz` gives the database 2 seconds: a load balancer takes an instance out of service instead of sending it requests it cannot answer. Test: `TestReadyOnlyWhenTheDatabaseAnswers`.", at: "ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)" },
        { text: "Any other `/api/` path is a JSON 404, never the app page, so a typo in a client is an error and not HTML. Test: `TestHealthAndUnknownEndpoint`.", at: "mux.HandleFunc(\"/api/\", func(w http.ResponseWriter, _ *http.Request) { writeError(w, 404, \"no such API endpoint\") })" },
        { text: "An error no case above knows is logged with its cause and answered with one fixed sentence: a database or file error never reaches the browser.", at: "a.Log.Error(\"request failed\", \"method\", r.Method, \"path\", r.URL.Path, \"error\", err)" },
        { text: "`no-store` on every JSON answer: rights-dependent answers (drafts, roles) must not be kept by a shared cache or the browser.", at: "w.Header().Set(\"Cache-Control\", \"no-store\")" },
        { text: "The 30-second limit is a context, so a stuck query is cancelled and its connection goes back to the pool.", at: "ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)" },
        { text: "Bodies of changes are cut at 1 MB (413), before any handler reads them.", at: "r.Body = http.MaxBytesReader(w, r.Body, maxBody)" },
        { text: "Assets are cached for a year because their names carry a hash; a missing file is 404, not the app page, so an older browser never gets HTML for a script. Test: `TestAMissingFileIsNotTheAppPage`.", at: "w.Header().Set(\"Cache-Control\", \"public, max-age=31536000, immutable\")" },
        { text: "While the app's files are not in place: a plain 503 page, looked up again on every request so the files count as soon as they arrive. Test: `TestAppFilesNotInPlaceYet`.", at: "w.WriteHeader(http.StatusServiceUnavailable)" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "Routes: `GET /api/processes`, `/api/standards`, `/api/catalog`; `PUT` and `DELETE /api/{processes|standards}/{id}`; `PUT /api/catalog`; `POST …/{id}/review`; `GET /api/history/{kind}/{id}[/{version}]`.",
      requirements: [
        { text: "Every save, whatever the call (`PUT`, `?draft=R`, publish, the lists), goes through `save` and `docs.Store.Save`: a second way to save would skip rights, the format or the lists still in use. Test: `TestASaveFromAnOutdatedVersionIsRefused`.", at: "func (a *api) save(w http.ResponseWriter, r *http.Request, sv saving) {" },
        { text: "A 409 names who saved or deleted first; who deleted something only to somebody who could draft its last version (`CanDraft`) and names a version of it they had (`base` or `known`). Test: `TestWhoDeletedOrRetiredItIsSaid`.", at: "writeJSON(w, 409, map[string]any{\"error\": msg, \"conflict\": info})" },
        { text: "The regeneration is detached from the request (`WithoutCancel`), so a person closing the tab does not leave skills out of date. Test: `TestSkillsFollowASaveEvenWhenTheClientIsGone`.", at: "ctx = context.WithoutCancel(ctx)" },
        { text: "The answer waits for the skills at most `syncWait` (20 s) and never for the index, so a slow provider cannot slow a save. Test: `TestAHangingProviderNeitherSlowsASaveNorBlocksThePortal`.", at: "case <-time.After(syncWait):" },
        { text: "Before the lists were ever saved, `GET /api/catalog` is version 0 with the empty lists, so the first save is made from version 0 like any other.", at: "w.Header().Set(VersionHeader, \"0\")" },
        { text: "`POST …/{id}/review?day=` records the person's own day (the app sends it) while it is today somewhere on Earth (`docs.TodaySomewhere`); without `day`, or from a wrong clock, the server's UTC day: never refused for the day. Test: `TestAReviewIsRecordedOnThePersonsOwnDay`.", at: "if !docs.TodaySomewhere(day, time.Now()) {" },
      ],
      tests: ["server/internal/httpapi/versions_test.go", "server/internal/httpapi/api_test.go", "server/internal/httpapi/review_test.go"],
    },
    {
      path: "server/internal/httpapi/drafts.go",
      role: "Routes: `GET`, `PUT` and `DELETE /api/{processes|standards}/{id}/draft`, `POST …/{id}/publish`.",
      requirements: [
        { text: "`rev` is required on every change of a working draft (0 to start one), so a save made from an older revision is a conflict, never an overwrite.", at: "return n, err == nil && n >= 0" },
        { text: "No working draft is 204 for somebody who may draft the document (an ordinary answer), 404 for everybody else.", at: "w.WriteHeader(http.StatusNoContent)" },
        { text: "Saving a working draft is not written to Activity (the editing screen saves every few seconds); discarding and publishing are.", at: "// saving a draft is not in the activity log: it happens every few seconds" },
      ],
      tests: ["server/internal/httpapi/drafts_test.go"],
    },
    {
      path: "server/internal/httpapi/feedback.go",
      role: "Routes: `GET` and `POST /api/feedback`, `PATCH` and `DELETE /api/feedback/{id}`, `POST` and `DELETE /api/feedback/{id}/also-hit`.",
      requirements: [
        { text: "At most 2000 characters (at least 3): the item is posted whole to the team's channel.", at: "case utf8.RuneCountInString(in.Text) > 2000:" },
        { text: "Too much feedback from one person in an hour is 429, counted for the portal and agents together. Test: `TestOnePersonCannotFloodTheOwners`.", at: "if errors.Is(err, feedback.ErrTooMany) {" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/feedback_limit_test.go", "server/internal/httpapi/hardening_test.go"],
    },
    {
      path: "server/internal/httpapi/engagement.go",
      role: "Routes: `GET /api/engagement`, `POST /api/views/{kind}/{id}`, `PUT` and `DELETE /api/bookmarks/…` and `/api/upvotes/…`.",
      requirements: [
        { text: "A view that cannot be stored is logged and answered with the numbers as they are (or zero): counting must never get in the way of reading. Test: `TestCountingAViewNeverFailsThePage`.", at: "if views, people, err = a.Engagement.ViewCounts(r.Context(), kind, id); err != nil {" },
      ],
      tests: ["server/internal/httpapi/engagement_test.go"],
    },
    {
      path: "server/internal/httpapi/requests.go",
      role: "Routes: `GET` and `POST /api/requests`, `PUT` and `DELETE /api/requests/{id}/vote`, `PUT /api/requests/{id}/state`, `DELETE /api/requests/{id}`.",
      requirements: [
        { text: "A title of 5 to 120 and a description of 10 to 1000 characters; a platform and a practice, when given, must be in the lists.", at: "case title < 5 || title > 120:" },
        { text: "At most 10 requests a person an hour, withdrawn ones included (429). Test: `TestOnePersonCannotFloodTheRequests`.", at: "if errors.Is(err, requests.ErrTooMany) {" },
      ],
      tests: ["server/internal/httpapi/requests_test.go"],
    },
    {
      path: "server/internal/httpapi/search.go",
      role: "Route: `GET /api/search` (search by meaning), and the per-person brake shared with icon uploads and source reads.",
      requirements: [
        { text: "404 while search by meaning is off; whether it is on is also in `/api/me` (`search.meaning`), so the app knows before it asks. Test: `TestSearchByMeaningIsOffByDefault`.", at: "if !a.Index.Enabled() {" },
        { text: "60 searches a person a minute (429 with `Retry-After`): each may call an outside provider. Test: `TestOnePersonCannotSearchWithoutEnd`.", at: "if !a.searches.allow(who(r).Email, time.Now()) {" },
        { text: "The brake is in memory, per instance; finished windows are forgotten once it holds more than 10000 people, so it cannot grow without end.", at: "if len(b.counts) > 10000 {" },
      ],
      tests: ["server/internal/httpapi/search_test.go"],
    },
    {
      path: "server/internal/httpapi/icons.go",
      role: "Routes: `POST /api/icons`, `GET /api/icons/{id}`; the format check of a save of the lists.",
      requirements: [
        { text: "Every icon is served with a policy of its own (`default-src 'none'`, `sandbox`), so an SVG opened on its own in a tab cannot run anything. Test: `TestAServedSVGCannotRunAnything`.", at: "h.Set(\"Content-Security-Policy\", iconPolicy)" },
        { text: "The body is read no further than 64 KB plus one byte, whatever `Content-Length` claims. Test: `TestAnOversizedUploadIsCutOff`.", at: "data, err := io.ReadAll(io.LimitReader(r.Body, icons.MaxBytes+1))" },
      ],
      tests: ["server/internal/httpapi/icons_test.go"],
    },
    {
      path: "server/internal/httpapi/theme.go",
      role: "Routes: `GET /api/theme` and `/api/theme/logo` (no sign-in), `GET` and `PUT /api/admin/theme`.",
      requirements: [
        { text: "A change made from an older revision is 409 with what is stored now, so one admin never silently overwrites another's look.", at: "if errors.As(err, &conflict) {" },
      ],
      tests: ["server/internal/httpapi/theme_test.go"],
    },
    {
      path: "server/internal/httpapi/groups.go",
      role: "Routes: `POST` and `DELETE /api/groups/{platforms|practices}/{id}/members`, `PUT /api/groups/{teams|platforms|practices}/{id}/details`.",
      requirements: [
        { text: "A details change is applied again to the newest lists when somebody saved them at the same moment, up to 10 times, so an owner's small change never fails on a lists manager's save. Test: `TestDetailsSurviveSavesOfTheListsAtTheSameTime`.", at: "if errors.As(err, &c) && try < detailsTries {" },
        { text: "Only that one entry's description and contacts change; every other byte of the lists stays, so the new version shows no unrelated difference.", at: "func withDetails(body []byte, key, id string, set map[string]json.RawMessage) ([]byte, bool, error) {" },
      ],
      tests: ["server/internal/httpapi/groups_test.go"],
    },
    {
      path: "server/internal/httpapi/admin.go",
      role: "Routes: `GET`, `POST` and `DELETE /api/admin/access`, `GET /api/members`, `GET /api/admin/audit`, `GET /api/admin/system`, and the skills routes `GET /api/skills[/{id}[/versions/{n}|/download]]`, `PUT /api/skills/{id}/extra`.",
      requirements: [
        { text: "A page of the activity log has at most 499 entries: the log returns 500 at most, and one more is read to say whether there is an older page. Test: `TestTheActivityLogCanBeReadPageByPage`.", at: "if limit > 499 {" },
        { text: "A number on the system page that cannot be read is an error (500), not a zero that would look like an empty portal. Test: `TestSystemOverview`.", at: "if failed != nil {" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go"],
    },
    {
      path: "server/internal/httpapi/users.go",
      role: "Routes: `GET /api/admin/users`, `PUT` and `DELETE /api/admin/users/{email}`; where people's names come from.",
      requirements: [
        { text: "The server keeps no list of people: a name is the newest one a person had in `audit_log`, `feedback` or `requests` (the first source that has one wins), and the built-in users in development. Test: `TestNamesComeFromWhatPeopleDid`.", at: "if out[email] == \"\" {" },
        { text: "At most 200 roles in one call (400), so one request cannot hold the roles' lock for long.", at: "if len(roles) > maxRoles {" },
      ],
      tests: ["server/internal/httpapi/users_test.go"],
    },
    {
      path: "server/internal/httpapi/statistics.go",
      role: "Routes: `GET /api/admin/statistics` and `/api/admin/statistics.csv`.",
      requirements: [
        { text: "Periods 7, 30, 90, 365 days or `all` (400 otherwise), ending today in UTC.", at: "var periods = map[string]int{\"7\": 7, \"30\": 30, \"90\": 90, \"365\": 365, \"all\": 0}" },
        { text: "A text cell starting with `=`, `+`, `-` or `@` (also after leading spaces), or with a tab or line break, gets an apostrophe, so a title cannot run a formula when the file is opened in a spreadsheet. Test: `TestCSVCellGuard`.", at: "func csvCell(s string) string {" },
      ],
      tests: ["server/internal/httpapi/statistics_test.go"],
    },
    {
      path: "server/internal/httpapi/source.go",
      role: "Route: `GET /api/admin/source?path=…` for Admin › Code map: one file git tracks in the checkout named by `PM_SOURCE_DIR`.",
      requirements: [
        { text: "No `PM_SOURCE_DIR`, or no checkout there whose files git can list: 404 for every path (\"This installation does not show its source code.\"). `/api/admin/system` says `source: false` then.", at: "writeError(w, 404, sourceOffMessage)" },
        { text: "The list of tracked files is cached and listed again only when git's index file changes, so opening files does not run git each time.", at: "if !t.known || t.stamp != stamp {" },
        { text: "The answer is `{path, text, bytes}` with `no-store`; at most 400 KB a file; reading is not written to Activity.", at: "const maxSourceBytes = 400 * 1024" },
      ],
      tests: ["server/internal/httpapi/source_test.go"],
    },
    {
      path: "server/cmd/server/main.go",
      role: "The program: settings, database, upgrade, first fill, the one-off commands (`-import`, `-export`, `-migrate`, `-reindex`, `-reset`, `-seed`), and serving until stopped.",
      requirements: [
        { text: "Tables are upgraded and older content converted on every start, before anything else uses the database; `-migrate` does the same and exits. Test: `TestMigrateTwiceAtOnceConvertsOnce`.", at: "if _, _, err := upgradeDatabase(ctx, pool, log); err != nil {" },
        { text: "The first fill runs under `db.LockPrepare`: several instances starting together on an empty database import the samples once. Test: `TestPrepareFillsAnEmptyDatabaseOnce`.", at: "if err := db.WithLock(ctx, pool, db.LockPrepare, func() error { return prepare(ctx, cfg, st, log) }); err != nil {" },
        { text: "Only an empty database is filled from `PM_SEED_DIR`: restarting never puts the samples back over real content.", at: "if n == 0 {" },
        { text: "Imported files get the format check, then `docs.Check` against the lists, like a save in the portal. Test: `TestImportSkipsFilesThatDoNotMatchTheFormat`.", at: "if err := set.Validate(kind, body); err != nil {" },
        { text: "Catching up the index runs after the start, in the background: a slow or unreachable provider never keeps the portal from serving. Test: `TestTheServerListensWhileTheProviderHangs`.", at: "st.index.LogCatchUp(ctx)" },
        { text: "Slow or stuck clients cannot hold a connection: header 10 s, read 30 s, write 60 s, idle 2 min.", at: "ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 2 * time.Minute," },
        { text: "Requests in progress and background work share one 15-second grace period; what is not done by then is logged, and the database is closed. Test: `TestStoppingWaitsForRequestsInProgress`.", at: "case <-grace.Done():" },
        { text: "`-reset` deletes feedback, views, bookmarks, upvotes, downloads and requests, and only with `PM_AUTH=dev`. Test: `TestResetIsOnlyForLocalDevelopment`.", at: "if cfg.Auth != config.AuthDev {" },
        { text: "`PM_LOG_FORMAT=json` gives one JSON object per line; read here before the settings are checked, so an invalid value logs as text and then stops with the settings error.", at: "if os.Getenv(\"PM_LOG_FORMAT\") == \"json\" {" },
      ],
      tests: ["server/cmd/server/main_test.go", "server/cmd/server/migrate_test.go", "server/cmd/server/hang_test.go", "server/cmd/server/reindex_test.go", "server/cmd/server/icons_test.go"],
    },
    {
      path: "server/cmd/server/seed.go",
      role: "`-seed` with `PM_AUTH=dev`: made-up views, upvotes, bookmarks, downloads and requests for a local database that has none.",
      requirements: [
        { text: "Adds nothing as soon as anything was recorded, so it never mixes made-up use into real use. Test: `TestSeedEngagementNeverAddsToRealUse`.", at: "empty, err := st.engagement.Empty(ctx)" },
        { text: "A fixed seed: the numbers are random but the same for the same content, so screenshots and tests are repeatable.", at: "rng := rand.New(rand.NewPCG(2026, 11))" },
      ],
      tests: ["server/cmd/server/seed_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Every setting of the server, read from the environment, with every problem said at once.",
      requirements: [
        { text: "`PM_ADDR` wins when set; without it, `PORT` (Cloud Run) makes the server listen on all addresses, else it listens on `127.0.0.1:8080`. Test: `TestListenAddressFromPort`.", at: "c.Addr = net.JoinHostPort(\"0.0.0.0\", port)" },
        { text: "All problems are collected and returned together, so a deployment is fixed in one round instead of one setting at a time. Test: `TestLoadRejects`.", at: "return c, errors.New(strings.Join(problems, \"; \"))" },
        { text: "Vector sizes above 2000 are refused: pgvector cannot index them. Test: `TestEmbeddingSettings`.", at: "if err != nil || n < minDimensions || n > maxDimensions {" },
        { text: "`PM_SOURCE_DIR` must be absolute: a relative path would depend on where the server was started. Test: `TestSourceDir`.", at: "if !filepath.IsAbs(c.SourceDir) {" },
      ],
      tests: ["server/internal/config/config_test.go"],
    },
  ],
};
