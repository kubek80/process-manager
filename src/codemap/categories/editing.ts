import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const editing: CodeCategory = {
  id: "editing",
  area: "app",
  title: "The editing screen",
  summary: "The screen where a process or standard is changed, and the calls behind its Save draft and Publish… buttons. `useDraft` keeps the person's work with Undo and Redo and never overwrites a newer save silently; `EditSession` decides which call Save draft and Publish… make: an ordinary save of a never-published document, or its working draft (`PUT …/draft`, `POST …/publish`, `PUT …?draft=R`). The checker, the example texts, moving and deleting steps, the AI dialog and the JSON editor all change the same draft.",
  requirements: [
    "Which call Save draft makes is decided only by `saveCallOf` (`src/lib/editing.ts`): a published document always saves its working draft (`PUT …/draft?rev=R`); a never-published one is stored as itself (`PUT …?base=N`) while the checker finds no error, kept in its working draft while it does, and stored as itself in place of an existing working draft (`PUT …?base=N&draft=R`) once nothing is to fix; one deleted meanwhile comes back with `PUT …?base=0` and `status: \"draft\"`.",
    "A save of the working draft sends the revision the changes on screen were made from (`draftRevisionToSend` for a never-published document, the `base` of `useDraft` for a published one), never a newer revision heard of meanwhile: somebody else's newer draft comes back as a `409` with `draft: true` and is replaced only after \"Save mine over theirs\". The refusal itself is the server's (`server/internal/docs/drafts.go`).",
    "A working draft that is created (`rev=0`), also again after it was published or discarded meanwhile, is created with `base` = the published version the changes started from (`draftSaveBase`), so that publishing it meets any version published since as a conflict instead of going over it.",
    "Publish… of a published document first saves unsaved changes into the working draft, then calls `POST …/publish?rev=R`; a version conflict opens `PublishConflict` (\"Continue from theirs\" or \"Publish mine over theirs\", which sends `over=N`). Publishing a never-published document is the same save as Save draft with `status: \"active\"`, and is never kept as a working draft when the server refuses it.",
    "When the server refuses a never-published document as itself (`400`) at Save draft, the work is kept as its working draft, the person is told \"Saved as a draft, not yet as the … itself.\" and the reason stays in the checker's list as something to fix until a save stores the document as itself.",
    "Publish… is offered as unavailable, with the reason under the bar, while the checker has an error, an example text is left in, the JSON has changes with problems, or the person may not publish the placement (`canPublish`, `whoPublishesParts`); Save draft stays possible whenever there is something to save, except where the rights or the JSON stop it, or a document deleted meanwhile would come back with errors.",
    "Retire, Unpublish, Bring back and Delete are in the More menu only and are ordinary saves (or the delete) of the stored document. The app offers them only to whoever may publish what is stored and blocks the first three while a working draft or unsaved changes exist. The server refuses a member (`notPublisher` in `server/internal/httpapi/content.go`) and any ordinary save while a working draft exists (`DraftPending` from `docs.Store.Save`, answered by `draftPending` in `server/internal/httpapi/drafts.go`).",
    "Nothing is lost by accident: leaving with unsaved changes asks first (`guardLeaving`), every change on the screen can be undone, Discard changes too (`UNDO_LIMIT` 100 steps, typing in one field within `BURST_MS` 800 ms is one step), a version saved by somebody else is followed only while there are no edits (`serverHas`), and a fault while drawing shows `EditingBoundary`, below the draft.",
    "Moving and deleting steps go through `moveStepInFlow`, `nudgeStep` and `deleteStep` (`src/lib/edit.ts`): they change the flow, not only the numbering, never ask first, never rename an answer of a decision, and say with Undo what changed in the flow (`restructureNotice`).",
    "A problem is worded only by `issueText` and marked on its field only by `useFieldMarks`; the example texts of `EXAMPLE` are errors to fix before publishing (`exampleIssues`), not before saving; Undo and Redo say what they did through `steppedMessage` and `editNotice`, one message at a time, gone when the screen is left.",
  ],
  charts: [
    {
      caption: "What one press on Save draft (or Ctrl+S) sends, as `EditSession` and `saveCallOf` decide it. Not drawn: a document deleted by somebody meanwhile is stored again with `PUT …?base=0` as a draft, only once the checker finds no error. After the answer, `savedAs` keeps whatever was typed while the save was on its way.",
      process: flow("code-editing-save", "Save draft, as the app decides it", "Which call one press on Save draft makes.",
        [["app", "Browser"], ["server", "Server"]],
        [
          s("press", "Press Save draft", "app", "task", ["stop"], "saveDraft"),
          s("stop", "Check rights and JSON", "app", "verify", ["kind"], "refused: said under the bar"),
          s("kind", "Is it published now?", "app", "decision", [["working", "Yes"], ["fix", "No"]]),
          s("fix", "Checker finds an error?", "app", "decision", [["working", "Yes"], ["has", "No"]], "example texts do not count"),
          s("has", "Has a working draft?", "app", "decision", [["replace", "Yes"], ["version", "No"]]),
          s("working", "Store the working draft", "server", "document", [], "PUT …/draft?rev=R"),
          s("replace", "Store it, drop the working draft", "server", "document", [], "PUT …?base=N&draft=R"),
          s("version", "Store it as the document", "server", "document", [], "PUT …?base=N; 400: kept as draft"),
        ]),
    },
    {
      caption: "Publish… of a published document, with the branch for a version somebody else published after the changes were started. Before this, the app has checked the problems, the rights and the JSON (a refusal is said under the bar); a never-published document is published instead by the save of the chart above, with `status: \"active\"`.",
      process: flow("code-editing-publish", "Publish, and somebody published first", "What Publish… calls, and the decision when the server has a newer version.",
        [["editor", "Editor"], ["app", "Browser"], ["server", "Server"]],
        [
          s("press", "Press Publish… with a note", "editor", "task", ["flush"], "PublishDialog"),
          s("flush", "Save unsaved changes to the draft", "app", "communication", ["publish"], "PUT …/draft, only when dirty"),
          s("publish", "Publish the working draft", "app", "communication", ["newer"], "POST …/publish?rev=R"),
          s("newer", "Published since its base?", "server", "decision", [["live", "No"], ["choose", "Yes"]], "409 without draft"),
          s("choose", "Whose version?", "editor", "decision", [["over", "Mine"], ["theirs", "Theirs"]], "PublishConflict"),
          s("over", "Publish over theirs", "app", "communication", ["live"], "…/publish?rev=R&over=N"),
          s("theirs", "Load theirs into the editor", "app", "automation", [], "next save sends base=N"),
          s("live", "Store the next version", "server", "document", [], "readers, skills, index follow"),
        ]),
    },
    {
      caption: "Two people (or two tabs) save the one shared working draft: the second save is refused, compared and decided, never overwritten silently. Not drawn: when the draft was published or discarded meanwhile, the answer is `409` with `exists: false` and \"Save mine as a new draft\" creates it again (`rev=0`).",
      process: flow("code-editing-conflict", "Two saves of the same working draft", "How a save made from an older revision of the working draft is met.",
        [["app", "Browser"], ["other", "Another editor"], ["server", "Server"]],
        [
          s("other", "Save the draft as revision 3", "other", "task", ["save"]),
          s("save", "Save draft with rev=2", "app", "communication", ["check"], "changes came from revision 2"),
          s("check", "Is 2 the stored revision?", "server", "decision", [["stored", "Yes"], ["refuse", "No"]]),
          s("refuse", "Answer 409 with draft: true", "server", "communication", ["choose"], "ConflictDialog shows theirs"),
          s("choose", "Whose draft?", "app", "decision", [["theirs", "Theirs"], ["mine", "Mine"]]),
          s("theirs", "Continue from their draft", "app", "task", [], "yours one Undo away"),
          s("mine", "Save mine over theirs, rev=3", "app", "communication", ["stored"], "keepMine"),
          s("stored", "Store the next revision", "server", "document", []),
        ]),
    },
  ],
  examples: [
    {
      title: "One change to “Request a GCP project”, from Save draft to Publish",
      caption: "The published sample process (here at version 3) gets a shorter summary on the editing screen; the same change as the app holds it, sends it and hears back.",
      stages: [
        {
          label: "On the screen: the draft in useDraft",
          where: "src/lib/draftState.ts",
          shape: `{
  "saved": { "id": "request-gcp-project", "summary": "Get a new Google Cloud project created by the project factory, …", "status": "active", … },
  "draft": { "id": "request-gcp-project", "summary": "Get a Google Cloud project from the project factory.", "status": "active", … },
  "base": 0,          // a published document: the revision of its working draft (0: none yet)
  "past": [ { …the document before the change… } ],
  "future": []
}`,
          note: "Typing in the summary is one step to undo (`BURST_MS`); nothing is sent yet. The editing bar says \"Unpublished changes\" and \"Not saved yet\".",
        },
        {
          label: "Save draft: the working draft is created",
          where: "src/components/EditSession.tsx",
          shape: `PUT /api/processes/request-gcp-project/draft?rev=0&base=3&known=3
X-Requested-With: process-manager

{ "$schema": "../schema/process.schema.json", "schemaVersion": "1.0", "id": "request-gcp-project",
  "title": "Request a GCP project", "summary": "Get a Google Cloud project from the project factory.",
  "updatedAt": "2026-11-22", "status": "active", … }`,
          note: "`saveCallOf(\"working\")` is \"save-working-draft\"; rev 0 creates it, `base=3` is the version the change started from (`draftSaveBase`), `known` only serves to name who deleted it should it be gone. `stamp` set `updatedAt`.",
        },
        {
          label: "The server's answer",
          where: "src/lib/store.ts",
          shape: `200
{ "revision": 1, "base": 3, "updatedBy": "jordan@example.com", "updatedByName": "Jordan Platform",
  "updatedAt": "2026-11-22T10:14:03Z",
  "document": { "version": 3, "status": "active", "updatedAt": "…", "updatedBy": "…" } }`,
          note: "`useDraft` now has `base: 1` (the revision) and the bar says \"Draft saved 10:14\". `document` would reveal a retire, unpublish or publish by somebody else meanwhile (`statusChangedSentence`).",
        },
        {
          label: "Publish…",
          where: "src/components/EditSession.tsx",
          shape: `POST /api/processes/request-gcp-project/publish?rev=1&note=Shorter%20summary

200  { "version": 4, … }`,
          note: "Readers now see version 4; the working draft is gone (the screen starts afresh with `restart()`).",
        },
        {
          label: "…or: somebody published version 4 first",
          where: "src/components/EditSession.tsx",
          shape: `409
{ "error": "Alex Editor saved a newer version (version 4) while you were working on this.",
  "conflict": { "exists": true, "version": 4, "status": "active", "updatedBy": "alex@example.com", "updatedByName": "Alex Editor", "updatedAt": "…" } }

then, after "Publish mine over theirs":
POST /api/processes/request-gcp-project/publish?rev=1&note=Shorter%20summary&over=4`,
          note: "Nothing was published or overwritten until the person chose. \"Continue from theirs\" instead loads version 4 into the editor as one change (Undo brings theirs back out) and the next Save draft sends `base=4` to move the draft onto it.",
        },
      ],
    },
  ],
  files: [
    {
      path: "src/components/EditSession.tsx",
      role: "The draft behind the editing screen of a process or standard: loads the working draft, wires `useDraft` to the server's calls, and decides what Save draft, Publish…, Discard draft and the More menu do.",
      requirements: [
        { text: "`toFix` counts the checker's errors only, not the example texts (those come from `exampleIssues` separately): a never-published document with example texts left is still stored as itself, and only Publish… waits for them.", at: 'const toFix = unpublished && opts.current.check(doc).some((i) => i.level === "error");' },
        { text: "The revision sent is the one the changes on screen were made from (`editedFrom`, kept per document object in `revOfDoc`), not `working.revision`: with the newest revision a second tab would overwrite a draft it never saw.", at: "const rev = unpublished ? draftRevisionToSend(editedFrom(), over) : base;" },
        { text: "The fallback to the working draft runs only for a document still `status: \"draft\"`: a refused first publication (`status: \"active\"`) must fail visibly, never land silently in a draft that readers do not see.", at: "if (notFinished(e, doc)) { const v = await saveWorking(doc, 0, docBase); keptAsDraft(e); return v; }" },
        { text: "The working-draft calls answer `404` for one the person may not see and for a deleted document whose deletion the caller cannot be told of (no `known` or `base` version of theirs: `putDraft`, `deletion` in `server/internal/httpapi`); here a `404` is turned into the deleted conflict, so the person gets \"Save mine and bring it back\" instead of a bare error.", at: "if (e instanceof ApiError && e.status === 404) {" },
        { text: "Unsaved changes go into the working draft before `POST …/publish`; if that save is refused, nothing is published and the conflict dialog takes over: what is published is always what was saved last.", at: 'if (d.dirty && !(await d.save("", keepStatus))) { setDialog(null); return false; }' },
        { text: "A draft conflict met while publishing goes to the working-draft dialog (`raiseConflict`); only a version conflict opens `PublishConflict`.", at: "if (c.draft) { d.raiseConflict(c); return false; }" },
        { text: "Retire, Bring back and Unpublish are offered only while no working draft and no unsaved changes exist (`statusBlock`); the server refuses them too while a working draft exists (`DraftPending` in `docs.Store.Save`, answered by `draftPending` in `server/internal/httpapi/drafts.go`).", at: 'label: "Retire…"' },
        { text: "Retire, Bring back, Unpublish and Delete are shown only to whoever may publish the document as it is stored (`canPublish` without the new placement); this only hides them, the server refuses a member (`notPublisher` in `server/internal/httpapi/content.go`).", at: "const mayChangeStored = canPublish(perms, kind, d.saved);" },
        { text: "A restored version, an AI answer and their version after a conflict keep the stored status (`keepStatus`): none of them can unpublish, retire or publish the document on the side.", at: "const keepStatus = (doc: T): T => ({ ...doc, status: unpublished ? \"draft\" : stored.status });" },
        { text: "The draft lives here, above `EditingBoundary`: a fault in the screen below never loses it, and the boundary clears whenever the draft changes.", at: "return <EditingBoundary resetKey={d.draft}" },
      ],
      tests: ["e2e/editing.spec.ts", "e2e/savemodel.spec.ts", "e2e/members.spec.ts", "e2e/versions.spec.ts"],
    },
    {
      path: "src/lib/editing.ts",
      role: "The editing screen as plain functions: the kind of draft, the state on the bar, which call Save draft and Publish make, the outline, where a problem belongs and how it is worded, the Publish list and who publishes.",
      requirements: [
        { text: "A published document always saves its working draft, even with nothing to fix: its readers' version changes only through `POST …/publish`. Tested in `saveDecision.test.ts`.", at: ': kind === "working" || o.toFix ? "save-working-draft"' },
        { text: "After \"Save mine over theirs\" the revision sent is theirs (0 when it is gone, which creates a new draft); in every other case the one the changes came from.", at: "if (over?.draft) return over.exists ? over.version ?? 0 : 0;" },
        { text: "Creating the working draft sends `base` = the version the changes started from; without it the server would start the draft on the current version and a publish since would be overwritten unseen.", at: "if (rev === 0) return startedFrom || undefined;" },
        { text: "A message that is already a whole sentence (from the server or the checker's own rules) is kept; any other is rebuilt from the field's label, so no schema word or path reaches the person.", at: "if (/^[A-Z“]/.test(message)) return message;" },
        { text: "An example text left in is an error with one fixed message (`isExampleIssue` tells it apart): it blocks Publish… but not Save draft. A text added to `EXAMPLE` must be checked here too, or it could be published.", at: "const flag = (path: string) => out.push({ level: \"error\", path, message: EXAMPLE_MESSAGE });" },
      ],
      tests: ["src/lib/__tests__/editing.test.ts", "src/lib/__tests__/saveDecision.test.ts", "src/lib/__tests__/editNames.test.ts", "src/lib/__tests__/editMove.test.ts"],
    },
    {
      path: "src/lib/draft.ts",
      role: "`useDraft`: editing with a safety net, shared by processes, standards and the lists (Admin › Lists).",
      requirements: [
        { text: "A save is always made on top of the base the edits started from, never on the newest version the page has heard of: that is what lets the server refuse it with a conflict instead of overwriting.", at: "return send(latest.current.base, note);" },
        { text: "\"Save mine over theirs\" goes on top of the version (or revision) the conflict names, or 0 when it was deleted or the draft is gone; the finishing touch of the refused save (e.g. `status: \"active\"`) is applied again.", at: "send(conflict?.exists ? (conflict.version ?? 0) : 0, note, conflict ?? undefined)" },
        { text: "\"Use their version\" makes theirs the base and puts it in as one change, so the person's whole version is one Undo away; nothing is merged.", at: "saved: theirs.saved, base: theirs.version" },
        { text: "Unsaved edits live only in memory (no browser storage): without this guard a tab closed or a link followed would lose them. A reader who changed nothing is not asked.", at: "const guarded = dirty && (o.editable !== false || state.past.length > 0);" },
        { text: "Ctrl+Z is left to a field that has the focus (and to the JSON editor): otherwise it would undo a whole step of the document instead of the last letters typed.", at: 'if (el && (el.tagName === "INPUT"' },
      ],
      tests: ["src/lib/__tests__/draftState.test.ts", "e2e/versions.spec.ts"],
    },
    {
      path: "src/lib/draftState.ts",
      role: "The state of something being edited (saved, base, draft, past, future) as plain functions, so the rules can be tested without a browser.",
      requirements: [
        { text: "Typing in the same single field within `BURST_MS` joins the step before; anything else is a new step, and only the last `UNDO_LIMIT` steps are kept.", at: "const past = burst ? s.past : [...s.past, s.draft].slice(-UNDO_LIMIT);" },
        { text: "An answer older than the base (a refresh that was on its way during a save) is ignored: following it would put old content back on screen.", at: "if (version < s.base) return s;" },
        { text: "With edits on screen a newer version on the server is not followed: the old base stays, so the next save is refused and the two can be compared.", at: "if (isDirty(s, tidy)) return s;" },
        { text: "What was typed while a save was on its way stays in the draft, as unsaved; only an untouched draft takes what was sent (with its date).", at: "draft: untouched ? sent : s.draft" },
        { text: "Discard is an ordinary change back to what is saved, so Undo brings the edits back.", at: "return edit({ ...s, editedAt: 0, editedField: null }, s.saved, now);" },
      ],
      tests: ["src/lib/__tests__/draftState.test.ts"],
    },
    {
      path: "src/components/Editing.tsx",
      role: "Shared by the pages that edit something: the screen's messages, the conflict dialog, the save bar of the lists, the error boundary, the list of versions and the reader's draft line.",
      requirements: [
        { text: "Each new message dismisses the one before: its Undo calls `d.undo`, which steps back from the newest change, so an older message's Undo would take back something else. `EditSession` clears the last one when the screen is left.", at: "if (editMessage !== null) notify.dismiss(editMessage);" },
        { text: "\"Save mine over theirs\" is off while the rights or the JSON stop a save (`blocked`): the person can then only continue from theirs, never push something the server would refuse.", at: "disabled={busy || !!blocked} onClick={run(() => d.keepMine())}" },
        { text: "The boundary forgets its fault whenever the draft changes (`resetKey`), so an Undo that removes the cause brings the screen back without a reload.", at: "return props.resetKey !== state.key ? { error: null, key: props.resetKey, saved: \"\" } : null;" },
      ],
      tests: ["e2e/versions.spec.ts", "e2e/editing.spec.ts"],
    },
    {
      path: "src/components/EditFrame.tsx",
      role: "The frame of the editing screen: the editing bar (state, Undo, Redo, Save draft, Publish…, More), the outline, the preview, the fields panel, the checker's list and the Publish dialog.",
      requirements: [
        { text: "Only errors mark a field (`aria-invalid`, the words of `issueText` under it); suggestions never do, so a field is red only for what blocks publishing.", at: 'if (issue.level !== "error") continue;' },
        { text: "A press within `DELETE_PAUSE` of the delete button appearing is ignored: after a delete the next item's button is under the same pointer, and a double click would delete it too.", at: "onClick={() => { if (deleteReady(shown.current, performance.now())) onDelete(); }}" },
        { text: "The Publish dialog does nothing while publishing is blocked (`blocked` is the reason, shown on its button).", at: "if (blocked || busy) return;" },
      ],
      tests: ["e2e/editor.spec.ts", "e2e/editscreen.spec.ts", "e2e/unnamed.spec.ts"],
    },
    {
      path: "src/components/EditProcessPage.tsx",
      role: "The editing screen of a process (`#/p/:id/edit[/:stepId]`): its outline, the editable map in the middle and the fields of what is selected.",
      requirements: [
        { text: "Whoever may not draft the process gets no screen (`canDraft`). This only hides it: the server refuses their saves and answers `404` to their working-draft calls (`rbac.Perms.CanDraft`, `server/internal/httpapi/drafts.go`).", at: 'if (!canDraft(perms, "process", process)) return <NoRight' },
        { text: "A delete or a move says what it did to the flow with Undo (`restructureNotice`); a change that did nothing says nothing.", at: 'if (said) editNotice.info(said.title, { label: "Undo", run: () => d.undo() }, said.detail);' },
        { text: "Deleting a step asks nothing: the step goes at once through `deleteStep`, the neighbour is selected and the keyboard goes to it in the outline.", at: "const next = deleteStep(draft, step.id);" },
      ],
      tests: ["e2e/editor.spec.ts", "e2e/editscreen.spec.ts"],
    },
    {
      path: "src/components/EditStandardPage.tsx",
      role: "The editing screen of a standard (`#/s/:id/edit[/:REQ-ID]`): the outline of its requirements, the preview and the fields of what is selected.",
      requirements: [
        { text: "Whoever may not draft the standard gets no screen (`canDraft`). This only hides it: the server refuses their saves and answers `404` to their working-draft calls (`rbac.Perms.CanDraft`).", at: 'if (!canDraft(perms, "standard", standard))' },
        { text: "A requirement is deleted at once with `deleteRequirement` (never the last one) and the message offers Undo; it is moved with `moveRequirementTo`, keeping its id.", at: "const next = deleteRequirement(draft, current.id);" },
      ],
      tests: ["e2e/standards.spec.ts"],
    },
    {
      path: "src/lib/edit.ts",
      role: "Changes to a process or standard as plain functions: tidying, adding, inserting, moving and deleting steps and requirements, the example texts of something new, and the words for what a change did to the flow.",
      requirements: [
        { text: "The only step of a process is never deleted: a process without steps fails the schema and could no longer be drawn.", at: "if (!gone || p.steps.length === 1) return p;" },
        { text: "A named answer of a decision that led to the deleted step keeps its name and now leads where the flow went on; with nowhere to go it is removed (and `restructureNotice` says so), never renamed.", at: "if (decides && n.label) return onward ? [{ to: onward.to, label: n.label }] : [];" },
        { text: "A move first cuts the step out exactly as a delete would, then puts it on every arrow into its new place: the flow changes with the numbering.", at: "const rest = deleteStep(cutFrom, id).steps;" },
        { text: "Moving down one place is a move before the step after the next (or to the end), so the keys and the drag go through the same `moveStepInFlow`.", at: "return moveStepInFlow(p, id, i + 2 < p.steps.length ? p.steps[i + 2].id : null);" },
        { text: "The one list of example texts; `exampleIssues` in `src/lib/editing.ts` flags each of them, so a new one must be added there too.", at: "export const EXAMPLE = {" },
        { text: "A save is stamped (`updatedAt`) with the person's own day (`today` from `src/lib/dates.ts`), not the UTC day.", at: "export { today };" },
      ],
      tests: ["src/lib/__tests__/edit.test.ts", "src/lib/__tests__/editMove.test.ts", "src/lib/__tests__/editNames.test.ts", "e2e/editscreen.spec.ts"],
    },
    {
      path: "src/lib/validate.ts",
      role: "The checker in the browser: the schema checks generated from `schema/*.schema.json`, then the rules a schema cannot express (references, uniqueness, reachability, the lists).",
      requirements: [
        { text: "The schema checks are the generated `validators.generated.js`, never compiled in the browser (that needs `eval`, which the content security policy forbids). A schema changed without `npm run validators` leaves the app checking the old format while the server (`server/internal/schema`) checks the new one.", at: "import { validateCatalogDoc as validateCatalogSchema" },
        { text: "When the schema fails, only its problems are returned: the other rules index `steps`, `actors` and `next` and would throw on a broken shape.", at: "return issues; // semantic checks assume a schema-valid shape" },
        { text: "Whether the map can draw it at all, much weaker than valid: a document that is not drawable opens in the JSON to be repaired.", at: "export function isDrawableProcess(" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts", "src/lib/__tests__/demo.test.ts"],
    },
    {
      path: "src/lib/diff.ts",
      role: "What changed between two versions in a reader's words (steps or requirements added, removed or changed, details from what to what), for the versions list, the conflict dialogs and Undo.",
      requirements: [
        { text: "An item without a name is called by its place (\"Step 3 (no name yet)\"), never by an empty “”: a name may be empty at any moment while editing.", at: "return `${c.unnamed || c.what} (no name yet)`;" },
        { text: "`compare` only casts its input; the editing screen calls it inside `try`, since a stored version may not fit the format.", at: "export function compare(" },
      ],
      tests: ["src/lib/__tests__/diff.test.ts", "src/lib/__tests__/editNames.test.ts"],
    },
    {
      path: "src/components/StepFields.tsx",
      role: "The fields of one step on the editing screen: what happens, who does it and its kind, what to do, what comes next, and the less used fields offered as \"+ Tool\", \"+ Result\"….",
      requirements: [
        { text: "\"Move…\" and \"Delete step\" hand the change to the page, which makes it through `src/lib/edit.ts`; the delete button of the only step is off (as `deleteStep` refuses it).", at: '<DeleteButton label="Delete step" disabled={process.steps.length === 1} onDelete={onDelete} />' },
      ],
      tests: ["e2e/editscreen.spec.ts", "e2e/editor.spec.ts"],
    },
    {
      path: "src/components/QuickAdd.tsx",
      role: "The small form that appears on an arrow of the map where a new step will go (its name, kind and who does it).",
      requirements: [{ text: "It only hands the new step's name, kind and participant to the page, which puts it on that arrow with `insertStep`; a name shorter than 3 characters adds nothing.", at: "if (ok) onAdd({ title: title.trim(), type, actor });" }],
      tests: ["e2e/editscreen.spec.ts"],
    },
    {
      path: "src/components/StepTool.tsx",
      role: "The tool a step is done in, with its icon and, where asked, a link to it; shown on the reader's checklist and step drawer.",
      requirements: [{ text: "The tool's address opens in a new tab without giving it the portal's window (`noopener noreferrer`); it can only be `http(s)`, as the lists' schema allows nothing else (`schema/catalog.schema.json`).", at: 'rel="noopener noreferrer"' }],
    },
    {
      path: "src/components/AiDialog.tsx",
      role: "Change with AI: builds a prompt to copy into any chat assistant, reads the answer pasted back, checks it and applies it to the draft.",
      requirements: [
        { text: "The dialog makes no call to any AI: the prompt leaves only through Copy and Download, so no content goes to a service the person was not allowed to use.", at: '<CopyButton primary label="Copy prompt"' },
        { text: "An answer can be applied only when it parses and the checker finds no error; on the editing screen it replaces the draft as one change (Undo brings the draft back), with the document's own id.", at: "const ok = !!parsed?.value && !hasErrors(issues);" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts", "e2e/ai.spec.ts"],
    },
    {
      path: "src/lib/prompt.ts",
      role: "The prompts for any chat assistant: the rules of the format, the lists, an example, the current document and the person's text; and the request to fix what the checker found.",
      requirements: [
        { text: "The prompt carries the schema, an example and the ids of the lists, so an answer can be checked by the same checker; it asks for one JSON block only, which `extractJson` picks out.", at: "export function basePrompt(" },
        { text: "The fix request lists the checker's problems with the value at each path, for the same chat.", at: "export function fixPrompt(" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/components/JsonView.tsx",
      role: "More › JSON: the whole document as text, with the checker's findings next to it.",
      requirements: [
        { text: "Text goes into the draft only when it parses and the checker finds no error; an id other than the document's own is an error.", at: "if (!r.error && !hasErrors(check(r.value))) onChange(r.value as T);" },
        { text: "Text with problems is not part of the draft, and the screen is told (`onPending`): leaving asks, and Save draft and Publish… say why they wait.", at: "const pending = !ok && text !== canonical;" },
      ],
      tests: ["e2e/editor.spec.ts"],
    },
    {
      path: "src/components/JsonEditor.tsx",
      role: "The CodeMirror editor of the JSON view, its look in the portal's tokens, and the checker's findings as marks in the text.",
      requirements: [{ text: "Syntax errors first; once the text parses, each problem of the checker is marked where its path is in the text (`locate`), else at the start.", at: "const lint = linter((v): Diagnostic[] => {" }],
    },
    {
      path: "src/lib/jsonLocate.ts",
      role: "Finds where a checker path such as `steps[2].next[0].to` is in the JSON text.",
      requirements: [{ text: "A problem with a whole object or list is marked on its first character, not across all its lines.", at: 'if (mark.name === "Object" || mark.name === "Array") return { from: mark.from, to: mark.from + 1 };' }],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/edit.css",
      role: "The editing screen's layout: the dark editing bar, outline, preview and fields, the panels that slide over on smaller screens, the field marks.",
      requirements: [{ text: "The main button of the editing bar follows the brand only through the `-on-dark` tokens, readable on the bar's neutral dark in both themes.", at: "--eb-primary: var(--action-fill-on-dark);" }],
    },
  ],
  start: "src/components/EditSession.tsx",
};
