import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, MousePointerClick, CalendarCheck, Check, ChevronDown, ChevronRight, Flag, Clock3, ListChecks, Pencil, TriangleAlert, UserCheck, Users, Workflow, Bot, ShieldCheck } from "lucide-react";
import type { DocMeta, Feedback, Process } from "../types";
import { prerequisiteKeys } from "../lib/edit";
import { isDrawableProcess, validateProcess } from "../lib/validate";
import { go, useProgress, type Tab } from "../lib/store";
import { useSelectedItem } from "../lib/selection";
import { canEdit, canManage } from "../lib/rights";
import { reviewOf, statusOf } from "../lib/lifecycle";
import { RESOURCE_KINDS } from "./Resources";
import { FeedbackForm, FeedbackTab, openCount, processTarget } from "./Feedback";
import { DocEngagement } from "./Engage";
import { useMe, usePerms } from "../lib/session";
import { href } from "../lib/store";
import { FlowView } from "./FlowView";
import { ListView } from "./ListView";
import { StepDrawer } from "./StepDrawer";
import type { AiSpec } from "./AiDialog";
import { Modal, scrollBehavior } from "./ui";
import { DocHead, RIGOUR } from "./Governance";
import { Fact, LevelMark } from "./marks";
import { DraftLine, HistoryDialog, NotShown } from "./Editing";
import { SourceSkills } from "./SkillPanel";
import { createPrompt, modifyPrompt } from "../lib/prompt";
import type { Catalog, Standard } from "../types";

const BEFORE_KEY = "pm:map-before";

/**
 * The reader's page of a process. Nothing on it changes the process: whoever may change it gets
 * "Edit", which opens the editing screen; whoever looks after it also "Mark as reviewed".
 */
