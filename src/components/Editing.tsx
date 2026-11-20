import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, GitCompare, History, PencilLine, Redo2, RotateCcw, Save, TriangleAlert, Undo2, Wrench } from "lucide-react";
import type { DocMeta, DocVersion, Status, TargetKind } from "../types";
import type { Draft } from "../lib/draft";
import { compare, describeChange, summarize, type Change } from "../lib/diff";
import { ApiError, loadHistory, loadVersion } from "../lib/store";
import { useCatalog } from "../lib/catalog";
import { author, deletedSentence, goneDraftSentence, newerChangesLine, savedByText, savedWhen, unpublishedLine } from "../lib/editing";
import { formatDateTime } from "../lib/dates";
import { cap } from "../lib/diff";
import { useMe } from "../lib/session";
import { LoadError, Modal, notify, type NoticeAction } from "./ui";

/** Shared by the pages that edit something: processes, standards and the lists. */

const when = formatDateTime;

export { savedWhen };

/**
 * The editing screen's own messages - what a delete, a move, Undo or Redo did: a new one replaces
 * the one before (an old "Undo" would undo something else by now), and they end when the screen
 * is left (`clear`, when the editing session closes).
 */
let editMessage: number | null = null;
export const editNotice = {
  info(text: string, action?: NoticeAction, detail?: string): number {
    if (editMessage !== null) notify.dismiss(editMessage);
    editMessage = notify.info(text, action, detail);
    return editMessage;
  },
  clear() {
    if (editMessage !== null) notify.dismiss(editMessage);
    editMessage = null;
  },
};

/**
 * On the reader's page: a never-published draft is marked as one, and its editors are told,
 * calmly, when there are unpublished changes (`meta.draft` is only sent to them).
 */
export function DraftLine({ meta, status, editHref, noun }: { meta?: DocMeta; status: Status; editHref?: string; noun: string }) {
  const myEmail = useMe().user?.email;
  if (status === "draft") {
    return (
      <p className="draft-line never" role="note">
        <PencilLine size={16} aria-hidden="true" />
        <span><b>Draft</b> · Readers do not see this {noun} yet. Only the people who may change or look after it can open it.
          {/* changes that still have something to fix are kept on the editing screen, not shown here */}
          {meta?.draft && editHref ? ` ${newerChangesLine(meta.draft, myEmail)}` : ""}</span>
        {editHref && <a href={editHref}>Continue editing</a>}
      </p>
    );
  }
  if (!meta?.draft || !editHref) return null;
  return (
    <p className="draft-line" role="note">
      <PencilLine size={16} aria-hidden="true" />
      <span>{unpublishedLine(meta.draft, myEmail)}</span>
      <a href={editHref}>Continue editing</a>
    </p>
  );
}

/** A process or standard that was stored with problems and cannot be shown. */
export function NotShown({ kind, title, editHref, back, problems }: { kind: TargetKind; title: string; editHref?: string; back: () => void; problems: number }) {
  return (
    <div className="page">
      <button className="back" onClick={back}><ArrowLeft size={16} />All {kind === "process" ? "processes" : "standards"}</button>
      <h1>{title}</h1>
      <div className="check warn banner" role="alert">
        <TriangleAlert size={16} />
        <span>This {kind} cannot be shown: what is stored has {problems || "some"} problem{problems === 1 ? "" : "s"}. {editHref ? "Repair it on the editing screen." : "Its owners have been told through the health check."}</span>
        {editHref && <a className="btn small" href={editHref}><Wrench size={14} />Repair it</a>}
      </div>
    </div>
  );
}

/** "Version 7" - opens the list of versions. For everyone, not only editors. */
export function VersionTag({ meta, onOpen }: { meta?: DocMeta; onOpen: () => void }) {
  if (!meta?.version) return null;
  return (
    <button className="version-tag" onClick={onOpen} title={`Stored ${when(meta.updatedAt)} by ${meta.updatedByName || meta.updatedBy}. Press to see all versions.`}>
      <History size={13} />Version {meta.version}
    </button>
  );
}

/**
 * Undo, redo, what changed, discard and save. Shown while there are unsaved edits; otherwise a
 * quiet "Saved". `blocked` is a reason why saving is not possible right now.
 */
