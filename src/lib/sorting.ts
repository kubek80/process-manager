import { useCallback, useState } from "react";
import type { DocMeta, TargetKind } from "../types";
import { dayOf, daysBetween, isDay, today } from "./dates";

// The order of the lists and the search results: the best match (with a search) or by name,
// the newest first (when it was added), or the most recently updated first. The dates come from
// what the server says about each process and standard (`meta`).

/** "" is the usual order: the best match when something is searched for, else by name. */
export type SortKey = "" | "newest" | "updated";
export const SORT_KEYS: SortKey[] = ["", "newest", "updated"];

/** What the server says about each process and standard, by kind and id. */
export type MetaByKind = Partial<Record<TargetKind, Record<string, DocMeta | undefined>>>;

/** A sort from the address or from storage; anything else is the usual order. */
export const sortOf = (v: unknown): SortKey => (v === "newest" || v === "updated" ? v : "");

/** The name of an order as the "Sort by" control shows it. */
export function sortLabel(key: SortKey, searched: boolean): string {
  if (key === "newest") return "Newest";
  if (key === "updated") return "Recently updated";
  return searched ? "Best match" : "Name";
}

/** When it was added: the first version; an older server only says when it was last saved. */
export const addedAt = (m?: DocMeta) => m?.createdAt || m?.updatedAt || "";
export const updatedAt = (m?: DocMeta) => m?.updatedAt || "";

interface Sortable { kind: TargetKind; doc: { id: string; title?: unknown } }

const title = (r: Sortable) => (typeof r.doc.title === "string" ? r.doc.title : "");
const time = (s: string) => { const t = Date.parse(s); return Number.isFinite(t) ? t : -Infinity; };

/**
 * The results in the chosen order. The usual order ("") keeps them as they are (the search
 * already put the best match or the name first). By date, the newest first; what has no date
 * comes last; the same date goes by name. The list given is not changed.
 */
export function sortResults<T extends Sortable>(results: T[], key: SortKey, meta: MetaByKind | undefined): T[] {
  if (!key) return results;
  const at = key === "newest" ? addedAt : updatedAt;
  const when = (r: T) => time(at(meta?.[r.kind]?.[r.doc.id]));
  return results
    .map((r, i) => ({ r, i, t: when(r) }))
    .sort((a, b) => (b.t === a.t ? 0 : b.t > a.t ? 1 : -1) || title(a.r).localeCompare(title(b.r)) || a.i - b.i)
    .map((x) => x.r);
}

const storeKey = (list: string, email?: string) => `pm:sort:${list}:${email ?? ""}`;

/** The order somebody chose for a list, remembered in this browser for that person. */
export function useRememberedSort(list: string, email?: string): [SortKey, (k: SortKey) => void] {
  const key = storeKey(list, email);
  const [state, setState] = useState<{ key: string; sort: SortKey }>(() => ({ key, sort: read(key) }));
  // another person signed in (or the email arrived after the first render): their own choice
  const sort = state.key === key ? state.sort : read(key);
  if (state.key !== key) setState({ key, sort });
  const change = useCallback((k: SortKey) => {
    setState({ key, sort: k });
    try { if (k) localStorage.setItem(key, k); else localStorage.removeItem(key); } catch { /* private mode: it lasts for this page */ }
  }, [key]);
  return [sort, change];
}

function read(key: string): SortKey {
  try { return sortOf(localStorage.getItem(key)); } catch { return ""; }
}

// ---------- what Home shows: recently updated, most viewed

interface Listed extends Sortable { doc: { id: string; title?: unknown; status?: unknown } }

/**
 * Only what everybody may see on Home's short lists: published and in use (no draft, never
 * published or not; nothing retired).
 */
export const shownOnHome = (r: Listed) => r.doc.status === undefined || r.doc.status === "active";

/** The `n` most recently updated, newest first; what has no date is left out. */
export function recentlyUpdated<T extends Listed>(results: T[], meta: MetaByKind | undefined, n: number): { item: T; at: string }[] {
  return results.filter(shownOnHome)
    .map((r) => ({ item: r, at: updatedAt(meta?.[r.kind]?.[r.doc.id]) }))
    .filter((x) => Number.isFinite(Date.parse(x.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || title(a.item).localeCompare(title(b.item)))
    .slice(0, n);
}

/** The `n` most viewed, most first; what nobody opened yet is left out. */
export function mostViewed<T extends Listed>(results: T[], views: (r: T) => number, n: number): { item: T; views: number }[] {
  return results.filter(shownOnHome)
    .map((r) => ({ item: r, views: views(r) }))
    .filter((x) => x.views > 0)
    .sort((a, b) => b.views - a.views || title(a.item).localeCompare(title(b.item)))
    .slice(0, n);
}

/**
 * When something was updated, in words: "today", "yesterday", "3 days ago", "2 weeks ago", else
 * the date. Days are the reader's (`zone`: the browser's by default): a save at 23:30 in Los
 * Angeles is "today" there, though it is already tomorrow in UTC. A day without a time is used as written.
 */
export function agoText(at: string, now: Date = new Date(), zone?: string): string {
  const day = dayOf(at, zone);
  if (!isDay(day)) return "";
  const days = daysBetween(day, today(now, zone));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 56) return `${Math.floor(days / 7)} weeks ago`;
  return day;
}
