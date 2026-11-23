import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// docs.Store.Save and the working draft: the one way a version comes into being.

export const saving: CodeCategory = {
  id: "saving",
  area: "data",
  title: "A save and its versions",
  summary:
    "Every change to a process, standard or the lists becomes a new version through one function, `docs.SaveIn`, under a lock of that document. " +
    "A save made from an outdated version is refused and writes nothing. Unpublished changes are kept beside the document as its working draft (one per document, with a revision of its own) and leave it only through the same save: published (`PublishDraft`), stored as a never-published document (`ReplaceDraft`), or discarded. " +
    "Content stored by an earlier version of the portal is converted at start by `server/internal/upgrade`, through the same save.",
  requirements: [
    "Every version with a body comes from `docs.SaveIn`: one transaction, under `pg_advisory_xact_lock(hashtextextended('<kind>/<id>', 7461))`, so two saves of one document (also two first saves) run one after the other. The one other writer of a version, `Store.Remove` (a deletion, null body), takes the same lock.",
    "A save whose `base` is not the current version is refused with a `*docs.Conflict` (409, with who saved in between) and writes nothing; `base=0` means \"I am creating this\" and is refused when the document exists; no `base` (imports, the conversion) skips the check.",
    "A body that equals the stored one after re-indenting creates no version (`changed: false`); a body whose id differs from the address, that is not a JSON object or not valid UTF-8 is refused before the lock.",
    "Version numbers continue from `max(version) + 1` over `document_versions`, also after a deletion, which is itself a version with a null body.",
    "While a working draft exists, a person's ordinary save of that document (`RefuseIfDraft`: also unpublishing and retiring) is refused with `*docs.DraftPending` (409). Imports, the conversion and review confirmations save with `KeepDraft` and leave the draft as it is.",
    "Publishing a working draft (`PublishDraft`) or storing a never-published document from it (`ReplaceDraft`) deletes the draft in the same transaction; when the draft is gone or has another revision the save is a `*docs.DraftConflict` (409) and nothing is written.",
    "A save from a working draft that makes no new version (the body equals the stored one) still removes the draft and runs `DraftDropped`, which logs `process.discard` / `standard.discard`: no draft disappears without a trace.",
    "`changes_by` is filled only when a person's save publishes changes somebody else saved last (the working draft's `updated_by`, or the never-published version's `updated_by`), and only when that is an email other than the saver's.",
    "A review confirmation is an ordinary versioned save from the version that was read; it moves a working draft based on that version onto the new one (`MoveDraftBaseIn`), revision and body unchanged.",
    "The conversion of older content runs under the migrations lock, saves through `docs.SaveIn` with the note \"Moved to the new lists\" by `system`, adjusts older versions and working drafts in place, and finds nothing to do the second time.",
  ],
  charts: [
    {
      process: flow(
        "code-saving-ordinary",
        "An ordinary save",
        "PUT /api/processes/{id}?base=N: what is checked, in the order the code checks it.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Save the document with base=N", "browser", "task", ["checks"], "PUT …?base=N&note="),
          s("checks", "Check rights, format and checker", "server", "verify", ["stored"], "before the lock"),
          s("stored", "Lock it, check rights on the stored one", "server", "verify", ["base"], "advisory lock, then Change.Check"),
          s("base", "Is N still the current version?", "server", "decision", [["draft", "Yes"], ["conflict", "No"]]),
          s("conflict", "Answer 409 with who saved", "server", "communication", [], "nothing written"),
          s("draft", "Has it a working draft?", "server", "decision", [["pending", "Yes"], ["write", "No"]]),
          s("pending", "Answer 409: publish or discard first", "server", "communication", [], "DraftPending"),
          s("write", "Store version max + 1 and its entry", "pg", "document", [], "documents, versions, audit_log"),
        ],
      ),
      caption:
        "`docs.SaveIn` with `Drafts: RefuseIfDraft`, as `putDoc` calls it. Everything from the lock to the write is one transaction. A body equal to the stored one writes nothing and answers `changed: false`. After the commit `syncSkills` starts the index's sync in the background, then regenerates the skills.",
    },
    {
      process: flow(
        "code-saving-draft",
        "A working draft, from Save draft to Publish",
        "A member saves unpublished changes; an owner publishes them; somebody may have published in between.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("save", "Save draft with rev=R", "browser", "task", ["rev"], "PUT …/draft?rev=R"),
          s("rev", "Is R the stored revision?", "server", "decision", [["store", "Yes"], ["revConflict", "No"]]),
          s("revConflict", "Answer 409 draft conflict", "server", "communication", [], "draft: true"),
          s("store", "Store the draft as revision R+1", "pg", "document", ["publish"], "working_drafts"),
          s("publish", "Publish with rev=R+1", "browser", "task", ["atBase"], "POST …/publish"),
          s("atBase", "At the draft's base, or only a review since?", "server", "decision", [["write", "Yes"], ["conflict", "No"]]),
          s("conflict", "Answer 409 version conflict", "server", "communication", [["write", "Publish over it: over=V"]], "the person decides"),
          s("write", "Save the version, delete the draft", "pg", "document", [], "ForPublishing, then SaveIn"),
        ],
      ),
      caption:
        "`putDraft` → `docs.Store.SaveDraft`; then `publishDraft` picks the base (the draft's, the current version when only a review came in between, or `over`), runs `docs.ForPublishing`, then the ordinary save with `Drafts: PublishDraft`, which refuses a base that is no longer current. The draft and the new version change in the same transaction; a draft that fails a check stays as it was.",
    },
  ],
  examples: [
    {
      title: "Publishing keeps the published status and review record",
      caption: "`docs.ForPublishing` on the sample process: the draft's status is ignored, the review rhythm comes from the draft, the review record from the published version.",
      stages: [
        {
          label: "Published version 1 (`documents.body`)",
          where: "processes/request-gcp-project.json",
          shape: `"status": "active",
"review": { "intervalMonths": 6, "lastReviewedAt": "2026-11-03", "reviewedBy": "Process owner" }`,
        },
        {
          label: "The working draft (`working_drafts.body`)",
          where: "server/internal/docs/drafts.go",
          shape: `"status": "draft",
"review": { "intervalMonths": 12 },
"estimatedDuration": "2-4 working days"`,
          note: "A draft need not pass the format or the checker; only the limits of `CheckDraftBody` apply.",
        },
        {
          label: "What is saved as version 2",
          where: "server/internal/docs/drafts.go",
          shape: `"status": "active",
"review": { "intervalMonths": 12, "lastReviewedAt": "2026-11-03", "reviewedBy": "Process owner" },
"estimatedDuration": "2-4 working days"`,
          note: "Status from the published version (a never-published document becomes active); `lastReviewedAt` and `reviewedBy` from the published version; the order of the keys is kept.",
        },
      ],
    },
    {
      title: "The refusals, as the app receives them",
      caption: "The 409 answers of a save, from `conflict`, `draftPending` and `draftConflict` in `server/internal/httpapi`.",
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
          note: "`version` is the draft's revision here.",
        },
      ],
    },
  ],
  files: [
    {
      path: "server/internal/docs/docs.go",
      role: "The store of documents: `Save` / `SaveIn` (the one way a version is written), `Remove`, `History`, `Published`, import and export.",
      requirements: [
        { text: "The id inside the body must be the id of the address, checked before the lock: otherwise a save could store one document's body under another's id.", at: "if kind != Catalog && head.ID != id {" },
        { text: "Publishing or replacing from a working draft is refused (`DraftConflict`) when the draft is gone or has another revision, before `base` is looked at: the person is told about the draft first, and nothing is written.", at: "if fromDraft && (draft == nil || draft.Revision != c.Revision) {" },
        { text: "`base` is checked under the lock, after `Change.Check`: no other save of this document can come between the check and the write. Without it two people would overwrite each other unseen (`TestASaveFromAnOutdatedVersionIsRefused`, `TestSavesAtTheSameTimeNeverLoseAVersion`).", at: "if err := checkBase(c.Base, cur); err != nil {" },
        { text: "A person's ordinary save is refused while a working draft exists; letting it through would hide the unpublished changes under a version their author never saw.", at: "case c.Drafts == RefuseIfDraft && draft != nil:" },
        { text: "An unchanged body makes no version; when it came from a working draft the draft is still removed and `DraftDropped` records it, so a draft never vanishes silently.", at: "if cur != nil && bytes.Equal(cur.Body, pretty) {" },
        { text: "The next number is taken over every row of the document, deletions included, so a document deleted and created again never reuses a number.", at: "select coalesce(max(version), 0) + 1 from document_versions" },
        { text: "`changes_by` stays empty unless it is an email different from the saver's: a person publishing their own draft is not named as somebody else, and a never-published version stored by an import or the conversion (`system`, no email) names nobody.", at: "if !strings.Contains(changesBy, \"@\") || strings.EqualFold(strings.TrimSpace(changesBy), strings.TrimSpace(c.By)) {" },
      ],
      tests: ["server/internal/docs/docs_test.go", "server/internal/httpapi/versions_test.go"],
    },
    {
      path: "server/internal/docs/drafts.go",
      role: "Working drafts: what one must be, saving and discarding it with a revision, the draft rules of a save, and preparing a draft for publishing.",
      requirements: [
        { text: "A draft larger than 1 MB is refused before anything is parsed; it need not pass the format, so this and the depth limit are what stop a body built to be expensive.", at: "if len(body) > MaxDraftBytes {" },
        { text: "`rev=0` starts a draft and is refused when one exists; any other `rev` must be the stored one. Without this two editors' tabs would overwrite each other's unpublished changes (`TestWorkingDraftsInTheStore`).", at: "case have == nil && c.Revision != 0, have != nil && c.Revision != have.Revision:" },
        { text: "A `base` older than the current version must be a version of this document since its last deletion, never of an earlier document of the same id.", at: "and not exists (select 1 from document_versions where kind = $1 and id = $2 and version > $3 and body is null)" },
        { text: "A discard names the revision it discards: a draft somebody saved meanwhile is not thrown away unseen.", at: "if have == nil || have.Revision != revision {" },
        { text: "Publishing keeps the stored status (only a never-published document becomes active): a draft cannot un-retire or hide a document through its `status` field.", at: "if !Published(published) {" },
        { text: "The review record (`lastReviewedAt`, `reviewedBy`) always comes from the published version: a confirmation made while the draft was open is not lost.", at: "d = d.set(\"lastReviewedAt\", pub.get(\"lastReviewedAt\"), \"reviewedBy\", \"intervalMonths\")" },
        { text: "A review confirmation moves only a draft based on exactly the reviewed version; one based on an older version keeps its base, so its publication still meets the conflict.", at: "update working_drafts set base = $4 where kind = $1 and id = $2 and base = $3" },
      ],
      tests: ["server/internal/docs/drafts_test.go", "server/internal/httpapi/drafts_test.go"],
    },
    {
      path: "server/internal/httpapi/content.go",
      role: "The HTTP side of a save, a review confirmation and a delete: rights, format and checker, then `docs.Store.Save` with the right draft rule.",
      requirements: [
        { text: "A person's ordinary save of a process or standard uses `RefuseIfDraft`; `draft=R` makes it `ReplaceDraft`. The lists (`catalog`) have no working draft and keep `KeepDraft`.", at: "rule = docs.RefuseIfDraft" },
        { text: "Every save of a person runs the checker on the server, whatever the app checked: a body naming a list entry that does not exist is refused here.", at: "err = docs.Check(kind, body, lists)" },
        { text: "A draft that leaves without a version is logged as a discard (`process.discard`), in the same transaction.", at: "DraftDropped: func(ctx context.Context, tx pgx.Tx, d docs.WorkingDraft) error {" },
        { text: "A review confirmation moves a draft based on the reviewed version, in the save's transaction: otherwise the editing screen would say a newer version was published since the draft began (`baseBehindSentence`) when only a review came in between. Publishing itself would still go through: `publishDraft` moves the base when `OnlyReviewDiffers`.", at: "if err := docs.MoveDraftBaseIn(ctx, tx, kind, id, current.Version, saved.Version); err != nil {" },
        { text: "A delete removes feedback, bookmarks, upvotes and counts, marks views and downloads, marks a request it answered (`linked_gone`), and records the delete, all in one transaction: none of them can outlive the document half-way.", at: "if err := engagement.DeleteByTargetIn(ctx, tx, kind, id); err != nil {" },
      ],
      tests: ["server/internal/httpapi/versions_test.go", "server/internal/httpapi/review_test.go", "server/internal/httpapi/review2_test.go", "server/internal/httpapi/neverpublished_test.go"],
    },
    {
      path: "server/internal/httpapi/drafts.go",
      role: "`GET`, `PUT` and `DELETE /api/{processes|standards}/{id}/draft` and `POST …/publish`.",
      requirements: [
        { text: "Publishing saves on top of the draft's base; only when nothing but the review differs is the base moved to the current version. Anything else that changed meanwhile is a conflict the person decides (`over=V`), never overwritten unseen.", at: "if err == nil && docs.OnlyReviewDiffers(was, cur.Body) {" },
        { text: "Publishing is the ordinary save with `PublishDraft`: the same rights, format, checker and activity entry, so there is no second way to make a version.", at: "action: \"publish\", drafts: docs.PublishDraft, revision: rev})" },
        { text: "Whoever may not draft the document gets 404 \"That does not exist.\": here for reading and publishing (`editable`); `putDraft` and `deleteDraft` answer the same through their `Check` (`errHidden`). The existence of a working draft is never revealed.", at: "case !who(r).CanDraft(kind, belongsOf(cur.Body)):" },
        { text: "Saving a draft writes no activity entry: it happens every few seconds while somebody types.", at: "// saving a draft is not in the activity log: it happens every few seconds" },
      ],
      tests: ["server/internal/httpapi/drafts_test.go", "server/internal/httpapi/neverpublished2_test.go"],
    },
    {
      path: "server/internal/docs/review.go",
      role: "Writes a review confirmation into a body and edits top-level fields without changing the order of the others; says whether a day is today somewhere on Earth.",
      requirements: [
        { text: "The document's own rhythm is kept when it is a whole number of months from 1; only a document without one gets the default (6 for a process, 12 for a standard, given by the caller).", at: "if r.IntervalMonths >= 1 {" },
        { text: "The review date never goes back: somebody behind UTC confirming on their own day after somebody ahead of UTC keeps the later date. Test: `TestWithReviewNeverMovesTheReviewDateBack`.", at: "if _, err := time.Parse(time.DateOnly, r.LastReviewedAt); err == nil && r.LastReviewedAt > date {" },
        { text: "A day a person sends as their today is taken from the day at UTC-12 to the day at UTC+14; outside that it is a wrong clock. Test: `TestTodayIsTheDayOfTheZoneFromUTCMinus12ToPlus14`.", at: "func TodaySomewhere(day string, now time.Time) bool {" },
      ],
      tests: ["server/internal/httpapi/review_test.go"],
    },
    {
      path: "server/internal/upgrade/lists.go",
      role: "Converts a database of an earlier version to the lists of practices, platforms and categories, once, at start and by `-migrate`.",
      requirements: [
        { text: "The transaction first locks `documents` against saves of a server that is still running the old version: nothing can be saved between reading the documents and writing them back.", at: "lock table documents in share row exclusive mode" },
        { text: "An empty database is left alone: it is filled with content of this version.", at: "return Report{}, nil // an empty database is filled with content of this version" },
        { text: "Free-text categories are turned into entries only on a database without categories in its lists: a second run, or a newer database, finds nothing to convert.", at: "old := noCatalog || !hasCategories" },
        { text: "Older versions are adjusted in place, without new versions, so that putting one back neither fails on its category nor takes it off its platform.", at: "update document_versions set body = $4 where kind = $1 and id = $2 and version = $3" },
        { text: "Working drafts get the same changes in place; their revision stays, so an editor's open tab can still save.", at: "update working_drafts set body = $3 where kind = $1 and id = $2" },
        { text: "The account `-migrate` prints (`Report.String`) counts documents and older versions; the working drafts adjusted are counted only in the activity entry `content.convert` and in the log.", at: "func (r Report) String() string {" },
      ],
      tests: ["server/internal/upgrade/lists_test.go"],
    },
    {
      path: "server/internal/docs/check.go",
      role: "What a schema cannot check: that a document's parts fit together and that it names only list entries that exist; and which entries a document uses.",
      requirements: [
        { text: "A category, practice or platform that is not in the lists refuses the save, with the known ids in the answer: a document never points at nothing.", at: "add(\"%s: %q is not a known %s. Known %s: %s\", field, id, noun, plural, ids(list))" },
        { text: "Every reference a document makes to a list or another document; `stillUsed` in `httpapi/content.go` uses it to refuse removing a used entry. A new field that refers to a list must be added here.", at: "func UsesOf(kind string, body []byte) Uses {" },
        { text: "Two entries of one list with the same id are refused in the app's words (`duplicateSentence` in `src/lib/validate.ts`); an entry is named by `EntryWords`, by name, else by id, never by its place.", at: "add(\"%s[%d].id: Two %s have the id “%s”%s: remove one of them.\", key, i, key, n.ID, both)" },
      ],
      tests: ["server/internal/docs/check_test.go"],
    },
    {
      path: "server/internal/docs/contacts.go",
      role: "Contact details of a team, platform or practice: checked as the schema checks them, and written out as one repeatable line.",
      requirements: [
        { text: "Every link of a contact must be `http(s)` and at most 300 characters; the server refuses a `javascript:` link even if the app's check (`isWebLink`) were bypassed.", at: "case !ValidLink(l.value):" },
        { text: "Each problem is the app's sentence for it (`issueText` for the lists), naming the entry by `EntryWords`, so a refused save reads as plainly as one the app caught.", at: "out = append(out, fmt.Sprintf(\"The %s of %s is not a whole link: %swrite it with https:// at the start.\", l.label, what, spaces))" },
      ],
      tests: ["server/internal/docs/check_test.go"],
    },
    {
      path: "server/internal/docs/text.go",
      role: "Prepares a text people type (feedback, a request, a note) for storing, and says why it cannot be stored.",
      requirements: [{ text: "Characters that change the reading direction are refused: they could make a stored text read differently from what is shown to the owner.", at: "case directional(r):" }],
      tests: ["server/internal/docs/text_test.go"],
    },
  ],
  start: "server/internal/docs/docs.go",
};