export function SaveBar<T>({ d, editor, blocked }: { d: Draft<T>; editor: boolean; blocked?: string }) {
  const [note, setNote] = useState("");
  const undoButton = useRef<HTMLButtonElement>(null);
  const save = async () => { if (await d.save(note)) setNote(""); };
  // somebody who only reads sees nothing here - unless they did change something
  if (!editor && !d.dirty && !d.canUndo && !d.canRedo) return null;
  // Undo, Redo and the state at the end are always the same elements, so that the keyboard
  // focus stays where it is when a draft becomes saved or the other way round. A button that
  // has nothing to do is marked as unavailable instead of being removed.
  const off = (unavailable: boolean) => (unavailable ? { "aria-disabled": true, className: "icon-btn off" } : { className: "icon-btn" });
  return (
    <div className="save-bar">
      <button ref={undoButton} {...off(!d.canUndo)} onClick={() => d.canUndo && d.undo()} aria-label="Undo" title="Undo the last change (Ctrl+Z)"><Undo2 size={17} /></button>
      <button {...off(!d.canRedo)} onClick={() => d.canRedo && d.redo()} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={17} /></button>
      {d.dirty && <>
        <input className="save-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" aria-label="What changed? (optional)"
          title="Kept with this version, so others can see what was changed and why"
          onKeyDown={(e) => { if (e.key === "Enter" && !blocked && !d.saving) save(); }} />
        {/* Discard can be undone, so the focus moves to Undo */}
        <button className="btn" onClick={() => { d.discard(); undoButton.current?.focus(); }} title="Go back to the saved version. Can be undone.">Discard</button>
      </>}
      {d.dirty
        ? <button key="state" className="btn primary" disabled={!!blocked || d.saving} onClick={save} title={blocked ?? ""}><Save size={16} />{d.saving ? "Saving…" : "Save changes"}</button>
        : <button key="state" className="saved" aria-disabled="true" tabIndex={-1}><Check size={14} />Saved</button>}
    </div>
  );
}

/** Told when the server has a newer version than the one being edited. */
export function BehindBanner<T>({ d, meta, noun }: { d: Draft<T>; meta?: DocMeta; noun: string }) {
  if (!d.behind || !d.dirty || d.conflict) return null;
  return (
    <div className="check warn banner">
      <TriangleAlert size={16} />
      <span><b>{meta?.updatedByName || meta?.updatedBy || "Somebody else"} saved a newer version of {noun}</b>{meta?.version ? ` (version ${meta.version})` : ""} while you were editing. Your changes are still here.</span>
      <span className="spacer" />
      {/* opens the comparison without trying to save: a save could be refused for another reason first */}
      <button className="btn small" onClick={() => d.raiseConflict({ exists: true, version: meta?.version, updatedBy: meta?.updatedBy || undefined, updatedByName: meta?.updatedByName, updatedAt: meta?.updatedAt || undefined })}>Compare and decide</button>
    </div>
  );
}

/** Changes between two versions, in plain words. */
export function ChangeList({ changes }: { changes: Change[] }) {
  if (!changes.length) return <p className="muted">Nothing that readers see is different.</p>;
  return (
    <ul className="change-list">
      {changes.map((c, i) => <li key={i} className={c.kind}><span className="change-kind">{c.kind}</span>{describeChange(c)}</li>)}
    </ul>
  );
}

/**
 * Somebody else saved while this person was editing. Nothing is overwritten without a
 * decision: look at what they changed, then continue from their version or keep your own.
 */
