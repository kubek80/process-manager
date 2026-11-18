/**
 * The state of something being edited: what the server has, the version the edits started from,
 * the edits themselves and the steps that can be undone. Plain functions, so that the rules
 * ("typing during a save is kept", "a newer version is never overwritten silently") can be
 * tested without a browser. The hook in draft.ts wires them to React.
 */
export interface DraftState<T> {
  /** The document as the server has it at version `base`. */
  saved: T;
  /** The version the draft is based on. 0: it does not exist on the server yet. */
  base: number;
  draft: T;
  past: T[];
  future: T[];
  /** When the last change was made, to treat a burst of typing as one step to undo. */
  editedAt: number;
  /** Which single value the last change touched (see fieldChanged); null: more than one, or a change of structure. */
  editedField: string | null;
}

/** How many steps back can be undone. */
export const UNDO_LIMIT = 100;
/** Changes to the same text closer together than this count as one step: a word, not every letter. */
export const BURST_MS = 800;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The one value in which two documents differ, as a path such as "steps.2.title" - or null
 * when they differ in more than one place or in their structure. Typing in a field changes
 * exactly one value; deleting a step, adding a line or restoring a version does not.
 */
export function fieldChanged(a: unknown, b: unknown, path = ""): string | null {
  if (a === b) return "";
  const leaf = (v: unknown) => v === null || typeof v !== "object";
  if (leaf(a) || leaf(b)) return leaf(a) && leaf(b) && typeof a === typeof b ? path || "." : null;
  if (Array.isArray(a) !== Array.isArray(b)) return null;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return null;
  let found = "";
  for (const k of ka) {
    const inner = fieldChanged((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    if (inner === null || (inner && found)) return null;
    found = found || inner;
  }
  return found;
}

export function start<T>(saved: T, version: number): DraftState<T> {
  return { saved, base: version, draft: saved, past: [], future: [], editedAt: 0, editedField: null };
}

/**
 * Whether there is something to save. Both sides are tidied: a document that was stored with,
 * say, an empty list of tags is not "changed" just because tidying would drop it.
 */
export function isDirty<T>(s: DraftState<T>, tidy: (d: T) => T): boolean {
  return !same(tidy(s.draft), tidy(s.saved));
}

/** A change by the editor. `now` is the time in milliseconds. */
export function edit<T>(s: DraftState<T>, next: T, now: number): DraftState<T> {
  if (same(next, s.draft)) return s;
  // more typing in the same field joins the step before it; everything else is a step of its own
  const field = fieldChanged(s.draft, next) || null;
  const burst = s.past.length > 0 && field !== null && field === s.editedField && now - s.editedAt < BURST_MS;
  const past = burst ? s.past : [...s.past, s.draft].slice(-UNDO_LIMIT);
  return { ...s, draft: next, past, future: [], editedAt: now, editedField: field };
}

export function undo<T>(s: DraftState<T>): DraftState<T> {
  if (!s.past.length) return s;
  return { ...s, draft: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.draft, ...s.future], editedAt: 0, editedField: null };
}

export function redo<T>(s: DraftState<T>): DraftState<T> {
  if (!s.future.length) return s;
  return { ...s, draft: s.future[0], past: [...s.past, s.draft], future: s.future.slice(1), editedAt: 0, editedField: null };
}

/** Throw the edits away. It can be undone, like every other change. */
export function discard<T>(s: DraftState<T>, now: number): DraftState<T> {
  return edit({ ...s, editedAt: 0, editedField: null }, s.saved, now);
}

/**
 * Our own save went through: the server now has `sent` as `version`. Whatever was typed while
 * the save was on its way stays in the draft and simply counts as unsaved.
 */
export function savedAs<T>(s: DraftState<T>, sent: T, version: number, tidy: (d: T) => T, tidied: T = sent): DraftState<T> {
  // `tidied` is the draft as it was when the save started; `sent` may differ from it by what
  // the save itself adds, such as the date
  const untouched = same(tidy(s.draft), tidied);
  return { ...s, saved: sent, base: version, draft: untouched ? sent : s.draft };
}

/**
 * The server has a version we did not write (somebody else saved, or the page was refreshed).
 * Without edits of our own we simply follow it. With edits we keep them and keep the old base,
 * so that our next save is refused and the two versions can be compared - never overwritten
 * silently.
 */
export function serverHas<T>(s: DraftState<T>, saved: T, version: number, tidy: (d: T) => T): DraftState<T> {
  if (version === s.base && same(saved, s.saved)) return s;
  // An answer that is older than what we already have (a refresh that was on its way while we
  // saved) is not news: following it would put the old content back on screen.
  if (version < s.base) return s;
  if (isDirty(s, tidy)) return s;
  return start(saved, version);
}

/** Thrown by a save when somebody else saved (or deleted) first. */
export interface Conflict {
  /** false: it was deleted in the meantime. */
  exists: boolean;
  version?: number;
  updatedBy?: string;
  updatedAt?: string;
  /** The name of whoever saved, when the server knew it. */
  updatedByName?: string;
  /** The conflict is about the working draft (its revision), not about the published versions. */
  draft?: boolean;
}
