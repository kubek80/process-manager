import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const admin: CodeCategory = {
  id: "admin",
  area: "app",
  title: "Admin",
  summary: "The Admin panel (`#/admin/{section}`): who may do what, the lists, skills, health, activity, statistics, look and set-up of the portal. Each section is a view over calls the server guards (every `/api/admin/…` route is for admins only, `server/internal/httpapi/api.go`); the lists are edited with the same `useDraft` as a process, and the activity log is put into words by `src/lib/activity.ts`.",
  requirements: [
    "A section is shown only to whom it is for: those marked `admin` (Access, Activity, Statistics, Theming, System, Code map) to admins only, Lists to whoever manages the lists (every admin does: `rbac.PermsFrom` sets `Catalog` for an admin), Skills and Health to everyone who reaches the panel; the panel itself is reached only by admins and lists managers (`canOpenAdmin`). This only hides: the server guards every `/api/admin/…` call again (`admin(…)` in `server/internal/httpapi/api.go`).",
    "The lists are saved as a whole through `useDraft` (`PUT /api/catalog?base=N`): a save from an outdated version is refused (`409`) and compared, never overwritten; Save is off while `validateCatalog` finds an error.",
    "An entry of the lists that a visible process or standard uses, or that still has owners or members, cannot be removed in the app (`usesOf`, `removeHint`); the server refuses the same (`stillUsed` in `server/internal/httpapi/content.go`, `400`), counting drafts the person cannot see without naming them.",
    "Removing an entry takes effect only when the lists are saved, and says so with Undo, which puts the entry back where it was.",
    "Every action the server writes to the activity log has words in `ACTION` (`src/lib/activity.ts`), checked by its unit test; an action without words still shows, as its name.",
    "Activity names a person by name where the page knows it (people with roles, people in the log, people who gave feedback), else by address, and names a document by its title with its id as the hint.",
    "Statistics shows counts per process and standard and per platform, practice or team for a chosen period; it never shows who viewed or downloaded what. The chosen period is remembered only in this browser (`pm:statistics-period`).",
    "An icon of a tool or language is uploaded at once (`POST /api/icons`, checked by `server/internal/icons`) and its id goes into the entry: an unsaved change of the lists like any other.",
  ],
  charts: [
    {
      caption: "Which sections of the Admin panel a person gets (`SECTIONS` and `allowed` in `AdminPage.tsx`, the place in the top bar from `canOpenAdmin`). The server checks every `/api/admin/…` call again.",
      process: flow("code-admin-sections", "Which Admin sections a person gets", "From the Admin place in the top bar to the sections listed.",
        [["app", "Browser"], ["server", "Server"]],
        [
          s("open", "Open #/admin/{section}", "app", "task", ["reach"]),
          s("reach", "Admin or lists manager?", "app", "decision", [["admin", "Yes"], ["none", "No"]], "canOpenAdmin"),
          s("none", "Show no Admin panel", "app", "communication", [], "no place in the top bar"),
          s("admin", "Admin?", "app", "decision", [["all", "Yes"], ["lists", "No"]]),
          s("all", "List every section", "app", "automation", ["guard"], "Access … Code map"),
          s("lists", "List Lists, Skills and Health", "app", "automation", ["guard"]),
          s("guard", "Check the rights on every call", "server", "verify", [], "/api/admin/… admins only"),
        ]),
    },
    {
      caption: "Admin › Lists: removing an entry and saving the lists. The app keeps Remove off for an entry in use and Save off while the checker finds an error; the server refuses a save from an older version (`409`, then the conflict dialog) and the removal of an entry still in use (`400`, `stillUsed`).",
      process: flow("code-admin-lists", "Remove an entry and save the lists", "How a change of the lists reaches the server.",
        [["admin", "Lists manager"], ["app", "Browser"], ["server", "Server"]],
        [
          s("pick", "Choose an entry to remove", "admin", "task", ["used"]),
          s("used", "Used, or people still in it?", "app", "decision", [["hint", "Yes"], ["gone", "No"]], "usesOf, members"),
          s("hint", "Keep Remove off and say why", "app", "communication", [], "removeHint"),
          s("gone", "Remove it, offer Undo", "app", "automation", ["save"], "not saved yet"),
          s("save", "Press Save", "admin", "task", ["put"], "off while the checker finds errors"),
          s("put", "Send the lists on version N", "app", "communication", ["refuse"], "PUT /api/catalog?base=N"),
          s("refuse", "Check version and uses", "server", "verify", ["store"], "409 or 400"),
          s("store", "Store the next version, log it", "server", "document", [], "lists.save"),
        ]),
    },
  ],
  files: [
    {
      path: "src/components/AdminPage.tsx",
      role: "The Admin panel: its sections and who gets which, and the smaller sections themselves (Skills, Health, Activity, System).",
      requirements: [
        { text: "Sections marked `admin` are listed to admins only, Lists to lists managers, the others to everyone who reaches the panel. This only hides them: the server answers `403` to every `/api/admin/…` call by a non-admin (`server/internal/httpapi/api.go`).", at: "const allowed = SECTIONS.filter(" },
        { text: "An address naming a section the person may not open shows the first one they may, never an empty page.", at: "const current = allowed.find((s) => s.id === section) ?? allowed[0];" },
        { text: "Activity loads 100 entries at a time, older ones on \"Show older\" from the id of the last one shown, so nothing recorded is out of reach.", at: "loadAudit(100, before).then((page) => {" },
      ],
      tests: ["e2e/admin.spec.ts", "e2e/catalog.spec.ts"],
    },
    {
      path: "src/components/CatalogPage.tsx",
      role: "The lists (teams, practices, platforms, categories, tools, tiers, environments, languages): a directory for everyone under Teams & tools, and their editor in Admin › Lists.",
      requirements: [
        { text: "The lists are edited as one document through `useDraft`, as a process is: Undo, Redo, a conflict when somebody else saved first, a question before leaving with unsaved changes.", at: "const d = useDraft<Catalog>(" },
        { text: "`usesOf` sees only the processes and standards the person sees, so it can miss a draft; the server's `stillUsed` counts those too and refuses the save.", at: "function usesOf(key: Key, id: string" },
        { text: "Remove is off while the entry is used or still has owners or members: removing it would leave documents or roles pointing at nothing.", at: "disabled={uses.length > 0 || stillMembers > 0}" },
        { text: "Undo of a removal puts the entry back at its old place only if it is not there already: pressing the message's Undo twice adds no second entry with the same id.", at: "if (have.some((r) => r.id === entry.id)) return;" },
      ],
      tests: ["e2e/catalog.spec.ts", "e2e/lists.spec.ts"],
    },
    {
      path: "src/components/IconField.tsx",
      role: "The Icon field of a tool or language in Admin › Lists: upload, preview, remove.",
      requirements: [
        { text: "A file of the wrong type, empty or over 64 KB is refused before it is sent (`iconFileProblem`); the server checks it again (`server/internal/icons`) and its refusal is shown as it is.", at: "if (wrong) { setProblem(wrong); return; }" },
        { text: "Only the returned id goes into the entry; it is stored with the lists' next save, so leaving without saving drops it like any other change.", at: "onChange(id);" },
      ],
      tests: ["e2e/icons.spec.ts"],
    },
    {
      path: "src/lib/activity.ts",
      role: "Admin › Activity in plain words: the words for every action the server logs, who did it and what it was done to.",
      requirements: [
        { text: "Every action the server writes needs words here and in the list of `activity.test.ts`; one without words is shown as its raw name.", at: "const words = ACTION[e.action] ?? e.action.replace(/[._]/g, \" \");" },
        { text: "Imports and upgrades (`import`, `system`) are said as done by \"The portal\", never as a person.", at: "const person = !SYSTEM_AUTHORS.has(e.email);" },
        { text: "Targets that mean nothing to a reader (an icon's fingerprint, the lists, the look, a conversion) are left out.", at: "export const shownTarget = (" },
      ],
      tests: ["src/lib/__tests__/activity.test.ts"],
    },
    {
      path: "src/components/StatisticsPage.tsx",
      role: "Admin › Statistics: totals, a chart of views per week, totals per platform, practice or team, and a table per process and standard, for a chosen period.",
      requirements: [
        { text: "The numbers come from `GET /api/admin/statistics?period=…` (admins only); the same as CSV from `/api/admin/statistics.csv`. Neither names who viewed or downloaded anything.", at: "export function StatisticsSection()" },
        { text: "The period is remembered in browser storage inside `try`: in a private window the page still works, with the default period.", at: "try { localStorage.setItem(PERIOD_KEY, p); } catch" },
      ],
      tests: ["e2e/statistics.spec.ts"],
    },
    {
      path: "src/lib/statistics.ts",
      role: "The shapes of the statistics and how the page arranges them: sorting, totals per group, the weeks of the chart, the note about deleted documents.",
      requirements: [
        { text: "Without the server's groups, \"people\" per group is the largest of its rows, not their sum: one person may have read several documents, so a sum would overstate it.", at: "g.documents++; g.views += r.views; g.people = Math.max(g.people, r.people);" },
        { text: "Every week from the first to the last is present: a week without views is a zero, not a gap that joins its neighbours in the chart.", at: "out.push(by.get(week) ?? { week, views: 0, people: 0, downloads: 0, days: 7 });" },
        { text: "When the totals include views or downloads of documents deleted since, a sentence says why they exceed the table.", at: "export function deletedNote(" },
      ],
      tests: ["src/lib/__tests__/statistics.test.ts"],
    },
    {
      path: "src/components/UsersSection.tsx",
      role: "Admin › Access: every person with a role and the dialog that sets all of their roles (see People and their work).",
      requirements: [{ text: "Its calls (`/api/admin/users`) are for admins only in the server; the section is marked `admin` only so that others do not see it.", at: "export function UsersSection()" }],
      tests: ["e2e/users.spec.ts"],
    },
    {
      path: "src/components/TeamMembers.tsx",
      role: "The Owners and Members of a team, platform or practice in Admin › Lists (see People and their work).",
      requirements: [{ text: "In Admin › Lists an admin gives and takes owners as roles (`/api/admin/access`, admins only in the server); a lists manager who is not an admin only sees them.", at: 'const ownersByAdmin = rank === "owner" && manage && perms.admin;' }],
      tests: ["e2e/lists.spec.ts", "e2e/catalog.spec.ts"],
    },
  ],
  start: "src/components/AdminPage.tsx",
};