export function ProcessPage({ process, meta, all, standards, tab, item, onReviewed, feedback }: {
  process: Process; meta?: DocMeta; all: Process[]; standards: Standard[]; tab: Tab; feedback: Feedback[];
  /** The step that is open, from the address: a link can point at one step. */
  item?: string;
  /** Records that the version this page shows is still correct. */
  onReviewed: (base: number) => Promise<boolean>;
}) {
  const [history, setHistory] = useState(false);
  const [reporting, setReporting] = useState(false);
  // "Before you start" is open on the map unless the person closed it; the choice is remembered
  const [extras, setExtras] = useState(() => { try { return localStorage.getItem(BEFORE_KEY) !== "closed"; } catch { return true; } });
  const [flagging, setFlagging] = useState<string | null>(null); // the step reported from the map
  // arriving at the feedback tab (from a card's "Give feedback" or the button) puts the cursor in the form
  const [focusFeedback, setFocusFeedback] = useState(tab === "feedback");
  const perms = usePerms();
  // a process editor may change every process; a platform or practice owner what belongs to theirs
  const editor = canEdit(perms, "process", process);
  const manages = canManage(perms, "process", process);
  const me = useMe();
  const { done, toggle, reset } = useProgress(process.id);
  const doc = process;

  // A process that was stored broken cannot be drawn; it is repaired on the editing screen.
  const renderable = useMemo(() => isDrawableProcess(doc), [doc]);
  const view: Tab = tab === "json" ? "flow" : tab;
  // the open step is part of the address, so a link can point at it and Back closes it
  const stepsTab: Tab = view === "list" ? "list" : "flow"; // where a step is shown
  const [selected, setSelected] = useSelectedItem(item,
    (id) => ({ page: "process", id: process.id, tab: stepsTab, ...(id ? { item: id } : {}) }),
    (id) => !renderable || doc.steps.some((s) => s.id === id));
  const step = renderable ? doc.steps.find((s) => s.id === selected) : undefined;

  const select = (id: string) => { setSelected(id); setReporting(false); if (view === "flow") hint.seen(); };
  const hint = useMapHint(me.user?.email ?? "");
  const flagged = flagging ? doc.steps.find((s) => s.id === flagging) : undefined;
  // in the checklist the open step is brought into view, also when the page was opened by a link to it
  useEffect(() => {
    if (item && view === "list") document.getElementById(`step-${item}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }, [item, view]);
  const review = reviewOf(doc, meta);
  const status = statusOf(doc);
  const replacement = doc.replacedBy ? all.find((p) => p.id === doc.replacedBy) : undefined;
  const back = () => go({ page: "library" });
  const editHref = href({ page: "edit-process", id: process.id });
  // ticks are remembered by the prerequisite's title; ticks from before that were remembered by position
  const preKeys = renderable ? prerequisiteKeys(doc.prerequisites) : [];
  const hasPre = (i: number) => done.has(preKeys[i]) || done.has(`pre:${i}`);
  const tickPre = (i: number) => {
    if (!done.has(`pre:${i}`)) return toggle(preKeys[i]);
    toggle(`pre:${i}`);
    if (done.has(preKeys[i])) toggle(preKeys[i]);
  };

  const mine = renderable ? doc.steps.filter((s) => s.actor === "me").length : 0;
  const hasExtras = renderable && (doc.prerequisites.length > 0 || !!doc.resources?.length || !!doc.standards?.length);
  const readyCount = renderable ? doc.prerequisites.filter((_, i) => hasPre(i)).length : 0;

  if (!renderable) return <NotShown kind="process" title={doc.title || process.id} editHref={editor ? editHref : undefined} back={back}
    problems={validateProcess(doc).length} />;

  return (
    <div className={`page process-page ${step ? "with-drawer" : ""}`}>
      <DocHead kind="process" doc={doc} meta={meta} review={review} onBack={back} onHistory={() => setHistory(true)}
        facts={<>
          {doc.rigour && <span title={RIGOUR[doc.rigour]?.hint}><LevelMark level={doc.rigour} /></span>}
          {doc.estimatedDuration && <Fact icon={Clock3} label="Typical time" strong>{doc.estimatedDuration}</Fact>}
          <Fact icon={UserCheck} label="Steps" strong>{`${mine} of ${doc.steps.length} steps are yours`}</Fact>
          {doc.actors.length > 1 && <Fact icon={Users} label="Who else takes part">{`${doc.actors.length - 1} other ${doc.actors.length === 2 ? "party" : "parties"}`}</Fact>}
        </>}
        actions={<>
          {/* the review belongs to the team that owns the process, and to whoever may edit it */}
          {(editor || manages) && review.state !== "none" && status !== "draft" && <button className={`btn ${review.state === "soon" || review.state === "overdue" ? "review-due" : ""}`} onClick={() => onReviewed(meta?.version ?? 0)}
            title="Confirm that this process is still correct. Restarts the review interval."><CalendarCheck size={16} />Mark as reviewed</button>}
          {editor && <a className="btn" href={editHref}><Pencil size={16} />Edit</a>}
        </>}>
        {status !== "draft" && <DocEngagement kind="process" id={process.id} title={doc.title} summary={doc.summary}
          open={openCount(feedback)} resolvedHere={feedback.length - openCount(feedback)}
          onFeedback={() => { setFocusFeedback(true); go({ page: "process", id: process.id, tab: "feedback" }); }} />}
      </DocHead>

      <DraftLine meta={meta} status={status} editHref={editor ? editHref : undefined} noun="process" />

      <div className="tabs-row">
        <div className="tabs" role="tablist">
          {([["flow", "Map", Workflow], ["list", "Checklist", ListChecks], ["feedback", "Feedback", Flag], ["skills", "Skills", Bot]] as const).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={view === id} className={`tab ${view === id ? "on" : ""}`}
              onClick={() => go({ page: "process", id: process.id, tab: id, ...(selected && (id === "flow" || id === "list") ? { item: selected } : {}) })}><Icon size={16} />{label}{id === "feedback" && openCount(feedback) > 0 && <span className="tab-count">{openCount(feedback)}</span>}</button>
          ))}
        </div>
        {view === "flow" && hint.show && (
          <p className="map-hint"><MousePointerClick size={15} aria-hidden="true" /><span><b>Select a step</b> on the map to see what to do, who does it and with which tool.</span></p>
        )}
      </div>

      {status === "deprecated" && (
        <div className="check warn banner"><TriangleAlert size={16} /><span><b>This process is retired.</b>{" "}
          {replacement ? <>Use <a href={`#/p/${replacement.id}/flow`}>{replacement.title}</a> instead.</> : "It is kept for reference only."}</span></div>
      )}
      {(editor || manages) && review.state === "overdue" && (
        <div className="check bad banner"><CalendarCheck size={16} /><span><b>{review.label}.</b> Read it through{editor ? ", correct what changed on the editing screen," : ""} then press “Mark as reviewed”.</span></div>
      )}

      {(view === "flow" || view === "list") && hasExtras && (
        <BeforeYouStart process={doc} all={all} standards={standards} open={extras} hasPre={hasPre} tickPre={tickPre} readyCount={readyCount}
          onToggle={() => { const next = !extras; setExtras(next); try { localStorage.setItem(BEFORE_KEY, next ? "open" : "closed"); } catch { /* ignore */ } }} />
      )}
      {view === "flow" && <FlowView editable={false} follow process={doc} selectedId={selected} done={done} feedback={feedback} onSelect={select} onReport={setFlagging} />}
      {view === "list" && <ListView process={doc} all={all} done={done} toggle={toggle} reset={reset} selectedId={selected} onSelect={select}
        feedback={feedback} onReport={(id) => { setSelected(id); setReporting(true); }} />}
      {view === "feedback" && <FeedbackTab target={processTarget(doc)} feedback={feedback} onSelect={select} focus={focusFeedback} onFocused={() => setFocusFeedback(false)} />}
      {view === "skills" && <SourceSkills kind="process" id={process.id} revision={process} />}

      {step && (view === "flow" || view === "list") && (
        <StepDrawer process={doc} all={all} step={step} feedback={feedback} reporting={reporting} setReporting={setReporting}
          onClose={() => setSelected(null)} onSelect={select} />
      )}

      {flagged && (
        <Modal title="Report a problem with this step" subtitle={`Step ${doc.steps.indexOf(flagged) + 1}: ${flagged.title}`} onClose={() => setFlagging(null)}>
          <div className="step-report">
            <p className="muted">Tell the owner in a sentence. No ticket needed.</p>
            <FeedbackForm target={processTarget(doc)} itemId={flagged.id} autoFocus onDone={() => setTimeout(() => setFlagging(null), 1200)} />
          </div>
        </Modal>
      )}
      {history && <HistoryDialog<Process> kind="process" id={process.id} title={process.title} onClose={() => setHistory(false)} />}
    </div>
  );
}

