import { useEffect, useState, type ReactNode } from "react";
import { Check, GitCompare, History, Redo2, RotateCcw, Save, TriangleAlert, Undo2 } from "lucide-react";
import type { DocMeta, DocVersion, TargetKind } from "../types";
import type { Draft } from "../lib/draft";
import { compare, describeChange, summarize, type Change } from "../lib/diff";
import { loadHistory, loadVersion } from "../lib/store";
import { Modal } from "./ui";

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
  const save = async () => { if (await d.save(note)) setNote(""); };
  if (!d.dirty) {
    return <>
      {editor && d.canUndo && <button className="btn small ghost" onClick={d.undo} title="Undo (Ctrl+Z)"><Undo2 size={15} />Undo</button>}
      {editor && d.canRedo && <button className="btn small ghost" onClick={d.redo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={15} />Redo</button>}
      {editor && <span className="saved"><Check size={14} />Saved</span>}
    </>;
  }
  return (
    <div className="save-bar">
      <button className="icon-btn" onClick={d.undo} disabled={!d.canUndo} aria-label="Undo" title="Undo the last change (Ctrl+Z)"><Undo2 size={17} /></button>
      <button className="icon-btn" onClick={d.redo} disabled={!d.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={17} /></button>
      <input className="save-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" aria-label="What changed? (optional)"
        title="Kept with this version, so others can see what was changed and why"
        onKeyDown={(e) => { if (e.key === "Enter" && !blocked && !d.saving) save(); }} />
      <button className="btn" onClick={d.discard} title="Go back to the saved version. Can be undone.">Discard</button>
      <button className="btn primary" disabled={!!blocked || d.saving} onClick={save} title={blocked ?? ""}><Save size={16} />{d.saving ? "Saving…" : "Save changes"}</button>
    </div>
  );
}

/** Told when the server has a newer version than the one being edited. */
export function BehindBanner<T>({ d, meta, noun }: { d: Draft<T>; meta?: DocMeta; noun: string }) {
  if (!d.behind || !d.dirty || d.conflict) return null;
  return (
    <div className="check warn banner">
      <TriangleAlert size={16} />
      <span><b>{meta?.updatedBy ?? "Somebody else"} saved a newer version of {noun}</b> (version {meta?.version}) while you were editing. Your changes are still here.</span>
      <span className="spacer" />
      <button className="btn small" onClick={() => d.save()}>Compare and decide</button>
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
export function ConflictDialog<T>({ d, kind, id, noun }: { d: Draft<T>; kind: TargetKind | "catalog"; id: string; noun: string }) {
  const c = d.conflict;
  const [theirs, setTheirs] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTheirs(null);
    if (!c?.exists || !c.version || kind === "catalog") return;
    let live = true;
    loadVersion<unknown>(kind, id, c.version).then((doc) => { if (live) setTheirs(compare(kind, d.saved, doc)); }, () => { /* the summary is a help, not a need */ });
    return () => { live = false; };
  }, [c?.version, c?.exists, kind, id]); // eslint-disable-line react-hooks/exhaustive-deps
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
        <button className="btn primary danger" disabled={busy} onClick={run(() => d.keepMine(`Saved over version ${c.version}`))} title="Your version becomes the newest. Theirs stays in the list of versions.">Save mine over theirs</button>
      </>}>
      <p>Your changes are still here and not saved. Nothing was overwritten.</p>
      {kind !== "catalog" && <>
        <h3 className="mini-title"><GitCompare size={14} />What they changed</h3>
        {theirs ? <ChangeList changes={theirs} /> : <p className="muted">Looking…</p>}
      </>}
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
  useEffect(() => { loadHistory(kind, id).then(setVersions, (e) => setError(e.message)); }, [kind, id]);

  const previousOf = (v: DocVersion) => versions?.find((x) => x.version < v.version && !x.deleted);
  const show = async (v: DocVersion) => {
    if (open === v.version) return setOpen(null);
    setOpen(v.version);
    if (changes[v.version]) return;
    const before = previousOf(v);
    if (!before) return setChanges((all) => ({ ...all, [v.version]: "This is the first version." }));
    try {
      const [a, b] = await Promise.all([loadVersion<unknown>(kind, id, before.version), loadVersion<unknown>(kind, id, v.version)]);
      setChanges((all) => ({ ...all, [v.version]: compare(kind, a, b) }));
    } catch {
      setChanges((all) => ({ ...all, [v.version]: "This version cannot be shown: it was a draft that only its editors could see." }));
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
      {error && <div className="check bad">{error}</div>}
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
