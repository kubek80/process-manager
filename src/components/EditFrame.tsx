import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Flag, GripVertical, ListTree, MoreHorizontal, PanelRight, Plus, Redo2, Send, TriangleAlert, Undo2, X,
} from "lucide-react";
import type { Feedback, Issue } from "../types";
import { checkerSummary, dropBefore, isExampleIssue, issueText, type EditState, type IssueCount, type OutlineEntry } from "../lib/editing";
import { LANE_COLORS, STEP_META } from "../lib/stepMeta";
import type { Notice } from "./EditSession";
import { FeedbackItem, type FeedbackTarget } from "./Feedback";
import { Modal, notify, TypeIcon, useLayer } from "./ui";
import "../edit.css";

/**
 * The editing screen of a process or a standard: a separate full-height screen, visibly not the
 * reader's page. The editing bar on top says what state the document is in and holds the
 * actions (the primary one, Publish, last); below it the outline (left), what readers will see
 * (middle) and the fields of what is selected (right). On a laptop the outline slides over; on a
 * phone the fields do too.
 */

/**
 * A group of fields with a heading. With `folded` it can be folded away: folded, it shows
 * `summary` (what is set, in a line) instead of its fields. It opens by itself when `folded`
 * turns false, e.g. when the checker finds a problem in it.
 */
export function EditSection({ title, hint, children, summary, folded }: { title: string; hint?: ReactNode; children: ReactNode; summary?: ReactNode; folded?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(!folded);
  useEffect(() => { if (folded === false) setOpen(true); }, [folded]);
  if (folded === undefined) {
    return (
      <section className="edit-section" aria-labelledby={id}>
        <h3 id={id}>{title}</h3>
        {hint && <p className="edit-section-hint">{hint}</p>}
        <div className="edit-section-body form">{children}</div>
      </section>
    );
  }
  return (
    <section className={`edit-section fold ${open ? "open" : ""}`} aria-labelledby={id}>
      <h3><button id={id} className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={15} className="fold-chev" aria-hidden="true" /><span>{title}</span>
      </button></h3>
      {!open && summary && <button className="fold-summary" onClick={() => setOpen(true)} tabIndex={-1}>{summary}</button>}
      {open && hint && <p className="edit-section-hint">{hint}</p>}
      {open && <div className="edit-section-body form">{children}</div>}
    </section>
  );
}

/** The heading of the fields panel: what is selected, and what can be done with it as a whole. */
export function FieldsHead({ icon, kicker, title, tools }: { icon?: ReactNode; kicker?: ReactNode; title: string; tools?: ReactNode }) {
  return (
    <header className="fields-head">
      <div className="fields-title">
        {icon}
        <div>
          {kicker && <span className="step-kicker">{kicker}</span>}
          <h2>{title}</h2>
        </div>
      </div>
      {tools && <div className="fields-tools">{tools}</div>}
    </header>
  );
}

/** Whether a problem has to be fixed before saving (a draft never published) or only before publishing. */
const FixBefore = createContext<(i: Issue) => "saving" | "publishing">(() => "publishing");

/** The checker's findings about what is selected, at the top of its fields. */
export function ItemIssues({ issues }: { issues: Issue[] }) {
  const fixBefore = useContext(FixBefore);
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.level === "error");
  const n = (list: Issue[], one: string, many: string) => `${list.length} ${list.length === 1 ? one : many}`;
  const saving = errors.filter((i) => fixBefore(i) === "saving");
  const publishing = errors.filter((i) => fixBefore(i) !== "saving" && !isExampleIssue(i));
  const examples = errors.filter((i) => fixBefore(i) !== "saving" && isExampleIssue(i));
  const groups: { title: string; tone: "bad" | "warn"; list: Issue[] }[] = [
    { list: saving, tone: "bad", title: n(saving, "problem to fix before saving", "problems to fix before saving") },
    { list: publishing, tone: "bad", title: n(publishing, "problem to fix before publishing", "problems to fix before publishing") },
    // example texts of something new: calmer, they are simply still to be written
    { list: examples, tone: "warn", title: n(examples, "example text to replace before publishing", "example texts to replace before publishing") },
    { list: issues.filter((i) => i.level !== "error"), tone: "warn", title: "Worth a look" },
  ];
  return (
    <>
      {groups.filter((g) => g.list.length).map((g) => (
        <div key={g.title} className={`item-issues ${g.tone}`} role="status">
          <strong>{g.tone === "bad" ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}{g.title}</strong>
          <ul>{g.list.map((i, k) => <li key={k} className={i.level}>{issueText(i)}</li>)}</ul>
        </div>
      ))}
    </>
  );
}

