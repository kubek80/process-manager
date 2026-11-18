import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Archive, Braces, EyeOff, History, RotateCcw, Sparkles, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import type { DocMeta, Issue, Process, Standard, TargetKind } from "../types";
import { conflictOf, useDraft, type Conflict, type Draft } from "../lib/draft";
import { author, baseBehindSentence, draftKindOf, draftSaveBase, editState, exampleIssues, isExampleIssue, issueText, publishLines, statusChangeBlocked, type DraftKind } from "../lib/editing";
import { compare, type Change } from "../lib/diff";
import { belongsRefused } from "../lib/rights";
import { useMe, usePerms } from "../lib/session";
import { useCatalog } from "../lib/catalog";
import { statusOf } from "../lib/lifecycle";
import {
  ApiError, deleteWorkingDraft, go, guardLeaving, loadVersion, loadWorkingDraft, publishWorkingDraft, putWorkingDraft, type WorkingDraft,
} from "../lib/store";
import type { AiSpec } from "./AiDialog";
import { BehindBanner, ChangeList, ConflictDialog, HistoryDialog, savedWhen } from "./Editing";
import { type BarAction, type MenuItem, type Panel, PublishDialog } from "./EditFrame";
import { useBelongsWarning } from "./Governance";
import { confirmDialog, LoadError, Loading, Modal, notify } from "./ui";

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
  jsonView: ReactNode;
  panel: Panel; setPanel: (p: Panel) => void;
  frame: {
    state: ReturnType<typeof editState>; unsaved: boolean;
    undo: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
    onBack: () => void; discard?: BarAction; save: BarAction; publish: BarAction; more: MenuItem[];
    banners?: ReactNode;
    /** Why a press on Save draft or Publish did nothing, or why publishing waits: shown under the bar. */
    notice?: Notice | null; onNotice: () => void;
    /** Whether a problem has to be fixed before saving (a never-published draft) or before publishing. */
    fixBefore: (i: Issue) => "saving" | "publishing";
  };
  dialogs: ReactNode;
}

/** A line under the editing bar: why something did not happen, with the first problem to go to. */
export interface Notice { text: string; tone: "bad" | "warn"; issue?: Issue; persistent?: boolean }

const whyNot = (e: unknown, noun: string): string => {
  const c = conflictOf(e);
  if (c && !c.exists) return `Somebody else deleted this ${noun} in the meantime.`;
  if (c) return `${c.updatedBy ?? "Somebody else"} changed this ${noun} in the meantime. Look at the current version first.`;
  return e instanceof Error ? e.message : String(e);
};

/**
 * The draft behind the editing screen. A document that was never published is edited as itself;
 * a published one through its working draft, loaded first when there is one. The screen is
 * started afresh when that changes (published, discarded, unpublished).
 */
