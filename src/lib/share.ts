import type { TargetKind } from "../types";

// Sharing a process or standard: a link, and a short message for Slack, Google Chat or e-mail.
// Nothing is posted anywhere; the person copies the text or their mail program opens.

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

/** Plain text that reads well anywhere: the title, the summary, the link on a line of its own. */
export function plainMessage(s: ShareInfo, url: string): string {
  const summary = oneLine(s.summary);
  return [oneLine(s.title, 200), summary, url].filter(Boolean).join("\n");
}

/**
 * Slack: the composer keeps bold text and links when rich text is pasted, so the message is
 * copied as HTML too; the plain text (used where HTML is not taken) marks the title with *…*,
 * which Slack shows as bold, and puts the link on its own line, which Slack turns into a link.
 * Slack's own <url|text> link syntax is left out: it only works for apps, not in pasted text.
 */
export function slackMessage(s: ShareInfo, url: string): { text: string; html: string } {
  const title = oneLine(s.title, 200), summary = oneLine(s.summary);
  return {
    text: [`*${title}*`, summary, url].filter(Boolean).join("\n"),
    html: [`<b>${escapeHtml(title)}</b>`, summary && escapeHtml(summary), `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`].filter(Boolean).join("<br>"),
  };
}

/**
 * Google Chat takes pasted text as plain text and formats it when sent: *…* becomes bold and an
 * address becomes a link. Its <url|text> syntax only works for apps, so the address is shown as it is.
 */
export function googleChatMessage(s: ShareInfo, url: string): string {
  const title = oneLine(s.title, 200), summary = oneLine(s.summary);
  return [`*${title}*`, summary, url].filter(Boolean).join("\n");
}

/** A mailto: link that opens the person's mail program with subject and text filled in. */
export function mailtoLink(s: ShareInfo, url: string): string {
  const title = oneLine(s.title, 200);
  const summary = oneLine(s.summary, 600);
  const body = [`Have a look at the ${noun(s.kind)} “${title}” in the Process Manager:`, "", summary, "", url].filter((l, i, a) => l || (a[i - 1] ?? "") !== "").join("\r\n");
  // encodeURIComponent writes a space as %20, which every mail program reads (a "+" would stay a "+")
  return `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