/**
 * Open feedback about a step or a requirement: shown where it is changed, because it is why people
 * edit - as one line with the first remark, so it does not push the fields away; opened on demand.
 */
export function ItemFeedback({ feedback, target, noun }: { feedback: Feedback[]; target: FeedbackTarget; noun: string }) {
  const [open, setOpen] = useState(false);
  if (!feedback.length) return null;
  return (
    <section className={`item-feedback ${open ? "open" : ""}`} aria-label={`Open feedback about this ${noun}`}>
      <button className="item-feedback-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Flag size={14} aria-hidden="true" />
        <span className="item-feedback-text"><b>{feedback.length} open feedback</b>{!open && <> · “{feedback[0].text}”</>}</span>
        <ChevronDown size={15} className="fold-chev" aria-hidden="true" />
      </button>
      {open && <ul className="fb-list">{feedback.map((f) => <FeedbackItem key={f.id} item={f} target={target} hideItem />)}</ul>}
    </section>
  );
}

// ---------- the outline

/** "2 problems", "1 to fill in" (example texts only), "3 hints": what an outline mark stands for. */
const markWords = (c: IssueCount, lead = "") => {
  const plural = (n: number, one: string, many: string) => `${lead}${n} ${n === 1 ? one : many}`;
  if (c.errors > c.examples) return plural(c.errors, "problem", "problems");
  if (c.errors) return plural(c.errors, "to fill in", "to fill in");
  if (c.warnings) return plural(c.warnings, "hint", "hints");
  return "";
};

export interface OutlineAdd {
  /** The section whose items the line at its end adds to. */
  section: string;
  /** The label of the line, e.g. "Add a step", and what the field says while empty. */
  label: string; placeholder: string;
  /** Adds an item with the name typed. */
  run: (name: string) => void;
}

