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
  /** Stores the document on top of version `base` and returns the new version. */
  save: (doc: T, base: number, note: string) => Promise<number>;
  /** Fetches what the server has now: used to take over somebody else's version. */
  reload: () => Promise<{ saved: T; version: number } | null>;
  /** What to call it when asking before leaving, e.g. "this process". */
  what: string;
}

export interface Draft<T> {
  draft: T;
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
  /** Saves; resolves to true when it went through. A refused save sets `conflict`. */
  save: (note?: string) => Promise<boolean>;
  conflict: Conflict | null;
  /** Save my version on top of theirs. */
  keepMine: (note?: string) => Promise<boolean>;
  /** Drop my edits (they can be undone) and continue from their version. */
  takeTheirs: () => Promise<void>;
  dismissConflict: () => void;
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

  // the server has something we did not write
  useEffect(() => {
    setState((s) => serverHas(s, saved, version, opts.current.tidy));
  }, [saved, version]);

  const clean = useMemo(() => tidy(state.draft), [state.draft, tidy]);
  const dirty = useMemo(() => isDirty(state, tidy), [state, tidy]);

  const change = useCallback((next: T | ((d: T) => T)) => {
    setState((s) => edit(s, typeof next === "function" ? (next as (d: T) => T)(s.draft) : next, Date.now()));
  }, []);

  const latest = useRef(state);
  latest.current = state;

  const send = useCallback(async (base: number, note: string): Promise<boolean> => {
    const sent = opts.current.tidy(latest.current.draft);
    setSaving(true);
    setError(null);
    try {
      const newVersion = await opts.current.save(sent, base, note);
      setState((s) => savedAs(s, sent, newVersion, opts.current.tidy));
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

  const save = useCallback((note = "") => send(latest.current.base, note), [send]);
  const keepMine = useCallback((note = "") => send(conflict?.exists ? (conflict.version ?? 0) : 0, note), [send, conflict]);
  const takeTheirs = useCallback(async () => {
    const now = await opts.current.reload();
    setConflict(null);
    if (!now) return; // it is gone: the page that shows it will notice
    // their version becomes the base; my edits remain one Undo away
    setState((s) => ({ ...edit({ ...s, editedAt: 0 }, now.saved, Date.now()), saved: now.saved, base: now.version }));
  }, []);

  // leaving the page with unsaved edits asks first: closing the tab, and moving on inside the app
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    const release = guardLeaving(docKey, opts.current.what);
    return () => { window.removeEventListener("beforeunload", warn); release(); };
  }, [dirty, docKey]);

  // Ctrl+Z / Ctrl+Shift+Z (Cmd on a Mac) - except while typing, where the field has its own undo
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.closest(".cm-editor"))) return;
      e.preventDefault();
      setState(e.shiftKey ? redo : undo);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return {
    draft: state.draft, clean, dirty, saving, base: state.base, behind: version > state.base,
    change,
    discard: useCallback(() => setState((s) => discard(s, Date.now())), []),
    undo: useCallback(() => setState(undo), []),
    redo: useCallback(() => setState(redo), []),
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    save, conflict, keepMine, takeTheirs, dismissConflict: useCallback(() => setConflict(null), []),
    error, clearError: useCallback(() => setError(null), []),
  };
}
