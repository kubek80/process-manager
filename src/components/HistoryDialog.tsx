import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { DocVersion, TargetKind } from "../types";
import { loadHistory, loadVersion } from "../lib/store";
import { Modal } from "./ui";

/** Every save is kept. An older revision can be loaded into the draft and saved again. */
export function HistoryDialog<T>({ kind, id, title, onRestore, onClose }: {
  kind: TargetKind; id: string; title: string; onRestore: (doc: T, version: number) => void; onClose: () => void;
}) {
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { loadHistory(kind, id).then(setVersions, (e) => setError(e.message)); }, [kind, id]);
  const restore = async (v: number) => {
    try { onRestore(await loadVersion<T>(kind, id, v), v); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={`History of “${title}”`} subtitle="Every save is a revision. Loading one puts it into your draft; nothing changes until you save." onClose={onClose}
      footer={<><span className="spacer" /><button className="btn primary" onClick={onClose}>Close</button></>}>
      {error && <div className="check bad">{error}</div>}
      {!versions && !error && <p className="muted">Loading…</p>}
      <ul className="history">
        {versions?.map((v, i) => (
          <li key={v.version}>
            <span className="history-n">{v.version}</span>
            <span className="history-text">
              <strong>{v.deleted ? "Deleted" : i === 0 ? "Current revision" : `Revision ${v.version}`}</strong>
              <em>{v.savedBy} · {v.savedAt.slice(0, 16).replace("T", " ")}</em>
            </span>
            {!v.deleted && i > 0 && <button className="btn small" onClick={() => restore(v.version)}><RotateCcw size={14} />Load into draft</button>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
