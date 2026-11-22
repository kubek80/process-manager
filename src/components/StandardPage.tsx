import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Bot, CalendarCheck, Flag, ListChecks, Pencil, TriangleAlert, Workflow, X } from "lucide-react";
import type { DocMeta, Feedback, Level, Process, Requirement, Standard } from "../types";
import { platformName, practiceName, teamName, useCatalog } from "../lib/catalog";
import { ownerOfWords } from "../lib/editing";
import { appliesTo } from "../lib/edit";
import { useSelectedItem } from "../lib/selection";
import { useProfile } from "../lib/profile";
import { reviewOf, statusOf } from "../lib/lifecycle";
import { createStandardPrompt, modifyStandardPrompt } from "../lib/prompt";
import { canDraft, canEdit, canManage } from "../lib/rights";
import { usePerms } from "../lib/session";
import { go, href, type StandardTab } from "../lib/store";
import { isDrawableStandard, validateStandard } from "../lib/validate";
import type { AiSpec } from "./AiDialog";
import { FeedbackForm, FeedbackItem, FeedbackTab, openCount, standardTarget } from "./Feedback";
import { DocActions, DocEngagement } from "./Engage";
import { DocHead, PrintFoot, ProfileFilter } from "./Governance";
import { ACTIONS_ON_TABS, useMedia, usePrinting } from "../lib/media";
import { Fact, LevelBars, LevelMark } from "./marks";
import { DraftLine, HistoryDialog, NotShown } from "./Editing";
import { LEVEL, RequirementCard } from "./Requirements";
import { RESOURCE_KINDS } from "./Resources";
import { SourceSkills } from "./SkillPanel";
import { scrollBehavior, useLayer } from "./ui";

export { LEVEL } from "./Requirements";

/** Builds what the AI dialog needs for standards. */
export function standardAiSpec(current: Standard | undefined, all: Standard[], processes: Process[], catalog: ReturnType<typeof useCatalog>["catalog"]): AiSpec<Standard> {
  const known = processes.map((p) => ({ id: p.id, title: p.title }));
  return {
    noun: "standard", current, existingIds: all.map((s) => s.id),
    prompt: (text) => (current ? modifyStandardPrompt(current, text, catalog, known) : createStandardPrompt(text, catalog, known)),
    validate: (value) => validateStandard(value, { processIds: processes.map((p) => p.id), standardIds: [...all.map((s) => s.id), (value as Standard)?.id], catalog }),
    describe: (s) => `${s.requirements.length} requirements (${s.requirements.filter((r) => r.level === "must").length} must)`,
    describePlaceholder: "All services must write structured logs. Passwords and tokens must never appear in logs. In production, logs are shipped to the central platform…",
    changeExample: "Add a requirement that audit logs are kept for one year in production.",
  };
}

/** The side panel of the reader's page: one requirement, its open feedback and a form to report a problem. */
function RequirementDrawer({ r, standard, feedback, reporting, setReporting, onClose }: {
  r: Requirement; standard: Standard; feedback: Feedback[];
  reporting: boolean; setReporting: (b: boolean) => void; onClose: () => void;
}) {
  const target = standardTarget(standard);
  const mine = feedback.filter((f) => f.itemId === r.id && !f.resolved);
  const index = standard.requirements.findIndex((x) => x.id === r.id);
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  // a side panel, not a modal dialog: focus moves in and comes back, Escape closes, Tab is free
  useLayer(panel, onClose, { watch: r.id });
  return (
    <aside ref={panel} className={`drawer req-drawer ${r.level}`} role="dialog" aria-labelledby={titleId} tabIndex={-1}>
      <header className="drawer-head">
        <span className="req-drawer-level" title={LEVEL[r.level].hint}><LevelMark level={r.level} /></span>
        <div className="drawer-title">
          <span className="step-kicker"><span className="who">{r.id}</span><span>Requirement {index + 1} of {standard.requirements.length}</span></span>
          <h3 id={titleId}>{r.title}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="drawer-body">
        <p className="req-statement">{r.statement}</p>
        <section className="drawer-fb">
          {mine.length > 0 && <ul className="fb-list">{mine.map((f) => <FeedbackItem key={f.id} item={f} target={target} hideItem />)}</ul>}
          {reporting
            ? <><h4>What is wrong or unclear in {r.id}?</h4><FeedbackForm target={target} itemId={r.id} onDone={() => setReporting(false)} /></>
            : <button className="btn small report-btn" onClick={() => setReporting(true)} aria-label="Report a problem with this requirement"><Flag size={14} />Report a problem</button>}
        </section>
      </div>
    </aside>
  );
}

