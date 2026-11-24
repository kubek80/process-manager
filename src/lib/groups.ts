import type { Catalog, Contacts, Platform, Practice, Team } from "../types";
import type { GroupKind, GroupRank } from "./members";
import { looksLikeEmail } from "./members";
import type { Filters } from "./search";

/**
 * The page of a team, a platform or a practice (`#/team/:id`, `#/platform/:id`, `#/practice/:id`):
 * what it is, how to reach it, who is behind it and what belongs to it. The rules of that page and
 * of the rows of Teams & tools live here, so that both say the same.
 */

export type GroupEntry = Team | Platform | Practice;
export const GROUP_KINDS: GroupKind[] = ["team", "platform", "practice"];
/** The list of the lists each kind of group is kept in. */
export const LIST_OF: Record<GroupKind, "teams" | "platforms" | "practices"> = { team: "teams", platform: "platforms", practice: "practices" };
/** Each kind in words, as the head of the page says it. */
export const KIND_WORD: Record<GroupKind, string> = { team: "Team", platform: "Platform", practice: "Practice" };

/** The entry of the lists a group page is about; undefined for an id that does not exist. */
export const groupEntry = (c: Catalog, kind: GroupKind, id: string): GroupEntry | undefined =>
  ((c[LIST_OF[kind]] ?? []) as GroupEntry[]).find((e) => e.id === id);

/**
 * Whether a process or standard belongs to a group: for a platform or practice, the ones that
 * name it; for a team, the ones it owns (maintains, or issues).
 */
export function belongsToGroup(kind: GroupKind, id: string, doc: { owner?: string; platform?: string; practice?: string }): boolean {
  if (!id) return false;
  return kind === "team" ? doc.owner === id : kind === "platform" ? doc.platform === id : doc.practice === id;
}

/** The search filter that finds what belongs to a group: the same as the page lists. */
export const groupFilter = (kind: GroupKind, id: string): Filters =>
  kind === "team" ? { owner: [id] } : kind === "platform" ? { platform: [id] } : { practice: [id] };

/** What the processes and standards of a group are called in its heading. */
export const belongsHeading = (kind: GroupKind) =>
  kind === "team" ? "What this team looks after" : kind === "platform" ? "What belongs to this platform" : "What belongs to this practice";

/** "You are an owner" / "You are a member"; empty for everybody else. */
export const rankText = (rank: GroupRank | undefined): string =>
  rank === "owner" ? "You are an owner" : rank === "member" ? "You are a member" : "";

// ---------- contact details

/** A link people typed is drawn as a link only when it is http or https, as the server checks it. */
export const isWebLink = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/\S+$/.test(v.trim()) && v.trim().length <= 300;

/** The longest each contact detail may be, as the lists' format allows. */
export const CONTACT_MAX: Record<keyof Contacts, number> = {
  email: 120, slack: 80, slackUrl: 300, chat: 80, chatUrl: 300, confluence: 300, page: 300, form: 300,
};
export const CONTACT_KEYS = Object.keys(CONTACT_MAX) as (keyof Contacts)[];
/** The fields that hold a link. */
export const LINK_KEYS: (keyof Contacts)[] = ["slackUrl", "chatUrl", "confluence", "page", "form"];
/** The longest the description and the free line may be. */
export const DESCRIPTION_MAX = 600;
export const OTHER_MAX = 120;

/** Each contact detail in words, as the fields and the page call it. */
export const CONTACT_LABEL: Record<keyof Contacts, string> = {
  email: "Group email", slack: "Slack channel", slackUrl: "Link to the Slack channel", chat: "Google Chat space",
  chatUrl: "Link to the Chat space", confluence: "Confluence page", page: "Their page", form: "Request form",
};
export const OTHER_LABEL = "Other ways to reach them";

