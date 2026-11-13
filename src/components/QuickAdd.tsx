import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Process, StepType } from "../types";
import { STEP_META, STEP_TYPES } from "../lib/stepMeta";
import { TypeIcon } from "./ui";

export interface InsertAt { afterId: string; beforeId?: string }

/** Small form that appears exactly where the new step will go - on the map or in the checklist. */
export function QuickAdd({ process, at, onAdd, onClose, style, inline }: {
  process: Process; at: InsertAt; onAdd: (spec: { title: string; type: StepType; actor: string }) => void; onClose: () => void;
  style?: React.CSSProperties; inline?: boolean;
}) {
  const after = process.steps.find((s) => s.id === at.afterId);
  const before = process.steps.find((s) => s.id === at.beforeId);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<StepType>("task");
  const [actor, setActor] = useState(after?.actor ?? "me");
  const ok = title.trim().length >= 3;
  const submit = () => ok && onAdd({ title: title.trim(), type, actor });
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  return (
    <div className={`quick-add ${inline ? "inline" : ""}`} style={style} onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}>
      <div className="quick-head">
        <span>{before ? <>New step between <b>{after?.title}</b> and <b>{before.title}</b></>
          : after?.type === "decision" ? <>New branch from <b>{after.title}</b></> : <>New step after <b>{after?.title}</b></>}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Cancel"><X size={15} /></button>
      </div>
      <input autoFocus value={title} maxLength={70} placeholder="What happens? e.g. Fill in the access request" onChange={(e) => setTitle(e.target.value)} />
      <div className="quick-label">Who</div>
      <div className="chips">
        {process.actors.map((a) => <button key={a.id} className={`chip ${actor === a.id ? "on" : ""}`} onClick={() => setActor(a.id)}>{a.name}</button>)}
      </div>
      <div className="quick-label">Kind <em>{STEP_META[type].label}</em></div>
      <div className="quick-types">
        {STEP_TYPES.map((t) => (
          <button key={t} className={type === t ? "on" : ""} title={`${STEP_META[t].label} - ${STEP_META[t].when}`}
            style={{ "--c": STEP_META[t].color } as React.CSSProperties} onClick={() => setType(t)}>
            <TypeIcon type={t} size={28} />
          </button>
        ))}
      </div>
      <button className="btn primary" disabled={!ok} onClick={submit}><Plus size={15} />Add step</button>
    </div>
  );
}
