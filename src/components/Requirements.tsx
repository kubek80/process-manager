import { useEffect, useId, useState } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Eye, Flag, Plus, Trash2, Workflow, X } from "lucide-react";
import type { Feedback, Issue, Level, Process, Requirement, Severity, Standard, VerificationMethod } from "../types";
import { go } from "../lib/store";
import { standardTarget } from "./Feedback";
import { DimTags, DimsEditor } from "./Governance";
import { EditSection, FieldsHead, ItemFeedback, ItemIssues } from "./EditFrame";
import { Field } from "./ui";

export const LEVEL: Record<Level, { label: string; hint: string }> = {
  must: { label: "Must", hint: "Mandatory. Deviating needs an exception." },
  should: { label: "Should", hint: "Expected. Deviate only with a good reason." },
  may: { label: "May", hint: "Optional good practice." },
};
export const METHOD: Record<VerificationMethod, string> = { automated: "Checked automatically", review: "Checked in code review", manual: "Checked by a person" };
export const defaultSeverity = (l: Level): Severity => (l === "must" ? "blocker" : l === "should" ? "warning" : "info");

/**
 * One requirement as readers see it. On the reader's page it has a button to report a problem;
 * on the editing screen (`onSelect`) the whole card selects it for its fields.
 */
export function RequirementCard({ r, standard, processes, applies, flags, selected, onReport, onSelect }: {
  r: Requirement; standard: Standard; processes: Process[]; applies: boolean; flags: number; selected: boolean;
  onReport?: () => void; onSelect?: () => void;
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
    <li id={`req-${r.id}`} className={`req ${r.level} ${selected ? "selected" : ""} ${onSelect ? "selectable" : ""}`} onClick={onSelect}>
      <header className="req-head">
        <span className="req-id">{r.id}</span>
        <span className={`level ${r.level}`} title={LEVEL[r.level].hint}>{LEVEL[r.level].label}</span>
        <h3 className="req-title">{onSelect ? <button className="req-select" aria-pressed={selected} onClick={(e) => { e.stopPropagation(); onSelect(); }}>{r.title || "(no name yet)"}</button> : r.title}</h3>
        <span className="spacer" />
        {onReport
          ? <button className={`report ${flags ? "has" : ""}`} onClick={onReport} title={flags ? `${flags} open feedback` : "Something wrong or unclear? Tell us"}
              aria-label={`${flags ? `${flags} open feedback` : "Report a problem"} on ${r.id}`}><Flag size={14} />{flags || ""}</button>
          : flags > 0 && <span className="report has" title={`${flags} open feedback`}><Flag size={14} />{flags}</span>}
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
          <button className="prereq-link" disabled={!helper || !!onSelect} onClick={() => helper && go({ page: "process", id: helper.id, tab: "flow" })}>
            <Workflow size={13} />{helper ? <>How: {helper.title}</> : <>Process “{r.processId}” not described yet</>}
          </button>
        )}
        {r.review && (
          <button className="req-toggle" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-expanded={open}>
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

export function Rows({ label, hint, items, onChange, placeholder, code, line, max }: {
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

/** The fields of one requirement on the editing screen, directly editable: the rule first, the rest folded with a line saying what is set. */
export function RequirementFields({ r, standard, processes, feedback, issues, onChange, onRename, onDelete, onMove, onAddAfter }: {
  r: Requirement; standard: Standard; processes: Process[]; feedback: Feedback[]; issues: Issue[];
  onChange: (patch: Partial<Requirement>) => void; onRename: (id: string) => void; onDelete: () => void;
  /** Puts it before another requirement, or (null) at the end. */
  onMove: (before: string | null) => void; onAddAfter: () => void;
}) {
  const index = standard.requirements.findIndex((x) => x.id === r.id);
  const review = r.review ?? { lookFor: [] };
  const setReview = (patch: Partial<NonNullable<Requirement["review"]>>) => onChange({ review: { ...review, ...patch } });
  // a folded group opens by itself when the checker has something to say about a field in it
  const flagged = new Set(issues.map((i) => i.path.match(/^requirements\[\d+\]\.([A-Za-z]+)/)?.[1]).filter(Boolean) as string[]);
  const has = (...keys: string[]) => keys.some((k) => flagged.has(k));
  const good = r.examples?.good?.length ?? 0, bad = r.examples?.bad?.length ?? 0;
  const narrowed = !!(r.tiers?.length || r.languages?.length || r.environments?.length);
  const none = <span className="muted">Nothing yet</span>;
  return (
    <div className={`edit-fields-inner req-fields ${r.level}`}>
      <FieldsHead icon={<span className={`level big ${r.level}`}>{LEVEL[r.level].label}</span>}
        kicker={<><span className="who">{r.id}</span><span>Requirement {index + 1} of {standard.requirements.length}</span></>}
        title={r.title || "(no name yet)"}
        tools={<>
          <button className="btn small ghost" onClick={onAddAfter}><Plus size={14} />Add requirement after</button>
          <span className="spacer" />
          <span className="fields-move">
          {standard.requirements.length > 1 && (
            <select className="move-select" value="" aria-label="Move this requirement" title="Put this requirement somewhere else in the list"
              onChange={(e) => { const v = e.target.value; if (v) onMove(v === "__end" ? null : v); }}>
              <option value="">Move to…</option>
              {standard.requirements.map((x, i) => (x.id === r.id || standard.requirements[i - 1]?.id === r.id ? null
                : <option key={x.id} value={x.id}>Before {x.id} {x.title}</option>))}
              {index !== standard.requirements.length - 1 && <option value="__end">To the end</option>}
            </select>
          )}
          <button className="icon-btn danger" title="Delete requirement" aria-label="Delete requirement" disabled={standard.requirements.length === 1} onClick={onDelete}><Trash2 size={16} /></button>
          </span>
        </>} />
      <ItemIssues issues={issues} />
      <ItemFeedback feedback={feedback.filter((f) => f.itemId === r.id && !f.resolved)} target={standardTarget(standard)} noun="requirement" />
      <div className="step-core form">
        <div className="field">
          <span className="field-label">Level<em>{LEVEL[r.level].hint}</em></span>
          <div className="chips level-chips" role="group" aria-label="Level">
            {(Object.keys(LEVEL) as Level[]).map((l) => <button key={l} className={`chip lvl-${l} ${r.level === l ? "on" : ""}`} aria-pressed={r.level === l} title={LEVEL[l].hint} onClick={() => onChange({ level: l })}>{LEVEL[l].label}</button>)}
          </div>
        </div>
        <Field label="Short name" hint="A few words that name the rule"><input value={r.title} maxLength={80} onChange={(e) => onChange({ title: e.target.value })} /></Field>
        <Field label="The rule" hint="One or two sentences that can be checked"><textarea rows={3} maxLength={600} value={r.statement} onChange={(e) => onChange({ statement: e.target.value })} /></Field>
        <Field label="Why" hint="The risk it removes"><textarea rows={2} maxLength={600} value={r.rationale ?? ""} onChange={(e) => onChange({ rationale: e.target.value })} /></Field>
        <IdField id={r.id} taken={standard.requirements.filter((x) => x !== r).map((x) => x.id)} onRename={onRename} />
      </div>
      <EditSection title="How to comply">
        <Rows label="Steps to comply" hint="One action per item" items={r.guidance ?? []} onChange={(guidance) => onChange({ guidance })} placeholder="Use the logging library's redaction list." />
        <Field label="Process that helps to comply">
          <select value={r.processId ?? ""} onChange={(e) => onChange({ processId: e.target.value || undefined })}>
            <option value="">None</option>
            {processes.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      </EditSection>
      <EditSection title="Good and bad examples" folded={!has("examples")}
        summary={good || bad ? `${good} good, ${bad} bad` : none}>
        <Rows label="Good examples" items={r.examples?.good ?? []} onChange={(g) => onChange({ examples: { ...r.examples, good: g } })} placeholder="code or text that complies" code />
        <Rows label="Bad examples" items={r.examples?.bad ?? []} onChange={(b) => onChange({ examples: { ...r.examples, bad: b } })} placeholder="code or text that violates the rule" code />
      </EditSection>
      <EditSection title="How it is checked" folded={!has("verification")}
        summary={<>{METHOD[r.verification.method]}{r.verification.description ? ` · ${r.verification.description}` : ""}</>}>
        <div className="field">
          <span className="field-label">Checked</span>
          <div className="chips" role="group" aria-label="How it is checked">
            {(Object.keys(METHOD) as VerificationMethod[]).map((m) => (
              <button key={m} className={`chip ${r.verification.method === m ? "on" : ""}`} aria-pressed={r.verification.method === m} onClick={() => onChange({ verification: { ...r.verification, method: m } })}>{METHOD[m].replace("Checked ", "")}</button>
            ))}
          </div>
        </div>
        <Field label="By what"><input value={r.verification.description ?? ""} maxLength={300} placeholder="Secret scanner in the build pipeline" onChange={(e) => onChange({ verification: { ...r.verification, description: e.target.value } })} /></Field>
      </EditSection>
      <EditSection title="For reviewers" hint="Feeds the review agent that checks pull requests against this standard." folded={!has("review")}
        summary={review.lookFor.length
          ? `${review.lookFor.length} sign${review.lookFor.length === 1 ? "" : "s"} of a violation · ${review.paths?.length ? `${review.paths.length} file pattern${review.paths.length === 1 ? "" : "s"}` : "any file"} · ${review.severity ?? defaultSeverity(r.level)}`
          : <span className="muted">Not checked in pull requests</span>}>
        <Rows label="Signs of a violation in a pull request" hint="Leave empty if it cannot be seen in a change" items={review.lookFor} onChange={(lookFor) => setReview({ lookFor })}
          placeholder="A variable named like password or token passed to a log call" />
        <Rows line max={10} label="Files" hint="One pattern per row; leave empty for all files" items={review.paths ?? []} onChange={(paths) => setReview({ paths })} placeholder="**/*.{ts,tsx}" />
        <Field label="Report as">
          <select value={review.severity ?? ""} onChange={(e) => setReview({ severity: (e.target.value || undefined) as Severity | undefined })}>
            <option value="">Default for the level ({defaultSeverity(r.level)})</option>
            <option value="blocker">Blocker</option><option value="warning">Warning</option><option value="info">Info</option>
          </select>
        </Field>
      </EditSection>
      <EditSection title="Applies only to" hint="Narrower than the standard. Leave as it is when the requirement applies wherever the standard does." folded={!has("tiers", "languages", "environments")}
        summary={narrowed ? <DimTags doc={r} compact /> : <span className="muted">Wherever the standard applies</span>}>
        <DimsEditor narrow value={r} onChange={onChange} />
      </EditSection>
    </div>
  );
}
