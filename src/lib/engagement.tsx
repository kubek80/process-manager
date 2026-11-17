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

/** Newest first. */
export const sortBookmarks = (b: Bookmark[]) => [...b].sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));

// ---- the provider

const noop = async () => {};
const EngagementContext = createContext<EngagementApi>({
  ready: false, countsOf: () => NO_COUNTS, isBookmarked: () => false, hasUpvoted: () => false, bookmarks: [],
  toggleBookmark: noop, toggleUpvote: noop, recordView: () => {}, reload: () => {},
});

export function EngagementProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<EngagementData>(EMPTY_ENGAGEMENT);
  const [ready, setReady] = useState(false);
  const live = useRef(data);
  live.current = data;
  const seen = useRef(new Set<string>());
  const busy = useRef(new Set<string>());

  const reload = useCallback(() => {
    // An older server has no numbers yet: that is "nothing yet", not an error to show.
    loadEngagement().then(setData, () => {}).finally(() => setReady(true));
  }, []);
  useEffect(reload, [reload]);

  const toggleBookmark = useCallback(async (kind: TargetKind, id: string) => {
    const k = `b:${keyOf(kind, id)}`;
    if (busy.current.has(k)) return;
    busy.current.add(k);
    const on = !live.current.mine.bookmarks.some((b) => b.kind === kind && b.id === id);
    setData((d) => withBookmark(d, kind, id, on));
    try { await setBookmark(kind, id, on); } catch (e) {
      setData((d) => withBookmark(d, kind, id, !on));
      notify.error(on ? "The bookmark could not be added." : "The bookmark could not be removed.", e);
    } finally { busy.current.delete(k); }
  }, []);

  const toggleUpvote = useCallback(async (kind: TargetKind, id: string) => {
    const k = `u:${keyOf(kind, id)}`;
    if (busy.current.has(k)) return;
    busy.current.add(k);
    const on = !live.current.mine.upvotes.some((u) => u.kind === kind && u.id === id);
    setData((d) => withUpvote(d, kind, id, on));
    try {
      const r = await setUpvote(kind, id, on);
      if (typeof r?.upvotes === "number") setData((d) => withUpvote(d, kind, id, on, r.upvotes));
    } catch (e) {
      setData((d) => withUpvote(d, kind, id, !on));
      notify.error(on ? "Your upvote could not be recorded." : "Your upvote could not be taken back.", e);
    } finally { busy.current.delete(k); }
  }, []);

  const recordView = useCallback((kind: TargetKind, id: string) => {
    const k = keyOf(kind, id);
    if (seen.current.has(k)) return;
    seen.current.add(k);
    const first = countsIn(live.current, kind, id).views === 0;
    // the first view of something shows at once: fetch the numbers again
    recordViewOn(kind, id).then(() => { if (first) reload(); }, () => {});
  }, [reload]);

  const api = useMemo<EngagementApi>(() => {
    const bookmarked = new Set(data.mine.bookmarks.map((b) => keyOf(b.kind, b.id)));
    const upvoted = new Set(data.mine.upvotes.map((u) => keyOf(u.kind, u.id)));
    return {
      ready,
      countsOf: (kind, id) => countsIn(data, kind, id),
      isBookmarked: (kind, id) => bookmarked.has(keyOf(kind, id)),
      hasUpvoted: (kind, id) => upvoted.has(keyOf(kind, id)),
      bookmarks: sortBookmarks(data.mine.bookmarks),
      toggleBookmark, toggleUpvote, recordView, reload,
    };
  }, [data, ready, toggleBookmark, toggleUpvote, recordView, reload]);

  return <EngagementContext.Provider value={api}>{children}</EngagementContext.Provider>;
}

export const useEngagement = (): EngagementApi => useContext(EngagementContext);
