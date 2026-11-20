import type { TargetKind } from "../types";
import { portalName } from "./theme";

// Sharing a process or standard: its link, the link with its title, an e-mail, or the device's
// own share sheet. Nothing is posted anywhere from the app.

export interface ShareInfo { kind: TargetKind; id: string; title: string; summary?: string }

/**
 * The address of the process or standard itself - not of the tab or step that is open - from
 * where the app is served (`base`: origin and path, e.g. "https://pm.example.com/").
 */
export function shareUrl(base: string, kind: TargetKind, id: string): string {
  const root = base.replace(/[#?].*$/, "");
  return `${root}#/${kind === "process" ? "p" : "s"}/${encodeURIComponent(id)}`;
}

/** Where the app is served from, in the browser. */
export const appBase = () => (typeof location === "undefined" ? "" : `${location.origin}${location.pathname}`);

/** One line of at most `max` characters: whitespace folded, cut at a word with "…". */
export function oneLine(text: string | undefined, max = 240): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // a single very long word is cut where it is
  const head = space > max * 0.5 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s,;:.\-–—]+$/, "")}…`;
}

const noun = (kind: TargetKind) => (kind === "process" ? "process" : "standard");

/** A mailto: link that opens the person's mail program with subject and text filled in. `app`: the portal's name (Admin › Theming). */
export function mailtoLink(s: ShareInfo, url: string, app = portalName()): string {
  const title = oneLine(s.title, 200);
  const summary = oneLine(s.summary, 600);
  const body = [`Have a look at the ${noun(s.kind)} “${title}” in ${app}:`, "", summary, "", url].filter((l, i, a) => l || (a[i - 1] ?? "") !== "").join("\r\n");
  // encodeURIComponent writes a space as %20, which every mail program reads (a "+" would stay a "+")
  return `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** "Copy link and title": the title and the portal's name on one line, the address on the next - reads well in any chat or document. */
export function linkAndTitle(s: ShareInfo, url: string, app = portalName()): string {
  return `${oneLine(s.title, 200)} · ${app}\n${url}`;
}

/** What the device's own share sheet gets (`navigator.share`). */
export function nativeShareData(s: ShareInfo, url: string): ShareData {
  const summary = oneLine(s.summary);
  return { title: oneLine(s.title, 200), text: summary || oneLine(s.title, 200), url };
}

type Sharer = { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };

/** Whether the device has its own share sheet for this: `navigator.share` exists and, where it can be asked, `canShare` agrees. */
export function canShareNatively(nav: Sharer | undefined, data: ShareData): boolean {
  if (!nav || typeof nav.share !== "function") return false;
  if (typeof nav.canShare === "function") {
    try { return nav.canShare(data); } catch { return false; }
  }
  return true;
}

/** A share sheet the person closed without choosing is not a failure. */
export const shareCancelled = (e: unknown) => e instanceof Error ? e.name === "AbortError" : (e as { name?: string } | null)?.name === "AbortError";

/** What each way of sharing gives the person. */
export const SHARE_HINT = {
  title: "The title and the address, to paste in a chat or a document",
  email: "Opens your mail program with the message filled in",
  device: "Send it with an app on this device",
} as const;

/** The line that confirms a copy, naming what was copied. */
export function copiedStatus(what: "link" | "title"): string {
  return what === "link" ? "The link was copied. Paste it where you want to share it." : "The link and title were copied. Paste them where you want to share them.";
}