export function Outline({ entries, selected, onSelect, issues, feedback, onAdd, onMove, onNudge, moveBlocked, label }: {
  entries: OutlineEntry[];
  /** The key of what is selected: "about", "steps/<id>". */
  selected: string;
  onSelect: (e: OutlineEntry) => void;
  /** Problems per key (see issuesByPlace). */
  issues: Map<string, IssueCount>;
  /** Open feedback per item id. */
  feedback: (item: string) => number;
  onAdd: OutlineAdd;
  /** Puts an item before another one, or (null) at the end. */
  onMove: (item: string, before: string | null) => void;
  /** Moves an item one place up or down (Alt+Up / Alt+Down). */
  onNudge: (item: string, dir: -1 | 1) => void;
  /** Why an item cannot be moved, if it cannot. */
  moveBlocked?: (item: string) => string;
  label: string;
}) {
  const items = entries.filter((e) => e.depth === 1);
  const ids = items.map((e) => e.item!);
  const list = useRef<HTMLUListElement>(null);
  // dragging by the handle: which item, and the gap it would land in (0 = before the first)
  const [drag, setDrag] = useState<{ item: string; gap: number } | null>(null);
  const gapAt = (y: number) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(".outline-row.depth-1") ?? [])];
    const i = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
    return i < 0 ? rows.length : i;
  };
  const startDrag = (e: React.PointerEvent, item: string) => {
    if (e.button !== 0 || moveBlocked?.(item)) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    try { handle.setPointerCapture(e.pointerId); } catch { /* gone */ }
    const start = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - start) < 4) return;
      moved = true;
      setDrag({ item, gap: gapAt(ev.clientY) });
    };
    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (!moved) return;
      const before = dropBefore(ids, item, gapAt(ev.clientY));
      if (before !== undefined) onMove(item, before);
    };
    const cancel = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", cancel); setDrag(null); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
  };
  const keyMove = (e: React.KeyboardEvent, item: string, always = false) => {
    if (!(e.key === "ArrowUp" || e.key === "ArrowDown") || (!always && !e.altKey)) return;
    e.preventDefault();
    const why = moveBlocked?.(item);
    if (why) { notify.info(why); return; }
    onNudge(item, e.key === "ArrowUp" ? -1 : 1);
  };
  // the selected item keeps the focus where it was after a move by the keys: the row is rendered anew
  const dropping = drag ? dropBefore(ids, drag.item, drag.gap) : undefined;
  return (
    <nav className={`outline ${drag ? "dragging" : ""}`} aria-label={label}>
      <ul ref={list}>
        {entries.flatMap((e, k) => {
          // the line that adds an item comes right after the last item of its section
          const endsSection = e.section === onAdd.section && entries[k + 1]?.section !== onAdd.section;
          const c = issues.get(e.key);
          const on = selected === e.key;
          const flags = e.item ? feedback(e.item) : 0;
          const at = e.item ? ids.indexOf(e.item) : -1;
          const blocked = e.item ? moveBlocked?.(e.item) : "";
          const lane = e.lane !== undefined ? LANE_COLORS[e.lane % LANE_COLORS.length] : undefined;
          const marker = drag && e.item && dropping !== undefined && ((dropping === e.item) ? "before" : (dropping === null && at === ids.length - 1) ? "after" : "");
          const mark = c && (c.errors || c.warnings) ? markWords(c) : "";
          return [
            <li key={e.key} className={`outline-row depth-${e.depth} ${on ? "on" : ""} ${e.level ? `lvl-${e.level}` : ""} ${drag && e.item && drag.item === e.item ? "lifted" : ""} ${marker ? `drop-${marker}` : ""}`}
              style={lane ? ({ "--lane": lane } as React.CSSProperties) : undefined}>
              {e.depth === 1 && items.length > 1 && (
                <button className="outline-grip" tabIndex={on ? 0 : -1} aria-label={`Move “${e.label}”: drag, or press the up and down arrow keys`}
                  title={blocked || "Drag to move. With the keyboard: Alt+Up or Alt+Down on the item."} aria-disabled={blocked ? true : undefined}
                  onPointerDown={(ev) => startDrag(ev, e.item!)} onKeyDown={(ev) => keyMove(ev, e.item!, true)}
                  onClick={() => { if (blocked) notify.info(blocked); }}>
                  <GripVertical size={14} />
                </button>
              )}
              <button className={`outline-item ${(e.number?.length ?? 0) > 3 ? "long-n" : ""}`} aria-current={on ? "true" : undefined} onClick={() => onSelect(e)}
                onKeyDown={e.item ? (ev) => keyMove(ev, e.item!) : undefined}
                title={e.who ? `${e.number}. ${e.label} - ${e.who}${e.type ? `, ${STEP_META[e.type].label}` : ""}` : undefined}
                aria-label={`${e.number && e.depth === 1 ? `${e.number} ` : ""}${e.label}${e.who ? `, by ${e.who}` : ""}${mark ? `, ${mark}` : ""}${flags ? `, ${flags} open feedback` : ""}`}>
                {e.depth === 1 && (e.type ? <span className="outline-kind" aria-hidden="true"><TypeIcon type={e.type} size={20} /></span> : <span className="outline-n">{e.number}</span>)}
                <span className="outline-label">
                  {e.depth === 1 && e.type && <span className="outline-num">{e.number}</span>}
                  {e.label}
                </span>
                {e.depth === 0 && e.count !== undefined && <span className={`outline-count ${e.count === 0 ? "none" : ""}`}>{e.count === 0 ? "none" : e.count}</span>}
                {flags > 0 && <span className="outline-flag" title={`${flags} open feedback`}><Flag size={11} strokeWidth={2.5} />{flags}</span>}
                {mark ? <span className={`outline-mark ${c!.errors > c!.examples ? "bad" : "warn"}`} title={mark}>{c!.errors || c!.warnings}</span> : null}
              </button>
            </li>,
            // its own row with a key of its own, so that it keeps the focus while items are added above it
            endsSection ? <li key={`add:${onAdd.section}`} className="outline-row outline-add-row"><OutlineAddLine add={onAdd} /></li> : null,
          ];
        })}
      </ul>
      {items.length > 1 && <p className="outline-tip">Drag <GripVertical size={12} aria-hidden="true" /> to move, or Alt + ↑ ↓</p>}
    </nav>
  );
}

