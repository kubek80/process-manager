import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const people: CodeCategory = {
  id: "people",
  area: "app",
  title: "People and their work",
  summary: "What the app shows each person by their rights, and the pages about people: owners and members, My responsibilities, requests, Admin › Access. The rights are decided and enforced in the server (`server/internal/rbac`, `server/internal/httpapi`); `src/lib/rights.ts` only works out which controls to show, by the same rules.",
  requirements: [
    "Every right the app uses is worked out in `src/lib/rights.ts` from the rights the server sent (`Perms`, from `rbac.PermsFrom`): there is no editor mode, a control appears by rights alone, and the server enforces the same rules again on every call (`rbac.Perms.CanEdit`, `CanDraft`, `CanSeeDraft`, `Misplaced`, `MisplacedDraft`).",
    "Drafting and publishing are told apart only by `canDraft` and `canPublish` / `publishPlaces`: the members of a platform or practice may draft what belongs to it, its owners and the editors of the kind may publish, and a first publication needs an owner of the whole placement (or an editor); the owning team gives no right to change anything. In the server: the save's check in `server/internal/httpapi/content.go` (`rbac.Perms.Misplaced` with no stored placement for a first publication, `MisplacedDraft` for a working draft, `notPublisher` for a member).",
    "Who sees a draft is worded only by `draftAudience`; a person is shown only by `personLabel` (by name where known, else by address).",
    "Owners of a team, platform or practice are given and taken by admins only (`POST`/`DELETE /api/admin/access`, admins only in `server/internal/httpapi/api.go`); members of a platform or practice by an admin or one of its owners, only through `/api/groups/{platforms|practices}/{id}/members` (`memberCall` in `server/internal/httpapi/groups.go`).",
    "Admin › Access sends a person's complete set of roles at once (`PUT /api/admin/users/{email}`). The app does not send: taking the last admin's role, an admin taking their own admin role, deleting oneself, or deleting an admin named in `PM_ADMINS`. The server itself refuses removing the last admin while `PM_ADMINS` names nobody (`keepAnAdmin`, `rbac.ErrLastAdmin`, `409`) and deleting oneself (`409`), and an admin named in `PM_ADMINS` keeps that right whatever is sent (`rbac.PermsFrom`).",
    "My responsibilities lists only what is the person's through a team they own or a platform or practice they own or are a member of; a member is asked for nothing but drafts, and only overdue reviews, open feedback and what waits for them to publish count in the number on the top bar (`urgent`).",
    "Requests are visible to everyone signed in, anyone may ask and vote. Planning, marking done, declining and reopening appear only where the server's `canManage` says so (`canManageRequest` in `server/internal/httpapi/requests.go`, which also refuses the call); withdrawing only for the person who asked while it is open; removing only for an admin.",
    "The requests' filter (state and kind) lives in the address (`#/requests?state=…&kind=…`), not in browser storage.",
    "Viewing the portal as somebody else (admins, Admin › Access and the owners and members of a group): while `/api/me` carries `viewedBy`, everything the person sees stays as they see it, every control that would change something is disabled (never hidden) with the server's own sentence (`changeBlocked`, `useChangeBlocked`), the editing screen is never the page (`pageWhileViewing`), and the band (`ViewAsBand`) names whose view it is, says nothing can be changed and when it ends, on every page, unprintable. The server refuses every change anyway; the app only spares the person a save that fails late.",
  ],
  charts: [
    {
      caption: "What the editing screen offers one person for one document, as `src/lib/rights.ts` works it out. The server checks the same again on every call: a working-draft call by somebody who may not draft answers `404`, a publish by a member `403` with who can.",
      process: flow("code-people-screen", "What the editing screen offers this person", "From opening the editing screen to the buttons a person gets.",
        [["app", "Browser"], ["server", "Server"]],
        [
          s("open", "Open #/p/:id/edit", "app", "task", ["draft"]),
          s("draft", "May draft it?", "app", "decision", [["screen", "Yes"], ["noright", "No"]], "canDraft"),
          s("noright", "Say who may change it", "app", "communication", [], "NoRight"),
          s("screen", "Show the editing screen", "app", "automation", ["publish"], "Save draft for all"),
          s("publish", "May publish where it ends up?", "app", "decision", [["all", "Yes"], ["banner", "No"]], "canPublish, publishPlaces"),
          s("banner", "Name the owners who publish it", "app", "communication", ["check"], "whoPublishesParts"),
          s("all", "Offer Publish… and More", "app", "task", ["check"], "retire, unpublish, delete"),
          s("check", "Check the same rights again", "server", "verify", [], "rbac, httpapi"),
        ]),
    },
    {
      caption: "An owner of a platform or practice adds a member on its page or in Admin › Teams / Tools (`GroupMembers` in `TeamMembers.tsx`, `addMember` in `server/internal/httpapi/groups.go`).",
      process: flow("code-people-member", "An owner adds a member", "How a member is added to a platform or practice.",
        [["owner", "Owner"], ["app", "Browser"], ["server", "Server"]],
        [
          s("type", "Type the address, press Add member", "owner", "task", ["send"]),
          s("send", "Send it to the group", "app", "communication", ["may"], "POST /api/groups/…/members"),
          s("may", "Admin or owner of it?", "server", "verify", ["already"], "403 names who can"),
          s("already", "Already owner or member?", "server", "decision", [["note", "Yes"], ["store", "No"]]),
          s("note", "Say that nothing changed", "app", "communication", [], "the answer's note"),
          s("store", "Give the role and log it", "server", "document", ["told"], "access.grant"),
          s("told", "Say it, with Undo", "app", "communication", [], "removes them again"),
        ]),
    },
    {
      caption: "Admin › Access: one dialog sets all of a person's roles at once. The app says what stops it before anything is sent (`roleProblems`); the server keeps the last admin all the same (`keepAnAdmin` in `server/internal/rbac/rbac.go`, under a lock; with an admin named in `PM_ADMINS` there always is one).",
      process: flow("code-people-access", "Set a person's roles", "From the roles dialog to the stored roles and the activity log.",
        [["admin", "Admin"], ["app", "Browser"], ["server", "Server"]],
        [
          s("edit", "Switch roles on and off", "admin", "task", ["check"], "Add person or Edit"),
          s("check", "Anything stops Save?", "app", "decision", [["say", "Yes"], ["send", "No"]], "roleProblems"),
          s("say", "Say what to change first", "app", "communication", [], "last admin, own admin role"),
          s("send", "Send the complete set of roles", "app", "communication", ["last"], "PUT /api/admin/users/{email}"),
          s("last", "Keep at least one admin", "server", "verify", ["store"], "409 otherwise"),
          s("store", "Replace the roles in one step", "server", "document", ["log"], "kept roles keep who gave them"),
          s("log", "Log what was added and removed", "server", "document", [], "access.change"),
        ]),
    },
  ],
  files: [
    {
      path: "src/lib/rights.ts",
      role: "What the signed-in person may do with a process or standard, a group or the Admin panel, worked out from the rights the server sent; it only shows and hides controls.",
      requirements: [
        { text: "Mirrors `rbac.Perms.CanDraft` (`server/internal/rbac/rbac.go`): whoever may publish it as stored, and the members of its platform or practice. Enforced there; if the two disagreed, a person would see a Save draft the server refuses, or miss one they may use (`rights.test.ts`).", at: "export const canDraft = (" },
        { text: "Mirrors the server's check of a publication (`rbac.Perms.Misplaced` and `notPublisher` in the save's check, `server/internal/httpapi/content.go`): with a new placement, the owners `publishPlaces` names, all of them when `all` is set. Publish… is offered exactly when the server accepts it.", at: "const need = publishPlaces(saved, now, published);" },
        { text: "A never-published document, or one whose platform or practice changes, needs an owner of every place involved (`all: true`); a published one that stays where it is needs an owner of any one of its places. The server's rule is the same.", at: "if (published && !moved.length) return { all: false, places: placesIn(was) };" },
        { text: "Mirrors `rbac.Perms.Misplaced` / `MisplacedDraft`: somebody who works only through their platforms and practices may move a document only between theirs (or none); the server refuses such a save (`server/internal/httpapi/content.go`, `drafts.go`).", at: "return (!!was && !placesValue(p, field, was)) || (!!is && !placesValue(p, field, is));" },
        { text: "The one wording of who sees a draft; the server decides who does (`rbac.Perms.CanSeeDraft`, `canSee` in `server/internal/httpapi/content.go`).", at: "export const draftAudience = (" },
        { text: "The sentence a greyed control gives while viewing as somebody else: word for word the server's refusal (`viewingRefusal` in `server/internal/httpapi/viewas.go`; `viewas.test.ts` compares them).", at: "export const viewingRefusal = (label: string) =>" },
        { text: "Whether an address opens the editing screen is asked of the router itself (`parseRoute`), so every address it opens the editing screen for (`/json`, `/editor`, `/edit?x` …) counts, now and later. A pattern of its own once missed some, and work typed there was lost at Save.", at: "export const opensChange = (hash: string) => isEditing(parseRoute(hash));" },
        { text: "The one guard where the route becomes a page (`App.tsx`): while viewing, the editing screen is replaced by its reader's page, so it can never mount.", at: "export const pageWhileViewing = (r: Route, me: ViewingState): Route => {" },
        { text: "Only an admin, by their own roles, not while already viewing, never as themselves; the server decides the same (`startViewAs`).", at: "export const mayViewAs = (me: ViewingState, email: string) =>" },
      ],
      tests: ["src/lib/__tests__/rights.test.ts", "src/lib/__tests__/viewas.test.ts", "e2e/platforms.spec.ts", "e2e/members.spec.ts"],
    },
    {
      path: "src/lib/members.ts",
      role: "The groups people belong to (teams, platforms, practices), the role that makes somebody an owner or a member of each, and how a person is shown.",
      requirements: [
        { text: "A person is shown by name where the portal knows it, else by address: every page goes through this (and `PersonLink`), so nobody is shown twice in two forms.", at: "export const personLabel = (" },
        { text: "Only an assignment with exactly this role and this group counts: an admin or an editor (roles without a scope) is not listed as an owner of every group.", at: "if (a.role === role && a.scope === id && !out.has(a.email)) out.set(a.email, a);" },
      ],
      tests: ["src/lib/__tests__/members.test.ts"],
    },
    {
      path: "src/components/TeamMembers.tsx",
      role: "`GroupMembers`: the owners or members of a team, platform or practice, on its page and in Admin › Teams / Tools, with adding and removing where the person may.",
      requirements: [
        { text: "Owners can be changed here only by an admin, through `/api/admin/access`; for anybody else the list is read-only. The server allows that call to admins only (`server/internal/httpapi/api.go`).", at: 'const ownersByAdmin = rank === "owner" && manage && perms.admin;' },
        { text: "Members can be changed by an admin or an owner of that platform or practice (`canManageMembers`); the server checks the same in `memberCall` (`server/internal/httpapi/groups.go`) and answers `403` with who can.", at: "const membersByManager =" },
        { text: "A group that is not saved yet shows no people: the server has nothing to attach a role to.", at: "if (!saved) return null;" },
      ],
      tests: ["e2e/members.spec.ts", "e2e/groups.spec.ts", "e2e/lists.spec.ts"],
    },
    {
      path: "src/lib/responsibilities.ts",
      role: "What somebody answers for, from their roles: the processes and standards of their teams, platforms and practices, and what needs doing about them now.",
      requirements: [
        { text: "Where the person is only a member, the item asks nothing but its drafts: reviews and feedback are the owners' work.", at: 'if (o.member) { if (o.status === "draft") tasks.push({ kind: "draft", item: o }); continue; }' },
        { text: "\"Waiting for you to publish\" is only what somebody else saved last and the person may publish (`canPublish`, the whole placement for a never-published one); their own changes are their unfinished work instead.", at: "if (w && !same(w.email, me) && publishes) {" },
        { text: "Saves the portal made itself (`import`, `system`) are nobody's work to hand over: they never wait for anybody.", at: "const PORTAL = new Set" },
        { text: "The number on the top bar counts overdue reviews, open feedback and what waits to be published; reviews only due soon do not count.", at: "export const urgent = (" },
      ],
      tests: ["src/lib/__tests__/responsibilities.test.ts", "src/lib/__tests__/review.test.ts", "e2e/mine.spec.ts"],
    },
    {
      path: "src/components/MinePage.tsx",
      role: "My responsibilities (`#/mine`): what the person's teams, platforms and practices hold, what needs doing now, and how the rest stands.",
      requirements: [
        { text: "\"Your unfinished work\" is only unpublished changes the person saved last themselves; `meta[id].draft` reaches the app only for those who may draft the document (the server sends it only where `CanDraft` holds, `server/internal/httpapi/content.go`).", at: "const changed = owned.filter(" },
      ],
      tests: ["e2e/mine.spec.ts"],
    },
    {
      path: "src/lib/requests.ts",
      role: "Requests for a process or standard that does not exist yet: their shape, filters, order, the check before sending, similar titles and the address of the list.",
      requirements: [
        { text: "Before asking, what exists with a similar title is shown: at least two shared words (the only word of a one-word title), best match first.", at: "if (shared >= need) out.push({ item, shared });" },
        { text: "Only a published document that is not retired is offered as the answer. The server refuses a draft (\"Only a published … can answer a request.\") and one the person cannot see, but would accept a retired one.", at: 'return docs.filter((d) => (d.status ?? "active") === "active")' },
      ],
      tests: ["src/lib/__tests__/requests.test.ts"],
    },
    {
      path: "src/components/RequestsPage.tsx",
      role: "Requests (`#/requests`): ask for something missing, vote, and move a request along.",
      requirements: [
        { text: "Plan, done, decline and back to open are offered only where the request carries `canManage`, which the server computes per person and enforces (`canManageRequest` in `server/internal/httpapi/requests.go`).", at: "if (r.canManage) {" },
        { text: "Remove is offered to an admin only, and not where Withdraw already does the same.", at: 'if (admin && !withdrawable) all.push("remove");' },
        { text: "One vote on its way per request: a second click while it travels is ignored, so the count shown never runs ahead of the server's.", at: "if (voting.current.has(r.id)) return;" },
      ],
      tests: ["src/lib/__tests__/adminFrame.test.ts", "src/lib/__tests__/requests.test.ts", "e2e/requests.spec.ts"],
    },
    {
      path: "src/lib/users.ts",
      role: "Admin › Access as plain functions: the roles and what they allow, the dialog's choices, what changes, and what stops a save or a delete.",
      requirements: [
        { text: "The last admin's role is not sent away: the server would refuse it anyway (`rbac.ErrLastAdmin`), the app says why first.", at: "if (isLastAdmin(c.user, c.users)) out.push(" },
        { text: "An admin cannot take their own admin role here, although the server would allow it while another admin exists: they would lose this page.", at: "else if (c.user.email.toLowerCase() === c.me.toLowerCase()) out.push(" },
        { text: "Nobody deletes themselves (the server refuses it too, `409`) or an admin named in `PM_ADMINS` (who would keep the role anyway).", at: "if (user.email.toLowerCase() === me.toLowerCase()) return" },
        { text: "An admin named in `PM_ADMINS` never counts as the last admin: that role cannot be lost.", at: "return !user.bootstrap && user.roles.some" },
        { text: "\"Stop viewing\" returns only to a place of the portal (`#/…`), never to the editing screen and never to an address from elsewhere; else to Admin › Access.", at: "export function returnPlace(saved: string | null | undefined): string {" },
        { text: "A tab reloads when the portal now answers it as somebody else than the page was opened for (viewing started or stopped in another tab, another person signed in), so it never shows one person while acting as another.", at: "export function personChanged(shown: SeenAs, now: SeenAs): boolean {" },
      ],
      tests: ["src/lib/__tests__/users.test.ts", "src/lib/__tests__/viewas.test.ts", "e2e/users.spec.ts"],
    },
    {
      path: "src/components/UsersSection.tsx",
      role: "Admin › Access: everyone with a role, one entry per person, the dialog that sets all their roles, and Delete that takes them all away.",
      requirements: [
        { text: "A save sends the whole set with `PUT /api/admin/users/{email}`, which replaces it in one transaction (`rbac.Store.Replace`); a refusal by the server is shown in the dialog.", at: "saveUserRoles(address, after)" },
        { text: "The admin role given by `PM_ADMINS` cannot be switched off here: the server keeps it whatever is sent.", at: 'const fixed = role === "admin" && !!user?.bootstrap;' },
      ],
      tests: ["e2e/users.spec.ts"],
    },
    {
      path: "src/components/ViewAsBand.tsx",
      role: "Viewing the portal as somebody else in the app: the band, the \"View as\" button of a person, the picker in Admin › Access (with \"A reader with no roles\"), and the watch that reloads a tab whose person changed.",
      requirements: [
        { text: "A link to the editing screen says why it does not open (and an address typed in goes to the reader's page) instead of opening a screen whose work could not be saved.", at: "if (!link || !opensChange(link.getAttribute(\"href\") ?? \"\")) return;" },
        { text: "When the hour is up the page opens afresh, as the admin: the server has ended the viewing by then, and a page that still showed the band would mislead.", at: "const t = window.setTimeout(() => window.location.reload(), Math.min(ms, 2 ** 31 - 1));" },
        { text: "Starting and stopping reload the page, so nothing the admin's own view loaded stays on the other person's page, or back.", at: "function reopenAt(hash: string) {" },
        { text: "On focus or visibility, `/api/me` is read only to look (`loadMe(false)`, which does not change the page's `X-Acting-As`), and the page reloads when its person changed.", at: "loadMe(false).then((now) => { if (personChanged(me, now)) window.location.reload(); }" },
      ],
      tests: ["src/lib/__tests__/viewas.test.ts"],
    },
    {
      path: "src/viewas.css",
      role: "The band of viewing as somebody else: fixed to the bottom of the window, in the warning fill, room kept for it (`--viewas-h`), never printed; the greyed links to the editing screen.",
      requirements: [
        { text: "Colours only through tokens (`--warn-fill` / `--warn-ink`), sizes through the type scale; the band cannot be scrolled away.", at: ".viewas-band {" },
      ],
    },
    {
      path: "src/users.css",
      role: "The look of Admin › Access: the list of people and the roles dialog.",
      requirements: [{ text: "Colours only through tokens (`--text-3`, …), so the page follows the theme and dark mode.", at: ".users-bar {" }],
    },
    {
      path: "src/mine.css",
      role: "The look of My responsibilities.",
      requirements: [{ text: "Unpublished changes are marked as a state (`--accent`), not as a warning: they are work in progress, not a problem.", at: ".tier-tag.unpublished" }],
    },
    {
      path: "src/requests.css",
      role: "The look of the requests page (and of Admin › Statistics, which imports it).",
      requirements: [{ text: "Colours only through tokens, so the page follows the theme and dark mode.", at: ".req-hero {" }],
    },
  ],
  start: "src/lib/rights.ts",
};
