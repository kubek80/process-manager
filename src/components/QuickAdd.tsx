import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Process, StepType } from "../types";
import { STEP_META, STEP_TYPES, stepHelp } from "../lib/stepMeta";
import { TypeIcon, useLayer } from "./ui";

export interface InsertAt { afterId: string; beforeId?: string }

/** Small form that appears exactly where the new step will go on the map. */
export function QuickAdd({ process, at, onAdd, onClose, style, returnFocus }: {
  process: Process; at: InsertAt; onAdd: (spec: { title: string; type: StepType; actor: string }) => void; onClose: () => void;
  style?: React.CSSProperties;
  /** Where the focus goes afterwards when the button that opened the form is no longer there. */
  returnFocus?: () => HTMLElement | null;
}) {
  const after = process.steps.find((s) => s.id === at.afterId);
  const before = process.steps.find((s) => s.id === at.beforeId);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<StepType>("task");
  const [actor, setActor] = useState(after?.actor ?? "me");
  const ok = title.trim().length >= 3;
  const form = useRef<HTMLFormElement>(null);
  useLayer(form, onClose, { returnFocus });

  // a form: Enter in the name adds the step; Enter on a button only presses that button
  return (
    <form ref={form} className="quick-add" style={style} role="dialog" aria-label="Add a step" tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (ok) onAdd({ title: title.trim(), type, actor }); }}>
      <div className="quick-head">
        <span>{before ? <>New step between <b>{after?.title}</b> and <b>{before.title}</b></>
          : after?.type === "decision" ? <>New branch from <b>{after.title}</b></> : <>New step after <b>{after?.title}</b></>}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cancel"><X size={15} /></button>
      </div>
      <input autoFocus value={title} maxLength={70} aria-label="What happens" placeholder="What happens? e.g. Fill in the access request" onChange={(e) => setTitle(e.target.value)} />
      <div className="quick-label" id="quick-who">Who</div>
      <div className="chips" role="group" aria-labelledby="quick-who">
        {process.actors.map((a) => <button type="button" key={a.id} className={`chip ${actor === a.id ? "on" : ""}`} aria-pressed={actor === a.id} onClick={() => setActor(a.id)}>{a.name}</button>)}
      </div>
      <div className="quick-label" id="quick-kind">Kind <em>{STEP_META[type].label}</em></div>
      <div className="quick-types" role="group" aria-labelledby="quick-kind">
        {STEP_TYPES.map((t) => (
          <button type="button" key={t} className={type === t ? "on" : ""} aria-pressed={type === t} aria-label={STEP_META[t].label} title={`${STEP_META[t].label} - ${stepHelp(t)}`}
            style={{ "--c": STEP_META[t].color } as React.CSSProperties} onClick={() => setType(t)}>
            <TypeIcon type={t} size={28} />
          </button>
        ))}
      </div>
      <button type="submit" className="btn primary" disabled={!ok}><Plus size={15} />Add step</button>
    </form>
  );
}