/** The contact details without empty ones and without spaces around; undefined when nothing is left. */
export function tidyContacts(c: Contacts | undefined): Contacts | undefined {
  if (!c) return undefined;
  const out: Contacts = {};
  for (const k of CONTACT_KEYS) {
    const v = c[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * One entry of the lists without empty optional fields: its id and name always, every other text
 * only when it is not empty, and its contact details tidied (`tidyContacts`: an empty detail is
 * left out, and `contacts` itself when nothing is left), because the format refuses an empty one.
 */
export function tidyListEntry<T extends { id: string; name: string; contacts?: Contacts }>(r: T): T {
  const out = Object.fromEntries(Object.entries(r).filter(([k, v]) => k === "id" || k === "name" || (typeof v === "string" && v.trim() !== ""))) as T;
  const contacts = tidyContacts(r.contacts);
  // the other names of a path: trimmed, the empty ones left out, and the field when none is left
  const also = (r as { alsoCalled?: unknown }).alsoCalled;
  const names = Array.isArray(also) ? also.map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "") : undefined;
  const withNames = names?.length ? { ...out, alsoCalled: names } : out;
  return contacts ? { ...withNames, contacts } : withNames;
}

/** The lists without empty optional fields (`tidyListEntry`): what Admin › Lists compares with the saved lists, and saves. */
export const tidyLists = (c: Catalog): Catalog => ({
  ...c,
  teams: c.teams.map(tidyListEntry), practices: (c.practices ?? []).map(tidyListEntry), platforms: (c.platforms ?? []).map(tidyListEntry),
  categories: (c.categories ?? []).map(tidyListEntry), tools: c.tools.map(tidyListEntry), tiers: c.tiers.map(tidyListEntry),
  environments: c.environments.map(tidyListEntry), languages: c.languages.map(tidyListEntry), paths: (c.paths ?? []).map(tidyListEntry),
});

/**
 * What is wrong with the contact details, per field, as an instruction in plain words. Empty
 * fields are fine: every detail is optional.
 */
export function contactProblems(c: Contacts | undefined): Partial<Record<keyof Contacts, string>> {
  const out: Partial<Record<keyof Contacts, string>> = {};
  if (!c) return out;
  for (const k of CONTACT_KEYS) {
    const v = (c[k] ?? "").trim();
    if (!v) continue;
    if (v.length > CONTACT_MAX[k]) out[k] = `Shorten it to ${CONTACT_MAX[k]} characters or fewer.`;
    else if (k === "email" && !looksLikeEmail(v)) out[k] = "Write one email address, like team@company.com.";
    else if (LINK_KEYS.includes(k) && !isWebLink(v)) out[k] = /\s/.test(v) ? "Write the link without spaces." : "Write the whole link, starting with https://";
  }
  return out;
}

/** Whether the contact details can be saved: no problem in any of them. */
export const contactsOk = (c: Contacts | undefined) => Object.keys(contactProblems(c)).length === 0;

/** A link shown short: without "https://", "www." and a trailing slash. The whole link is its tooltip. */
export const shortLink = (url: string) => url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

/** One way to reach a group, as the page draws it. `href` only for what passes the check. */
export interface ContactItem {
  key: "email" | "slack" | "chat" | "confluence" | "page";
  label: string;
  text: string;
  href?: string;
  /** A link that leaves the portal (opens in a new tab); a mail link does not. */
  external?: boolean;
}

/**
 * How to reach a group, as its page shows it: the request form (the one way to ask them for
 * something) on its own, the other details in a fixed order, the old free line last. Nothing for
 * what is empty; a link only from a value that passes the check, else the plain name (or nothing,
 * for a link alone that fails).
 */
export function contactView(e: { contact?: string; contacts?: Contacts } | undefined): { form?: string; items: ContactItem[]; other?: string; none: boolean } {
  const c = tidyContacts(e?.contacts) ?? {};
  const items: ContactItem[] = [];
  if (c.email) items.push(looksLikeEmail(c.email)
    ? { key: "email", label: CONTACT_LABEL.email, text: c.email, href: `mailto:${c.email}` }
    : { key: "email", label: CONTACT_LABEL.email, text: c.email });
  const named = (key: "slack" | "chat", name?: string, url?: string, open?: string) => {
    const link = isWebLink(url) ? url!.trim() : undefined;
    if (name) items.push({ key, label: CONTACT_LABEL[key], text: name, ...(link ? { href: link, external: true } : {}) });
    else if (link) items.push({ key, label: CONTACT_LABEL[key], text: open!, href: link, external: true });
  };
  named("slack", c.slack, c.slackUrl, "Open the channel");
  named("chat", c.chat, c.chatUrl, "Open the space");
  for (const key of ["confluence", "page"] as const) {
    if (isWebLink(c[key])) items.push({ key, label: CONTACT_LABEL[key], text: shortLink(c[key]!), href: c[key]!.trim(), external: true });
  }
  const form = isWebLink(c.form) ? c.form.trim() : undefined;
  const other = e?.contact?.trim() && !repeatsDetail(e.contact, c) ? e.contact.trim() : undefined;
  return { form, items, other, none: !form && !items.length && !other };
}

/**
 * The one line a row of Teams & tools says under the name: how to reach them first (the Slack
 * channel, then the group email, then the Chat space, then the free line), else what it is.
 */
export function summaryLine(e: { contact?: string; contacts?: Contacts; description?: string; url?: string }): string {
  const c = e.contacts ?? {};
  // always what it is: "Slack #cloud-platform", "Email cloud@…", "Chat Cloud questions"
  if (c.slack?.trim()) return `Slack ${c.slack.trim()}`;
  if (c.email?.trim()) return `Email ${c.email.trim()}`;
  if (c.chat?.trim()) return `Chat ${c.chat.trim()}`;
  if (e.contact?.trim()) return e.contact.trim();
  if (e.url?.trim()) return shortLink(e.url);
  return e.description?.trim() || "No details yet";
}

/** What belongs to a group, counted by kind, for the heading of its list. */
export function countByKind(docs: { kind: "process" | "standard" }[]): { process: number; standard: number } {
  let process = 0, standard = 0;
  for (const d of docs) if (d.kind === "process") process++; else standard++;
  return { process, standard };
}

/**
 * The owner line of a page head (`ownedBy`'s words) cut where the team's name starts, so that the
 * name can be a link and the words stay exactly `ownedBy`'s. Without the name at the end, all of it
 * is `before`.
 */
export function splitOwnerLine(said: string, team: string): { before: string; team: string } {
  if (!team || !said.endsWith(team)) return { before: said, team: "" };
  return { before: said.slice(0, said.length - team.length), team };
}

/** A text for comparing: without case, spaces, "#" and the word Slack. */
const plain = (v: string) => v.toLowerCase().replace(/slack/g, "").replace(/[\s#:]/g, "");

/**
 * Whether the old free line only repeats a detail given above it ("Slack #cloud-platform" beside
 * the Slack channel "#cloud-platform"): then the page leaves it out.
 */
export function repeatsDetail(contact: string | undefined, c: Contacts | undefined): boolean {
  const line = plain(contact ?? "");
  if (!line || !c) return false;
  return [c.slack, c.email, c.chat].some((v) => !!v?.trim() && plain(v) === line);
}

/**
 * A link typed without its beginning ("example.atlassian.net/wiki/x") gets "https://" when the
 * field is left; anything that names a scheme of its own ("ftp:", "mailto:") or does not look like
 * a host is left as it is, for the check to say what is wrong.
 */
export function withScheme(v: string): string {
  const t = v.trim();
  // "host:8443/…" is a port, not a scheme
  if (!t || /^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))/i.test(t) || /\s/.test(t)) return v;
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(t) ? `https://${t}` : v;
}

/**
 * The order of a list in Teams & tools: the person's own groups first, then by name. `mine` says
 * whether an entry is theirs.
 */
export function ownFirst<T extends { id: string; name: string }>(rows: T[], mine: (id: string) => boolean): T[] {
  return [...rows].sort((a, b) => Number(mine(b.id)) - Number(mine(a.id)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** What adding somebody answered, in words: the server's note as information, about oneself in the second person. */
export function addedNote(o: { note?: string; self: boolean; selfRank?: GroupRank; group: string }): string {
  if (o.self && o.selfRank) return `You are already ${o.selfRank === "owner" ? "an owner" : "a member"} of ${o.group}.`;
  return o.note ?? "";
}

/**
 * The name the portal knows for an address, from what `GET /api/members` answered (it names the
 * people the portal knows, also those without a role); undefined when nobody of that address is known.
 */
export function nameFromMembers(members: readonly { email: string; name?: string }[] | undefined, email: string): string | undefined {
  const e = email.trim().toLowerCase();
  return members?.find((m) => m.email.toLowerCase() === e && !!m.name?.trim())?.name?.trim();
}
