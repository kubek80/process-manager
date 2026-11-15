import { useState } from "react";
import { Check, CircleCheck, Flag, History, RotateCcw, ThumbsUp, Trash2 } from "lucide-react";
import type { Feedback, FeedbackKind, Process, Standard, TargetKind } from "../types";
import { useFeedbackActions } from "../lib/session";

export const FEEDBACK_KINDS: Record<FeedbackKind, { label: string; hint: string }> = {
  broken: { label: "Doesn’t work", hint: "I followed it and it failed" },
  outdated: { label: "Out of date", hint: "It has changed since this was written" },
  unclear: { label: "Unclear", hint: "I don’t understand what to do" },
  idea: { label: "Suggestion", hint: "It could be easier" },
};

export const openCount = (list: Feedback[] = [], itemId?: string) =>
  list.filter((f) => !f.resolved && (itemId === undefined || f.itemId === itemId)).length;

/** What feedback can be about: a process with its steps, or a standard with its requirements. */
export interface FeedbackTarget {
  kind: TargetKind;
  id: string;
  whole: string; // "The whole process"
  part: string; // "step" / "requirement"
  items: { id: string; label: string }[];
}
export const processTarget = (p: Process): FeedbackTarget => ({
  kind: "process", id: p.id, whole: "The whole process", part: "step",
  items: p.steps.map((s, i) => ({ id: s.id, label: `Step ${i + 1}: ${s.title}` })),
});
export const standardTarget = (s: Standard): FeedbackTarget => ({
  kind: "standard", id: s.id, whole: "The whole standard", part: "requirement",
  items: s.requirements.map((r) => ({ id: r.id, label: `${r.id}: ${r.title}` })),
});

/** Three clicks: what kind, a sentence, send. Who you are comes from your sign-in. */
export function FeedbackForm({ target, itemId, pickItem, onDone }: {
  target: FeedbackTarget; itemId?: string; pickItem?: boolean; onDone?: () => void;
}) {
  const actions = useFeedbackActions();
  const [kind, setKind] = useState<FeedbackKind>("broken");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(itemId ?? "");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    const ok = await actions.add({ targetKind: target.kind, targetId: target.id, itemId: (pickItem ? picked : itemId) || undefined, kind, text: text.trim() });
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
      {pickItem && (
        <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Which part">
          <option value="">{target.whole}</option>
          {target.items.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
        </select>
      )}
      <textarea rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)}
        placeholder={target.kind === "process" ? "What happened? e.g. “The catalogue item is now called ‘Cloud project (GCP)’.”" : "What is wrong or unclear? e.g. “Does this also apply to one-off migration scripts?”"}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
      <div className="fb-send">
        <button className="btn primary" disabled={text.trim().length < 3 || busy} onClick={send}><Flag size={15} />Send feedback</button>
        {sent && <p className="fb-thanks"><CircleCheck size={15} />Thanks - the owner has been told.</p>}
      </div>
    </div>
  );
}

export function FeedbackItem({ item, target, onSelect, hideItem }: {
  item: Feedback; target: FeedbackTarget; onSelect?: (id: string) => void; hideItem?: boolean;
}) {
  const actions = useFeedbackActions();
  const part = item.itemId ? target.items.find((it) => it.id === item.itemId) : undefined;
  return (
    <li className={`fb-item ${item.kind} ${item.resolved ? "resolved" : ""}`}>
      <div className="fb-meta">
        <span className={`fb-kind ${item.kind}`}>{FEEDBACK_KINDS[item.kind]?.label ?? item.kind}</span>
        {!hideItem && item.itemId && (part
          ? <button className="fb-step" onClick={() => onSelect?.(item.itemId!)}>{part.label}</button>
          : <span className="muted">a {target.part} that was removed</span>)}
        {!hideItem && !item.itemId && <span className="muted">{target.whole.replace("The whole", "Whole")}</span>}
        <span className="spacer" />
        <span className="muted">{item.mine ? "You" : item.author.name} · {item.createdAt.slice(0, 10)}</span>
      </div>
      <p>{item.text}</p>
      {item.stale && <p className="fb-stale"><History size={13} />This {target.part} was changed after the feedback was written. It may already be fixed.</p>}
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

export function FeedbackTab({ target, feedback, onSelect }: {
  target: FeedbackTarget; feedback: Feedback[]; onSelect: (id: string) => void;
}) {
  // open first, most reported first, then newest
  const sorted = [...feedback].sort((a, b) =>
    Number(a.resolved) - Number(b.resolved) || b.alsoHit - a.alsoHit || b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="fb-tab">
      <section className="fb-new">
        <h2>{target.kind === "process" ? "Something not working?" : "Something wrong or unclear?"}</h2>
        <p className="muted">Tell the owner in a sentence. No ticket needed.</p>
        <FeedbackForm target={target} pickItem />
      </section>
      <section>
        <h2>{openCount(feedback)} open <span className="muted">· {feedback.length - openCount(feedback)} fixed</span></h2>
        {feedback.length === 0 && <p className="muted">No feedback yet.</p>}
        <ul className="fb-list">
          {sorted.map((f) => <FeedbackItem key={f.id} item={f} target={target} onSelect={onSelect} />)}
        </ul>
      </section>
    </div>
  );
}
