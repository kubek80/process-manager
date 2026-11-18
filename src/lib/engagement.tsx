import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TargetKind } from "../types";
import { loadEngagement, recordViewOn, setBookmark, setUpvote, type EngagementData } from "./store";
import { notify } from "../components/ui";

/** How much a process or standard is used. All-time numbers from the server. */
export interface Counts { views: number; people: number; downloads: number; upvotes: number; handled: number }
export const NO_COUNTS: Counts = Object.freeze({ views: 0, people: 0, downloads: 0, upvotes: 0, handled: 0 });

export interface Bookmark { kind: TargetKind; id: string; at: string }

export interface EngagementApi {
  /** False until the first answer of the server (or its refusal) is in. */
  ready: boolean;
  /** The numbers and the person's bookmarks and upvotes are loaded: what this says is known. */
  known: boolean;
  /** They could not be loaded. Show no numbers then: zeros would look like facts. */
  failed: boolean;
  /** Bookmarked or not; undefined while that is not known (still loading, or the load failed). */
  bookmarkState(kind: TargetKind, id: string): boolean | undefined;
  /** Upvoted by the person or not; undefined while that is not known. */
  upvoteState(kind: TargetKind, id: string): boolean | undefined;
  /** The number of upvotes; undefined while it is not known. */
  upvotesOf(kind: TargetKind, id: string): number | undefined;
  countsOf(kind: TargetKind, id: string): Counts;
  isBookmarked(kind: TargetKind, id: string): boolean;
  hasUpvoted(kind: TargetKind, id: string): boolean;
  /** The person's bookmarks, newest first. */
  bookmarks: Bookmark[];
  /** Optimistic: the change shows at once and is put back when the server refuses it. */
  toggleBookmark(kind: TargetKind, id: string): Promise<void>;
  toggleUpvote(kind: TargetKind, id: string): Promise<void>;
  /** Counts that the person opened it; once per page load and document. Fire and forget. */
  recordView(kind: TargetKind, id: string): void;
  reload(): void;
}

export const EMPTY_ENGAGEMENT: EngagementData = { counts: { process: {}, standard: {} }, mine: { bookmarks: [], upvotes: [] } };

// ---- pure helpers (tested)

export const keyOf = (kind: TargetKind, id: string) => `${kind}/${id}`;

/** The counts of one document; absent numbers are zero. */
export function countsIn(data: EngagementData, kind: TargetKind, id: string): Counts {
  const c = data.counts[kind]?.[id];
  if (!c) return NO_COUNTS;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return { views: n(c.views), people: n(c.people), downloads: n(c.downloads), upvotes: n(c.upvotes), handled: n(c.handled) };
}

/** `data` with the bookmark on or off. */
export function withBookmark(data: EngagementData, kind: TargetKind, id: string, on: boolean, at = new Date().toISOString()): EngagementData {
  const rest = data.mine.bookmarks.filter((b) => !(b.kind === kind && b.id === id));
  return { ...data, mine: { ...data.mine, bookmarks: on ? [{ kind, id, at }, ...rest] : rest } };
}

/** `data` with the person's upvote on or off; the count follows (or is `count` when the server said so). */
export function withUpvote(data: EngagementData, kind: TargetKind, id: string, on: boolean, count?: number): EngagementData {
  const had = data.mine.upvotes.some((u) => u.kind === kind && u.id === id);
  const rest = data.mine.upvotes.filter((u) => !(u.kind === kind && u.id === id));
  const before = countsIn(data, kind, id);
  const upvotes = count ?? Math.max(0, before.upvotes + (on === had ? 0 : on ? 1 : -1));
  return {
    counts: { ...data.counts, [kind]: { ...data.counts[kind], [id]: { ...before, upvotes } } },
    mine: { ...data.mine, upvotes: on ? [...rest, { kind, id }] : rest },
  };
}

/** `data` with the views and people of one document at least `views` and `people` (a view was just recorded). */
export function withViews(data: EngagementData, kind: TargetKind, id: string, views: number, people: number): EngagementData {
  const before = countsIn(data, kind, id);
  return { ...data, counts: { ...data.counts, [kind]: { ...data.counts[kind], [id]: { ...before, views: Math.max(before.views, views), people: Math.max(before.people, people) } } } };
}

/**
 * A change made here that the numbers from the server may not contain yet. `settled` is the
 * number of the last load started before the server confirmed it; null while it is on its way.
 */
export interface Change { key: string; apply: (d: EngagementData) => EngagementData; settled: number | null }

/**
 * Numbers from the server (from the load numbered `load`) with the changes made here laid over
 * them, so that an answer that set off before a click never undoes it. A change is dropped once a
 * load that started after the server confirmed it has come back: that load contains it.
 */
export function mergeLoaded(loaded: EngagementData, changes: Change[], load: number): { data: EngagementData; keep: Change[] } {
  const keep = changes.filter((c) => c.settled === null || load <= c.settled);
  return { data: keep.reduce((d, c) => c.apply(d), loaded), keep };
}

/** Newest first. */
export const sortBookmarks = (b: Bookmark[]) => [...b].sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));

// ---- the provider

const noop = async () => {};
const EngagementContext = createContext<EngagementApi>({
  ready: false, known: false, failed: false, countsOf: () => NO_COUNTS, isBookmarked: () => false, hasUpvoted: () => false,
  bookmarkState: () => undefined, upvoteState: () => undefined, upvotesOf: () => undefined, bookmarks: [],
  toggleBookmark: noop, toggleUpvote: noop, recordView: () => {}, reload: () => {},
});