/** "Add a step" at the end of the outline: type a name, Enter, type the next one. */
function OutlineAddLine({ add }: { add: OutlineAdd }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) field.current?.focus(); }, [open]);
  const commit = () => {
    const name = value.trim();
    if (name.length < 2) return;
    add.run(name);
    setValue("");
    // stay in the field for the next one
    requestAnimationFrame(() => field.current?.focus());
  };
  if (!open) return <button className="outline-add-line" onClick={() => setOpen(true)}><Plus size={15} />{add.label}</button>;
  return (
    <form className="outline-add-form" onSubmit={(e) => { e.preventDefault(); commit(); }}>
      <input ref={field} value={value} maxLength={80} aria-label={add.label} placeholder={add.placeholder} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setValue(""); setOpen(false); } }}
        onBlur={() => { if (!value.trim()) setOpen(false); }} />
      <span className="outline-add-help">Enter adds it · Esc closes</span>
    </form>
  );
}

// ---------- the editing bar

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  run: () => void;
  danger?: boolean;
  /** Why it cannot be used right now: shown with it, and the item is disabled. */
  blocked?: string;
  /** A line under the label. */
  hint?: string;
  /** Starts a new group. */
  divider?: boolean;
}

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div className="more-menu" ref={box}>
      <button ref={button} className="eb-btn" aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="More: versions, retire, delete, AI, JSON">
        <MoreHorizontal size={17} /><span className="eb-label">More</span>
      </button>
      {open && <MenuPop items={items} onClose={() => { setOpen(false); button.current?.focus(); }} onRun={(it) => { setOpen(false); it.run(); }} />}
    </div>
  );
}