export function ConflictDialog<T>({ d, kind, id, noun, blocked, theirs: loadTheirs, onRestore, wasPublished, startedFrom }: {
  d: Draft<T>; kind: TargetKind | "catalog"; id: string; noun: string;
  /** Why saving is not possible right now, e.g. the checker found problems. */
  blocked?: string;
  /**
   * The edits are a working draft (unpublished changes) that somebody else saved first: loads
   * what they saved. Without it the conflict is about versions of the document.
   */
  theirs?: () => Promise<unknown>;
  /**
   * It was deleted: brings it back with what is on screen (as a draft for a process or standard,
   * checked first). Without it, "Save mine and bring it back" saves straight away.
   */
  onRestore?: () => void;
  /** It was published before it was deleted: it comes back as a draft readers do not see. */
  wasPublished?: boolean;
  /** The published version the unpublished changes were started from (to tell a publish from a discard). */
  startedFrom?: number;
}) {
  const c = d.conflict;
  const { catalog } = useCatalog();
  const myEmail = useMe().user?.email;
  const who = author(c ?? undefined, myEmail);
  const [theirs, setTheirs] = useState<Change[] | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setTheirs(null);
    if (!c?.exists || !c.version || kind === "catalog") return;
    let live = true;
    (loadTheirs ? loadTheirs() : loadVersion<unknown>(kind, id, c.version)).then((doc) => { if (live) setTheirs(compare(kind, d.saved, doc, catalog)); }, () => { if (live) setTheirs("failed"); });
    return () => { live = false; };
  }, [c?.version, c?.exists, kind, id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  // who deleted it, or who published the shared draft, is in the list of versions
  // (the server names who deleted it to those who could edit it: then the versions are not needed)
  const latest = useLatestVersion(kind, id, !!c && !c.exists && !c.deletedBy);
  if (!c) return null;
  const run = (fn: () => Promise<unknown>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  if (!c.exists && c.draft) {
    return (
      <Modal title={wasPublished === false ? "The newer changes are gone" : "The unpublished changes are gone"}
        subtitle={goneDraftSentence(latest, startedFrom, myEmail, wasPublished !== false)} onClose={d.dismissConflict}
        footer={<><span className="spacer" /><button className="btn" onClick={d.dismissConflict}>Keep editing</button>
          <button className="btn primary" disabled={busy} onClick={run(() => d.keepMine())}>Save mine as a new draft</button></>}>
        <p>Your changes are still here and not saved. Saving starts a new draft with your changes. If something was published meanwhile, you are shown what changed and asked before yours is published over it.</p>
      </Modal>
    );
  }
  if (loadTheirs && c.exists) {
    return (
      <Modal title={who.you ? "You saved the draft in another window first" : "Somebody else saved the draft first"}
        subtitle={`${who.you ? "You" : who.name} saved ${wasPublished === false ? "newer changes to the draft" : "the unpublished changes"} ${c.updatedAt ? `at ${when(c.updatedAt)}` : ""}${who.you ? " in another window or tab" : ""}, after you started editing here.`} onClose={d.dismissConflict}
        footer={<>
          <button className="btn" onClick={d.dismissConflict}>Keep editing</button>
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={run(d.takeTheirs)} title="Continue from their draft. Undo puts your whole version back.">Use their draft</button>
          <button className="btn primary danger" disabled={busy || !!blocked} onClick={run(() => d.keepMine())}
            title={blocked ?? "Your version becomes the draft. Theirs is replaced."}>Save mine over theirs</button>
        </>}>
        <p>{wasPublished === false ? "There is one shared draft." : "There is one shared draft of unpublished changes."} Yours are still here and not saved. Nothing was overwritten.</p>
        <h3 className="mini-title"><GitCompare size={14} />What their draft has that you started without</h3>
        {theirs === "failed" ? <LoadError what="Their draft could not be loaded." onRetry={() => setAttempt(attempt + 1)} />
          : theirs ? <ChangeList changes={theirs} /> : <p className="muted">Looking…</p>}
        {blocked && <div className="check warn">{blocked} Until then you can only continue from their draft.</div>}
        <p className="muted small">“Use their draft” continues from what they saved. Undo then puts your whole version back as it was, also where theirs is newer: nothing is merged. “Save mine over theirs” replaces their draft with yours.</p>
      </Modal>
    );
  }
  if (!c.exists) {
    return (
      <Modal title={`${cap(noun)} was deleted`} onClose={d.dismissConflict}
        subtitle={deletedSentence(c.deletedBy ? { version: 0, deleted: true, savedBy: c.deletedBy, savedByName: c.deletedByName, savedAt: c.deletedAt ?? "" } : latest, myEmail)}
        footer={<><span className="spacer" /><button className="btn" onClick={d.dismissConflict}>Keep editing</button>
          <button className="btn primary" disabled={busy} onClick={onRestore ? () => { d.dismissConflict(); onRestore(); } : run(() => d.keepMine("Restored after it was deleted"))}>Save mine and bring it back</button></>}>
        <p>Your changes are still here. Saving brings {noun} back with your version; ask whoever deleted it first if you are not sure.</p>
        {onRestore && <p>{wasPublished ? "It comes back as a draft: readers see it again when you publish." : "It comes back as a draft: readers see it when you publish."}</p>}
      </Modal>
    );
  }
  return (
    <Modal title={who.you ? "You saved in another window first" : "Somebody else saved first"} subtitle={`${who.name} saved version ${c.version} ${c.updatedAt ? `at ${when(c.updatedAt)}` : ""}, after you started editing version ${d.base}.`} onClose={d.dismissConflict}
      footer={<>
        <button className="btn" onClick={d.dismissConflict}>Keep editing</button>
        <span className="spacer" />
        <button className="btn" disabled={busy} onClick={run(d.takeTheirs)} title="Continue from their version. Undo puts your whole version back.">Use their version</button>
        <button className="btn primary danger" disabled={busy || !!blocked} onClick={run(() => d.keepMine(`Saved over version ${c.version}`))}
          title={blocked ?? "Your version becomes the newest. Theirs stays in the list of versions."}>Save mine over theirs</button>
      </>}>
      <p>Your changes are still here and not saved. Nothing was overwritten.</p>
      {kind !== "catalog" && <>
        <h3 className="mini-title"><GitCompare size={14} />What they changed</h3>
        {theirs === "failed" ? <LoadError what="What they changed could not be loaded." onRetry={() => setAttempt(attempt + 1)} />
          : theirs ? <ChangeList changes={theirs} /> : <p className="muted">Looking…</p>}
      </>}
      {kind === "catalog" && <p className="muted">Open the lists in another tab to see what they changed.</p>}
      {blocked && <div className="check warn">{blocked} Until then you can only continue from their version.</div>}
      <p className="muted small">“Use their version” continues from what they saved. Undo then puts your whole version back as it was, also where theirs is newer: nothing is merged.
        “Save mine over theirs” makes your version the newest; theirs stays in the list of versions and can be restored.</p>
    </Modal>
  );
}

/** The newest entry of the list of versions, once `enabled` (undefined while unknown or not loaded). */
function useLatestVersion(kind: TargetKind | "catalog", id: string, enabled: boolean): DocVersion | undefined {
  const [latest, setLatest] = useState<DocVersion | undefined>();
  useEffect(() => {
    setLatest(undefined);
    if (!enabled || kind === "catalog") return;
    let live = true;
    loadHistory(kind, id).then((list) => { if (live) setLatest(list[0]); }, () => { /* said without a name */ });
    return () => { live = false; };
  }, [kind, id, enabled]);
  return latest;
}

/**
 * When a part of the editing screen fails to show (a fault in the app, not in the person's work),
 * the work is not thrown away: the draft lives above this boundary. It offers Undo of the last
 * change (which usually brings the screen back), trying again, and saving the draft. It starts
 * afresh by itself whenever the draft changes.
 */
export class EditingBoundary extends Component<{
  children: ReactNode; resetKey: unknown; noun: string;
  onUndo?: () => void; onSave?: () => Promise<boolean>; onBack: () => void;
}, { error: Error | null; key: unknown; saved: "" | "saving" | "saved" | "failed" }> {
  state = { error: null as Error | null, key: this.props.resetKey, saved: "" as "" | "saving" | "saved" | "failed" };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { resetKey: unknown }, state: { key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey, saved: "" } : null;
  }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    const { error, saved } = this.state;
    if (!error) return this.props.children;
    const { noun, onUndo, onSave, onBack } = this.props;
    const save = async () => {
      if (!onSave) return;
      this.setState({ saved: "saving" });
      const ok = await onSave().catch(() => false);
      this.setState({ saved: ok ? "saved" : "failed" });
    };
    return (
      <div className="edit-screen edit-failed" role="alert">
        <div className="edit-failed-box">
          <TriangleAlert size={22} aria-hidden="true" />
          <h1>The editing screen could not show this</h1>
          <p>This is a fault in the portal, not in your work. <b>Your changes are still here.</b> Undoing the last change usually brings the screen back; you can also try again or save the draft first.</p>
          <div className="edit-failed-actions">
            {onUndo && <button className="btn primary" onClick={onUndo}><Undo2 size={15} />Undo the last change</button>}
            <button className={`btn ${onUndo ? "" : "primary"}`} onClick={() => this.setState({ error: null, saved: "" })}><RotateCcw size={15} />Try again</button>
            {onSave && saved !== "saved" && <button className="btn" disabled={saved === "saving"} onClick={save}><Save size={15} />{saved === "saving" ? "Saving…" : "Save draft"}</button>}
            <button className="btn ghost" onClick={onBack}><ArrowLeft size={15} />Back to reading this {noun}</button>
          </div>
          {!onSave && <p className="check good"><Check size={15} />Everything is saved: nothing on this screen is lost.</p>}
          {saved === "failed" && <p className="check warn"><TriangleAlert size={15} />The draft could not be saved yet. Undo the last change or try again, then save.</p>}
          <details className="edit-failed-detail"><summary>What went wrong, for the people who run the portal</summary><code>{error.message}</code></details>
        </div>
      </div>
    );
  }
}

