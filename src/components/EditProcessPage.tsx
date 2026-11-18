import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { DocMeta, Feedback, Process, Standard, Step } from "../types";
import { addStepAfter, deleteStep, insertStep, moveStep, renameStepId, slugify, tidy, today, updateStep } from "../lib/edit";
import { issueTarget, issuesByPlace, issuesFor, PROCESS_SECTIONS, processOutline, selectionKey, type ProcessSection, type Selection } from "../lib/editing";
import { isDrawableProcess, processSchema, validateProcess } from "../lib/validate";
import { useSelectedItem } from "../lib/selection";
import { canEdit } from "../lib/rights";
import { usePerms } from "../lib/session";
import { useCatalog } from "../lib/catalog";
import { href } from "../lib/store";
import { openCount } from "./Feedback";
import { EditFrame, ItemIssues, Outline } from "./EditFrame";
import { EditSession } from "./EditSession";
import { FlowView } from "./FlowView";
import { BeforeYouStart, processAiSpec } from "./ProcessPage";
import { ProcessAbout, ProcessBefore, ProcessLinks, ProcessPeople, ProcessStandards } from "./ProcessSections";
import { StepFields } from "./StepFields";
import { confirmDialog } from "./ui";

const stamp = (p: Process): Process => ({ ...p, updatedAt: today() });
const NONE = new Set<string>();

/** Who may not change a process is told so, with the way back. */
export function NoRight({ noun, title, readHref }: { noun: string; title: string; readHref: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="muted">You may not change this {noun}. Its editors, and the owners of its platform or practice, can.</p>
      <a className="btn" href={readHref}>Back to reading</a>
    </div>
  );
}

/** The editing screen of a process (`#/p/:id/edit[/:stepId]`). */
export function EditProcessPage(props: {
  process: Process; meta?: DocMeta; all: Process[]; standards: Standard[]; feedback: Feedback[]; item?: string;
  onSave: (p: Process, base: number, note?: string) => Promise<number>;
  onReload: () => Promise<{ saved: Process; version: number } | null>;
  onRefresh: () => Promise<void>;
  onDelete: (base: number) => void;
  onDraftMeta: (d: { updatedAt: string; updatedBy: string } | null) => void;
}) {
  const { process, all, standards } = props;
  const perms = usePerms();
  const { catalog } = useCatalog();
  const ctx = useMemo(() => ({ processIds: all.map((p) => p.id), standardIds: standards.map((s) => s.id), catalog }), [all, standards, catalog]);
  const check = useCallback((p: Process) => validateProcess(p, ctx), [ctx]);
  if (!canEdit(perms, "process", process)) return <NoRight noun="process" title={process.title} readHref={href({ page: "process", id: process.id, tab: "flow" })} />;
  return (
    <EditSession<Process> o={{
      kind: "process", doc: process, meta: props.meta, others: all, tidy, stamp, check, drawable: isDrawableProcess,
      aiSpec: (current) => processAiSpec(current, all, standards, catalog),
      json: { validate: check as (v: unknown) => ReturnType<typeof check>, schema: processSchema, schemaFile: "schema/process.schema.json" },
      onSave: props.onSave, onReload: props.onReload, onRefresh: props.onRefresh, onDelete: props.onDelete, onDraftMeta: props.onDraftMeta,
    }}>
      {(s) => <ProcessEditor s={s} {...props} />}
    </EditSession>
  );
}

