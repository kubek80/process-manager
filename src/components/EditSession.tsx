import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert } from "./Alert";
import { ArrowLeft, Archive, Braces, EyeOff, History, RotateCcw, Sparkles, Trash2, Undo2 } from "lucide-react";
import type { DocMeta, Issue, Membership, Process, Standard, TargetKind } from "../types";
import { conflictOf, useDraft, type Conflict, type Draft } from "../lib/draft";
import { author, baseBehindSentence, clock, draftKindOf, draftMovedOn, draftRevisionToSend, draftSaveBase, saveCallOf, statusChangedSentence, editState, exampleIssues, isExampleIssue, issueText, statusChangeBlocked, steppedMessage, movedItem, movedMessage, moveOf, publishList, savedByText, partsText, whoPublishesParts, whoPublishesShort, lastSavedByOther, type DraftKind } from "../lib/editing";
import { compare, describeChange, type Change } from "../lib/diff";
import { belongsRefused, canPublish, draftAudience, publishPlaces } from "../lib/rights";
import { membersOf } from "../lib/members";
import { platformName, practiceName } from "../lib/catalog";
import { useMe, usePerms } from "../lib/session";
import { useCatalog } from "../lib/catalog";
import { statusOf } from "../lib/lifecycle";
import {
  ApiError, deleteWorkingDraft, go, guardLeaving, offerSaving, loadHistory, loadMembers, loadVersion, loadWorkingDraft, publishWorkingDraft, putDocReplacingDraft, putWorkingDraft, type WorkingDraft,
} from "../lib/store";
import type { AiSpec } from "./AiDialog";
import { BehindBanner, ChangeList, ConflictDialog, editNotice, EditingBoundary, HistoryDialog, savedWhen } from "./Editing";
import { type BarAction, type MenuItem, type Panel, PublishDialog } from "./EditFrame";
import { useBelongsWarning } from "./Governance";
import { confirmDialog, LoadError, Loading, Modal, notify } from "./ui";
import { SentenceParts } from "./PersonLink";

// the JSON editor and the AI dialog are loaded when they are first opened
const JsonView = lazy(() => import("./JsonView").then((m) => ({ default: m.JsonView }))) as typeof import("./JsonView").JsonView;
const AiDialog = lazy(() => import("./AiDialog").then((m) => ({ default: m.AiDialog }))) as typeof import("./AiDialog").AiDialog;

type Doc = Process | Standard;

export interface SessionOptions<T extends Doc> {
  kind: TargetKind;
  /** The document as it is stored: the published version, or the draft that was never published. */
  doc: T;
  meta?: DocMeta;
  /** Others of the same kind: what a retired one can point to instead. */
  others: { id: string; title: string; status?: string }[];
  tidy: (d: T) => T;
  stamp: (d: T) => T;
  check: (d: T) => Issue[];
  drawable: (d: T) => boolean;
  aiSpec: (current: T) => AiSpec<T>;
  json: { validate: (v: unknown) => Issue[]; schema: object; schemaFile: string };
  /** An ordinary save of the document, on top of version `base`. */
  onSave: (doc: T, base: number, note?: string) => Promise<number>;
  onReload: () => Promise<{ saved: T; version: number } | null>;
  /** Fetches everything again: after publishing, readers' version and the versions list are the server's. */
  onRefresh: () => Promise<void>;
  onDelete: (base: number) => void;
  /** Tells the app whether there is a working draft now (for the line on the reader's page). */
  onDraftMeta: (d: { updatedAt: string; updatedBy: string; updatedByName?: string } | null) => void;
}

/** Everything the editing screen of a process or a standard needs besides its own content. */
export interface Session<T extends Doc> {
  d: Draft<T>;
  draftKind: DraftKind;
  /** The document can be drawn (a broken one can only be repaired in its JSON). */
  drawable: boolean;
  working: WorkingDraft<T> | null;
  issues: Issue[];
  /** The text of the document is shown instead of the map or the requirements. */
  json: boolean;
  /** A problem to bring into view (a refused save or publish points at the first one); `n` counts the requests. */
  focus: { issue: Issue; n: number } | null;
  /** A step or requirement that Undo or Redo brought back or changed: selected and shown; `n` counts. */
  reveal: { item: string; n: number } | null;
  jsonView: ReactNode;
  panel: Panel; setPanel: (p: Panel) => void;
  frame: {
    state: ReturnType<typeof editState>; unsaved: boolean;
    undo: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void; undoTitle?: string; redoTitle?: string };
    onBack: () => void; discard?: BarAction; save: BarAction; publish: BarAction; more: MenuItem[];
    banners?: ReactNode;
    /** Why a press on Save draft or Publish did nothing, or why publishing waits: shown under the bar. */
    notice?: Notice | null; onNotice: () => void;
    /** Always true: "Not saved yet", "Draft saved 14:02", "Saved". */
    saveLine: string;
    /** Whether a problem has to be fixed before saving (a never-published draft) or before publishing. */
    fixBefore: (i: Issue) => "saving" | "publishing";
  };
  dialogs: ReactNode;
}

/** A line under the editing bar: why something did not happen, with the first problem to go to. */
export interface Notice { text: string; tone: "bad" | "warn"; issue?: Issue; persistent?: boolean }

const whyNot = (e: unknown, noun: string): string => {
  const c = conflictOf(e);
  if (c && !c.exists) return `${c.deletedByName || c.deletedBy || "Somebody else"} deleted this ${noun} in the meantime.`;
  if (c) return `${c.updatedByName || c.updatedBy || "Somebody else"} changed this ${noun} in the meantime. Look at the current version first.`;
  return e instanceof Error ? e.message : String(e);
};

/**
 * The draft behind the editing screen. A document that was never published is edited as itself
 * (what cannot be saved as itself yet is kept as its working draft); a published one through its
 * working draft. The working draft is loaded first when there is one. The screen is started
 * afresh when the kind changes (published, unpublished) or the working draft goes (discarded,
 * published).
 */
