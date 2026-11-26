import { flow, s } from "../chart";
import type { CodeCategory, CodeFile } from "../types";

/** One browser test file: what it covers, in one sentence. */
const spec = (name: string, role: string): CodeFile => ({ path: `e2e/${name}`, role, requirements: [] });

export const tests: CodeCategory = {
  id: "tests",
  area: "around",
  title: "Tests and CI",
  summary:
    "Three levels of tests keep the portal true: Vitest for the app's logic, Go tests on a real Postgres, Playwright for the whole portal. `npm run test:all` runs them in order after the type check and the check of the sample files; CI runs the same steps on every push to main and every pull request. The browser tests use the built app served by the real Go server, on a database refilled from the sample files.",
  requirements: [
    "`npm run test:all` runs `tsc --noEmit`, the check of the sample files, Vitest (only `src/**/*.test.ts`, in Node without a browser page), the Go tests, then Playwright after `npm run build`, stopping at the first failure.",
    "Every Go test that needs the database gets a schema of its own (`t_<pid>_<n>`), migrated with `db.Migrate`, and drops it at the end, so tests can run in parallel and leave nothing behind.",
    "Without a reachable test database a Go database test is skipped on a developer's machine but fails when `CI` is set, so a green CI run always includes the database tests.",
    "The browser tests run one at a time (`workers: 1`) against one server on port 8090 and the database `pm_e2e`, which is emptied (`drop schema public cascade`) and refilled from the sample files at every start, by the real Go binary serving `dist/` with development sign-in, the `builtin` embedder and `PM_SOURCE_DIR` set.",
    "Nothing in tests or CI calls an outside service: the browser tests' server always uses the `builtin` embedder, and Vertex AI is tested only against a local stand-in (`httptest`) in `embedding_test.go`.",
    "A browser test that changes shared content works on a copy of its own or puts the content back, also when it fails: other tests count the sample (7 processes, 3 standards).",
    "A refusal is proved at the server, not only by a hidden control: the browser tests also call the API directly as a person without the right and expect 401, 403 or 404; the Go tests compare a refusal byte for byte with the answer for something that does not exist (`source_test.go`, `skills_draft_test.go`).",
    "The tests of `GET /api/admin/source` build real git checkouts (`git init`, `git add`) in a temporary folder and are skipped with a message where git is not installed; the swap and FIFO tests (`source_linux_test.go`) run on Linux only.",
    "`skills_draft_test.go` proves that after a process is taken back to draft a reader gets no trace of its skill through any of the skill routes, and that feedback on it answers 404 to whoever may not see it.",
    "CI fails on unformatted Go (`gofmt -l`), on `go vet`, on a data race (`-race`) and on a known high-severity vulnerability in a runtime npm dependency; a failed run keeps the Playwright report.",
  ],
  charts: [
    {
      caption: "What `npm run test:all` does, level by level, cheapest first; `&&` stops at the first failure. CI runs the same steps, plus `gofmt`, `go vet` and `npm audit`, in `.github/workflows/ci.yml`.",
      process: flow("code-tests-levels", "From a change to a green run", "The levels of tests, cheapest first.",
        [["dev", "Developer"], ["node", "Node"], ["go", "Go tests"], ["browser", "Browser"]],
        [
          s("run", "Run npm run test:all", "dev", "task", ["types"], "or push: CI"),
          s("types", "Check the types", "node", "verify", ["validate"], "tsc --noEmit"),
          s("validate", "Check the sample files", "node", "verify", ["vitest"], "processes, standards, catalog"),
          s("vitest", "Run the unit tests", "node", "verify", ["gotest"], "Vitest, in Node"),
          s("gotest", "Run the Go tests", "go", "verify", ["e2e"], "a schema per test"),
          s("e2e", "Build the app, run the browser tests", "browser", "verify", ["green"], "Playwright, one worker"),
          s("green", "All passed?", "dev", "decision", [["done", "Yes"], ["run", "No: fix, run again"]]),
          s("done", "Report the change as done", "dev", "task", []),
        ]),
    },
    {
      caption: "How one Go test gets a database of its own (`dbtest.NewPool` in `server/internal/db/dbtest`): a fresh schema, the pool's `search_path` pointed at it, every migration run, the schema dropped in `t.Cleanup` also when the test fails.",
      process: flow("code-tests-dbtest", "A Go test gets its own database", "`dbtest.NewPool`, from the call to the cleanup.",
        [["test", "Go test"], ["pg", "Postgres"]],
        [
          s("call", "Ask for a pool", "test", "communication", ["reach"], "TEST_DATABASE_URL"),
          s("reach", "Database reachable?", "test", "decision", [["create", "Yes"], ["ci", "No"]]),
          s("ci", "Running in CI?", "test", "decision", [["fail", "Yes"], ["skip", "No"]]),
          s("fail", "Fail the test", "test", "task", []),
          s("skip", "Skip the test", "test", "task", [], "locally only"),
          s("create", "Create a schema, point the pool at it", "pg", "automation", ["work"], "t_<pid>_<n>"),
          s("work", "Migrate, then run the test", "test", "verify", ["drop"], "db.Migrate"),
          s("drop", "Drop the schema with everything", "pg", "automation", [], "t.Cleanup"),
        ]),
    },
    {
      caption: "How Playwright gets its server (`playwright.config.ts` → `scripts/e2e-server.mjs`): the same binary and the same start-up as a real installation, on a database emptied first. The script also starts the compose database when `PM_PG` is not set and builds the server.",
      process: flow("code-tests-e2e", "Start the browser tests' server", "From `npm run test:e2e` to the first test.",
        [["pw", "Playwright"], ["script", "e2e-server.mjs"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("start", "Start the web server command", "pw", "automation", ["dist"], "port 8090, pm_e2e"),
          s("dist", "dist/index.html there?", "script", "decision", [["build", "Yes"], ["stop", "No"]]),
          s("stop", "Stop: run npm run build first", "script", "communication", []),
          s("build", "Build the Go server", "script", "automation", ["wipe"]),
          s("wipe", "Empty the schema public", "pg", "automation", ["serve"], "psql"),
          s("serve", "Start and fill the empty database", "server", "automation", ["ready"], "sample files, builtin"),
          s("ready", "Wait for /healthz", "pw", "wait", ["tests"]),
          s("tests", "Run the specs one by one", "pw", "verify", [], "sign in by API"),
        ]),
    },
  ],
  examples: [
    {
      title: "One Go database test, as Postgres sees it",
      caption: "What `dbtest.NewPool` sends to Postgres for one test, and what is left afterwards: nothing.",
      stages: [
        {
          label: "A schema of its own",
          where: "server/internal/db/dbtest/dbtest.go",
          shape: "-- on a separate connection to TEST_DATABASE_URL\ncreate schema t_48211_7",
          note: "The name is the process id and a counter, so parallel tests and packages never meet.",
        },
        {
          label: "The pool lives in it",
          where: "server/internal/db/dbtest/dbtest.go",
          shape: "postgres://pm:pm@localhost:5432/pm_test?sslmode=disable\n  runtime parameter: search_path = t_48211_7",
          note: "Every table the code names without a schema is created and read in the test's schema.",
        },
        {
          label: "Migrated like a real database",
          where: "server/internal/db/db.go",
          shape: "db.Migrate(ctx, pool)\n-- every file of server/internal/db/migrations, in order",
          note: "`dbtest.NewEmptyPool` skips this step for tests of a very first start.",
        },
        {
          label: "Gone after the test",
          where: "server/internal/db/dbtest/dbtest.go",
          shape: "drop schema t_48211_7 cascade",
          note: "Registered with `t.Cleanup`, so it runs also when the test fails.",
        },
      ],
    },
  ],
  start: "package.json",
  files: [
    {
      path: "package.json",
      role: "The commands: `test`, `test:server`, `test:e2e`, and `test:all` that runs every level.",
      requirements: [
        { text: "`test:all` runs the type check, the sample check, Vitest, the Go tests and Playwright, in that order; `&&` stops at the first failure, so a later level never runs on a change an earlier one refused.", at: '"test:all": "npm run typecheck && npm run validate && npm test && npm run test:server && npm run test:e2e",' },
        { text: "The browser tests always run on a fresh build: without `npm run build` first they would test whatever `dist/` was left from earlier.", at: '"test:e2e": "npm run build && playwright test",' },
      ],
    },
    {
      path: ".github/workflows/ci.yml",
      role: "CI: every push to main and every pull request runs every level against Postgres 16 with pgvector.",
      requirements: [
        { text: "The same image as `docker-compose.yml` (Postgres 16 with pgvector), so the Go tests of search by meaning run in CI instead of failing for want of the extension.", at: "image: pgvector/pgvector:pg16" },
        { text: "The test databases and the `vector` extension come from the same file as for docker compose: a database added there reaches CI too.", at: 'run: psql "$PM_PG/pm_dev" -f docker/init-databases.sql' },
        { text: "Unformatted Go fails the run before any Go test.", at: 'test -z "$(gofmt -l .)" || (gofmt -l . && exit 1)' },
        { text: "The Go tests run with the race detector: a data race between a request and the background work after a save fails CI.", at: "run: npm run test:server -- -race ./..." },
        { text: "A known high-severity vulnerability in a runtime npm dependency fails the run; development tools (`--omit=dev`) do not.", at: "run: npm audit --omit=dev --audit-level=high" },
      ],
    },
    {
      path: "server/internal/db/dbtest/dbtest.go",
      role: "Gives each Go test a real, migrated Postgres schema of its own.",
      requirements: [
        { text: "Every database test runs on the tables of every migration, as a real start makes them: a broken migration fails every database test, not only its own.", at: "if err := db.Migrate(ctx, pool); err != nil {" },
        { text: "In CI an unreachable database fails the test: otherwise a CI run whose database service broke would be green with every database test skipped.", at: 'if os.Getenv("CI") != "" {' },
        { text: "Tables named without a schema land in the test's own schema, so parallel tests and packages never see each other's rows.", at: 'cfg.ConnConfig.RuntimeParams["search_path"] = schema' },
        { text: "The schema is dropped with everything in it in `t.Cleanup`, also when the test fails: the test database never fills up.", at: '_, _ = admin.Exec(context.Background(), "drop schema "+schema+" cascade")' },
      ],
      tests: ["server/internal/db/db_test.go"],
    },
    {
      path: "scripts/go-test.mjs",
      role: "`npm run test:server`: starts the compose database if needed and runs `go test` against `pm_test`.",
      requirements: [
        { text: "`TEST_DATABASE_URL`, when set, wins; otherwise the database `pm_test` on the compose Postgres or on `PM_PG`. Extra arguments replace `./...` (CI passes `-race ./...`).", at: 'TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? db("pm_test")' },
      ],
    },
    {
      path: "playwright.config.ts",
      role: "Playwright's settings: one worker, the browser tests' server, retries and reports in CI.",
      requirements: [
        { text: "One worker is a rule, not a speed setting: the specs count the sample and change shared content, so two at once would break each other's counts.", at: "workers: 1," },
        { text: "Playwright always starts its own server on 8090 with `pm_e2e` (`reuseExistingServer: false`), so a server a developer left running is never what the tests see.", at: 'webServer: { command: "node scripts/e2e-server.mjs 8090 pm_e2e"' },
        { text: "In CI a failed test is tried once more (with a trace) and `test.only` fails the run.", at: "retries: process.env.CI ? 1 : 0," },
      ],
    },
    {
      path: "scripts/e2e-server.mjs",
      role: "Starts the real Go server for the browser tests, on a database emptied first.",
      requirements: [
        { text: "Refuses to start without `dist/index.html`: the browser tests run against the built app served by the Go server, never against Vite; `npm run test:e2e` builds it first.", at: 'if (!fs.existsSync(path.join(root, "dist", "index.html"))) {' },
        { text: "Dropping the whole schema `public` rather than emptying tables means every run starts like a first installation, with the tables of every migration made fresh.", at: '"drop schema public cascade; create schema public;"' },
        { text: "`builtin` is set here after the environment is copied, so a developer's `PM_EMBEDDINGS=vertex` can never make the browser tests send text to Google.", at: 'PM_EMBEDDINGS: "builtin",' },
        { text: "The checkout must be a git checkout for Admin › Code map to show files in the browser tests: only tracked files are shown (`source.go`).", at: "PM_SOURCE_DIR: root," },
      ],
    },
    {
      path: "scripts/env.mjs",
      role: "Shared by the dev and test scripts: where the databases are, starting the compose database, building the server.",
      requirements: [
        { text: "With `PM_PG` set no script starts Docker, and `pm_dev`, `pm_test` and `pm_e2e` must already exist on that server (CI creates them with `docker/init-databases.sql`).", at: "export const usesCompose = !process.env.PM_PG;" },
        { text: "`npm run dev` and the browser tests build the server from the current code before starting it, so they never run an old binary.", at: "export function buildServer() {" },
      ],
    },
    {
      path: "vite.config.ts",
      role: "Vite's settings, and Vitest's: which files are unit tests and where they run.",
      requirements: [
        { text: "Unit tests are `src/**/*.test.ts`, run in Node: a unit test cannot use a browser page, so what needs one is a Playwright test.", at: 'test: { include: ["src/**/*.test.ts"], environment: "node" },' },
      ],
    },
    {
      path: "docker/init-databases.sql",
      role: "Creates the test databases `pm_test` and `pm_e2e` and the `vector` extension, once, for docker compose and CI.",
      requirements: [
        { text: "Runs only when the volume is created: a database added here reaches an existing local volume only after it is removed (`docker compose down -v`).", at: "create database pm_test owner pm;" },
      ],
    },
    {
      path: "src/codemap/__tests__/codemap.test.ts",
      role: "Keeps this map true: paths exist, anchors are in their files, every source file is in a category.",
      requirements: [
        { text: "A new source file fails this test until it is placed in a category.", at: 'it("every source file is in at least one category", () => {' },
      ],
    },
    {
      path: "server/internal/httpapi/api_test.go",
      role: "The harness of the server's HTTP tests: a server on a fresh database with the sample content and the development roles, and one client per person.",
      requirements: [
        { text: "Every HTTP test starts from the imported sample, the generated skills and the development roles, so a test may count them.", at: "func setup(t *testing.T, mutate func(*Deps)) *env {" },
        { text: "A client signs in through the development sign-in; `do` sends the `X-Requested-With` header, `raw` can leave it out to test the refusal.", at: "func (e *env) as(email string) *client {" },
      ],
    },
    {
      path: "server/internal/httpapi/source_test.go",
      role: "Tests `GET /api/admin/source` on real git checkouts made for the test: who may read, what is refused, and that every refusal is one identical 404.",
      requirements: [
        { text: "Files written after the `git add` are untracked: that is how an untracked `key.json` beside a tracked file is proved refused with the identical 404.", at: "func sourceCheckout(t *testing.T) (string, string) {" },
        { text: "Skipped with a message where git is not installed: the source is listed with git, so these tests cannot run without it.", at: "func needGit(t *testing.T) {" },
        { text: "git runs here with an identity and without the developer's own configuration, so the checkout is the same on every machine.", at: "func gitIn(t *testing.T, dir string, args ...string) {" },
      ],
    },
    {
      path: "server/internal/httpapi/source_linux_test.go",
      role: "The tests of the source endpoint that need Linux: a FIFO with an allowed name, and names swapped while files are read.",
      requirements: [
        { text: "The swap uses `renameat2` with the numbers of amd64 and arm64; on another platform the test is skipped, not passed.", at: "func exchange(a, b string) error {" },
        { text: "A FIFO must be refused within 5 seconds; if the request hangs, the test opens the FIFO for writing so the test server can still be closed.", at: "func TestSourceFIFOIsRefusedAtOnce(t *testing.T) {" },
        { text: "400 reads of each swapped path must never return the text of `.env` or of the folder outside: removing `SameFile`, or both `os.OpenRoot` and `root.Lstat`, makes it fail.", at: "func TestSourceSwapsNeverLeadToAnotherFile(t *testing.T) {" },
      ],
    },
    {
      path: "server/internal/httpapi/skills_draft_test.go",
      role: "Tests that the skills and the feedback of a document taken back to draft do not exist for whoever may not see it.",
      requirements: [
        { text: "For a reader every skill route answers byte for byte as for an id never used, the list leaves the skill out, and no download is counted; the editor still has it.", at: "func TestASkillOfAProcessTakenBackToDraftDoesNotExistForReaders(t *testing.T) {" },
        { text: "Marking fixed, deleting and \"I hit this too\" on feedback of such a draft answer as for feedback that does not exist, also to its author.", at: "func TestFeedbackOnADraftDoesNotExistForWhoCannotSeeIt(t *testing.T) {" },
      ],
    },
    {
      path: "server/internal/embedding/embedding_test.go",
      role: "Tests the embedding providers; Vertex AI only against a local stand-in.",
      requirements: [
        { text: "The Vertex AI client is pointed at an `httptest` server through `Endpoint` and a static token: no test reaches Google or needs credentials.", at: "func newStandIn(t *testing.T, token string) (*standIn, *vertex) {" },
      ],
    },
    {
      path: "e2e/helpers.ts",
      role: "Shared by the browser tests: the development users and their roles, signing in through the API, opening the editor, saving and publishing.",
      requirements: [
        { text: "Roles are read from the database on every request (`signedIn` in `api.go`), so a role given during a test takes effect without signing in again.", at: "export async function signIn(page: Page, email: string) {" },
        { text: "The users are those of `server/internal/auth/dev.go`; a comment says what each may do.", at: 'export const DANA = "dana@example.com"; // admin' },
      ],
    },
    spec("admin.spec.ts", "The Admin panel: who reaches which section, giving a role that takes effect at once, explained mistakes, Health and System."),
    spec("ai.spec.ts", "Creating and changing a process from text with any chat assistant; a draft stays invisible to readers until published."),
    spec("auth.spec.ts", "Signing in and out: the app is closed until sign-in, switching user, a session that survives a reload, and the server refusing changes without the right."),
    spec("browse.spec.ts", "Home, the two lists and the results: how processes and standards differ, the filters for an application, counts, order, page size and the pager."),
    spec("cards.spec.ts", "The shared list layout and its cards: filter dropdowns with the keyboard, the lines of a card, bookmark and upvote from a card, the phone layout."),
    spec("catalog.spec.ts", "Admin › Lists for a lists manager: adding a tool, an entry in use that cannot be removed, discard, adding a tool from a step."),
    spec("codemap.spec.ts", "Admin › Code map: who gets it, the server's refusals for a source file, the overview and its search, a category, a file with its comments in place, what is said when a file cannot be shown."),
    spec("consumer.spec.ts", "A reader finds a process, reads the map with their lane first, follows the checklist, opens sub-processes and prerequisites."),
    spec("days.spec.ts", "The reader's day in Los Angeles, Auckland and at UTC+14: Home's today and yesterday, the day a save is stamped with, Mark as reviewed, due on the due day, plain dates as written."),
    spec("editing.spec.ts", "The editing screen and its drafts: unpublished changes only editors see, publishing, discarding, a new draft, retire, unpublish and delete."),
    spec("editor.spec.ts", "Changing a process on the editing screen: inserting and dragging steps on the map, moving them in the outline, the checker, About."),
    spec("editscreen.spec.ts", "The editing screen part by part: adding steps by name, moving them in the flow, decisions, delete with Undo, participants, the keyboard."),
    spec("engage.spec.ts", "Views, upvotes, bookmarks, sharing and skill downloads: counted once per person and day, never shown for what a person may not see."),
    spec("feedback.spec.ts", "Feedback: flagging a step, reporting on a whole process, \"I hit this too\", who may mark it fixed or delete it."),
    spec("finding.spec.ts", "Home's shelves and Browse, the search head (Words, Meaning, Both), Cards and Rows, and what is found and what is not."),
    spec("frame.spec.ts", "The frame: the Guide on a phone, a long portal name, the Menu's count, the account menu, Statistics' table, what is said when the server cannot be reached."),
    spec("groups.spec.ts", "The page of a platform, a practice and a team: contacts, people, what belongs to it, edits by an owner, a draft only for those who may see it."),
    spec("icons.spec.ts", "Icons of tools and languages: uploading a PNG and an SVG, refusals as the server words them, safe headers when served."),
    spec("layout.spec.ts", "Phone, tablet and small laptop: no page scrolls sideways, the top bar fits, a step opens as a panel that works with the keyboard."),
    spec("lists.spec.ts", "Categories, practices and platforms as lists: adding and removing them, owners and members, My responsibilities, About on the editing screen; problems of the lists in words that lead to their field."),
    spec("map.spec.ts", "The reader's map: Before you start, the hint, decisions as diamonds, dragging, the flag on a step, the keyboard."),
    spec("meaning.spec.ts", "Search by meaning: the Words / Meaning / Both switch, what it says about the provider, the address, ranking, and the limit of 60 searches a minute."),
    spec("members.spec.ts", "Members of a platform or practice draft there and an owner publishes; Admin › Access gives and takes the member roles; contact fields."),
    spec("mine.spec.ts", "My responsibilities: what is an owner's and what needs them, a refused review after a change, owners of a team set by admins only."),
    spec("alert.spec.ts", "The designer's alert: the measured instance (335 wide, 100 high, every position, radius, type and colour), each state in light and dark, a real notice of each kind on its page, an alert on a phone."),
    spec("pages.spec.ts", "The reader's page of a process and a standard: the head, levels as neutral marks, the first review counted from the first publication."),
    spec("paging.spec.ts", "Pages of a list and of the search results: 12 a page, the address, Back and reload, the phone layout, search by meaning in pages."),
    spec("tribes.spec.ts", "Tribes and domains: made in Admin › Lists, a team put in a tribe and a tribe in a domain, Teams & tools grouping the teams under them, the team's page saying where it belongs, a used tribe or domain that cannot be removed (also by the server, in words), the owning team chosen by tribe, and with none everything as before."),
    spec("patterns.spec.ts", "The architecture patterns: the list in Admin › Lists with other names and a used entry that cannot be removed, tagging a process on the editing screen, the fact in the head, the Architecture pattern filter in the address (an unknown one dropped), the search by other names, and nothing about patterns with an empty list."),
    spec("paths.spec.ts", "The path of a process or standard: the list with its pictures and other names, the editing screen's choice, the road on the reader's page, plates on cards and rows, the Path filter and My application, a draft's paths kept hidden."),
    spec("pictures.spec.ts", "The Guide's and the code map's flow charts as one picture: the opening rule, dragging, the zoom tools, Ctrl + scroll, Enlarge, the keyboard, printing, touch, jumps that still land."),
    spec("platforms.spec.ts", "A platform and practice owner edits what belongs to them and nothing else; the server is asked directly to prove each refusal."),
    spec("requests.spec.ts", "Requests for new processes and standards: asking, votes, who may plan, finish or decline them, withdrawing, the filters in the address."),
    spec("savemodel.spec.ts", "The save model of a never-published draft: two people or two tabs, Discard, the first publication, a delete by somebody else."),
    spec("search.spec.ts", "The word search: Home's box, results that mix processes and standards, filters and their counts, the address, opening at a step."),
    spec("skills.spec.ts", "Skills and review agents: everyone reads and downloads, publishing gives a new version and a saved draft does not, extra guidance survives."),
    spec("standards.spec.ts", "Standards: finding them, reading a requirement, links to processes, feedback on a requirement, a practice owner's edits, new skill versions."),
    spec("statistics.spec.ts", "Admin › Statistics: admins only, the numbers of a process over a period, the trend's text alternative, deleted documents, the CSV."),
    spec("theming.spec.ts", "Admin › Theming: name, logo, colours and dark mode for everyone; warnings, an outdated save, the default look restored."),
    spec("unnamed.spec.ts", "Items without a name never break the editing screen: Undo names them by their place, the checker lists them."),
    spec("users.spec.ts", "Admin › Access: people with their roles in words, one dialog for all of a person's roles, Delete, the protections kept by the server."),
    spec("versions.spec.ts", "Versions: every publish with a note and what changed, a conflict on a never-published draft, leaving with unsaved changes, Undo, links to a step."),
    spec("viewas.spec.ts", "Viewing the portal as somebody else: from Admin › Access and the picker, the band, the person's view and refusals, greyed controls, the editing screen closed, changes refused, nothing counted, Activity, other tabs."),
  ],
};
