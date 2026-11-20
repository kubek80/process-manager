import { useId, useRef } from "react";
import { Clock, Flag, X } from "lucide-react";
import type { Feedback, Process, Step } from "../types";
import { FeedbackForm, FeedbackItem, processTarget } from "./Feedback";
import { STEP_META } from "../lib/stepMeta";
import { TypeIcon, useLayer } from "./ui";
import { StepBody } from "./ListView";
import { StepTool } from "./StepTool";

/** The side panel of the reader's page: one step, what to do, and its feedback. Changing it is done on the editing screen. */
export function StepDrawer({ process, all, step, onClose, onSelect, feedback, reporting, setReporting }: {
  feedback: Feedback[]; reporting: boolean; setReporting: (r: boolean) => void;
  process: Process; all: Process[]; step: Step;
  onClose: () => void; onSelect: (id: string) => void;
}) {
  const index = process.steps.findIndex((s) => s.id === step.id);
  const actor = process.actors.find((a) => a.id === step.actor);
  const meta = STEP_META[step.type];
  const mine = feedback.filter((f) => f.itemId === step.id && !f.resolved);
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  // a side panel, not a modal dialog: focus moves in and comes back, Escape closes, Tab is free
  useLayer(panel, onClose, { watch: step.id });

  return (
    <aside ref={panel} className="drawer" role="dialog" aria-labelledby={titleId} tabIndex={-1} style={{ "--c": meta.color } as React.CSSProperties}>
      <header className="drawer-head">
        <TypeIcon type={step.type} size={44} />
        <div className="drawer-title">
          <span className="step-kicker"><span className="who">{actor?.name ?? step.actor}</span><span>Step {index + 1}</span><span>{meta.label}</span></span>
          <h3 id={titleId}>{step.title}</h3>
          {(step.tool || step.duration) && (
            <p className="step-facts">
              {step.tool && <span className="step-fact-tool"><span className="label">Done in</span>{" "}<StepTool id={step.tool} link size={16} /></span>}
              {step.duration && <span className="step-fact-time"><Clock size={13} aria-hidden="true" /><span className="label">Takes</span>{" "}{step.duration}</span>}
            </p>
          )}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="drawer-body">
        {!step.description && !step.instructions?.length && !step.subProcessId && <p className="muted drawer-none">No further details for this step.</p>}
        <StepBody step={step} process={process} all={all} onSelect={onSelect} />
        <section className="drawer-fb">
          {mine.length > 0 && (
            <ul className="fb-list">
              {mine.map((f) => <FeedbackItem key={f.id} item={f} target={processTarget(process)} hideItem />)}
            </ul>
          )}
          {reporting
            ? <><h4>What is wrong with this step?</h4><FeedbackForm target={processTarget(process)} itemId={step.id} onDone={() => setReporting(false)} /></>
            : <button className="btn small report-btn" onClick={() => setReporting(true)} aria-label="Report a problem with this step"><Flag size={14} />Report a problem</button>}
        </section>
      </div>
    </aside>
  );
}
