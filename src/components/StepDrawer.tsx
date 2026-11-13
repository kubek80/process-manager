import { ArrowDown, ArrowUp, Flag, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import type { Feedback, NextLink, Process, Step } from "../types";
import { slugify, uniqueId } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { FeedbackForm, FeedbackItem } from "./Feedback";
import { STEP_META, STEP_TYPES } from "../lib/stepMeta";
import { Field, TypeIcon } from "./ui";
import { StepBody } from "./ListView";

export function StepDrawer({ process, all, step, editing, setEditing, onClose, onSelect, onChange, onTitleBlur, onDelete, onMove, onAddAfter, feedback, onFeedback, reporting, setReporting, editable }: {
  editable: boolean;
  feedback: Feedback[]; onFeedback: (list: Feedback[]) => void; reporting: boolean; setReporting: (r: boolean) => void;
  process: Process; all: Process[]; step: Step; editing: boolean; setEditing: (e: boolean) => void;
  onClose: () => void; onSelect: (id: string) => void;
  onChange: (patch: Partial<Step>) => void; onTitleBlur: () => void;
  onDelete: () => void; onMove: (dir: -1 | 1) => void; onAddAfter: () => void;
}) {
  const index = process.steps.findIndex((s) => s.id === step.id);
  const actor = process.actors.find((a) => a.id === step.actor);
  const meta = STEP_META[step.type];
  const others = process.steps.filter((s) => s.id !== step.id);
  const setNext = (next: NextLink[]) => onChange({ next });
  const instructions = step.instructions ?? [];
  const { catalog, save } = useCatalog();
  const mine = feedback.filter((f) => f.stepId === step.id && !f.resolved);
  const pickTool = async (value: string) => {
    if (value !== "__new") return onChange({ tool: value || undefined });
    const name = window.prompt("Name of the new tool")?.trim();
    if (!name || !slugify(name)) return;
    const id = uniqueId(slugify(name), catalog.tools.map((t) => t.id));
    await save({ ...catalog, tools: [...catalog.tools, { id, name }] });
    onChange({ tool: id });
  };

  return (
    <aside className="drawer" style={{ "--c": meta.color } as React.CSSProperties}>
      <header className="drawer-head">
        <TypeIcon type={step.type} size={44} />
        <div className="drawer-title">
          <span className="step-kicker"><span className="who">{actor?.name ?? step.actor}</span><span>Step {index + 1}</span><span>{meta.label}</span></span>
          <h3>{step.title}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>

      {editable && <div className="drawer-tools">
        <button className={`btn small ${editing ? "primary" : ""}`} onClick={() => setEditing(!editing)}>
          {editing ? <Check size={14} /> : <Pencil size={14} />}{editing ? "Done editing" : "Edit step"}
        </button>
        <button className="btn small ghost" onClick={onAddAfter}><Plus size={14} />Add step after</button>
        <span className="spacer" />
        <button className="icon-btn" title="Move earlier in the list" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={16} /></button>
        <button className="icon-btn" title="Move later in the list" disabled={index === process.steps.length - 1} onClick={() => onMove(1)}><ArrowDown size={16} /></button>
        <button className="icon-btn danger" title="Delete step" disabled={process.steps.length === 1} onClick={onDelete}><Trash2 size={16} /></button>
      </div>}

      {!editing || !editable ? (
        <div className="drawer-body">
          <StepBody step={step} process={process} all={all} onSelect={onSelect} />
          {!step.description && !step.instructions?.length && !step.subProcessId && (
            <p className="muted">{editable ? "No details yet. Press “Edit step” to describe what to do." : "No further details for this step."}</p>
          )}
          <section className="drawer-fb">
            {mine.length > 0 && (
              <ul className="fb-list">
                {mine.map((f) => (
                  <FeedbackItem key={f.id} item={f} process={process} hideStep editable={editable}
                    onChange={(n) => onFeedback(feedback.map((x) => (x.id === f.id ? n : x)))}
                    onRemove={() => onFeedback(feedback.filter((x) => x.id !== f.id))} />
                ))}
              </ul>
            )}
            {reporting
              ? <><h4>What is wrong with this step?</h4><FeedbackForm process={process} stepId={step.id} onAdd={(f) => onFeedback([...feedback, f])} onDone={() => setReporting(false)} /></>
              : <button className="btn small report-btn" onClick={() => setReporting(true)}><Flag size={14} />This step doesn’t work</button>}
          </section>
        </div>
      ) : (
        <div className="drawer-body form">
          <Field label="What happens">
            <input value={step.title} maxLength={70} onChange={(e) => onChange({ title: e.target.value })} onBlur={onTitleBlur} placeholder="Fill in the ServiceNow request" />
          </Field>

          <Field label="Who does it">
            <div className="chips">
              {process.actors.map((a) => (
                <button key={a.id} className={`chip ${step.actor === a.id ? "on" : ""}`} onClick={() => onChange({ actor: a.id })}>{a.name}</button>
              ))}
            </div>
          </Field>

          <div className="field">
            <span className="field-label">Kind of step</span>
            <div className="type-grid">
              {STEP_TYPES.map((t) => (
                <button key={t} className={`type-opt ${step.type === t ? "on" : ""}`} title={STEP_META[t].when}
                  style={{ "--c": STEP_META[t].color } as React.CSSProperties} onClick={() => onChange({ type: t })}>
                  <TypeIcon type={t} size={26} /><span>{STEP_META[t].label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Exactly what to do<em>one action per line</em></span>
            <div className="rows">
              {instructions.map((ins, i) => (
                <div className="row" key={i}>
                  <span className="row-n">{String.fromCharCode(97 + i)}</span>
                  <textarea rows={2} value={ins} maxLength={300} autoFocus={ins === ""} placeholder="Describe one action"
                    onChange={(e) => onChange({ instructions: instructions.map((x, j) => (j === i ? e.target.value : x)) })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onChange({ instructions: [...instructions.slice(0, i + 1), "", ...instructions.slice(i + 1)] }); } }} />
                  <button className="icon-btn" onClick={() => onChange({ instructions: instructions.filter((_, j) => j !== i) })} aria-label="Remove"><X size={15} /></button>
                </div>
              ))}
              <button className="btn small ghost" onClick={() => onChange({ instructions: [...instructions, ""] })}><Plus size={14} />Add action</button>
            </div>
          </div>

          <Field label="Context" hint="why, what happens">
            <textarea rows={3} value={step.description ?? ""} maxLength={600} onChange={(e) => onChange({ description: e.target.value })} />
          </Field>

          <div className="grid2">
            <Field label="Tool">
              <select value={step.tool ?? ""} onChange={(e) => pickTool(e.target.value)}>
                <option value="">None</option>
                {catalog.tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {step.tool && !catalog.tools.some((t) => t.id === step.tool) && <option value={step.tool}>{step.tool} (not in the list)</option>}
                <option value="__new">＋ Add a new tool…</option>
              </select>
            </Field>
            <Field label="Typical time"><input value={step.duration ?? ""} maxLength={40} placeholder="10 min" onChange={(e) => onChange({ duration: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="Link"><input value={step.url ?? ""} placeholder="https://…" onChange={(e) => onChange({ url: e.target.value })} /></Field>
            <Field label="Link text"><input value={step.urlLabel ?? ""} maxLength={60} placeholder="Open the form" onChange={(e) => onChange({ urlLabel: e.target.value })} /></Field>
          </div>
          <Field label="Result of this step"><input value={step.outcome ?? ""} maxLength={200} placeholder="Request number" onChange={(e) => onChange({ outcome: e.target.value })} /></Field>

          <Field label="Explained by sub-process">
            <select value={step.subProcessId ?? ""} onChange={(e) => onChange({ subProcessId: e.target.value || undefined })}>
              <option value="">None</option>
              {all.filter((p) => p.id !== process.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              {step.subProcessId && !all.some((p) => p.id === step.subProcessId) && <option value={step.subProcessId}>{step.subProcessId} (missing)</option>}
            </select>
          </Field>

          <div className="field">
            <span className="field-label">What comes next<em>{step.next.length === 0 ? "nothing - the process ends here" : step.next.length > 1 ? "several paths" : ""}</em></span>
            <div className="rows">
              {step.next.map((n, i) => (
                <div className="row" key={i}>
                  <input className="next-label" value={n.label ?? ""} maxLength={30} placeholder={step.type === "decision" ? "Approved" : "label (optional)"}
                    onChange={(e) => setNext(step.next.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)))} />
                  <select value={n.to} onChange={(e) => setNext(step.next.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}>
                    {others.map((o) => <option key={o.id} value={o.id}>{process.steps.indexOf(o) + 1}. {o.title}</option>)}
                  </select>
                  <button className="icon-btn" onClick={() => setNext(step.next.filter((_, j) => j !== i))} aria-label="Remove"><X size={15} /></button>
                </div>
              ))}
              {others.some((o) => !step.next.some((n) => n.to === o.id)) && (
                <button className="btn small ghost" onClick={() => setNext([...step.next, { to: others.find((o) => !step.next.some((n) => n.to === o.id))!.id }])}>
                  <Plus size={14} />Add path
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
