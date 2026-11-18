import { useCallback, useState } from "react";
import type { DocMeta, TargetKind } from "../types";

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
