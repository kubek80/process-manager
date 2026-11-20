import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, CornerUpLeft, GitBranch, Plus, X } from "lucide-react";
import type { Feedback, Issue, NextLink, Process, Step, StepType } from "../types";
import { addActor, EXAMPLE, flowMoveBlocked, newDecisionNotice, setStepType, slugify, uniqueId } from "../lib/edit";
import { useCatalog } from "../lib/catalog";
import { usePerms } from "../lib/session";
import { STEP_META, STEP_TYPES, stepHelp } from "../lib/stepMeta";
import { processTarget } from "./Feedback";
import { ResourceEditor } from "./Resources";
import { EntryIcon } from "./EntryIcon";
import { DeleteButton, EditSection, FieldsHead, ItemFeedback, ItemIssues, selectExample } from "./EditFrame";
import { Field, TypeIcon, notify, useLayer } from "./ui";
import { editNotice } from "./Editing";

/** The fields of a step that most steps do without: offered as "+ Tool", "+ Typical time"… until they have a value. */
type Detail = "description" | "tool" | "duration" | "url" | "outcome" | "resources" | "subProcessId";
const DETAILS: { id: Detail; label: string }[] = [
  { id: "description", label: "Context" },
  { id: "tool", label: "Tool" },
  { id: "duration", label: "Typical time" },
  { id: "outcome", label: "Result" },
  { id: "url", label: "Link" },
  { id: "resources", label: "Skills and links" },
  { id: "subProcessId", label: "Sub-process" },
];
const hasValue = (s: Step, d: Detail) => (d === "url" ? !!(s.url || s.urlLabel) : d === "resources" ? !!s.resources?.length : !!s[d]);

/**
 * The fields of one step on the editing screen, directly editable, in the order a step is
 * written: what happens, who does it and what kind it is, what to do, what comes next. The rest
 * is offered as "+ Tool", "+ Result"… and shown once it has a value. Problems and open feedback
 * come first, short: they are why somebody opens a step.
 */
