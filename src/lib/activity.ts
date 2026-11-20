// Admin > Activity: what of an entry is worth showing to a reader, in plain words.

import type { AuditEntry } from "../types";

/** Actions whose target is a technical id (an uploaded icon is named by the fingerprint of its bytes) or says nothing: the entry says what happened without it. */
const NO_TARGET = new Set(["icon.upload", "theme.change", "lists.save", "content.convert"]);

/** The target to show after the action's words; "" when it would mean nothing to a reader. */
export const shownTarget = (action: string, target: string): string => (NO_TARGET.has(action) || /^[0-9a-f]{64}$/.test(target) ? "" : target);

/**
 * The words for every action the server writes to the activity log (`grep -rn "audit\.\|record(" server/internal`).
 * The target, when there is one worth showing, follows them.
 */
export const ACTION: Record<string, string> = {
  "process.save": "saved the process", "process.publish": "published the process", "process.review": "confirmed the review of the process",
  "process.discard": "threw away the unpublished changes of the process", "process.delete": "deleted the process",
  "standard.save": "saved the standard", "standard.publish": "published the standard", "standard.review": "confirmed the review of the standard",
  "standard.discard": "threw away the unpublished changes of the standard", "standard.delete": "deleted the standard",
  "lists.save": "changed the lists",
  "access.grant": "gave a role to", "access.revoke": "took a role from", "access.change": "changed the roles of", "access.remove": "took every role from",
  "feedback.fixed": "marked feedback as fixed on the", "feedback.reopen": "reopened feedback on the", "feedback.delete": "deleted feedback on the",
  "skill.guidance": "changed the extra guidance of the skill",
  "icon.upload": "added an icon",
  "theme.change": "changed the look of the portal",
  "request.create": "asked for something new:", "request.state": "changed the state of", "request.delete": "removed",
  "content.import": "imported", "content.convert": "brought the stored content up to date for this version",
};

/** Who made a change: the portal itself for imports and upgrades, otherwise the person's name. */
export const SYSTEM_AUTHORS = new Set(["import", "system"]);

/** The titles the page knows, by kind and id: a document is named by its title, its id as the tooltip. */
export type Titles = { process: Record<string, string>; standard: Record<string, string> };

export interface ShownEntry {
  who: string;
  /** The person made it, not the portal: their name is shown strong. */
  person: boolean;
  words: string;
  /** What it was done to: a title (`quoted`, with the id as `hint`), an id the app cannot name (`code`), or plain words. */
  target?: { text: string; hint?: string; code?: boolean; quoted?: boolean };
  detail?: string;
}

/** One entry of the activity log in plain words. */
export function describeEntry(e: AuditEntry, titles: Titles): ShownEntry {
  const person = !SYSTEM_AUTHORS.has(e.email);
  const who = person ? e.name || e.email : "The portal";
  const words = ACTION[e.action] ?? e.action.replace(/[._]/g, " ");
  const shown = shownTarget(e.action, e.target);
  const out: ShownEntry = { who, person, words, ...(e.detail ? { detail: e.detail } : {}) };
  if (!shown) return out;
  const [kind] = e.action.split(".");
  // a process or standard: by its title where the app knows it; feedback names "process <id>"
  const fb = kind === "feedback" ? /^(process|standard) (.+)$/.exec(shown) : null;
  const ref: { k: "process" | "standard"; id: string } | undefined = kind === "process" || kind === "standard" ? { k: kind, id: shown }
    : fb ? { k: fb[1] as "process" | "standard", id: fb[2] } : undefined;
  if (ref) {
    const title = titles[ref.k][ref.id];
    if (kind === "feedback") out.words = `${words} ${ref.k}`;
    out.target = title ? { text: `“${title}”`, hint: ref.id, quoted: true } : { text: ref.id, code: true };
    return out;
  }
  if (e.action === "skill.guidance") out.target = { text: shown, code: true };
  else if (e.action === "content.import") out.target = { text: shown === "sample content" ? "the sample content" : shown };
  else out.target = { text: shown };
  return out;
}
