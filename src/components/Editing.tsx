import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, GitCompare, History, PencilLine, Redo2, RotateCcw, Save, TriangleAlert, Undo2, Wrench } from "lucide-react";
import type { DocMeta, DocVersion, Status, TargetKind } from "../types";
import type { Draft } from "../lib/draft";
import { compare, describeChange, summarize, type Change } from "../lib/diff";
import { ApiError, loadHistory, loadVersion } from "../lib/store";
import { useCatalog } from "../lib/catalog";
import { author, savedByText, unpublishedLine } from "../lib/editing";
import { useMe } from "../lib/session";
import { LoadError, Modal } from "./ui";

/** Shared by the pages that edit something: processes, standards and the lists. */

const when = (iso?: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

/** "today at 14:02", "on 2026-11-17 at 09:30": when something was saved, in words. */
export function savedWhen(iso?: string, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${day === today ? "today" : `on ${day}`} at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
        <span><b>Draft</b> · Readers do not see this {noun} yet. Only the people who may change or look after it can open it.</span>
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
    <button className="version-tag" onClick={onOpen} title={`Saved ${when(meta.updatedAt)} by ${meta.updatedBy}. Press to see all versions.`}>
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
      <span><b>{meta?.updatedBy || "Somebody else"} saved a newer version of {noun}</b>{meta?.version ? ` (version ${meta.version})` : ""} while you were editing. Your changes are still here.</span>
      <span className="spacer" />
      {/* opens the comparison without trying to save: a save could be refused for another reason first */}
      <button className="btn small" onClick={() => d.raiseConflict({ exists: true, version: meta?.version, updatedBy: meta?.updatedBy || undefined, updatedAt: meta?.updatedAt || undefined })}>Compare and decide</button>
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
export function ConflictDialog<T>({ d, kind, id, noun, blocked, theirs: loadTheirs, onRestore, wasPublished }: {
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
}) {
  const c = d.conflict;
  const { catalog } = useCatalog();
  const who = author(c ?? undefined, useMe().user?.email);
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
  if (!c) return null;
  const run = (fn: () => Promise<unknown>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  if (!c.exists && c.draft) {
    return (
      <Modal title="The unpublished changes are gone" subtitle="The shared draft was published or discarded, perhaps in another window, while you were editing." onClose={d.dismissConflict}
        footer={<><span className="spacer" /><button className="btn" onClick={d.dismissConflict}>Keep editing</button>
          <button className="btn primary" disabled={busy} onClick={run(() => d.keepMine())}>Save mine as a new draft</button></>}>
        <p>Your changes are still here and not saved. Saving starts a new draft with your changes. If something was published meanwhile, you are shown what changed and asked before yours is published over it.</p>
      </Modal>
    );
  }
  if (loadTheirs && c.exists) {
    return (
      <Modal title={who.you ? "You saved the draft in another window first" : "Somebody else saved the draft first"}
        subtitle={`${who.you ? "You" : who.name} saved the unpublished changes ${c.updatedAt ? `at ${when(c.updatedAt)}` : ""}${who.you ? " in another window or tab" : ""}, after you started editing here.`} onClose={d.dismissConflict}
        footer={<>
          <button className="btn" onClick={d.dismissConflict}>Keep editing</button>
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={run(d.takeTheirs)} title="Continue from their draft. Your own changes stay one Undo away.">Use their draft</button>
          <button className="btn primary danger" disabled={busy || !!blocked} onClick={run(() => d.keepMine())}
            title={blocked ?? "Your version becomes the draft. Theirs is replaced."}>Save mine over theirs</button>
        </>}>
        <p>There is one shared draft of unpublished changes. Yours are still here and not saved. Nothing was overwritten.</p>
        <h3 className="mini-title"><GitCompare size={14} />What their draft has that you started without</h3>
        {theirs === "failed" ? <LoadError what="Their draft could not be loaded." onRetry={() => setAttempt(attempt + 1)} />
          : theirs ? <ChangeList changes={theirs} /> : <p className="muted">Looking…</p>}
        {blocked && <div className="check warn">{blocked} Until then you can only continue from their draft.</div>}
        <p className="muted small">“Use their draft” continues from what they saved; Undo brings your own changes back. “Save mine over theirs” replaces their draft with yours.</p>
      </Modal>
    );
  }
  if (!c.exists) {
    return (
      <Modal title={`${noun[0].toUpperCase()}${noun.slice(1)} was deleted`} subtitle="Somebody else deleted it while you were editing." onClose={d.dismissConflict}
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
        <button className="btn" disabled={busy} onClick={run(d.takeTheirs)} title="Continue from their version. Your own changes stay one Undo away.">Use their version</button>
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
      <p className="muted small">“Use their version” continues from what they saved; you can bring your own changes back with Undo and add them again.
        “Save mine over theirs” makes your version the newest; theirs stays in the list of versions and can be restored.</p>
    </Modal>
  );
}

/**
 * Every save is a version. The list shows who saved what and when, with the note they left;
 * each version can be compared with the one before it, and editors can bring one back.
 */
export function HistoryDialog<T>({ kind, id, title, onRestore, onClose }: {
  kind: TargetKind; id: string; title: string; onRestore?: (doc: T, version: number) => void; onClose: () => void;
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
      subtitle={onRestore ? "Every save is a version. Restoring one puts it into your draft on this screen: nothing is kept until you save the draft, and readers see nothing until you publish." : "Every save is a version: who changed it, when, and what they said about it."}
      onClose={onClose} footer={<><span className="spacer" /><button className="btn primary" onClick={onClose}>Close</button></>}>
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
                <em>{savedByText(v)} · {when(v.savedAt)}</em>
              </span>
              {!v.deleted && <button className="btn small ghost" aria-expanded={open === v.version} onClick={() => show(v)}><GitCompare size={14} />What changed</button>}
              {!v.deleted && i > 0 && onRestore && <button className="btn small" onClick={() => restore(v.version)}><RotateCcw size={14} />Restore</button>}
            </div>
            {open === v.version && <div className="history-detail">{detail(v)}</div>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