export function StepFields({ process, all, step, feedback, issues, onChange, setProcess, onTitleBlur, onDelete, onMove, onAddAfter }: {
  process: Process; all: Process[]; step: Step; feedback: Feedback[]; issues: Issue[];
  onChange: (patch: Partial<Step>) => void;
  /** A change that also touches other parts of the process (a new participant, a kind that adds paths). */
  setProcess: (p: Process) => void;
  onTitleBlur: () => void;
  onDelete: () => void;
  /** Moves the step in the flow: before another step, or (null) to the end. */
  onMove: (before: string | null) => void;
  /** Adds a step with this name after this one (a new branch of a decision). */
  onAddAfter: (name: string) => void;
}) {
  const index = process.steps.findIndex((s) => s.id === step.id);
  const actor = process.actors.find((a) => a.id === step.actor);
  const meta = STEP_META[step.type];
  const instructions = step.instructions ?? [];
  const moveBlocked = flowMoveBlocked(process, step.id);
  // fields the checker has something to say about are shown even when empty
  const flagged = new Set(issues.map((i) => i.path.match(/^steps\[\d+\]\.([A-Za-z]+)/)?.[1]).filter(Boolean) as string[]);
  const [opened, setOpened] = useState<Detail[]>([]);
  const [naming, setNaming] = useState(false);
  const shown = DETAILS.filter((d) => hasValue(step, d.id) || opened.includes(d.id) || flagged.has(d.id) || (d.id === "url" && flagged.has("urlLabel"))
    || (d.id === "subProcessId" && step.type === "subprocess"));
  const offered = DETAILS.filter((d) => !shown.includes(d));
  const insRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusIns = (i: number) => requestAnimationFrame(() => insRefs.current[i]?.focus());

  return (
    <div className="edit-fields-inner step-fields" style={{ "--c": meta.color } as React.CSSProperties}>
      <FieldsHead icon={<TypeIcon type={step.type} size={40} />} kicker={<><span className="who">{actor?.name ?? step.actor}</span><span>Step {index + 1} of {process.steps.length}</span></>}
        title={step.title || "(no name yet)"}
        tools={<>
          <button className="btn small ghost" aria-expanded={naming} onClick={() => setNaming(!naming)}><Plus size={14} />{step.type === "decision" ? "Add a branch" : "Add step after"}</button>
          <span className="spacer" />
          <span className="fields-move">
          {process.steps.length > 1 && (
            <select className="move-select" value="" aria-label="Move this step" title={moveBlocked || "Put this step somewhere else in the flow"} disabled={!!moveBlocked}
              onChange={(e) => { const v = e.target.value; if (v) onMove(v === "__end" ? null : v); }}>
              <option value="">Move…</option>
              {process.steps.map((s, i) => (s.id === step.id || process.steps[i - 1]?.id === step.id ? null
                : <option key={s.id} value={s.id}>Before {i + 1}. {s.title}</option>))}
              {index !== process.steps.length - 1 && <option value="__end">To the end</option>}
            </select>
          )}
          <DeleteButton label="Delete step" disabled={process.steps.length === 1} onDelete={onDelete} />
          </span>
        </>} />
      {naming && <NameNew label={step.type === "decision" ? "Name of the step on the new branch" : "Name of the step after this one"}
        onAdd={(name) => { setNaming(false); onAddAfter(name); focusSoon(".edit-fields input.step-title"); }} onCancel={() => setNaming(false)} />}
      <ItemIssues issues={issues} />
      <ItemFeedback feedback={feedback.filter((f) => f.itemId === step.id && !f.resolved)} target={processTarget(process)} noun="step" />

      <div className="step-core form">
        <Field label="What happens" hint={step.type === "decision" ? "Ask the question the step decides, e.g. “Is it a standard model?”" : "Start with a verb, as the reader would say it"}>
          <input className="step-title" value={step.title} maxLength={70} onChange={(e) => onChange({ title: e.target.value })} onBlur={onTitleBlur}
            placeholder={step.type === "decision" ? "e.g. Is it a standard model?" : "e.g. Fill in the ServiceNow request"}
            data-autofocus={step.title === EXAMPLE.newStep ? "" : undefined} onFocus={selectExample(EXAMPLE.newStep, EXAMPLE.firstStep)} />
        </Field>
        <WhoField process={process} step={step} onChange={onChange} setProcess={setProcess} />
        <KindField type={step.type} onPick={(t) => {
          const next = setStepType(process, step.id, t);
          setProcess(next);
          // a new decision whose second answer goes back: said at once, and shown where it is changed
          const said = newDecisionNotice(process, next, step.id);
          if (said) { editNotice.info(said); markBackPath(); }
        }} />
      </div>

      <EditSection title="What to do">
        <div className="field">
          <span className="field-label" id={`ins-${step.id}`}>Exactly what to do<em>One action per line. Readers tick them off. Enter starts the next one.</em></span>
          <ol className="rows ins-rows" aria-labelledby={`ins-${step.id}`}>
            {instructions.map((ins, i) => (
              <li className="row" key={i}>
                <span className="row-n" aria-hidden="true">{i + 1}</span>
                <textarea ref={(el) => { insRefs.current[i] = el; }} rows={1} value={ins} maxLength={300} autoFocus={ins === ""} placeholder="Describe one action" aria-label={`Action ${i + 1}`}
                  onFocus={selectExample(EXAMPLE.instruction)}
                  onChange={(e) => onChange({ instructions: instructions.map((x, j) => (j === i ? e.target.value : x)) })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onChange({ instructions: [...instructions.slice(0, i + 1), "", ...instructions.slice(i + 1)] }); }
                    // Backspace in an empty line removes it and goes back to the one before
                    if (e.key === "Backspace" && ins === "" && instructions.length > 0) { e.preventDefault(); onChange({ instructions: instructions.filter((_, j) => j !== i) }); if (i > 0) focusIns(i - 1); }
                  }} />
                <button className="icon-btn" onClick={() => onChange({ instructions: instructions.filter((_, j) => j !== i) })} aria-label={`Remove action ${i + 1}`}><X size={15} /></button>
              </li>
            ))}
          </ol>
          <button className="btn small ghost add-row" onClick={() => onChange({ instructions: [...instructions, ""] })}><Plus size={14} />Add action</button>
        </div>
      </EditSection>

      <EditSection title="What comes next">
        <PathsField process={process} step={step} onChange={(next) => onChange({ next })} />
      </EditSection>

      <EditSection title="More about this step">
        {shown.map((d) => <DetailField key={d.id} d={d.id} process={process} all={all} step={step} onChange={onChange} autoFocus={opened.includes(d.id) && !hasValue(step, d.id)} />)}
        {offered.length > 0 && (
          <div className="detail-offers" role="group" aria-label="Add to this step">
            {offered.map((d) => <button key={d.id} className="chip add-chip" onClick={() => setOpened([...opened, d.id])}><Plus size={13} />{d.label}</button>)}
          </div>
        )}
      </EditSection>
    </div>
  );
}

