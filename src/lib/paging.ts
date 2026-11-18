import { useCallback, useEffect, useState } from "react";

// Pages of a list: which items a page shows, which page numbers the pager offers, and how many
// items a page shows (chosen once, remembered in this browser for every list).

export const PAGE_SIZES = [12, 24, 48] as const;
export const DEFAULT_PAGE_SIZE = 24;

export interface Page {
  /** The page shown, from 1; a page past the end shows the last one. */
  page: number;
  /** How many pages there are; at least 1, also for an empty list. */
  pages: number;
  /** The first and last item shown, counted from 1 (0 and 0 when there is nothing). */
  first: number;
  last: number;
  total: number;
  /** For `slice(start, end)`. */
  start: number;
  end: number;
}

/** A page size that is offered: anything else (an old or edited value) is the default. */
export const sizeOf = (n: unknown): number => (PAGE_SIZES as readonly number[]).includes(Number(n)) ? Number(n) : DEFAULT_PAGE_SIZE;

export function pageOf(total: number, page: number, size: number): Page {
  const per = Math.max(1, Math.floor(size) || 1);
  const t = Math.max(0, Math.floor(total) || 0);
  const pages = Math.max(1, Math.ceil(t / per));
  const p = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  const start = (p - 1) * per;
  const end = Math.min(t, start + per);
  return { page: p, pages, first: t ? start + 1 : 0, last: end, total: t, start, end };
}

/**
 * The page numbers to offer: always the first and the last, the current one and one on each
 * side; a gap ("gap") where numbers are left out. A gap of one number shows the number instead.
 */
export function pageNumbers(page: number, pages: number): (number | "gap")[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...want].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev === 2) out.push(n - 1);
    else if (n - prev > 2) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}

/** "Showing 13–24 of 57 processes"; "7 processes" when they all fit on one page; "No processes". */
export function showingText(p: Page, noun: { one: string; many: string }): string {
  if (!p.total) return `No ${noun.many}`;
  const of = `${p.total} ${p.total === 1 ? noun.one : noun.many}`;
  if (p.pages === 1) return of;
  return `Showing ${p.first}–${p.last} of ${of}`;
}

/** The page of a list as it is remembered, with what (search and filters) it was the page of. */
export interface StoredPage { what: string; page: number }
/** A remembered page as it was stored, or null when there is none or it cannot be used. */
export function storedPage(raw: string | null): StoredPage | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<StoredPage> | null;
    return v && typeof v === "object" && typeof v.what === "string" && Number.isInteger(v.page) && (v.page as number) >= 1 ? { what: v.what, page: v.page as number } : null;
  } catch { return null; }
}

const SIZE_KEY = "pm:page-size";
const SIZE_CHANGED = "pm:page-size-changed";
const readSize = () => { try { return sizeOf(localStorage.getItem(SIZE_KEY)); } catch { return DEFAULT_PAGE_SIZE; } };

/** How many items a page shows: one choice for all lists, kept in this browser. */
export function usePageSize(): [number, (n: number) => void] {
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    const on = () => setSize(readSize());
    window.addEventListener(SIZE_CHANGED, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(SIZE_CHANGED, on); window.removeEventListener("storage", on); };
  }, []);
  const change = useCallback((n: number) => {
    const v = sizeOf(n);
    setSize(v);
    try { localStorage.setItem(SIZE_KEY, String(v)); } catch { /* private mode: it lasts for this page */ }
    window.dispatchEvent(new Event(SIZE_CHANGED));
  }, []);
  return [size, change];
}
