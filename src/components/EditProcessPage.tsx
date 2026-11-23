import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock3, ListChecks, ListPlus, PenLine, Plus, Send, UserRound } from "lucide-react";
import type { DocMeta, Feedback, Process, Standard, Step } from "../types";
import { stepLabel, stepTarget } from "../lib/stepping";
import { appendStep, deleteStep, EXAMPLE, flowMoveBlocked, insertStep, movedHead, moveStepInFlow, newDecisionNotice, nudgeStep, renameStepId, restructureNotice, shortName, slugify, tidy, today, updateStep } from "../lib/edit";
import { issueTarget, issuesByPlace, noteMove, issuesFor, PROCESS_SECTIONS, processOutline, selectionKey, withoutEarlySuggestions, type ProcessSection, type Selection } from "../lib/editing";
import { isDrawableProcess, processSchema, validateProcess } from "../lib/validate";
import { useSelectedItem } from "../lib/selection";
import { canDraft, canPublish, type Belongs } from "../lib/rights";
import { usePerms } from "../lib/session";
import { useCatalog } from "../lib/catalog";
import { href } from "../lib/store";
import { openCount } from "./Feedback";
import { EditFrame, focusFirstField, focusSelectedInOutline, ItemIssues, Outline } from "./EditFrame";
import { EditSession } from "./EditSession";
import { editNotice } from "./Editing";
import { FlowView } from "./FlowView";
import { PreviewFacts } from "./Governance";
import { Fact, LevelMark } from "./marks";
import { BeforeYouStart, processAiSpec } from "./ProcessPage";
import { ProcessAbout, ProcessBefore, ProcessLinks, ProcessPeople, ProcessStandards } from "./ProcessSections";
import { markBackPath, StepFields } from "./StepFields";

const stamp = (p: Process): Process => ({ ...p, updatedAt: today() });
const NONE = new Set<string>();

/** What somebody who may not change a process or standard is told: who can, and that members can save drafts. */
export const noRightText = (noun: string) =>
  `You may not change this ${noun}. ${noun === "standard" ? "A standards editor" : "A process editor"} and the owners of its platform or practice can; the members of its platform or practice can save drafts of it for an owner to publish.`;