/**
 * Brings the answer of a decision that goes back into view in the fields, briefly marked (after a
 * step became a decision, its "No" goes back to the step before).
 */
export function markBackPath() {
  let tries = 20;
  const attempt = () => {
    const row = document.querySelector<HTMLElement>(".edit-fields .path-row.back");
    if (!row) { if (tries-- > 0) requestAnimationFrame(attempt); return; }
    row.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.classList.remove("flash");
    void row.offsetWidth; // start the mark afresh
    row.classList.add("flash");
    setTimeout(() => row.classList.remove("flash"), 2600);
  };
  requestAnimationFrame(attempt);
}

/** Moves the keyboard to what a change has just made, once it is on screen (a few frames at most). */
export function focusSoon(selector: string, select = false) {
  let tries = 20;
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) { if (tries-- > 0) requestAnimationFrame(attempt); return; }
    el.focus();
    if (select && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.select();
  };
  requestAnimationFrame(attempt);
}

/** A name for a new step, asked right where it is added: Enter adds it, Escape does not. */
function NameNew({ label, onAdd, onCancel }: { label: string; onAdd: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const ok = name.trim().length >= 2;
  return (
    <form className="name-new" onSubmit={(e) => { e.preventDefault(); if (ok) onAdd(name.trim()); }}>
      <input autoFocus value={name} maxLength={70} aria-label={label} placeholder={label} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }} />
      <button type="submit" className="btn small primary" disabled={!ok}><Plus size={14} />Add</button>
      <button type="button" className="btn small ghost" onClick={onCancel}>Cancel</button>
    </form>
  );
}

/** Who does it: the participants, and somebody new straight from here. */
function WhoField({ process, step, onChange, setProcess }: { process: Process; step: Step; onChange: (p: Partial<Step>) => void; setProcess: (p: Process) => void }) {
  const { catalog } = useCatalog();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const list = useId();
  const free = catalog.teams.filter((t) => !process.actors.some((a) => a.teamId === t.id || a.id === t.id));
  const add = () => {
    if (name.trim().length < 2) return;
    const r = addActor(process, name, catalog.teams);
    setProcess({ ...r.process, steps: r.process.steps.map((s) => (s.id === step.id ? { ...s, actor: r.id } : s)) });
    setName(""); setAdding(false);
    // the keyboard goes on from the new participant's chip, which is now chosen
    focusSoon(".edit-fields .step-core .chips [aria-pressed=true]");
  };
  return (
    <div className="field">
      <span className="field-label" id={`${list}-l`}>Who does it</span>
      <div className="chips" role="group" aria-labelledby={`${list}-l`}>
        {process.actors.map((a) => (
          <button key={a.id} className={`chip ${step.actor === a.id ? "on" : ""}`} aria-pressed={step.actor === a.id} onClick={() => onChange({ actor: a.id })}>{a.name}</button>
        ))}
        {!adding && <button className="chip add-chip" onClick={() => setAdding(true)}><Plus size={13} />Someone else</button>}
      </div>
      {adding && (
        <div className="who-new">
          <input autoFocus value={name} maxLength={40} list={list} placeholder="Team, role or system" aria-label="Who else takes part"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); add(); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAdding(false); setName(""); }
            }} />
          <datalist id={list}>{free.map((t) => <option key={t.id} value={t.name} />)}</datalist>
          <span className="who-new-actions">
            <button className="btn small primary" disabled={name.trim().length < 2} onClick={add}><Plus size={14} />Add and give them this step</button>
            <button className="btn small ghost" onClick={() => { setAdding(false); setName(""); }}>Cancel</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** When to use a kind, under the closed choice. "Task" is described by what it is not: the other kinds are listed in the choice. */
