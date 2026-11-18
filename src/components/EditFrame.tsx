import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, ChevronRight, CircleAlert, CircleCheck, Flag, ListTree, MoreHorizontal, PanelRight, Plus, Redo2, Send, TriangleAlert, Undo2, X,
} from "lucide-react";
import type { Feedback, Issue } from "../types";
import { checkerSummary, issueText, type EditState, type OutlineEntry } from "../lib/editing";
import type { Notice } from "./EditSession";
import { FeedbackItem, type FeedbackTarget } from "./Feedback";
import { Modal, useLayer } from "./ui";
import "../edit.css";

/**
 * The editing screen of a process or a standard: a separate full-height screen, visibly not the
 * reader's page. The editing bar on top says what state the document is in and holds the
 * actions (the primary one, Publish, last); below it the outline (left), what readers will see
 * (middle) and the fields of what is selected (right). On a laptop the outline slides over; on a
 * phone the fields do too.
 */

/** A group of fields with a heading. */
export function EditSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="edit-section" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {hint && <p className="edit-section-hint">{hint}</p>}
      <div className="edit-section-body form">{children}</div>
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
  const errors = issues.filter((i) => i.level === "error").length;
  const when = issues.some((i) => i.level === "error" && fixBefore(i) === "saving") ? "saving" : "publishing";
  return (
    <div className={`item-issues ${errors ? "bad" : "warn"}`} role="status">
      <strong>{errors ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}{errors ? `${errors} problem${errors > 1 ? "s" : ""} to fix before ${when}` : "Worth a look"}</strong>
      <ul>{issues.map((i, k) => <li key={k} className={i.level}>{issueText(i)}</li>)}</ul>
    </div>
  );
}

/** Open feedback about a step or a requirement: shown where it is changed, because it is why people edit. */
export function ItemFeedback({ feedback, target, noun }: { feedback: Feedback[]; target: FeedbackTarget; noun: string }) {
  if (!feedback.length) return null;
  return (
    <section className="item-feedback" aria-label={`Open feedback about this ${noun}`}>
      <h3><Flag size={14} />{feedback.length} open feedback about this {noun}</h3>
      <ul className="fb-list">{feedback.map((f) => <FeedbackItem key={f.id} item={f} target={target} hideItem />)}</ul>
    </section>
  );
}

// ---------- the outline

export function Outline({ entries, selected, onSelect, issues, feedback, onAdd, onMove, label }: {
  entries: OutlineEntry[];
  /** The key of what is selected: "about", "steps/<id>". */
  selected: string;
  onSelect: (e: OutlineEntry) => void;
  /** Problems per key (see issuesByPlace). */
  issues: Map<string, { errors: number; warnings: number }>;
  /** Open feedback per item id. */
  feedback: (item: string) => number;
  /** The section whose items can be added to, with what the button says. */
  onAdd: { section: string; label: string; run: () => void };
  /** Moves an item one place earlier or later. */
  onMove: (item: string, dir: -1 | 1) => void;
  label: string;
}) {
  const items = entries.filter((e) => e.depth === 1);
  return (
    <nav className="outline" aria-label={label}>
      <ul>
        {entries.map((e) => {
          const c = issues.get(e.key);
          const on = selected === e.key;
          const flags = e.item ? feedback(e.item) : 0;
          const at = e.item ? items.findIndex((x) => x.key === e.key) : -1;
          return (
            <li key={e.key} className={`outline-row depth-${e.depth} ${on ? "on" : ""}`}>
              <button className="outline-item" aria-current={on ? "true" : undefined} onClick={() => onSelect(e)}
                aria-label={`${e.number && e.depth === 1 ? `${e.number} ` : ""}${e.label}${c?.errors ? `, ${c.errors} problem${c.errors > 1 ? "s" : ""}` : c?.warnings ? `, ${c.warnings} hint${c.warnings > 1 ? "s" : ""}` : ""}${flags ? `, ${flags} open feedback` : ""}`}>
                {e.depth === 1 && <span className="outline-n">{e.number}</span>}
                <span className="outline-label">{e.label}</span>
                {e.depth === 0 && e.count !== undefined && <span className="outline-count">{e.count}</span>}
                {flags > 0 && <span className="outline-flag" title={`${flags} open feedback`}><Flag size={11} strokeWidth={2.5} />{flags}</span>}
                {c && (c.errors || c.warnings) ? <span className={`outline-mark ${c.errors ? "bad" : "warn"}`} title={c.errors ? `${c.errors} problem${c.errors > 1 ? "s" : ""}` : `${c.warnings} hint${c.warnings > 1 ? "s" : ""}`}>{c.errors || c.warnings}</span> : null}
              </button>
              {e.depth === 0 && e.section === onAdd.section && (
                <button className="icon-btn outline-add" onClick={onAdd.run} aria-label={onAdd.label} title={onAdd.label}><Plus size={15} /></button>
              )}
              {on && e.item && items.length > 1 && (
                <span className="outline-move">
                  <button className="btn small ghost" disabled={at <= 0} onClick={() => onMove(e.item!, -1)} aria-label={`Move ${e.label} earlier`}><ArrowUp size={13} />Earlier</button>
                  <button className="btn small ghost" disabled={at === items.length - 1} onClick={() => onMove(e.item!, 1)} aria-label={`Move ${e.label} later`}><ArrowDown size={13} />Later</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
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
      <button ref={button} className="eb-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="More: versions, retire, delete, AI, JSON">
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
        <button className="eb-btn eb-back" onClick={onBack} title={`Back to reading this ${noun}`}><ArrowLeft size={16} /><span className="eb-label">Back to reading</span></button>
        <div className="eb-title">
          <span className="eb-kicker">Editing {noun}</span>
          <h1 title={title}>{title || "(no name yet)"}</h1>
        </div>
        <div className="eb-state" role="status" aria-label={`${state.pill}. ${state.sentence}.${unsaved ? " Changes not saved yet." : ""}`}>
          <span className={`state-pill ${state.key}`}>{state.pill}</span>
          <span className="eb-sentence">{state.sentence}{unsaved && <span className="eb-unsaved"> · not saved yet</span>}</span>
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
          <button className="eb-btn eb-save" disabled={!!save.blocked || save.busy} onClick={save.run} title={save.blocked}>{save.busy ? "Saving…" : save.label}</button>
          <button className={`eb-btn eb-publish ${publish.unavailable ? "unavailable" : ""}`} disabled={!!publish.blocked || publish.busy} onClick={publish.run}
            title={publish.blocked} aria-disabled={publish.unavailable ? true : undefined} aria-describedby={publish.unavailable && notice ? "edit-notice" : undefined}><Send size={15} />{publish.label}</button>
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