type Status = "loading" | "ready" | "failed";

export function EngagementProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<EngagementData>(EMPTY_ENGAGEMENT);
  const [status, setStatus] = useState<Status>("loading");
  const live = useRef(data);
  live.current = data;
  const seen = useRef(new Set<string>());
  const busy = useRef(new Set<string>());
  const changes = useRef<Change[]>([]);
  const loads = useRef({ started: 0, applied: 0 });
  // what the person changed here: known even while the numbers are not
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  /** Records a change made here, applies it now and keeps it over loads until the server has it. */
  const change = (c: Change) => {
    changes.current = [...changes.current.filter((x) => x.key !== c.key), c];
    setData((d) => c.apply(d));
    setTouched((t) => (t.has(c.key) ? t : new Set(t).add(c.key)));
  };
  const settle = (key: string, apply?: Change["apply"]) => {
    const c = changes.current.find((x) => x.key === key);
    if (!c) return;
    c.settled = loads.current.started;
    if (apply) { c.apply = apply; setData((d) => apply(d)); }
  };
  const undo = (key: string, revert: Change["apply"]) => {
    changes.current = changes.current.filter((x) => x.key !== key);
    setData((d) => revert(d));
  };

  const reload = useCallback(() => {
    const load = ++loads.current.started;
    loadEngagement().then((loaded) => {
      if (load < loads.current.applied) return; // a newer answer is already shown
      loads.current.applied = load;
      const merged = mergeLoaded(loaded, changes.current, load);
      changes.current = merged.keep;
      setData(merged.data);
      setStatus("ready");
    }, () => {
      // Not shown as an error: the pages say the numbers are not available. Numbers shown before stay.
      setStatus((s) => (s === "ready" ? s : "failed"));
    });
  }, []);
  useEffect(reload, [reload]);

  const toggleBookmark = useCallback(async (kind: TargetKind, id: string) => {
    const key = `b:${keyOf(kind, id)}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    // not known whether it is bookmarked: the click bookmarks it (asking twice changes nothing)
    const on = !live.current.mine.bookmarks.some((b) => b.kind === kind && b.id === id);
    const at = new Date().toISOString();
    change({ key, apply: (d) => withBookmark(d, kind, id, on, at), settled: null });
    try {
      await setBookmark(kind, id, on);
      settle(key);
    } catch (e) {
      undo(key, (d) => withBookmark(d, kind, id, !on));
      notify.error(on ? "The bookmark could not be added." : "The bookmark could not be removed.", e);
    } finally { busy.current.delete(key); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleUpvote = useCallback(async (kind: TargetKind, id: string) => {
    const key = `u:${keyOf(kind, id)}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    const on = !live.current.mine.upvotes.some((u) => u.kind === kind && u.id === id);
    change({ key, apply: (d) => withUpvote(d, kind, id, on), settled: null });
    try {
      const r = await setUpvote(kind, id, on);
      const n = typeof r?.upvotes === "number" ? r.upvotes : undefined;
      settle(key, n === undefined ? undefined : (d) => withUpvote(d, kind, id, on, n));
    } catch (e) {
      undo(key, (d) => withUpvote(d, kind, id, !on));
      notify.error(on ? "Your upvote could not be recorded." : "Your upvote could not be taken back.", e);
    } finally { busy.current.delete(key); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const recordView = useCallback((kind: TargetKind, id: string) => {
    const k = keyOf(kind, id);
    if (seen.current.has(k)) return;
    seen.current.add(k);
    // the answer has the document's numbers after this view: they replace only that document's
    recordViewOn(kind, id).then((r) => {
      if (typeof r?.views !== "number") return; // an older server answers with nothing
      const views = r.views, people = typeof r.people === "number" ? r.people : 0;
      const c: Change = { key: `v:${k}`, apply: (d) => withViews(d, kind, id, views, people), settled: loads.current.started };
      changes.current = [...changes.current.filter((x) => x.key !== c.key), c];
      setData((d) => c.apply(d));
    }, () => {});
  }, []);

  const api = useMemo<EngagementApi>(() => {
    const bookmarked = new Set(data.mine.bookmarks.map((b) => keyOf(b.kind, b.id)));
    const upvoted = new Set(data.mine.upvotes.map((u) => keyOf(u.kind, u.id)));
    const known = status === "ready";
    return {
      ready: status !== "loading",
      known,
      failed: status === "failed",
      countsOf: (kind, id) => countsIn(data, kind, id),
      isBookmarked: (kind, id) => bookmarked.has(keyOf(kind, id)),
      hasUpvoted: (kind, id) => upvoted.has(keyOf(kind, id)),
      bookmarkState: (kind, id) => (known || touched.has(`b:${keyOf(kind, id)}`) ? bookmarked.has(keyOf(kind, id)) : undefined),
      upvoteState: (kind, id) => (known || touched.has(`u:${keyOf(kind, id)}`) ? upvoted.has(keyOf(kind, id)) : undefined),
      upvotesOf: (kind, id) => (known ? countsIn(data, kind, id).upvotes : undefined),
      bookmarks: sortBookmarks(data.mine.bookmarks),
      toggleBookmark, toggleUpvote, recordView, reload,
    };
  }, [data, status, touched, toggleBookmark, toggleUpvote, recordView, reload]);

  return <EngagementContext.Provider value={api}>{children}</EngagementContext.Provider>;
}

export const useEngagement = (): EngagementApi => useContext(EngagementContext);
