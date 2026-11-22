import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const editing: CodeCategory = {
  id: "editing",
  area: "app",
  title: "The editing screen",
  summary: "The one place where a process or standard is changed (`#/p/:id/edit`, `#/s/:id/edit`). `useDraft` keeps the person's work with Undo and Redo and never overwrites a newer save silently; `EditSession` decides which call Save draft and Publish… make: an ordinary save of a never-published document, or its working draft (`PUT …/draft`, `POST …/publish`, `PUT …?draft=R`). The checker, the example texts, moving and deleting steps, the AI dialog and the JSON editor all change the same draft.",
  requirements: [
    "Which call Save draft makes is decided only by `saveCallOf` (`src/lib/editing.ts`): a published document always saves its working draft (`PUT …/draft?rev=R`); a never-published one is stored as itself (`PUT …?base=N`) while the checker finds no error, kept in its working draft while it does, and stored as itself in place of an existing working draft (`PUT …?base=N&draft=R`) once nothing is to fix; one deleted meanwhile comes back with `PUT …?base=0` and `status: \"draft\"`.",
    "A save of the working draft sends the revision the changes on screen were made from (`draftRevisionToSend` for a never-published document, the `base` of `useDraft` for a published one), never a newer revision heard of meanwhile: somebody else's newer draft comes back as a 409 with `draft: true` and is replaced only after \"Save mine over theirs\".",
    "A working draft that is created (rev 0), also again after it was published or discarded meanwhile, is created with `base` = the published version the changes started from (`draftSaveBase`), so that publishing it meets any version published since as a conflict instead of going over it.",
    "Publish… of a published document first saves unsaved changes into the working draft, then calls `POST …/publish?rev=R`; a version conflict opens `PublishConflict` (\"Continue from theirs\" or \"Publish mine over theirs\", which sends `over=N`). Publishing a never-published document is the same save as Save draft with `status: \"active\"`, and is never kept as a working draft when the server refuses it.",
    "When the server refuses a never-published document as itself (400) at Save draft, the work is kept as its working draft, the person is told \"Saved as a draft, not yet as the … itself.\" and the reason stays in the checker's list as something to fix until a save stores the document as itself.",
    "Publish… is offered as unavailable, with the reason under the bar, while the checker has an error, an example text is left in, the JSON has changes with problems, or the person may not publish the placement (`canPublish`, `whoPublishesParts`); Save draft stays possible whenever there is something to save, except where the rights or the JSON stop it, or a document deleted meanwhile would come back with errors.",
    "Retire, Unpublish, Bring back and Delete are in the More menu only, only for whoever may publish the stored document, and the first three are blocked while a working draft or unsaved changes exist (`statusChangeBlocked`); they are ordinary saves of the stored document.",
    "Nothing is lost by accident: leaving with unsaved changes asks first (`guardLeaving`), every change on the screen can be undone, Discard changes too (100 steps, typing in one field within 800 ms is one step), a version saved by somebody else is followed only while there are no edits (`serverHas`), and a fault while drawing shows `EditingBoundary` above which the draft lives.",
    "Moving and deleting steps go through `moveStepInFlow`, `nudgeStep` and `deleteStep` (`src/lib/edit.ts`): they change the flow, not only the numbering, never ask first, never rename an answer of a decision, and say with Undo what changed in the flow (`restructureNotice`).",
    "A problem is worded only by `issueText` and marked on its field only by `useFieldMarks`; the example texts of `EXAMPLE` are errors to fix before publishing (`exampleIssues`), not before saving; Undo and Redo say what they did through `steppedMessage` and `editNotice`, one message at a time, gone when the screen is left.",
  ],
  charts: [
    {
      caption: "What pressing Save draft does, as `EditSession` and `saveCallOf` decide it. The calls go through `src/lib/store.ts`.",
      process: flow("code-editing-save", "Save draft, as the app decides it", "Which call one press on Save draft makes.",
        [["app", "Browser"], ["server", "Server"]],
        [
          s("press", "Press Save draft (or Ctrl+S)", "app", "task", ["stop"], "saveDraft"),
          s("stop", "Rights or JSON stop it?", "app", "decision", [["say", "Yes"], ["gone", "No"]]),
          s("say", "Say why under the bar", "app", "communication", [], "nothing is sent"),
          s("gone", "Deleted by somebody meanwhile?", "app", "decision", [["recreate", "Yes"], ["kind", "No"]]),
          s("recreate", "Store it again as a draft", "server", "code", ["stored"], "PUT …?base=0, if nothing to fix"),
          s("kind", "Published before?", "app", "decision", [["working", "Yes"], ["fix", "No"]]),
          s("fix", "Checker finds an error?", "app", "decision", [["working", "Yes"], ["has", "No"]], "example texts do not count"),
          s("has", "Has a working draft?", "app", "decision", [["replace", "Yes"], ["version", "No"]]),
          s("working", "Store the working draft", "server", "code", ["stored"], "PUT …/draft?rev=R"),
          s("replace", "Store it, drop the working draft", "server", "code", ["stored"], "PUT …?base=N&draft=R"),
          s("version", "Store it as the document", "server", "code", ["stored"], "PUT …?base=N; 400: kept as draft"),
          s("stored", "Take the new revision or version", "app", "automation", [], "savedAs: typing stays"),
        ]),
    },
    {
      caption: "Publish… from the editing bar to readers, with the branch for a version somebody else published after the changes were started.",
      process: flow("code-editing-publish", "Publish, and somebody published first", "What Publish… checks and calls, and the decision when the server has a newer version.",
        [["editor", "Editor"], ["app", "Browser"], ["server", "Server"]],
        [
          s("press", "Press Publish… and add a note", "editor", "form", ["check"], "PublishDialog"),
          s("check", "Error, rights or JSON in the way?", "app", "decision", [["why", "Yes"], ["kind", "No"]]),
          s("why", "Say why, show the first problem", "app", "communication", [], "notice under the bar"),
          s("kind", "Published before?", "app", "decision", [["first", "No"], ["flush", "Yes"]]),
          s("first", "Save it with status active", "server", "code", ["live"], "PUT …?base=N[&draft=R]"),
          s("flush", "Save unsaved changes to the draft", "server", "code", ["publish"], "only when dirty"),
          s("publish", "Publish the working draft", "server", "code", ["newer"], "POST …/publish?rev=R"),
          s("newer", "Published since its base?", "server", "decision", [["live", "No"], ["choose", "Yes"]], "409 without draft"),
          s("choose", "Whose version?", "editor", "decision", [["over", "Mine"], ["theirs", "Theirs"]], "PublishConflict"),
          s("over", "Publish over theirs", "server", "code", ["live"], "…/publish?rev=R&over=N"),
          s("theirs", "Load theirs into the editor", "app", "automation", [], "next save moves the base"),
          s("live", "Show readers the new version", "server", "verify", [], "skills and index follow"),
        ]),
    },
    {
      caption: "Two people (or two tabs) save the one shared working draft: the second save is refused, compared and decided, never overwritten silently.",
      process: flow("code-editing-conflict", "Two saves of the same working draft", "How a save made from an older revision of the working draft is met.",
        [["app", "Browser"], ["other", "Another editor"], ["server", "Server"]],
        [
          s("edit", "Edit, starting from revision 2", "app", "task", ["other"]),
          s("other", "Save the draft as revision 3", "other", "task", ["save"]),
          s("save", "Save draft with rev=2", "app", "code", ["check"], "draftRevisionToSend"),
          s("check", "Is 2 the stored revision?", "server", "decision", [["stored", "Yes"], ["refuse", "No"]]),
          s("refuse", "Answer 409 with draft: true", "server", "communication", ["dialog"], "version: 3"),
          s("dialog", "Show what their draft has", "app", "automation", ["choose"], "ConflictDialog"),
          s("choose", "Whose draft?", "app", "decision", [["theirs", "Theirs"], ["mine", "Mine"]]),
          s("theirs", "Continue from their draft", "app", "task", [], "yours one Undo away"),
          s("mine", "Save mine over theirs, rev=3", "app", "code", ["stored"], "keepMine"),
          s("stored", "Store the next revision", "server", "automation", []),
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
        { text: "Save draft makes the call `saveCallOf` names, with `toFix` from the checker's errors only (example texts do not stop a save) and `working` from the revision the changes came from.", at: "const call = saveCallOf(draftKind, gone.current, { toFix, working: rev > 0 });" },
        { text: "The revision sent is the one the changes on screen were made from: `draftRevisionToSend(editedFrom(), over)` for a never-published document, the `base` of `useDraft` (the working draft's revision) for a published one.", at: "const rev = unpublished ? draftRevisionToSend(editedFrom(), over) : base;" },
        { text: "Only a Save draft of a never-published document (`status: \"draft\"`) that the server refuses with 400 falls back to its working draft; a publish (`status: \"active\"`) never does.", at: "const notFinished = (e: unknown, doc: T) =>" },
        { text: "A 404 from a working-draft call means the document was deleted: it is turned into the deleted conflict, so the person can bring it back with their version.", at: "const saveWorking = async (doc: T, rev: number, docBase: number): Promise<number> => {" },
        { text: "Publishing a published document saves unsaved changes into the working draft first; a draft conflict goes to the conflict dialog, a version conflict to `PublishConflict`.", at: "const publish = async (note: string, over?: number): Promise<boolean> => {" },
        { text: "Retire, Bring back and Unpublish are blocked while a working draft or unsaved changes exist; they and Delete are offered only to whoever may publish what is stored (`mayChangeStored`).", at: "const statusBlock = statusChangeBlocked(" },
      ],
      tests: ["e2e/editing.spec.ts", "e2e/savemodel.spec.ts", "e2e/members.spec.ts", "e2e/versions.spec.ts"],
    },
    {
      path: "src/lib/editing.ts",
      role: "The editing screen as plain functions: the kind of draft, the state on the bar, which call Save draft and Publish make, the outline, where a problem belongs and how it is worded, the Publish list and who publishes.",
      requirements: [
        { text: "The four calls of Save draft and when each is made; the only place that decides it.", at: "export const saveCallOf = (" },
        { text: "The revision a save of the shared working draft is made from: the one the changes came from; after \"Save mine over theirs\" theirs (0 when it is gone).", at: "export function draftRevisionToSend(" },
        { text: "Creating the working draft (rev 0) sends the version the changes started from as `base`; a save after \"Continue from theirs\" sends their version; otherwise no `base`.", at: "export function draftSaveBase(" },
        { text: "A checker problem in words, as an instruction in the field's own label; never a path, a schema word or a count of characters.", at: "export function issueText(" },
        { text: "The example texts of `EXAMPLE` left in are errors with one fixed message, so they block publishing but not saving.", at: "export function exampleIssues(" },
        { text: "What Undo and Redo say, as what is true now.", at: "export function steppedMessage(" },
      ],
      tests: ["src/lib/__tests__/editing.test.ts", "src/lib/__tests__/saveDecision.test.ts", "src/lib/__tests__/editNames.test.ts", "src/lib/__tests__/editMove.test.ts"],
    },
    {
      path: "src/lib/draft.ts",
      role: "`useDraft`: editing with a safety net, shared by processes, standards and the lists (Admin › Lists).",
      requirements: [
        { text: "The one way the app saves a process, a standard or the lists: `save(doc, base, note, over)` is called with the version (or revision) the edits are based on; a refused save sets `conflict`, any other failure `error`.", at: "export function useDraft<T>(" },
        { text: "\"Save mine over theirs\" saves on top of the version (or revision) the conflict names, or on 0 when it was deleted or the draft is gone.", at: "const keepMine = useCallback(" },
        { text: "\"Use their version\" makes theirs the base and puts it in as a change of its own, so the person's whole version is one Undo away.", at: "const takeTheirs = useCallback(" },
        { text: "Leaving with unsaved edits asks first; somebody who only reads is not asked unless they changed something.", at: "const guarded = dirty &&" },
        { text: "Ctrl+Z / Ctrl+Shift+Z undo and redo the draft, except while typing in a field (or the JSON editor), which has its own undo.", at: 'if (el && (el.tagName === "INPUT"' },
      ],
      tests: ["src/lib/__tests__/draftState.test.ts", "e2e/versions.spec.ts"],
    },
    {
      path: "src/lib/draftState.ts",
      role: "The state of something being edited (saved, base, draft, past, future) as plain functions, so the rules can be tested without a browser.",
      requirements: [
        { text: "At most 100 steps can be undone.", at: "export const UNDO_LIMIT = 100;" },
        { text: "Changes to the same single field less than 800 ms apart are one step to undo; a change of structure is always a step of its own.", at: "export const BURST_MS = 800;" },
        { text: "A version the server has that this screen did not write is followed only while there are no edits; with edits the old base is kept, so the next save is refused and compared, and an answer older than the base is ignored.", at: "export function serverHas<T>(" },
        { text: "What was typed while a save was on its way stays in the draft, as unsaved.", at: "export function savedAs<T>(" },
        { text: "Discard is an ordinary change: it can be undone.", at: "export function discard<T>(" },
      ],
      tests: ["src/lib/__tests__/draftState.test.ts"],
    },
    {
      path: "src/components/Editing.tsx",
      role: "Shared by the pages that edit something: the screen's messages, the conflict dialog, the save bar of the lists, the error boundary, the list of versions and the reader's draft line.",
      requirements: [
        { text: "The editing screen's messages: one at a time (a new one replaces the one before, with its Undo), cleared when the screen is left.", at: "export const editNotice = {" },
        { text: "A refused save never overwrites anything: it shows what the other person changed and offers \"Use their version\" / \"Use their draft\", \"Save mine over theirs\", or, when it is gone, \"Save mine as a new draft\" / \"Save mine and bring it back\".", at: "export function ConflictDialog<T>(" },
        { text: "A fault while drawing keeps the work: it offers Undo of the last change, Try again and Save draft, and starts afresh whenever the draft changes.", at: "export class EditingBoundary extends Component<{" },
        { text: "Restoring an older version puts it into the draft as a change; it is published like any other change.", at: "export function HistoryDialog<T>(" },
      ],
      tests: ["e2e/versions.spec.ts", "e2e/editing.spec.ts"],
    },
    {
      path: "src/components/EditFrame.tsx",
      role: "The frame of the editing screen: the editing bar (state, Undo, Redo, Save draft, Publish…, More), the outline, the preview, the fields panel, the checker's list and the Publish dialog.",
      requirements: [
        { text: "Every field with an error is outlined with `aria-invalid` and the instruction from `issueText` shown under it, without adding anything to what React draws; an example text is marked more calmly.", at: "function useFieldMarks(" },
        { text: "The delete button of a step or requirement ignores presses for `DELETE_PAUSE` after it appears, so a double click never deletes the next item too.", at: "export function DeleteButton(" },
        { text: "The checker's summary opens the list of problems; when Save draft or Publish… cannot be done, the same list opens with the reason at its top.", at: "function Checker(" },
        { text: "The Publish dialog lists what readers will see differently and takes the note for the list of versions; its button is off while publishing is blocked.", at: "export function PublishDialog(" },
      ],
      tests: ["e2e/editor.spec.ts", "e2e/editscreen.spec.ts", "e2e/unnamed.spec.ts"],
    },
    {
      path: "src/components/EditProcessPage.tsx",
      role: "The editing screen of a process (`#/p/:id/edit[/:stepId]`): its outline, the editable map in the middle and the fields of what is selected.",
      requirements: [
        { text: "Only whoever may draft the process gets the screen; everybody else is told who may change it.", at: 'if (!canDraft(perms, "process", process)) return <NoRight' },
        { text: "A delete or a move changes the draft through `src/lib/edit.ts` and says what it did to the flow, with Undo (`restructureNotice`).", at: "const restructure = (next: Process, done: string | undefined, subject: string) => {" },
        { text: "Deleting a step asks nothing: it is deleted at once and the message offers Undo; the neighbour is selected.", at: "// no question: it is deleted at once, and the message offers Undo" },
      ],
      tests: ["e2e/editor.spec.ts", "e2e/editscreen.spec.ts"],
    },
    {
      path: "src/components/EditStandardPage.tsx",
      role: "The editing screen of a standard (`#/s/:id/edit[/:REQ-ID]`): the outline of its requirements, the preview and the fields of what is selected.",
      requirements: [
        { text: "Only whoever may draft the standard gets the screen; everybody else is told who may change it.", at: 'if (!canDraft(perms, "standard", standard))' },
        { text: "A requirement is moved with `moveRequirementTo` (its id stays) and deleted with `deleteRequirement`, with a message that offers Undo.", at: "const next = deleteRequirement(draft, current.id);" },
      ],
      tests: ["e2e/standards.spec.ts"],
    },
    {
      path: "src/lib/edit.ts",
      role: "Changes to a process or standard as plain functions: tidying, adding, inserting, moving and deleting steps and requirements, the example texts of something new, and the words for what a change did to the flow.",
      requirements: [
        { text: "Deleting a step joins the steps before it to what came after; a named answer of a decision keeps its name; the last step cannot be deleted.", at: "export function deleteStep(p: Process, id: string): Process {" },
        { text: "Moving a step changes the flow, not only the numbering: it is cut out as by a delete and put on every arrow into the step it goes before; a decision moves with its answers.", at: "export function moveStepInFlow(p: Process, id: string, beforeId: string | null): Process {" },
        { text: "The up and down keys move a step in the flow as `moveStepInFlow` does.", at: "export function nudgeStep(p: Process, id: string, dir: -1 | 1): Process {" },
        { text: "The message after a delete or a move: what was done, then every other change to the flow, at most three lines.", at: "export function restructureNotice(" },
        { text: "The one list of example texts a new document, step or requirement starts with.", at: "export const EXAMPLE = {" },
      ],
      tests: ["src/lib/__tests__/edit.test.ts", "src/lib/__tests__/editMove.test.ts", "src/lib/__tests__/editNames.test.ts", "e2e/editscreen.spec.ts"],
    },
    {
      path: "src/lib/validate.ts",
      role: "The checker in the browser: the schema checks generated from `schema/*.schema.json`, then the rules a schema cannot express (references, uniqueness, reachability, the lists).",
      requirements: [
        { text: "The schema checks are the generated validators, never compiled in the browser: the content security policy has no `eval`.", at: "import { validateCatalogDoc as validateCatalogSchema" },
        { text: "A process that fails the schema gets only the schema's problems; the other rules run on a schema-valid shape (participants, answers of decisions, steps that cannot be reached, a flow that never ends).", at: "export function validateProcess(" },
        { text: "A standard is checked the same way: schema first, then references and uniqueness.", at: "export function validateStandard(" },
        { text: "Whether the map can draw it at all; otherwise the screen opens the JSON to repair it.", at: "export function isDrawableProcess(" },
      ],
      tests: ["src/lib/__tests__/validate.test.ts", "src/lib/__tests__/demo.test.ts"],
    },
    {
      path: "src/lib/diff.ts",
      role: "What changed between two versions in a reader's words (steps or requirements added, removed or changed, details from what to what), for the versions list, the conflict dialogs and Undo.",
      requirements: [
        { text: "Every text built from an item's name goes through `itemWords`: an item without a name is called by its place, \"Step 3 (no name yet)\".", at: "export function itemWords(" },
        { text: "`compare` names categories, platforms and practices by their names from the lists where it has them, else by id; it only casts its input, so the editing screen calls it inside `try` (a stored version may not fit the format).", at: "export function compare(" },
      ],
      tests: ["src/lib/__tests__/diff.test.ts", "src/lib/__tests__/editNames.test.ts"],
    },
    {
      path: "src/components/StepFields.tsx",
      role: "The fields of one step on the editing screen: what happens, who does it and its kind, what to do, what comes next, and the less used fields offered as \"+ Tool\", \"+ Result\"….",
      requirements: [
        { text: "\"Move…\" and \"Delete step\" hand the change to the page, which makes it through `src/lib/edit.ts`; the only step of a process cannot be deleted.", at: '<DeleteButton label="Delete step" disabled={process.steps.length === 1} onDelete={onDelete} />' },
      ],
      tests: ["e2e/editscreen.spec.ts", "e2e/editor.spec.ts"],
    },
    {
      path: "src/components/QuickAdd.tsx",
      role: "The small form that appears on an arrow of the map where a new step will go (its name, kind and who does it).",
      requirements: [{ text: "It only hands the new step's name, kind and participant to the page; the page puts it on the arrow with `insertStep`.", at: "export function QuickAdd(" }],
      tests: ["e2e/editscreen.spec.ts"],
    },
    {
      path: "src/components/StepTool.tsx",
      role: "The tool a step is done in, with its icon and, where asked, a link to it; shown on the reader's checklist and step drawer.",
      requirements: [{ text: "Links to the tool only where `link` is set and the tool in the lists has an address.", at: "export function StepTool(" }],
    },
    {
      path: "src/components/AiDialog.tsx",
      role: "Change with AI: builds a prompt to copy into any chat assistant, reads the answer pasted back, checks it and applies it to the draft.",
      requirements: [
        { text: "Nothing is sent to an AI by the app: the person copies the prompt out and pastes the answer back.", at: "Nothing is sent anywhere by this app." },
        { text: "An answer is applied only when the checker finds no error; on the editing screen it replaces the draft as one change (Undo brings the draft back) and keeps the document's own id.", at: "onClick={() => onImport(current ? { ...result!, id: current.id } : result!)}" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts", "e2e/ai.spec.ts"],
    },
    {
      path: "src/lib/prompt.ts",
      role: "The prompts for any chat assistant: the rules of the format, the lists, an example, the current document and the person's text; and the request to fix what the checker found.",
      requirements: [
        { text: "The prompt is model-agnostic: it works pasted into a browser chat, with no tools or files.", at: "export function basePrompt(" },
        { text: "The fix request lists the checker's problems and the value at each path.", at: "export function fixPrompt(" },
      ],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/components/JsonView.tsx",
      role: "More › JSON: the whole document as text, with the checker's findings next to it.",
      requirements: [
        { text: "Text goes into the draft only when it parses and the checker finds no error; the id must stay the document's own.", at: "if (!r.error && !hasErrors(check(r.value))) onChange(r.value as T);" },
        { text: "Text with problems is not part of the draft, and the screen is told (`onPending`): leaving asks, and Save draft and Publish… say why they wait.", at: "const pending = !ok && text !== canonical;" },
      ],
      tests: ["e2e/editor.spec.ts"],
    },
    {
      path: "src/components/JsonEditor.tsx",
      role: "The CodeMirror editor of the JSON view, its look in the portal's tokens, and the checker's findings as marks in the text.",
      requirements: [{ text: "Syntax errors first; once the text parses, each problem of the checker is marked where its path is in the text (`locate`).", at: "const lint = linter((v): Diagnostic[] => {" }],
    },
    {
      path: "src/lib/jsonLocate.ts",
      role: "Finds where a checker path such as `steps[2].next[0].to` is in the JSON text.",
      requirements: [{ text: "A whole object or list is marked at its key, not across many lines.", at: "export function locate(" }],
      tests: ["src/lib/__tests__/misc.test.ts"],
    },
    {
      path: "src/edit.css",
      role: "The editing screen's layout: the dark editing bar, outline, preview and fields, the panels that slide over on smaller screens, the field marks.",
      requirements: [{ text: "The editing bar is a neutral dark in both themes; the brand and the states reach it only through the `-on-dark` tokens.", at: "--eb-primary: var(--action-fill-on-dark);" }],
    },
  ],
  start: "src/components/EditSession.tsx",
};