/**
 * Every save is a version. The list shows who saved what and when, with the note they left;
 * each version can be compared with the one before it, and editors can bring one back.
 */
export function HistoryDialog<T>({ kind, id, title, onRestore, onClose, draftKept }: {
  kind: TargetKind; id: string; title: string; onRestore?: (doc: T, version: number) => void; onClose: () => void;
  /** The changes are kept in a working draft, which is not one of the versions: say so. */
  draftKept?: boolean;
}) {
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [changes, setChanges] = useState<Record<number, Change[] | string>>({});
  const { catalog } = useCatalog();
  const load = () => { setError(""); loadHistory(kind, id).then(setVersions, (e) => setError(e.message)); };
  useEffect(load, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const previousOf = (v: DocVersion) => versions?.find((x) => x.version < v.version && !x.deleted);
  const show = async (v: DocVersion) => {
    setError("");
    if (open === v.version) return setOpen(null);
    setOpen(v.version);
    if (changes[v.version]) return;
    const before = previousOf(v);
    // readers do not get the versions that were drafts, so for them the first one listed is the first
    if (!before) return setChanges((all) => ({ ...all, [v.version]: "This is the first version that was published." }));
    try {
      const [a, b] = await Promise.all([loadVersion<unknown>(kind, id, before.version), loadVersion<unknown>(kind, id, v.version)]);
      setChanges((all) => ({ ...all, [v.version]: compare(kind, a, b, catalog) }));
    } catch (e) {
      const why = e instanceof ApiError && e.status === 404
        ? "One of the two versions was a draft that only its editors can open, so there is nothing to compare."
        : `The comparison could not be loaded: ${e instanceof Error ? e.message : String(e)} Press “What changed” again to retry.`;
      setChanges((all) => (e instanceof ApiError && e.status === 404 ? { ...all, [v.version]: why } : all));
      if (!(e instanceof ApiError && e.status === 404)) { setOpen(null); setError(why); }
    }
  };
  const restore = async (v: number) => {
    setError("");
    try { onRestore?.(await loadVersion<T>(kind, id, v), v); } catch (e) { setError((e as Error).message); }
  };
  const detail = (v: DocVersion): ReactNode => {
    const c = changes[v.version];
    if (!c) return <p className="muted">Looking…</p>;
    if (typeof c === "string") return <p className="muted">{c}</p>;
    return <><p className="muted small">Compared with version {previousOf(v)?.version}: {summarize(c)}.</p><ChangeList changes={c} /></>;
  };
  return (
    <Modal wide title={`Versions of “${title}”`}
      subtitle={onRestore
        ? `${draftKept ? "Every published version is listed here; your saved draft is not." : "Every save is a version."} Restoring one puts it into your draft on this screen: nothing is kept until you save the draft, and readers see nothing until you publish.`
        : "Every save is stored as a version: who stored it, when, and what they said about it."}
      onClose={onClose} footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Close</button></>}>
      {error && (versions ? <div className="check bad">{error}</div> : <LoadError what="The versions could not be loaded." error={error} onRetry={load} />)}
      {!versions && !error && <p className="muted">Loading…</p>}
      <ul className="history">
        {versions?.map((v, i) => (
          <li key={v.version} className={open === v.version ? "open" : ""}>
            <div className="history-row">
              <span className="history-n">{v.version}</span>
              <span className="history-text">
                <strong>{v.deleted ? "Deleted" : `Version ${v.version}`}{i === 0 && !v.deleted && <span className="history-current">current</span>}</strong>
                {v.note && <span className="history-note">{v.note}</span>}
                <em>{savedByText(v)} · stored {when(v.savedAt)}</em>
              </span>
              {/* the first version has nothing before it to compare with */}
              {!v.deleted && !!previousOf(v) && <button className="btn small ghost" aria-expanded={open === v.version} onClick={() => show(v)}><GitCompare size={14} />What changed</button>}
              {!v.deleted && i > 0 && onRestore && <button className="btn small" onClick={() => restore(v.version)}><RotateCcw size={14} />Restore</button>}
            </div>
            {open === v.version && <div className="history-detail">{detail(v)}</div>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