/** What is needed before step 1, with ticks for the reader. Without `tickPre` it is a picture (the editing screen). */
export function PrereqGrid({ process, all, hasPre, tickPre, compact }: {
  process: Process; all: Process[]; hasPre?: (i: number) => boolean; tickPre?: (i: number) => void; compact?: boolean;
}) {
  const keys = prerequisiteKeys(process.prerequisites);
  return (
    <div className={`prereq-grid ${compact ? "compact" : ""}`}>
      {process.prerequisites.map((q, i) => {
        const src = q.processId ? all.find((p) => p.id === q.processId) : undefined;
        const on = !!hasPre?.(i);
        return (
          <div key={keys[i]} className={`prereq ${on ? "on" : ""}`} title={compact ? [q.title, q.description, q.processId && src ? `Don’t have it? ${src.title}` : ""].filter(Boolean).join("\n") : undefined}>
            {tickPre
              ? <button className={`tick ${on ? "on" : ""}`} onClick={() => tickPre(i)} aria-pressed={on} aria-label={`I have this: ${q.title}`}><Check size={14} strokeWidth={3} /></button>
              : <span className="tick" aria-hidden="true" />}
            <div>
              <strong>{q.title || "(no name yet)"}</strong>
              {q.description && !(compact && q.processId) && <p>{q.description}</p>}
              {q.url && <a href={q.url} target="_blank" rel="noreferrer">More information<ArrowUpRight size={13} /></a>}
              {q.processId && (
                <button className="prereq-link" onClick={() => src && go({ page: "process", id: src.id, tab: "flow" })} disabled={!src || !tickPre}>
                  <Workflow size={13} />{src ? <>Don’t have it? {src.title}</> : <>Process “{q.processId}” not described yet</>}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StandardLinks({ ids, standards }: { ids: string[]; standards: Standard[] }) {
  return (
    <ul className="link-list row">
      {ids.map((sid) => {
        const s = standards.find((x) => x.id === sid);
        return <li key={sid}>{s ? <a href={href({ page: "standard", id: s.id, tab: "doc" })}><ShieldCheck size={13} />{s.title}</a> : <span className="muted">“{sid}” is not described yet</span>}</li>;
      })}
    </ul>
  );
}

/**
 * "Before you start", the same compact panel on the map and on the checklist. Its first line: the
 * fold, then the ways to do it faster and the standards it helps to meet (always visible); folded
 * out, what is needed in one row of small items with ticks for the reader. Descriptions that do
 * not fit are the item's tooltip.
 */
export function BeforeYouStart({ process, all, standards, open, onToggle, hasPre, tickPre, readyCount }: {
  process: Process; all: Process[]; standards: Standard[]; open: boolean; onToggle: () => void;
  hasPre?: (i: number) => boolean; tickPre?: (i: number) => void; readyCount?: number;
}) {
  const pre = process.prerequisites;
  const res = [...(process.resources ?? [])].sort((a, b) => Number(b.kind === "skill") - Number(a.kind === "skill"));
  const links = (res.length > 0 || !!process.standards?.length) && (
    <div className="before-links">
      {res.length > 0 && <div className="before-group">
        <h3>Do it faster</h3>
        <ul className="before-chips">
          {res.map((r, i) => {
            const K = RESOURCE_KINDS[r.kind ?? "other"];
            return (
              <li key={i} className={r.kind === "skill" ? "skill" : ""}>
                <a href={r.url} target="_blank" rel="noreferrer" title={r.description ? `${K.label}: ${r.description}` : K.label}>
                  <K.icon size={14} aria-hidden="true" /><span className="sr-only">{K.label}: </span>{r.title}<ArrowUpRight size={13} aria-hidden="true" />
                </a>
              </li>
            );
          })}
        </ul>
      </div>}
      {!!process.standards?.length && <div className="before-group"><h3>Helps to meet</h3><StandardLinks ids={process.standards} standards={standards} /></div>}
    </div>
  );
  // with nothing needed there is nothing to fold: the links are the panel
  const foldable = pre.length > 0;
  return (
    <section className={`before-panel ${open && foldable ? "open" : ""}`} aria-label="Before you start">
      <div className="before-head">
        {foldable
          ? <button className="before-toggle" aria-expanded={open} aria-controls="before-body" onClick={onToggle}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <b>Before you start</b>
            <span className={readyCount === pre.length ? "all-ready" : ""}>{tickPre ? `${readyCount}/${pre.length} ready` : `${pre.length} needed`}</span>
            <em>{open ? "Hide" : "Show"}</em>
          </button>
          : <b className="before-title">Before you start</b>}
        {links}
      </div>
      {open && foldable && (
        <div id="before-body" className="before-body">
          <PrereqGrid compact process={process} all={all} hasPre={hasPre} tickPre={tickPre} />
        </div>
      )}
    </section>
  );
}

/**
 * The hint on the map that a step can be opened. It goes once the person has opened a step on a
 * map, remembered for that person in this browser.
 */
function useMapHint(who: string) {
  const key = `pm:map-hint-seen:${who}`;
  const [show, setShow] = useState(() => { try { return localStorage.getItem(key) !== "1"; } catch { return true; } });
  return {
    show,
    seen: () => { if (!show) return; setShow(false); try { localStorage.setItem(key, "1"); } catch { /* private mode */ } },
  };
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
