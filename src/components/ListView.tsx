import { useState } from "react";
import { ArrowUpRight, Check, ChevronDown, ChevronRight, Clock, CornerDownRight, ExternalLink, Flag, RotateCcw, Workflow, Wrench } from "lucide-react";
import type { Feedback, Process, Step } from "../types";
import { toolName, useCatalog } from "../lib/catalog";
import { openCount } from "./Feedback";
import { LANE_COLORS, STEP_META } from "../lib/stepMeta";
import { go } from "../lib/store";
import { TypeIcon } from "./ui";

export function StepBody({ step, process, all, onSelect, compact }: {
  step: Step; process: Process; all: Process[]; onSelect?: (id: string) => void; compact?: boolean;
}) {
  const sub = step.subProcessId ? all.find((p) => p.id === step.subProcessId) : undefined;
  const [open, setOpen] = useState(false);
  const num = (id: string) => process.steps.findIndex((s) => s.id === id) + 1;
  const title = (id: string) => process.steps.find((s) => s.id === id)?.title ?? id;
  return (
    <div className="step-body">
      {step.description && <p className="step-desc">{step.description}</p>}
      {!!step.instructions?.length && (
        <ol className="instructions">
          {step.instructions.map((ins, i) => <li key={i}><span>{String.fromCharCode(97 + i)}</span>{ins}</li>)}
        </ol>
      )}
      {step.url && (
        <a className="btn link-btn" href={step.url} target="_blank" rel="noreferrer">
          <ExternalLink size={15} />{step.urlLabel ?? "Open link"}
        </a>
      )}
      {step.subProcessId && (
        <div className="subproc">
          <div className="subproc-head">
            <Workflow size={16} />
            <div>
              <span className="muted small">Sub-process</span>
              <strong>{sub?.title ?? step.subProcessId}</strong>
            </div>
            {sub && <button className="btn small ghost" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{sub.steps.length} steps</button>}
            {sub && <button className="btn small" onClick={() => go({ page: "process", id: sub.id, tab: "list" })}>Open<ArrowUpRight size={14} /></button>}
          </div>
          {!sub && <p className="muted small">This process has not been described yet.</p>}
          {sub && open && (
            <ol className="subproc-steps">
              {sub.steps.map((s, i) => (
                <li key={s.id}>
                  <span className="n">{i + 1}</span><TypeIcon type={s.type} size={20} />
                  <span>{s.title}</span>
                  <em>{sub.actors.find((a) => a.id === s.actor)?.name}</em>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {step.outcome && <p className="outcome"><Flag size={14} /><span><b>You get:</b> {step.outcome}</span></p>}
      {!compact && (
        <div className="then">
          {step.next.length === 0 && <span className="then-end"><Check size={13} />End of the process</span>}
          {step.next.map((n) => (
            <button key={n.to} className="then-link" onClick={() => onSelect?.(n.to)}>
              <CornerDownRight size={13} />
              {n.label && <b>{n.label}</b>}
              <span>{num(n.to) <= num(step.id) ? "back to" : "then"} step {num(n.to)}: {title(n.to)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ListView({ process, all, done, toggle, reset, selectedId, onSelect, feedback, onReport }: {
  process: Process; all: Process[]; feedback: Feedback[]; onReport: (id: string) => void; done: Set<string>; toggle: (id: string) => void; reset: () => void;
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  const [onlyMine, setOnlyMine] = useState(false);
  const { catalog } = useCatalog();
  const mine = process.steps.filter((s) => s.actor === "me");
  const mineDone = mine.filter((s) => done.has(s.id)).length;
  const laneIdx = (id: string) => Math.max(0, process.actors.findIndex((a) => a.id === id));

  return (
    <div className="list-view">
      <div className="list-bar">
        <div className="progress">
          <div className="progress-text"><strong>{mineDone} of {mine.length}</strong> of your steps done</div>
          <div className="progress-track"><span style={{ width: `${mine.length ? (mineDone / mine.length) * 100 : 0}%` }} /></div>
        </div>
        <label className="switch">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          <span className="switch-ui" />Only my steps
        </label>
        {done.size > 0 && <button className="btn small ghost" onClick={reset}><RotateCcw size={14} />Reset ticks</button>}
      </div>

      <ol className="steps">
        {process.steps.map((s, i) => {
          const isMine = s.actor === "me";
          if (onlyMine && !isMine) return null;
          const actor = process.actors[laneIdx(s.actor)];
          const meta = STEP_META[s.type];
          return (
            <li key={s.id} id={`step-${s.id}`}
              className={`step ${isMine ? "mine" : "other"} ${done.has(s.id) ? "done" : ""} ${selectedId === s.id ? "selected" : ""}`}
              style={{ "--c": meta.color, "--lane": LANE_COLORS[laneIdx(s.actor) % LANE_COLORS.length] } as React.CSSProperties}>
              <div className="step-rail"><span className="step-num">{i + 1}</span></div>
              <div className="step-card">
                <div className="step-head">
                  <TypeIcon type={s.type} size={isMine ? 40 : 32} />
                  <button className="step-titles" onClick={() => onSelect(s.id)}>
                    <span className="step-kicker">
                      <span className="who">{isMine ? "You" : actor?.name}</span>
                      <span>{meta.label}</span>
                      {s.tool && <span><Wrench size={11} />{toolName(catalog, s.tool)}</span>}
                      {s.duration && <span><Clock size={11} />{s.duration}</span>}
                    </span>
                    <span className="step-title">{s.title}</span>
                  </button>
                  <button className={`report ${openCount(feedback, s.id) ? "has" : ""}`} onClick={() => onReport(s.id)}
                    title={openCount(feedback, s.id) ? `${openCount(feedback, s.id)} open feedback` : "This step doesn’t work? Tell us"}>
                    <Flag size={14} />{openCount(feedback, s.id) || ""}
                  </button>
                  {isMine
                    ? <button className={`tick ${done.has(s.id) ? "on" : ""}`} onClick={() => toggle(s.id)} aria-label="Mark as done"><Check size={16} strokeWidth={3} /></button>
                    : <span className="waiting">{s.type === "automation" ? "Automatic" : "Not you"}</span>}
                </div>
                <StepBody step={isMine ? s : { ...s, instructions: undefined }} process={process} all={all} onSelect={onSelect} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
