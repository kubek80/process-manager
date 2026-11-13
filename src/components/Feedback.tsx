import { useState } from "react";
import { Check, CircleCheck, Flag, RotateCcw, Trash2 } from "lucide-react";
import type { Feedback, FeedbackKind, Process } from "../types";

export const FEEDBACK_KINDS: Record<FeedbackKind, { label: string; hint: string }> = {
  broken: { label: "Doesn’t work", hint: "I followed it and it failed" },
  outdated: { label: "Out of date", hint: "It has changed since this was written" },
  unclear: { label: "Unclear", hint: "I don’t understand what to do" },
  idea: { label: "Suggestion", hint: "It could be easier" },
};

const AUTHOR_KEY = "pm:author";
const readAuthor = () => { try { return localStorage.getItem(AUTHOR_KEY) ?? ""; } catch { return ""; } };

export const openCount = (list: Feedback[], stepId?: string) =>
  list.filter((f) => !f.resolved && (stepId === undefined || f.stepId === stepId)).length;

/** Three clicks: what kind, a sentence, send. */
export function FeedbackForm({ process, stepId, pickStep, onAdd, onDone }: {
  process: Process; stepId?: string; pickStep?: boolean; onAdd: (f: Feedback) => void; onDone?: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("broken");
  const [text, setText] = useState("");
  const [author, setAuthor] = useState(readAuthor);
  const [target, setTarget] = useState(stepId ?? "");
  const [sent, setSent] = useState(false);

  const send = () => {
    if (!text.trim()) return;
    try { localStorage.setItem(AUTHOR_KEY, author.trim()); } catch { /* ignore */ }
    onAdd({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      stepId: (pickStep ? target : stepId) || undefined,
      kind, text: text.trim(), author: author.trim() || undefined, createdAt: new Date().toISOString(),
    });
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
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What happened? e.g. “The catalogue item is now called ‘Cloud project (GCP)’.”"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
      <div className="fb-send">
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name (optional)" maxLength={60} />
        <button className="btn primary" disabled={!text.trim()} onClick={send}><Flag size={15} />Send feedback</button>
      </div>
      {sent && <p className="fb-thanks"><CircleCheck size={15} />Thanks - the process owner will see it.</p>}
    </div>
  );
}

export function FeedbackItem({ item, process, onSelect, onChange, onRemove, hideStep }: {
  hideStep?: boolean; item: Feedback; process: Process; onSelect?: (id: string) => void; onChange: (f: Feedback) => void; onRemove: () => void;
}) {
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
        <span className="muted">{item.author ?? "Anonymous"} · {item.createdAt.slice(0, 10)}</span>
      </div>
      <p>{item.text}</p>
      <div className="fb-actions">
        <button className="btn small ghost" onClick={() => onChange({ ...item, resolved: !item.resolved })}>
          {item.resolved ? <RotateCcw size={14} /> : <Check size={14} />}{item.resolved ? "Reopen" : "Mark as fixed"}
        </button>
        <button className="icon-btn danger" onClick={onRemove} aria-label="Delete feedback"><Trash2 size={15} /></button>
      </div>
    </li>
  );
}

export function FeedbackTab({ process, feedback, onChange, onSelect }: {
  process: Process; feedback: Feedback[]; onChange: (list: Feedback[]) => void; onSelect: (id: string) => void;
}) {
  const sorted = [...feedback].sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved) || b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="fb-tab">
      <section className="fb-new">
        <h2>Something not working?</h2>
        <p className="muted">Tell the owner in a sentence. No ticket needed.</p>
        <FeedbackForm process={process} pickStep onAdd={(f) => onChange([...feedback, f])} />
      </section>
      <section>
        <h2>{openCount(feedback)} open <span className="muted">· {feedback.length - openCount(feedback)} fixed</span></h2>
        {feedback.length === 0 && <p className="muted">No feedback yet.</p>}
        <ul className="fb-list">
          {sorted.map((f) => (
            <FeedbackItem key={f.id} item={f} process={process} onSelect={onSelect}
              onChange={(n) => onChange(feedback.map((x) => (x.id === n.id ? n : x)))}
              onRemove={() => onChange(feedback.filter((x) => x.id !== f.id))} />
          ))}
        </ul>
      </section>
    </div>
  );
}
