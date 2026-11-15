import { useState } from "react";
import { Check, CircleCheck, Flag, History, RotateCcw, ThumbsUp, Trash2 } from "lucide-react";
import type { Feedback, FeedbackKind, Process } from "../types";
import { useFeedbackActions } from "../lib/session";

export const FEEDBACK_KINDS: Record<FeedbackKind, { label: string; hint: string }> = {
  broken: { label: "Doesn’t work", hint: "I followed it and it failed" },
  outdated: { label: "Out of date", hint: "It has changed since this was written" },
  unclear: { label: "Unclear", hint: "I don’t understand what to do" },
  idea: { label: "Suggestion", hint: "It could be easier" },
};

export const openCount = (list: Feedback[] = [], stepId?: string) =>
  list.filter((f) => !f.resolved && (stepId === undefined || f.stepId === stepId)).length;

/** Three clicks: what kind, a sentence, send. Who you are comes from your sign-in. */
export function FeedbackForm({ process, stepId, pickStep, onDone }: {
  process: Process; stepId?: string; pickStep?: boolean; onDone?: () => void;
}) {
  const actions = useFeedbackActions();
  const [kind, setKind] = useState<FeedbackKind>("broken");
  const [text, setText] = useState("");
  const [target, setTarget] = useState(stepId ?? "");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    const ok = await actions.add({ processId: process.id, stepId: (pickStep ? target : stepId) || undefined, kind, text: text.trim() });
    setBusy(false);
    if (!ok) return;
    setText(""); setSent(true); setTimeout(() => setSent(false), 2500);
    onDone?.();
  };

  return (
    <div className="fb-form">
      <div className="chips">
        {(Object.keys(FEEDBACK_KINDS) as FeedbackKind[]).map((k) => (
          <button key={k} className={`chip ${kind === k ? "on" : ""}`} title={FEEDBACK_KINDS[k].hint} onClick={() => setKind(k)}>{FEEDBACK_KINDS[k].label}</button>
        ))}
      </div>
      {pickStep && (
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Which part">
          <option value="">The whole process</option>
          {process.steps.map((s, i) => <option key={s.id} value={s.id}>Step {i + 1}: {s.title}</option>)}
        </select>
      )}
      <textarea rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="What happened? e.g. “The catalogue item is now called ‘Cloud project (GCP)’.”"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
      <div className="fb-send">
        <button className="btn primary" disabled={text.trim().length < 3 || busy} onClick={send}><Flag size={15} />Send feedback</button>
        {sent && <p className="fb-thanks"><CircleCheck size={15} />Thanks - the owner has been told.</p>}
      </div>
    </div>
  );
}

export function FeedbackItem({ item, process, onSelect, hideStep }: {
  item: Feedback; process: Process; onSelect?: (id: string) => void; hideStep?: boolean;
}) {
  const actions = useFeedbackActions();
  const idx = item.stepId ? process.steps.findIndex((s) => s.id === item.stepId) : -1;
  return (
    <li className={`fb-item ${item.kind} ${item.resolved ? "resolved" : ""}`}>
      <div className="fb-meta">
        <span className={`fb-kind ${item.kind}`}>{FEEDBACK_KINDS[item.kind]?.label ?? item.kind}</span>
        {!hideStep && item.stepId && (idx >= 0
          ? <button className="fb-step" onClick={() => onSelect?.(item.stepId!)}>Step {idx + 1}: {process.steps[idx].title}</button>
          : <span className="muted">a step that was removed</span>)}
        {!hideStep && !item.stepId && <span className="muted">Whole process</span>}
        <span className="spacer" />
        <span className="muted">{item.mine ? "You" : item.author.name} · {item.createdAt.slice(0, 10)}</span>
      </div>
      <p>{item.text}</p>
      {item.stale && <p className="fb-stale"><History size={13} />This step was changed after the feedback was written. It may already be fixed.</p>}
      {item.resolved && <p className="fb-fixed"><Check size={13} />Marked as fixed{item.resolvedBy ? ` by ${item.resolvedBy}` : ""}{item.resolvedAt ? ` on ${item.resolvedAt.slice(0, 10)}` : ""}</p>}
      <div className="fb-actions">
        {!item.mine && !item.resolved && (
          <button className={`btn small ${item.alsoHitByMe ? "on" : "ghost"}`} aria-pressed={item.alsoHitByMe} onClick={() => actions.alsoHit(item, !item.alsoHitByMe)}>
            <ThumbsUp size={14} />{item.alsoHitByMe ? "You hit this too" : "I hit this too"}
          </button>
        )}
        {item.alsoHit > 0 && <span className="fb-count" title="People who hit the same problem">+{item.alsoHit} also hit this</span>}
        <span className="spacer" />
        {item.canManage && (
          <button className="btn small ghost" onClick={() => actions.resolve(item, !item.resolved)}>
            {item.resolved ? <RotateCcw size={14} /> : <Check size={14} />}{item.resolved ? "Reopen" : "Mark as fixed"}
          </button>
        )}
        {(item.canManage || item.mine) && <button className="icon-btn danger" onClick={() => actions.remove(item)} aria-label="Delete feedback"><Trash2 size={15} /></button>}
      </div>
    </li>
  );
}

export function FeedbackTab({ process, feedback, onSelect }: {
  process: Process; feedback: Feedback[]; onSelect: (id: string) => void;
}) {
  // open first, most reported first, then newest
  const sorted = [...feedback].sort((a, b) =>
    Number(a.resolved) - Number(b.resolved) || b.alsoHit - a.alsoHit || b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="fb-tab">
      <section className="fb-new">
        <h2>Something not working?</h2>
        <p className="muted">Tell the owner in a sentence. No ticket needed.</p>
        <FeedbackForm process={process} pickStep />
      </section>
      <section>
        <h2>{openCount(feedback)} open <span className="muted">· {feedback.length - openCount(feedback)} fixed</span></h2>
        {feedback.length === 0 && <p className="muted">No feedback yet.</p>}
        <ul className="fb-list">
          {sorted.map((f) => <FeedbackItem key={f.id} item={f} process={process} onSelect={onSelect} />)}
        </ul>
      </section>
    </div>
  );
}
