import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const formats: CodeCategory = {
  id: "formats",
  area: "server",
  title: "Formats and sample content",
  summary:
    "A process, a standard and the lists each have a JSON schema in `schema/`. The same files are read by the server (`server/internal/schema`) and, compiled ahead of time into `src/lib/validators.generated.js`, by the app, so both agree on what a valid document is; `docs.Check` adds what a schema cannot say. " +
    "The sample content in `processes/`, `standards/` and `catalog/` fills an empty database; `demo/` is a larger set loaded on request. Icons (with an allow-list for SVG) and the portal's look are stored and checked here too.",
  requirements: [
    "`schema/*.schema.json` is the one definition of the formats: the server compiles the same files at start, the app uses checks generated from them (`npm run validators`); a test fails when the generated file is out of date.",
    "The generated checks run under the content security policy: no `eval`, `new Function` or `require` (the generator refuses to write them).",
    "Every save is checked against its schema, then by `docs.Check` (what a schema cannot express: steps and participants that exist, entries of the lists that exist, dates that are dates), with at most three problems named.",
    "Imported files get the same checks as a save in the portal; a file that fails is skipped with a warning and the rest is imported.",
    "Every object of a format refuses unknown fields (`additionalProperties: false`); ids are kebab-case slugs, requirement ids upper case with dashes.",
    "Links people type are http(s) only, in the schema (`$defs`), the server (`docs.ValidLink`) and the app.",
    "An icon is stored under the SHA-256 of its bytes, at most 64 KB; what it really is is decided from the bytes, never from what the sender says; an SVG may contain only the elements and settings of the allow-list in `svg.go`, nothing that repeats parts of a drawing (`<use>`, `<symbol>`, `<pattern>`, `href`) and nothing that runs or loads.",
    "The look of the portal stores only what the admin chose (`portal_settings`); colours are `#rrggbb`, the font is the default or Roboto, and a change is made from a revision (409 when somebody saved since).",
    "The sample content is checked by `npm run validate` and by the server's schema tests; the demo set by `npm run validate demo`, over the sample.",
  ],
  charts: [
    {
      caption: "What changing a format involves, and where each copy of the rules is used (see CLAUDE.md, \"Conventions\").",
      process: flow("code-formats-schema", "Changing a format", "From the schema to every place that checks a document.",
        [["dev", "Developer"], ["build", "Build"], ["browser", "Browser"], ["server", "Server"]],
        [
          s("edit", "Change schema/*.schema.json", "dev", "document", ["gen"]),
          s("gen", "Run npm run validators", "build", "automation", ["safe"], "Ajv standalone code"),
          s("safe", "Needs eval or require?", "build", "decision", [["stop", "Yes"], ["types", "No"]]),
          s("stop", "Refuse to write the file", "build", "communication", []),
          s("types", "Change types, checker, prompts", "dev", "code", ["app"], "types.ts, validate.ts, check.go"),
          s("app", "Check while editing", "browser", "verify", ["load"], "validators.generated.js"),
          s("load", "Compile the schemas at start", "server", "automation", ["save"], "PM_SCHEMA_DIR"),
          s("save", "Check every save and import", "server", "verify", ["fit"], "schema.Validate"),
          s("fit", "Check that the parts fit", "server", "verify", [], "docs.Check"),
        ]),
    },
    {
      caption: "Uploading an icon for a tool or language (`uploadIcon`, `icons.Inspect`, `checkSVG`).",
      process: flow("code-formats-icon", "Uploading an icon", "From the chosen file to a stored, safe image.",
        [["manager", "Lists manager"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("choose", "Choose an image", "manager", "form", ["brake"], "POST /api/icons"),
          s("brake", "Fewer than 60 this hour?", "server", "decision", [["size", "Yes"], ["r429", "No"]]),
          s("r429", "Answer 429 with Retry-After", "server", "communication", []),
          s("size", "Read at most 64 KB", "server", "verify", ["kind"]),
          s("kind", "Bytes match the declared type?", "server", "decision", [["svg", "Yes"], ["r400", "No"]], "Sniff"),
          s("r400", "Answer 400 in one sentence", "server", "communication", []),
          s("svg", "Check the allow-list or decode", "server", "verify", ["ok"], "SVG or bitmap ≤ 512 px"),
          s("ok", "Plain, square drawing?", "server", "decision", [["store", "Yes"], ["r400", "No"]]),
          s("store", "Store under its SHA-256", "pg", "automation", ["log"], "once per image"),
          s("log", "Write icon.upload to Activity", "pg", "document", [], "only when new"),
        ]),
    },
  ],
  tables: [
    {
      name: "icons",
      purpose: "One uploaded image of a tool or language (or the portal's logo), stored once under the fingerprint of its bytes.",
      columns: [
        { name: "id", type: "text", note: "SHA-256 of the bytes, 64 hex characters" },
        { name: "content_type", type: "text", note: "image/png, image/jpeg, image/webp, image/svg+xml" },
        { name: "width", type: "int" },
        { name: "height", type: "int" },
        { name: "data", type: "bytea", note: "1 byte to 64 KB, exactly as uploaded" },
        { name: "created_by", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
      keys: ["primary key (id), check id ~ '^[a-f0-9]{64}$'", "checks on content_type, width > 0, height > 0, octet_length(data) between 1 and 65536"],
      createdIn: "server/internal/db/migrations/008_icons.sql",
      writtenBy: ["server/internal/icons/store.go"],
      readBy: ["server/internal/httpapi/icons.go", "server/internal/httpapi/theme.go"],
      rules: [
        "At start, an icon uploaded more than a day ago that neither the lists, nor any stored version of them, nor the look names is removed.",
        "Saving lists that newly name an icon that is not stored is refused.",
      ],
    },
    {
      name: "portal_settings",
      purpose: "Settings of the whole portal; today one row, the look (key 'theme').",
      columns: [
        { name: "key", type: "text", note: "only 'theme'" },
        { name: "value", type: "jsonb", note: "only what the admin chose" },
        { name: "revision", type: "int", note: "> 0; a change is made from one" },
        { name: "updated_by", type: "text" },
        { name: "updated_by_name", type: "text" },
        { name: "updated_at", type: "timestamptz" },
      ],
      keys: ["primary key (key), check key in ('theme')"],
      createdIn: "server/internal/db/migrations/010_portal_settings.sql",
      writtenBy: ["server/internal/theme/theme.go"],
      readBy: ["server/internal/httpapi/theme.go", "server/internal/icons/store.go"],
      rules: ["No row means the default look (revision 0)."],
    },
  ],
  examples: [
    {
      title: "A save that does not fit its format",
      caption: "The sample process saved with a status that does not exist and its first step pointing nowhere: what each check says.",
      stages: [
        {
          label: "The body (abridged)",
          shape: `{"schemaVersion": "1.0", "id": "request-gcp-project", "title": "Request a GCP project", "status": "paused", …,
 "steps": [{"id": "decide-project-details", …, "next": [{"to": "no-such-step"}]}, …]}`,
        },
        {
          label: "The schema check",
          where: "server/internal/schema/schema.go",
          shape: `400 {"error": "does not match the format: /status: value must be one of 'draft', 'active', 'deprecated'"}`,
          note: "Up to three problems, each with where it is; the app shows the full, friendlier list before it ever sends a save.",
        },
        {
          label: "With the status fixed: the checker",
          where: "server/internal/docs/check.go",
          shape: `400 {"error": "steps[0].next[0].to: This way on leads to a step that does not exist (“no-such-step”): choose where it goes."}`,
          note: "What a schema cannot say: that the step it points to exists. The same rules are errors in the app's checker (src/lib/validate.ts).",
        },
      ],
    },
  ],
  start: "schema/process.schema.json",
  files: [
    {
      path: "schema/process.schema.json",
      role: "The format of a process: head, placement, review, prerequisites, participants (lanes) and steps.",
      requirements: [
        { text: "No field that is not in the format.", at: "\"additionalProperties\": false," },
        { text: "Draft, active (also when left out) or deprecated (retired).", at: "\"status\": {" },
        { text: "Ids of processes, steps, participants and list entries are kebab-case slugs.", at: "\"pattern\": \"^[a-z0-9]+(-[a-z0-9]+)*$\"," },
      ],
      tests: ["server/internal/schema/schema_test.go", "src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "schema/standard.schema.json",
      role: "The format of a standard: head, placement, review and its requirements with level, verification and what a review looks for.",
      requirements: [
        { text: "A requirement needs an id, a title, a level, a statement and how it is verified.", at: "\"verification\"" },
        { text: "Requirement ids are upper case with dashes (\"SEC-LOG-01\"), at most 30 characters.", at: "\"pattern\": \"^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$\"," },
      ],
      tests: ["server/internal/schema/schema_test.go", "src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "schema/catalog.schema.json",
      role: "The format of the lists: tiers, environments, languages, teams, practices, platforms, categories and tools.",
      requirements: [
        { text: "An icon is named by 64 lowercase hex characters: the id the portal gave the uploaded image.", at: "\"pattern\": \"^[a-f0-9]{64}$\"," },
        { text: "How to reach a group: every field optional, links http(s) only, the object left out when empty.", at: "\"contacts\": {" },
      ],
      tests: ["server/internal/schema/schema_test.go", "server/internal/docs/check_test.go"],
    },
    {
      path: "scripts/validators.ts",
      role: "Writes src/lib/validators.generated.js from the three schemas (npm run validators).",
      requirements: [
        { text: "The checks are compiled ahead of time because building them in the browser needs eval, which the content security policy forbids; the generator refuses code that needs require, new Function or eval.", at: "if (/\\brequire\\(|new Function|\\beval\\(/.test(code)) throw new Error(" },
        { text: "A unit test compares the file with what the schemas generate now.", at: "export function generate(): string {" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "server/internal/schema/schema.go",
      role: "Compiles schema/*.schema.json at start and checks a body against its kind.",
      requirements: [
        { text: "The server starts only when the three schemas load and compile.", at: "func Load(dir string) (*Set, error) {" },
        { text: "A failure wraps docs.ErrInvalid (400) and names at most three problems with where they are.", at: "func (s *Set) Validate(kind string, body []byte) error {" },
      ],
      tests: ["server/internal/schema/schema_test.go"],
    },
    {
      path: "server/internal/docs/check.go",
      role: "What a schema cannot say: that the parts of a document fit together and that it names only entries the lists have.",
      requirements: [
        { text: "The same rules the app's checker treats as errors; what the app only warns about is allowed here.", at: "// The format of a document is checked against the JSON schema. This file checks what a schema" },
        { text: "Category, practice and platform must be in the lists; an owning team that is not is only a warning in the app.", at: "func (b belongs) check(l Lists, add func(string, ...any)) {" },
        { text: "Returns nil or one error naming up to three problems.", at: "func Check(kind string, body []byte, l Lists) error {" },
        { text: "Which list entries were removed by a new version of the lists, for the refusal of what is still used.", at: "func Removed(old, new Lists) []string {" },
      ],
      tests: ["server/internal/docs/check_test.go", "server/internal/httpapi/versions_test.go"],
    },
    {
      path: "server/internal/docs/contacts.go",
      role: "How to reach a team, platform or practice: checked and put into one line.",
      requirements: [
        { text: "A link people type is http:// or https:// only.", at: "func ValidLink(s string) bool { return linkPattern.MatchString(s) }" },
        { text: "Everything known about how to reach a group in one line, in a fixed order (used by skills and notifications).", at: "func (n Named) Reach() string {" },
      ],
      tests: ["server/internal/docs/check_test.go"],
    },
    {
      path: "server/internal/docs/docs.go",
      role: "Import of files into the database and export of the database to files.",
      requirements: [
        { text: "Import reads catalog/catalog.json first, then processes/ and standards/; each file is checked by the caller's validate and a file that fails is reported and skipped.", at: "func (s *Store) ImportDir(ctx context.Context, dir, by string, validate func(kind string, body []byte) error) (changed int, problems []string, err error) {" },
        { text: "Export writes every stored document in the same layout and removes files of documents that no longer exist.", at: "func (s *Store) ExportDir(ctx context.Context, dir string) (int, error) {" },
      ],
      tests: ["server/cmd/server/main_test.go"],
    },
    {
      path: "scripts/validate.ts",
      role: "npm run validate [folder]: checks the lists, processes and standards of a folder with the app's checker.",
      requirements: [
        { text: "Another folder is checked over the repository's sample: it may name the sample documents and, without lists of its own, uses the sample lists (npm run validate demo).", at: "const overSample = root !== repo;" },
        { text: "The file name must be the document's id; any error makes the command exit 1.", at: "if (id && f !== `${id}.json`) issues.push({ level: \"error\", path: \"id\", message: `file name must be ${id}.json` });" },
      ],
      tests: ["src/lib/__tests__/demo.test.ts"],
    },
    {
      path: "scripts/prompt.ts",
      role: "npm run prompt: writes the prompts for chat assistants to docs/llm-prompt.md and docs/llm-prompt-standards.md from the sample content.",
      requirements: [
        { text: "The prompts are the app's own (src/lib/prompt.ts) with the sample lists and titles, so they can be shared without running the app.", at: "fs.writeFileSync(\"docs/llm-prompt.md\", createPrompt(\"\", processes, catalog, standards));" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "scripts/reviews.ts",
      role: "npm run reviews [folder]: lists the processes and standards whose review is overdue or due within 30 days, by owning team.",
      requirements: [
        { text: "Uses the app's own review rule (reviewInfo) and exits 1 when something is overdue, so a scheduled job can notify the owners.", at: "process.exit(overdue ? 1 : 0);" },
      ],
      tests: ["src/lib/__tests__/review.test.ts"],
    },
    {
      path: "src/lib/prompt.ts",
      role: "The prompts that let any chat assistant write a process or standard in the format.",
      requirements: [
        { text: "Written from the rules of the format; change them with the schema.", at: "export function createPrompt(text: string, known: KnownProcess[], catalog?: Catalog, standards: KnownProcess[] = []): string {" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/lib/validate.ts",
      role: "The app's checker: the generated schema checks plus the same rules as docs.Check, worded for people.",
      requirements: [
        { text: "Uses the checks generated from the schemas, never a schema compiled in the browser.", at: "import { validateCatalogDoc as validateCatalogSchema" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "server/internal/icons/svg.go",
      role: "The allow-list an SVG icon must pass: a plain drawing and nothing else.",
      requirements: [
        { text: "Only these elements: shapes, text, groups, gradients, clip paths and masks. Keep it an allow-list.", at: "var allowedElements = set(" },
        { text: "No DOCTYPE or ENTITY; strict XML; at most 2000 elements, 32 levels and sizes up to 100000.", at: "func checkSVG(data []byte) (int, int, error) {" },
        { text: "Scripts, embedded content, links and anything that repeats parts of a drawing (<use>, <symbol>, <pattern>, <marker>, filters) are refused by name.", at: "case \"use\", \"symbol\", \"pattern\", \"marker\":" },
        { text: "Event handlers and every href are refused; a url(…) may only point inside the file; javascript:, vbscript: and data: are refused in every value.", at: "func checkAttribute(element string, a xml.Attr, ids, refs map[string]bool) error {" },
      ],
      tests: ["server/internal/icons/inspect_test.go", "server/internal/httpapi/icons_test.go"],
    },
    {
      path: "server/internal/icons/inspect.go",
      role: "Checks an uploaded image: what it really is, its size, and that it is square and still.",
      requirements: [
        { text: "At most 64 KB; PNG, JPEG and WebP at most 512 pixels a side.", at: "MaxBytes = 64 << 10 // 64 KB, for every kind" },
        { text: "The bytes decide what it is; a file sent as another type is refused.", at: "func Inspect(declared string, data []byte) (Icon, error) {" },
        { text: "Moving images (animated PNG or WebP) are refused.", at: "func animated(kind string, data []byte) bool {" },
      ],
      tests: ["server/internal/icons/inspect_test.go"],
    },
    {
      path: "server/internal/icons/store.go",
      role: "The icons table, the clean-up, and icon files in catalog/icons/ for import and export.",
      requirements: [
        { text: "Storing the same image twice changes nothing.", at: "func (s *Store) Put(ctx context.Context, ic Icon, by string) (created bool, err error) {" },
        { text: "Only icons uploaded more than a day ago that no version of the lists and not the look names are removed.", at: "func (s *Store) Clean(ctx context.Context) (int, error) {" },
        { text: "Import reads only ordinary files whose name matches their content; export never follows a link.", at: "func writeNew(path string, data []byte) error {" },
      ],
      tests: ["server/internal/icons/store_test.go", "server/internal/icons/files_unix_test.go", "server/cmd/server/icons_test.go"],
    },
    {
      path: "server/internal/theme/theme.go",
      role: "The look of the portal as the admin chose it: checked, described for Activity, stored with a revision.",
      requirements: [
        { text: "Only known settings; colours #rrggbb, kept in lower case; a name of at most 40 characters; the logo an uploaded icon; every problem one sentence.", at: "func Parse(body []byte) (Look, []string) {" },
        { text: "Only what the admin chose is stored; the app works out the readable variants itself.", at: "type Look struct {" },
        { text: "A save made from an older revision is refused with what is stored now.", at: "func (s *Store) Save(ctx context.Context, look Look, base int, by, byName string) (now, before Saved, err error) {" },
      ],
      tests: ["server/internal/theme/theme_test.go", "server/internal/httpapi/theme_test.go"],
    },
    {
      path: "processes/request-gcp-project.json",
      role: "Sample content: the process most examples in this map use.",
      requirements: [
        { text: "Sample files fill an empty database; changing them changes no running installation unless they are imported.", at: "\"id\": \"request-gcp-project\"," },
      ],
      tests: ["server/internal/schema/schema_test.go"],
    },
    {
      path: "catalog/catalog.json",
      role: "The sample lists; its icons are in catalog/icons/<id>.<ext>.",
      requirements: [
        { text: "Imported before the processes and standards, which pick from it; icons are imported before it.", at: "\"teams\": [" },
      ],
      tests: ["server/internal/icons/store_test.go"],
    },
  ],
};
