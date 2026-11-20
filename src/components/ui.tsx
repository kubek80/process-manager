import { Component, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import {
  ClipboardList, GitPullRequest, Stamp, Eye, Hourglass, Send, Users, Bot, FileText, ShieldCheck,
  Split, Workflow, SquareCheck, X, Check, Copy, CircleAlert, CircleCheck, RotateCcw, TriangleAlert, type LucideIcon,
} from "lucide-react";
import type { Issue, StepType } from "../types";
import { STEP_META } from "../lib/stepMeta";
import { copyText } from "../lib/store";

export const STEP_ICON: Record<StepType, LucideIcon> = {
  form: ClipboardList, code: GitPullRequest, approval: Stamp, review: Eye, wait: Hourglass,
  communication: Send, meeting: Users, automation: Bot, document: FileText, verify: ShieldCheck,
  decision: Split, subprocess: Workflow, task: SquareCheck,
};

export function TypeIcon({ type, size = 36 }: { type: StepType; size?: number }) {
  const Icon = STEP_ICON[type] ?? SquareCheck;
  return (
    <span className="type-icon" style={{ "--c": STEP_META[type]?.color ?? "#475569", width: size, height: size } as React.CSSProperties}>
      <Icon size={Math.round(size * 0.52)} strokeWidth={2} />
    </span>
  );
}

/** Does the reader ask for less movement? Used for scrolling; the stylesheet handles animations. */
export const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth");

// ---------- layers: dialogs, side panels and pop-ups

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const focusables = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
const focusInto = (node: HTMLElement) => (node.querySelector<HTMLElement>("[data-autofocus]") ?? node).focus({ preventScroll: true });

/** Open layers, oldest first. Escape only ever closes the one on top. */
const layers: object[] = [];

/**
 * Keyboard and focus behaviour shared by everything that opens on top of the page:
 * focus moves in when it opens and back to what opened it when it closes, Escape closes
 * the topmost layer only, and a `modal` layer keeps Tab inside.
 *
 * - `focus: false` leaves the focus where it is (a pop-up under its own button).
 * - `watch`: when this value changes while the layer stays open (a side panel showing another
 *   item), focus moves in again unless it is already inside.
 * - `returnFocus`: where to put the focus when the opener is gone by the time the layer closes.
 */
export function useLayer(ref: RefObject<HTMLElement | null>, onClose: () => void, opts: {
  modal?: boolean; focus?: boolean; watch?: unknown; returnFocus?: () => HTMLElement | null;
} = {}) {
  const { modal = false, focus = true, watch } = opts;
  const latest = useRef({ onClose, returnFocus: opts.returnFocus });
  latest.current = { onClose, returnFocus: opts.returnFocus };
  // noted while rendering: by the time effects run an autoFocus field inside may already have the focus
  const opener = useRef<HTMLElement | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;

  useEffect(() => {
    const node = ref.current;
    const token = {};
    layers.push(token);
    if (focus && node && !node.contains(document.activeElement)) focusInto(node);
    const onKey = (e: KeyboardEvent) => {
      if (layers[layers.length - 1] !== token) return;
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); latest.current.onClose(); return; }
      if (e.key !== "Tab" || !modal || !node) return;
      const items = focusables(node);
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!first) { e.preventDefault(); node.focus(); }
      else if (!node.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && (active === first || active === node)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      layers.splice(layers.indexOf(token), 1);
      // only when the focus was inside (and is now nowhere): never steal it from where the person went
      const active = document.activeElement;
      if (active && active !== document.body && !(node && node.contains(active))) return;
      const back = opener.current?.isConnected ? opener.current : latest.current.returnFocus?.();
      back?.focus({ preventScroll: true });
    };
  }, [ref, modal, focus]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const node = ref.current, active = document.activeElement;
    if (!focus || !node || node.contains(active)) return;
    if (active instanceof HTMLElement && active !== document.body) opener.current = active;
    focusInto(node);
  }, [watch]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Modal({ title, subtitle, onClose, children, wide, footer, closable = true }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode;
  /** false: a question that has to be answered with one of its buttons - no X to close it. */
  closable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(ref, onClose, { modal: true });
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {closable && <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------- questions and notices, instead of the browser's own pop-ups

export interface ConfirmOptions { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
/** A question with a third answer: `preferred` is the main button, the confirm button the other way on. */
export interface ChoiceOptions extends ConfirmOptions { preferredLabel: string }
export type Choice = "preferred" | "confirm" | "cancel";
export interface NoticeAction { label: string; run: () => void }
interface Notice { id: number; kind: "error" | "info"; title: string; detail?: string; action?: NoticeAction }
interface Question extends ConfirmOptions { preferredLabel?: string; answer: (choice: Choice) => void }

let ui: { question: Question | null; notices: Notice[] } = { question: null, notices: [] };
const listeners = new Set<() => void>();
const setUi = (next: Partial<typeof ui>) => { ui = { ...ui, ...next }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
let nextId = 1;
const MAX_NOTICES = 4;

/** Asks a yes/no question in the app's own dialog. Resolves to true when the person confirms. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return ask(options).then((c) => c === "confirm");
}

/**
 * Asks with three answers: the main button (`preferredLabel`, e.g. "Save draft and leave"), the
 * confirm button (`confirmLabel`, e.g. "Leave without saving", in the problem colour with
 * `danger`) and the cancel button. Closing the dialog is "cancel".
 */
export function chooseDialog(options: ChoiceOptions): Promise<Choice> {
  return ask(options);
}

function ask(options: ConfirmOptions & { preferredLabel?: string }): Promise<Choice> {
  return new Promise((resolve) => {
    ui.question?.answer("cancel"); // a newer question replaces an unanswered one
    setUi({ question: { ...options, answer: (choice) => { setUi({ question: null }); resolve(choice); } } });
  });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : e == null ? undefined : String(e));
const dismiss = (id: number) => setUi({ notices: ui.notices.filter((n) => n.id !== id) });
function push(n: Omit<Notice, "id">): number {
  const same = ui.notices.find((x) => x.kind === n.kind && x.title === n.title && x.detail === n.detail && !x.action && !n.action);
  if (same) return same.id; // the same message is not stacked
  const id = nextId++;
  setUi({ notices: [...ui.notices, { ...n, id }].slice(-MAX_NOTICES) });
  // what went wrong stays until it is closed; the rest goes away by itself
  if (n.kind === "info") setTimeout(() => dismiss(id), n.action ? 8000 : 4500);
  return id;
}

/** Small messages in the corner of the screen. `detail` may be the error that was caught. */
export const notify = {
  error: (title: string, detail?: unknown, action?: NoticeAction) => push({ kind: "error", title, detail: messageOf(detail), action }),
  info: (text: string, action?: NoticeAction) => push({ kind: "info", title: text, action }),
  dismiss,
};

function ConfirmDialog({ q }: { q: Question }) {
  return (
    <Modal title={q.title} onClose={() => q.answer("cancel")}
      footer={q.preferredLabel ? <>
        <button className={`btn ${q.danger ? "danger" : ""}`} onClick={() => q.answer("confirm")}>{q.confirmLabel ?? "OK"}</button>
        <span className="spacer" />
        <button className="btn" onClick={() => q.answer("cancel")}>{q.cancelLabel ?? "Cancel"}</button>
        <button className="btn primary" data-autofocus="" onClick={() => q.answer("preferred")}>{q.preferredLabel}</button>
      </> : <>
        <span className="spacer" />
        <button className="btn" data-autofocus={q.danger ? "" : undefined} onClick={() => q.answer("cancel")}>{q.cancelLabel ?? "Cancel"}</button>
        <button className={`btn primary ${q.danger ? "danger" : ""}`} data-autofocus={q.danger ? undefined : ""} onClick={() => q.answer("confirm")}>{q.confirmLabel ?? "OK"}</button>
      </>}>
      <div className="confirm-body">{q.body ?? "Are you sure?"}</div>
    </Modal>
  );
}

/** Mounted once, at the top of the app: shows the open question and the notices. */
/**
 * A bar stuck to the bottom of the window (unsaved changes, with Save and Discard): while it is
 * there, the messages bottom right are lifted above it, so that they never cover its buttons.
 */
export function useBottomBar(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!active || !el) return;
    const set = () => root.style.setProperty("--bottom-bar", `${Math.ceil(el.getBoundingClientRect().height) + 12}px`);
    set();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    watch?.observe(el);
    return () => { watch?.disconnect(); root.style.removeProperty("--bottom-bar"); };
  }, [ref, active]);
}

export function Notices() {
  const state = useSyncExternalStore(subscribe, () => ui);
  return (
    <>
      {state.question && <ConfirmDialog q={state.question} />}
      <div className="toasts" aria-label="Messages">
        {state.notices.map((n) => (
          <div key={n.id} className={`toast ${n.kind}`} role={n.kind === "error" ? "alert" : "status"}>
            {n.kind === "error" ? <CircleAlert size={16} /> : <CircleCheck size={16} />}
            <p><strong>{n.title}</strong>{n.detail && <span>{n.detail}</span>}</p>
            {n.action && <button className="btn small" onClick={() => { n.action!.run(); dismiss(n.id); }}>{n.action.label}</button>}
            <button className="icon-btn" onClick={() => dismiss(n.id)} aria-label="Close this message"><X size={15} /></button>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------- loading, failed loading and crashes

export function Loading({ page, label = "Loading…" }: { page?: boolean; label?: string }) {
  const text = <p className="muted loading" role="status">{label}</p>;
  return page ? <div className="page">{text}</div> : text;
}

/** Something could not be loaded: say so, and offer to try again. Never looks like an empty list. */
export function LoadError({ what, error, onRetry }: { what: string; error?: string; onRetry?: () => void }) {
  return (
    <div className="check bad load-error" role="alert">
      <CircleAlert size={16} />
      <span><b>{what}</b>{error ? ` ${error}` : ""}</span>
      {onRetry && <button className="btn small" onClick={onRetry}><RotateCcw size={14} />Try again</button>}
    </div>
  );
}

/** Keeps a crash in one page from blanking the whole app. `resetKey` changes when the reader goes elsewhere. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page crash" role="alert">
        <h1>Something went wrong on this page</h1>
        <p className="lead">The page could not be shown. Nothing you saved is lost. Reload the page, or go back to the start and try again.</p>
        <div className="btn-row">
          <button className="btn primary" onClick={() => window.location.reload()}><RotateCcw size={16} />Reload</button>
          <button className="btn" onClick={() => { window.location.hash = "#/"; this.setState({ error: null }); }}>Back to the start</button>
        </div>
        <p className="muted small crash-detail">Details for support: {this.state.error.message}</p>
      </div>
    );
  }
}

export function CopyButton({ text, label, primary, icon }: { text: () => string; label: string; primary?: boolean; icon?: ReactNode }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className={`btn ${primary ? "primary" : ""}`}
      onClick={async () => { if (await copyText(text())) { setOk(true); setTimeout(() => setOk(false), 1600); } }}
    >
      {ok ? <Check size={16} /> : icon ?? <Copy size={16} />}
      {ok ? "Copied" : label}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint && <em>{hint}</em>}</span>
      {children}
    </label>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="issues">
      {issues.map((i, k) => (
        <li key={k} className={i.level}>
          {i.level === "error" ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}
          <span><code>{i.path}</code> {i.message}</span>
        </li>
      ))}
    </ul>
  );
}