export function EditSession<T extends Doc>({ o, children }: { o: SessionOptions<T>; children: (s: Session<T>) => ReactNode }) {
  const [draftKind, setDraftKind] = useState<DraftKind>(() => draftKindOf(o.doc.status));
  const [generation, setGeneration] = useState(0);
  const loadKey = `${draftKind}:${generation}`;
  const [loaded, setLoaded] = useState<{ key: string; working: WorkingDraft<T> | null } | null>(null);
  const [error, setError] = useState("");
  // somebody else retired, unpublished or published it while it was open: said until that changes
  const [meanwhile, setMeanwhile] = useState<Meanwhile | null>(null);
  const load = useCallback(() => {
    setError("");
    let live = true;
    loadWorkingDraft<T>(o.kind, o.doc.id).then((w) => { if (live) setLoaded({ key: loadKey, working: w }); }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  if (error) return <div className="page"><LoadError what="The unpublished changes could not be loaded." error={error} onRetry={load} /></div>;
  if (loaded?.key !== loadKey) return <Loading page />;
  return (
    <SessionInner key={loadKey} o={o} draftKind={draftKind} initial={loaded.working} meanwhile={meanwhile} setMeanwhile={setMeanwhile}
      restart={(next) => { if (next) setDraftKind(next); setGeneration((g) => g + 1); }}>
      {children}
    </SessionInner>
  );
}

/** What somebody else did to the document while it was open, and the status it then had. */
type Meanwhile = { text: string; status: string };

function SessionInner<T extends Doc>({ o, draftKind, initial, meanwhile, setMeanwhile, restart, children }: {
  o: SessionOptions<T>; draftKind: DraftKind; initial: WorkingDraft<T> | null;
  meanwhile: Meanwhile | null; setMeanwhile: (m: Meanwhile | null) => void;
  /** Starts the screen afresh, as another kind of draft when given. */
  restart: (kind?: DraftKind) => void;
  children: (s: Session<T>) => ReactNode;
}) {
  const { kind } = o;
  const id = o.doc.id;
  const noun = kind;
  const perms = usePerms();
  const me = useMe().user?.email;
  const { catalog } = useCatalog();
  const [working, setWorkingState] = useState<WorkingDraft<T> | null>(initial);
  // the working draft as the last call left it: a publish right after a save needs its revision
  const workingNow = useRef(working);
  // which revision of the working draft each document on screen came from: a save is made from
  // the revision the person's changes were started from, never from a newer one loaded meanwhile
  const revOfDoc = useRef(new WeakMap<object, number>(initial ? [[initial.doc as object, initial.revision]] : []));
  const setWorking = (w: WorkingDraft<T> | null) => { if (w) revOfDoc.current.set(w.doc as object, w.revision); workingNow.current = w; setWorkingState(w); };
  const savedNow = useRef<T | null>(null);
  const editedFrom = () => (savedNow.current ? revOfDoc.current.get(savedNow.current as object) ?? 0 : 0);
  // why the server would not store a never-published document as itself at the last save (it
  // was kept as the working draft): to fix before publishing
  const [refusal, setRefusal] = useState<string | null>(null);
  const opts = useRef(o);
  opts.current = o;
  // The published version the changes on screen were made from. A draft that has to be created
  // again (somebody published or discarded it meanwhile) is created on it, so that publishing
  // still meets every version published since. "Continue from theirs" moves the next save onto
  // their version (`rebaseTo`).
  const startBase = useRef(initial?.base || o.meta?.version || 0);
  const rebaseTo = useRef<number | null>(null);

  const unpublished = draftKind === "unpublished";
  // Somebody else deleted it while it was open: saving brings it back, as a draft readers do not
  // see until it is published (the ordinary save that creates something new).
  const gone = useRef(false);
  const [isGone, setGone] = useState(false);
  const markGone = () => { gone.current = true; setGone(true); };
  const recreate = async (doc: T, note: string) => {
    const v = await opts.current.onSave({ ...doc, status: "draft" }, 0, note || "Restored after it was deleted");
    // it is back: a draft again (one that was never published does not start the screen afresh)
    gone.current = false; setGone(false);
    return v;
  };
  // Saving the working draft: `rev` is its revision (0: it is started), `docBase` the version of a
  // never-published document the changes were made from. Answers what the draft's `base` in
  // useDraft is: the revision for a published document, the document's version for one never
  // published.
  const saveWorking = async (doc: T, rev: number, docBase: number): Promise<number> => {
    let r;
    try {
      r = await putWorkingDraft(kind, id, doc, rev, unpublished ? (rev === 0 ? docBase || undefined : undefined) : draftSaveBase(rev, startBase.current, rebaseTo.current),
        unpublished ? docBase : opts.current.meta?.version);
    } catch (e) {
      // the draft calls answer "does not exist" for something that was deleted: say it like a save does
      if (e instanceof ApiError && e.status === 404) {
        markGone();
        const deleted = new ApiError(409, `Somebody else deleted this ${noun} while you were editing.`);
        deleted.conflict = { exists: false };
        throw deleted;
      }
      if (conflictOf(e) && !conflictOf(e)?.exists && !conflictOf(e)?.draft) markGone();
      throw e;
    }
    if (!unpublished) startBase.current = r.base;
    rebaseTo.current = null;
    setWorking({ doc, base: r.base, revision: r.revision, updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt });
    opts.current.onDraftMeta({ updatedAt: r.updatedAt, updatedBy: r.updatedBy, updatedByName: r.updatedByName });
    // somebody retired, unpublished or saved the document meanwhile: said now, not only when publishing
    if (r.document && r.document.version !== (opts.current.meta?.version ?? 0)) {
      const text = statusChangedSentence(noun, opts.current.doc.status, r.document, me);
      if (text) setMeanwhile({ text, status: r.document.status });
      void opts.current.onRefresh().catch(() => {});
    }
    return unpublished ? r.base : r.revision;
  };
  // an ordinary save that the server refuses as not finished: kept as the working draft instead,
  // so that "Save draft" of a never-published document always works (never a publish)
  const notFinished = (e: unknown, doc: T) => unpublished && e instanceof ApiError && e.status === 400 && doc.status === "draft";
  // ... and says why at once; the reason stays to fix until a save stores it as itself
  const keptAsDraft = (e: unknown) => {
    const why = e instanceof Error ? e.message : String(e);
    setRefusal(why);
    notify.error(`Saved as a draft, not yet as the ${noun} itself.`, `${why} Fix this before publishing.`);
  };
  // the version the changes on screen were made from, for a save made from a conflict dialog
  const baseNow = useRef<number>(0);
  const d: Draft<T> = useDraft<T>({
    docKey: `${kind}/${id}`, what: `this ${noun}`, tidy: o.tidy, stamp: o.stamp,
    saved: working?.doc ?? o.doc,
    // a never-published document: the version of the document itself (the one its working draft
    // was started from, while there is one); a published one: the revision of its working draft
    version: unpublished ? working?.base ?? o.meta?.version ?? 0 : working?.revision ?? 0,
    save: async (doc, base, note, over): Promise<number> => {
      // after "Save mine over theirs" of the shared draft, `base` is the revision of theirs
      const rev = unpublished ? draftRevisionToSend(editedFrom(), over) : base;
      const docBase: number = over?.draft ? baseNow.current : base;
      const toFix = unpublished && opts.current.check(doc).some((i) => i.level === "error");
      const call = saveCallOf(draftKind, gone.current, { toFix, working: rev > 0 });
      if (call === "recreate-as-draft") return recreate(doc, note);
      if (call === "save-version") {
        try { const v = await opts.current.onSave(doc, docBase, note); setRefusal(null); return v; } catch (e) {
          if (notFinished(e, doc)) { const v = await saveWorking(doc, 0, docBase); keptAsDraft(e); return v; }
          throw e;
        }
      }
      if (call === "replace-working-draft") {
        let saved;
        try { saved = await putDocReplacingDraft(kind, doc, docBase, note, rev); } catch (e) {
          if (notFinished(e, doc)) { const v = await saveWorking(doc, rev, docBase); keptAsDraft(e); return v; }
          if (conflictOf(e) && !conflictOf(e)?.exists && !conflictOf(e)?.draft) markGone();
          throw e;
        }
        // stored as the document itself: the working draft is gone, and the lists follow
        setRefusal(null);
        setWorking(null);
        opts.current.onDraftMeta(null);
        await opts.current.onRefresh().catch(() => {});
        return saved.version;
      }
      return saveWorking(doc, rev, docBase);
    },
    reload: unpublished ? async () => {
      // what is there now: its working draft when it has one, else the document itself
      const now = await opts.current.onReload();
      if (!now) return null;
      const w = await loadWorkingDraft<T>(kind, id);
      setWorking(w);
      opts.current.onDraftMeta(w ? { updatedAt: w.updatedAt, updatedBy: w.updatedBy, updatedByName: w.updatedByName } : null);
      return w ? { saved: w.doc, version: w.base } : now;
    } : async () => {
      const w = await loadWorkingDraft<T>(kind, id);
      setWorking(w);
      rebaseTo.current = null;
      startBase.current = w?.base || opts.current.meta?.version || 0;
      opts.current.onDraftMeta(w ? { updatedAt: w.updatedAt, updatedBy: w.updatedBy, updatedByName: w.updatedByName } : null);
      return w ? { saved: w.doc, version: w.revision } : { saved: opts.current.doc, version: 0 };
    },
  });

  baseNow.current = d.base;
  savedNow.current = d.saved;

  // somebody published the never-published document, or unpublished the published one: start
  // afresh as the other kind of draft - once nothing would be lost by it
  const storedKind = draftKindOf(o.doc.status);
  useEffect(() => { if (storedKind !== draftKind && !d.dirty) restart(storedKind); }, [storedKind, d.dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // somebody else saved the shared draft (the app hears of it when the tab comes back): fetch it
  const theirDraftAt = o.meta?.draft?.updatedAt;
  useEffect(() => {
    if (!theirDraftAt || theirDraftAt === workingNow.current?.updatedAt) return;
    loadWorkingDraft<T>(kind, id).then((w) => { if (w) setWorking(w); }, () => { /* the next save says what is wrong */ });
  }, [theirDraftAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // without a draft and without changes, the screen follows what readers see: that is the base
  const version = o.meta?.version ?? 0;
  useEffect(() => { if (!unpublished && !working && !d.dirty && !rebaseTo.current) startBase.current = version; }, [version, working, d.dirty, unpublished]);
  // a new version under the draft (a review moves the draft along on the server): read its base again
  useEffect(() => {
    if (unpublished || !workingNow.current) return;
    loadWorkingDraft<T>(kind, id).then((w) => {
      const now = workingNow.current;
      if (!w || !now) return;
      if (w.revision === now.revision) { setWorking({ ...now, base: w.base }); if (!rebaseTo.current) startBase.current = w.base; }
      else setWorking(w);
    }, () => { /* the next save says what is wrong */ });
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  // the shared draft was saved, published or discarded by somebody else: what readers see may have moved on too
  useEffect(() => { if (d.conflict?.draft) void opts.current.onRefresh().catch(() => {}); }, [d.conflict]);
  // an ordinary save refused because it was deleted (a draft that was never published)
  useEffect(() => { if (d.conflict && !d.conflict.exists && !d.conflict.draft) markGone(); }, [d.conflict]);
  useEffect(() => { if (d.error) { notify.error(`The ${noun} could not be saved.`, d.error); d.clearError(); } }, [d.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawable = useMemo(() => o.drawable(d.draft), [d.draft, o.drawable]); // eslint-disable-line react-hooks/exhaustive-deps
  // the checker's findings, and the example texts of something new (to fix before publishing only)
  const checked = useMemo(() => o.check(d.clean), [d.clean, o.check]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useMemo(() => [
    ...(drawable ? [...checked, ...exampleIssues(kind, d.clean)] : checked),
    ...(refusal ? [{ level: "error" as const, path: "", message: `At the last save it could not be stored as the ${noun} itself: ${refusal}` }] : []),
  ], [checked, drawable, kind, d.clean, refusal, noun]);
  const errors = issues.filter((i) => i.level === "error").length;
  // something deleted comes back as a never-published document of its own, which the checker must
  // pass; everything else can always be saved (a never-published document as its working draft)
  const saveErrors = isGone ? checked.filter((i) => i.level === "error") : [];
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focus, setFocus] = useState<{ issue: Issue; n: number } | null>(null);
  const goTo = (issue?: Issue) => { if (issue) setFocus((f) => ({ issue, n: (f?.n ?? 0) + 1 })); };
  // a change makes an earlier "could not" out of date
  useEffect(() => { setNotice(null); }, [d.draft]);
  // Undo and Redo say what they did, and what they brought back is selected
  const items = (doc: T) => ((doc as Process).steps ?? (doc as Standard).requirements ?? []) as { id: string }[];
  // a step or requirement that came or went says the most about a change
  const mainChange = (a: T | undefined, b: T | undefined): Change | undefined => {
    if (!a || !b) return undefined;
    try { const c = compare(kind, a, b, catalog); return c.find((x) => x.kind !== "changed") ?? c[0]; } catch { return undefined; }
  };
  // words for a tooltip: never a reason for the screen to fail
  const describe = (a: T | undefined, b: T | undefined) => { try { const c = mainChange(a, b); return c ? describeChange(c) : ""; } catch { return ""; } };
  // a move is named by the step or requirement that moved, not by a neighbour whose arrows changed with it
  const undoWhat = useMemo(() => {
    const it = moveOf(d.draft) ? items(d.draft).find((x) => x.id === moveOf(d.draft)) as { id: string; title?: string } | undefined : undefined;
    if (it) return `Move of ${kind === "process" ? "step" : "requirement"} ${it.title?.trim() ? `“${it.title.trim()}”` : kind === "process" ? `${items(d.draft).indexOf(it) + 1}` : it.id}`;
    return describe(d.previous, d.draft);
  }, [d.previous, d.draft]); // eslint-disable-line react-hooks/exhaustive-deps
  // the screen's messages end when it is left
  useEffect(() => () => editNotice.clear(), []);
  const [reveal, setReveal] = useState<{ item: string; n: number } | null>(null);
  useEffect(() => {
    const st = d.stepped;
    if (!st) return;
    // said as what is true now: from what was on screen to what is on screen ("Step “Approve” is back.")
    let said = st.dir === "undo" ? "Undone." : "Done again.";
    try {
      // a move is said by the item that moved, not by a neighbour whose arrows changed with it
      const moved = moveOf(st.dir === "undo" ? st.from : st.to) ?? movedItem(items(st.from).map((x) => x.id), items(st.to).map((x) => x.id));
      const it = moved ? (items(st.to).find((x) => x.id === moved) as { id: string; title?: string }) : undefined;
      said = it
        ? movedMessage(st.dir, kind === "process" ? "Step" : "Requirement", kind === "process" ? it.title ?? "" : it.title?.trim() ? `${it.id} ${it.title}` : "", kind === "process" ? `Step ${items(st.to).indexOf(it) + 1}` : `Requirement ${it.id}`)
        : steppedMessage(st.dir, mainChange(st.from, st.to));
    } catch { /* the plain words */ }
    editNotice.info(said);
    const before = new Map(items(st.from).map((x) => [x.id, JSON.stringify(x)]));
    const touched = items(st.to).find((x) => !before.has(x.id)) ?? items(st.to).find((x) => before.get(x.id) !== JSON.stringify(x));
    if (touched) setReveal((r) => ({ item: touched.id, n: (r?.n ?? 0) + 1 }));
  }, [d.stepped?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [jsonWanted, setJsonWanted] = useState(false);
  const json = jsonWanted || !drawable;
  const [jsonPending, setJsonPending] = useState(false);
  useEffect(() => (jsonPending ? guardLeaving(`${kind}/${id}#json`, `the JSON of this ${noun} (it still has problems, so it is not part of the draft)`) : undefined), [jsonPending, kind, id, noun]);
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<null | "publish" | "versions" | "ai" | "retire">(null);
  const [publishConflict, setPublishConflict] = useState<{ c: Conflict; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // publishing over a version published since these changes were started: the version they were
  // started from, and who published since, to mark the lines that would undo their change
  const [since, setSince] = useState<{ base: T; who: string } | null>(null);
  const draftBase = working?.base ?? 0;
  useEffect(() => {
    setSince(null);
    if (dialog !== "publish" || unpublished || !draftBase || draftBase >= version) return;
    let live = true;
    Promise.all([loadVersion<T>(kind, id, draftBase), loadHistory(kind, id).catch(() => [])]).then(([b, list]) => {
      if (!live) return;
      const newer = list.filter((v) => v.version > draftBase && !v.deleted && v.savedBy !== me);
      const names = [...new Set(newer.map((v) => savedByText(v)))];
      setSince({ base: b, who: names.length === 1 ? names[0] : "somebody else" });
    }, () => { /* the list is shown without the marks */ });
    return () => { live = false; };
  }, [dialog, draftBase, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const losing = useBelongsWarning(kind, d.saved, d.draft);
  const refused = belongsRefused(perms, kind, d.saved, d.draft).length > 0;
  const stored = o.doc;
  const status = statusOf(stored);
  // text in the JSON that has problems is a change too, only not one that can be saved yet
  const unsaved = d.dirty || jsonPending;
  // deleted by somebody else: readers no longer see it, whatever it was before
  const state = isGone
    ? { key: "draft" as const, pill: "Deleted", sentence: "Readers no longer see it. Saving brings it back as a draft" }
    : editState({ status: stored.status, version, working: !!working, dirty: unsaved });
  const leaveJson = async () => {
    if (jsonPending && !(await confirmDialog({
      title: "Leave the JSON without its changes?", body: "The JSON has changes with problems, so they are not part of the draft. If you go back to the editor now they are lost.",
      confirmLabel: "Leave without them", cancelLabel: "Stay", danger: true,
    }))) return;
    setJsonPending(false);
    setJsonWanted(false);
  };

  // who saved last what a publication puts out: the working draft, else the stored never-published document
  const lastSaver = working ?? (unpublished ? o.meta : undefined);
  const keepStatus = (doc: T): T => ({ ...doc, status: unpublished ? "draft" : stored.status });
  // A member of its platform or practice saves drafts like an owner, but cannot publish (nor
  // retire, unpublish, bring back or delete): who can is said on the screen, by name
  // publishing depends on where it is stored and where the changes put it (`publishPlaces`): a
  // never-published document needs an owner of its whole placement, a move an owner of both ends
  const placement = publishPlaces(d.saved, d.draft, !unpublished);
  const mayPublish = canPublish(perms, kind, d.saved, d.draft, !unpublished);
  // retire, bring back, unpublish and delete act on what is stored: the right for where it is stored
  const mayChangeStored = canPublish(perms, kind, d.saved);
  const [owners, setOwners] = useState<Membership[] | null>(null);
  useEffect(() => {
    if (mayPublish || owners) return;
    let live = true;
    loadMembers().then((m) => { if (live) setOwners(m); }, () => { /* said without their names */ });
    return () => { live = false; };
  }, [mayPublish, owners]);
  // the owners by name where the portal knows it (`GET /api/members` gives it), the address as tooltip
  const ownersOf = (k: "platform" | "practice", id: string) => (owners ? membersOf(owners, k, id).map((m) => ({ email: m.email, name: m.name })) : []);
  const publishRightParts = mayPublish ? [] : whoPublishesParts(kind, {
    all: placement.all,
    groups: placement.places.map((x) => ({ kind: x.kind, name: x.kind === "platform" ? platformName(catalog, x.id) : practiceName(catalog, x.id), owners: ownersOf(x.kind, x.id) })),
  }, unsaved ? "unsaved" : working || unpublished ? "saved" : "none", !!owners);
  const publishRight = partsText(publishRightParts);
  const rightsBlock = refused ? "Put the platform or practice back as it was (under About)." : losing ? "Keep it with a platform or practice of yours (under About)." : "";
  const jsonBlock = jsonPending ? "The JSON has changes with problems. Fix them there first." : "";
  const firstError = issues.find((i) => i.level === "error");
  const onlyExamples = errors > 0 && issues.filter((i) => i.level === "error").every(isExampleIssue);
  const problemsBlock = !errors ? "" : onlyExamples
    ? `First replace ${errors === 1 ? "the example text" : `the ${errors} example texts`} with your own words (under “${errors} to fix”).`
    : `First fix ${errors === 1 ? "the 1 thing" : `the ${errors} things`} listed under “${errors} to fix”.`;
  const saveBlocked = !d.dirty && !jsonPending ? "Nothing to save: all changes are saved." : undefined;
  const publishBlocked = rightsBlock || publishRight || jsonBlock || problemsBlock
    || (!unpublished && !working && !d.dirty ? "There are no changes to publish." : "") || undefined;

  // Save draft can always be pressed while there is something to save; when it cannot be saved
  // yet, the line under the bar says why and the first problem is brought into view
  // resolves to true once saved (leaving with "Save draft and leave" waits for it)
  const saveDraft = async (): Promise<boolean> => {
    if (d.saving) return false;
    if (saveBlocked) return !unsaved;
    const why = rightsBlock || jsonBlock;
    if (why) { setNotice({ text: `This draft cannot be saved yet. ${why}`, tone: "bad" }); return false; }
    if (saveErrors.length) {
      const first = saveErrors[0];
      const why = `This ${noun} cannot be brought back yet: it comes back as a draft, which is only saved with nothing to fix. Your changes are still here.`;
      setNotice({ text: why, tone: "bad", issue: first });
      goTo(first);
      return false;
    }
    setNotice(null);
    return d.save("", keepStatus);
  };
  const tryPublish = () => {
    if (busy || d.saving) return;
    const why = rightsBlock || jsonBlock;
    if (why) return setNotice({ text: `This cannot be published yet. ${why}`, tone: "bad" });
    if (publishRight) return setNotice({ text: whoPublishesShort(kind, { groups: placement.places as never[] }), tone: "warn" });
    if (problemsBlock) { setNotice({ text: problemsBlock, tone: "bad", issue: firstError }); return goTo(firstError); }
    setDialog("publish");
  };
  // Ctrl+S (Cmd+S on a Mac) saves the draft; so does "Save draft and leave" when leaving
  const saveRef = useRef(saveDraft);
  saveRef.current = saveDraft;
  useEffect(() => offerSaving(`${kind}/${id}`, () => saveRef.current()), [kind, id]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      saveRef.current();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const published = async (newVersion?: number) => {
    await opts.current.onRefresh().catch(() => {});
    opts.current.onDraftMeta(null);
    notify.info(newVersion ? `Published. Readers now see version ${newVersion}.` : "Published.");
  };

  const publish = async (note: string, over?: number): Promise<boolean> => {
    if (unpublished) {
      // a draft that was never published: an ordinary save, with the status "active"
      const ok = await d.save(note, (doc) => ({ ...doc, status: "active" }));
      if (ok) notify.info(`Published. Everybody can now find this ${noun}.`);
      return ok;
    }
    // what is on screen goes into the working draft first; when that is refused, the conflict
    // dialog takes over from the Publish dialog
    if (d.dirty && !(await d.save("", keepStatus))) { setDialog(null); return false; }
    const w = workingNow.current;
    if (!w) return false;
    try {
      const r = await publishWorkingDraft(kind, id, w.revision, note, over);
      setPublishConflict(null);
      await published(r?.version);
      restart();
      return true;
    } catch (e) {
      const c = conflictOf(e);
      if (!c) { notify.error("The changes could not be published.", whyNot(e, noun)); return false; }
      // refused because somebody else saved or discarded the draft, or because a newer version was published
      setDialog(null);
      if (c.draft) { d.raiseConflict(c); return false; }
      setPublishConflict({ c, note });
      return false;
    }
  };

  const discardDraft = async () => {
    const w = workingNow.current;
    if (!w) return;
    const by = w.updatedBy ? <>, last saved by {author(w, me).you ? "you" : author(w, me).name} {savedWhen(w.updatedAt)}</> : null;
    const yes = await confirmDialog({
      title: unpublished ? "Discard the newer changes?" : "Discard the unpublished changes?",
      body: unpublished
        ? <>The changes to “{stored.title}” that are kept in its draft{by}, are thrown away for everybody who edits it. It goes back to how it was last stored as the {noun} itself. This cannot be undone.</>
        : <>All unpublished changes to “{stored.title}”{by}, are thrown away for everybody who edits it. Readers keep seeing version {version}. This cannot be undone.</>,
      confirmLabel: "Discard draft", cancelLabel: "Keep the draft", danger: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      await deleteWorkingDraft(kind, id, w.revision);
      opts.current.onDraftMeta(null);
      notify.info(unpublished ? `The newer changes were discarded. The draft is back to how it was last stored as the ${noun} itself.` : `The unpublished changes were discarded. Readers see version ${version}.`);
      restart();
    } catch (e) {
      notify.error("The draft could not be discarded.", conflictOf(e) ? "Somebody else saved the draft in the meantime. Look at their changes first." : e);
      if (conflictOf(e)) void d.takeTheirs();
    } finally { setBusy(false); }
  };

  // retiring, unpublishing and bringing back are ordinary saves of the stored document
  const setStatus = async (next: T, note: string, done: string) => {
    setBusy(true);
    try {
      await opts.current.onSave(o.tidy(next), version, note);
      notify.info(done);
      return true;
    } catch (e) {
      notify.error(`The ${noun} could not be changed.`, whyNot(e, noun));
      if (conflictOf(e)) void opts.current.onRefresh();
      return false;
    } finally { setBusy(false); }
  };
  const statusBlock = statusChangeBlocked({ working: !!working, dirty: d.dirty }) || undefined;
  const unpublish = async () => {
    const yes = await confirmDialog({
      title: `Unpublish this ${noun}?`,
      body: <>Readers no longer find or open “{stored.title}”; links to it stop working for them. {kind === "process" ? "Its skill is" : "Its skills are"} withdrawn and search and AI agents no longer find it. It becomes a draft again: only {draftAudience(kind)} can open it, and you can publish it again later.</>,
      confirmLabel: "Unpublish", danger: true,
    });
    if (yes) await setStatus({ ...stored, status: "draft" }, "Unpublished", `Unpublished. Readers no longer see this ${noun}.`);
  };
  const bringBack = async () => {
    const yes = await confirmDialog({
      title: "Bring it back into use?",
      body: <>Readers see “{stored.title}” as in use again, without the retired mark{stored.replacedBy ? " and without the pointer to its replacement" : ""}.</>,
      confirmLabel: "Bring back into use",
    });
    if (yes) await setStatus({ ...stored, status: "active", replacedBy: undefined }, "Back in use", `“${stored.title}” is in use again.`);
  };
  const remove = async () => {
    const yes = await confirmDialog({
      title: `Delete this ${noun}?`,
      body: <>“{stored.title}” is removed for everyone{working ? ", with its unpublished changes" : ""}. Readers’ links stop working, {kind === "process" ? "its skill is" : "its skills are"} withdrawn and its feedback is removed.{d.dirty ? " Your unsaved changes are lost." : ""}</>,
      confirmLabel: `Delete ${noun}`, danger: true,
    });
    if (yes) o.onDelete(version);
  };

  const more: MenuItem[] = [
    ...(version ? [{ label: "Versions", icon: <History size={16} />, hint: "See and restore earlier versions", run: () => setDialog("versions") }] : []),
    { label: "Change with AI", icon: <Sparkles size={16} />, hint: "Describe a change in plain words", run: () => setDialog("ai"), blocked: drawable ? undefined : "Repair the JSON first." },
    { label: json ? "Back to the editor" : "JSON", icon: <Braces size={16} />, hint: json ? undefined : "The text of the whole document", run: () => (jsonWanted ? void leaveJson() : setJsonWanted(true)), blocked: !drawable ? "It cannot be shown otherwise until the JSON is repaired." : undefined },
    ...(working ? [{ label: "Discard draft…", icon: <Undo2 size={16} />, hint: unpublished ? `Back to how it was last stored as the ${noun} itself` : `Readers keep version ${version}`, run: discardDraft, divider: true, danger: true }] : []),
    ...(mayChangeStored && !unpublished && status === "active" ? [{ label: "Retire…", icon: <Archive size={16} />, hint: "Keep it for reference, marked as retired", run: () => setDialog("retire"), blocked: statusBlock, divider: !working }] : []),
    ...(mayChangeStored && !unpublished && status === "deprecated" ? [{ label: "Bring back into use…", icon: <RotateCcw size={16} />, run: bringBack, blocked: statusBlock, divider: !working }] : []),
    ...(mayChangeStored && !unpublished ? [{ label: "Unpublish…", icon: <EyeOff size={16} />, hint: "Hide it from readers again", run: unpublish, blocked: statusBlock }] : []),
    ...(mayChangeStored ? [{ label: "Delete…", icon: <Trash2 size={16} />, run: remove, danger: true, divider: unpublished }] : []),
  ];

  const discard: BarAction | undefined = d.dirty
    ? { label: "Discard changes", run: () => d.discard() }
    : working ? { label: "Discard draft…", run: discardDraft, busy } : undefined;

  // somebody else saved the never-published document's working draft after these changes were started
  const draftMoved = unpublished && draftMovedOn({ dirty: d.dirty, editedFrom: revOfDoc.current.get(d.saved as object) ?? 0, working });
  // what somebody else did meanwhile, while it is still so
  const saidMeanwhile = meanwhile && meanwhile.status === (stored.status ?? "active") ? meanwhile.text : "";
  const banners = (
    <>
      {unpublished && <BehindBanner d={d} meta={o.meta} noun={`this ${noun}`} />}
      {(unpublished ? draftMoved : d.behind && d.dirty) && !d.conflict && working && (
        <Alert tone="warning" className="banner" title={`${author(working, me).name} saved ${unpublished ? "newer changes to the draft" : "the unpublished changes"} ${savedWhen(working.updatedAt)}`.trim()}
          actions={<button className="btn small" onClick={() => d.raiseConflict({ exists: true, version: working.revision, updatedBy: working.updatedBy, updatedByName: working.updatedByName, updatedAt: working.updatedAt })}>Compare and decide</button>}>
          That was while you were editing. Your changes are still here.
        </Alert>
      )}
      {!unpublished && !isGone && !saidMeanwhile && working && !rebaseTo.current && baseBehindSentence(working.base, version) && (
        <Alert tone="info" className="banner">{baseBehindSentence(working.base, version)}</Alert>
      )}
      {saidMeanwhile && <Alert tone="warning" className="banner" role="status">{saidMeanwhile}</Alert>}
      {losing && <Alert tone="warning" className="banner" role="alert">{losing}</Alert>}
      {publishRight && !losing && !refused && <Alert tone="info" className="banner publish-right"><SentenceParts parts={publishRightParts} /></Alert>}
    </>
  );
  const hasBanners = !!saidMeanwhile || (unpublished && d.behind && d.dirty && !d.conflict) || (unpublished ? draftMoved : d.behind && d.dirty) && !!working || (!isGone && !!working && !rebaseTo.current && !!baseBehindSentence(working.base, version)) || !!losing || !!publishRight;

  const replaceable = o.others.filter((x) => x.id !== id && x.status !== "draft" && x.status !== "deprecated");
  const dialogs = (
    <>
      {dialog === "publish" && (
        <PublishDialog noun={noun} first={unpublished} version={version} blocked={publishBlocked}
          lastSavedBy={lastSavedByOther(lastSaver, me, d.dirty)} lastSavedAt={lastSaver?.updatedAt}
          changes={unpublished ? [] : publishList(kind, stored, d.clean, catalog, since?.base)} since={since?.who}
          onPublish={(note) => publish(note)} onClose={() => setDialog(null)} />
      )}
      {dialog === "versions" && <HistoryDialog<T> kind={kind} id={id} title={stored.title} onClose={() => setDialog(null)} draftKept={!unpublished}
        onRestore={(doc, v) => { d.change(keepStatus({ ...doc, id })); setDialog(null); notify.info(`Version ${v} is now in your draft. Save the draft or publish it to keep it; Undo takes it back.`); }} />}
      {dialog === "ai" && (
        <Suspense fallback={null}>
          <AiDialog spec={o.aiSpec(d.clean)} onClose={() => setDialog(null)} onImport={(doc) => {
            d.change(keepStatus({ ...doc, id })); setDialog(null);
            editNotice.info("The changes from the AI chat are in your draft, not saved yet.", { label: "Undo", run: () => d.undo() }, "Check them on the screen; Save draft keeps them.");
          }} />
        </Suspense>
      )}
      {dialog === "retire" && <RetireDialog noun={noun} title={stored.title} others={replaceable} onClose={() => setDialog(null)}
        onRetire={async (replacedBy) => {
          if (await setStatus({ ...stored, status: "deprecated", replacedBy }, "Retired", `Retired. Readers see “${stored.title}” marked as retired.`)) setDialog(null);
        }} />}
      {publishConflict && <PublishConflict kind={kind} id={id} c={publishConflict.c} base={working?.base ?? 0} onClose={() => setPublishConflict(null)}
        onMine={() => publish(publishConflict.note, publishConflict.c.version)}
        onTheirs={async () => {
          // Their version goes into the editor as a change of its own: the draft on the server
          // stays as it was until the next save, which moves it onto their version; Undo brings
          // the person's own changes back, and leaving without saving asks as usual.
          const v = publishConflict.c.version ?? 0;
          try {
            const theirs = await loadVersion<T>(kind, id, v);
            rebaseTo.current = v;
            startBase.current = v;
            d.change(keepStatus({ ...theirs, id }));
            await opts.current.onRefresh().catch(() => {});
            setPublishConflict(null);
            notify.info("Their version is now in the editor, not saved yet. Undo brings your own changes back; Save draft continues from theirs.");
          } catch (e) { notify.error("Their version could not be loaded.", e); }
        }} />}
      <ConflictDialog d={d} kind={kind} id={id} noun={`this ${noun}`} blocked={rightsBlock || jsonBlock || undefined}
        onRestore={() => { markGone(); saveDraft(); }} wasPublished={!unpublished} startedFrom={unpublished ? d.base : startBase.current}
        theirs={unpublished && !d.conflict?.draft ? undefined : async () => (await loadWorkingDraft<T>(kind, id))?.doc} />
    </>
  );

  const jsonView = json ? (
    <Suspense fallback={<Loading />}>
      {!drawable
        ? <Alert tone="warning" className="banner" role="alert">This {noun} cannot be shown until the problems in its JSON are fixed.</Alert>
        : <div className="json-head"><button className="btn small" onClick={() => void leaveJson()}><ArrowLeft size={14} />Back to the editor</button><span className="muted small">The text of the whole {noun}. Changes that pass the checks go into the draft as you type.</span></div>}
      <JsonView doc={d.clean} noun={noun} validate={o.json.validate} schema={o.json.schema} schemaFile={o.json.schemaFile} onChange={(doc) => d.change(doc)} onPending={setJsonPending} />
    </Suspense>
  ) : null;

  const back = () => go(kind === "process" ? { page: "process", id, tab: "flow" } : { page: "standard", id, tab: "doc" });
  // " by Dana Admin" when somebody else saved it last
  const byOther = (x: { updatedBy?: string; updatedByName?: string }) => { const w = author(x, me); return x.updatedBy?.includes("@") && !w.you ? ` by ${w.name}` : ""; };
  // a fault while showing the screen keeps the work: the draft lives here, above the boundary
  return <EditingBoundary resetKey={d.draft} noun={noun} onUndo={d.canUndo ? d.undo : undefined} onSave={d.dirty ? saveDraft : undefined} onBack={back}>{children({
    d, draftKind, drawable, working, issues, json, jsonView, panel, setPanel, dialogs, focus, reveal,
    frame: {
      state, unsaved,
      notice,
      saveLine: unsaved ? "Not saved yet" : working ? `Draft saved ${clock(working.updatedAt)}${byOther(working)}`
        : unpublished && o.meta?.updatedAt ? `Saved ${clock(o.meta.updatedAt)}${byOther(o.meta)}` : "Saved",
      onNotice: () => setNotice(null),
      fixBefore: (i) => (isGone && !isExampleIssue(i) ? "saving" : "publishing"),
      undo: { canUndo: d.canUndo, canRedo: d.canRedo, undo: d.undo, redo: d.redo, undoTitle: undoWhat ? `Undo: ${undoWhat.charAt(0).toLowerCase()}${undoWhat.slice(1)} (Ctrl+Z)` : undefined },
      onBack: back,
      discard,
      save: { label: "Save draft", run: saveDraft, blocked: saveBlocked, busy: d.saving },
      publish: {
        label: "Publish…", run: tryPublish, busy: busy || d.saving,
        // nothing to publish: off; problems, rights or JSON: visibly unavailable, but pressing it says why
        blocked: publishBlocked === "There are no changes to publish." ? publishBlocked : undefined,
        unavailable: publishBlocked && publishBlocked !== "There are no changes to publish." ? publishBlocked : undefined,
      },
      more,
      banners: hasBanners ? banners : undefined,
    },
  })}</EditingBoundary>;
}

/** "Retire…": readers keep finding it, marked as retired, pointing to what replaces it. */
function RetireDialog({ noun, title, others, onRetire, onClose }: {
  noun: string; title: string; others: { id: string; title: string }[]; onRetire: (replacedBy?: string) => Promise<void>; onClose: () => void;
}) {
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Retire this ${noun}?`} subtitle={`“${title}” is kept for reference.`} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await onRetire(by || undefined); } finally { setBusy(false); } }}><Archive size={15} />Retire</button></>}>
      <div className="form">
        <p>Readers still find and open it, marked as retired{by ? " and sent to its replacement" : ""}. You can bring it back into use later.</p>
        <label className="field">
          <span className="field-label">Use instead<em>What readers should follow now. Optional.</em></span>
          <select value={by} onChange={(e) => setBy(e.target.value)} data-autofocus="">
            <option value="">Nothing replaces it</option>
            {others.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </label>
      </div>
    </Modal>
  );
}

/**
 * Publishing was refused: somebody published another version after these changes were started.
 * Nothing is overwritten without a decision.
 */
function PublishConflict({ kind, id, c, base, onMine, onTheirs, onClose }: {
  kind: TargetKind; id: string; c: Conflict; base: number;
  onMine: () => Promise<boolean>; onTheirs: () => Promise<void>; onClose: () => void;
}) {
  const { catalog } = useCatalog();
  const [changes, setChanges] = useState<Change[] | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!c.version || !base) return;
    Promise.all([loadVersion<unknown>(kind, id, base), loadVersion<unknown>(kind, id, c.version)])
      .then(([a, b]) => setChanges(compare(kind, a, b, catalog)), () => setChanges("failed"));
  }, [kind, id, base, c.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (fn: () => Promise<unknown>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const who = author(c, useMe().user?.email);
  return (
    <Modal title={who.you ? "You published in another window first" : c.status === "deprecated" ? `${who.name} retired it first` : c.status === "draft" ? `${who.name} unpublished it first` : "Somebody else published first"}
      subtitle={`${who.name} ${c.status === "deprecated" ? "retired it as" : c.status === "draft" ? "unpublished it as" : "published"} version ${c.version}${c.updatedAt ? ` ${savedWhen(c.updatedAt)}` : ""}, after these changes were started from version ${base || "an earlier one"}.`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Keep editing</button>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={run(onTheirs)} title="Their version goes into the editor, not saved yet; Undo brings your changes back.">Continue from theirs</button>
        <button className="btn primary danger" disabled={busy} onClick={run(onMine)} title="Your version becomes the newest. Theirs stays in the list of versions.">Publish mine over theirs</button>
      </>}>
      <p>Nothing was published and nothing was overwritten. Your changes are still in the draft.</p>
      <p>Nothing is merged: “Continue from theirs” starts from their version (Undo brings yours back as a whole), and “Publish mine over theirs” replaces theirs. A change of theirs you want to keep has to be made again in yours.</p>
      <h3 className="mini-title">What they changed</h3>
      {changes === "failed" ? <p className="muted">What they changed could not be loaded. Look at the versions in the More menu.</p>
        : changes ? <ChangeList changes={changes} /> : base ? <p className="muted">Looking…</p> : null}
      <p className="muted small">“Publish mine over theirs” makes your version the newest; theirs stays in the list of versions and can be restored. “Continue from theirs” starts from what they published; Undo brings your changes back so you can add them again.</p>
    </Modal>
  );
}
