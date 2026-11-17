import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Bot, Braces, CalendarCheck, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Eye,
  Flag, ListChecks, Pencil, Plus, Settings2, ShieldCheck, Sparkles, Trash2, TriangleAlert, Workflow, X,
} from "lucide-react";
import type { DocMeta, Feedback, Level, Process, Requirement, Severity, Standard, VerificationMethod } from "../types";
import { teamName, useCatalog } from "../lib/catalog";
import { addRequirement, appliesTo, deleteRequirement, moveRequirement, tidyStandard, today, updateRequirement } from "../lib/edit";
import { useDraft } from "../lib/draft";
import { useSelectedItem } from "../lib/selection";
import { useProfile } from "../lib/profile";
import { reviewer, reviewInfo, statusOf, STATUS_LABEL } from "../lib/lifecycle";
import { useEditor } from "../lib/mode";
import { createStandardPrompt, modifyStandardPrompt } from "../lib/prompt";
import { canEdit, canManage } from "../lib/rights";
import { useMe, usePerms } from "../lib/session";
import { go, guardLeaving, href, type StandardTab } from "../lib/store";
import { isDrawableStandard, standardSchema, validateStandard } from "../lib/validate";
import type { AiSpec } from "./AiDialog";
import { FeedbackForm, FeedbackItem, FeedbackTab, openCount, standardTarget } from "./Feedback";
import { BelongsEditor, BelongsTags, DimsEditor, DimTags, LifecycleEditor, ProfileFilter, ReviewTag, useLosingWarning } from "./Governance";
import { BehindBanner, ConflictDialog, HistoryDialog, SaveBar, VersionTag } from "./Editing";
import { ResourceEditor, Resources } from "./Resources";
import { SourceSkills } from "./SkillPanel";
import { confirmDialog, Field, IssueList, Loading, Modal, notify, scrollBehavior, useLayer } from "./ui";

// the editor for the JSON tab and the AI dialog are loaded when they are first opened
const JsonView = lazy(() => import("./JsonView").then((m) => ({ default: m.JsonView }))) as typeof import("./JsonView").JsonView;
const AiDialog = lazy(() => import("./AiDialog").then((m) => ({ default: m.AiDialog }))) as typeof import("./AiDialog").AiDialog;

export const LEVEL: Record<Level, { label: string; hint: string }> = {
  must: { label: "Must", hint: "Mandatory. Deviating needs an exception." },
  should: { label: "Should", hint: "Expected. Deviate only with a good reason." },
  may: { label: "May", hint: "Optional good practice." },
};
const METHOD: Record<VerificationMethod, string> = { automated: "Checked automatically", review: "Checked in code review", manual: "Checked by a person" };
const defaultSeverity = (l: Level): Severity => (l === "must" ? "blocker" : l === "should" ? "warning" : "info");

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

