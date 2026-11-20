import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Conflict, type DraftState, discard, edit, isDirty, redo, savedAs, serverHas, start, undo } from "./draftState";
import { guardLeaving } from "./store";

export type { Conflict } from "./draftState";

/** A save that was refused because somebody else saved (or deleted) first. */
export const conflictOf = (e: unknown): Conflict | null => (e && typeof e === "object" && "conflict" in e ? ((e as { conflict?: Conflict }).conflict ?? null) : null);

export interface DraftOptions<T> {
  /** Identifies what is edited (e.g. "process/request-gcp-project"): another key starts afresh. */
  docKey: string;
  /** What the server has, and its version (0: not saved yet). */
  saved: T;
  version: number;
  /** Removes empty optional parts before comparing and saving. */
  tidy: (d: T) => T;
  /** Added to the document just before it is sent, e.g. the date of the save. */
  stamp?: (d: T) => T;
  /** Stores the document on top of version `base` and returns the new version. */
  save: (doc: T, base: number, note: string) => Promise<number>;
  /** Fetches what the server has now: used to take over somebody else's version. */
  reload: () => Promise<{ saved: T; version: number } | null>;
  /** What to call it when asking before leaving, e.g. "this process". */
  what: string;
  /** false: this person only reads. Nothing is guarded for them unless they changed something. */
  editable?: boolean;
}

export interface Draft<T> {
  draft: T;
  /** What the server has at version `base`: what the edits are compared with. */
  saved: T;
  /** The draft as it would be saved. */
  clean: T;
  dirty: boolean;
  saving: boolean;
  /** The version the edits are based on. */
  base: number;
  /** The server has a newer version than the one the edits are based on. */
  behind: boolean;
  change: (next: T | ((d: T) => T)) => void;
  discard: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** What Undo would bring back (the document before the last change), if anything. */
  previous?: T;
  /** The last Undo or Redo: what was on screen before it and what it brought back; `n` counts them. */
  stepped: { dir: "undo" | "redo"; from: T; to: T; n: number } | null;
  /**
   * Saves; resolves to true when it went through. A refused save sets `conflict`. `finish` is
   * applied to what is sent, e.g. the status "active" when a draft is published; "Save mine
   * over theirs" after a refused save applies it again.
   */
  save: (note?: string, finish?: (d: T) => T) => Promise<boolean>;
  conflict: Conflict | null;
  /** Save my version on top of theirs. */
  keepMine: (note?: string) => Promise<boolean>;
  /** Drop my edits (they can be undone) and continue from their version. */
  takeTheirs: () => Promise<void>;
  dismissConflict: () => void;
  /** Shows the "somebody else saved first" question without trying to save. */
  raiseConflict: (c: Conflict) => void;
  /** The last error of a save that was not a conflict. */
  error: string | null;
  clearError: () => void;
}

/**
 * Editing with a safety net, shared by processes, standards and the lists: unsaved edits are
 * never dropped without asking, steps can be undone, and a version somebody else saved in the
 * meantime is never overwritten silently.
 */
export function useDraft<T>(o: DraftOptions<T>): Draft<T> {
  const { docKey, saved, version, tidy } = o;
  const [state, setState] = useState<DraftState<T>>(() => start(saved, version));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opts = useRef(o);
  opts.current = o;

  // another document: start afresh
  const key = useRef(docKey);
  if (key.current !== docKey) {
    key.current = docKey;
    setState(start(saved, version));
    setConflict(null);
    setError(null);
  }

  const clean = useMemo(() => tidy(state.draft), [state.draft, tidy]);
  const dirty = useMemo(() => isDirty(state, tidy), [state, tidy]);

  // The server has something we did not write. A page without edits follows it - also one
  // that just became clean again (Discard, Undo) while a newer version was waiting.
  useEffect(() => {
    setState((s) => serverHas(s, saved, version, opts.current.tidy));
  }, [saved, version, dirty]);

  const change = useCallback((next: T | ((d: T) => T)) => {
    setState((s) => edit(s, typeof next === "function" ? (next as (d: T) => T)(s.draft) : next, Date.now()));
  }, []);

  const latest = useRef(state);
  latest.current = state;

  // Undo and Redo, from the bar or the keys: what they changed is remembered, so the screen can
  // say it and bring it into view
  const [stepped, setStepped] = useState<Draft<T>["stepped"]>(null);
  const step = useCallback((dir: "undo" | "redo") => {
    const s = latest.current;
    const to = dir === "undo" ? s.past[s.past.length - 1] : s.future[0];
    if (to === undefined) return;
    setStepped((x) => ({ dir, from: s.draft, to, n: (x?.n ?? 0) + 1 }));
    setState(dir === "undo" ? undo : redo);
  }, []);

  // what the last save added to the document, for "Save mine over theirs" after it was refused
  const finishing = useRef<((d: T) => T) | undefined>(undefined);
  const send = useCallback(async (base: number, note: string): Promise<boolean> => {
    const tidied = opts.current.tidy(latest.current.draft);
    const finished = finishing.current ? finishing.current(tidied) : tidied;
    const sent = opts.current.stamp ? opts.current.stamp(finished) : finished;
    setSaving(true);
    setError(null);
    try {
      const newVersion = await opts.current.save(sent, base, note);
      setState((s) => savedAs(s, sent, newVersion, opts.current.tidy, tidied));
      setConflict(null);
      return true;
    } catch (e) {
      const c = conflictOf(e);
      if (c) setConflict(c);
      else setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const save = useCallback((note = "", finish?: (d: T) => T) => { finishing.current = finish; return send(latest.current.base, note); }, [send]);
  const keepMine = useCallback((note = "") => send(conflict?.exists ? (conflict.version ?? 0) : 0, note), [send, conflict]);
  const takeTheirs = useCallback(async () => {
    let now: { saved: T; version: number } | null;
    try { now = await opts.current.reload(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    setConflict(null);
    if (!now) return; // it is gone: the page that shows it will notice
    const theirs = now;
    // their version becomes the base; my edits remain one Undo away
    setState((s) => ({ ...edit({ ...s, editedAt: 0, editedField: null }, theirs.saved, Date.now()), saved: theirs.saved, base: theirs.version }));
  }, []);

  // Leaving with unsaved edits asks first: closing the tab, and moving on inside the app.
  // Somebody who only reads has nothing to lose, unless they did change something.
  const guarded = dirty && (o.editable !== false || state.past.length > 0);
  useEffect(() => (guarded ? guardLeaving(docKey, opts.current.what) : undefined), [guarded, docKey]);

  const stepRef = useRef(step);
  stepRef.current = step;
  // Ctrl+Z / Ctrl+Shift+Z (Cmd on a Mac) - except while typing, where the field has its own undo
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.closest(".cm-editor"))) return;
      e.preventDefault();
      stepRef.current(e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return {
    draft: state.draft, saved: state.saved, clean, dirty, saving, base: state.base, behind: version > state.base,
    change,
    discard: useCallback(() => setState((s) => discard(s, Date.now())), []),
    undo: useCallback(() => step("undo"), [step]),
    redo: useCallback(() => step("redo"), [step]),
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    previous: state.past[state.past.length - 1], stepped,
    save, conflict, keepMine, takeTheirs, dismissConflict: useCallback(() => setConflict(null), []),
    raiseConflict: useCallback((c: Conflict) => setConflict(c), []),
    error, clearError: useCallback(() => setError(null), []),
  };
}
