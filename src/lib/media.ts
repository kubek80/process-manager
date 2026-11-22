import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { formatDate, formatDateTime } from "./dates";

/** Whether a media query matches now, following it as the window changes. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    setOn(m.matches);
    const change = () => setOn(m.matches);
    m.addEventListener?.("change", change);
    return () => m.removeEventListener?.("change", change);
  }, [query]);
  return on;
}

/** Where a process page's reader actions (feedback, upvote, bookmark, share) sit on the tab row instead of in the head. */
export const ACTIONS_ON_TABS = "(min-width: 1000px)";
/** A phone: a process opens on its checklist. */
export const PHONE = "(max-width: 599px)";

/**
 * Which tab a process page shows when it is opened: on a phone the map shows little more than a
 * step at a time, so arriving at the map without a step named opens the checklist instead (the map
 * stays one tap away). `null`: stay where the address says.
 */
export function arrivalTab(tab: string, item: string | undefined, phone: boolean): "list" | null {
  return phone && tab === "flow" && !item ? "list" : null;
}

/**
 * True while the page is being printed (or shown as print media). A process page prints its
 * checklist whatever tab is open, a standard every requirement: the page draws that version
 * before the browser lays out the paper, so it is drawn at once (flushSync) in `beforeprint`.
 */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("print").matches);
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    const media = window.matchMedia?.("print");
    const change = (e: MediaQueryListEvent) => (e.matches ? on() : off());
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    media?.addEventListener?.("change", change);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
      media?.removeEventListener?.("change", change);
    };
  }, []);
  return printing;
}

/**
 * The last line of a printed process or standard: which one, which version, when its content last
 * changed, and when and from where it was printed, so that a paper copy can be traced and told apart
 * from a newer one. e.g. "Request a GCP project · Version 3 · content changed 2026-11-13 ·
 * printed 2026-11-20 10:04 from https://…/#/p/request-gcp-project".
 */
export function printedLine(o: { title: string; version?: number; changed?: string; printedAt: Date | string; address?: string }): string {
  return [
    o.title || "(no name yet)",
    o.version ? `Version ${o.version}` : "",
    o.changed ? `content changed ${formatDate(o.changed)}` : "",
    `printed ${formatDateTime(typeof o.printedAt === "string" ? o.printedAt : o.printedAt.toISOString())}${o.address ? ` from ${o.address}` : ""}`,
  ].filter(Boolean).join(" · ");
}

/** The part of the browser's `document.fonts` that `watchFonts` uses. */
export interface FontSetLike {
  status?: string;
  ready?: Promise<unknown>;
  addEventListener?: (type: "loadingdone", f: () => void) => void;
  removeEventListener?: (type: "loadingdone", f: () => void) => void;
}

/**
 * Calls `loaded` once the fonts that were still loading have arrived (`ready`), and again each
 * time a font arrives later (`loadingdone`, e.g. Roboto chosen under Theming), so that text
 * measured in code can be measured again in the font really shown. Nothing is called when every
 * font had already arrived: no second measurement, no visible jump. Returns the way to stop.
 */
export function watchFonts(fonts: FontSetLike | undefined, loaded: () => void): () => void {
  if (!fonts) return () => {};
  let live = true;
  const done = () => { if (live) loaded(); };
  if (fonts.status === "loading") fonts.ready?.then(done, () => {});
  fonts.addEventListener?.("loadingdone", done);
  return () => { live = false; fonts.removeEventListener?.("loadingdone", done); };
}

/** A number that grows each time fonts have arrived (`watchFonts`): read it to measure text again. */
export function useFontsLoaded(): number {
  const [n, setN] = useState(0);
  useEffect(() => watchFonts(typeof document !== "undefined" ? (document.fonts as FontSetLike | undefined) : undefined, () => setN((x) => x + 1)), []);
  return n;
}

/** The font family the page is set in (`--font-family`, which follows Theming), for measuring text in code. */
export function pageFontFamily(): string {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return "sans-serif";
  const root = getComputedStyle(document.documentElement).getPropertyValue("--font-family").trim();
  return root || getComputedStyle(document.body).fontFamily || "sans-serif";
}
