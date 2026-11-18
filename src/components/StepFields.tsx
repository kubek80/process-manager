import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { Feedback, Issue, NextLink, Process, Step } from "../types";
import { slugify, uniqueId } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { usePerms } from "../lib/session";
import { STEP_META, STEP_TYPES, stepHelp } from "../lib/stepMeta";
import { processTarget } from "./Feedback";
import { ResourceEditor } from "./Resources";
import { EntryIcon } from "./EntryIcon";
import { EditSection, FieldsHead, ItemFeedback, ItemIssues } from "./EditFrame";
import { Field, TypeIcon, notify } from "./ui";

/**
 * The fields of one step on the editing screen, directly editable. Its problems and its open
 * feedback come first: they are why somebody opens a step.
 */
export function StepFields({ process, all, step, feedback, issues, onChange, onTitleBlur, onDelete, onMove, onAddAfter }: {
  process: Process; all: Process[]; step: Step; feedback: Feedback[]; issues: Issue[];
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
  const toolIcon = step.tool ? catalog.tools.find((t) => t.id === step.tool)?.icon : undefined;
  // only people who manage the lists can add a tool from here
  const mayAddTool = usePerms().catalog;
  const [newTool, setNewTool] = useState<string | null>(null); // null = the field is closed
  const [addingTool, setAddingTool] = useState(false);
  const pickTool = (value: string) => {
    if (value === "__new") return setNewTool("");
    setNewTool(null);
    onChange({ tool: value || undefined });
  };
  const addTool = async () => {
    const name = (newTool ?? "").trim();
    if (!slugify(name) || addingTool) return;
    const id = uniqueId(slugify(name), catalog.tools.map((t) => t.id));
    setAddingTool(true);
    try {
      await save({ ...catalog, tools: [...catalog.tools, { id, name }] });
      onChange({ tool: id });
      setNewTool(null);
    } catch (e) {
      // the step keeps its tool and the name stays in the field
      notify.error("The tool could not be added to the list.", e);
    } finally { setAddingTool(false); }
  };

  return (
    <div className="edit-fields-inner" style={{ "--c": meta.color } as React.CSSProperties}>
      <FieldsHead icon={<TypeIcon type={step.type} size={40} />} kicker={<><span className="who">{actor?.name ?? step.actor}</span><span>Step {index + 1} of {process.steps.length}</span><span>{meta.label}</span></>}
        title={step.title || "(no name yet)"}
        tools={<>
          <button className="btn small ghost" onClick={onAddAfter}><Plus size={14} />Add step after</button>
          <span className="spacer" />
          <button className="icon-btn" title="Move earlier in the list" aria-label="Move earlier in the list" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={16} /></button>
          <button className="icon-btn" title="Move later in the list" aria-label="Move later in the list" disabled={index === process.steps.length - 1} onClick={() => onMove(1)}><ArrowDown size={16} /></button>
          <button className="icon-btn danger" title="Delete step" aria-label="Delete step" disabled={process.steps.length === 1} onClick={onDelete}><Trash2 size={16} /></button>
        </>} />
      <ItemIssues issues={issues} />
      <ItemFeedback feedback={feedback.filter((f) => f.itemId === step.id && !f.resolved)} target={processTarget(process)} noun="step" />
      <EditSection title="The step">
        <Field label="What happens" hint="Start with a verb, as the reader would say it">
          <input value={step.title} maxLength={70} onChange={(e) => onChange({ title: e.target.value })} onBlur={onTitleBlur} placeholder="Fill in the ServiceNow request"
            data-autofocus={step.title === "New step" ? "" : undefined} onFocus={(e) => { if (step.title === "New step") e.target.select(); }} />
        </Field>

        <div className="field">
          <span className="field-label">Who does it</span>
          <div className="chips" role="group" aria-label="Who does it">
            {process.actors.map((a) => (
              <button key={a.id} className={`chip ${step.actor === a.id ? "on" : ""}`} aria-pressed={step.actor === a.id} onClick={() => onChange({ actor: a.id })}>{a.name}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Kind of step<em>Sets the colour and the icon on the map</em></span>
          <div className="type-grid" role="group" aria-label="Kind of step">
            {STEP_TYPES.map((t) => (
              <button key={t} className={`type-opt ${step.type === t ? "on" : ""}`} aria-pressed={step.type === t} title={stepHelp(t)}
                style={{ "--c": STEP_META[t].color } as React.CSSProperties} onClick={() => onChange({ type: t })}>
                <TypeIcon type={t} size={26} /><span>{STEP_META[t].label}</span>
              </button>
            ))}
          </div>
        </div>
      </EditSection>
      <EditSection title="What to do">
        <div className="field">
          <span className="field-label">Exactly what to do<em>One action per line. Readers tick them off; Enter starts the next one.</em></span>
          <div className="rows">
            {instructions.map((ins, i) => (
              <div className="row" key={i}>
                <span className="row-n">{String.fromCharCode(97 + i)}</span>
                <textarea rows={2} value={ins} maxLength={300} autoFocus={ins === ""} placeholder="Describe one action" aria-label={`Action ${String.fromCharCode(97 + i)}`}
                  onChange={(e) => onChange({ instructions: instructions.map((x, j) => (j === i ? e.target.value : x)) })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onChange({ instructions: [...instructions.slice(0, i + 1), "", ...instructions.slice(i + 1)] }); } }} />
                <button className="icon-btn" onClick={() => onChange({ instructions: instructions.filter((_, j) => j !== i) })} aria-label={`Remove action ${String.fromCharCode(97 + i)}`}><X size={15} /></button>
              </div>
            ))}
            <button className="btn small ghost" onClick={() => onChange({ instructions: [...instructions, ""] })}><Plus size={14} />Add action</button>
          </div>
        </div>

        <Field label="Context" hint="Why it is done and what happens meanwhile">
          <textarea rows={3} value={step.description ?? ""} maxLength={600} onChange={(e) => onChange({ description: e.target.value })} />
        </Field>
      </EditSection>
      <EditSection title="Tool, time and result">
        <div className="grid2">
          <Field label="Tool">
            <span className="with-icon">
              <EntryIcon icon={toolIcon} size={22} />
              <select value={newTool !== null ? "__new" : step.tool ?? ""} onChange={(e) => pickTool(e.target.value)}>
                <option value="">None</option>
                {catalog.tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {step.tool && !catalog.tools.some((t) => t.id === step.tool) && <option value={step.tool}>{step.tool} (not in the list)</option>}
                {mayAddTool && <option value="__new">＋ Add a new tool…</option>}
              </select>
            </span>
          </Field>
          <Field label="Typical time"><input value={step.duration ?? ""} maxLength={40} placeholder="10 min" onChange={(e) => onChange({ duration: e.target.value })} /></Field>
        </div>
        {newTool !== null && (
          <div className="field">
            <span className="field-label">Name of the new tool<em>it is added to the list of tools for everyone</em></span>
            <div className="new-tool">
              <input autoFocus value={newTool} maxLength={40} placeholder="ServiceNow" aria-label="Name of the new tool" onChange={(e) => setNewTool(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTool(); }
                  if (e.key === "Escape") { e.preventDefault(); setNewTool(null); } // closes this field, not the whole panel
                }} />
              <button className="btn small primary" disabled={!slugify(newTool) || addingTool} onClick={addTool}><Plus size={14} />Add tool</button>
              <button className="btn small ghost" onClick={() => setNewTool(null)}>Cancel</button>
            </div>
          </div>
        )}
        <div className="grid2">
          <Field label="Link"><input value={step.url ?? ""} placeholder="https://…" onChange={(e) => onChange({ url: e.target.value })} /></Field>
          <Field label="Link text"><input value={step.urlLabel ?? ""} maxLength={60} placeholder="Open the form" onChange={(e) => onChange({ urlLabel: e.target.value })} /></Field>
        </div>
        <Field label="Result of this step" hint="What the reader has in hand afterwards"><input value={step.outcome ?? ""} maxLength={200} placeholder="Request number" onChange={(e) => onChange({ outcome: e.target.value })} /></Field>
      </EditSection>
      <EditSection title="Help for this step">
        <div className="field">
          <span className="field-label">Skills and links for this step<em>For example a skill that does it for you</em></span>
          <ResourceEditor list={step.resources ?? []} onChange={(resources) => onChange({ resources })} />
        </div>

        <Field label="Explained by sub-process">
          <select value={step.subProcessId ?? ""} onChange={(e) => onChange({ subProcessId: e.target.value || undefined })}>
            <option value="">None</option>
            {all.filter((p) => p.id !== process.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            {step.subProcessId && !all.some((p) => p.id === step.subProcessId) && <option value={step.subProcessId}>{step.subProcessId} (missing)</option>}
          </select>
        </Field>
      </EditSection>
      <EditSection title="What comes next">
        <div className="field">
          <span className="field-label">Paths from this step<em>{step.next.length === 0 ? "Nothing: the process ends here" : step.next.length > 1 ? "Several paths: name each one, for example Approved and Rejected" : "The arrow on the map"}</em></span>
          <div className="rows">
            {step.next.map((n, i) => (
              <div className="row" key={i}>
                <input className="next-label" value={n.label ?? ""} maxLength={30} placeholder={step.type === "decision" ? "Approved" : "label (optional)"} aria-label={`Name of path ${i + 1}`}
                  onChange={(e) => setNext(step.next.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)))} />
                <select value={n.to} aria-label={`Path ${i + 1} goes to`} onChange={(e) => setNext(step.next.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}>
                  {others.map((o) => <option key={o.id} value={o.id}>{process.steps.indexOf(o) + 1}. {o.title}</option>)}
                </select>
                <button className="icon-btn" onClick={() => setNext(step.next.filter((_, j) => j !== i))} aria-label={`Remove path ${i + 1}`}><X size={15} /></button>
              </div>
            ))}
            {others.some((o) => !step.next.some((n) => n.to === o.id)) && (
              <button className="btn small ghost" onClick={() => setNext([...step.next, { to: others.find((o) => !step.next.some((n) => n.to === o.id))!.id }])}>
                <Plus size={14} />Add path
              </button>
            )}
          </div>
        </div>
      </EditSection>
    </div>
  );
}
