import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Braces, CalendarCheck, Check, ChevronDown, ChevronRight, Flag, CircleAlert, CircleCheck, Clock, ListChecks, Plus, Settings2, Sparkles, TriangleAlert, Users, Workflow, Bot, ShieldCheck } from "lucide-react";
import type { DocMeta, Feedback, Process, Step } from "../types";
import { addStepAfter, deleteStep, insertStep, moveStep, prerequisiteKeys, renameStepId, slugify, tidy, today, updateStep } from "../lib/edit";
import { isDrawableProcess, validateProcess } from "../lib/validate";
import { go, guardLeaving, useProgress, type Tab } from "../lib/store";
import { useDraft } from "../lib/draft";
import { useSelectedItem } from "../lib/selection";
import { teamName, useCatalog } from "../lib/catalog";
import { reviewInfo, statusOf, STATUS_LABEL } from "../lib/lifecycle";
import { Resources } from "./Resources";
import { FeedbackTab, openCount, processTarget } from "./Feedback";
import { useEditor } from "../lib/mode";
import { useMe, usePerms } from "../lib/session";
import { href } from "../lib/store";
import { FlowView } from "./FlowView";
import { ListView } from "./ListView";
import { StepDrawer } from "./StepDrawer";
import { ProcessSettings } from "./ProcessSettings";
import type { AiSpec } from "./AiDialog";
import { confirmDialog, IssueList, Loading, notify, scrollBehavior } from "./ui";
import { DimTags, ReviewTag } from "./Governance";
import { BehindBanner, ConflictDialog, HistoryDialog, SaveBar, VersionTag } from "./Editing";
import { SourceSkills } from "./SkillPanel";
import { createPrompt, modifyPrompt } from "../lib/prompt";
import { processSchema } from "../lib/validate";
import type { Catalog, Standard } from "../types";

// the editor for the JSON tab and the AI dialog are loaded when they are first opened
const JsonView = lazy(() => import("./JsonView").then((m) => ({ default: m.JsonView }))) as typeof import("./JsonView").JsonView;
const AiDialog = lazy(() => import("./AiDialog").then((m) => ({ default: m.AiDialog }))) as typeof import("./AiDialog").AiDialog;

const stamp = (p: Process): Process => ({ ...p, updatedAt: today() });

