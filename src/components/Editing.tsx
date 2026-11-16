import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, GitCompare, History, Redo2, RotateCcw, Save, TriangleAlert, Undo2 } from "lucide-react";
import type { DocMeta, DocVersion, TargetKind } from "../types";
import type { Draft } from "../lib/draft";
import { compare, describeChange, summarize, type Change } from "../lib/diff";
import { ApiError, loadHistory, loadVersion } from "../lib/store";
import { LoadError, Modal } from "./ui";

/** Shared by the pages that edit something: processes, standards and the lists. */

const when = (iso?: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

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

function ChangeList({ changes }: { changes: Change[] }) {
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
export function ConflictDialog<T>({ d, kind, id, noun, blocked }: {
  d: Draft<T>; kind: TargetKind | "catalog"; id: string; noun: string;
  /** Why saving is not possible right now, e.g. the checker found problems. */
  blocked?: string;
}) {
  const c = d.conflict;
  const [theirs, setTheirs] = useState<Change[] | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setTheirs(null);
    if (!c?.exists || !c.version || kind === "catalog") return;
    let live = true;
    loadVersion<unknown>(kind, id, c.version).then((doc) => { if (live) setTheirs(compare(kind, d.saved, doc)); }, () => { if (live) setTheirs("failed"); });
    return () => { live = false; };
  }, [c?.version, c?.exists, kind, id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const run = (fn: () => Promise<unknown>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  if (!c.exists) {
    return (
      <Modal title={`${noun[0].toUpperCase()}${noun.slice(1)} was deleted`} subtitle="Somebody else deleted it while you were editing." onClose={d.dismissConflict}
        footer={<><span className="spacer" /><button className="btn" onClick={d.dismissConflict}>Keep editing</button>
          <button className="btn primary" disabled={busy} onClick={run(() => d.keepMine("Restored after it was deleted"))}>Save mine and bring it back</button></>}>
        <p>Your changes are still here. Saving brings {noun} back with your version; ask whoever deleted it first if you are not sure.</p>
      </Modal>
    );
  }
  return (
    <Modal title="Somebody else saved first" subtitle={`${c.updatedBy ?? "Somebody else"} saved version ${c.version} ${c.updatedAt ? `at ${when(c.updatedAt)}` : ""}, after you started editing version ${d.base}.`} onClose={d.dismissConflict}
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
  const load = () => { setError(""); loadHistory(kind, id).then(setVersions, (e) => setError(e.message)); };
  useEffect(load, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const previousOf = (v: DocVersion) => versions?.find((x) => x.version < v.version && !x.deleted);
  const show = async (v: DocVersion) => {
    if (open === v.version) return setOpen(null);
    setOpen(v.version);
    if (changes[v.version]) return;
    const before = previousOf(v);
    // readers do not get the versions that were drafts, so for them the first one listed is the first
    if (!before) return setChanges((all) => ({ ...all, [v.version]: "This is the first version that was published." }));
    try {
      const [a, b] = await Promise.all([loadVersion<unknown>(kind, id, before.version), loadVersion<unknown>(kind, id, v.version)]);
      setChanges((all) => ({ ...all, [v.version]: compare(kind, a, b) }));
    } catch (e) {
      const why = e instanceof ApiError && e.status === 404
        ? "One of the two versions was a draft that only its editors can open, so there is nothing to compare."
        : `The comparison could not be loaded: ${e instanceof Error ? e.message : String(e)} Press “What changed” again to retry.`;
      setChanges((all) => (e instanceof ApiError && e.status === 404 ? { ...all, [v.version]: why } : all));
      if (!(e instanceof ApiError && e.status === 404)) { setOpen(null); setError(why); }
    }
  };
  const restore = async (v: number) => {
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
      subtitle={onRestore ? "Every save is a version. Restoring one puts it into your draft; nothing changes until you save." : "Every save is a version: who changed it, when, and what they said about it."}
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
                <em>{v.savedBy} · {when(v.savedAt)}</em>
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
