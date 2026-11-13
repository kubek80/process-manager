import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Braces, Check, Flag, Layers, CircleAlert, CircleCheck, Clock, ListChecks, Plus, Save, Settings2, Sparkles, TriangleAlert, Undo2, Users, Workflow } from "lucide-react";
import type { Feedback, Process, Step } from "../types";
import { addStepAfter, deleteStep, insertStep, moveStep, renameStepId, slugify, tidy, today, updateStep } from "../lib/edit";
import { hasErrors, validateProcess } from "../lib/validate";
import { go, useProgress, type Tab } from "../lib/store";
import { teamName, tierLabel, useCatalog } from "../lib/catalog";
import { FeedbackTab, openCount } from "./Feedback";
import { useEditor } from "../lib/mode";
import { FlowView } from "./FlowView";
import { ListView } from "./ListView";
import { StepDrawer } from "./StepDrawer";
import { ProcessSettings } from "./ProcessSettings";
import { AiDialog, IssueList } from "./AiDialog";
import { JsonView } from "./JsonView";

export function ProcessPage({ process, all, tab, onSave, onDelete, feedback, onFeedback }: {
  process: Process; all: Process[]; tab: Tab; feedback: Feedback[]; onFeedback: (list: Feedback[]) => void; onSave: (p: Process) => Promise<void>; onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Process>(process);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<null | "settings" | "ai">(null);
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState(false);
  const { catalog } = useCatalog();
  const editor = useEditor();
  const { done, toggle, reset } = useProgress(process.id);

  useEffect(() => setDraft(process), [process]);
  useEffect(() => { if (!editor) { setEditing(false); setDialog(null); } }, [editor]);

  const knownIds = useMemo(() => all.map((p) => p.id), [all]);
  const clean = useMemo(() => tidy(draft), [draft]);
  const issues = useMemo(() => validateProcess(clean, { processIds: knownIds, catalog }), [clean, knownIds, catalog]);
  const errors = issues.filter((i) => i.level === "error").length;
  const dirty = JSON.stringify(clean) !== JSON.stringify(process);
  // A file that is broken on disk can only be repaired in the JSON tab.
  const renderable = useMemo(() => !hasErrors(validateProcess(draft)) || !hasErrors(validateProcess(clean)), [draft, clean]);
  const view: Tab = !renderable ? "json" : tab === "json" && !editor ? "flow" : tab;
  const step = renderable ? draft.steps.find((s) => s.id === selected) : undefined;

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const select = (id: string) => {
    setSelected(id); setReporting(false);
    if (view === "feedback") go({ page: "process", id: process.id, tab: "flow" });
    if (view === "list") document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const addAfter = (id: string | null) => {
    const r = addStepAfter(draft, id);
    setDraft(r.process); setSelected(r.id); setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try { await onSave({ ...clean, updatedAt: today() }); } finally { setSaving(false); }
  };
  const back = () => { if (!dirty || confirm("Leave without saving your changes?")) go({ page: "library" }); };

  const mine = renderable ? draft.steps.filter((s) => s.actor === "me").length : 0;

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
                <span className={`tier-tag ${draft.tiers?.length ? "some" : ""}`}><Layers size={12} />{tierLabel(catalog, draft.tiers)}</span>
                <span><ListChecks size={14} />{draft.steps.length} steps, {mine} for you</span>
                <span><Users size={14} />{draft.actors.length - 1} other {draft.actors.length === 2 ? "party" : "parties"}</span>
                {draft.estimatedDuration && <span><Clock size={14} />{draft.estimatedDuration}</span>}
                {draft.updatedAt && <span>Updated {draft.updatedAt}</span>}
              </div>
            )}
          </div>
          <div className="head-actions">
            {editor && <>
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
          {([["flow", "Map", Workflow], ["list", "Checklist", ListChecks], ["feedback", "Feedback", Flag], ["json", "JSON", Braces]] as const).filter(([id]) => editor || id !== "json").map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} disabled={!renderable && id !== "json"}
              onClick={() => go({ page: "process", id: process.id, tab: id })}><Icon size={16} />{label}{id === "feedback" && openCount(feedback) > 0 && <span className="tab-count">{openCount(feedback)}</span>}</button>
          ))}
        </div>
        <span className="spacer" />
        {editor && <button className={`status ${errors ? "bad" : issues.length ? "warn" : "good"}`} onClick={() => setShowIssues(!showIssues)} disabled={!issues.length}>
          {errors ? <CircleAlert size={15} /> : issues.length ? <TriangleAlert size={15} /> : <CircleCheck size={15} />}
          {errors ? `${errors} problem${errors > 1 ? "s" : ""}` : issues.length ? `${issues.length} hint${issues.length > 1 ? "s" : ""}` : "Schema valid"}
        </button>}
        {dirty && <>
          <button className="btn" onClick={() => { setDraft(process); setEditing(false); }}><Undo2 size={16} />Discard</button>
          <button className="btn primary" disabled={!!errors || saving} onClick={save} title={errors ? "Fix the problems first" : ""}><Save size={16} />Save changes</button>
        </>}
        {!dirty && editor && <span className="saved"><Check size={14} />Saved</span>}
      </div>
      {showIssues && issues.length > 0 && <div className="issues-panel"><IssueList issues={issues} /></div>}

      {(view === "flow" || view === "list") && renderable && draft.prerequisites.length > 0 && (
        <section className="prereqs">
          <h2>Before you start <span>{draft.prerequisites.filter((_, i) => done.has(`pre:${i}`)).length}/{draft.prerequisites.length} ready</span></h2>
          <div className="prereq-grid">
            {draft.prerequisites.map((q, i) => {
              const src = q.processId ? all.find((p) => p.id === q.processId) : undefined;
              const on = done.has(`pre:${i}`);
              return (
                <div key={i} className={`prereq ${on ? "on" : ""}`}>
                  <button className={`tick ${on ? "on" : ""}`} onClick={() => toggle(`pre:${i}`)} aria-label="I have this"><Check size={14} strokeWidth={3} /></button>
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
        feedback={feedback} onReport={(id) => { setSelected(id); setEditing(false); setReporting(true); }} />}
      {view === "feedback" && renderable && <FeedbackTab editable={editor} process={draft} feedback={feedback} onChange={onFeedback} onSelect={select} />}
      {view === "json" && <JsonView process={clean} knownIds={knownIds} onChange={setDraft} />}

      {step && (view === "flow" || view === "list") && (
        <StepDrawer editable={editor} process={draft} all={all} step={step} editing={editing} setEditing={setEditing}
          feedback={feedback} onFeedback={onFeedback} reporting={reporting} setReporting={setReporting}
          onClose={() => { setSelected(null); setEditing(false); }} onSelect={select}
          onChange={(patch: Partial<Step>) => setDraft(updateStep(draft, step.id, patch))}
          onTitleBlur={() => {
            if (!/^new-step(-\d+)?$/.test(step.id) || step.title === "New step" || !slugify(step.title)) return;
            const r = renameStepId(draft, step.id, slugify(step.title));
            setDraft(r.process); setSelected(r.id);
          }}
          onDelete={() => { if (confirm(`Delete the step “${step.title}”?`)) { setDraft(deleteStep(draft, step.id)); setSelected(null); } }}
          onMove={(dir) => setDraft(moveStep(draft, step.id, dir))}
          onAddAfter={() => addAfter(step.id)} />
      )}

      {dialog === "settings" && (
        <ProcessSettings process={draft} all={all} onChange={setDraft} onClose={() => setDialog(null)}
          onDelete={() => { if (confirm(`Delete the process “${process.title}”? The file processes/${process.id}.json is removed.`)) onDelete(); }} />
      )}
      {dialog === "ai" && (
        <AiDialog current={clean} all={all} onClose={() => setDialog(null)}
          onImport={(p) => { setDraft(p); setSelected(null); setDialog(null); }} />
      )}
    </div>
  );
}