const kindHint = (t: StepType) => (t === "task" ? "Manual work that is none of the other kinds." : stepHelp(t));

/** The kind of step: one button showing it; the choice opens on demand, so it does not push "what to do" away. */
function KindField({ type, onPick }: { type: StepType; onPick: (t: StepType) => void }) {
  const [open, setOpen] = useState(false);
  const label = useId();
  return (
    <div className="field kind-field">
      <span className="field-label" id={label}>Kind of step<em>{kindHint(type)}</em></span>
      <button className="kind-pick" aria-expanded={open} aria-haspopup="true" aria-describedby={label} onClick={() => setOpen(!open)}
        style={{ "--c": STEP_META[type].color } as React.CSSProperties}>
        <TypeIcon type={type} size={26} /><span>{STEP_META[type].label}</span><ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && <KindPop type={type} onClose={() => setOpen(false)} onPick={(t) => { onPick(t); setOpen(false); }} />}
    </div>
  );
}

function KindPop({ type, onPick, onClose }: { type: StepType; onPick: (t: StepType) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { focus: false });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus();
    const away = (e: Event) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [hint, setHint] = useState<StepType>(type);
  // one stop for Tab: the arrow keys move through the kinds (up and down by rows), Enter chooses
  const [stop, setStop] = useState<StepType>(type);
  const roam = (e: React.KeyboardEvent<HTMLButtonElement>, t: StepType) => {
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".type-opt") ?? [])];
    const at = STEP_TYPES.indexOf(t);
    const top = (b: HTMLElement) => b.offsetTop;
    const perRow = Math.max(1, all.filter((b) => top(b) === top(all[0])).length);
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowDown" ? at + perRow : e.key === "ArrowUp" ? at - perRow
      : e.key === "Home" ? 0 : e.key === "End" ? STEP_TYPES.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = STEP_TYPES[Math.max(0, Math.min(STEP_TYPES.length - 1, to))];
    setStop(next);
    all[STEP_TYPES.indexOf(next)]?.focus();
  };
  return (
    <div ref={ref} className="kind-pop" role="group" aria-label="Kind of step">
      <div className="type-grid">
        {STEP_TYPES.map((t) => (
          <button key={t} className={`type-opt ${type === t ? "on" : ""}`} aria-pressed={type === t} title={stepHelp(t)} tabIndex={t === stop ? 0 : -1}
            style={{ "--c": STEP_META[t].color } as React.CSSProperties} onClick={() => onPick(t)} onKeyDown={(e) => roam(e, t)}
            onMouseEnter={() => setHint(t)} onFocus={() => { setHint(t); setStop(t); }}>
            <TypeIcon type={t} size={24} /><span>{STEP_META[t].label}</span>
          </button>
        ))}
      </div>
      <p className="kind-hint"><b>{STEP_META[hint].label}:</b> {kindHint(hint)}</p>
    </div>
  );
}

/**
 * Where the flow goes after this step, in sentences: "Then → step", or for a decision one
 * answer per branch. The buttons say what they make: a branch, a way back to an earlier step.
 */
