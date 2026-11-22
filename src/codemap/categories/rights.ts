import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

const RIGHTS_TESTS = ["server/internal/rbac/rbac_test.go", "server/internal/rbac/users_test.go"];

export const rights: CodeCategory = {
  id: "rights",
  area: "server",
  title: "Rights",
  summary:
    "Decides in the Go server who may read, draft, publish and change what, and refuses everything else whatever the app shows. " +
    "`rbac` turns a person's role assignments into `Perms` and answers questions such as `CanEdit`, `CanDraft` and `CanSeeDraft`; every handler in `httpapi` asks them before it changes or shows anything. " +
    "There are nine roles; five of them are limited to one team, platform or practice. The app's `src/lib/rights.ts` follows the same rules only to hide controls.",
  requirements: [
    "Every right is checked in the server (`server/internal/httpapi`, with `server/internal/rbac`); the app only hides controls and is never trusted.",
    "Every `/api/admin/…` route is wrapped in `admin(…)`: a signed-in person who is not an admin gets 403 \"Only admins can do that.\"",
    "When the roles cannot be read from the database, the person is treated as a reader (`rbac.PermsFrom(nil, false)`), never given more.",
    "An admin has every right: `PermsFrom` sets the lists, every process and every standard for an admin; an admin named in `PM_ADMINS` is an admin without any stored role and cannot be removed in the portal.",
    "A save that stays a never-published draft needs `CanDraft` (editors of the kind, owners and members of its platform or practice); anything readers would see - a save of a published document, publishing, retiring, unpublishing, bringing back, deleting - needs `CanEdit`; a member gets 403 naming who can.",
    "A first publication needs an owner of the whole placement - both the platform and the practice when it has both - or an editor of the kind; somebody who edits only through a platform or practice can neither take a document from another platform or practice nor move theirs away (`Misplaced`, `MisplacedDraft`).",
    "The rights of a save are checked inside the save's transaction, under the document's lock, against the stored version and the new content (`docs.Change.Check`).",
    "A draft somebody may not see does not exist for them: lists, history, single versions, working drafts, feedback, counts, bookmarks, upvotes, skills, review and delete answer as for an id that does not exist; a save answers as for an id that something else has taken (409), the one thing that cannot be hidden; a request it answers does not name it.",
    "Owners (team, platform, practice) are given and taken by admins only (`/api/admin/…`); the owners of a platform or practice add and remove its members (`/api/groups/…/members`); a team has no members.",
    "The last admin cannot lose the admin role (409) unless `PM_ADMINS` names one; changes that take roles away are serialised by an advisory lock, so two admins removing each other cannot both succeed.",
  ],
  charts: [
    {
      caption: "The checks of a save of a process or standard before its transaction (`save` in `content.go`). They depend on the body alone, so the answer is the same whether the id exists or not.",
      process: flow("code-rights-before", "A save reaches the server", "Session, the right to draft the new content, the format.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Send PUT /api/processes/{id}", "browser", "task", ["session"], "with X-Requested-With"),
          s("session", "Valid session, not signed out?", "server", "verify", [["candraft", "Yes"], ["r401", "No"]], "requireUser"),
          s("r401", "Answer 401 Please sign in", "server", "communication", []),
          s("candraft", "May draft the new content?", "server", "verify", [["format", "Yes"], ["r403", "No"]], "CanDraft(next)"),
          s("r403", "Answer 403 with what is missing", "server", "communication", [], "deniedFor"),
          s("format", "Check format and checker", "server", "verify", ["lock"], "schema, docs.Check"),
          s("lock", "Lock the document, read stored", "pg", "task", [], "then the next chart"),
        ]),
    },
    {
      caption: "The checks inside the save's transaction (`Check` of `docs.Change` in `save`). A hidden draft is refused last, after every other check ran as for a new document. A first publication needs an owner of every platform and practice it names; otherwise `Misplaced` checks a move.",
      process: flow("code-rights-save", "May this person save or publish this?", "The stored version against the new content, under the document's lock.",
        [["server", "Server"], ["pg", "Postgres"]],
        [
          s("stays", "Stays a never-published draft?", "server", "decision", [["draftplace", "Yes"], ["edit", "No"]], "a hidden draft counts as new"),
          s("draftplace", "Placed where they own or belong?", "server", "verify", [["visible", "Yes"], ["r403", "No"]], "MisplacedDraft"),
          s("edit", "May edit stored and new content?", "server", "verify", [["place", "Yes"], ["r403", "No"]], "CanEdit"),
          s("place", "Owns the move or whole placement?", "server", "verify", [["visible", "Yes"], ["r403", "No"]], "Misplaced"),
          s("r403", "Answer 403 naming who can", "server", "communication", []),
          s("visible", "Stored draft hidden from caller?", "server", "decision", [["hidden", "Yes"], ["store", "No or none"]], "canSee"),
          s("hidden", "Answer as for a taken or deleted id", "server", "communication", [], "409, gives nothing away"),
          s("store", "Store version and Activity entry", "pg", "document", [], "skills and index follow"),
        ]),
    },
    {
      caption: "Admins give any role (Admin › Access, `PUT /api/admin/users/{email}`); a single role through `POST /api/admin/access` gets the same checks.",
      process: flow("code-rights-roles", "An admin sets a person's roles", "The checks behind Admin › Access.",
        [["admin", "Admin"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("set", "Set a person's roles", "admin", "task", ["isadmin"]),
          s("isadmin", "Is the caller an admin?", "server", "verify", [["check", "Yes"], ["no", "No"]], "admin()"),
          s("no", "Answer 403", "server", "communication", []),
          s("check", "Check each role and its scope", "server", "verify", ["replace"], "rbac.Check, the lists"),
          s("replace", "Lock roles, read the person's", "pg", "task", ["last"], "one transaction, advisory lock"),
          s("last", "Last admin losing admin?", "server", "decision", [["r409", "Yes"], ["log", "No"]], "keepAnAdmin"),
          s("r409", "Answer 409, change nothing", "server", "communication", []),
          s("log", "Replace roles, log access.change", "pg", "document", [], "Activity after the commit"),
        ]),
    },
    {
      caption: "The owners of a platform or practice add and remove its members on the group's page (`addMember`, `removeMember` in `groups.go`). Owner roles are never given here.",
      process: flow("code-rights-members", "An owner adds a member", "The one way somebody who is not an admin gives a role.",
        [["owner", "Platform owner"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("addm", "Add a member to the platform", "owner", "task", ["owns"], "POST /api/groups/…/members"),
          s("owns", "Admin or owner of this group?", "server", "verify", [["mail", "Yes"], ["no", "No"]], "ownsGroup"),
          s("no", "Answer 403", "server", "communication", []),
          s("mail", "Check the address", "server", "verify", ["grant"], "no invisible characters"),
          s("grant", "Grant the member role only", "pg", "document", ["logm"], "never an owner role"),
          s("logm", "Write access.grant to Activity", "pg", "document", []),
        ]),
    },
  ],
  tables: [
    {
      name: "role_assignments",
      purpose: "One role given to one person, possibly limited to one team, platform or practice. A person's rights are all their rows together.",
      columns: [
        { name: "email", type: "text", note: "lower case, trimmed" },
        { name: "role", type: "text", note: "one of the nine roles" },
        { name: "scope", type: "text", note: "team, platform or practice id; '' for roles that cover everything" },
        { name: "granted_by", type: "text", note: "email of the admin or owner, or \"development setup\"" },
        { name: "granted_at", type: "timestamptz" },
      ],
      keys: [
        "primary key (email, role, scope): giving the same role twice changes nothing",
        "check role in ('admin', 'catalog-manager', 'process-editor', 'standards-editor', 'owner', 'platform-owner', 'practice-owner', 'platform-member', 'practice-member') - widened by migrations 004 and 011",
      ],
      createdIn: "server/internal/db/migrations/002_content_roles_skills.sql",
      writtenBy: ["server/internal/rbac/rbac.go", "server/cmd/server/main.go", "server/internal/upgrade/lists.go"],
      readBy: ["server/internal/rbac/rbac.go", "server/internal/upgrade/lists.go", "server/internal/httpapi/api.go", "server/internal/httpapi/content.go", "server/internal/httpapi/users.go"],
      rules: [
        "A role that covers everything is stored without a scope; a scoped role always has one (`rbac.Check`). An old row that breaks this gives nothing (`PermsFrom`).",
        "Whether the scope exists in the lists is checked by the caller (`grantAccess`, `putUser`), not by the table.",
        "Admins named in `PM_ADMINS` have no row: they are admins by the server settings.",
      ],
    },
  ],
  examples: [
    {
      title: "A member tries to publish a change directly",
      caption: "Morgan (platform member for Google Cloud) saves the published process `request-gcp-project` with an ordinary save instead of Save draft.",
      stages: [
        {
          label: "What the server knows about Morgan",
          where: "server/internal/rbac/rbac.go",
          shape: `{"admin": false, "catalog": false, "processes": false, "standards": false,
 "owns": [], "platforms": [], "practices": [],
 "memberPlatforms": ["google-cloud"], "memberPractices": ["engineering"]}`,
          note: "`PermsFrom` over Morgan's two rows in `role_assignments`; this is also `perms` in `GET /api/me`.",
        },
        {
          label: "The request",
          shape: `PUT /api/processes/request-gcp-project?base=1
X-Requested-With: process-manager

{"id": "request-gcp-project", "owner": "cloud-platform-team", "platform": "google-cloud", "status": "active", …}`,
          note: "`CanDraft` of the new content is true (member of `google-cloud`), so the format and checker run.",
        },
        {
          label: "Inside the save's transaction",
          where: "server/internal/httpapi/content.go",
          shape: `stored  = {Owner: "cloud-platform-team", Platform: "google-cloud"}
draftOnly = false   // the stored document is published
CanEdit("process", stored) = false
CanDraft("process", stored) = true   → notPublisher{first: false}`,
          note: "Nothing is stored; the transaction ends.",
        },
        {
          label: "The answer",
          shape: `403 {"error": "Only an owner of the platform “Google Cloud”, or a process editor, can change this process as readers see it. Save your changes as a draft for them."}`,
          note: "Worded by `notPublisher` and `publishWords`: who can, and what Morgan can do instead.",
        },
      ],
    },
  ],
  start: "server/internal/rbac/rbac.go",
  files: [
    {
      path: "server/internal/rbac/rbac.go",
      role: "The roles, the rights worked out from them (`Perms`), the questions every handler asks, and the store of role assignments.",
      requirements: [
        { text: "A role that covers everything but carries a scope (left by an earlier version) gives nothing: otherwise a \"standards editor for security\" would edit every standard. Test: `TestALimitedRoleThatCoversEverythingGivesNothing`.", at: "if a.Scope != \"\" && ScopeList(a.Role) == \"\" {" },
        { text: "An admin is also lists manager, process editor and standards editor: `CanEdit` and `EditsAll` never test `Admin` themselves, so without this line an admin could not edit.", at: "p.Catalog, p.Processes, p.Standards = true, true, true" },
        { text: "The owning team (`Owns`) is not in this expression: a team's Owners confirm reviews and answer feedback but never change content. An empty platform or practice matches nobody (`in` refuses \"\"), so a document on neither is for the editors of its kind only.", at: "return p.Processes || in(p.Platforms, b.Platform) || in(p.Practices, b.Practice)" },
        { text: "Members only ever reach drafts: every save readers would see asks `CanEdit` in `save`; a handler that asked `CanDraft` there would let members publish. Test: `TestMembersWorkOnDraftsAndPublishNothing`.", at: "return p.CanEdit(kind, b) || p.MemberFor(b)" },
        { text: "Wider than `CanDraft`: a team's Owners see a never-published document of their team but not its working draft (`editable` asks `CanDraft`). Every place that lists, counts or names documents must go through this (`canSee`, `hiddenFor`), or a draft leaks.", at: "return p.CanManageFeedback(kind, b) || ((kind == \"process\" || kind == \"standard\") && p.MemberFor(b))" },
        { text: "Both sides of a move are checked: leaving a platform needs ownership of it (no handing away), joining one too (no taking over); the other field (practice or platform) is left alone, so a document shared with somebody else's practice stays theirs. Test: `TestOwnersCannotTakeOverOrGiveAway`.", at: "if old != \"\" && !in(owned, old) {" },
        { text: "A scoped role without a scope is refused, so an owner role can never mean every team. Every way of giving a role (`grantAccess`, `putUser`, `addMember` through `Grant`, `Replace`) passes `Check`.", at: "if a.Scope == \"\" {" },
        { text: "Control and invisible formatting characters are refused, so one address cannot be made to look like another in Admin › Access. Test: `TestAnAddressHoldsNoInvisibleCharacters`.", at: "if unicode.Is(unicode.Cc, r) || unicode.Is(unicode.Cf, r) {" },
        { text: "Counted inside the transaction that holds `pg_advisory_xact_lock(7461011)` (`lockRolesKey`), so two admins removing each other at once cannot both pass; skipped when `PM_ADMINS` names an admin, who cannot be removed anyway. Test: `TestTheLastAdminIsKeptUnderConcurrency`.", at: "if others == 0 {" },
      ],
      tests: RIGHTS_TESTS,
    },
    {
      path: "server/internal/httpapi/api.go",
      role: "Builds every route: `user(…)` needs a session, `admin(…)` needs an admin; reads the person's rights on every request.",
      requirements: [
        { text: "The only check behind every `/api/admin/…` route (users, access, audit, system, statistics, theme, source): a new admin route registered with `user(…)` instead of `admin(…)` would be open to everybody signed in.", at: "if !who(r).Admin {" },
        { text: "Rights are read from `role_assignments` on every request, so a role given or taken counts at once; a failure gives the rights of a reader, never the last known ones. Test: `TestAccessIsManagedByAdminsAndTakesEffectAtOnce`.", at: "perms = rbac.PermsFrom(nil, false)" },
        { text: "Every `/api/` route except `/api/me`, `GET /api/theme` and `GET /api/theme/logo` is registered through `user(…)` or `admin(…)` and answers 401 here without a session; `/healthz`, `/readyz`, `/auth/…` and the app's own files need none. Test: `TestEverythingNeedsASession`.", at: "writeError(w, 401, \"Please sign in.\")" },
      ],
      tests: ["server/internal/httpapi/api_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "Listing, saving, reviewing and deleting processes, standards and the lists; where drafting versus publishing is enforced.",
      requirements: [
        { text: "Decided by the stored body's `status` alone: a document is a draft exactly when its status is `draft`. The lists, history, single versions, review, delete, a save, skills (`skillSource`, `listSkills`), views and bookmarks (`visibleDoc`) and a request's answer all call this; feedback (`viewer.hidden` in `feedback.go`) and counts, bookmark lists and request links (`hiddenFor` in `engagement.go`) apply the same `CanSeeDraft` themselves, so a change of the rule must be made in all three places.", at: "return status != \"draft\" || s.CanSeeDraft(kind, b)" },
        { text: "`meta[id].draft` (unpublished changes) is sent only to whoever may draft the document; a team's Owner sees the document but not that it has unpublished changes. Test: `TestListsSayWhenADocumentWasAddedAndWhoHasUnpublishedChanges`.", at: "if info, ok := drafts[d.ID]; ok && s.CanDraft(kind, belongsOf(d.Body)) {" },
        { text: "Refused before the database is asked about the id, by the new body alone, so a 403 here cannot tell the caller whether the id exists.", at: "if !s.CanDraft(kind, next) {" },
        { text: "Not a member's right: a stored document only drafts may touch needs `CanEdit` for anything readers would see; a member of its platform or practice gets `notPublisher` (403 naming who can), anybody else 403 `denied`. Test: `TestAMemberIsToldWhoCanPublish`.", at: "case !draftOnly && !s.CanEdit(kind, b):" },
        { text: "A first publication checks `Misplaced` from nothing: every platform and practice it names counts as newly added, so a draft a member placed on a practice cannot be published by a platform owner alone. Test: `TestTheFirstPublicationNeedsTheWholePlacement`.", at: "if field, _ := s.Misplaced(kind, nil, next); field != \"\" {" },
        { text: "The hidden draft is refused last, after every other check ran as for a new document: the answer is 409 saying only that the id is taken (or deleted meanwhile, for a save made from a version). Returning earlier would show which checks a draft passed. Test: `TestADraftNobodyMaySeeAnswersLikeNothingOnEverySavePath`.", at: "return errHiddenDoc" },
        { text: "A document readers do not see cannot be retired directly (400): retired would make it visible again as a retired one without a first publication.", at: "if current != nil && !hidden && unseen && docs.StatusOf(body) == \"deprecated\" {" },
        { text: "A review confirmation is the one content change a team's Owners may make: `CanManageFeedback`, after a hidden draft has already answered 404. Test: `TestWhoMayConfirmAReview`.", at: "case !s.CanManageFeedback(kind, belongs):" },
        { text: "Deleting needs `CanEdit`; a member gets 403 naming who can; anybody else gets 404 for a draft they cannot see, so a delete cannot be used to find drafts.", at: "return docs.ErrNotFound // a draft somebody cannot see does not exist for them" },
        { text: "A draft the caller cannot see and, for anybody but an admin, a deleted document give the same 404 as an id that never existed. Test: `TestHistoryIsForThoseWhoCanSeeTheDocument`.", at: "case err == nil, errors.Is(err, docs.ErrNotFound) && !s.Admin:" },
        { text: "Versions from before the last deletion are for editors of every document of the kind: somebody who creates something under an old id does not inherit its history. Test: `TestTheVersionsOfADeletedDocumentAreNotPassedOn`.", at: "if v.Version < deleted && !s.EditsAll(kind) {" },
        { text: "Refusing to remove a list entry still in use counts hidden drafts instead of naming them; the people still holding a role for it are named to admins only. Test: `TestStillInUseSaysOnlyWhatTheCallerMayKnow`.", at: "users = append(users, \"a draft you cannot see\")" },
      ],
      tests: ["server/internal/httpapi/platforms_test.go", "server/internal/httpapi/shared_test.go", "server/internal/httpapi/versions_test.go", "server/internal/httpapi/review_test.go", "server/internal/httpapi/review2_test.go", "server/internal/httpapi/neverpublished2_test.go", "server/internal/httpapi/groups_test.go", "server/internal/httpapi/drafts_test.go", "server/internal/httpapi/api_test.go"],
    },
    {
      path: "server/internal/httpapi/drafts.go",
      role: "The working draft of a process or standard: read, save, discard and publish it.",
      requirements: [
        { text: "`GET …/draft` and `POST …/publish` start here: without `CanDraft` on the stored document the answer is 404, also for a team's Owner who can see the document itself. Saving and discarding check the same inside their transaction. Test: `TestWhoMayWorkOnAWorkingDraft`.", at: "case !who(r).CanDraft(kind, belongsOf(cur.Body)):" },
        { text: "The new content must stay where the person may draft: without it a member could move a document to a platform they do not belong to and so lose it, or hand it to someone else.", at: "if field, place := s.MisplacedDraft(kind, &stored, next); field != \"\" {" },
        { text: "Publishing calls `save` with `docs.PublishDraft`: a member is refused there, a first publication needs the whole placement, and a moved draft is checked as a move. Test: `TestPublishingAMovedWorkingDraftChecksTheMove`.", at: "action: \"publish\", drafts: docs.PublishDraft, revision: rev})" },
      ],
      tests: ["server/internal/httpapi/drafts_test.go", "server/internal/httpapi/groups_test.go"],
    },
    {
      path: "server/internal/httpapi/groups.go",
      role: "The members and the details of one team, platform or practice, as its owners look after them.",
      requirements: [
        { text: "A team has no member role, so a members call for a team is 404 before any right is looked at.", at: "if !ok || (withMembers && memberRole[key] == \"\") || !docs.ValidID(id) {" },
        { text: "An admin or an owner of that same group; an owner of another group, or a member, gets 403. Test: `TestMembersAreAddedByTheOwnersOfTheirGroup`.", at: "if s := who(r); !s.Admin && !ownsGroup(s, g) {" },
        { text: "The role given here is always the member role of the group in the address, never one the request names: an owner cannot make anybody an owner.", at: "role := memberRole[g.key]" },
        { text: "Details (description, contacts) of a group: an admin, a lists manager, or an owner of that group (a team's Owner for a team); nothing else of the lists can be changed through this route. Test: `TestTheDetailsOfAGroupAreChangedByItsOwners`.", at: "if !s.Admin && !s.Catalog && !ownsGroup(s, g) {" },
      ],
      tests: ["server/internal/httpapi/groups_test.go"],
    },
    {
      path: "server/internal/httpapi/admin.go",
      role: "Admin › Access (one role at a time), the members list for everyone, the activity log, the system page, and the skills routes.",
      requirements: [
        { text: "A scope must be an entry of the right list (`teams`, `platforms` or `practices`): a role for a team that does not exist would be a role nobody can use now, and would silently start to count for whatever later gets that id (`PermsFrom` does not look at the lists).", at: "if _, ok := find(lists.ByKey(key), in.Scope); !ok {" },
        { text: "Everyone signed in may see who holds a scoped role: `rbac.Members` selects only email, role and scope, never `granted_by` or `granted_at`. Test: `TestEveryoneCanSeeWhoBelongsToWhat`.", at: "func (a *api) listMembers(w http.ResponseWriter, r *http.Request) {" },
        { text: "A skill of a draft the caller may not see answers as for an id that does not exist on every single-skill route (`GET`, versions, download, extra guidance). Test: `TestASkillOfAProcessTakenBackToDraftDoesNotExistForReaders`.", at: "return skills.Skill{}, \"\", skills.ErrNotFound" },
        { text: "The list of skills leaves out those whose document is a draft the caller may not see.", at: "if !hidden[sk.SourceKind+\"/\"+sk.SourceID] {" },
        { text: "Extra guidance is changed by whoever may edit the source document (`CanEdit`), not by its members or its team's Owners. Test: `TestExtraGuidanceIsForThoseWhoEditTheSource`.", at: "return who(r).CanEdit(sk.SourceKind, b)" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/skills_draft_test.go"],
    },
    {
      path: "server/internal/httpapi/users.go",
      role: "Admin › Access by person: a person's complete set of roles in one go, and taking all of them away.",
      requirements: [
        { text: "Every role of the set is checked as when given alone, before anything is changed: one bad role refuses the whole set, so a person is never left with half of what was meant.", at: "for _, role := range roles {" },
        { text: "Removing all of one's own roles is refused (409) by one check, `refuseOwnLastRoles`, for `DELETE` of one's own address and for `PUT` of an empty set alike, so an admin cannot lock themselves out by mistake. Taking away only some of one's own roles, the admin role included, works while another admin (or `PM_ADMINS`) is left. Test: `TestNobodyRemovesAllOfTheirOwnRoles`.", at: "if len(roles) > 0 || email != strings.ToLower(strings.TrimSpace(who(r).Email)) {" },
      ],
      tests: ["server/internal/httpapi/users_test.go", "server/internal/rbac/users_test.go"],
    },
    {
      path: "server/internal/httpapi/engagement.go",
      role: "Views, bookmarks and upvotes, filtered by what the caller may see.",
      requirements: [
        { text: "Only drafts can be hidden, so only they are read, from the generated columns of `documents` (no body); counts, bookmarks and upvotes of these keys are left out. Test: `TestADraftNeverShowsInCountsBookmarksOrUpvotes`.", at: "if !s.CanSeeDraft(d.Kind, rbac.Belongs{Owner: d.Owner, Platform: d.Platform, Practice: d.Practice}) {" },
        { text: "Counting a view, adding a bookmark or giving an upvote for a draft the caller cannot see is 404, the same as for an id that does not exist; taking a bookmark or an upvote back works for any id (204).", at: "if !canSee(who(r), kind, d.Body) {" },
      ],
      tests: ["server/internal/httpapi/engagement_test.go"],
    },
    {
      path: "server/internal/httpapi/feedback.go",
      role: "Feedback on processes and standards, as each person may see and handle it.",
      requirements: [
        { text: "Feedback on a draft is listed for, and accepted from, only those who can see the draft.", at: "return t != nil && t.Status == \"draft\" && !v.s.CanSeeDraft(kind, belongsTo(t))" },
        { text: "Marking fixed or reopening feedback on a draft the caller cannot see answers 404 before the right is checked, so a 403 cannot reveal the draft. Test: `TestFeedbackOnADraftDoesNotExistForWhoCannotSeeIt`.", at: "if err == nil && v.hidden(it.TargetKind, it.TargetID) {" },
        { text: "The same for deleting, also for the item's own author: to them the draft does not exist.", at: "err = feedback.ErrNotFound // also for its author: to them the draft does not exist" },
        { text: "Other people's feedback is handled by whoever may edit the document and the Owners of its team (`CanManageFeedback`); members of its platform or practice may not.", at: "return v.s.CanManageFeedback(kind, belongsTo(v.target(kind, id)))" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/skills_draft_test.go"],
    },
    {
      path: "server/internal/httpapi/requests.go",
      role: "Requests for a process or standard that does not exist yet.",
      requirements: [
        { text: "The state of a request is changed by whoever could create what it asks for: `CanEdit` of its kind for the platform and practice it names; a team's Owners and members may not. Test: `TestWhoMayChangeTheStateOfARequest`.", at: "return s.CanEdit(q.Kind, rbac.Belongs{Platform: q.Platform, Practice: q.Practice})" },
        { text: "Somebody else's request is removed by an admin only; the requester's own only while it is open (checked again in the delete). Test: `TestWithdrawingARequest`.", at: "if !mine && !s.Admin {" },
        { text: "The answering document's id is blanked for whoever cannot see it now (it became a draft again). Test: `TestADraftThatAnswersARequestIsNotNamedToOthers`.", at: "if q.LinkedID != \"\" && hide.has(q.Kind, q.LinkedID) {" },
      ],
      tests: ["server/internal/httpapi/requests_test.go"],
    },
    {
      path: "server/internal/httpapi/icons.go",
      role: "Uploading and serving the icons of tools and languages.",
      requirements: [
        { text: "Only lists managers (and admins, who are lists managers) upload icons; every signed-in person may read them. Test: `TestIconsAreUploadedByListsManagersAndServedToEveryone`.", at: "if !who(r).Catalog {" },
      ],
      tests: ["server/internal/httpapi/icons_test.go"],
    },
    {
      path: "server/internal/httpapi/theme.go",
      role: "The look of the portal: read by everyone, also before sign-in; changed by admins.",
      requirements: [
        { text: "The answer without sign-in holds only `look` and `revision`: who changed the look, and when, is in `GET /api/admin/theme`, for admins. Test: `TestTheLookIsReadWithoutSignInAndSetByAdmins`.", at: "_ = json.NewEncoder(w).Encode(map[string]any{\"look\": s.Look, \"revision\": s.Revision})" },
      ],
      tests: ["server/internal/httpapi/theme_test.go"],
    },
    {
      path: "server/internal/httpapi/statistics.go",
      role: "Admin › Statistics and its spreadsheet.",
      requirements: [
        { text: "Admins only (`admin()` in `api.go`), so every document is listed, drafts included, each row with its status; the routes must never move to `user(…)`. Test: `TestStatisticsShowDraftsToAdminsAsDrafts`.", at: "func (a *api) collectStatistics(w http.ResponseWriter, r *http.Request) (*statistics, bool) {" },
      ],
      tests: ["server/internal/httpapi/statistics_test.go"],
    },
    {
      path: "server/internal/httpapi/source.go",
      role: "`GET /api/admin/source`: one source file of the checkout for Admin › Code map, to admins only.",
      requirements: [
        { text: "Admins only (`admin()` in `api.go`), at most 300 files a person a minute (429 with `Retry-After`), and only where `PM_SOURCE_DIR` names a checkout whose files `git ls-files` can list; otherwise 404 for every path.", at: "if !a.sourceReads.allow(email, time.Now()) {" },
        { text: "Only a file git tracks can be read, so an untracked secret dropped into the checkout is never served; the path must also pass the allow-list, before and after links are resolved.", at: "if v.root == \"\" || !allowedSourcePath(p) || !v.tracked[p] {" },
        { text: "Opened through `os.OpenRoot`, so nothing outside the checkout is reached even if a folder is swapped for a link after the checks; the file must be regular, at most 400 KB, valid UTF-8 without NUL bytes.", at: "dir, err := os.OpenRoot(v.root)" },
        { text: "git runs with fixed arguments and an environment of its own (no global or system config, `core.fsmonitor` off), so the checkout's configuration cannot make the server run a program. Test: `TestSourceGitRunsWithAnEnvironmentOfItsOwn`.", at: "var gitArgs = []string{" },
        { text: "Every refusal is the same 404, so a path that is not allowed, not tracked, missing or not a text file cannot be told apart. Test: `TestSourceRefusesEverythingElseWithOneAnswer`.", at: "writeError(w, 404, sourceRefusedMessage)" },
      ],
      tests: ["server/internal/httpapi/source_test.go"],
    },
    {
      path: "src/lib/rights.ts",
      role: "The app's mirror of the server's rules: what controls to show. It decides nothing the server does not decide again.",
      requirements: [
        { text: "Mirrors `rbac.CanEdit`; enforced in `server/internal/httpapi` (`save`, `deleteDoc`), here only used to show Publish…, Retire and Delete.", at: "export const canEdit = (p: Perms, kind: TargetKind, doc?: Belongs) =>" },
        { text: "Mirrors `Misplaced` and the first-publication rule of `save`: if the two drift apart, Publish… is offered and then refused, or hidden although the server would accept it. Tests in `rights.test.ts` pin the cases.", at: "export function publishPlaces(" },
        { text: "Mirrors `rbac.CanDraft`; here it only opens the editing screen.", at: "export const canDraft = (p: Perms, kind: TargetKind, doc?: Belongs) =>" },
        { text: "The one wording of who sees a draft; it must name the same people as `rbac.CanSeeDraft`.", at: "export const draftAudience = (kind: TargetKind) =>" },
        { text: "Mirrors `memberCall` in `groups.go` (an admin or an owner of the group; a team has none); here it only shows the controls.", at: "export const canManageMembers = (p: Perms, kind: GroupKind, id: string) =>" },
      ],
      tests: ["src/lib/__tests__/rights.test.ts"],
    },
    {
      path: "server/internal/db/migrations/011_platform_practice_members.sql",
      role: "Adds the two member roles to the check of `role_assignments`.",
      requirements: [
        { text: "The database itself refuses a role that is not one of the nine; a new role needs a migration like this one as well as `rbac.Check`.", at: "check (role in (" },
      ],
    },
  ],
};
