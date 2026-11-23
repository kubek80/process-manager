import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// This page: Admin › Code map itself - where its words live, how a test keeps them true to the
// code, and how a file's text reaches the browser (only from a git checkout, only for admins).

export const codemap: CodeCategory = {
  id: "codemap",
  area: "around",
  title: "The code map itself",
  summary:
    "Admin › Code map sorts the portal's own source into categories, each saying what its part must do and showing the lines that do it. " +
    "The words are TypeScript data in `src/codemap`, kept true to the code by a unit test. The files themselves come from the server one at a time, to admins only, and only where the portal runs beside a git checkout of its source (`PM_SOURCE_DIR`).",
  requirements: [
    "A path the map names that does not exist, an anchor (`at`) that is in no line of its file, a chart step that leads nowhere, or a source file that is in no category fails `src/codemap/__tests__/codemap.test.ts`: the map cannot fall behind the code without a red test.",
    "The source is never part of the app bundle: the page asks `GET /api/admin/source?path=…` for one file at a time, and the map's own data is a chunk loaded only when the section is opened.",
    "Only admins read a file: `admin(…)` in `api.go` answers 403 to anybody else. The app only hides the section from them.",
    "Only a file that git tracks in the checkout can be read (`git ls-files`, listed again when git's index changes): a new file that is not added yet, and anything ignored, such as `.env` or build output, answers the 404.",
    "Every refusal of a path is the same 404 (\"That file cannot be shown.\"), whether the name is not allowed, the file is not tracked, missing or not a regular UTF-8 file of at most 400 KB, so that nothing about the folder can be probed.",
    "One person may open at most 300 files a minute; more answers 429 with `Retry-After`. Reading a file is not written to Activity.",
    "Without `PM_SOURCE_DIR` (or with a folder that is no git checkout) `/api/admin/system` says `\"source\": false` and every path is a 404; the page then says that files cannot be opened here and keeps paths, requirements, charts and tables.",
    "A requirement with an anchor is shown above the FIRST line that contains its text; one whose anchor is in no line is listed as not placed, never dropped.",
    "The address names the place a page opens at (`?at=req-2`, `?at=table-documents`), so a search hit and the browser's Back land on the sentence, the table or the line they point at.",
  ],
  charts: [
    {
      process: flow(
        "code-codemap-open-file",
        "Opening a file",
        "What happens between a click on a file in the code map and its text with the comments in place.",
        [["browser", "Browser"], ["server", "Server"], ["fs", "File system"]],
        [
          s("open", "Open a file of a category", "browser", "task", ["ask"], "#/admin/code/{category}/file/{path}"),
          s("ask", "Ask the server for that one file", "browser", "communication", ["allowed"], "GET /api/admin/source"),
          s("allowed", "Allowed name, tracked by git?", "server", "decision", [["read", "Yes"], ["refuse", "No"]]),
          s("read", "Open it inside the checkout", "fs", "automation", ["checked"], "os.OpenRoot"),
          s("checked", "Regular, at most 400 KB, UTF-8?", "server", "decision", [["send", "Yes"], ["refuse", "No"]]),
          s("refuse", "Answer the one identical 404", "server", "communication", []),
          s("send", "Send path, text and bytes", "server", "communication", ["place"], "Cache-Control: no-store"),
          s("place", "Place comments above their lines", "browser", "automation", [], "placeComments"),
        ],
      ),
      caption:
        "Before asking, the browser reads `\"source\"` from `/api/admin/system` once: with `false` it asks for nothing and says that files cannot be opened here. A 404 for one file while the portal shows source means that file is not tracked by git or not a text file it may show. Admins only (403 otherwise), at most 300 files a minute (429).",
    },
    {
      process: flow(
        "code-codemap-kept-true",
        "Keeping the map true",
        "How the unit test makes a change to the code show up in the map.",
        [["dev", "Developer"], ["vitest", "Vitest"]],
        [
          s("change", "Add, move or rename a source file", "dev", "task", ["run"]),
          s("run", "Run the code map's test", "dev", "automation", ["placed"], "npx vitest run src/codemap"),
          s("placed", "Is every source file in a category?", "vitest", "decision", [["paths", "Yes"], ["place", "No"]]),
          s("place", "Put the file into a category", "dev", "document", ["run"], "src/codemap/categories"),
          s("paths", "Do all paths and anchors exist?", "vitest", "decision", [["pass", "Yes"], ["fix", "No"]]),
          s("fix", "Fix the path or the anchor's text", "dev", "document", ["run"]),
          s("pass", "Pass", "vitest", "verify", []),
        ],
      ),
      caption:
        "The test walks `server` (Go without `_test.go`, and SQL), `src` (without `__tests__`, the generated validators and the category files themselves), `scripts`, `schema`, `e2e` (its tests included), `deploy` and `.github/workflows`, plus a few files at the root (`Dockerfile`, `package.json`, …), and names each one that is missing. It cannot tell whether a sentence is still true: a reviewer reads each requirement against the line it is shown above.",
    },
  ],
  files: [
    {
      path: "src/codemap/__tests__/codemap.test.ts",
      role: "Keeps the map true: only paths that exist, anchors that are in their files, charts that hold together, and no source file left out.",
      requirements: [
        { text: "A source file added without a place in a category fails here, by its path: without this the map would quietly describe less and less of the code.", at: "it(\"every source file is in at least one category\"" },
        { text: "An anchor must be one line of text, not blank, and in its file; an anchor that is in no line would only be shown as \"not placed\" and the reviewer would miss its line.", at: "it(\"anchors every placed comment to text that is in its file\"" },
        { text: "Chart ids start with `code-` and are unique over the whole map (they are the `?at=chart-…` places); every step's lane and way out exist, or the map would draw a broken chart.", at: "it(\"draws charts that hold together\"" },
        { text: "A category id is lower case, digits and hyphens: it is a part of the address `#/admin/code/{id}`.", at: "expect(c.id, c.id).toMatch(/^[a-z0-9-]+$/);" },
      ],
    },
    {
      path: "src/codemap/types.ts",
      role: "The format of the map: categories, files, requirements with their anchors, tables, examples and charts.",
      requirements: [
        { text: "The format is shared by the 20 category files and the test: a change here is a change to all of them, made together.", at: "export type CodeCategory = {" },
      ],
      tests: ["src/codemap/__tests__/codemap.test.ts"],
    },
    {
      path: "src/codemap/index.ts",
      role: "The areas with their names and every category in the order it is shown.",
      requirements: [
        { text: "A category that is not added to `CATEGORIES` is shown nowhere and its files count as left out by the test.", at: "export const CATEGORIES: CodeCategory[]" },
      ],
      tests: ["src/codemap/__tests__/codemap.test.ts"],
    },
    {
      path: "src/codemap/chart.ts",
      role: "`flow` and `s`: a chart of the map is an ordinary process, drawn by the same map as the Guide's.",
      requirements: [
        { text: "The note under a step's title travels in the step's `duration`, which the map shows under the title; a chart is never stored or validated as a real process.", at: "id, title, actor, type, ...(note ? { duration: note } : {})," },
      ],
    },
    {
      path: "src/components/CodeMapPage.tsx",
      role: "The page: the overview with its search and the first hour, a category with its parts, a file with its text and comments.",
      requirements: [
        { text: "Follows the address itself (the app passes only the section): `#/admin/code`, `#/admin/code/{category}`, `#/admin/code/{category}/file/{path}`, each with `?at=` for the place it opens at.", at: "function useCodeView(): CodeView {" },
        { text: "An unknown category, or a file that is in the category neither as a file nor as a test one of its files names, is a plain \"not found\" with a way back, never an empty page.", at: "title=\"Not in the code map\"" },
        { text: "Opening a category or a file without a place starts at the top with the focus on its heading; with one, it lands there (a file's place only once its text is drawn).", at: "heading.current?.focus({ preventScroll: true });" },
        { text: "Tells the two cases apart: `source: false` (\"shown only where the portal runs beside its source code\") and a 404 for one file while source is shown (\"not tracked by git yet, or not a text file\").", at: "if (e instanceof ApiError && e.status === 404) return { state: shows ? \"missing\" : \"off\" } as Source;" },
        { text: "Before following a link out of a block of a category, the block is put into the current address (`keepPlace`), so that the browser's Back returns to it and not to the top of a long page.", at: "if (a && block?.dataset.at) keepPlace({ category: c.id, at: block.dataset.at });" },
        { text: "The text is drawn as one row per line with no library and no highlighting; a file of 3,000 lines draws in well under a second.", at: "const SourceText = memo(" },
        { text: "A chart is a `ProcessPicture` like the Guide's: whole where that is 70% or more, else 80% and cut; dragging, zoom tools with Fit showing it whole, Enlarge, printing whole. Its title is above and its place in the address (`?at=chart-…`); the page has no chart code of its own.", at: "return <ProcessPicture className=\"cm-chart\"" },
      ],
      tests: ["src/lib/__tests__/codemap.test.ts"],
    },
    {
      path: "src/lib/codemap.ts",
      role: "The page's logic: comments on lines, places in the address, where else a file is, the search over the map, counts, the files before and after.",
      requirements: [
        { text: "A requirement goes above the first line that contains its anchor; one without an anchor, or whose anchor is in no line, is listed at the top - the second marked as not placed.", at: "const i = lines.findIndex((l) => l.includes(r.at!));" },
        { text: "The search needs every word of the query in one place (a category's title and summary, a path with its role, a requirement, a table, a chart, an example); case and accents do not matter.", at: "const hasAll = (text: string, words: string[])" },
        { text: "A test opens in the category of the file that names it, with no requirements of its own; a path that no category names stays plain text.", at: "export function fileHome(" },
        { text: "Only the places it knows become an element id: anything else in `?at=` is ignored and the page opens at its top.", at: "const m = at.match(/^(must|table|file|chart|example|req)-(.+)$/);" },
      ],
      tests: ["src/lib/__tests__/codemap.test.ts"],
    },
    {
      path: "src/codemap.css",
      role: "The look of the page: requirements as review comments, the source box, the reading bar, the Admin menu as a row on this section.",
      requirements: [
        { text: "The page never scrolls sideways: the code, the columns of a table, an example's data and a wide chart scroll inside their own box.", at: ".cm-code { overflow-x: auto;" },
        { text: "Below 1500 px the Admin menu is a row above the section, so the code gets the width beside the category list.", at: ".admin.cm-admin { grid-template-columns: minmax(0, 1fr); gap: 12px; }" },
      ],
    },
    {
      path: "src/lib/store.ts",
      role: "The code map's addresses (`CodeView`) and the call that reads one file (`loadSource`).",
      requirements: [
        { text: "Each part of a file's path is encoded on its own and the slashes stay, so that the address reads like the path; `?at=` is written only on a category or a file, `?q=` only on the overview.", at: "function codeHref(v: CodeView): string {" },
        { text: "An unknown category or file is kept in the route, so that the page can say it is not there instead of showing the overview.", at: "function parseCode(" },
      ],
      tests: ["src/lib/__tests__/routes.test.ts"],
    },
    {
      path: "src/components/AdminPage.tsx",
      role: "Adds the section \"Code map\" to Admin and loads its page only when it is opened.",
      requirements: [
        { text: "Listed for admins only (`admin: true`); that only hides it - the server refuses everybody else.", at: "{ id: \"code\", label: \"Code map\"" },
      ],
    },
    {
      path: "server/internal/httpapi/source.go",
      role: "`GET /api/admin/source`: one file of the git checkout named by `PM_SOURCE_DIR`, through an allow-list.",
      requirements: [
        { text: "A path is read only when its name passes the allow-list AND git tracks it: an untracked file (a key someone dropped into the folder, build output) can never be sent.", at: "if v.root == \"\" || !allowedSourcePath(p) || !v.tracked[p] {" },
        { text: "Where a symbolic link leads must pass the same two checks, and the file is opened through `os.OpenRoot` of the checkout, so a folder swapped for a link in between cannot lead outside it.", at: "dir, err := os.OpenRoot(v.root)" },
        { text: "Over 400 KB, not UTF-8 or with a NUL byte: the same 404 as every other refusal.", at: "if err != nil || len(data) > maxSourceBytes || !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {" },
        { text: "git runs with fixed arguments, without the system's or the user's configuration and with `core.fsmonitor` off, so nothing in the checkout can make it run a program.", at: "var gitArgs = []string{" },
        { text: "More than 300 files a minute for one person answers 429 with `Retry-After`: a brake on a script that copies the source.", at: "if !a.sourceReads.allow(email, time.Now()) {" },
      ],
      tests: ["server/internal/httpapi/source_test.go"],
    },
    {
      path: "server/internal/httpapi/api.go",
      role: "Registers `GET /api/admin/source` behind the admin check.",
      requirements: [
        { text: "Behind `admin(…)`: a reader, an editor or an owner gets 403 before anything is looked up.", at: "mux.Handle(\"GET /api/admin/source\", admin(a.source))" },
      ],
      tests: ["server/internal/httpapi/source_test.go"],
    },
    {
      path: "server/internal/httpapi/admin.go",
      role: "`/api/admin/system` says whether this installation can show its source.",
      requirements: [
        { text: "`\"source\"` is true only when the folder is set, exists and git can list its files: the page asks for no file otherwise.", at: "\"source\": a.sourceShown(ctx)," },
      ],
    },
    {
      path: "server/internal/config/config.go",
      role: "Reads `PM_SOURCE_DIR`: empty by default, which means the portal shows no source.",
      requirements: [
        { text: "A relative `PM_SOURCE_DIR` stops the start with a message, instead of reading from wherever the server happens to be started.", at: "if !filepath.IsAbs(c.SourceDir) {" },
      ],
      tests: ["server/internal/config/config_test.go"],
    },
    {
      path: "scripts/dev.mjs",
      role: "`npm run dev` sets `PM_SOURCE_DIR` to the checkout, so the code map shows files while developing.",
      requirements: [
        { text: "Only the development and browser-test servers set `PM_SOURCE_DIR`; nothing in `deploy/` does, so a deployment shows no source.", at: "PM_SOURCE_DIR: root," },
      ],
    },
  ],
  start: "src/components/CodeMapPage.tsx",
};
