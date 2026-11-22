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
  "process.discard": "threw away the changes kept in the draft of the process", "process.delete": "deleted the process",
  "standard.save": "saved the standard", "standard.publish": "published the standard", "standard.review": "confirmed the review of the standard",
  "standard.discard": "threw away the changes kept in the draft of the standard", "standard.delete": "deleted the standard",
  "lists.save": "changed the lists",
  "access.grant": "gave a role to", "access.revoke": "took a role from", "access.change": "changed the roles of", "access.remove": "took every role from",
  "feedback.fixed": "marked feedback as fixed on the", "feedback.reopen": "reopened feedback on the", "feedback.delete": "deleted feedback on the",
  "skill.guidance": "changed the extra guidance of the skill",
  "icon.upload": "added an icon",
  "theme.change": "changed the look of the portal",
  "request.create": "asked for something new:", "request.state": "changed the state of the request", "request.delete": "removed the request",
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
  /** Words that finish the sentence after the target, e.g. "to the members of the platform Google Cloud". */
  after?: string;
  detail?: string;
}

/** The names the page knows, by email in lower case: who appears in the log, who gave feedback. */
export type Names = Record<string, string>;

/** One entry of the activity log in plain words. `names` turns an address the log names into the person's name. */
export function describeEntry(e: AuditEntry, titles: Titles, names: Names = {}): ShownEntry {
  const person = !SYSTEM_AUTHORS.has(e.email);
  const who = person ? e.name || e.email : "The portal";
  const words = ACTION[e.action] ?? e.action.replace(/[._]/g, " ");
  const shown = shownTarget(e.action, e.target);
  const out: ShownEntry = { who, person, words, ...(e.detail ? { detail: e.detail } : {}) };
  // the details of one team, platform or practice changed (by an owner or a lists manager): said as such
  const details = e.action === "lists.save" ? /^(?:(version \d+): )?Details of the (team|platform|practice) “(.+?)” changed(?: by [^:]+)?(?:: (.+))?$/s.exec(e.detail) : null;
  if (details) {
    out.words = `changed the details of the ${details[2]}`;
    out.target = { text: `“${details[3]}”`, quoted: true };
    const rest = [details[4], details[1]].filter(Boolean).join("; ");
    if (rest) out.detail = rest; else delete out.detail;
    return out;
  }
  if (!shown) return out;
  // a request is named by its title (the server writes it into the detail), its number as the hint
  if (e.action.startsWith("request.")) {
    const asked = /^Asked for an? (process|standard): “(.+)”$/s.exec(e.detail);
    const titled = /^“(.+?)”: (.+)$/s.exec(e.detail);
    if (e.action === "request.create" && asked) {
      out.words = `asked for a new ${asked[1]}:`;
      out.target = { text: `“${asked[2]}”`, hint: shown, quoted: true };
      delete out.detail;
    } else if (titled) {
      out.target = { text: `“${titled[1]}”`, hint: shown, quoted: true };
      out.detail = titled[2];
    } else out.target = { text: shown };
    return out;
  }
  // a publication of changes somebody else saved last: "version 4 · changes last saved by Morgan Member"
  const by = /^(.*?);? the changes were last saved by (.+)$/s.exec(e.detail);
  if (by && e.action.endsWith(".publish")) out.detail = [by[1].trim(), `changes last saved by ${by[2]}`].filter(Boolean).join(" · ");
  // roles given or taken: the person is the target, so the detail does not name them again, and
  // a role reads "Practice member for Engineering"
  if (e.action.startsWith("access.") && out.detail) {
    // the server starts "Sam Consumer: added …" for a change of all of a person's roles
    const said = e.action === "access.change" || e.action === "access.remove" ? out.detail.replace(/^[^:;]+:\s+/, "") : out.detail;
    out.detail = said.replace(/ for the (?:platform|practice|team) /g, " for ");
  }
  // a person's address: their name where the page knows it, the address as the hint
  const name = names[shown.toLowerCase()];
  // a member added to or removed from a platform or practice: said as such, not as a role
  const member = /^(?:Platform|Practice) member for the (platform|practice) (.+)$/s.exec(e.detail);
  if (member && (e.action === "access.grant" || e.action === "access.revoke")) {
    out.words = e.action === "access.grant" ? "added" : "removed";
    out.after = `${e.action === "access.grant" ? "to" : "from"} the members of the ${member[1]} ${member[2]}`;
    delete out.detail;
  }
  if (name && /@/.test(shown)) { out.target = { text: name, hint: shown }; return out; }
  if (member) { out.target = { text: shown }; return out; }
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

/** A part of an entry's detail: words, a person (their name, the address as the hint) or a colour (shown as a swatch with its code). */
export type DetailPart = { text: string; person?: string; colour?: string };

const PARTS = /([^\s@:;,()]+@[^\s@:;,()]+\.[a-z]{2,})|(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b)/gi;

/** The detail of an entry in parts: addresses become names where the page knows them, colour codes get a swatch. */
export function detailParts(detail: string, names: Names = {}): DetailPart[] {
  const out: DetailPart[] = [];
  let at = 0;
  for (const m of detail.matchAll(PARTS)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: detail.slice(at, i) });
    if (m[1]) out.push({ text: names[m[1].toLowerCase()] || m[1], person: m[1] });
    else out.push({ text: m[2], colour: m[2] });
    at = i + m[0].length;
  }
  if (at < detail.length) out.push({ text: detail.slice(at) });
  return out;
}
