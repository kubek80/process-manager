import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const people: CodeCategory = {
  id: "people",
  area: "app",
  title: "People and their work",
  summary: "What the app shows a person by their rights, and the pages about people: the owners and members of teams, platforms and practices, My responsibilities, requests for something missing, and Admin › Access. The rights are decided in the server; `src/lib/rights.ts` only works out which controls to show, by the same rules.",
  requirements: [
    "Every right the app uses is worked out in `src/lib/rights.ts` from the rights the server sent (`Perms`): there is no editor mode, a control appears by rights alone, and the server enforces them again on every call.",
    "Drafting and publishing are told apart only by `canDraft` and `canPublish` / `publishPlaces`: the members of a platform or practice may draft what belongs to it, its owners and the editors of the kind may publish, and a first publication needs an owner of the whole placement (or an editor); the owning team gives no right to change anything.",
    "Who sees a draft is worded only by `draftAudience`; a person is shown only by `personLabel` (by name where known, else by address).",
    "Owners of a team, platform or practice are given and taken by admins only (`/api/admin/access`); members of a platform or practice by an admin or one of its owners, only through `/api/groups/{platforms|practices}/{id}/members`.",
    "Admin › Access sends a person's complete set of roles at once (`PUT /api/admin/users/{email}`); the app does not send: taking the last admin's role, an admin taking their own admin role, deleting oneself, or deleting an admin named in `PM_ADMINS`. The server itself refuses removing the last admin and deleting oneself (409), and an admin named in `PM_ADMINS` keeps that role whatever is sent.",
    "My responsibilities lists only what is the person's through a team they own or a platform or practice they own or are a member of; a member is asked for nothing but drafts, and only overdue reviews, open feedback and what waits for them to publish count in the number on the top bar (`urgent`).",
    "Requests are visible to everyone signed in, anyone may ask and vote; planning, marking done, declining and reopening appear only where the server says the person may (`canManage` on each request), withdrawing only for the person who asked while it is open, removing only for an admin; a request is answered only by a published, not retired, document (`answerChoices`).",
    "The requests' filter (state and kind) lives in the address (`#/requests?state=…&kind=…`), not in browser storage.",
  ],
  charts: [
    {
      caption: "What the editing screen offers one person for one document, as `rights.ts` works it out. The server checks the same again on every save.",
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
          s("check", "Check the same rights again", "server", "verify", [], "403 or 404 otherwise"),
        ]),
    },
    {
      caption: "An owner of a platform or practice adds a member on its page or in Admin › Lists (`GroupMembers` in `TeamMembers.tsx`).",
      process: flow("code-people-member", "An owner adds a member", "How a member is added to a platform or practice.",
        [["owner", "Owner"], ["app", "Browser"], ["server", "Server"]],
        [
          s("type", "Type the address, press Add member", "owner", "form", ["send"]),
          s("send", "Send it to the group", "app", "code", ["may"], "POST /api/groups/…/members"),
          s("may", "Admin or owner of it?", "server", "decision", [["already", "Yes"], ["refuse", "No"]]),
          s("refuse", "Refuse with 403", "server", "communication", [], "names who can"),
          s("already", "Already owner or member?", "server", "decision", [["note", "Yes"], ["store", "No"]]),
          s("note", "Say that nothing changed", "app", "communication", [], "the answer's note"),
          s("store", "Give the role and log it", "server", "automation", ["told"], "access.grant"),
          s("told", "Say it, with Undo", "app", "communication", [], "removes them again"),
        ]),
    },
    {
      caption: "Admin › Access: one dialog sets all of a person's roles at once. The app says what stops it before anything is sent; the server keeps the last admin all the same.",
      process: flow("code-people-access", "Set a person's roles", "From the roles dialog to the stored roles and the activity log.",
        [["admin", "Admin"], ["app", "Browser"], ["server", "Server"]],
        [
          s("edit", "Switch roles on and off", "admin", "form", ["check"], "Add person or Edit"),
          s("check", "Anything stops Save?", "app", "decision", [["say", "Yes"], ["send", "No"]], "roleProblems"),
          s("say", "Say what to change first", "app", "communication", [], "last admin, own admin role"),
          s("send", "Send the complete set of roles", "app", "code", ["last"], "PUT /api/admin/users/{email}"),
          s("last", "Would no admin be left?", "server", "decision", [["refuse", "Yes"], ["store", "No"]]),
          s("refuse", "Refuse with 409", "server", "communication", []),
          s("store", "Replace the roles in one step", "server", "automation", ["log"], "kept roles keep who gave them"),
          s("log", "Log what was added and removed", "server", "automation", [], "access.change"),
        ]),
    },
  ],
  files: [
    {
      path: "src/lib/rights.ts",
      role: "What the signed-in person may do with a process or standard, a group or the Admin panel, worked out from the rights the server sent; it only shows and hides controls.",
      requirements: [
        { text: "May draft (open the editing screen, save and discard a working draft): whoever may publish it as stored, and the members of its platform or practice.", at: "export const canDraft = (" },
        { text: "May publish it as the changes leave it: an editor of the kind always; otherwise owners of the places `publishPlaces` names, all of them when `all` is set.", at: "export function canPublish(" },
        { text: "A never-published document, or one whose platform or practice changes, needs an owner of every place involved (`all: true`); a published one that stays where it is needs an owner of any one of its places.", at: "export function publishPlaces(" },
        { text: "The one wording of who sees a draft.", at: "export const draftAudience = (" },
        { text: "Somebody who works only through their platforms and practices may move a document only from one of theirs (or none) to one of theirs (or none); the server refuses the same.", at: "export function belongsRefused(" },
        { text: "The members of a platform or practice are changed by an admin or its owners; a team has no members.", at: "export const canManageMembers = (" },
      ],
      tests: ["src/lib/__tests__/rights.test.ts", "e2e/platforms.spec.ts", "e2e/members.spec.ts"],
    },
    {
      path: "src/lib/members.ts",
      role: "The groups people belong to (teams, platforms, practices), the role that makes somebody an owner or a member of each, and how a person is shown.",
      requirements: [
        { text: "A person is shown by name where the portal knows it, else by address: the one place that decides it.", at: "export const personLabel = (" },
        { text: "The owners (or members) of one group: everyone with that role for it, once each, sorted by address; a role without a scope is not membership.", at: "export function membersOf<" },
        { text: "Owner roles: `owner` for a team, `platform-owner`, `practice-owner`; member roles exist only for platforms and practices.", at: "export const OWNER_ROLE" },
      ],
      tests: ["src/lib/__tests__/members.test.ts"],
    },
    {
      path: "src/components/TeamMembers.tsx",
      role: "`GroupMembers`: the owners or members of a team, platform or practice, on its page and in Admin › Lists, with adding and removing where the person may.",
      requirements: [
        { text: "Owners are changed only by an admin, through `/api/admin/access` (giving or taking the role, seen from the group's side).", at: 'const ownersByAdmin = rank === "owner" && manage && perms.admin;' },
        { text: "Members are changed by an admin or an owner of that platform or practice (`canManageMembers`).", at: "const membersByManager =" },
        { text: "Adding a member goes through `/api/groups/…/members`; an answer with a note (already an owner or member) is shown as information, a new member with Undo.", at: "const r = await addGroupMember(kind, id, who);" },
        { text: "A group that is not saved yet shows no people: nobody can belong to something that does not exist.", at: "if (!saved) return null;" },
      ],
      tests: ["e2e/members.spec.ts", "e2e/groups.spec.ts", "e2e/lists.spec.ts"],
    },
    {
      path: "src/lib/responsibilities.ts",
      role: "What somebody answers for, from their roles: the processes and standards of their teams, platforms and practices, and what needs doing about them now.",
      requirements: [
        { text: "Only a member: the item asks nothing but its drafts; otherwise overdue and due reviews, open feedback, what waits to be published, own drafts and a missing review rhythm, most urgent first.", at: "export function responsibilities(" },
        { text: "What waits to be published, by who saved it last; saves the portal made itself (`import`, `system`) are nobody's work to hand over.", at: "const PORTAL = new Set" },
        { text: "The number on the top bar counts overdue reviews, open feedback and what waits for the person to publish; reviews only due soon do not count.", at: "export const urgent = (" },
      ],
      tests: ["src/lib/__tests__/responsibilities.test.ts", "src/lib/__tests__/review.test.ts", "e2e/mine.spec.ts"],
    },
    {
      path: "src/components/MinePage.tsx",
      role: "My responsibilities (`#/mine`): what the person's teams, platforms and practices hold, what needs doing now, and how the rest stands.",
      requirements: [
        { text: "Uses `responsibilities` with `meta` (first publication, who saved last) and the signed-in address; a review is confirmed through `onReviewed`, which never touches a draft.", at: "export function MinePage(" },
        { text: "\"Your unfinished work\" is only unpublished changes the person saved last themselves; somebody else's wait under \"Waiting for you to publish\".", at: "const changed = owned.filter(" },
      ],
      tests: ["e2e/mine.spec.ts"],
    },
    {
      path: "src/lib/requests.ts",
      role: "Requests for a process or standard that does not exist yet: their shape, filters, order, the check before sending, similar titles and the address of the list.",
      requirements: [
        { text: "Before asking, what exists with a similar title is shown: at least two shared words (the only word of a one-word title).", at: "export function similarTitles<" },
        { text: "A vote is shown at once and put back when the server refuses it.", at: "export function toggledVote(" },
        { text: "Only a published document that is not retired can answer a request.", at: "export function answerChoices<" },
        { text: "The state and the kind shown are read from the address.", at: "export function parseRequestsQuery(" },
      ],
      tests: ["src/lib/__tests__/requests.test.ts"],
    },
    {
      path: "src/components/RequestsPage.tsx",
      role: "Requests (`#/requests`): ask for something missing, vote, and move a request along.",
      requirements: [
        { text: "The actions of a request come from what the server says of it: plan, done, decline and back to open with `canManage`, withdraw for one's own open request, remove for an admin.", at: "export function requestActions(" },
        { text: "One vote on its way per request; shown at once, put back on a refusal.", at: "put(toggledVote(r));" },
      ],
      tests: ["src/lib/__tests__/adminFrame.test.ts", "src/lib/__tests__/requests.test.ts", "e2e/requests.spec.ts"],
    },
    {
      path: "src/lib/users.ts",
      role: "Admin › Access as plain functions: the roles and what they allow, the dialog's choices, what changes, and what stops a save or a delete.",
      requirements: [
        { text: "Save is stopped, in words, for a new address that is not one or already has roles, a group role without its group or with one no longer in the lists, the last admin losing the role, and an admin taking their own admin role.", at: "export function roleProblems(" },
        { text: "Nobody deletes themselves, an admin named in `PM_ADMINS`, or the last admin.", at: "export function deleteBlocked(" },
        { text: "The last admin: an admin not named in `PM_ADMINS` with no other admin stored or named.", at: "export function isLastAdmin(" },
        { text: "The dialog sends the complete set of roles, each group role once per chosen group.", at: "export function rolesOf(" },
      ],
      tests: ["src/lib/__tests__/users.test.ts", "e2e/users.spec.ts"],
    },
    {
      path: "src/components/UsersSection.tsx",
      role: "Admin › Access: everyone with a role, one entry per person, the dialog that sets all their roles, and Delete that takes them all away.",
      requirements: [
        { text: "A save sends the whole set with `PUT /api/admin/users/{email}`; the server's refusal is shown in the dialog.", at: "saveUserRoles(address, after)" },
        { text: "The admin role given by `PM_ADMINS` is shown as set where the portal is installed and cannot be switched off here.", at: 'const fixed = role === "admin" && !!user?.bootstrap;' },
      ],
      tests: ["e2e/users.spec.ts"],
    },
    {
      path: "src/users.css",
      role: "The look of Admin › Access: the list of people and the roles dialog.",
      requirements: [{ text: "Colours only through tokens.", at: ".users-bar {" }],
    },
    {
      path: "src/mine.css",
      role: "The look of My responsibilities.",
      requirements: [{ text: "Unpublished changes are marked as a state (the accent), not as a warning.", at: ".tier-tag.unpublished" }],
    },
    {
      path: "src/requests.css",
      role: "The look of the requests page (and of Admin › Statistics, which imports it).",
      requirements: [{ text: "Colours only through tokens.", at: ".req-hero {" }],
    },
  ],
  start: "src/lib/rights.ts",
};
