import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

const RIGHTS_TESTS = ["server/internal/rbac/rbac_test.go", "server/internal/rbac/users_test.go"];

export const rights: CodeCategory = {
  id: "rights",
  area: "server",
  title: "Rights",
  summary:
    "Who may do what is decided in the Go server: `rbac` turns a person's role assignments into `Perms` and answers questions such as `CanEdit`, `CanDraft` and `CanSeeDraft`; every handler in `httpapi` asks them before it changes or shows anything. " +
    "There are nine roles; five of them are limited to one team, platform or practice. The app's `src/lib/rights.ts` follows the same rules only to hide controls: a request the app would not offer is still refused by the server.",
  requirements: [
    "Every right is checked in the server (`server/internal/httpapi`, with `server/internal/rbac`); the app only hides controls and is never trusted.",
    "Every `/api/admin/…` route is wrapped in `admin(…)`: a signed-in person who is not an admin gets 403 \"Only admins can do that.\"",
    "When the roles cannot be read from the database, the person is treated as a reader (`rbac.PermsFrom(nil, false)`), never given more.",
    "An admin has every right: `PermsFrom` sets the lists, every process and every standard for an admin; an admin named in `PM_ADMINS` is an admin without any stored role and cannot be removed in the portal.",
    "A save that stays a never-published draft needs `CanDraft` (editors of the kind, owners and members of its platform or practice); anything readers would see - a save of a published document, publishing, retiring, unpublishing, bringing back, deleting - needs `CanEdit`; a member gets 403 naming who can.",
    "A first publication needs an owner of the whole placement - both the platform and the practice when it has both - or an editor of the kind; somebody who edits only through a platform or practice can neither take a document from another platform or practice nor move theirs away (`Misplaced`, `MisplacedDraft`).",
    "The rights of a save are checked inside the save's transaction, under the document's lock, against the stored version and the new content (`docs.Change.Check`).",
    "A draft somebody may not see does not exist for them: lists, history, single versions, feedback, counts, bookmarks, upvotes, review, delete and a save all answer as for an id that does not exist.",
    "Owners (team, platform, practice) are given and taken by admins only (`/api/admin/…`); the owners of a platform or practice add and remove its members (`/api/groups/…/members`); a team has no members.",
    "The last admin cannot lose the admin role (409) unless `PM_ADMINS` names one; changes that take roles away are serialised by an advisory lock, so two admins removing each other cannot both succeed.",
  ],
  charts: [
    {
      caption: "What the server checks when somebody saves a process or standard (`save` in content.go, inside `docs.Store.Save`). Publishing a working draft runs the same path.",
      process: flow("code-rights-save", "May this person save or publish this?", "The checks of one save of a process or standard, in the order the server runs them.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Send PUT /api/processes/{id}", "browser", "form", ["session"], "with X-Requested-With"),
          s("session", "Valid session, not signed out?", "server", "decision", [["candraft", "Yes"], ["r401", "No"]], "requireUser"),
          s("r401", "Answer 401 Please sign in", "server", "communication", []),
          s("candraft", "May draft the new content?", "server", "decision", [["format", "Yes"], ["r403", "No"]], "CanDraft(next)"),
          s("r403", "Answer 403 with what is missing", "server", "communication", [], "deniedFor"),
          s("format", "Check format and checker", "server", "verify", ["lock"], "schema, docs.Check"),
          s("lock", "Lock the document, read stored", "pg", "automation", ["visible"], "advisory lock"),
          s("visible", "Stored draft visible to caller?", "server", "decision", [["stays", "Yes or none"], ["hidden", "No"]], "canSee"),
          s("hidden", "Answer as for a taken or deleted id", "server", "communication", [], "409, gives nothing away"),
          s("stays", "Stays a never-published draft?", "server", "decision", [["store", "Yes: CanDraft, MisplacedDraft"], ["edit", "No"]]),
          s("edit", "May edit stored and new place?", "server", "decision", [["store", "Yes: Misplaced"], ["r403", "No"]], "CanEdit; first: whole placement"),
          s("store", "Store version and Activity entry", "pg", "automation", [], "skills and index follow"),
        ]),
    },
    {
      caption: "How roles are given: admins give any role (Admin › Access); the owners of a platform or practice add and remove only its members (the page of the group).",
      process: flow("code-rights-roles", "Giving a role", "Two doors that give roles, and the checks behind each.",
        [["admin", "Admin"], ["owner", "Platform owner"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("set", "Set a person's roles", "admin", "form", ["isadmin"], "PUT /api/admin/users/{email}"),
          s("isadmin", "Is the caller an admin?", "server", "decision", [["check", "Yes"], ["no", "No"]]),
          s("no", "Answer 403", "server", "communication", []),
          s("check", "Check each role and its scope", "server", "verify", ["replace"], "rbac.Check, lists"),
          s("replace", "Replace roles in one transaction", "pg", "automation", ["last"], "advisory lock"),
          s("last", "Last admin losing admin?", "server", "decision", [["r409", "Yes"], ["log", "No"]], "keepAnAdmin"),
          s("r409", "Answer 409, change nothing", "server", "communication", []),
          s("log", "Write access.change to Activity", "server", "document", []),
          s("addm", "Add a member to the platform", "owner", "form", ["owns"], "POST /api/groups/…/members"),
          s("owns", "Admin or owner of this group?", "server", "decision", [["grant", "Yes"], ["no", "No"]], "ownsGroup"),
          s("grant", "Grant the member role only", "pg", "automation", ["logm"], "never an owner role"),
          s("logm", "Write access.grant to Activity", "server", "document", []),
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
      readBy: ["server/internal/httpapi/api.go", "server/internal/httpapi/content.go", "server/internal/httpapi/users.go"],
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
      caption: "Morgan (platform member for Google Cloud) saves the published process request-gcp-project with an ordinary save instead of Save draft.",
      stages: [
        {
          label: "What the server knows about Morgan",
          where: "server/internal/rbac/rbac.go",
          shape: `{"admin": false, "catalog": false, "processes": false, "standards": false,
 "owns": [], "platforms": [], "practices": [],
 "memberPlatforms": ["google-cloud"], "memberPractices": ["engineering"]}`,
          note: "PermsFrom over Morgan's two rows in role_assignments; this is also `perms` in GET /api/me.",
        },
        {
          label: "The request",
          shape: `PUT /api/processes/request-gcp-project?base=1
X-Requested-With: process-manager

{"id": "request-gcp-project", "owner": "cloud-platform-team", "platform": "google-cloud", "status": "active", …}`,
          note: "CanDraft(new content) is true (member of google-cloud), so the format and checker run.",
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
          note: "Worded by notPublisher and publishWords: who can, and what Morgan can do instead.",
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
        { text: "An assignment of a role that covers everything but carries a scope gives nothing; an admin also gets the lists, every process and every standard.", at: "func PermsFrom(assignments []Assignment, bootstrap bool) Perms {" },
        { text: "Edit (save what readers see, create, delete): editors of the kind, and the owners of its platform or of its practice. The owning team is not enough.", at: "func (p Perms) CanEdit(kind string, b Belongs) bool {" },
        { text: "Draft: whoever may edit, plus the members of its platform or practice. Members never publish.", at: "func (p Perms) CanDraft(kind string, b Belongs) bool {" },
        { text: "Seeing a draft: whoever manages its feedback (editors, owners of its platform or practice, the Owners of its team) and its members; for everybody else it does not exist.", at: "func (p Perms) CanSeeDraft(kind string, b Belongs) bool {" },
        { text: "Moving a document onto or off a platform or practice needs ownership of both the old and the new one, unless the person edits every document of the kind; for a draft, membership counts too.", at: "func (p Perms) misplaced(kind string, before *Belongs, after Belongs, platforms, practices []string) (field, id string) {" },
        { text: "Every way of giving a role goes through Check: an address without control or invisible characters, a scope for exactly the scoped roles, and only known roles.", at: "func Check(a Assignment) error {" },
        { text: "The last admin cannot lose the admin role unless the server settings name a bootstrap admin; taking roles away is serialised by one advisory lock.", at: "func (s *Store) keepAnAdmin(ctx context.Context, tx pgx.Tx, email string) error {" },
      ],
      tests: RIGHTS_TESTS,
    },
    {
      path: "server/internal/httpapi/api.go",
      role: "Builds every route: `user(…)` needs a session, `admin(…)` needs an admin; reads the person's rights on every request.",
      requirements: [
        { text: "Every /api/admin/… route goes through admin(), which answers 403 to everybody who is not an admin.", at: "admin := func(h http.HandlerFunc) http.Handler {" },
        { text: "Rights are read from the database on every request, so a change of roles takes effect at once; a database failure gives the rights of a reader.", at: "perms = rbac.PermsFrom(nil, false)" },
        { text: "Every /api/ route except /api/me, GET /api/theme and GET /api/theme/logo needs a session (401 otherwise); /healthz, /readyz, /auth/… and the app's own files need none.", at: "func (a *api) requireUser(next http.HandlerFunc) http.Handler {" },
      ],
      tests: ["server/internal/httpapi/api_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "Listing, saving, reviewing and deleting processes, standards and the lists; where drafting versus publishing is enforced.",
      requirements: [
        { text: "A draft is shown only to whoever may see it (`CanSeeDraft`); everything else is for everyone signed in.", at: "func canSee(s session, kind string, body []byte) bool {" },
        { text: "`meta[id].draft` (unpublished changes) is sent only to whoever may draft the document; a team's Owner does not get it.", at: "if info, ok := drafts[d.ID]; ok && s.CanDraft(kind, belongsOf(d.Body)) {" },
        { text: "The first refusal depends on the body alone (`CanDraft` of the new content), so it is the same whether the id exists or not.", at: "if !s.CanDraft(kind, next) {" },
        { text: "A stored draft the caller may not see is treated as a new document for every check, and only then refused as if the id were taken or deleted.", at: "hidden := current != nil && kind != docs.Catalog && !canSee(s, kind, current.Body)" },
        { text: "A first publication (a stored draft or something new becoming visible) needs ownership of the whole placement: Misplaced from nothing to the new content.", at: "if field, _ := s.Misplaced(kind, nil, next); field != \"\" {" },
        { text: "Confirming a review: whoever may edit it and the Owners of its team (`CanManageFeedback`); a hidden draft answers 404.", at: "case !s.CanManageFeedback(kind, belongs):" },
        { text: "Deleting needs CanEdit; a member is told who can; a draft the caller cannot see answers 404.", at: "return docs.ErrNotFound // a draft somebody cannot see does not exist for them" },
        { text: "History: whoever can see the document; draft versions only for those who may see drafts; a deleted document's history for admins only.", at: "func (a *api) historyAccess(w http.ResponseWriter, r *http.Request) (kind, id string, ok bool) {" },
        { text: "Refusing to remove a list entry that is still used names only what the caller may see: hidden drafts are counted, and the people holding a role are named to admins only.", at: "func (a *api) stillUsed(ctx context.Context, s session, body []byte) error {" },
      ],
      tests: ["server/internal/httpapi/platforms_test.go", "server/internal/httpapi/shared_test.go", "server/internal/httpapi/versions_test.go", "server/internal/httpapi/review_test.go", "server/internal/httpapi/review2_test.go", "server/internal/httpapi/neverpublished2_test.go"],
    },
    {
      path: "server/internal/httpapi/drafts.go",
      role: "The working draft of a process or standard: read, save, discard and publish it.",
      requirements: [
        { text: "Every call starts by checking CanDraft on the stored document; for anybody else every answer is 404 \"That does not exist.\".", at: "case !who(r).CanDraft(kind, belongsOf(cur.Body)):" },
        { text: "Saving a working draft applies the rule of a save that stays a draft: CanDraft on the stored and the new content, and MisplacedDraft.", at: "if field, place := s.MisplacedDraft(kind, &stored, next); field != \"\" {" },
        { text: "Publishing goes through the ordinary save, so a member cannot publish it and a first publication needs the whole placement.", at: "func (a *api) publishDraft(kind string) http.HandlerFunc {" },
      ],
      tests: ["server/internal/httpapi/drafts_test.go", "server/internal/httpapi/groups_test.go"],
    },
    {
      path: "server/internal/httpapi/groups.go",
      role: "The members and the details of one team, platform or practice, as its owners look after them.",
      requirements: [
        { text: "Only a platform or a practice has members; a team answers 404 here.", at: "memberRole = map[string]string{\"platforms\": rbac.PlatformMember, \"practices\": rbac.PracticeMember}" },
        { text: "Adding or removing a member: an admin or an owner of that same group; only the member role is ever given or taken here, never an owner role.", at: "if s := who(r); !s.Admin && !ownsGroup(s, g) {" },
        { text: "Changing a group's description and contacts: an admin, a lists manager, or an owner of that group (a team's Owner for a team).", at: "if !s.Admin && !s.Catalog && !ownsGroup(s, g) {" },
      ],
      tests: ["server/internal/httpapi/groups_test.go"],
    },
    {
      path: "server/internal/httpapi/admin.go",
      role: "Admin › Access (one role at a time), the members list for everyone, the activity log, the system page, and the skills routes.",
      requirements: [
        { text: "Giving a role checks its form first (rbac.Check), then that its team, platform or practice is in the lists.", at: "func (a *api) grantAccess(w http.ResponseWriter, r *http.Request) {" },
        { text: "Everyone signed in may see who holds a scoped role (owners and members); who gave it and when is for admins only.", at: "func (a *api) listMembers(w http.ResponseWriter, r *http.Request) {" },
        { text: "The extra guidance of a skill is changed by whoever may edit its source document.", at: "func (a *api) canEditSkill(r *http.Request, sk skills.Skill) bool {" },
      ],
      tests: ["server/internal/httpapi/api_test.go"],
    },
    {
      path: "server/internal/httpapi/users.go",
      role: "Admin › Access by person: a person's complete set of roles in one go, and taking all of them away.",
      requirements: [
        { text: "PUT replaces the whole set of roles; every role is checked as when given alone, and the change is one transaction (rbac.Replace).", at: "func (a *api) putUser(w http.ResponseWriter, r *http.Request) {" },
        { text: "Nobody removes all of their own roles (409); the last admin is kept by rbac.", at: "if email == strings.ToLower(strings.TrimSpace(who(r).Email)) {" },
      ],
      tests: ["server/internal/httpapi/users_test.go", "server/internal/rbac/users_test.go"],
    },
    {
      path: "server/internal/httpapi/engagement.go",
      role: "Views, bookmarks and upvotes, filtered by what the caller may see.",
      requirements: [
        { text: "The drafts a caller may not see are worked out from the database's columns of each body (no body read) and left out of every count and list.", at: "func (a *api) hiddenFor(ctx context.Context, s session) (hidden, error) {" },
        { text: "Counting a view, bookmarking and upvoting need a document the caller can see; otherwise 404.", at: "func (a *api) visibleDoc(r *http.Request) (docs.Doc, error) {" },
      ],
      tests: ["server/internal/httpapi/engagement_test.go"],
    },
    {
      path: "server/internal/httpapi/feedback.go",
      role: "Feedback on processes and standards, as each person may see and handle it.",
      requirements: [
        { text: "Feedback on a draft is only listed for, and only accepted from, people who can see the draft.", at: "func (v *viewer) hidden(kind, id string) bool {" },
        { text: "Marking fixed, reopening and deleting other people's feedback: whoever may edit the document and the Owners of its team.", at: "func (v *viewer) canManage(kind, id string) bool {" },
        { text: "Anybody may delete their own feedback.", at: "if !strings.EqualFold(it.AuthorEmail, s.Email) && !a.viewer(r).canManage(it.TargetKind, it.TargetID) {" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go"],
    },
    {
      path: "server/internal/httpapi/requests.go",
      role: "Requests for a process or standard that does not exist yet.",
      requirements: [
        { text: "The state of a request is changed by whoever could create what it asks for: CanEdit of its kind for its platform and practice.", at: "func canManageRequest(s session, q requests.Request) bool {" },
        { text: "The requester withdraws their own request while it is open; an admin removes any.", at: "if !mine && !s.Admin {" },
        { text: "The document that answers a request is not named to people who cannot see it (it became a draft again).", at: "if q.LinkedID != \"\" && hide.has(q.Kind, q.LinkedID) {" },
      ],
      tests: ["server/internal/httpapi/requests_test.go"],
    },
    {
      path: "server/internal/httpapi/icons.go",
      role: "Uploading and serving the icons of tools and languages.",
      requirements: [
        { text: "Only lists managers (and admins) upload icons; every signed-in person may read them.", at: "if !who(r).Catalog {" },
      ],
      tests: ["server/internal/httpapi/icons_test.go"],
    },
    {
      path: "server/internal/httpapi/theme.go",
      role: "The look of the portal: read by everyone, also before sign-in; changed by admins.",
      requirements: [
        { text: "GET /api/theme and /api/theme/logo need no session and say nothing about who changed the look; who changed it is in GET /api/admin/theme, for admins.", at: "func (a *api) getTheme(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/theme_test.go"],
    },
    {
      path: "server/internal/httpapi/statistics.go",
      role: "Admin › Statistics and its spreadsheet.",
      requirements: [
        { text: "Admins only (through admin() in api.go); they see every document, drafts included, each row with its status.", at: "func (a *api) collectStatistics(w http.ResponseWriter, r *http.Request) (*statistics, bool) {" },
      ],
      tests: ["server/internal/httpapi/statistics_test.go"],
    },
    {
      path: "server/internal/httpapi/source.go",
      role: "GET /api/admin/source: one source file of the checkout for Admin › Code map, to admins only.",
      requirements: [
        { text: "Admins only (admin() in api.go), and only where PM_SOURCE_DIR is set; otherwise 404.", at: "func (a *api) source(w http.ResponseWriter, r *http.Request) {" },
        { text: "What may be read is an allow-list: a cleaned relative path of letters, digits and . _ - /, no hidden file or folder except .github/workflows/, nothing named like a secret, only known source endings and Dockerfile.", at: "func allowedSourcePath(p string) bool {" },
        { text: "The path after symbolic links are resolved must stay inside the folder and pass the same allow-list; at most 400 KB of valid UTF-8 without NUL bytes.", at: "func readSource(root, p string) ([]byte, bool) {" },
        { text: "Every refusal is the same 404 answer, so nothing about the folder can be probed.", at: "sourceRefusedMessage = \"That file cannot be shown.\"" },
      ],
    },
    {
      path: "src/lib/rights.ts",
      role: "The app's mirror of the server's rules: what controls to show. It decides nothing the server does not decide again.",
      requirements: [
        { text: "Follows rbac.CanEdit: editors of the kind, or an owner of its platform or practice.", at: "export const canEdit = (p: Perms, kind: TargetKind, doc?: Belongs) =>" },
        { text: "Follows the server's Misplaced and the first-publication rule, so Publish… is offered exactly when the server would accept it.", at: "export function publishPlaces(" },
        { text: "Follows rbac.CanDraft: whoever may edit, and the members of its platform or practice.", at: "export const canDraft = (p: Perms, kind: TargetKind, doc?: Belongs) =>" },
        { text: "The one wording of who sees a draft.", at: "export const draftAudience = (kind: TargetKind) =>" },
        { text: "Members of a platform or practice are managed by an admin or one of its owners; a team has none.", at: "export const canManageMembers = (p: Perms, kind: GroupKind, id: string) =>" },
      ],
      tests: ["src/lib/__tests__/rights.test.ts"],
    },
    {
      path: "server/internal/db/migrations/011_platform_practice_members.sql",
      role: "Adds the two member roles to the check of role_assignments.",
      requirements: [
        { text: "The database itself refuses a role that is not one of the nine.", at: "check (role in (" },
      ],
    },
  ],
};