export function NoRight({ noun, title, readHref }: { noun: string; title: string; readHref: string }) {
  return (
    <div className="page">
      <h1>{title}</h1>
      <p className="muted">{noRightText(noun)}</p>
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
  onDraftMeta: (d: { updatedAt: string; updatedBy: string; updatedByName?: string } | null) => void;
}) {
  const { process, all, standards } = props;
  const perms = usePerms();
  const { catalog } = useCatalog();
  const ctx = useMemo(() => ({ processIds: all.map((p) => p.id), standardIds: standards.map((s) => s.id), catalog }), [all, standards, catalog]);
  const check = useCallback((p: Process) => validateProcess(p, ctx), [ctx]);
  if (!canDraft(perms, "process", process)) return <NoRight noun="process" title={process.title} readHref={href({ page: "process", id: process.id, tab: "flow" })} />;
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
  const drawable = s.drawable;
  const setDraft = d.change;
  const set = (patch: Partial<Process>) => setDraft((p) => ({ ...p, ...patch }));
  // the step selected is in the address (so a link can point at it); a section only on screen
  const [stepId, selectStep] = useSelectedItem(item, (id) => ({ page: "edit-process", id: process.id, ...(id ? { item: id } : {}) }),
    (id) => !drawable || draft.steps.some((x) => x.id === id));
  const [section, setSection] = useState<ProcessSection>("about");
  const sel: Selection = stepId ? { section: "steps", item: stepId } : { section };
  const step = drawable && stepId ? draft.steps.find((x) => x.id === stepId) : undefined;
  // "Before you start" is one line above the map; "Show" opens it as readers see it
  const [beforeOpen, setBeforeOpen] = useState(false);

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

  // a refused save or publish brings its first problem into view
  useEffect(() => { if (s.focus) choose(issueTarget("process", draft, s.focus.issue.path)); }, [s.focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // what Undo or Redo brought back is selected
  useEffect(() => { if (s.reveal && draft.steps.some((x) => x.id === s.reveal!.item)) choose({ section: "steps", item: s.reveal.item }, false); }, [s.reveal?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // suggestions about a step added on this screen wait until it has been left once
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const lastStep = useRef<string | null>(null);
  useEffect(() => {
    const was = lastStep.current;
    if (was && was !== stepId) setLeft((l) => (l.has(was) ? l : new Set(l).add(was)));
    lastStep.current = stepId;
  }, [stepId]);
  const issues = useMemo(() => (drawable
    ? withoutEarlySuggestions("process", draft, s.issues, (id) => !left.has(id) && !(d.saved.steps ?? []).some((x) => x.id === id))
    : s.issues), [drawable, draft, s.issues, left, d.saved]);

  // a change of the structure says all it did to the flow, with Undo; a newer message replaces it
  const moved = (id: string, next: Process) => movedHead(next, id);
  const restructure = (next: Process, done: string | undefined, subject: string) => {
    if (next === draft) return;
    const said = restructureNotice(draft, next, done, subject);
    setDraft(next);
    if (said) editNotice.info(said.title, { label: "Undo", run: () => d.undo() }, said.detail);
  };

  const byPlace = useMemo(() => (drawable ? issuesByPlace("process", draft, issues) : new Map()), [drawable, draft, issues]);
  const outline = drawable ? processOutline(draft) : [];
  // Enter on an item of the outline: the focus goes to the first field of what it selected
  const focusFields = () => { s.setPanel("fields"); focusFirstField(); };
  // the line under the steps in the outline that adds one by its name
  const openAddLine = () => {
    s.setPanel("outline");
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(".outline-add-line")?.click();
      document.querySelector<HTMLInputElement>(".outline-add-form input")?.focus();
    });
  };
  // the arrows in the head of a step's fields (and Alt + Page Up / Down): the step before and after
  const stepper = step ? (() => {
    const ids = draft.steps.map((x) => x.id);
    const way = (dir: -1 | 1) => {
      const id = stepTarget(ids, step.id, dir);
      const to = id ? draft.steps.find((x) => x.id === id) : undefined;
      return { label: stepLabel("step", dir, to && { n: ids.indexOf(to.id) + 1, name: to.title }), to: id && selectionKey({ section: "steps", item: id }), go: id ? () => choose({ section: "steps", item: id }) : undefined };
    };
    return { noun: "step" as const, prev: way(-1), next: way(1) };
  })() : undefined;
  const sectionLabel = PROCESS_SECTIONS.find((x) => x.id === section)?.label ?? "About";
  const fieldsLabel = step ? `Step ${draft.steps.indexOf(step) + 1}: ${step.title || "(no name yet)"}` : sel.section === "steps" ? "Steps" : sectionLabel;

  let fields;
  if (!drawable) fields = <p className="empty-hint pad">Repair the JSON first: its problems are listed next to it.</p>;
  else if (step) {
    fields = <StepFields key={step.id} process={draft} all={all} step={step} feedback={feedback} issues={issuesFor("process", draft, issues, sel)}
      onChange={(patch: Partial<Step>) => setDraft(updateStep(draft, step.id, patch))}
      onTitleBlur={() => {
        // a new step gets its address from its name, once it has one
        if (!/^new-step(-\d+)?$/.test(step.id) || step.title === EXAMPLE.newStep || !slugify(step.title)) return;
        const r = renameStepId(draft, step.id, slugify(step.title));
        setDraft(r.process); selectStep(r.id);
      }}
      setProcess={setDraft}
      onDelete={() => {
        // no question: it is deleted at once, and the message offers Undo
        const at = draft.steps.indexOf(step);
        const next = deleteStep(draft, step.id);
        restructure(next, `Step “${shortName(step.title || "(no name yet)", 30)}” deleted.`, step.id);
        const neighbour = next.steps[Math.min(at, next.steps.length - 1)];
        if (neighbour) selectStep(neighbour.id); else { selectStep(null); setSection("steps"); }
        focusSelectedInOutline(neighbour?.title);
      }}
      onMove={(before) => { const next = moveStepInFlow(draft, step.id, before); noteMove(next, step.id); restructure(next, moved(step.id, next), step.id); }}
      onAddAfter={(name) => { const r = insertStep(draft, { afterId: step.id }, { title: name, type: "task", actor: step.actor }); setDraft(r.process); selectStep(r.id); }} />;
  } else {
    const head = <h2 className="fields-section-title">{sectionLabel}</h2>;
    const own = issuesFor("process", draft, issues, { section });
    switch (section) {
      case "about": fields = <>{head}<ItemIssues issues={own} /><ProcessAbout process={draft} saved={d.saved} all={all} set={set} issues={own} /></>; break;
      case "before": fields = <>{head}<ItemIssues issues={own} /><ProcessBefore process={draft} all={all} set={set} /></>; break;
      case "people": fields = <>{head}<ItemIssues issues={own} /><ProcessPeople process={draft} set={set} /></>; break;
      case "links": fields = <>{head}<ItemIssues issues={own} /><ProcessLinks process={draft} set={set} /></>; break;
      case "standards": fields = <>{head}<ProcessStandards process={draft} standards={standards} set={set} /></>; break;
      case "steps": fields = (
        <>{head}
          <div className="empty-hint">
            <p>{draft.steps.length} step{draft.steps.length === 1 ? "" : "s"}. Select one in the outline or on the map to change it.</p>
            <p>To add steps, type their names one after the other under <b>Add a step</b> at the end of the outline, or press <b>+</b> on an arrow of the map to put one exactly there.</p>
            <button className="btn small" onClick={openAddLine}><Plus size={14} />Add a step at the end</button>
          </div>
          <ItemIssues issues={own.filter((i) => !issueTarget("process", draft, i.path).item)} />
        </>
      ); break;
    }
  }

  // a process that is still (almost) blank: say where to start
  const fresh = s.draftKind === "unpublished" && draft.steps.length <= 2;
  const middle = s.json ? s.jsonView : (
    <div className="edit-preview process-preview">
      <button className={`preview-head ${sel.section === "about" ? "on" : ""}`} onClick={() => choose({ section: "about" })} aria-label={`About: ${draft.title || "(no name yet)"}`}>
        <span className="preview-label">What readers will see</span>
        <h2>{draft.title || <span className="muted">(no name yet)</span>}</h2>
        <p>{draft.summary && draft.summary !== EXAMPLE.processSummary ? draft.summary : <span className="muted">No summary yet. Say what the reader has at the end.</span>}</p>
        {sel.section === "about" && (
          <PreviewFacts kind="process" doc={draft}>
            {draft.rigour && <LevelMark level={draft.rigour} />}
            {draft.estimatedDuration && <Fact icon={Clock3} label="Typical time">{draft.estimatedDuration}</Fact>}
          </PreviewFacts>
        )}
      </button>
      {fresh && <StartHere items={processStart(draft, () => {
        choose({ section: "about" });
        setTimeout(() => document.querySelector<HTMLTextAreaElement>(".edit-fields [data-field=summary]")?.focus(), 50);
      }, openAddLine, () => draft.steps[0] && choose({ section: "steps", item: draft.steps[0].id }))} kind="process" belongs={draft} />}
      <PreviewBefore process={draft} all={all} standards={standards} on={["before", "links", "standards"].includes(sel.section)} open={beforeOpen}
        onToggle={() => setBeforeOpen(!beforeOpen)} onChoose={(section) => choose({ section })} />
      <FlowView editable legend={false} openMin={0.6} follow process={draft} selectedId={stepId} done={NONE} feedback={feedback}
        onSelect={(id) => choose({ section: "steps", item: id })}
        onInsert={(at, spec) => {
          const r = insertStep(draft, at, spec);
          setDraft(r.process); selectStep(r.id);
          const said = newDecisionNotice(draft, r.process, r.id);
          if (said) { editNotice.info(said); s.setPanel("fields"); markBackPath(); }
        }}
        onEnter={() => focusFields()}
        onMoveToLane={(id, actor) => setDraft(updateStep(draft, id, { actor }))} />
    </div>
  );

  return (
    <>
      <EditFrame kind="process" title={draft.title} {...s.frame} issues={issues} selection={selectionKey(sel)} fieldIssues={drawable ? issuesFor("process", draft, issues, sel) : undefined}
        place={(i) => placeOf(draft, i.path)}
        onPickIssue={(i) => choose(issueTarget("process", draft, i.path))}
        outline={<Outline label="Outline of the process" entries={outline} selected={selectionKey(sel)} issues={byPlace}
          feedback={(id) => openCount(feedback, id)}
          onSelect={(e) => choose({ section: e.section, item: e.item }, !!e.item || e.depth === 0)}
          onAdd={{ section: "steps", label: "Add a step", placeholder: "Name of the next step", run: (name) => { const r = appendStep(draft, name); setDraft(r.process); selectStep(r.id); } }}
          onMove={(id, before) => { const next = moveStepInFlow(draft, id, before); noteMove(next, id); restructure(next, moved(id, next), id); }}
          onNudge={(id, dir) => { const next = nudgeStep(draft, id, dir); noteMove(next, id); restructure(next, moved(id, next), id); }}
          onEnter={focusFields}
          moveBlocked={(id) => flowMoveBlocked(draft, id)} />}
        middle={middle} fields={<div className="edit-fields-body">{fields}</div>} fieldsLabel={fieldsLabel}
        panel={s.panel} setPanel={s.setPanel} json={s.json} stepper={stepper} />
      {s.dialogs}
    </>
  );
}

/**
 * What readers see before step 1, folded to one line above the map (the map needs the height):
 * what is needed, the links that make it faster, the standards it helps to meet - each a button
 * to its fields. "Show" opens it as readers see it. A link without a name yet is not shown.
 */
function PreviewBefore({ process, all, standards, on, open, onToggle, onChoose }: {
  process: Process; all: Process[]; standards: Standard[]; on: boolean; open: boolean; onToggle: () => void; onChoose: (section: ProcessSection) => void;
}) {
  const shown = { ...process, resources: (process.resources ?? []).filter((r) => typeof r.title === "string" && r.title.trim()) };
  // the same count as the outline: every link, those without a name yet said apart (readers do not see them)
  const pre = process.prerequisites.length, links = (process.resources ?? []).length, helps = process.standards?.length ?? 0;
  const unnamed = links - shown.resources.length;
  const parts: { section: ProcessSection; text: string; none: string }[] = [
    { section: "before", text: `${pre} needed`, none: "nothing needed" },
    { section: "links", text: `${links} ${links === 1 ? "link" : "links"}${unnamed ? ` (${unnamed} without a name)` : ""}`, none: "no links" },
    { section: "standards", text: `${helps} ${helps === 1 ? "standard" : "standards"}`, none: "no standards" },
  ];
  const count = [pre, links, helps];
  return (
    <div className={`preview-before ${on ? "on" : ""} ${open ? "open" : ""}`}>
      <div className="preview-before-line">
        <ListChecks size={15} aria-hidden="true" />
        <b>Before you start</b>
        {parts.map((x, i) => (
          <button key={x.section} className={`preview-before-part ${count[i] ? "" : "none"}`} onClick={() => onChoose(x.section)}
            title={count[i] ? `Change: ${x.text}` : `Add: ${x.none}`}>{count[i] ? x.text : x.none}</button>
        ))}
        {(pre > 0 || links > 0 || helps > 0) && (
          <button className="preview-before-show" aria-expanded={open} onClick={onToggle} title={open ? "Fold it away again" : "Show it as readers see it"}>
            {open ? "Hide" : "Show"}<ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && <BeforeYouStart process={shown} all={all} standards={standards} open onToggle={onToggle} />}
    </div>
  );
}

/** One thing to do on a document that is still blank: done or not, with the button to where it is done. */
export interface StartItem { done: boolean; icon: React.ReactNode; title: string; text: string; action: string; run: () => void }

/**
 * On a process or standard that is still blank: the order in which it is written, each a button to
 * the place where it is done, ticked off as it is done.
 */
export function StartHere({ items, kind, belongs }: { items: StartItem[]; kind: "process" | "standard"; belongs: Belongs }) {
  // something never published: whoever may not publish its whole placement saves it for an owner
  const publishes = canPublish(usePerms(), kind, belongs, belongs, false);
  return (
    <section className="start-here" aria-label="Start here">
      <h3>Start here</h3>
      <ol>
        {items.map((it) => (
          <li key={it.title} className={it.done ? "done" : ""}>
            <span className="start-mark" aria-hidden="true">{it.done ? <Check size={14} strokeWidth={3} /> : it.icon}</span>
            <span className="start-text"><b>{it.title}</b><span>{it.text}</span></span>
            <button className="btn small" onClick={it.run}>{it.action}</button>
          </li>
        ))}
      </ol>
      <p className="start-last"><Send size={13} aria-hidden="true" />{publishes
        ? <span>Then <b>Publish…</b>: the checker on the bar says what is still to do.</span>
        : <span>Then <b>Save draft</b>: an owner publishes it.</span>}</p>
    </section>
  );
}

/** What a blank process asks for first: its summary, its steps, the first step filled in. */
function processStart(process: Process, onSummary: () => void, onSteps: () => void, onFirst: () => void): StartItem[] {
  const summary = !!process.summary.trim() && process.summary !== EXAMPLE.processSummary;
  const steps = process.steps.length > 1 || process.steps.some((x) => x.title !== EXAMPLE.firstStep);
  const first = process.steps[0];
  const filled = !!first && first.actor !== undefined && !!first.instructions?.length && !first.instructions.includes(EXAMPLE.instruction);
  return [
    { done: summary, icon: <PenLine size={16} />, title: "Say what the reader gets", text: "One or two sentences: what they have in hand at the end.", action: "Write the summary", run: onSummary },
    { done: steps, icon: <ListPlus size={16} />, title: "Type the steps in order", text: "In the outline, under Add a step: a name, Enter, the next name.", action: "Add the steps", run: onSteps },
    { done: filled, icon: <UserRound size={16} />, title: "Fill in each step", text: "Who does it, its kind, and exactly what to do, one action per line.", action: "Open the first step", run: onFirst },
  ];
}

/** The place a problem is about, in words: "About", "Step 3 “Approve”". */
function placeOf(p: Process, path: string): string {
  const t = issueTarget("process", p, path);
  if (t.item) { const i = p.steps.findIndex((x) => x.id === t.item); return p.steps[i]?.title?.trim() ? `Step ${i + 1} “${p.steps[i].title}”` : `Step ${i + 1} (no name yet)`; }
  // a participant, prerequisite or link: by its place, as Undo names it, so that two alike can be told apart
  const listed = path.match(/^(actors|prerequisites|resources)\[(\d+)\]/);
  if (listed) {
    const i = Number(listed[2]);
    const [what, name] = listed[1] === "actors" ? ["Participant", p.actors[i]?.name] : listed[1] === "prerequisites" ? ["Prerequisite", p.prerequisites[i]?.title] : ["Link", p.resources?.[i]?.title];
    const named = typeof name === "string" ? name.trim() : "";
    return named ? `${what} ${i + 1} “${named}”` : `${what} ${i + 1} (no name yet)`;
  }
  return PROCESS_SECTIONS.find((x) => x.id === t.section)?.label ?? "About";
}