function ProcessEditor({ s, process, all, standards, feedback, item }: {
  s: import("./EditSession").Session<Process>; process: Process; all: Process[]; standards: Standard[]; feedback: Feedback[]; item?: string;
}) {
  const { d } = s;
  const draft = d.draft;
  const drawable = !s.json;
  const setDraft = d.change;
  const set = (patch: Partial<Process>) => setDraft((p) => ({ ...p, ...patch }));
  // the step selected is in the address (so a link can point at it); a section only on screen
  const [stepId, selectStep] = useSelectedItem(item, (id) => ({ page: "edit-process", id: process.id, ...(id ? { item: id } : {}) }),
    (id) => !drawable || draft.steps.some((x) => x.id === id));
  const [section, setSection] = useState<ProcessSection>("about");
  const sel: Selection = stepId ? { section: "steps", item: stepId } : { section };
  const step = drawable && stepId ? draft.steps.find((x) => x.id === stepId) : undefined;
  const [beforeOpen, setBeforeOpen] = useState(true);

  const choose = (next: Selection, open = true) => {
    if (next.item) selectStep(next.item);
    else { if (stepId) selectStep(null); setSection(next.section as ProcessSection); }
    if (open) s.setPanel("fields");
  };
  // what is selected stays in view on the map and in the outline
  useEffect(() => {
    if (!stepId) return;
    document.querySelector(`.outline [aria-current="true"]`)?.scrollIntoView({ block: "nearest" });
  }, [stepId]);

  const byPlace = useMemo(() => (drawable ? issuesByPlace("process", draft, s.issues) : new Map()), [drawable, draft, s.issues]);
  const outline = drawable ? processOutline(draft) : [];
  const addAfter = (id: string | null) => {
    const r = addStepAfter(draft, id);
    setDraft(r.process);
    selectStep(r.id);
    s.setPanel("fields");
  };
  const sectionLabel = PROCESS_SECTIONS.find((x) => x.id === section)?.label ?? "About";
  const fieldsLabel = step ? `Step ${draft.steps.indexOf(step) + 1}: ${step.title || "(no name yet)"}` : sel.section === "steps" ? "Steps" : sectionLabel;

  let fields;
  if (!drawable) fields = <p className="empty-hint pad">Repair the JSON first: its problems are listed next to it.</p>;
  else if (step) {
    fields = <StepFields key={step.id} process={draft} all={all} step={step} feedback={feedback} issues={issuesFor("process", draft, s.issues, sel)}
      onChange={(patch: Partial<Step>) => setDraft(updateStep(draft, step.id, patch))}
      onTitleBlur={() => {
        // a new step gets its address from its name, once it has one
        if (!/^new-step(-\d+)?$/.test(step.id) || step.title === "New step" || !slugify(step.title)) return;
        const r = renameStepId(draft, step.id, slugify(step.title));
        setDraft(r.process); selectStep(r.id);
      }}
      onDelete={async () => {
        if (!await confirmDialog({ title: "Delete this step?", body: <>“{step.title}” is removed from the draft and the steps around it are connected to each other. Undo brings it back; readers see nothing until you publish.</>, confirmLabel: "Delete step", danger: true })) return;
        setDraft((p) => deleteStep(p, step.id)); selectStep(null); setSection("steps");
      }}
      onMove={(dir) => setDraft(moveStep(draft, step.id, dir))}
      onAddAfter={() => addAfter(step.id)} />;
  } else {
    const head = <h2 className="fields-section-title">{sectionLabel}</h2>;
    const own = issuesFor("process", draft, s.issues, { section });
    switch (section) {
      case "about": fields = <>{head}<ItemIssues issues={own} /><ProcessAbout process={draft} saved={d.saved} all={all} set={set} /></>; break;
      case "before": fields = <>{head}<ItemIssues issues={own} /><ProcessBefore process={draft} all={all} set={set} /></>; break;
      case "people": fields = <>{head}<ItemIssues issues={own} /><ProcessPeople process={draft} set={set} /></>; break;
      case "links": fields = <>{head}<ItemIssues issues={own} /><ProcessLinks process={draft} set={set} /></>; break;
      case "standards": fields = <>{head}<ProcessStandards process={draft} standards={standards} set={set} /></>; break;
      case "steps": fields = (
        <>{head}
          <div className="empty-hint">
            <p>{draft.steps.length} step{draft.steps.length === 1 ? "" : "s"}. Select one in the outline or on the map to change it.</p>
            <p>To add one, press <b>+</b> on an arrow of the map to put it there, or:</p>
            <button className="btn small" onClick={() => addAfter(null)}><Plus size={14} />Add a step at the end</button>
          </div>
          <ItemIssues issues={own.filter((i) => !issueTarget("process", draft, i.path).item)} />
        </>
      ); break;
    }
  }

  const middle = s.json ? s.jsonView : (
    <div className="edit-preview">
      <p className="preview-label">What readers will see</p>
      <button className={`preview-head ${sel.section === "about" ? "on" : ""}`} onClick={() => choose({ section: "about" })}>
        <h2>{draft.title || <span className="muted">(no name yet)</span>}</h2>
        <p>{draft.summary || <span className="muted">No summary yet. Say what the reader has at the end.</span>}</p>
      </button>
      {(draft.prerequisites.length > 0 || !!draft.resources?.length || !!draft.standards?.length)
        ? <div className={`preview-part ${["before", "links", "standards"].includes(sel.section) ? "on" : ""}`}>
            <BeforeYouStart process={draft} all={all} standards={standards} open={beforeOpen} onToggle={() => setBeforeOpen(!beforeOpen)} />
          </div>
        : <button className="preview-empty" onClick={() => choose({ section: "before" })}>Nothing needed before step 1 yet. <b>Add what readers must have in place</b></button>}
      <FlowView editable process={draft} selectedId={stepId} done={NONE} feedback={feedback}
        onSelect={(id) => choose({ section: "steps", item: id })}
        onInsert={(at, spec) => { const r = insertStep(draft, at, spec); setDraft(r.process); selectStep(r.id); }}
        onMoveToLane={(id, actor) => setDraft(updateStep(draft, id, { actor }))} />
    </div>
  );

  return (
    <>
      <EditFrame kind="process" title={draft.title} issues={s.issues} {...s.frame}
        place={(i) => placeOf(draft, i.path)}
        onPickIssue={(i) => choose(issueTarget("process", draft, i.path))}
        outline={<Outline label="Outline of the process" entries={outline} selected={selectionKey(sel)} issues={byPlace}
          feedback={(id) => openCount(feedback, id)}
          onSelect={(e) => choose({ section: e.section, item: e.item }, !!e.item || e.depth === 0)}
          onAdd={{ section: "steps", label: "Add a step at the end", run: () => addAfter(null) }}
          onMove={(id, dir) => setDraft(moveStep(draft, id, dir))} />}
        middle={middle} fields={<div className="edit-fields-body">{fields}</div>} fieldsLabel={fieldsLabel}
        panel={s.panel} setPanel={s.setPanel} />
      {s.dialogs}
    </>
  );
}

/** The place a problem is about, in words: "About", "Step 3 “Approve”". */
function placeOf(p: Process, path: string): string {
  const t = issueTarget("process", p, path);
  if (t.item) { const i = p.steps.findIndex((x) => x.id === t.item); return `Step ${i + 1} “${p.steps[i]?.title ?? t.item}”`; }
  return PROCESS_SECTIONS.find((x) => x.id === t.section)?.label ?? "About";
}