export function EditSession<T extends Doc>({ o, children }: { o: SessionOptions<T>; children: (s: Session<T>) => ReactNode }) {
  const [draftKind, setDraftKind] = useState<DraftKind>(() => draftKindOf(o.doc.status));
  const [generation, setGeneration] = useState(0);
  const loadKey = `${draftKind}:${generation}`;
  const [loaded, setLoaded] = useState<{ key: string; working: WorkingDraft<T> | null } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    if (draftKind === "unpublished") { setLoaded({ key: loadKey, working: null }); return () => {}; }
    let live = true;
    loadWorkingDraft<T>(o.kind, o.doc.id).then((w) => { if (live) setLoaded({ key: loadKey, working: w }); }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [loadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  if (error) return <div className="page"><LoadError what="The unpublished changes could not be loaded." error={error} onRetry={load} /></div>;
  if (loaded?.key !== loadKey) return <Loading page />;
  return (
    <SessionInner key={loadKey} o={o} draftKind={draftKind} initial={loaded.working}
      restart={(next) => { if (next) setDraftKind(next); setGeneration((g) => g + 1); }}>
      {children}
    </SessionInner>
  );
}

function SessionInner<T extends Doc>({ o, draftKind, initial, restart, children }: {
  o: SessionOptions<T>; draftKind: DraftKind; initial: WorkingDraft<T> | null;
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
  const setWorking = (w: WorkingDraft<T> | null) => { workingNow.current = w; setWorkingState(w); };
  const opts = useRef(o);
  opts.current = o;
  // The published version the changes on screen were made from. A draft that has to be created
  // again (somebody published or discarded it meanwhile) is created on it, so that publishing
  // still meets every version published since. "Continue from theirs" moves the next save onto
  // their version (`rebaseTo`).
  const startBase = useRef(initial?.base || o.meta?.version || 0);
  const rebaseTo = useRef<number | null>(null);

  const unpublished = draftKind === "unpublished";
  const d = useDraft<T>({
    docKey: `${kind}/${id}`, what: `this ${noun}`, tidy: o.tidy, stamp: o.stamp,
    saved: working?.doc ?? o.doc,
    version: unpublished ? o.meta?.version ?? 0 : working?.revision ?? 0,
    save: unpublished ? (doc, base, note) => opts.current.onSave(doc, base, note) : async (doc, rev) => {
      const r = await putWorkingDraft(kind, id, doc, rev, draftSaveBase(rev, startBase.current, rebaseTo.current));
      startBase.current = r.base;
      rebaseTo.current = null;
      setWorking({ doc, base: r.base, revision: r.revision, updatedBy: r.updatedBy, updatedByName: r.updatedByName, updatedAt: r.updatedAt });
      opts.current.onDraftMeta({ updatedAt: r.updatedAt, updatedBy: r.updatedBy, updatedByName: r.updatedByName });
      return r.revision;
    },
    reload: unpublished ? () => opts.current.onReload() : async () => {
      const w = await loadWorkingDraft<T>(kind, id);
      setWorking(w);
      rebaseTo.current = null;
      startBase.current = w?.base || opts.current.meta?.version || 0;
      opts.current.onDraftMeta(w ? { updatedAt: w.updatedAt, updatedBy: w.updatedBy, updatedByName: w.updatedByName } : null);
      return w ? { saved: w.doc, version: w.revision } : { saved: opts.current.doc, version: 0 };
    },
  });

  // somebody published the never-published document, or unpublished the published one: start
  // afresh as the other kind of draft - once nothing would be lost by it
  const storedKind = draftKindOf(o.doc.status);
  useEffect(() => { if (storedKind !== draftKind && !d.dirty) restart(storedKind); }, [storedKind, d.dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // somebody else saved the shared draft (the app hears of it when the tab comes back): fetch it
  const theirDraftAt = o.meta?.draft?.updatedAt;
  useEffect(() => {
    if (unpublished || !theirDraftAt || theirDraftAt === workingNow.current?.updatedAt) return;
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
  useEffect(() => { if (d.error) { notify.error(`The ${noun} could not be saved.`, d.error); d.clearError(); } }, [d.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const drawable = useMemo(() => o.drawable(d.draft), [d.draft, o.drawable]); // eslint-disable-line react-hooks/exhaustive-deps
  // the checker's findings, and the example texts of something new (to fix before publishing only)
  const checked = useMemo(() => o.check(d.clean), [d.clean, o.check]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useMemo(() => (drawable ? [...checked, ...exampleIssues(kind, d.clean)] : checked), [checked, drawable, kind, d.clean]);
  const errors = issues.filter((i) => i.level === "error").length;
  // a draft that was never published is saved as a version of its own, which the checker must pass
  const saveErrors = unpublished ? checked.filter((i) => i.level === "error") : [];
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focus, setFocus] = useState<{ issue: Issue; n: number } | null>(null);
  const goTo = (issue?: Issue) => { if (issue) setFocus((f) => ({ issue, n: (f?.n ?? 0) + 1 })); };
  // a change makes an earlier "could not" out of date
  useEffect(() => { setNotice(null); }, [d.draft]);
  const [jsonWanted, setJsonWanted] = useState(false);
  const json = jsonWanted || !drawable;
  const [jsonPending, setJsonPending] = useState(false);
  useEffect(() => (jsonPending ? guardLeaving(`${kind}/${id}#json`, `the JSON of this ${noun} (it still has problems, so it is not part of the draft)`) : undefined), [jsonPending, kind, id, noun]);
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<null | "publish" | "versions" | "ai" | "retire">(null);
  const [publishConflict, setPublishConflict] = useState<{ c: Conflict; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const losing = useBelongsWarning(kind, d.saved, d.draft);
  const refused = belongsRefused(perms, kind, d.saved, d.draft).length > 0;
  const stored = o.doc;
  const status = statusOf(stored);
  // text in the JSON that has problems is a change too, only not one that can be saved yet
  const unsaved = d.dirty || jsonPending;
  const state = editState({ status: stored.status, version, working: !!working, dirty: unsaved });
  const leaveJson = async () => {
    if (jsonPending && !(await confirmDialog({
      title: "Leave the JSON without its changes?", body: "The JSON has changes with problems, so they are not part of the draft. If you go back to the editor now they are lost.",
      confirmLabel: "Leave without them", cancelLabel: "Stay", danger: true,
    }))) return;
    setJsonPending(false);
    setJsonWanted(false);
  };

  const keepStatus = (doc: T): T => ({ ...doc, status: unpublished ? "draft" : stored.status });
  const rightsBlock = refused ? "Put the platform or practice back as it was (under About)." : losing ? "Keep it with a platform or practice of yours (under About)." : "";
  const jsonBlock = jsonPending ? "The JSON has changes with problems. Fix them there first." : "";
  const firstError = issues.find((i) => i.level === "error");
  const problemsBlock = errors ? `Publishing waits until ${errors === 1 ? "the problem is" : `the ${errors} problems are`} fixed. First: ${issueText(firstError!)}` : "";
  const saveBlocked = !d.dirty && !jsonPending ? "Nothing to save: all changes are saved." : undefined;
  const publishBlocked = rightsBlock || jsonBlock || problemsBlock
    || (!unpublished && !working && !d.dirty ? "There are no changes to publish." : "") || undefined;

  // Save draft can always be pressed while there is something to save; when it cannot be saved
  // yet, the line under the bar says why and the first problem is brought into view
  const saveDraft = () => {
    if (d.saving || saveBlocked) return;
    const why = rightsBlock || jsonBlock;
    if (why) return setNotice({ text: `This draft cannot be saved yet. ${why}`, tone: "bad" });
    if (saveErrors.length) {
      const first = saveErrors[0];
      setNotice({ text: `This draft cannot be saved yet: a ${noun} that was never published is only saved when the checker finds no problems. ${saveErrors.length === 1 ? "The problem" : `First of ${saveErrors.length}`}: ${issueText(first)}`, tone: "bad", issue: first });
      return goTo(first);
    }
    setNotice(null);
    void d.save("", keepStatus);
  };
  const tryPublish = () => {
    if (busy || d.saving) return;
    const why = rightsBlock || jsonBlock;
    if (why) return setNotice({ text: `This cannot be published yet. ${why}`, tone: "bad" });
    if (problemsBlock) { setNotice({ text: problemsBlock, tone: "bad", issue: firstError }); return goTo(firstError); }
    setDialog("publish");
  };
  // Ctrl+S (Cmd+S on a Mac) saves the draft
  const saveRef = useRef(saveDraft);
  saveRef.current = saveDraft;
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
    const yes = await confirmDialog({
      title: "Discard the unpublished changes?",
      body: <>All unpublished changes to “{stored.title}”{w.updatedBy ? <>, last saved by {w.updatedByName || w.updatedBy} {savedWhen(w.updatedAt)}</> : null}, are thrown away for everybody who edits it. Readers keep seeing version {version}. This cannot be undone.</>,
      confirmLabel: "Discard draft", cancelLabel: "Keep the draft", danger: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      await deleteWorkingDraft(kind, id, w.revision);
      opts.current.onDraftMeta(null);
      notify.info(`The unpublished changes were discarded. Readers see version ${version}.`);
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
      body: <>Readers no longer find or open “{stored.title}”; links to it stop working for them. {kind === "process" ? "Its skill is" : "Its skills are"} withdrawn and search and AI agents no longer find it. It becomes a draft that only the people who may change or look after it can open, and you can publish it again later.</>,
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
    ...(working ? [{ label: "Discard draft…", icon: <Undo2 size={16} />, hint: `Readers keep version ${version}`, run: discardDraft, divider: true, danger: true }] : []),
    ...(!unpublished && status === "active" ? [{ label: "Retire…", icon: <Archive size={16} />, hint: "Keep it for reference, marked as retired", run: () => setDialog("retire"), blocked: statusBlock, divider: !working }] : []),
    ...(!unpublished && status === "deprecated" ? [{ label: "Bring back into use…", icon: <RotateCcw size={16} />, run: bringBack, blocked: statusBlock, divider: !working }] : []),
    ...(!unpublished ? [{ label: "Unpublish…", icon: <EyeOff size={16} />, hint: "Hide it from readers again", run: unpublish, blocked: statusBlock }] : []),
    { label: "Delete…", icon: <Trash2 size={16} />, run: remove, danger: true, divider: unpublished },
  ];

  const discard: BarAction | undefined = d.dirty
    ? { label: "Discard changes", run: () => d.discard() }
    : working ? { label: "Discard draft…", run: discardDraft, busy } : undefined;

  const banners = (
    <>
      {unpublished && <BehindBanner d={d} meta={o.meta} noun={`this ${noun}`} />}
      {!unpublished && d.behind && d.dirty && !d.conflict && working && (
        <div className="check warn banner">
          <TriangleAlert size={16} /><span><b>{author(working, me).name} saved the unpublished changes</b> {savedWhen(working.updatedAt)} while you were editing. Your changes are still here.</span>
          <span className="spacer" />
          <button className="btn small" onClick={() => d.raiseConflict({ exists: true, version: working.revision, updatedBy: working.updatedBy, updatedByName: working.updatedByName, updatedAt: working.updatedAt })}>Compare and decide</button>
        </div>
      )}
      {!unpublished && working && !rebaseTo.current && baseBehindSentence(working.base, version) && (
        <div className="check info banner">
          <History size={16} /><span>{baseBehindSentence(working.base, version)}</span>
        </div>
      )}
      {losing && <div className="check warn banner" role="alert"><TriangleAlert size={16} /><span>{losing}</span></div>}
    </>
  );
  const hasBanners = (unpublished && d.behind && d.dirty && !d.conflict) || (!unpublished && d.behind && d.dirty && !!working) || (!!working && !rebaseTo.current && !!baseBehindSentence(working.base, version)) || !!losing;

  const replaceable = o.others.filter((x) => x.id !== id && x.status !== "draft" && x.status !== "deprecated");
  const dialogs = (
    <>
      {dialog === "publish" && (
        <PublishDialog noun={noun} first={unpublished} version={version} blocked={publishBlocked}
          changes={unpublished ? [] : publishLines(kind, stored, d.clean, catalog)}
          onPublish={(note) => publish(note)} onClose={() => setDialog(null)} />
      )}
      {dialog === "versions" && <HistoryDialog<T> kind={kind} id={id} title={stored.title} onClose={() => setDialog(null)}
        onRestore={(doc, v) => { d.change(keepStatus({ ...doc, id })); setDialog(null); notify.info(`Version ${v} is now in your draft. Save the draft or publish it to keep it; Undo takes it back.`); }} />}
      {dialog === "ai" && (
        <Suspense fallback={null}>
          <AiDialog spec={o.aiSpec(d.clean)} onClose={() => setDialog(null)} onImport={(doc) => { d.change(keepStatus({ ...doc, id })); setDialog(null); }} />
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
      <ConflictDialog d={d} kind={kind} id={id} noun={`this ${noun}`} blocked={rightsBlock || jsonBlock || (unpublished ? problemsBlock : "") || undefined}
        theirs={unpublished ? undefined : async () => (await loadWorkingDraft<T>(kind, id))?.doc} />
    </>
  );

  const jsonView = json ? (
    <Suspense fallback={<Loading />}>
      {!drawable
        ? <div className="check warn banner" role="alert"><TriangleAlert size={16} /><span>This {noun} cannot be shown until the problems in its JSON are fixed.</span></div>
        : <div className="json-head"><button className="btn small" onClick={() => void leaveJson()}><ArrowLeft size={14} />Back to the editor</button><span className="muted small">The text of the whole {noun}. Changes that pass the checks go into the draft as you type.</span></div>}
      <JsonView doc={d.clean} noun={noun} validate={o.json.validate} schema={o.json.schema} schemaFile={o.json.schemaFile} onChange={(doc) => d.change(doc)} onPending={setJsonPending} />
    </Suspense>
  ) : null;

  return <>{children({
    d, draftKind, drawable, working, issues, json, jsonView, panel, setPanel, dialogs, focus,
    frame: {
      state, unsaved,
      notice: notice ?? (problemsBlock && (d.dirty || working || unpublished) ? { text: problemsBlock, tone: "warn", issue: firstError, persistent: true } : null),
      onNotice: () => setNotice(null),
      fixBefore: (i) => (unpublished && !isExampleIssue(i) ? "saving" : "publishing"),
      undo: { canUndo: d.canUndo, canRedo: d.canRedo, undo: d.undo, redo: d.redo },
      onBack: () => go(kind === "process" ? { page: "process", id, tab: "flow" } : { page: "standard", id, tab: "doc" }),
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
  })}</>;
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
      .then(([a, b]) => setChanges(compare(kind, a, b, catalog)), (e) => setChanges(e instanceof ApiError ? "failed" : "failed"));
  }, [kind, id, base, c.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (fn: () => Promise<unknown>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const who = author(c, useMe().user?.email);
  return (
    <Modal title={who.you ? "You published in another window first" : "Somebody else published first"} subtitle={`${who.name} published version ${c.version}${c.updatedAt ? ` ${savedWhen(c.updatedAt)}` : ""}, after these changes were started from version ${base || "an earlier one"}.`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Keep editing</button>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={run(onTheirs)} title="Their version goes into the editor, not saved yet; Undo brings your changes back.">Continue from theirs</button>
        <button className="btn primary danger" disabled={busy} onClick={run(onMine)} title="Your version becomes the newest. Theirs stays in the list of versions.">Publish mine over theirs</button>
      </>}>
      <p>Nothing was published and nothing was overwritten. Your changes are still in the draft.</p>
      <h3 className="mini-title">What they changed</h3>
      {changes === "failed" ? <p className="muted">What they changed could not be loaded. Look at the versions in the More menu.</p>
        : changes ? <ChangeList changes={changes} /> : base ? <p className="muted">Looking…</p> : null}
      <p className="muted small">“Publish mine over theirs” makes your version the newest; theirs stays in the list of versions and can be restored. “Continue from theirs” starts from what they published; Undo brings your changes back so you can add them again.</p>
    </Modal>
  );
}