function RequirementCard({ r, standard, processes, applies, flags, selected, editable, onEdit, onReport }: {
  r: Requirement; standard: Standard; processes: Process[]; applies: boolean; flags: number; selected: boolean; editable: boolean;
  onEdit: () => void; onReport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const helper = r.processId ? processes.find((p) => p.id === r.processId) : undefined;
  const narrowed = !!(r.tiers?.length || r.languages?.length || r.environments?.length);
  if (!applies) {
    return (
      <li id={`req-${r.id}`} className="req na">
        <span className="req-id">{r.id}</span><span className="req-title">{r.title}</span>
        <span className="req-na">Does not apply to your application</span>
      </li>
    );
  }
  return (
    <li id={`req-${r.id}`} className={`req ${r.level} ${selected ? "selected" : ""}`}>
      <header className="req-head">
        <span className="req-id">{r.id}</span>
        <span className={`level ${r.level}`} title={LEVEL[r.level].hint}>{LEVEL[r.level].label}</span>
        <h3 className="req-title">{r.title}</h3>
        <span className="spacer" />
        <button className={`report ${flags ? "has" : ""}`} onClick={onReport} title={flags ? `${flags} open feedback` : "Something wrong or unclear? Tell us"}
          aria-label={`${flags ? `${flags} open feedback` : "Report a problem"} on ${r.id}`}><Flag size={14} />{flags || ""}</button>
        {editable && <button className="icon-btn" onClick={onEdit} aria-label={`Edit ${r.id}`}><Pencil size={15} /></button>}
      </header>
      <p className="req-statement">{r.statement}</p>
      {r.rationale && <p className="req-why"><b>Why</b> {r.rationale}</p>}
      {!!r.guidance?.length && (
        <div className="req-block"><b>How to comply</b>
          <ul>{r.guidance.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
      )}
      {(!!r.examples?.good?.length || !!r.examples?.bad?.length) && (
        <div className="req-examples">
          {r.examples?.good?.map((e, i) => <figure key={`g${i}`} className="good"><figcaption><Check size={12} strokeWidth={3} />Good</figcaption><pre>{e}</pre></figure>)}
          {r.examples?.bad?.map((e, i) => <figure key={`b${i}`} className="bad"><figcaption><X size={12} strokeWidth={3} />Bad</figcaption><pre>{e}</pre></figure>)}
        </div>
      )}
      <footer className="req-foot">
        <span className={`req-check ${r.verification.method}`} title={r.verification.description}>
          {r.verification.method === "automated" ? <Bot size={13} /> : <Eye size={13} />}{METHOD[r.verification.method]}{r.verification.description && <em>{r.verification.description}</em>}
        </span>
        {narrowed && <span className="req-only">Only for <DimTags doc={r} compact /></span>}
        {r.processId && (
          <button className="prereq-link" disabled={!helper} onClick={() => helper && go({ page: "process", id: helper.id, tab: "flow" })}>
            <Workflow size={13} />{helper ? <>How: {helper.title}</> : <>Process “{r.processId}” not described yet</>}
          </button>
        )}
        {r.review && (
          <button className="req-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}What reviewers look for
          </button>
        )}
      </footer>
      {open && r.review && (
        <div className="req-review">
          <ul>{r.review.lookFor.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="muted small">Reported as <b>{r.review.severity ?? defaultSeverity(r.level)}</b>{r.review.paths?.length ? <> in <code>{r.review.paths.join("  ")}</code></> : " in any changed file"}. The review agent generated from “{standard.title}” checks exactly this.</p>
        </div>
      )}
    </li>
  );
}

function Rows({ label, hint, items, onChange, placeholder, code, line, max }: {
  label: string; hint?: string; items: string[]; onChange: (v: string[]) => void; placeholder: string; code?: boolean;
  /** one short line per item instead of a text box */ line?: boolean; max?: number;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}{hint && <em>{hint}</em>}</span>
      <div className="rows">
        {items.map((v, i) => (
          <div className="row" key={i}>
            {line
              ? <input className="mono" value={v} placeholder={placeholder} autoFocus={v === ""} aria-label={`${label} ${i + 1}`} maxLength={100}
                  onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
              : <textarea rows={code ? 3 : 2} className={code ? "mono" : ""} value={v} placeholder={placeholder} autoFocus={v === ""} aria-label={`${label} ${i + 1}`}
                  onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />}
            <button className="icon-btn" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label} ${i + 1}`}><X size={15} /></button>
          </div>
        ))}
        {(max === undefined || items.length < max) && <button className="btn small ghost" onClick={() => onChange([...items, ""])}><Plus size={14} />Add</button>}
      </div>
    </div>
  );
}

const REQUIREMENT_ID = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;

/**
 * The id of a requirement is typed freely and only taken over when the field is left or Enter is
 * pressed: on the way from SEC-LOG-07 to SEC-LOG-10 the text passes through ids that already exist.
 */
function IdField({ id, taken, onRename }: { id: string; taken: string[]; onRename: (id: string) => void }) {
  const [value, setValue] = useState(id);
  const [error, setError] = useState("");
  const errorId = useId();
  useEffect(() => { setValue(id); setError(""); }, [id]);
  const commit = () => {
    const next = value.trim().toUpperCase();
    if (next === id) { setValue(id); return setError(""); }
    if (!REQUIREMENT_ID.test(next) || next.length > 30) return setError(`“${next}” cannot be used. An id is capital letters and digits in groups joined by dashes, like SEC-LOG-07. The requirement keeps ${id}.`);
    if (taken.includes(next)) return setError(`${next} is already the id of another requirement. This one keeps ${id}.`);
    setError(""); onRename(next);
  };
  return (
    <label className="field">
      <span className="field-label">Id<em>cited by people and tools</em></span>
      <input value={value} maxLength={30} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        onChange={(e) => { setValue(e.target.value.toUpperCase()); setError(""); }} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
      {error && <span className="field-error" role="alert" id={errorId}>{error}</span>}
    </label>
  );
}

function RequirementDrawer({ r, standard, processes, feedback, editing, editable, reporting, setReporting, onChange, onRename, onClose, onDelete, onMove }: {
  r: Requirement; standard: Standard; processes: Process[]; feedback: Feedback[]; editing: boolean; editable: boolean;
  reporting: boolean; setReporting: (b: boolean) => void;
  onChange: (patch: Partial<Requirement>) => void; onRename: (id: string) => void; onClose: () => void; onDelete: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const target = standardTarget(standard);
  const mine = feedback.filter((f) => f.itemId === r.id && !f.resolved);
  const index = standard.requirements.findIndex((x) => x.id === r.id);
  const review = r.review ?? { lookFor: [] };
  const setReview = (patch: Partial<NonNullable<Requirement["review"]>>) => onChange({ review: { ...review, ...patch } });
  const panel = useRef<HTMLElement>(null);
  const titleId = useId();
  // a side panel, not a modal dialog: focus moves in and comes back, Escape closes, Tab is free
  useLayer(panel, onClose, { watch: r.id });
  return (
    <aside ref={panel} className={`drawer req-drawer ${r.level}`} role="dialog" aria-labelledby={titleId} tabIndex={-1}>
      <header className="drawer-head">
        <span className={`level big ${r.level}`}>{LEVEL[r.level].label}</span>
        <div className="drawer-title">
          <span className="step-kicker"><span className="who">{r.id}</span><span>Requirement {index + 1} of {standard.requirements.length}</span></span>
          <h3 id={titleId}>{r.title}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      {editable && editing && (
        <div className="drawer-tools">
          <span className="muted small">Changes go into the draft</span>
          <span className="spacer" />
          <button className="icon-btn" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={16} /></button>
          <button className="icon-btn" title="Move down" aria-label="Move down" disabled={index === standard.requirements.length - 1} onClick={() => onMove(1)}><ArrowDown size={16} /></button>
          <button className="icon-btn danger" title="Delete requirement" aria-label="Delete requirement" disabled={standard.requirements.length === 1} onClick={onDelete}><Trash2 size={16} /></button>
        </div>
      )}

      {!editing || !editable ? (
        <div className="drawer-body">
          <p className="req-statement">{r.statement}</p>
          <section className="drawer-fb">
            {mine.length > 0 && <ul className="fb-list">{mine.map((f) => <FeedbackItem key={f.id} item={f} target={target} hideItem />)}</ul>}
            {reporting
              ? <><h4>What is wrong or unclear in {r.id}?</h4><FeedbackForm target={target} itemId={r.id} onDone={() => setReporting(false)} /></>
              : <button className="btn small report-btn" onClick={() => setReporting(true)}><Flag size={14} />Report a problem with this requirement</button>}
          </section>
        </div>
      ) : (
        <div className="drawer-body form">
          <div className="grid2">
            <IdField id={r.id} taken={standard.requirements.filter((x) => x !== r).map((x) => x.id)} onRename={onRename} />
            <div className="field">
              <span className="field-label">Level</span>
              <div className="chips" role="group" aria-label="Level">
                {(Object.keys(LEVEL) as Level[]).map((l) => <button key={l} className={`chip ${r.level === l ? "on" : ""}`} aria-pressed={r.level === l} title={LEVEL[l].hint} onClick={() => onChange({ level: l })}>{LEVEL[l].label}</button>)}
              </div>
            </div>
          </div>
          <Field label="Short name"><input value={r.title} maxLength={80} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="The rule" hint="one testable sentence or two"><textarea rows={3} maxLength={600} value={r.statement} onChange={(e) => onChange({ statement: e.target.value })} /></Field>
          <Field label="Why" hint="the risk it removes"><textarea rows={2} maxLength={600} value={r.rationale ?? ""} onChange={(e) => onChange({ rationale: e.target.value })} /></Field>
          <Rows label="How to comply" hint="one action per item" items={r.guidance ?? []} onChange={(guidance) => onChange({ guidance })} placeholder="Use the logging library's redaction list." />
          <Rows label="Good examples" items={r.examples?.good ?? []} onChange={(good) => onChange({ examples: { ...r.examples, good } })} placeholder="code or text that complies" code />
          <Rows label="Bad examples" items={r.examples?.bad ?? []} onChange={(bad) => onChange({ examples: { ...r.examples, bad } })} placeholder="code or text that violates the rule" code />

          <div className="field">
            <span className="field-label">How it is checked</span>
            <div className="chips" role="group" aria-label="How it is checked">
              {(Object.keys(METHOD) as VerificationMethod[]).map((m) => (
                <button key={m} className={`chip ${r.verification.method === m ? "on" : ""}`} aria-pressed={r.verification.method === m} onClick={() => onChange({ verification: { ...r.verification, method: m } })}>{METHOD[m].replace("Checked ", "")}</button>
              ))}
            </div>
          </div>
          <Field label="By what"><input value={r.verification.description ?? ""} maxLength={300} placeholder="Secret scanner in the build pipeline" onChange={(e) => onChange({ verification: { ...r.verification, description: e.target.value } })} /></Field>

          <h4>For reviewers <span className="muted">feeds the review agent</span></h4>
          <Rows label="Signs of a violation in a pull request" hint="leave empty if it cannot be seen in a change" items={review.lookFor} onChange={(lookFor) => setReview({ lookFor })}
            placeholder="A variable named like password or token passed to a log call" />
          <Rows line max={10} label="Files" hint="one pattern per row; leave empty for all files" items={review.paths ?? []} onChange={(paths) => setReview({ paths })} placeholder="**/*.{ts,tsx}" />
          <Field label="Report as">
            <select value={review.severity ?? ""} onChange={(e) => setReview({ severity: (e.target.value || undefined) as Severity | undefined })}>
              <option value="">Default for the level ({defaultSeverity(r.level)})</option>
              <option value="blocker">Blocker</option><option value="warning">Warning</option><option value="info">Info</option>
            </select>
          </Field>

          <h4>Applies only to <span className="muted">narrower than the standard</span></h4>
          <DimsEditor narrow value={r} onChange={onChange} />
          <Field label="Process that helps to comply">
            <select value={r.processId ?? ""} onChange={(e) => onChange({ processId: e.target.value || undefined })}>
              <option value="">None</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
        </div>
      )}
    </aside>
  );
}

function StandardSettings({ standard, saved, all, processes, onChange, onClose, onDelete }: {
  standard: Standard;
  /** The standard as it was saved: whether the person may change it comes from what it belongs to there. */
  saved: Standard;
  all: Standard[]; processes: Process[]; onChange: (s: Standard) => void; onClose: () => void; onDelete: () => void;
}) {
  const { catalog } = useCatalog();
  const set = (patch: Partial<Standard>) => onChange({ ...standard, ...patch });
  return (
    <Modal wide title="Standard details" subtitle="Changes are applied to the draft. Press Save on the page to publish them." onClose={onClose}
      footer={<><button className="btn danger" onClick={onDelete}><Trash2 size={15} />Delete standard</button><span className="spacer" /><button className="btn primary" onClick={onClose}>Done</button></>}>
      <div className="form">
        <h4>About</h4>
        <Field label="Name"><input value={standard.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Summary" hint="what it protects or achieves"><textarea rows={2} maxLength={400} value={standard.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Issued by" hint="the team that reviews it and answers feedback">
            <select value={standard.owner} onChange={(e) => set({ owner: e.target.value })}>
              {catalog.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              {!catalog.teams.some((t) => t.id === standard.owner) && <option value={standard.owner}>{standard.owner} (not in the list)</option>}
            </select>
          </Field>
          <Field label="Tags" hint="comma separated">
            <input value={(standard.tags ?? []).join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trimStart().slice(0, 30)).slice(0, 12) })} />
          </Field>
        </div>
        <Field label="Scope" hint="what it covers and what it does not"><textarea rows={2} maxLength={400} value={standard.scope ?? ""} onChange={(e) => set({ scope: e.target.value })} /></Field>

        <h4>What it belongs to <span className="muted">how readers find it, and who besides the editors may change it</span></h4>
        <BelongsEditor kind="standard" doc={standard} saved={saved} onChange={set} />

        <h4>Where it applies <span className="muted">a requirement can narrow this further</span></h4>
        <DimsEditor value={standard} onChange={set} />

        <h4>Life-cycle <span className="muted">who sees it and how often the owner team reviews it</span></h4>
        <LifecycleEditor doc={standard} others={all} onChange={set} />

        <h4>Exceptions and background</h4>
        <Field label="How to ask for an exception">
          <select value={standard.exceptionProcessId ?? ""} onChange={(e) => set({ exceptionProcessId: e.target.value || undefined })}>
            <option value="">Ask the team directly</option>
            {processes.map((p) => <option key={p.id} value={p.id}>Process: {p.title}</option>)}
          </select>
        </Field>
        <ResourceEditor list={standard.resources ?? []} onChange={(resources) => set({ resources })} />
      </div>
    </Modal>
  );
}

const stamp = (s: Standard): Standard => ({ ...s, updatedAt: today() });

export function StandardPage({ standard, meta, all, processes, tab, item, feedback, onSave, onReload, onDelete, onReviewed }: {
  standard: Standard; meta?: DocMeta; all: Standard[]; processes: Process[]; tab: StandardTab; feedback: Feedback[];
  /** The requirement that is open, from the address: a link can point at one requirement. */
  item?: string;
  /** Saves on top of version `base`; resolves to the new version. */
  onSave: (s: Standard, base: number, note?: string) => Promise<number>;
  onReload: () => Promise<{ saved: Standard; version: number } | null>;
  /** Deletes the version this page shows; refused when somebody else changed it since. */
  onDelete: (base: number) => void;
  /** Records that the version this page shows is still correct. */
  onReviewed: (base: number) => Promise<boolean>;
}) {
  const { catalog } = useCatalog();
  const me = useMe();
  const perms = usePerms();
  // a standards editor may change every standard; a platform or practice owner what belongs to theirs
  const editor = useEditor() && canEdit(perms, "standard", standard);
  const manages = canManage(perms, "standard", standard);
  const d = useDraft<Standard>({ docKey: `standard/${standard.id}`, saved: standard, version: meta?.version ?? 0, tidy: tidyStandard, stamp, save: onSave, reload: onReload, what: "this standard", editable: editor });
  const { draft, clean, dirty } = d;
  const setDraft = d.change;
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [dialog, setDialog] = useState<null | "settings" | "ai" | "history">(null);
  const [showIssues, setShowIssues] = useState(false);
  const [jsonPending, setJsonPending] = useState(false);
  const [profile, setProfile] = useProfile();
  const [level, setLevel] = useState<Level | null>(null);

  useEffect(() => { if (!editor) { setEditing(false); setDialog((x) => (x === "settings" || x === "ai" ? null : x)); } }, [editor]);
  useEffect(() => { if (d.error) { notify.error("The standard could not be saved.", d.error); d.clearError(); } }, [d.error]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (jsonPending ? guardLeaving(`standard/${standard.id}#json`, "the JSON of this standard (it still has problems, so it is not part of the draft)") : undefined), [jsonPending, standard.id]);

  const ctx = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: all.map((s) => s.id), catalog }), [processes, all, catalog]);
  const issues = useMemo(() => validateStandard(clean, ctx), [clean, ctx]);
  const errors = issues.filter((i) => i.level === "error").length;
  const losing = useLosingWarning("standard", d.saved, draft);
  const renderable = useMemo(() => isDrawableStandard(draft), [draft]);
  const view: StandardTab = !renderable ? "json" : tab === "json" && !editor ? "doc" : tab;
  // the open requirement is part of the address, so a link can point at it and Back closes it
  const [selected, setSelected] = useSelectedItem(item,
    (id) => ({ page: "standard", id: standard.id, tab: "doc", ...(id ? { item: id } : {}) }),
    (id) => !renderable || draft.requirements.some((r) => r.id === id));
  const current = renderable ? draft.requirements.find((r) => r.id === selected) : undefined;
  const target = useMemo(() => standardTarget(draft), [draft]);
  const status = statusOf(draft);
  const review = reviewInfo(draft);
  const replacement = draft.replacedBy ? all.find((s) => s.id === draft.replacedBy) : undefined;
  const exception = draft.exceptionProcessId ? processes.find((p) => p.id === draft.exceptionProcessId) : undefined;
  const helpers = processes.filter((p) => p.standards?.includes(draft.id) && statusOf(p) === "active");

  const select = (id: string) => { setSelected(id); setReporting(false); };
  useEffect(() => { if (!selected) setEditing(false); }, [selected]); // a requirement opened later starts as it is read
  const blocked = losing ? "Keep it with a platform or practice of yours (in Details)." : errors ? "Fix the problems first." : jsonPending ? "The JSON tab has changes with problems. Fix them there first." : undefined;
  // bring the open requirement into view, also when the page was opened by a link to it
  useEffect(() => {
    if (!item || view !== "doc") return;
    const t = setTimeout(() => document.getElementById(`req-${item}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "center" }), 50);
    return () => clearTimeout(t);
  }, [item, view]);
  const markReviewed = async () => {
    const who = reviewer(me.user?.name);
    const next = { ...draft, review: { intervalMonths: draft.review?.intervalMonths ?? 12, lastReviewedAt: today(), ...(who ? { reviewedBy: who } : {}) } };
    // With other changes pending - in whichever mode they were made - the review becomes part
    // of them. A pure "still correct" is recorded straight away.
    if (dirty || (editor && errors)) return setDraft(next);
    await onReviewed(d.base);
  };
  const add = () => { const r = addRequirement(draft, selected ?? undefined); setDraft(r.standard); setSelected(r.id); setEditing(true); };
  const back = () => go({ page: "standards" }); // leaving with unsaved changes asks first, like every other way out

  const shown = renderable ? draft.requirements.filter((r) => !level || r.level === level) : [];
  const count = (l: Level) => (renderable ? draft.requirements.filter((r) => r.level === l && appliesTo(r, profile)).length : 0);

  return (
    <div className={`page process-page standard-page ${current ? "with-drawer" : ""}`}>
      <div className="process-head">
        <button className="back" onClick={back}><ArrowLeft size={16} />All standards</button>
        <div className="head-row">
          <div className="head-text">
            <div className="eyebrow"><ShieldCheck size={13} /> Standard · issued by {teamName(catalog, draft.owner)}</div>
            <h1>{draft.title}</h1>
            <p className="lead">{draft.summary}</p>
            {renderable && (
              <div className="facts">
                {status !== "active" && <span className={`tier-tag status-${status}`}>{STATUS_LABEL[status]}</span>}
                <BelongsTags doc={draft} />
                <DimTags doc={draft} />
                <span><ListChecks size={14} />{draft.requirements.length} requirements, {draft.requirements.filter((r) => r.level === "must").length} mandatory</span>
                {draft.updatedAt && <span>Updated {draft.updatedAt}</span>}
                <ReviewTag doc={draft} />
                <VersionTag meta={meta} onOpen={() => setDialog("history")} />
              </div>
            )}
          </div>
          <div className="head-actions">
            {/* the review belongs to the team that issues the standard, and to whoever may edit it */}
            {(editor || manages) && review.state !== "none" && <button className={`btn ${review.state === "ok" ? "" : "review-due"}`} onClick={markReviewed} disabled={!renderable}
              title="Confirm that this standard is still correct. Restarts the review interval."><CalendarCheck size={16} />Mark as reviewed</button>}
            {editor && <>
              <button className="btn accent-soft" onClick={() => setDialog("ai")} disabled={!renderable}><Sparkles size={16} />Change with AI</button>
              <button className="btn" onClick={() => setDialog("settings")} disabled={!renderable}><Settings2 size={16} />Details</button>
              <button className="btn" onClick={add} disabled={!renderable}><Plus size={16} />Add requirement</button>
            </>}
            <button className="btn report-btn" onClick={() => go({ page: "standard", id: standard.id, tab: "feedback" })} disabled={!renderable}><Flag size={16} />Report a problem</button>
          </div>
        </div>
      </div>

      <div className="tabs-row">
        <div className="tabs" role="tablist">
          {([["doc", "Requirements", ListChecks], ["feedback", "Feedback", Flag], ["skills", "Skills", Bot], ["json", "JSON", Braces]] as const).filter(([id]) => editor || id !== "json").map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} disabled={!renderable && id !== "json"}
              onClick={() => go({ page: "standard", id: standard.id, tab: id })}><Icon size={16} />{label}{id === "feedback" && openCount(feedback) > 0 && <span className="tab-count">{openCount(feedback)}</span>}</button>
          ))}
        </div>
        <span className="spacer" />
        {editor && <button className={`status ${errors ? "bad" : issues.length ? "warn" : "good"}`} onClick={() => setShowIssues(!showIssues)} disabled={!issues.length}>
          {errors ? <CircleAlert size={15} /> : issues.length ? <TriangleAlert size={15} /> : <CircleCheck size={15} />}
          {errors ? `${errors} problem${errors > 1 ? "s" : ""}` : issues.length ? `${issues.length} hint${issues.length > 1 ? "s" : ""}` : "No problems"}
        </button>}
        <SaveBar d={d} editor={editor} blocked={blocked} />
      </div>
      <BehindBanner d={d} meta={meta} noun="this standard" />
      {showIssues && issues.length > 0 && <div className="issues-panel"><IssueList issues={issues} /></div>}

      {status === "deprecated" && renderable && (
        <div className="check warn banner"><TriangleAlert size={16} /><span><b>This standard is retired.</b>{" "}
          {replacement ? <>Use <a href={href({ page: "standard", id: replacement.id, tab: "doc" })}>{replacement.title}</a> instead.</> : "It is kept for reference only."}</span></div>
      )}
      {status === "draft" && renderable && (
        <div className="check warn banner"><TriangleAlert size={16} /><span><b>Draft.</b> Consumers do not see this standard, and no skill is generated, until its status is set to Active in Details.</span></div>
      )}
      {editor && losing && renderable && (
        <div className="check warn banner" role="alert"><TriangleAlert size={16} /><span>{losing}</span></div>
      )}
      {(editor || manages) && review.state === "overdue" && renderable && (
        <div className="check bad banner"><CalendarCheck size={16} /><span><b>{review.label}.</b> Read it through, correct what changed, then press “Mark as reviewed”.</span></div>
      )}

      {view === "doc" && renderable && (
        <div className="standard-doc">
          <section className="standard-intro">
            {draft.scope && <div><h2>Scope</h2><p>{draft.scope}</p></div>}
            <div>
              <h2>Exceptions</h2>
              <p>A mandatory requirement can only be waived by {teamName(catalog, draft.owner)}.{" "}
                {exception ? <a href={href({ page: "process", id: exception.id, tab: "flow" })}>Follow “{exception.title}”<ArrowUpRight size={13} /></a>
                  : draft.exceptionProcessId ? `The process “${draft.exceptionProcessId}” is not described yet.` : "Ask them directly."}</p>
            </div>
            {helpers.length > 0 && (
              <div><h2>Processes that help</h2>
                <ul className="link-list">{helpers.map((p) => <li key={p.id}><a href={href({ page: "process", id: p.id, tab: "flow" })}><Workflow size={13} />{p.title}</a></li>)}</ul>
              </div>
            )}
          </section>
          {!!draft.resources?.length && <section className="prereqs"><h2>Background</h2><Resources list={draft.resources} /></section>}

          <div className="req-bar">
            <div className="chips" role="group" aria-label="Show requirements of level">
              <button className={`chip ${level === null ? "on" : ""}`} aria-pressed={level === null} onClick={() => setLevel(null)}>All<span>{draft.requirements.filter((r) => appliesTo(r, profile)).length}</span></button>
              {(Object.keys(LEVEL) as Level[]).map((l) => count(l) > 0 && (
                <button key={l} className={`chip ${level === l ? "on" : ""}`} aria-pressed={level === l} title={LEVEL[l].hint} onClick={() => setLevel(level === l ? null : l)}>{LEVEL[l].label}<span>{count(l)}</span></button>
              ))}
            </div>
            <ProfileFilter value={profile} onChange={setProfile} />
          </div>
          <ol className="reqs">
            {shown.map((r) => (
              <RequirementCard key={r.id} r={r} standard={draft} processes={processes} applies={appliesTo(r, profile)} flags={openCount(feedback, r.id)}
                selected={selected === r.id} editable={editor}
                onEdit={() => { setSelected(r.id); setEditing(true); setReporting(false); }}
                onReport={() => { setSelected(r.id); setEditing(false); setReporting(true); }} />
            ))}
          </ol>
        </div>
      )}
      {view === "feedback" && renderable && <FeedbackTab target={target} feedback={feedback} onSelect={select} />}
      {view === "skills" && renderable && <SourceSkills kind="standard" id={standard.id} revision={standard} />}
      {view === "json" && <Suspense fallback={<Loading />}><JsonView doc={clean} noun="standard" validate={(v) => validateStandard(v, ctx)} schema={standardSchema} schemaFile="schema/standard.schema.json" onChange={setDraft} onPending={setJsonPending} /></Suspense>}

      {current && view === "doc" && (
        <RequirementDrawer r={current} standard={draft} processes={processes} feedback={feedback} editing={editing} editable={editor}
          reporting={reporting} setReporting={setReporting}
          onChange={(patch) => setDraft(updateRequirement(draft, current.id, patch))}
          onRename={(id) => { if (!draft.requirements.some((x) => x.id === id && x !== current)) { setDraft(updateRequirement(draft, current.id, { id })); setSelected(id); } }}
          onClose={() => { setSelected(null); setEditing(false); }}
          onDelete={async () => {
            if (!await confirmDialog({ title: `Delete ${current.id}?`, body: <>The requirement “{current.title}” is removed from the draft. Nothing is final until you save.</>, confirmLabel: "Delete requirement", danger: true })) return;
            setDraft((s) => deleteRequirement(s, current.id)); setSelected(null);
          }}
          onMove={(dir) => setDraft(moveRequirement(draft, current.id, dir))} />
      )}

      {dialog === "settings" && (
        <StandardSettings standard={draft} saved={d.saved} all={all} processes={processes} onChange={setDraft} onClose={() => setDialog(null)}
          onDelete={async () => {
            if (await confirmDialog({ title: "Delete this standard?", body: <>“{standard.title}” is removed for everyone. Its skills are withdrawn and its feedback is removed.</>, confirmLabel: "Delete standard", danger: true })) onDelete(d.base);
          }} />
      )}
      {dialog === "ai" && (
        <Suspense fallback={null}>
          <AiDialog spec={standardAiSpec(clean, all, processes, catalog)} onClose={() => setDialog(null)} onImport={(s) => { setDraft(s); setSelected(null); setDialog(null); }} />
        </Suspense>
      )}
      {dialog === "history" && <HistoryDialog<Standard> kind="standard" id={standard.id} title={standard.title} onClose={() => setDialog(null)}
        onRestore={editor ? (doc) => { setDraft(doc); setDialog(null); } : undefined} />}
      <ConflictDialog d={d} kind="standard" id={standard.id} noun="this standard" blocked={blocked} />
    </div>
  );
}