function MenuPop({ items, onClose, onRun }: { items: MenuItem[]; onClose: () => void; onRun: (it: MenuItem) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { focus: false });
  useEffect(() => { ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus(); }, []);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  };
  return (
    <div ref={ref} className="menu-pop" role="menu" aria-label="More" onKeyDown={move}>
      {items.map((it) => (
        <div key={it.label} className={it.divider ? "menu-divider" : undefined}>
          <button role="menuitem" className={`menu-item ${it.danger ? "danger" : ""}`} aria-disabled={it.blocked ? true : undefined}
            onClick={() => { if (!it.blocked) onRun(it); }}>
            {it.icon}<span><b>{it.label}</b>{(it.blocked || it.hint) && <em>{it.blocked ?? it.hint}</em>}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/** The checker's summary on the bar; opens the list of what it found. */
function Checker({ issues, place, onPick }: { issues: Issue[]; place: (i: Issue) => string; onPick: (i: Issue) => void }) {
  const [open, setOpen] = useState(false);
  const sum = checkerSummary(issues);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div className="checker" ref={box}>
      <button className={`eb-status ${sum.level}`} aria-expanded={open} disabled={!issues.length} onClick={() => setOpen(!open)}
        title={issues.length ? "Show what the checker found" : "The checker found nothing to fix"}>
        {sum.level === "bad" ? <CircleAlert size={15} /> : sum.level === "warn" ? <TriangleAlert size={15} /> : <CircleCheck size={15} />}{sum.text}
      </button>
      {open && <CheckerPop issues={issues} place={place} onClose={() => setOpen(false)} onPick={(i) => { setOpen(false); onPick(i); }} />}
    </div>
  );
}

function CheckerPop({ issues, place, onClose, onPick }: { issues: Issue[]; place: (i: Issue) => string; onClose: () => void; onPick: (i: Issue) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose);
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return (
    <div ref={ref} className="checker-pop" role="dialog" aria-label="What the checker found" tabIndex={-1}>
      <p className="muted small">Problems must be fixed before publishing; hints are worth a look. Press one to go there.</p>
      <ul>
        {sorted.map((i, k) => (
          <li key={k}>
            <button className={i.level} onClick={() => onPick(i)}>
              {i.level === "error" ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}
              <span><b>{place(i)}</b>{issueText(i)}</span>
              <ChevronRight size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A button of the editing bar. `blocked`: off (nothing to do). `unavailable`: looks unavailable
 * but can be pressed and focused - pressing it says why (the reason is also shown under the bar).
 */
export interface BarAction { label: string; run: () => void; blocked?: string; unavailable?: string; busy?: boolean }

export function EditFrame({ kind, title, state, issues, place, onPickIssue, undo, onBack, discard, save, publish, more, unsaved, banners, outline, middle, fields, fieldsLabel, panel, setPanel, json, notice, onNotice, fixBefore }: {
  kind: "process" | "standard"; title: string; state: EditState;
  issues: Issue[]; place: (i: Issue) => string; onPickIssue: (i: Issue) => void;
  undo: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  onBack: () => void;
  /** "Discard changes" (to the last save) or "Discard draft" (the working draft), when there is one to discard. */
  discard?: BarAction;
  save: BarAction;
  publish: BarAction;
  more: MenuItem[];
  /** Whether there are changes on this screen that are not saved yet. */
  unsaved: boolean;
  banners?: ReactNode;
  outline: ReactNode; middle: ReactNode; fields: ReactNode;
  /** What the fields panel shows, e.g. "Step 3: Approve the budget". */
  fieldsLabel: string;
  /** Which panel slides over on a small screen. */
  panel: Panel; setPanel: (p: Panel) => void;
  /** The JSON of the whole document is shown: it takes the whole width. */
  json?: boolean;
  notice?: Notice | null; onNotice: () => void;
  fixBefore: (i: Issue) => "saving" | "publishing";
}) {
  const off = (unavailable: boolean) => (unavailable ? { "aria-disabled": true, className: "eb-icon off" } : { className: "eb-icon" });
  const noun = kind === "process" ? "process" : "standard";
  // on a phone there is no room for Discard on the bar: it moves into More
  const phone = useNarrow();
  const items = phone && discard ? [{ label: discard.label, icon: <Undo2 size={16} />, run: discard.run, blocked: discard.blocked }, ...more] : more;
  return (
    <div className={`edit-screen panel-${panel ?? "none"} ${json ? "json" : ""}`}>
      <header className={`edit-bar state-${state.key}`}>
        <button className="eb-btn eb-back" aria-label="Back to reading" onClick={onBack} title={`Back to reading this ${noun}`}><ArrowLeft size={16} /><span className="eb-label eb-long">Back to reading</span><span className="eb-label eb-short" aria-hidden="true">Back</span></button>
        <div className="eb-title">
          <span className="eb-kicker">Editing {noun}</span>
          <h1 title={title}>{title || "(no name yet)"}</h1>
        </div>
        <div className="eb-state" role="status" aria-label={`${state.pill}. ${state.sentence}.${unsaved ? " Changes not saved yet." : ""}`}>
          <span className={`state-pill ${state.key}`}>{state.pill}</span>
          <span className="eb-sentence" title={state.sentence}>{state.sentence}</span>
        </div>
        <span className="spacer" />
        <div className="eb-tools">
          <button {...off(!undo.canUndo)} onClick={() => undo.canUndo && undo.undo()} aria-label="Undo" title="Undo the last change (Ctrl+Z)"><Undo2 size={17} /></button>
          <button {...off(!undo.canRedo)} onClick={() => undo.canRedo && undo.redo()} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={17} /></button>
          <Checker issues={issues} place={place} onPick={onPickIssue} />
        </div>
        <div className="eb-actions">
          <MoreMenu items={items} />
          {discard && !phone && <button className="eb-btn eb-discard" disabled={!!discard.blocked || discard.busy} onClick={discard.run} title={discard.blocked}>{discard.label}</button>}
          <button className="eb-btn eb-save" disabled={!!save.blocked || save.busy} onClick={save.run} title={save.blocked ?? "Changes not saved yet. Save them as a draft (Ctrl+S)"}>
            {unsaved && !save.busy && <span className="eb-dot" aria-hidden="true" />}{save.busy ? "Saving…" : save.label}
          </button>
          <button className={`eb-btn eb-publish ${publish.unavailable ? "unavailable" : ""}`} disabled={!!publish.blocked || publish.busy} onClick={publish.run}
            title={publish.blocked} aria-describedby={publish.unavailable && notice ? "edit-notice" : undefined}><Send size={15} />{publish.label}</button>
        </div>
      </header>
      {notice && (
        <div id="edit-notice" className={`edit-notice ${notice.tone}`} role={notice.persistent ? "status" : "alert"}>
          {notice.tone === "bad" ? <CircleAlert size={16} /> : <TriangleAlert size={16} />}
          <span>{notice.text}</span>
          {notice.issue && <button className="btn small" onClick={() => onPickIssue(notice.issue!)}>Show it</button>}
          {!notice.persistent && <button className="icon-btn" onClick={onNotice} aria-label="Close this message"><X size={16} /></button>}
        </div>
      )}
      {banners && <div className="edit-banners">{banners}</div>}
      <div className="panel-strip">
        <button className="btn small" onClick={() => setPanel(panel === "outline" ? null : "outline")} aria-expanded={panel === "outline"}><ListTree size={15} />Outline</button>
        <button className="btn small fields-toggle" onClick={() => setPanel(panel === "fields" ? null : "fields")} aria-expanded={panel === "fields"}><PanelRight size={15} /><span>{fieldsLabel}</span></button>
      </div>
      <div className="edit-body">
        <aside className="edit-outline" aria-label="Outline">
          <div className="panel-close"><b>Outline</b><button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close the outline"><X size={18} /></button></div>
          {outline}
        </aside>
        <main className="edit-middle" aria-label="What readers will see">{middle}</main>
        <aside className="edit-fields" aria-label={`Fields: ${fieldsLabel}`}>
          <div className="panel-close"><b>{fieldsLabel}</b><button className="icon-btn" onClick={() => setPanel(null)} aria-label="Close the fields"><X size={18} /></button></div>
          <FixBefore.Provider value={fixBefore}>{fields}</FixBefore.Provider>
        </aside>
        {panel && <div className="panel-scrim" onClick={() => setPanel(null)} aria-hidden="true" />}
      </div>
    </div>
  );
}

export type Panel = "outline" | "fields" | null;

/** Whether the screen is as narrow as a phone (the stylesheet's breakpoint for the editing screen). */
function useNarrow() {
  const query = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

/**
 * "Publish…": what changed since the published version, a note for the list of versions, and
 * what publishing means for readers. Blocked, with the reason, while the checker has errors.
 */
export function PublishDialog({ noun, first, changes, version, blocked, onPublish, onClose }: {
  noun: string;
  /** Never published before: says who will be able to see it. */
  first: boolean;
  /** What readers will see differently, a line each (see publishLines). */
  changes: string[]; version?: number; blocked?: string;
  onPublish: (note: string) => Promise<boolean>; onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (blocked || busy) return;
    setBusy(true);
    try { if (await onPublish(note)) onClose(); } finally { setBusy(false); }
  };
  return (
    <Modal title={first ? `Publish this ${noun}` : "Publish your changes"}
      subtitle={first ? `Until now only the people who may change it could see it.` : `Readers now see version ${version}.`}
      onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Not yet</button>
        <button className="btn primary" disabled={!!blocked || busy} onClick={go} title={blocked}><Send size={15} />{busy ? "Publishing…" : "Publish"}</button></>}>
      <div className="publish-body">
        {first
          ? <p>Everybody who signs in to the portal will be able to find and read it. Its skill is generated, and search and AI agents find it.</p>
          : <>
              <h3 className="mini-title">What readers will see differently</h3>
              {changes.length
                ? <ul className="publish-changes">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
                : <p className="muted">Nothing that readers see is different.</p>}
            </>}
        <label className="field">
          <span className="field-label">Note for the list of versions<em>Optional. Tells others what changed and why.</em></span>
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={first ? "For example: first version" : "For example: added the security review"} data-autofocus=""
            onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        </label>
        {blocked
          ? <div className="check bad" role="alert"><CircleAlert size={16} /><span>{blocked}</span></div>
          : <p className="publish-sentence"><Send size={14} />Readers see it as soon as you publish.</p>}
      </div>
    </Modal>
  );
}
