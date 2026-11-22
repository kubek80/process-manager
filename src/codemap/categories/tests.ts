import { flow, s } from "../chart";
import type { CodeCategory, CodeFile } from "../types";

/** One browser test file: what it covers, in one sentence. */
const spec = (name: string, role: string): CodeFile => ({ path: `e2e/${name}`, role, requirements: [] });

export const tests: CodeCategory = {
  id: "tests",
  area: "around",
  title: "Tests and CI",
  summary:
    "Three levels of tests: Vitest for the app's logic in Node, Go tests for the server against a real Postgres (each test in a schema of its own), and Playwright for the whole portal: the built app served by the real Go server on a database refilled from the repository's sample files. `npm run test:all` runs them in order, after the type check and the check of the sample files; CI runs the same steps on every push to main and every pull request.",
  requirements: [
    "`npm run test:all` runs, in this order and stopping at the first failure: `tsc --noEmit`, the check of the sample files, Vitest, the Go tests, then Playwright (after `npm run build`).",
    "Vitest runs only `src/**/*.test.ts`, in a Node environment without a browser page.",
    "Every Go test that needs the database gets a schema of its own (`t_<pid>_<n>`), migrated with `db.Migrate`, and drops it at the end, so tests can run in parallel and leave nothing behind.",
    "Without a reachable test database a Go database test is skipped on a developer's machine but fails when `CI` is set, so a green CI run always includes the database tests.",
    "The browser tests run one at a time (`workers: 1`) against one server on port 8090 and the database `pm_e2e`, which is emptied (`drop schema public cascade`) and refilled from the sample files at every start.",
    "The browser tests' server is the real Go binary serving `dist/`, with development sign-in, built-in embeddings and `PM_SOURCE_DIR` set; it refuses to start without `dist/index.html`.",
    "Nothing in tests or CI calls an outside service: the browser tests use the built-in embedder, and Vertex AI is tested only against a local stand-in (`httptest`) in `embedding_test.go`.",
    "A browser test that changes shared content works on a copy of its own or puts the content back, also when it fails: other tests count the sample (7 processes, 3 standards).",
    "A refusal is proved at the server, not only by a hidden control: the browser tests also call the API directly as a person without the right and expect 401, 403 or 404.",
    "CI fails on unformatted Go (`gofmt -l`), on `go vet`, on a data race (`-race`) and on a known high-severity vulnerability in a runtime npm dependency; a failed run keeps the Playwright report.",
  ],
  charts: [
    {
      caption: "What `npm run test:all` does, level by level. CI runs the same steps (plus formatting, vet and npm audit) in `.github/workflows/ci.yml`.",
      process: flow("code-tests-levels", "From a change to a green run", "The levels of tests, cheapest first.",
        [["dev", "Developer"], ["node", "Node"], ["go", "Go tests"], ["pg", "Postgres"], ["browser", "Browser"]],
        [
          s("run", "Run npm run test:all", "dev", "task", ["types"], "or push: CI"),
          s("types", "Check the types", "node", "verify", ["validate"], "tsc --noEmit"),
          s("validate", "Check the sample files", "node", "verify", ["vitest"], "processes, standards, catalog"),
          s("vitest", "Run the unit tests", "node", "automation", ["gotest"], "Vitest, src/**/*.test.ts"),
          s("gotest", "Run the Go tests", "go", "automation", ["schema"], "go test ./..."),
          s("schema", "Give each test its own schema", "pg", "automation", ["build"], "dbtest.NewPool"),
          s("build", "Build the app into dist/", "node", "automation", ["e2e"], "npm run build"),
          s("e2e", "Run the browser tests", "browser", "verify", ["green"], "Playwright, one worker"),
          s("green", "All passed?", "dev", "decision", [["done", "Yes"], ["fix", "No"]]),
          s("fix", "Fix and run again", "dev", "task", ["run"]),
          s("done", "Report the change as done", "dev", "task", []),
        ]),
    },
    {
      caption: "How one Go test gets a database of its own (`server/internal/db/dbtest`). Every test that calls `dbtest.NewPool` gets a fresh, migrated schema.",
      process: flow("code-tests-dbtest", "A Go test gets its own database", "dbtest.NewPool, from the call to the cleanup.",
        [["test", "Go test"], ["pg", "Postgres"]],
        [
          s("call", "Call dbtest.NewPool", "test", "code", ["reach"], "TEST_DATABASE_URL"),
          s("reach", "Database reachable?", "test", "decision", [["create", "Yes"], ["ci", "No"]]),
          s("ci", "Running in CI?", "test", "decision", [["fail", "Yes"], ["skip", "No"]]),
          s("fail", "Fail the test", "test", "task", []),
          s("skip", "Skip the test", "test", "task", [], "locally only"),
          s("create", "Create schema t_<pid>_<n>", "pg", "automation", ["path"]),
          s("path", "Point the pool's search_path at it", "test", "code", ["migrate"]),
          s("migrate", "Run every migration", "pg", "automation", ["work"], "db.Migrate"),
          s("work", "Run the test", "test", "verify", ["drop"]),
          s("drop", "Drop the schema with everything", "pg", "automation", [], "t.Cleanup"),
        ]),
    },
    {
      caption: "How Playwright gets its server (`playwright.config.ts` → `scripts/e2e-server.mjs`): the same binary and the same start-up as a real installation, on a database emptied first.",
      process: flow("code-tests-e2e", "Start the browser tests' server", "From `npm run test:e2e` to the first test.",
        [["pw", "Playwright"], ["script", "e2e-server.mjs"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("start", "Start the web server command", "pw", "automation", ["dist"], "port 8090, pm_e2e"),
          s("dist", "dist/index.html there?", "script", "decision", [["db", "Yes"], ["stop", "No"]]),
          s("stop", "Stop: run npm run build first", "script", "communication", []),
          s("db", "Start the database if needed", "script", "automation", ["build"], "docker compose or PM_PG"),
          s("build", "Build the Go server", "script", "code", ["wipe"]),
          s("wipe", "Empty the schema public", "pg", "automation", ["serve"], "psql"),
          s("serve", "Start the server", "server", "automation", ["fill"], "dev sign-in, builtin"),
          s("fill", "Fill the empty database", "pg", "automation", ["ready"], "sample files"),
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
          note: "dbtest.NewEmptyPool skips this step for tests of a very first start.",
        },
        {
          label: "Gone after the test",
          where: "server/internal/db/dbtest/dbtest.go",
          shape: "drop schema t_48211_7 cascade",
          note: "Registered with t.Cleanup, so it runs also when the test fails.",
        },
      ],
    },
  ],
  start: "package.json",
  files: [
    {
      path: "package.json",
      role: "The commands: `test`, `test:server`, `test:e2e` and `test:all` that runs every level.",
      requirements: [
        { text: "test:all runs the type check, the sample check, Vitest, the Go tests and Playwright, in that order; `&&` stops at the first failure.", at: '"test:all": "npm run typecheck && npm run validate && npm test && npm run test:server && npm run test:e2e",' },
        { text: "The browser tests always run on a fresh build of the app.", at: '"test:e2e": "npm run build && playwright test",' },
      ],
    },
    {
      path: ".github/workflows/ci.yml",
      role: "CI: every push to main and every pull request runs every level against Postgres 16 with pgvector.",
      requirements: [
        { text: "The database is the same image as in local development (Postgres 16 with pgvector), so the tests of search by meaning run in CI too.", at: "image: pgvector/pgvector:pg16" },
        { text: "The test databases and the vector extension are created from the same file as for docker compose.", at: 'run: psql "$PM_PG/pm_dev" -f docker/init-databases.sql' },
        { text: "Unformatted Go fails the run before any Go test.", at: 'test -z "$(gofmt -l .)" || (gofmt -l . && exit 1)' },
        { text: "The Go tests run with the race detector.", at: "run: npm run test:server -- -race ./..." },
        { text: "A known high-severity vulnerability in a runtime npm dependency fails the run.", at: "run: npm audit --omit=dev --audit-level=high" },
      ],
    },
    {
      path: "server/internal/db/dbtest/dbtest.go",
      role: "Gives each Go test a real, migrated Postgres schema of its own.",
      requirements: [
        { text: "Each call makes a new schema, migrates it and drops it at the end of the test.", at: "func NewPool(t testing.TB) *pgxpool.Pool {" },
        { text: "Without a database the test is skipped locally and fails in CI.", at: 'if os.Getenv("CI") != "" {' },
        { text: "The pool reaches only the test's schema, through search_path.", at: 'cfg.ConnConfig.RuntimeParams["search_path"] = schema' },
      ],
      tests: ["server/internal/db/db_test.go"],
    },
    {
      path: "scripts/go-test.mjs",
      role: "`npm run test:server`: starts the compose database if needed and runs `go test` against `pm_test`.",
      requirements: [
        { text: "TEST_DATABASE_URL, when set, wins; otherwise the database pm_test on the compose Postgres or on PM_PG.", at: 'TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? db("pm_test")' },
      ],
    },
    {
      path: "playwright.config.ts",
      role: "Playwright's settings: one worker, the browser tests' server, retries and reports in CI.",
      requirements: [
        { text: "Tests share one server and one database, so they run one after another.", at: "workers: 1," },
        { text: "Playwright starts its own server on port 8090 with the database pm_e2e and never reuses one that is running.", at: 'webServer: { command: "node scripts/e2e-server.mjs 8090 pm_e2e"' },
        { text: "In CI a failed test is tried once more and `test.only` fails the run.", at: "retries: process.env.CI ? 1 : 0," },
      ],
    },
    {
      path: "scripts/e2e-server.mjs",
      role: "Starts the real Go server for the browser tests, on a database emptied first.",
      requirements: [
        { text: "Refuses to start without a built app: the tests run against dist/, not Vite.", at: 'if (!fs.existsSync(path.join(root, "dist", "index.html"))) {' },
        { text: "Empties the database completely, so every run starts from the sample files.", at: '"drop schema public cascade; create schema public;"' },
        { text: "Search by meaning uses the built-in embedder: no outside service.", at: 'PM_EMBEDDINGS: "builtin",' },
        { text: "Sets PM_SOURCE_DIR, so Admin › Code map can show files in the browser tests.", at: "PM_SOURCE_DIR: root," },
      ],
    },
    {
      path: "scripts/env.mjs",
      role: "Shared by the dev and test scripts: where the databases are, starting the compose database, building the server.",
      requirements: [
        { text: "PM_PG points every script at another Postgres; without it docker compose is started.", at: "export const usesCompose = !process.env.PM_PG;" },
        { text: "The server binary is built with -trimpath into server/.bin/.", at: "export function buildServer() {" },
      ],
    },
    {
      path: "vite.config.ts",
      role: "Vite's settings, and Vitest's: which files are unit tests and where they run.",
      requirements: [
        { text: "Unit tests are src/**/*.test.ts, run in Node (no browser page).", at: 'test: { include: ["src/**/*.test.ts"], environment: "node" },' },
      ],
    },
    {
      path: "docker/init-databases.sql",
      role: "Creates the test databases pm_test and pm_e2e and the vector extension, once, for docker compose and CI.",
      requirements: [
        { text: "The Go tests use pm_test, the browser tests pm_e2e, development pm_dev.", at: "create database pm_test owner pm;" },
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
        { text: "Every HTTP test starts from the imported sample, the generated skills and the development roles.", at: "func setup(t *testing.T, mutate func(*Deps)) *env {" },
        { text: "A client signs in through the development sign-in; `do` sends the X-Requested-With header.", at: "func (e *env) as(email string) *client {" },
      ],
    },
    {
      path: "server/internal/embedding/embedding_test.go",
      role: "Tests the embedding providers; Vertex AI only against a local stand-in.",
      requirements: [
        { text: "The Vertex AI client is pointed at an httptest server: no test reaches Google.", at: "func newStandIn(t *testing.T, token string) (*standIn, *vertex) {" },
      ],
    },
    {
      path: "e2e/helpers.ts",
      role: "Shared by the browser tests: the development users and their roles, signing in through the API, opening the editor, saving and publishing.",
      requirements: [
        { text: "Signs in through /auth/dev/login with the X-Requested-With header; the sign-in screen itself is tested in auth.spec.ts.", at: "export async function signIn(page: Page, email: string) {" },
        { text: "The users are those of server/internal/auth/dev.go; a comment says what each may do.", at: 'export const DANA = "dana@example.com"; // admin' },
      ],
    },
    spec("admin.spec.ts", "The Admin panel: who reaches which section, giving a role that takes effect at once, explained mistakes, Health and System."),
    spec("ai.spec.ts", "Creating and changing a process from text with any chat assistant; a draft stays invisible to readers until published."),
    spec("auth.spec.ts", "Signing in and out: the app is closed until sign-in, switching user, a session that survives a reload, and the server refusing changes without the right."),
    spec("browse.spec.ts", "Home, the two lists and the results: how processes and standards differ, the filters for an application, counts, order, page size and the pager."),
    spec("cards.spec.ts", "The shared list layout and its cards: filter dropdowns with the keyboard, the lines of a card, bookmark and upvote from a card, the phone layout."),
    spec("catalog.spec.ts", "Admin › Lists for a lists manager: adding a tool, an entry in use that cannot be removed, discard, adding a tool from a step."),
    spec("consumer.spec.ts", "A reader finds a process, reads the map with their lane first, follows the checklist, opens sub-processes and prerequisites."),
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
    spec("lists.spec.ts", "Categories, practices and platforms as lists: adding and removing them, owners and members, My responsibilities, About on the editing screen."),
    spec("map.spec.ts", "The reader's map: Before you start, the hint, decisions as diamonds, dragging, the flag on a step, the keyboard."),
    spec("meaning.spec.ts", "Search by meaning: the Words / Meaning / Both switch, what it says about the provider, the address, ranking, and the limit of 60 searches a minute."),
    spec("members.spec.ts", "Members of a platform or practice draft there and an owner publishes; Admin › Access gives and takes the member roles; contact fields."),
    spec("mine.spec.ts", "My responsibilities: what is an owner's and what needs them, a refused review after a change, owners of a team set by admins only."),
    spec("pages.spec.ts", "The reader's page of a process and a standard: the head, levels as neutral marks, the first review counted from the first publication."),
    spec("paging.spec.ts", "Pages of a list and of the search results: 12 a page, the address, Back and reload, the phone layout, search by meaning in pages."),
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
  ],
};
