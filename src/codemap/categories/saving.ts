import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// docs.Store.Save and the working draft: the one way a version comes into being.

export const saving: CodeCategory = {
  id: "saving",
  area: "data",
  title: "A save and its versions",
  summary:
    "Every change to a process, a standard or the lists is a new version, written by one function, docs.SaveIn, in one transaction under a lock of that document; a save made from an outdated version is refused and writes nothing. " +
    "Unpublished changes are kept beside the document as its working draft (one per document, with a revision of its own) and leave it only through the same save: published (PublishDraft), stored as a never-published document (ReplaceDraft), or discarded. " +
    "Content stored by an earlier version of the portal is converted at start by server/internal/upgrade, through the same save.",
  requirements: [
    "Every version with a body comes from docs.SaveIn: one transaction, under pg_advisory_xact_lock(hashtextextended('<kind>/<id>', 7461)), so two saves of one document (also two first saves) run one after the other. The one other writer of a version, Store.Remove (a deletion, null body), takes the same lock.",
    "A save whose base is not the current version is refused with a *docs.Conflict (409, with who saved in between) and writes nothing; base=0 means \"I am creating this\" and is refused when the document exists; no base (imports, the conversion) skips the check.",
    "A body that equals the stored one after re-indenting creates no version (changed: false); a body whose id differs from the address, that is not a JSON object or not valid UTF-8 is refused before the lock.",
    "Version numbers continue from max(version) + 1 over document_versions, also after a deletion, which is itself a version with a null body.",
    "While a working draft exists, a person's ordinary save of that document (RefuseIfDraft: also unpublishing and retiring) is refused with *docs.DraftPending (409). Imports, the conversion and review confirmations save with KeepDraft and leave the draft as it is.",
    "Publishing a working draft (PublishDraft) or storing a never-published document from it (ReplaceDraft) deletes the draft in the same transaction; when the draft is gone or has another revision the save is a *docs.DraftConflict (409) and nothing is written.",
    "A save from a working draft that makes no new version (the body equals the stored one) still removes the draft and runs DraftDropped, which logs process.discard / standard.discard: no draft disappears without a trace.",
    "changes_by is filled only when a person's save publishes changes somebody else saved last (the working draft's updated_by, or the never-published version's updated_by), and only when that is an email other than the saver's.",
    "A review confirmation is an ordinary versioned save from the version that was read; it moves a working draft based on that version onto the new one (MoveDraftBaseIn), revision and body unchanged.",
    "The conversion of older content runs under the migrations lock, saves through docs.SaveIn with Note \"Moved to the new lists\" by system, adjusts older versions and working drafts in place, and finds nothing to do the second time.",
  ],
  charts: [
    {
      process: flow(
        "code-saving-ordinary",
        "An ordinary save",
        "PUT /api/processes/{id}?base=N: what is checked, in the order the code checks it.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Save the document with base=N", "browser", "form", ["checks"], "PUT …?base=N&note="),
          s("checks", "Check rights, format and checker", "server", "verify", ["lock"], "before the lock"),
          s("lock", "Lock this document", "pg", "code", ["stored"], "advisory, per transaction"),
          s("stored", "Check rights on the stored one", "server", "verify", ["base"], "Change.Check"),
          s("base", "Is N still the current version?", "server", "decision", [["draft", "Yes"], ["conflict", "No"]]),
          s("conflict", "Answer 409 with who saved", "server", "communication", [], "nothing written"),
          s("draft", "Has it a working draft?", "server", "decision", [["pending", "Yes"], ["same", "No"]]),
          s("pending", "Answer 409: publish or discard first", "server", "communication", [], "DraftPending"),
          s("same", "Is the body unchanged?", "server", "decision", [["nothing", "Yes"], ["write", "No"]]),
          s("nothing", "Answer changed: false", "server", "communication", [], "no version"),
          s("write", "Store version max + 1 and its entry", "pg", "automation", ["follow"], "documents, versions, audit_log"),
          s("follow", "Regenerate skills, sync the index", "server", "automation", [], "syncSkills"),
        ],
      ),
      caption:
        "docs.SaveIn with Drafts: RefuseIfDraft, as httpapi putDoc calls it. Everything from the lock to the write is one transaction; skills follow after the commit, the index in the background.",
    },
    {
      process: flow(
        "code-saving-draft",
        "A working draft, from Save draft to Publish",
        "A member saves unpublished changes; an owner publishes them; somebody may have published in between.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("save", "Save draft with rev=R", "browser", "form", ["rev"], "PUT …/draft?rev=R"),
          s("rev", "Is R the stored revision?", "server", "decision", [["store", "Yes"], ["revConflict", "No"]]),
          s("revConflict", "Answer 409 draft conflict", "server", "communication", [], "draft: true"),
          s("store", "Store the draft as revision R+1", "pg", "automation", ["publish"], "working_drafts"),
          s("publish", "Publish with rev=R+1", "browser", "form", ["atBase"], "POST …/publish"),
          s("atBase", "Still at the draft's base?", "server", "decision", [["prepare", "Yes"], ["onlyReview", "No"]]),
          s("onlyReview", "Only a review confirmation since?", "server", "decision", [["prepare", "Yes: move base"], ["conflict", "No"]]),
          s("conflict", "Answer 409 version conflict", "server", "communication", ["over"], "SaveIn refuses the old base"),
          s("over", "Publish over it with over=V", "browser", "form", ["prepare"], "the person decided"),
          s("prepare", "Keep published status and review", "server", "code", ["write"], "ForPublishing"),
          s("write", "Save version, delete the draft", "pg", "automation", ["follow"], "SaveIn, PublishDraft"),
          s("follow", "Regenerate skills, sync the index", "server", "automation", [], "background"),
        ],
      ),
      caption:
        "httpapi putDraft → docs.Store.SaveDraft, then publishDraft: it picks the base (the draft's, the current version when only a review came in between, or over), runs docs.ForPublishing, then the ordinary save with Drafts: PublishDraft, which refuses a base that is no longer current. The draft and the new version change in the same transaction; a draft that fails a check stays as it was.",
    },
  ],
  examples: [
    {
      title: "Publishing keeps the published status and review record",
      caption: "docs.ForPublishing on the sample process: the draft's status is ignored, the review rhythm comes from the draft, the review record from the published version.",
      stages: [
        {
          label: "Published version 1 (documents.body)",
          where: "processes/request-gcp-project.json",
          shape: `"status": "active",
"review": { "intervalMonths": 6, "lastReviewedAt": "2026-11-03", "reviewedBy": "Process owner" }`,
        },
        {
          label: "The working draft (working_drafts.body)",
          where: "server/internal/docs/drafts.go",
          shape: `"status": "draft",
"review": { "intervalMonths": 12 },
"estimatedDuration": "2-4 working days"`,
          note: "A draft need not pass the format or the checker; only CheckDraftBody's limits apply.",
        },
        {
          label: "What is saved as version 2",
          where: "server/internal/docs/drafts.go",
          shape: `"status": "active",
"review": { "intervalMonths": 12, "lastReviewedAt": "2026-11-03", "reviewedBy": "Process owner" },
"estimatedDuration": "2-4 working days"`,
          note: "Status from the published version (a never-published document becomes active); lastReviewedAt and reviewedBy from the published version; the order of the keys is kept.",
        },
      ],
    },
    {
      title: "The refusals, as the app receives them",
      caption: "The 409 answers of a save, from httpapi conflict, draftPending and draftConflict.",
      stages: [
        {
          label: "Saved from an outdated version",
          where: "server/internal/httpapi/content.go",
          shape: `409 {"error": "<name or email> saved a newer version (version 2) while you were working on this.",
     "conflict": {"exists": true, "version": 2, "status": "active", "updatedAt": "…", "updatedBy": "…", "updatedByName"?: "…"}}`,
        },
        {
          label: "An ordinary save while unpublished changes exist",
          where: "server/internal/httpapi/drafts.go",
          shape: `409 {"error": "This process has unpublished changes by Morgan Member. Publish or discard them first, then make this change.",
     "draft": {"updatedAt": "…", "updatedBy": "morgan@example.com", "updatedByName": "Morgan Member"}}`,
        },
        {
          label: "The working draft moved on",
          where: "server/internal/httpapi/drafts.go",
          shape: `409 {"error": "Morgan Member saved newer unpublished changes while you were working on this.",
     "conflict": {"exists": true, "draft": true, "version": 3, "updatedAt": "…", "updatedBy": "morgan@example.com", "updatedByName": "Morgan Member"}}`,
          note: "version is the draft's revision here.",
        },
      ],
    },
  ],
  files: [
    {
      path: "server/internal/docs/docs.go",
      role: "The store of documents: Save / SaveIn (the one way a version is written), Remove, History, Published, import and export.",
      requirements: [
        { text: "Every change to one document, creating it included, takes this lock first.", at: "func lock(ctx context.Context, tx pgx.Tx, kind, id string) error {" },
        { text: "Checks in this order: id and body, the lock, Change.Check, the working draft (gone or other revision), base, then RefuseIfDraft.", at: "func SaveIn(ctx context.Context, tx pgx.Tx, c Change) (doc Doc, changed bool, err error) {" },
        { text: "base nil skips the check; 0 means creating; anything else must be the current version.", at: "func checkBase(base *int, cur *Doc) error {" },
        { text: "An unchanged body makes no version; a draft it came from is removed and DraftDropped runs.", at: "if cur != nil && bytes.Equal(cur.Body, pretty) {" },
        { text: "Numbering continues over deletions.", at: "// continue the numbering even if the document was deleted in between" },
      ],
      tests: ["server/internal/docs/docs_test.go", "server/internal/httpapi/versions_test.go"],
    },
    {
      path: "server/internal/docs/drafts.go",
      role: "Working drafts: what one must be, saving and discarding it with a revision, the draft rules of a save, and preparing a draft for publishing.",
      requirements: [
        { text: "A draft is a JSON object with the id of the address, storable text, at most 1 MB and 32 levels; it need not pass the format.", at: "func CheckDraftBody(id string, body []byte) ([]byte, error) {" },
        { text: "rev=0 starts a draft and is refused when one exists; any other rev must be the stored one; base may start a draft on an older version of this document, never of one deleted before it.", at: "func (s *Store) SaveDraft(ctx context.Context, c DraftChange) (WorkingDraft, error) {" },
        { text: "A discard names the revision it discards.", at: "func (s *Store) DiscardDraft(" },
        { text: "Publishing keeps the stored status (a never-published document becomes active) and the published review record.", at: "func ForPublishing(draft, published []byte) ([]byte, error) {" },
        { text: "A review confirmation moves only a draft based on exactly the reviewed version.", at: "func MoveDraftBaseIn(" },
      ],
      tests: ["server/internal/docs/drafts_test.go", "server/internal/httpapi/drafts_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "The HTTP side of a save, a review confirmation and a delete: rights, format and checker, then docs.Store.Save with the right draft rule.",
      requirements: [
        { text: "A person's ordinary save of a process or standard uses RefuseIfDraft; draft=R makes it ReplaceDraft.", at: "rule = docs.RefuseIfDraft" },
        { text: "Every save of a person goes through save: the format, docs.Check, the lists still used, then the store with Check and After.", at: "func (a *api) save(w http.ResponseWriter, r *http.Request, sv saving) {" },
        { text: "A draft that leaves without a version is logged as a discard.", at: "DraftDropped: func(ctx context.Context, tx pgx.Tx, d docs.WorkingDraft) error {" },
        { text: "A review confirmation moves a draft based on the reviewed version, in the same transaction.", at: "if err := docs.MoveDraftBaseIn(ctx, tx, kind, id, current.Version, saved.Version); err != nil {" },
        { text: "A delete removes feedback, bookmarks, upvotes and counts, marks views and downloads, marks a request it answered (linked_gone), and records the delete, all in one transaction.", at: "func (a *api) deleteDoc(kind string) http.HandlerFunc {" },
      ],
      tests: ["server/internal/httpapi/versions_test.go", "server/internal/httpapi/review_test.go", "server/internal/httpapi/review2_test.go", "server/internal/httpapi/neverpublished_test.go"],
    },
    {
      path: "server/internal/httpapi/drafts.go",
      role: "GET, PUT and DELETE /api/{processes|standards}/{id}/draft and POST …/publish.",
      requirements: [
        { text: "Publishing saves on top of the draft's base; over=V publishes over a newer version; a base that differs only by a review is moved onto the current version.", at: "if err == nil && docs.OnlyReviewDiffers(was, cur.Body) {" },
        { text: "Publishing is the ordinary save with PublishDraft: the same checks and activity entry.", at: "func (a *api) publishDraft(kind string) http.HandlerFunc {" },
        { text: "Saving a draft is not in the activity log.", at: "// saving a draft is not in the activity log: it happens every few seconds" },
        { text: "For whoever may not draft the document every answer is 404 \"That does not exist.\"", at: "func notThere(w http.ResponseWriter) { writeError(w, 404, \"That does not exist.\") }" },
      ],
      tests: ["server/internal/httpapi/drafts_test.go", "server/internal/httpapi/neverpublished2_test.go"],
    },
    {
      path: "server/internal/docs/review.go",
      role: "Writes a review confirmation into a body and edits top-level fields without changing the order of the others.",
      requirements: [
        { text: "Only review changes: the rhythm is kept (or the default given), lastReviewedAt and reviewedBy are set.", at: "func WithReview(body []byte, date, by string, defaultMonths int) ([]byte, error) {" },
      ],
      tests: ["server/internal/httpapi/review_test.go"],
    },
    {
      path: "server/internal/upgrade/lists.go",
      role: "Converts a database of an earlier version to the lists of practices, platforms and categories, once, at start and by -migrate.",
      requirements: [
        { text: "Runs in one transaction that first locks documents against saves of a running server.", at: "lock table documents in share row exclusive mode" },
        { text: "An empty database is left alone: it is filled with content of this version.", at: "return Report{}, nil // an empty database is filled with content of this version" },
        { text: "Older versions are adjusted in place, without new versions, so that one can be put back.", at: "update document_versions set body = $4 where kind = $1 and id = $2 and version = $3" },
        { text: "Working drafts get the same changes in place; their revision stays.", at: "update working_drafts set body = $3 where kind = $1 and id = $2" },
        { text: "The account -migrate prints (Report.String) counts documents and older versions; the working drafts adjusted are counted only in the activity entry content.convert and in the log.", at: "func (r Report) String() string {" },
      ],
      tests: ["server/internal/upgrade/lists_test.go"],
    },
    {
      path: "server/internal/docs/check.go",
      role: "What a schema cannot check: that a document's parts fit together and that it names only list entries that exist; and which entries a document uses.",
      requirements: [
        { text: "Runs on every save of a person after the format; the same rules the app treats as errors.", at: "func Check(kind string, body []byte, l Lists) error {" },
        { text: "The references a document makes, for refusing to remove a used list entry.", at: "func UsesOf(kind string, body []byte) Uses {" },
      ],
      tests: ["server/internal/docs/check_test.go"],
    },
    {
      path: "server/internal/docs/contacts.go",
      role: "Contact details of a team, platform or practice: checked as the schema checks them, and written out as one repeatable line.",
      requirements: [{ text: "A link is http:// or https:// and nothing else.", at: "func ValidLink(s string) bool { return linkPattern.MatchString(s) }" }],
      tests: ["server/internal/docs/check_test.go"],
    },
    {
      path: "server/internal/docs/text.go",
      role: "Prepares a text people type (feedback, a request, a note) for storing, and says why it cannot be stored.",
      requirements: [{ text: "Refuses what cannot be stored, control characters and reading-direction characters, and a text with nothing visible.", at: "func CheckText(text, what string, lineBreaks bool) (string, string) {" }],
      tests: ["server/internal/docs/text_test.go"],
    },
  ],
  start: "server/internal/docs/docs.go",
};