export function ProcessPage({ process, meta, all, standards, tab, item, onSave, onReload, onDelete, feedback }: {
  process: Process; meta?: DocMeta; all: Process[]; standards: Standard[]; tab: Tab; feedback: Feedback[];
  /** The step that is open, from the address: a link can point at one step. */
  item?: string;
  /** Saves on top of version `base`; resolves to the new version. */
  onSave: (p: Process, base: number, note?: string) => Promise<number>;
  onReload: () => Promise<{ saved: Process; version: number } | null>;
  /** Deletes the version this page shows; refused when somebody else changed it since. */
  onDelete: (base: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | "settings" | "ai" | "history">(null);
  const [showIssues, setShowIssues] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [jsonPending, setJsonPending] = useState(false);
  const [extras, setExtras] = useState(() => { try { return localStorage.getItem("pm:map-extras") === "open"; } catch { return false; } });
  const { catalog } = useCatalog();
  const perms = usePerms();
  const editor = useEditor() && perms.processes;
  const d = useDraft<Process>({ docKey: `process/${process.id}`, saved: process, version: meta?.version ?? 0, tidy, stamp, save: onSave, reload: onReload, what: "this process", editable: editor });
  const { draft, clean, dirty } = d;
  const setDraft = d.change;
  const me = useMe();
  const { done, toggle, reset } = useProgress(process.id);

  useEffect(() => { if (!editor) { setEditing(false); setDialog((x) => (x === "history" ? x : null)); } }, [editor]);
  useEffect(() => { if (d.error) { notify.error("The process could not be saved.", d.error); d.clearError(); } }, [d.error]); // eslint-disable-line react-hooks/exhaustive-deps
  // text in the JSON tab that has problems is not in the draft: leaving the tab would drop it
  useEffect(() => (jsonPending ? guardLeaving(`process/${process.id}#json`, "the JSON of this process (it still has problems, so it is not part of the draft)") : undefined), [jsonPending, process.id]);

  const knownIds = useMemo(() => all.map((p) => p.id), [all]);
  const ctx = useMemo(() => ({ processIds: knownIds, standardIds: standards.map((s) => s.id), catalog }), [knownIds, standards, catalog]);
  const issues = useMemo(() => validateProcess(clean, ctx), [clean, ctx]);
  const errors = issues.filter((i) => i.level === "error").length;
  // A process that was stored broken can only be repaired in the JSON tab.
  const renderable = useMemo(() => isDrawableProcess(draft), [draft]);
  const view: Tab = !renderable ? "json" : tab === "json" && !editor ? "flow" : tab;
  // the open step is part of the address, so a link can point at it and Back closes it
  const stepsTab: Tab = view === "list" ? "list" : "flow"; // where a step is shown
  const [selected, setSelected] = useSelectedItem(item,
    (id) => ({ page: "process", id: process.id, tab: stepsTab, ...(id ? { item: id } : {}) }),
    (id) => !renderable || draft.steps.some((s) => s.id === id));
  const step = renderable ? draft.steps.find((s) => s.id === selected) : undefined;

  const select = (id: string) => { setSelected(id); setReporting(false); };
  useEffect(() => { if (!selected) setEditing(false); }, [selected]); // a step opened later starts as it is read
  // in the checklist the open step is brought into view, also when the page was opened by a link to it
  useEffect(() => {
    if (item && view === "list") document.getElementById(`step-${item}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }, [item, view]);
  const addAfter = (id: string | null) => {
    const r = addStepAfter(draft, id);
    setDraft(r.process); setSelected(r.id); setEditing(true);
  };
  const review = reviewInfo(draft);
  const status = statusOf(draft);
  const replacement = draft.replacedBy ? all.find((p) => p.id === draft.replacedBy) : undefined;
  const markReviewed = async () => {
    const who = me.user?.name ?? "";
    const next = { ...draft, review: { intervalMonths: draft.review?.intervalMonths ?? 6, lastReviewedAt: today(), ...(who ? { reviewedBy: who } : {}) } };
    // with other changes pending it becomes part of them; a pure "still correct" is saved straight away
    if (dirty || errors) return setDraft(next);
    try { await onSave({ ...tidy(next), updatedAt: process.updatedAt }, d.base, "Reviewed: confirmed as still correct"); }
    catch (e) { notify.error("The review could not be recorded.", e); }
  };
  const back = () => go({ page: "library" }); // leaving with unsaved changes asks first, like every other way out
  // ticks are remembered by the prerequisite's title; ticks from before that were remembered by position
  const preKeys = renderable ? prerequisiteKeys(draft.prerequisites) : [];
  const hasPre = (i: number) => done.has(preKeys[i]) || done.has(`pre:${i}`);
  const tickPre = (i: number) => {
    if (!done.has(`pre:${i}`)) return toggle(preKeys[i]);
    toggle(`pre:${i}`);
    if (done.has(preKeys[i])) toggle(preKeys[i]);
  };

  const mine = renderable ? draft.steps.filter((s) => s.actor === "me").length : 0;
  const blocked = errors ? "Fix the problems first." : jsonPending ? "The JSON tab has changes with problems. Fix them there first." : undefined;
  // On the map the map comes first: what to prepare is one line that opens. The checklist, where
  // the work is done, shows it in full.
  const hasExtras = renderable && (draft.prerequisites.length > 0 || !!draft.resources?.length || !!draft.standards?.length);
  const showExtras = renderable && (view === "list" || (view === "flow" && extras));

  return (
    <div className={`page process-page ${step ? "with-drawer" : ""}`}>
      <div className="process-head">
        <button className="back" onClick={back}><ArrowLeft size={16} />All processes</button>
        <div className="head-row">
          <div className="head-text">
            <div className="eyebrow">{draft.category ?? "Process"}{draft.owner && <> · owned by {teamName(catalog, draft.owner)}</>}</div>
            <h1>{draft.title}</h1>
            <p className="lead">{draft.summary}</p>
            {renderable && (
              <div className="facts">
                {status !== "active" && <span className={`tier-tag status-${status}`}>{STATUS_LABEL[status]}</span>}
                <DimTags doc={draft} />
                <span><ListChecks size={14} />{draft.steps.length} steps, {mine} for you</span>
                <span><Users size={14} />{draft.actors.length - 1} other {draft.actors.length === 2 ? "party" : "parties"}</span>
                {draft.estimatedDuration && <span><Clock size={14} />{draft.estimatedDuration}</span>}
                {draft.updatedAt && <span>Updated {draft.updatedAt}</span>}
                <ReviewTag doc={draft} />
                <VersionTag meta={meta} onOpen={() => setDialog("history")} />
              </div>
            )}
          </div>
          <div className="head-actions">
            {editor && <>
              {review.state !== "none" && <button className={`btn ${review.state === "ok" ? "" : "review-due"}`} onClick={markReviewed} disabled={!renderable}
                title="Confirm that this process is still correct. Restarts the review interval."><CalendarCheck size={16} />Mark as reviewed</button>}
              <button className="btn accent-soft" onClick={() => setDialog("ai")} disabled={!renderable}><Sparkles size={16} />Change with AI</button>
              <button className="btn" onClick={() => setDialog("settings")} disabled={!renderable}><Settings2 size={16} />Details</button>
              <button className="btn" onClick={() => addAfter(selected)} disabled={!renderable}><Plus size={16} />Add step</button>
            </>}
            <button className="btn report-btn" onClick={() => go({ page: "process", id: process.id, tab: "feedback" })} disabled={!renderable}><Flag size={16} />Report a problem</button>
          </div>
        </div>
      </div>

      <div className="tabs-row">
        <div className="tabs" role="tablist">
          {([["flow", "Map", Workflow], ["list", "Checklist", ListChecks], ["feedback", "Feedback", Flag], ["skills", "Skill", Bot], ["json", "JSON", Braces]] as const).filter(([id]) => editor || id !== "json").map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} disabled={!renderable && id !== "json"}
              onClick={() => go({ page: "process", id: process.id, tab: id, ...(selected && (id === "flow" || id === "list") ? { item: selected } : {}) })}><Icon size={16} />{label}{id === "feedback" && openCount(feedback) > 0 && <span className="tab-count">{openCount(feedback)}</span>}</button>
          ))}
        </div>
        <span className="spacer" />
        {editor && <button className={`status ${errors ? "bad" : issues.length ? "warn" : "good"}`} onClick={() => setShowIssues(!showIssues)} disabled={!issues.length}>
          {errors ? <CircleAlert size={15} /> : issues.length ? <TriangleAlert size={15} /> : <CircleCheck size={15} />}
          {errors ? `${errors} problem${errors > 1 ? "s" : ""}` : issues.length ? `${issues.length} hint${issues.length > 1 ? "s" : ""}` : "No problems"}
        </button>}
        <SaveBar d={d} editor={editor} blocked={blocked} />
      </div>
      <BehindBanner d={d} meta={meta} noun="this process" />
      {showIssues && issues.length > 0 && <div className="issues-panel"><IssueList issues={issues} /></div>}

      {status === "deprecated" && renderable && (
        <div className="check warn banner"><TriangleAlert size={16} /><span><b>This process is retired.</b>{" "}
          {replacement ? <>Use <a href={`#/p/${replacement.id}/flow`}>{replacement.title}</a> instead.</> : "It is kept for reference only."}</span></div>
      )}
      {status === "draft" && renderable && (
        <div className="check warn banner"><TriangleAlert size={16} /><span><b>Draft.</b> Consumers do not see this process until its status is set to Active in Details.</span></div>
      )}
      {editor && review.state === "overdue" && renderable && (
        <div className="check bad banner"><CalendarCheck size={16} /><span><b>{review.label}.</b> Read it through, correct what changed, then press “Mark as reviewed”.</span></div>
      )}

      {view === "flow" && renderable && hasExtras && (
        <button className="extras-toggle" aria-expanded={extras} onClick={() => { const next = !extras; setExtras(next); try { localStorage.setItem("pm:map-extras", next ? "open" : "closed"); } catch { /* ignore */ } }}>
          {extras ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <b>Before you start</b>
          {draft.prerequisites.length > 0 && <span>{draft.prerequisites.filter((_, i) => hasPre(i)).length}/{draft.prerequisites.length} ready</span>}
          {!!draft.resources?.length && <span>{draft.resources.length} useful link{draft.resources.length > 1 ? "s" : ""}</span>}
          {!!draft.standards?.length && <span>{draft.standards.length} standard{draft.standards.length > 1 ? "s" : ""}</span>}
          <em>{extras ? "Hide" : "Show"}</em>
        </button>
      )}

      {showExtras && !!draft.resources?.length && (
        <section className="prereqs">
          <h2>Do it faster <span>self-service skills and useful links</span></h2>
          <Resources list={draft.resources} />
        </section>
      )}

      {showExtras && !!draft.standards?.length && (
        <section className="prereqs">
          <h2>Standards this helps to meet</h2>
          <ul className="link-list row">
            {draft.standards.map((sid) => {
              const s = standards.find((x) => x.id === sid);
              return <li key={sid}>{s ? <a href={href({ page: "standard", id: s.id, tab: "doc" })}><ShieldCheck size={13} />{s.title}</a> : <span className="muted">“{sid}” is not described yet</span>}</li>;
            })}
          </ul>
        </section>
      )}

      {showExtras && draft.prerequisites.length > 0 && (
        <section className="prereqs">
          <h2>Before you start <span>{draft.prerequisites.filter((_, i) => hasPre(i)).length}/{draft.prerequisites.length} ready</span></h2>
          <div className="prereq-grid">
            {draft.prerequisites.map((q, i) => {
              const src = q.processId ? all.find((p) => p.id === q.processId) : undefined;
              const on = hasPre(i);
              return (
                <div key={preKeys[i]} className={`prereq ${on ? "on" : ""}`}>
                  <button className={`tick ${on ? "on" : ""}`} onClick={() => tickPre(i)} aria-pressed={on} aria-label={`I have this: ${q.title}`}><Check size={14} strokeWidth={3} /></button>
                  <div>
                    <strong>{q.title}</strong>
                    {q.description && <p>{q.description}</p>}
                    {q.url && <a href={q.url} target="_blank" rel="noreferrer">More information<ArrowUpRight size={13} /></a>}
                    {q.processId && (
                      <button className="prereq-link" onClick={() => src && go({ page: "process", id: src.id, tab: "flow" })} disabled={!src}>
                        <Workflow size={13} />{src ? <>Don’t have it? {src.title}</> : <>Process “{q.processId}” not described yet</>}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {view === "flow" && renderable && <FlowView editable={editor} process={draft} selectedId={selected} done={done} feedback={feedback} onSelect={select}
        onInsert={(at, spec) => { const r = insertStep(draft, at, spec); setDraft(r.process); setSelected(r.id); setEditing(true); }}
        onMoveToLane={(id, actor) => setDraft(updateStep(draft, id, { actor }))} />}
      {view === "list" && renderable && <ListView process={draft} all={all} done={done} toggle={toggle} reset={reset} selectedId={selected} onSelect={select}
        editable={editor} onInsert={(at, spec) => { const r = insertStep(draft, at, spec); setDraft(r.process); setSelected(r.id); setEditing(true); }}
        feedback={feedback} onReport={(id) => { setSelected(id); setEditing(false); setReporting(true); }} />}
      {view === "feedback" && renderable && <FeedbackTab target={processTarget(draft)} feedback={feedback} onSelect={select} />}
      {view === "skills" && renderable && <SourceSkills kind="process" id={process.id} revision={process} />}
      {view === "json" && <Suspense fallback={<Loading />}><JsonView doc={clean} noun="process" validate={(v) => validateProcess(v, ctx)} schema={processSchema} schemaFile="schema/process.schema.json" onChange={setDraft} onPending={setJsonPending} /></Suspense>}

      {step && (view === "flow" || view === "list") && (
        <StepDrawer editable={editor} process={draft} all={all} step={step} editing={editing} setEditing={setEditing}
          feedback={feedback} reporting={reporting} setReporting={setReporting}
          onClose={() => { setSelected(null); setEditing(false); }} onSelect={select}
          onChange={(patch: Partial<Step>) => setDraft(updateStep(draft, step.id, patch))}
          onTitleBlur={() => {
            if (!/^new-step(-\d+)?$/.test(step.id) || step.title === "New step" || !slugify(step.title)) return;
            const r = renameStepId(draft, step.id, slugify(step.title));
            setDraft(r.process); setSelected(r.id);
          }}
          onDelete={async () => {
            if (!await confirmDialog({ title: "Delete this step?", body: <>“{step.title}” is removed from the draft and the steps around it are connected to each other. Nothing is final until you save.</>, confirmLabel: "Delete step", danger: true })) return;
            setDraft((p) => deleteStep(p, step.id)); setSelected(null);
          }}
          onMove={(dir) => setDraft(moveStep(draft, step.id, dir))}
          onAddAfter={() => addAfter(step.id)} />
      )}

      {dialog === "settings" && (
        <ProcessSettings process={draft} all={all} standards={standards} onChange={setDraft} onClose={() => setDialog(null)}
          onDelete={async () => {
            if (await confirmDialog({ title: "Delete this process?", body: <>“{process.title}” is removed for everyone. Its skill is withdrawn and its feedback is removed.</>, confirmLabel: "Delete process", danger: true })) onDelete(d.base);
          }} />
      )}
      {dialog === "ai" && (
        <Suspense fallback={null}>
          <AiDialog spec={processAiSpec(clean, all, standards, catalog)} onClose={() => setDialog(null)}
            onImport={(p) => { setDraft(p); setSelected(null); setDialog(null); }} />
        </Suspense>
      )}
      {dialog === "history" && <HistoryDialog<Process> kind="process" id={process.id} title={process.title} onClose={() => setDialog(null)}
        onRestore={editor ? (doc) => { setDraft(doc); setDialog(null); } : undefined} />}
      <ConflictDialog d={d} kind="process" id={process.id} noun="this process" blocked={blocked} />
    </div>
  );
}

/** Builds what the AI dialog needs for processes. */
export function processAiSpec(current: Process | undefined, all: Process[], standards: Standard[], catalog: Catalog): AiSpec<Process> {
  const known = all.map((p) => ({ id: p.id, title: p.title }));
  const knownStandards = standards.map((s) => ({ id: s.id, title: s.title }));
  return {
    noun: "process", current, existingIds: all.map((p) => p.id),
    prompt: (text) => (current ? modifyPrompt(current, text, known, catalog, knownStandards) : createPrompt(text, known, catalog, knownStandards)),
    validate: (value) => validateProcess(value, { processIds: [...all.map((p) => p.id), (value as Process)?.id], standardIds: standards.map((s) => s.id), catalog }),
    describe: (p) => `${p.steps.length} steps, ${p.actors.length} participants, ${p.prerequisites.length} prerequisites`,
    describePlaceholder: "To get a new GCP project you first need a cost centre. Then you fill in the ‘New GCP project’ form in ServiceNow…",
    changeExample: "After the budget approval add a security review by the Security team. If they reject, the requester updates the design.",
  };
}