function PathsField({ process, step, onChange }: { process: Process; step: Step; onChange: (next: NextLink[]) => void }) {
  const index = process.steps.findIndex((s) => s.id === step.id);
  const decision = step.type === "decision";
  const named = decision || step.next.length > 1;
  const later = process.steps.filter((s, i) => i > index);
  const earlier = process.steps.filter((s, i) => i < index);
  const free = (from: Step[]) => from.find((o) => !step.next.some((n) => n.to === o.id));
  const nextFree = free(later) ?? free([...earlier].reverse());
  const backTo = free([...earlier].reverse());
  const spare = (wanted: string) => {
    const taken = new Set(step.next.map((n) => n.label));
    if (!taken.has(wanted)) return wanted;
    for (let i = 2; ; i++) if (!taken.has(`${wanted} ${i}`)) return `${wanted} ${i}`;
  };
  const add = (to: string, label?: string) => onChange([...step.next, label ? { to, label } : { to }]);
  const n = (id: string) => process.steps.findIndex((s) => s.id === id) + 1;
  return (
    <div className="field paths">
      <span className="field-label">
        {step.next.length === 0 ? "The process ends here" : decision ? "One branch per answer" : step.next.length > 1 ? "Several ways on" : "Then"}
        <em>{decision ? "Name each answer, for example Approved and Rejected." : step.next.length === 0 ? "Nothing follows this step." : "The arrow on the map."}</em>
      </span>
      {step.next.length > 0 && (
        <ul className={`rows path-rows ${named ? "answers" : ""}`}>
          {step.next.map((p, i) => {
            const back = n(p.to) > 0 && n(p.to) <= index + 1;
            const target = (
              <select value={p.to} aria-label={`Path ${i + 1} goes to`} onChange={(e) => onChange(step.next.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}>
                {later.length > 0 && <optgroup label="Later steps">{later.map((o) => <option key={o.id} value={o.id}>{n(o.id)}. {o.title}</option>)}</optgroup>}
                {earlier.length > 0 && <optgroup label="Back to an earlier step">{earlier.map((o) => <option key={o.id} value={o.id}>↩ {n(o.id)}. {o.title}</option>)}</optgroup>}
              </select>
            );
            const remove = <button className="icon-btn" onClick={() => onChange(step.next.filter((_, j) => j !== i))} aria-label={`Remove path ${i + 1}`} title={named ? "Remove this answer" : "Remove this way on"}><X size={15} /></button>;
            // an answer: its name above where it goes, both the whole width of the column
            if (named) return (
              <li className={`path-row answer-row ${back ? "back" : ""}`} key={i}>
                <span className="row-n" aria-hidden="true">{i + 1}</span>
                <span className="answer-fields">
                  <input className="next-label" value={p.label ?? ""} maxLength={30} placeholder={decision ? (i === 0 ? "e.g. Yes" : "e.g. No") : "Name (optional)"} aria-label={`Name of path ${i + 1}`}
                    onChange={(e) => onChange(step.next.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)))} />
                  <span className="answer-to"><span className="answer-goes" aria-hidden="true">{back ? <CornerUpLeft size={13} /> : "→"}</span>{target}</span>
                </span>
                {remove}
              </li>
            );
            return (
              <li className={`row path-row ${back ? "back" : ""}`} key={i}>
                <span className="path-then" aria-hidden="true">→</span>
                {target}
                {remove}
              </li>
            );
          })}
        </ul>
      )}
      <div className="path-adds">
        {nextFree && (decision
          ? <button className="btn small ghost" onClick={() => {
              const label = spare(step.next.length === 0 ? "Yes" : step.next.length === 1 ? "No" : "Other");
              add(nextFree.id, label);
              // the new answer's name is ready to type over, and the screen says where it leads
              focusSoon(".edit-fields .path-rows > li:last-child .next-label", true);
              editNotice.info(`Answer “${label}” added: it goes to ${n(nextFree.id)}. ${nextFree.title || "(no name yet)"}. Name it, and choose where it goes.`);
            }}><GitBranch size={14} />Add a branch</button>
          : <button className="btn small ghost" onClick={() => { add(nextFree.id); focusSoon(".edit-fields .path-rows > li:last-child select"); }}><Plus size={14} />{step.next.length === 0 ? "Continue to a step" : "Add another way on"}</button>)}
        {backTo && <button className="btn small ghost" title={`A loop: the flow goes back to “${backTo.title || `step ${n(backTo.id)}`}”, for example to correct something`}
          onClick={() => { add(backTo.id, decision ? spare("No") : undefined); focusSoon(`.edit-fields .path-rows > li:last-child ${decision ? ".next-label" : "select"}`, decision); }}><CornerUpLeft size={14} />Go back to an earlier step</button>}
      </div>
    </div>
  );
}

