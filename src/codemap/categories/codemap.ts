import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// This page: Admin › Code map itself - where its words live, how a test keeps them true to the
// code, and how a file's text reaches the browser (only from a checkout, only for admins).

export const codemap: CodeCategory = {
  id: "codemap",
  area: "around",
  title: "The code map itself",
  summary:
    "Admin › Code map sorts the portal's own source into categories, each with what its part must do, flow charts, tables, worked examples and its files with their requirements. " +
    "The words are TypeScript data in `src/codemap`, kept true to the code by a unit test; the files themselves come from the server one at a time, to admins only, and only where the portal runs beside its source (`PM_SOURCE_DIR`).",
  requirements: [
    "Every path the map names exists, every anchor (`at`) is text of one line of its file, every chart's steps lead to steps and lanes that exist, and every source file is in at least one category: `src/codemap/__tests__/codemap.test.ts` fails otherwise.",
    "The source is never part of the app bundle: the page asks `GET /api/admin/source?path=…` for one file at a time.",
    "Only admins read a file: the route is wrapped in `admin(…)` in `api.go`, and the Code map section is shown to admins only (`admin: true` in `AdminPage.tsx`).",
    "Without `PM_SOURCE_DIR` the server answers 404 for every path and `/api/admin/system` says `\"source\": false`; the page then says the file is shown only beside its source and keeps its path and requirements.",
    "Every refusal of a path is the same 404 answer (\"That file cannot be shown.\"), whether it is not allowed, missing or not a regular text file, so that nothing about the folder can be probed.",
    "What can be read is an allow-list: a cleaned relative path of letters, digits and `._-/`, no hidden segment except `.github/workflows/`, no `node_modules`, `dist`, `test-results`, `playwright-report` or `coverage`, nothing named like a secret, a known source extension or `Dockerfile`, at most 400 KB of UTF-8 without NUL; checked again after symbolic links are resolved.",
    "A requirement with an anchor is shown above the FIRST line that contains its text; one whose anchor is in no line is shown at the top as not placed, never dropped.",
    "Reading a file is not written to Activity.",
    "The map and its page are a chunk of their own, loaded only when the section is opened.",
  ],
  charts: [
    {
      process: flow(
        "code-codemap-open-file",
        "Opening a file",
        "What happens between a click on a file in the code map and its text with the comments in place.",
        [["browser", "Browser"], ["server", "Server"], ["fs", "File system"]],
        [
          s("open", "Open a file of a category", "browser", "form", ["system"], "#/admin/code/{category}/file/{path}"),
          s("system", "Ask whether the portal shows source", "browser", "automation", ["shows"], "GET /api/admin/system, once"),
          s("shows", "Does it show its source?", "browser", "decision", [["ask", "Yes"], ["none", "No"]]),
          s("ask", "Ask for the one file", "browser", "automation", ["allowed"], "GET /api/admin/source, admins only"),
          s("allowed", "Is the path on the allow-list?", "server", "decision", [["resolve", "Yes"], ["refuse", "No"]]),
          s("resolve", "Resolve links and open the file", "fs", "automation", ["checked"], "below PM_SOURCE_DIR"),
          s("checked", "Still allowed, regular, small, UTF-8?", "server", "decision", [["send", "Yes"], ["refuse", "No"]]),
          s("refuse", "Answer the one identical 404", "server", "code", ["none"]),
          s("send", "Send path, text and bytes", "server", "code", ["place"], "Cache-Control: no-store"),
          s("place", "Place comments above their lines", "browser", "code", [], "placeComments"),
          s("none", "Say the file is shown only beside source", "browser", "communication", [], "path and requirements stay"),
        ],
      ),
      caption:
        "The browser asks `/api/admin/system` once per visit; a 404 from `/api/admin/source` is shown the same way as `\"source\": false`. The server checks the path before and after symbolic links are resolved, so a link cannot lead outside the checkout or to a file the list refuses.",
    },
    {
      process: flow(
        "code-codemap-kept-true",
        "Keeping the map true",
        "How the unit test makes a change to the code show up in the map.",
        [["dev", "Developer"], ["vitest", "Vitest"]],
        [
          s("change", "Add, move or rename a source file", "dev", "code", ["run"]),
          s("run", "Run the code map's test", "dev", "automation", ["placed"], "npx vitest run src/codemap"),
          s("placed", "Is every source file in a category?", "vitest", "decision", [["paths", "Yes"], ["missing", "No"]]),
          s("missing", "Fail with the files left out", "vitest", "verify", ["place"]),
          s("place", "Put the file into a category", "dev", "document", ["run"], "src/codemap/categories"),
          s("paths", "Do all paths and anchors exist?", "vitest", "decision", [["pass", "Yes"], ["lost", "No"]]),
          s("lost", "Fail with each path or anchor", "vitest", "verify", ["fix"]),
          s("fix", "Fix the path or the anchor's text", "dev", "document", ["run"]),
          s("pass", "Pass", "vitest", "verify", []),
        ],
      ),
      caption:
        "The test walks `server`, `src`, `scripts`, `schema`, `e2e`, `deploy` and `.github/workflows` for source files (not tests, not the generated validators, not the category files themselves). It cannot tell whether a sentence is still true: a reviewer reads the requirement against the line it is shown above.",
    },
  ],
  files: [
    {
      path: "src/codemap/types.ts",
      role: "The format of the map: categories, files, requirements with their anchors, tables, examples and charts.",
      requirements: [
        { text: "A requirement with `at` is shown above the first line that contains that exact text; choose text that stays when the lines around it move.", at: "export type Requirement = { text: string; at?: string };" },
        { text: "A category's id is used in the address `#/admin/code/{id}`: lower case, digits and hyphens.", at: "/** Used in the address: `#/admin/code/{id}`. Lower case, digits and hyphens. */" },
      ],
      tests: ["src/codemap/__tests__/codemap.test.ts"],
    },
    {
      path: "src/codemap/__tests__/codemap.test.ts",
      role: "Keeps the map true: names only paths that exist, anchors that are in their files, charts that hold together, and leaves no source file out.",
      requirements: [
        { text: "Every source file of `server`, `src`, `scripts`, `schema`, `e2e`, `deploy` and `.github/workflows`, plus the files at the root the portal is built from, is in at least one category.", at: "it(\"every source file is in at least one category\"" },
        { text: "An anchor must be one line of text (no line break), not blank, and found in its file.", at: "it(\"anchors every placed comment to text that is in its file\"" },
        { text: "Chart ids start with `code-` and are unique over the whole map; every step's lane and every way out exist.", at: "it(\"draws charts that hold together\"" },
      ],
    },
    {
      path: "src/codemap/index.ts",
      role: "The areas with their names and every category in the order it is shown.",
      requirements: [
        { text: "A new category is imported here and added to `CATEGORIES`; the overview and the category list show them in this order.", at: "export const CATEGORIES: CodeCategory[]" },
      ],
      tests: ["src/codemap/__tests__/codemap.test.ts"],
    },
    {
      path: "src/codemap/chart.ts",
      role: "`flow` and `s`: a chart of the map is an ordinary process, drawn by the same map as the Guide's.",
      requirements: [
        { text: "The note under a step's title is kept in the step's `duration`, which the map shows under the title.", at: "id, title, actor, type, ...(note ? { duration: note } : {})," },
      ],
    },
    {
      path: "src/components/CodeMapPage.tsx",
      role: "The page: the overview with its search, a category with its parts, and a file with its text and comments.",
      requirements: [
        { text: "Follows the address itself (the app passes only the section): overview, category and file are `#/admin/code`, `#/admin/code/{category}` and `#/admin/code/{category}/file/{path}`.", at: "function useCodeView(): CodeView {" },
        { text: "An unknown category, or a file that is not in the category, is a plain \"not found\" inside the section with a way back, never an empty page.", at: "title=\"Not in the code map\"" },
        { text: "When a category or a file is opened the page starts at the top and the focus is on its heading.", at: "heading.current?.focus({ preventScroll: true });" },
        { text: "Asks `/api/admin/system` once; where the portal shows no source (`source: false` or a 404) it says so and keeps the path and every requirement, the anchored ones with their line's text.", at: "function useSource(path: string)" },
        { text: "The text is drawn as one row per line with no library and no highlighting; the comment blocks stay in view when the code scrolls sideways.", at: "const SourceText = memo(" },
      ],
      tests: ["src/lib/__tests__/codemap.test.ts"],
    },
    {
      path: "src/lib/codemap.ts",
      role: "The page's logic: comments on lines, where else a file is, the search over the map, the counts, the files before and after.",
      requirements: [
        { text: "A requirement goes above the first line that contains its anchor; one without an anchor goes to the top, one whose anchor is not found to the top as not placed.", at: "export function placeComments(" },
        { text: "The search needs every word of the query in one place (a path with its role, a requirement, a table with its purpose and columns); case and accents do not matter.", at: "export function searchMap(" },
        { text: "A link to a file named by a table or an example opens it in the current category when it is one of its files, else in the first category that has it.", at: "export function fileHome(" },
      ],
      tests: ["src/lib/__tests__/codemap.test.ts"],
    },
    {
      path: "src/codemap.css",
      role: "The look of the page: requirements as review comments, the source box that scrolls sideways on its own.",
      requirements: [
        { text: "Every colour is a token (`--info`, `--info-bg` for comments, `--surface-2` for code); the page never scrolls sideways, the code, the columns and the shapes scroll inside their boxes.", at: ".cm-code { overflow-x: auto;" },
      ],
    },
    {
      path: "src/lib/store.ts",
      role: "The code map's addresses (`CodeView`) and the call that reads one file (`loadSource`).",
      requirements: [
        { text: "Each part of a file's path is encoded on its own and the slashes stay, so that the address reads like the path.", at: "function codeHref(v: CodeView): string {" },
        { text: "An unknown category or file is kept in the route, so that the page can say it is not there.", at: "function parseCode(" },
        { text: "The file is asked for by its path from the repository root, encoded as a query value.", at: "export const loadSource = (path: string)" },
      ],
      tests: ["src/lib/__tests__/routes.test.ts"],
    },
    {
      path: "src/components/AdminPage.tsx",
      role: "Adds the section \"Code map\" to Admin, for admins only, and loads the page when it is opened.",
      requirements: [
        { text: "The section is for admins only; its page and the map's data are loaded only when it is opened.", at: "const CodeMapPage = lazy(" },
      ],
    },
    {
      path: "server/internal/httpapi/source.go",
      role: "`GET /api/admin/source`: one file of the checkout named by `PM_SOURCE_DIR`, through an allow-list.",
      requirements: [
        { text: "The allow-list: a cleaned relative path of letters, digits and `._-/`; no hidden segment but `.github/workflows/`; no build, package or test output; nothing named like a secret; known extensions and `Dockerfile` only.", at: "func allowedSourcePath(p string) bool {" },
        { text: "The path is checked again after symbolic links are resolved, and must stay below the folder.", at: "func readSource(root, p string) ([]byte, bool) {" },
        { text: "Every refusal is the same 404 with the same words; without a folder every path is a 404 too.", at: "sourceRefusedMessage = \"That file cannot be shown.\"" },
        { text: "Files over 400 KB, not UTF-8 or with a NUL byte are refused.", at: "const maxSourceBytes = 400 * 1024" },
      ],
      tests: ["server/internal/httpapi/source_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Reads `PM_SOURCE_DIR`: empty by default, which means the portal shows no source.",
      requirements: [
        { text: "`PM_SOURCE_DIR` must be an absolute path; a relative one stops the start with a message.", at: "SourceDir:    get(\"PM_SOURCE_DIR\", \"\")," },
      ],
      tests: ["server/internal/config/config_test.go"],
    },
    {
      path: "scripts/dev.mjs",
      role: "`npm run dev` sets `PM_SOURCE_DIR` to the checkout, so the code map shows files while developing.",
      requirements: [
        { text: "Only the development and browser-test servers set `PM_SOURCE_DIR`; nothing in `deploy/` does.", at: "PM_SOURCE_DIR: root," },
      ],
    },
  ],
  start: "src/components/CodeMapPage.tsx",
};
