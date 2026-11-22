import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const admin: CodeCategory = {
  id: "admin",
  area: "app",
  title: "Admin",
  summary: "The Admin panel (`#/admin/{section}`) for admins and the people who manage the lists: Access, Lists, Skills, Health, Activity, Statistics, Theming and System. Each section is a view over calls the server guards; the lists are edited with the same `useDraft` as a process, and the activity log is put into words by `src/lib/activity.ts`.",
  requirements: [
    "A section is shown only to whom it is for: those marked `admin` (Access, Activity, Statistics, Theming, System) to admins only, Lists to whoever manages the lists (every admin does), Skills and Health to everyone who reaches the panel; the panel itself is reached only by admins and lists managers (`canOpenAdmin`). The server guards every `/api/admin/…` call again.",
    "The lists are saved as a whole through `useDraft` (`PUT /api/catalog?base=N`): a save from an outdated version is refused and compared, never overwritten; Save is off while `validateCatalog` finds an error.",
    "An entry of the lists that a visible process or standard uses, or that still has owners or members, cannot be removed in the app (`usesOf`, `removeHint`); the server refuses the same (`stillUsed`), counting drafts the person cannot see without naming them.",
    "Removing an entry takes effect only when the lists are saved, and says so with Undo, which puts the entry back where it was.",
    "Every action the server writes to the activity log has words in `ACTION` (`src/lib/activity.ts`), checked by its unit test; an action without words still shows, as its name.",
    "Activity names a person by name where the page knows it (people with roles, people in the log, people who gave feedback), else by address, and names a document by its title with its id as the hint.",
    "Statistics shows counts per process and standard and per platform, practice or team for a chosen period; it never shows who viewed or downloaded what. The chosen period is remembered only in this browser.",
    "An icon of a tool or language is uploaded at once (`POST /api/icons`, checked by the server) and its id goes into the entry: an unsaved change of the lists like any other.",
  ],
  charts: [
    {
      caption: "Which sections of the Admin panel a person gets (`SECTIONS` and `allowed` in `AdminPage.tsx`, the place in the top bar from `canOpenAdmin`).",
      process: flow("code-admin-sections", "Which Admin sections a person gets", "From the Admin place in the top bar to the sections listed.",
        [["app", "Browser"], ["server", "Server"]],
        [
          s("open", "Open #/admin/{section}", "app", "task", ["reach"]),
          s("reach", "Admin or lists manager?", "app", "decision", [["admin", "Yes"], ["none", "No"]], "canOpenAdmin"),
          s("none", "Show no Admin panel", "app", "communication", [], "no place in the top bar"),
          s("admin", "Admin?", "app", "decision", [["all", "Yes"], ["lists", "No"]]),
          s("all", "List every section", "app", "automation", ["guard"], "Access … System"),
          s("lists", "List Lists, Skills and Health", "app", "automation", ["guard"]),
          s("guard", "Check the rights on every call", "server", "verify", [], "/api/admin/… admins only"),
        ]),
    },
    {
      caption: "Admin › Lists: removing an entry and saving the lists, with what the app and the server each refuse.",
      process: flow("code-admin-lists", "Remove an entry and save the lists", "How a change of the lists reaches the server.",
        [["admin", "Lists manager"], ["app", "Browser"], ["server", "Server"]],
        [
          s("pick", "Choose an entry to remove", "admin", "task", ["used"]),
          s("used", "Used, or people still in it?", "app", "decision", [["hint", "Yes"], ["gone", "No"]], "usesOf, members"),
          s("hint", "Keep Remove off and say why", "app", "communication", [], "removeHint"),
          s("gone", "Remove it, offer Undo", "app", "automation", ["save"], "not saved yet"),
          s("save", "Press Save", "admin", "task", ["check"]),
          s("check", "Checker finds an error?", "app", "decision", [["off", "Yes"], ["put", "No"]], "validateCatalog"),
          s("off", "Keep Save off", "app", "communication", []),
          s("put", "Send the lists on version N", "app", "code", ["refuse"], "PUT /api/catalog?base=N"),
          s("refuse", "Newer version, or still used?", "server", "decision", [["conflict", "Yes"], ["store", "No"]], "409 or 400"),
          s("conflict", "Compare and decide", "app", "review", [], "ConflictDialog"),
          s("store", "Store the next version, log it", "server", "automation", [], "lists.save"),
        ]),
    },
  ],
  files: [
    {
      path: "src/components/AdminPage.tsx",
      role: "The Admin panel: its sections and who gets which, and the smaller sections themselves (Skills, Health, Activity, System).",
      requirements: [
        { text: "Sections marked `admin` are for admins only, Lists for whoever manages the lists, the others for everyone who reaches the panel; an unknown section opens the first allowed one.", at: "const allowed = SECTIONS.filter(" },
        { text: "Activity loads the newest 100 entries, then older ones page by page (\"Show older\"), and says each in words with `describeEntry`.", at: "function ActivitySection(" },
        { text: "Health counts reviews due by `reviewOf` with `meta` (first publication), open feedback, drafts and active documents without an owner or a review rhythm.", at: "function HealthSection(" },
        { text: "System only shows how the installation is set up; nothing in it can be changed here.", at: "function SystemSection()" },
      ],
      tests: ["e2e/admin.spec.ts", "e2e/catalog.spec.ts"],
    },
    {
      path: "src/components/CatalogPage.tsx",
      role: "The lists (teams, practices, platforms, categories, tools, tiers, environments, languages): a directory for everyone under Teams & tools, and their editor in Admin › Lists.",
      requirements: [
        { text: "The lists are edited as one document through `useDraft`: Undo, Redo, a conflict when somebody else saved first, a question before leaving with unsaved changes.", at: "const d = useDraft<Catalog>(" },
        { text: "What uses an entry, among the processes and standards the person sees: owner, participant, platform, practice, category, a step's tool, a tier, environment or language.", at: "function usesOf(key: Key, id: string" },
        { text: "Remove is off while the entry is used or still has owners or members; the reason is said next to it.", at: "disabled={uses.length > 0 || stillMembers > 0}" },
        { text: "Removing says so with Undo, which puts the entry back at its place; it is gone for everyone only once the lists are saved.", at: "const remove = (entry: Row) => {" },
      ],
      tests: ["e2e/catalog.spec.ts", "e2e/lists.spec.ts"],
    },
    {
      path: "src/components/IconField.tsx",
      role: "The Icon field of a tool or language in Admin › Lists: upload, preview, remove.",
      requirements: [
        { text: "A file of the wrong type or size is refused in the app before it is sent; the server checks it again and its refusal is shown as it is.", at: "const wrong = iconFileProblem(file);" },
        { text: "The upload happens at once; only the returned id goes into the entry, saved with the lists.", at: "const { id } = await uploadIcon(" },
      ],
      tests: ["e2e/icons.spec.ts"],
    },
    {
      path: "src/lib/activity.ts",
      role: "Admin › Activity in plain words: the words for every action the server logs, who did it and what it was done to.",
      requirements: [
        { text: "Every action the server writes needs words here, and in the list of its unit test.", at: "export const ACTION: Record<string, string> = {" },
        { text: "Imports and upgrades are said as done by \"The portal\"; a document is named by its title with its id as the hint; an unknown action shows as its name.", at: "export function describeEntry(" },
        { text: "Targets that mean nothing to a reader (an icon's fingerprint, the lists, the look) are left out.", at: "const NO_TARGET = new Set(" },
      ],
      tests: ["src/lib/__tests__/activity.test.ts"],
    },
    {
      path: "src/components/StatisticsPage.tsx",
      role: "Admin › Statistics: totals, a chart of views per week, totals per platform, practice or team, and a table per process and standard, for a chosen period.",
      requirements: [
        { text: "The numbers come from `GET /api/admin/statistics?period=…` (admins only); the same as CSV from `/api/admin/statistics.csv`.", at: "export function StatisticsSection()" },
        { text: "The chosen period is remembered only in this browser, and the page works without it.", at: "localStorage.setItem(PERIOD_KEY, p)" },
      ],
      tests: ["e2e/statistics.spec.ts"],
    },
    {
      path: "src/lib/statistics.ts",
      role: "The shapes of the statistics and how the page arranges them: sorting, totals per group, the weeks of the chart, the note about deleted documents.",
      requirements: [
        { text: "Totals per platform, practice or team: the server's groups when it sent them, else added up from the rows; documents of none come last.", at: "export function groupTotals(" },
        { text: "Every week from the first to the last is present: a week without views is a zero, not a gap.", at: "export function fillWeeks(" },
        { text: "When the totals include views or downloads of documents deleted since, a sentence says so.", at: "export function deletedNote(" },
      ],
      tests: ["src/lib/__tests__/statistics.test.ts"],
    },
    {
      path: "src/components/UsersSection.tsx",
      role: "Admin › Access: every person with a role and the dialog that sets all of their roles (see People and their work).",
      requirements: [{ text: "Reached only by admins: the section is marked `admin`.", at: "export function UsersSection()" }],
      tests: ["e2e/users.spec.ts"],
    },
    {
      path: "src/components/TeamMembers.tsx",
      role: "The Owners and Members of a team, platform or practice in Admin › Lists (see People and their work).",
      requirements: [{ text: "In Admin › Lists an admin gives and takes owners as roles (`/api/admin/access`); a lists manager who is not an admin only sees them.", at: 'const ownersByAdmin = rank === "owner" && manage && perms.admin;' }],
      tests: ["e2e/lists.spec.ts", "e2e/catalog.spec.ts"],
    },
  ],
  start: "src/components/AdminPage.tsx",
};