/** One of the less used fields of a step. */
function DetailField({ d, process, all, step, onChange, autoFocus }: {
  d: Detail; process: Process; all: Process[]; step: Step; onChange: (p: Partial<Step>) => void; autoFocus: boolean;
}) {
  switch (d) {
    case "description": return (
      <Field label="Context" hint="Why it is done, and what goes on meanwhile">
        <textarea rows={3} value={step.description ?? ""} maxLength={600} autoFocus={autoFocus} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
    );
    case "tool": return <ToolField step={step} onChange={onChange} autoFocus={autoFocus} />;
    case "duration": return (
      <Field label="Typical time"><input value={step.duration ?? ""} maxLength={40} placeholder="e.g. 10 min" autoFocus={autoFocus} onChange={(e) => onChange({ duration: e.target.value })} /></Field>
    );
    case "outcome": return (
      <Field label="Result of this step" hint="What the reader has in hand afterwards"><input value={step.outcome ?? ""} maxLength={200} placeholder="e.g. Request number" autoFocus={autoFocus} onChange={(e) => onChange({ outcome: e.target.value })} /></Field>
    );
    case "url": return (
      <div className="grid2">
        <Field label="Link"><input value={step.url ?? ""} placeholder="https://…" autoFocus={autoFocus} onChange={(e) => onChange({ url: e.target.value })} /></Field>
        <Field label="Link text"><input value={step.urlLabel ?? ""} maxLength={60} placeholder="e.g. Open the form" onChange={(e) => onChange({ urlLabel: e.target.value })} /></Field>
      </div>
    );
    case "resources": return (
      <div className="field">
        <span className="field-label">Skills and links for this step<em>For example a skill that does it for you</em></span>
        <ResourceEditor list={step.resources?.length ? step.resources : autoFocus ? [{ title: "", url: "", kind: "other" }] : []} onChange={(resources) => onChange({ resources })} />
      </div>
    );
    case "subProcessId": return (
      <Field label="Explained by sub-process" hint={step.type === "subprocess" ? "A sub-process step needs the process it stands for" : undefined}>
        <select value={step.subProcessId ?? ""} autoFocus={autoFocus} onChange={(e) => onChange({ subProcessId: e.target.value || undefined })}>
          <option value="">None</option>
          {all.filter((p) => p.id !== process.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          {step.subProcessId && !all.some((p) => p.id === step.subProcessId) && <option value={step.subProcessId}>{step.subProcessId} (missing)</option>}
        </select>
      </Field>
    );
  }
}

function ToolField({ step, onChange, autoFocus }: { step: Step; onChange: (p: Partial<Step>) => void; autoFocus: boolean }): ReactNode {
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
    <>
      <Field label="Tool">
        <span className="with-icon">
          <EntryIcon icon={toolIcon} size={22} />
          <select value={newTool !== null ? "__new" : step.tool ?? ""} autoFocus={autoFocus} onChange={(e) => pickTool(e.target.value)}>
            <option value="">None</option>
            {catalog.tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {step.tool && !catalog.tools.some((t) => t.id === step.tool) && <option value={step.tool}>{step.tool} (not in the list)</option>}
            {mayAddTool && <option value="__new">＋ Add a new tool…</option>}
          </select>
        </span>
      </Field>
      {newTool !== null && (
        <div className="field">
          <span className="field-label">Name of the new tool<em>it is added to the list of tools for everyone</em></span>
          <div className="new-tool">
            <input autoFocus value={newTool} maxLength={40} placeholder="e.g. ServiceNow" aria-label="Name of the new tool" onChange={(e) => setNewTool(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addTool(); }
                if (e.key === "Escape") { e.preventDefault(); setNewTool(null); } // closes this field, not the whole panel
              }} />
            <button className="btn small primary" disabled={!slugify(newTool) || addingTool} onClick={addTool}><Plus size={14} />Add tool</button>
            <button className="btn small ghost" onClick={() => setNewTool(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
