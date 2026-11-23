import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const formats: CodeCategory = {
  id: "formats",
  area: "server",
  title: "Formats and sample content",
  summary:
    "Defines what a valid process, standard and set of lists is, and checks every save and import against it. " +
    "Each format is a JSON schema in `schema/`. The same files are read by the server (`server/internal/schema`) and, compiled ahead of time into `src/lib/validators.generated.js`, by the app, so both agree on what a valid document is; `docs.Check` adds what a schema cannot say. " +
    "The sample content in `processes/`, `standards/` and `catalog/` fills an empty database; `demo/` is a larger set loaded on request. Icons (with an allow-list for SVG) and the portal's look are checked and stored here too.",
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
      caption: "What changing a format involves (`CLAUDE.md`, \"Conventions\"): the generator refuses code the browser may not run; then `src/types.ts`, `src/lib/validate.ts`, `docs/check.go`, the prompts and the generators of skills are changed by hand.",
      process: flow("code-formats-schema", "Changing a format", "From the schema to every place that checks a document.",
        [["dev", "Developer"], ["build", "Build"], ["browser", "Browser"], ["server", "Server"]],
        [
          s("edit", "Change schema/*.schema.json", "dev", "document", ["gen"]),
          s("gen", "Run npm run validators", "build", "automation", ["safe"], "Ajv standalone code"),
          s("safe", "Needs eval or require?", "build", "verify", [["stop", "Yes"], ["types", "No"]]),
          s("stop", "Refuse to write the file", "build", "communication", []),
          s("types", "Change types, checker, prompts", "dev", "task", ["app"]),
          s("app", "Check while editing", "browser", "verify", ["load"], "validators.generated.js"),
          s("load", "Compile the schemas at start", "server", "automation", ["save"], "PM_SCHEMA_DIR"),
          s("save", "Check every save and import", "server", "verify", [], "schema, then docs.Check"),
        ]),
    },
    {
      caption: "Uploading an icon for a tool or language (`uploadIcon`, `icons.Inspect`, `checkSVG`). Before the bytes are looked at, a person is limited to 60 uploads an hour (429 with `Retry-After`) and the body to 64 KB.",
      process: flow("code-formats-icon", "Uploading an icon", "From the chosen file to a stored, safe image.",
        [["manager", "Lists manager"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("choose", "Send the image", "manager", "task", ["kind"], "POST /api/icons"),
          s("kind", "Bytes match the declared type?", "server", "verify", [["svg", "Yes"], ["r400", "No"]], "Sniff"),
          s("r400", "Answer 400 in one sentence", "server", "communication", []),
          s("svg", "Check the allow-list or decode", "server", "verify", ["ok"], "SVG or bitmap ≤ 512 px"),
          s("ok", "Plain, square, still image?", "server", "decision", [["store", "Yes"], ["r400", "No"]]),
          s("store", "Store under its SHA-256", "pg", "document", ["log"], "once per image"),
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
        "Saving lists that newly name an icon that is not stored is refused (`knownIcons` in `httpapi/icons.go`).",
      ],
    },
    {
      name: "portal_settings",
      purpose: "Settings of the whole portal; today one row, the look (key `theme`).",
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
          note: "What a schema cannot say: that the step it points to exists. The same rules are errors in the app's checker (`src/lib/validate.ts`).",
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
        { text: "Unknown fields are refused here and in every nested object: a field the server does not know would be stored, exported and shown nowhere, and a misspelt one would silently do nothing.", at: "\"additionalProperties\": false," },
        { text: "Three states and no more: rights (`canSee`, `CanSeeDraft`), skills, the index and the counts all decide by `status`, so a fourth value would be shown to everybody and handled nowhere.", at: "\"status\": {" },
        { text: "Ids are kebab-case slugs: they are file names (`processes/<id>.json`), parts of addresses and of skill ids, and `docs.ValidID` relies on this shape.", at: "\"pattern\": \"^[a-z0-9]+(-[a-z0-9]+)*$\"," },
      ],
      tests: ["server/internal/schema/schema_test.go", "src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "schema/standard.schema.json",
      role: "The format of a standard: head, placement, review and its requirements with level, verification and what a review looks for.",
      requirements: [
        { text: "`verification` is required: the review agent lists every requirement it does not check with how it is verified instead.", at: "\"verification\"" },
        { text: "Requirement ids are upper case with dashes (`SEC-LOG-01`), at most 30 characters: people, findings of the review agent and feedback (`feedback.step_id`) cite them, so they must stay stable.", at: "\"pattern\": \"^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$\"," },
      ],
      tests: ["server/internal/schema/schema_test.go", "src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "schema/catalog.schema.json",
      role: "The format of the lists: tiers, environments, languages, teams, practices, platforms, categories and tools.",
      requirements: [
        { text: "An icon id has exactly the shape of a SHA-256 (`icons.ValidID` checks the same); whether that icon is stored is checked by the server (`knownIcons`), not by the schema.", at: "\"pattern\": \"^[a-f0-9]{64}$\"," },
        { text: "`contacts` may not be empty (`minProperties: 1`): no contacts means leaving the object out, which `groups.go` does for an empty set.", at: "\"minProperties\": 1," },
      ],
      tests: ["server/internal/schema/schema_test.go", "server/internal/docs/check_test.go"],
    },
    {
      path: "scripts/validators.ts",
      role: "Writes `src/lib/validators.generated.js` from the three schemas (`npm run validators`).",
      requirements: [
        { text: "The guard that keeps the app working under its content security policy: a new Ajv feature that needs `require`, `new Function` or `eval` fails here at build time instead of in every browser.", at: "if (/\\brequire\\(|new Function|\\beval\\(/.test(code)) throw new Error(" },
        { text: "Also what the unit test compares the checked-in file with, so a schema changed without `npm run validators` fails the tests (`validate.test.ts`).", at: "export function generate(): string {" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "server/internal/schema/schema.go",
      role: "Compiles `schema/*.schema.json` at start and checks a body against its kind.",
      requirements: [
        { text: "A schema that is missing or does not compile stops the start (`run` loads them before serving), so the server never saves unchecked. Test: `TestLoadFailsWithoutSchemas`.", at: "return nil, fmt.Errorf(\"schema for %s: %w\", kind, err)" },
        { text: "Only three problems are named, so an answer stays short; the app shows the whole list before it sends a save.", at: "if len(problems) > 3 {" },
      ],
      tests: ["server/internal/schema/schema_test.go"],
    },
    {
      path: "server/internal/docs/check.go",
      role: "What a schema cannot say: that the parts of a document fit together and that it names only entries the lists have.",
      requirements: [
        { text: "Must stay in step with the errors of `src/lib/validate.ts`: a rule only here refuses saves the app thought fine; a rule only there is not enforced.", at: "// The format of a document is checked against the JSON schema. This file checks what a schema" },
        { text: "A category, practice or platform that is not in the lists is refused: `stillUsed` and the rights by platform and practice depend on every id being an entry. An unknown owning team is not checked here.", at: "if id != \"\" && !has(list, id) {" },
        { text: "`Removed` gives the entries a new version of the lists drops, as `<list>/<id>`; `stillUsed` refuses them while a document or a role still names them.", at: "func Removed(old, new Lists) []string {" },
      ],
      tests: ["server/internal/docs/check_test.go", "server/internal/httpapi/versions_test.go"],
    },
    {
      path: "server/internal/docs/contacts.go",
      role: "How to reach a team, platform or practice: checked and put into one line.",
      requirements: [
        { text: "`javascript:` or `data:` links are refused here as well as in the schema: the app opens these links, so one would run in the portal's page.", at: "func ValidLink(s string) bool { return linkPattern.MatchString(s) }" },
        { text: "One line in a fixed order, used by the skills and the notifications: changing the order changes every skill's text (a new version of each).", at: "func (n Named) Reach() string {" },
      ],
      tests: ["server/internal/docs/check_test.go"],
    },
    {
      path: "server/internal/docs/docs.go",
      role: "Import of files into the database and export of the database to files.",
      requirements: [
        { text: "Each file goes through the caller's checks (`st.validate` in `main.go`: schema, then `docs.Check`); a file that fails is reported and skipped, the rest is imported.", at: "if validate != nil {" },
        { text: "The lists are imported first, so processes and standards are checked against the lists of the same folder.", at: "if file := filepath.Join(dir, \"catalog\", \"catalog.json\"); exists(file) {" },
        { text: "Export removes the files of documents that no longer exist, so a folder that is exported again mirrors the database.", at: "func (s *Store) ExportDir(ctx context.Context, dir string) (int, error) {" },
      ],
      tests: ["server/cmd/server/main_test.go"],
    },
    {
      path: "scripts/validate.ts",
      role: "`npm run validate [folder]`: checks the lists, processes and standards of a folder with the app's checker.",
      requirements: [
        { text: "Another folder is checked over the repository's sample, as `npm run db:demo` loads it: it may name the sample documents and, without lists of its own, uses the sample lists.", at: "const overSample = root !== repo;" },
        { text: "The file name must be the document's id: import takes the id from the file name, and `docs.SaveIn` refuses a body whose id differs.", at: "if (id && f !== `${id}.json`) issues.push({ level: \"error\", path: \"id\", message: `file name must be ${id}.json` });" },
      ],
      tests: ["src/lib/__tests__/demo.test.ts"],
    },
    {
      path: "scripts/prompt.ts",
      role: "`npm run prompt`: writes the prompts for chat assistants to `docs/llm-prompt.md` and `docs/llm-prompt-standards.md` from the sample content.",
      requirements: [
        { text: "Uses the app's own `createPrompt` with the sample lists and titles; run it after changing a format, or the shared prompt asks for the old one.", at: "fs.writeFileSync(\"docs/llm-prompt.md\", createPrompt(\"\", processes, catalog, standards));" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "scripts/reviews.ts",
      role: "`npm run reviews [folder]`: lists the processes and standards whose review is overdue or due within 30 days, by owning team.",
      requirements: [
        { text: "Exits 1 when something is overdue, so a scheduled job can notify the owners; it reads files (the sample, or a folder from `npm run export`), never the database.", at: "process.exit(overdue ? 1 : 0);" },
        { text: "It has no reader: today is the UTC day, as the MCP server counts it.", at: "const utcToday = today(new Date(), \"UTC\");" },
      ],
      tests: ["src/lib/__tests__/review.test.ts"],
    },
    {
      path: "src/lib/prompt.ts",
      role: "The prompts that let any chat assistant write a process or standard in the format.",
      requirements: [
        { text: "Describes the format in words: a field added to the schema but not here is never filled by an assistant.", at: "export function createPrompt(text: string, known: KnownProcess[], catalog?: Catalog, standards: KnownProcess[] = []): string {" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/lib/validate.ts",
      role: "The app's checker: the generated schema checks plus the same rules as `docs.Check`, worded for people.",
      requirements: [
        { text: "Imports the generated checks; importing Ajv here instead would need `eval` and break every page under the content security policy.", at: "import { validateCatalogDoc as validateCatalogSchema" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts"],
    },
    {
      path: "server/internal/icons/svg.go",
      role: "The allow-list an SVG icon must pass: a plain drawing and nothing else.",
      requirements: [
        { text: "An allow-list, never a deny-list: a new SVG feature a browser learns is refused until somebody adds it here on purpose. Test: `TestSVGThatIsNotPlainDrawingIsRefused`.", at: "if !allowedElements[name] {" },
        { text: "No DOCTYPE or ENTITY before parsing: entity expansion is how a small file becomes a huge one.", at: "if bytes.Contains(upper, []byte(\"<!DOCTYPE\")) || bytes.Contains(upper, []byte(\"<!ENTITY\")) {" },
        { text: "Refused by name, with a message saying why: `<use>`, `<symbol>`, `<pattern>`, `<marker>` would let a few bytes draw millions of shapes. Test: `TestAUseBombIsRefused`.", at: "case \"use\", \"symbol\", \"pattern\", \"marker\":" },
        { text: "Every `href` is refused, also one inside the file, for the same reason; an outside one would load something.", at: "case a.Name.Space == xlinkNS && local == \"href\", a.Name.Space == \"\" && local == \"href\":" },
        { text: "The element count is a limit on the work a browser does to draw an icon.", at: "if elements > maxElements {" },
      ],
      tests: ["server/internal/icons/inspect_test.go", "server/internal/httpapi/icons_test.go"],
    },
    {
      path: "server/internal/icons/inspect.go",
      role: "Checks an uploaded image: what it really is, its size, and that it is square and still.",
      requirements: [
        { text: "The bytes decide: an SVG sent as `image/png` is refused, so the type that is stored and served is always what the bytes really are. Test: `TestTheRealKindDecides`.", at: "if got != want {" },
        { text: "Moving images are refused; only the chunk headers are read to find out.", at: "if animated(kind, data) {" },
        { text: "The same 64 KB as the `icons.data` check in the database; the upload handler reads no further than that.", at: "MaxBytes = 64 << 10 // 64 KB, for every kind" },
      ],
      tests: ["server/internal/icons/inspect_test.go"],
    },
    {
      path: "server/internal/icons/store.go",
      role: "The `icons` table, the clean-up, and icon files in `catalog/icons/` for import and export.",
      requirements: [
        { text: "The id is the hash, so `on conflict do nothing` is right: the same bytes are the same icon. `created` is false then, and no second `icon.upload` is written.", at: "on conflict (id) do nothing`, ic.ID, ic.ContentType, ic.Width, ic.Height, ic.Data, by)" },
        { text: "The logo of the look is kept: without this line, the portal's logo would be removed a day after upload. Test: `TestTheLogoIsServedToEveryoneAndKeptByTheCleanUp`.", at: "and not exists (select 1 from portal_settings s where strpos(s.value::text, i.id) > 0)`, CleanAfter.Seconds())" },
        { text: "Import reads only ordinary files: a link in `catalog/icons/` could otherwise import any file of the machine. Test: `TestImportAndExportOnlyTouchOrdinaryFiles`.", at: "if !info.Mode().IsRegular() {" },
        { text: "Export creates each file exclusively after removing what was there, so it never writes through a link.", at: "f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)" },
      ],
      tests: ["server/internal/icons/store_test.go", "server/internal/icons/files_unix_test.go", "server/cmd/server/icons_test.go"],
    },
    {
      path: "server/internal/theme/theme.go",
      role: "The look of the portal as the admin chose it: checked, described for Activity, stored with a revision.",
      requirements: [
        { text: "Colours only as `#rrggbb`: they go into style tokens in every page, so anything else could inject CSS. Test: `TestALookThatDoesNotFitIsRefusedWithAReasonPerProblem` (in `httpapi`).", at: "if v, ok := values[f.key]; ok && colorFields[f.key] && !hexColor.MatchString(v) {" },
        { text: "The revision is compared under `for update`, so two admins saving at once cannot both win; the loser gets 409 with what is stored. Test: `TestSavesAreRefusedFromAnOutdatedRevision`.", at: "if cur.Revision != base {" },
      ],
      tests: ["server/internal/theme/theme_test.go", "server/internal/httpapi/theme_test.go"],
    },
    {
      path: "processes/request-gcp-project.json",
      role: "Sample content: the process most examples in this map use.",
      requirements: [
        { text: "Sample files fill an empty database; changing them changes no running installation unless they are imported (`npm run db:import`).", at: "\"id\": \"request-gcp-project\"," },
      ],
      tests: ["server/internal/schema/schema_test.go"],
    },
    {
      path: "catalog/catalog.json",
      role: "The sample lists; its icons are in `catalog/icons/<id>.<ext>`.",
      requirements: [
        { text: "Imported before the processes and standards, which pick from it; its icons are imported before it, so it never names one that is missing.", at: "\"teams\": [" },
      ],
      tests: ["server/internal/icons/store_test.go"],
    },
  ],
};