/**
 * The reader's page of a standard. Nothing on it changes the standard: whoever may change it gets
 * "Edit", which opens the editing screen; whoever looks after it also "Mark as reviewed".
 */
export function StandardPage({ standard, meta, all, processes, tab, item, feedback, onReviewed }: {
  standard: Standard; meta?: DocMeta; all: Standard[]; processes: Process[]; tab: StandardTab; feedback: Feedback[];
  /** The requirement that is open, from the address: a link can point at one requirement. */
  item?: string;
  /** Records that the version this page shows is still correct. */
  onReviewed: (base: number) => Promise<boolean>;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  // a standards editor may change every standard; a platform or practice owner what belongs to theirs
  const editor = canEdit(perms, "standard", standard);
  // "Edit" also for a member of its platform or practice: they save drafts there, an owner publishes
  const drafts = canDraft(perms, "standard", standard);
  const manages = canManage(perms, "standard", standard);
  const doc = standard;
  const [reporting, setReporting] = useState(false);
  const [history, setHistory] = useState(false);
  // arriving at the feedback tab (from a card's "Give feedback" or the button) puts the cursor in the form
  const [focusFeedback, setFocusFeedback] = useState(tab === "feedback");
  const [profile, setProfile] = useProfile();
  const [level, setLevel] = useState<Level | null>(null);
  const printing = usePrinting();
  const actionsOnTabs = useMedia(ACTIONS_ON_TABS);

  const renderable = useMemo(() => isDrawableStandard(doc), [doc]);
  // printed, a standard is its requirements, whatever tab is open
  const view: StandardTab = tab === "json" || printing ? "doc" : tab;
  // the open requirement is part of the address, so a link can point at it and Back closes it
  const [selected, setSelected] = useSelectedItem(item,
    (id) => ({ page: "standard", id: standard.id, tab: "doc", ...(id ? { item: id } : {}) }),
    (id) => !renderable || doc.requirements.some((r) => r.id === id));
  const current = renderable ? doc.requirements.find((r) => r.id === selected) : undefined;
  const target = useMemo(() => standardTarget(doc), [doc]);
  const status = statusOf(doc);
  const review = reviewOf(doc, meta);
  const replacement = doc.replacedBy ? all.find((s) => s.id === doc.replacedBy) : undefined;
  const helpers = processes.filter((p) => p.standards?.includes(doc.id) && statusOf(p) === "active");
  const editHref = href({ page: "edit-standard", id: standard.id });

  const select = (id: string) => { setSelected(id); setReporting(false); };
  // bring the open requirement into view, also when the page was opened by a link to it
  useEffect(() => {
    if (!item || view !== "doc") return;
    const t = setTimeout(() => document.getElementById(`req-${item}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "center" }), 50);
    return () => clearTimeout(t);
  }, [item, view]);
  const back = () => go({ page: "standards" });
  const giveFeedback = () => { setFocusFeedback(true); go({ page: "standard", id: standard.id, tab: "feedback" }); };

  if (!renderable) return <NotShown kind="standard" title={doc.title || standard.id} editHref={drafts ? editHref : undefined} back={back} problems={validateStandard(doc).length} />;

  // printed: every requirement, whatever the level chosen or the reader's application
  const shown = doc.requirements.filter((r) => printing || !level || r.level === level);
  const count = (l: Level) => doc.requirements.filter((r) => r.level === l && appliesTo(r, profile)).length;

  return (
    <div className={`page process-page standard-page ${current && !printing ? "with-drawer" : ""} ${printing ? "printing" : ""}`}>
      <DocHead kind="standard" doc={doc} meta={meta} review={review} onBack={back} onHistory={() => setHistory(true)}
        facts={<>
          <Fact icon={ListChecks} label="Requirements" strong>{`${doc.requirements.length} ${doc.requirements.length === 1 ? "requirement" : "requirements"}`}</Fact>
          {(Object.keys(LEVEL) as Level[]).map((l) => {
            const n = doc.requirements.filter((r) => r.level === l).length;
            return n > 0 && <span key={l} title={LEVEL[l].hint}><LevelMark level={l} count={n} /></span>;
          })}
        </>}
        notice={(status === "deprecated" || ((editor || manages) && review.state === "overdue")) && <>
          {status === "deprecated" && (
            <div className="check warn banner"><TriangleAlert size={16} /><span><b>This standard is retired.</b>{" "}
              {replacement ? <>Use <a className="kind-link standard" href={href({ page: "standard", id: replacement.id, tab: "doc" })}>{replacement.title}</a> instead.</> : "It is kept for reference only."}</span></div>
          )}
          {(editor || manages) && review.state === "overdue" && (
            <div className="check bad banner"><CalendarCheck size={16} /><span><b>{review.label}.</b> Read it through{editor ? ", correct what changed on the editing screen," : ""} then press “Mark as reviewed”.</span></div>
          )}
        </>}
        actions={<>
          {/* the review belongs to the team that issues the standard, and to whoever may edit it */}
          {(editor || manages) && review.state !== "none" && status !== "draft" && <button className={`btn ${review.state === "soon" || review.state === "overdue" ? "review-due" : "quiet"}`} onClick={() => onReviewed(meta?.version ?? 0)}
            title="Confirm that this standard is still correct. Restarts the review interval."><CalendarCheck size={16} />Mark as reviewed</button>}
          {drafts && <a className="btn primary" href={editHref}><Pencil size={16} />Edit</a>}
        </>}>
        {status !== "draft" && <DocEngagement kind="standard" id={standard.id} title={doc.title} summary={doc.summary} actions={!actionsOnTabs}
          open={openCount(feedback)} resolvedHere={feedback.length - openCount(feedback)} onFeedback={giveFeedback} />}
      </DocHead>

      <DraftLine meta={meta} status={status} editHref={drafts ? editHref : undefined} noun="standard"
        publisher={drafts && !editor ? ownerOfWords([standard.platform && platformName(catalog, standard.platform), standard.practice && practiceName(catalog, standard.practice)].filter((x): x is string => !!x)) : undefined} />

      <div className="tabs-row">
        <div className="tabs" role="tablist">
          {([["doc", "Requirements", ListChecks], ["feedback", "Feedback", Flag], ["skills", "Skills", Bot]] as const).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={view === id} className={`tab ${view === id ? "on" : ""}`}
              onClick={() => go({ page: "standard", id: standard.id, tab: id })}><Icon size={16} />{label}{id === "feedback" && openCount(feedback) > 0 && <span className="tab-count">{openCount(feedback)}</span>}</button>
          ))}
        </div>
        {actionsOnTabs && status !== "draft" && <DocActions kind="standard" id={standard.id} title={doc.title} summary={doc.summary} onFeedback={giveFeedback} />}
      </div>

      {view === "doc" && (
        <div className="standard-doc">
          <StandardIntro standard={doc} processes={processes} helpers={helpers} background />

          <div className="req-bar">
            <div className="seg level-seg" role="group" aria-label="Show requirements of level">
              <button className={`seg-item ${level === null ? "on" : ""}`} aria-pressed={level === null} onClick={() => setLevel(null)}>All<span className="seg-n">{doc.requirements.filter((r) => appliesTo(r, profile)).length}</span></button>
              {(Object.keys(LEVEL) as Level[]).map((l) => count(l) > 0 && (
                <button key={l} className={`seg-item ${level === l ? "on" : ""}`} aria-pressed={level === l} title={LEVEL[l].hint} onClick={() => setLevel(level === l ? null : l)}><LevelBars level={l} />{LEVEL[l].label}<span className="seg-n">{count(l)}</span></button>
              ))}
            </div>
            <ProfileFilter value={profile} onChange={setProfile} />
          </div>
          <ol className="reqs">
            {shown.map((r) => (
              <RequirementCard key={r.id} r={r} standard={doc} processes={processes} applies={printing || appliesTo(r, profile)} flags={openCount(feedback, r.id)}
                selected={selected === r.id && !printing}
                onReport={() => { setSelected(r.id); setReporting(true); }} />
            ))}
          </ol>
        </div>
      )}
      {printing && <PrintFoot doc={doc} meta={meta} />}
      {view === "feedback" && <FeedbackTab target={target} feedback={feedback} onSelect={select} focus={focusFeedback} onFocused={() => setFocusFeedback(false)} />}
      {view === "skills" && <SourceSkills kind="standard" id={standard.id} revision={standard} />}

      {current && view === "doc" && !printing && (
        <RequirementDrawer r={current} standard={doc} feedback={feedback} reporting={reporting} setReporting={setReporting}
          onClose={() => setSelected(null)} />
      )}
      {history && <HistoryDialog<Standard> kind="standard" id={standard.id} title={standard.title} onClose={() => setHistory(false)} />}
    </div>
  );
}

/**
 * Scope, exceptions, the processes that help and (on the reader's page) the background reading: the
 * top of a standard as one compact band of columns, for readers and on the editing screen.
 */
export function StandardIntro({ standard, processes, helpers, background }: { standard: Standard; processes: Process[]; helpers: Process[]; background?: boolean }) {
  const { catalog } = useCatalog();
  const exception = standard.exceptionProcessId ? processes.find((p) => p.id === standard.exceptionProcessId) : undefined;
  const reading = background ? [...(standard.resources ?? [])].sort((a, b) => Number(b.kind === "skill") - Number(a.kind === "skill")) : [];
  return (
    <section className="standard-intro" aria-label="About this standard">
      {standard.scope && <div className="intro-scope"><h2>Scope</h2><p>{standard.scope}</p></div>}
      <div className="intro-exceptions">
        <h2>Exceptions</h2>
        <p>A mandatory requirement can only be waived by {teamName(catalog, standard.owner)}.{" "}
          {exception ? <a className="kind-link process" href={href({ page: "process", id: exception.id, tab: "flow" })}><Workflow size={13} aria-hidden="true" />Follow “{exception.title}”</a>
            : standard.exceptionProcessId ? `The process “${standard.exceptionProcessId}” is not described yet.` : "Ask them directly."}</p>
      </div>
      {helpers.length > 0 && (
        <div className="intro-helpers"><h2>Processes that help</h2>
          <ul className="link-list">{helpers.map((p) => <li key={p.id}><a className="kind-link process" href={href({ page: "process", id: p.id, tab: "flow" })}><Workflow size={13} aria-hidden="true" />{p.title}</a></li>)}</ul>
        </div>
      )}
      {reading.length > 0 && (
        <div className="intro-reading"><h2>Background</h2>
          <ul className="reading-list">
            {reading.map((r, i) => {
              const K = RESOURCE_KINDS[r.kind ?? "other"];
              return (
                <li key={i} className={r.kind === "skill" ? "skill" : ""}>
                  <a href={r.url} target="_blank" rel="noreferrer" title={r.description ? `${K.label}: ${r.description}` : K.label}>
                    <K.icon size={14} aria-hidden="true" /><span><span className="sr-only">{K.label}: </span>{r.title}</span><ArrowUpRight size={13} aria-hidden="true" />
                  </a>
                  {r.description && <p>{r.description}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
