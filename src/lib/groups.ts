import type { Catalog, Contacts, Domain, Pillar, Platform, Practice, Team, Tribe } from "../types";
import type { GroupKind, GroupRank } from "./members";
import { looksLikeEmail } from "./members";
import type { Filters } from "./search";

/**
 * The page of a team, a platform or a practice (`#/team/:id`, `#/platform/:id`, `#/practice/:id`):
 * what it is, how to reach it, who is behind it and what belongs to it. The rules of that page and
 * of the rows of the list of teams live here, so that both say the same.
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

/** The lists without empty optional fields (`tidyListEntry`): what Admin (Teams, Tools) compares with the saved lists, and saves. */
export const tidyLists = (c: Catalog): Catalog => ({
  ...c,
  teams: c.teams.map(tidyListEntry), practices: (c.practices ?? []).map(tidyListEntry), platforms: (c.platforms ?? []).map(tidyListEntry),
  categories: (c.categories ?? []).map(tidyListEntry), tools: c.tools.map(tidyListEntry), tiers: c.tiers.map(tidyListEntry),
  environments: c.environments.map(tidyListEntry), languages: c.languages.map(tidyListEntry), paths: (c.paths ?? []).map(tidyListEntry),
  patterns: (c.patterns ?? []).map(tidyListEntry), pillars: (c.pillars ?? []).map(tidyListEntry), tribes: (c.tribes ?? []).map(tidyListEntry), domains: (c.domains ?? []).map(tidyListEntry),
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
 * The one line a row of the lists says under the name: how to reach them first (the Slack
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
 * The order of a list of Teams for readers: the person's own groups first, then by name. `mine` says
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

// ---------- pillars, tribes and domains: optional groups of teams

/**
 * Teams can be grouped in pillars, pillars in tribes, and tribes in domains. Everything is
 * optional: a team without a pillar, a pillar without a tribe, a tribe without a domain, and any
 * of them without anything in it are all fine. They give no rights; each has a read-only page of
 * its own (`ClusterPage`, `#/pillar/:id`, `#/tribe/:id`, `#/domain/:id`), and otherwise they only
 * group what readers see.
 */

const findIn = <T extends { id: string }>(list: T[] | undefined, id: string | undefined): T | undefined => (id ? (list ?? []).find((x) => x.id === id) : undefined);
/** The pillar a team is part of; undefined without one, or when it names one the lists do not have. */
export const pillarOf = (c: Pick<Catalog, "pillars">, team: { pillar?: string } | undefined): Pillar | undefined => findIn(c.pillars, team?.pillar);
/** The tribe a pillar is part of, the same way. */
export const tribeOf = (c: Pick<Catalog, "tribes">, pillar: { tribe?: string } | undefined): Tribe | undefined => findIn(c.tribes, pillar?.tribe);
/** The domain a tribe is part of, the same way. */
export const domainOf = (c: Pick<Catalog, "domains">, tribe: { domain?: string } | undefined): Domain | undefined => findIn(c.domains, tribe?.domain);

const byName = (a: { id: string; name: string }, b: { id: string; name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** The teams that name a pillar, by name. */
export const teamsOfPillar = (c: Pick<Catalog, "teams">, id: string): Team[] => c.teams.filter((t) => t.pillar === id).sort(byName);
/** The pillars that name a tribe, by name. */
export const pillarsOfTribe = (c: Pick<Catalog, "pillars">, id: string): Pillar[] => (c.pillars ?? []).filter((p) => p.tribe === id).sort(byName);
/** The tribes that name a domain, by name. */
export const tribesOfDomain = (c: Pick<Catalog, "tribes">, id: string): Tribe[] => (c.tribes ?? []).filter((t) => t.domain === id).sort(byName);

/** The lists of the groups of teams, and the page each kind of entry has. */
export type GroupingList = "pillars" | "tribes" | "domains";
/** One piece of the sentence that says where something belongs; an entry of the lists links to its page. */
export interface PartOfPiece { text: string; list?: GroupingList; id?: string }

/** "Part of the pillar X, in the tribe Y, in the domain Z": the levels that exist, from `pillar`, `tribe` or `domain` up. */
function chain(steps: { noun: string; list: GroupingList; entry?: { id: string; name: string } }[]): PartOfPiece[] {
  const out: PartOfPiece[] = [];
  for (const s of steps) {
    if (!s.entry) break;
    out.push({ text: out.length ? `, in the ${s.noun} ` : `Part of the ${s.noun} ` }, { text: s.entry.name, list: s.list, id: s.entry.id });
  }
  return out;
}

/**
 * Where a team belongs, as the head of its page says it: "Part of the pillar Compute, in the tribe
 * Cloud, in the domain Platforms and infrastructure", as far as the levels go ("Part of the pillar
 * Compute" for a pillar in no tribe); nothing for a team in no pillar. The names are pieces of
 * their own, so the page can link them to their pages.
 */
export function partOf(c: Pick<Catalog, "pillars" | "tribes" | "domains">, team: { pillar?: string } | undefined): PartOfPiece[] {
  const pillar = pillarOf(c, team), tribe = tribeOf(c, pillar), domain = domainOf(c, tribe);
  return chain([{ noun: "pillar", list: "pillars", entry: pillar }, { noun: "tribe", list: "tribes", entry: tribe }, { noun: "domain", list: "domains", entry: domain }]);
}
/** The same as one plain sentence. */
export const partOfText = (c: Pick<Catalog, "pillars" | "tribes" | "domains">, team: { pillar?: string } | undefined) => partOf(c, team).map((p) => p.text).join("");
/** Where a pillar or a tribe belongs, for the head of its page: "Part of the tribe Cloud, in the domain …". */
export function placeOf(c: Pick<Catalog, "tribes" | "domains">, kind: ClusterKind, entry: { tribe?: string; domain?: string }): PartOfPiece[] {
  if (kind === "pillar") { const tribe = tribeOf(c, entry); return chain([{ noun: "tribe", list: "tribes", entry: tribe }, { noun: "domain", list: "domains", entry: domainOf(c, tribe) }]); }
  if (kind === "tribe") return chain([{ noun: "domain", list: "domains", entry: domainOf(c, entry) }]);
  return [];
}

/**
 * A section of the teams on the reader's side: a domain, or what is in none ("no-domain": the
 * tribes in no domain; "no-tribe": the pillars in no tribe; "no-pillar": the teams in no pillar).
 * Each group is one pillar with its tribe (none for "no-pillar").
 */
export interface TeamSection {
  heading: Domain | "no-domain" | "no-tribe" | "no-pillar" | "all";
  groups: { tribe?: Tribe; pillar?: Pillar; teams: Team[] }[];
}
/** What the headings say where there is no domain, tribe or pillar. */
export const NO_DOMAIN = "Not in a domain";
export const NO_TRIBE = "Not in a tribe";
export const NO_PILLAR = "Not in a pillar";

/**
 * The teams of the reader's list grouped under their domain, tribe and pillar: the domains by
 * name, in each its tribes by name and in each tribe its pillars by name; then the tribes in no
 * domain; then the pillars in no tribe; the teams in no pillar last. A pillar, tribe or domain none
 * of the `teams` is in is left out. With no pillars in the lists, one section with all the teams as
 * they are (the page then looks as it does without them). `teams` keep their order within a pillar.
 */
export function teamSections(c: Pick<Catalog, "pillars" | "tribes" | "domains">, teams: Team[]): TeamSection[] {
  if (!(c.pillars ?? []).length) return [{ heading: "all", groups: [{ teams }] }];
  const pillarsOf = (tribe?: Tribe) => [...(c.pillars ?? [])].filter((p) => tribeOf(c, p)?.id === tribe?.id).sort(byName)
    .map((pillar) => ({ tribe, pillar, teams: teams.filter((t) => pillarOf(c, t)?.id === pillar.id) })).filter((g) => g.teams.length);
  const tribesIn = (domain?: Domain) => [...(c.tribes ?? [])].filter((t) => domainOf(c, t)?.id === domain?.id).sort(byName).flatMap((t) => pillarsOf(t));
  const out: TeamSection[] = [];
  for (const domain of [...(c.domains ?? [])].sort(byName)) {
    const groups = tribesIn(domain);
    if (groups.length) out.push({ heading: domain, groups });
  }
  const loose = tribesIn(undefined);
  if (loose.length) out.push({ heading: "no-domain", groups: loose });
  const noTribe = pillarsOf(undefined);
  if (noTribe.length) out.push({ heading: "no-tribe", groups: noTribe });
  const alone = teams.filter((t) => !pillarOf(c, t));
  if (alone.length) out.push({ heading: "no-pillar", groups: [{ teams: alone }] });
  return out;
}

/**
 * The teams to choose from in a long list (the owning team on the editing screen), grouped by
 * pillar as a choice box groups them, each named with its tribe: "Compute (Cloud)", …, then "Not
 * in a pillar". With no pillars in the lists, one group without a name.
 */
export function teamChoices(c: Pick<Catalog, "teams" | "pillars" | "tribes" | "domains">): { label?: string; teams: Team[] }[] {
  if (!(c.pillars ?? []).length) return [{ teams: c.teams }];
  return teamSections(c, [...c.teams].sort(byName)).flatMap((s) => s.groups.map((g) => ({
    label: g.pillar ? (g.tribe ? `${g.pillar.name} (${g.tribe.name})` : g.pillar.name) : NO_PILLAR,
    teams: g.teams,
  })));
}

// ---------- the page of a pillar, a tribe or a domain

/** A pillar, a tribe or a domain: each has a page of its own (`#/pillar/:id`, `#/tribe/:id`, `#/domain/:id`). */
export type ClusterKind = "pillar" | "tribe" | "domain";
export const CLUSTER_KINDS: ClusterKind[] = ["pillar", "tribe", "domain"];
export const CLUSTER_LIST: Record<ClusterKind, GroupingList> = { pillar: "pillars", tribe: "tribes", domain: "domains" };
export const CLUSTER_WORD: Record<ClusterKind, string> = { pillar: "Pillar", tribe: "Tribe", domain: "Domain" };
/** The page of an entry of the grouping lists. */
export const KIND_OF_LIST: Record<GroupingList, ClusterKind> = { pillars: "pillar", tribes: "tribe", domains: "domain" };

/** The entry of the lists a pillar's, tribe's or domain's page is about; undefined for an id that does not exist. */
export const clusterEntry = (c: Pick<Catalog, "pillars" | "tribes" | "domains">, kind: ClusterKind, id: string): Pillar | Tribe | Domain | undefined =>
  findIn(c[CLUSTER_LIST[kind]] as { id: string; name: string }[] | undefined, id) as Pillar | Tribe | Domain | undefined;

/** A pillar with its teams; a tribe with its pillars. */
export interface PillarTeams { pillar: Pillar; teams: Team[] }
export interface TribePillars { tribe: Tribe; pillars: PillarTeams[] }
/**
 * What the page of a pillar, tribe or domain lists: a pillar its teams; a tribe its pillars, each
 * with its teams; a domain its tribes, each with its pillars (and their teams). `teams` are all
 * the teams in it, whose processes and standards the page shows.
 */
export function clusterContents(c: Pick<Catalog, "teams" | "pillars" | "tribes" | "domains">, kind: ClusterKind, id: string): { tribes: TribePillars[]; pillars: PillarTeams[]; teams: Team[] } {
  const withTeams = (p: Pillar): PillarTeams => ({ pillar: p, teams: teamsOfPillar(c, p.id) });
  if (kind === "pillar") {
    const p = findIn(c.pillars, id);
    const pillars = p ? [withTeams(p)] : [];
    return { tribes: [], pillars, teams: pillars.flatMap((x) => x.teams) };
  }
  const tribes = (kind === "tribe" ? (c.tribes ?? []).filter((t) => t.id === id) : tribesOfDomain(c, id))
    .map((tribe) => ({ tribe, pillars: pillarsOfTribe(c, tribe.id).map(withTeams) }));
  const pillars = tribes.flatMap((t) => t.pillars);
  return { tribes, pillars, teams: pillars.flatMap((p) => p.teams) };
}

/**
 * The search filter that finds what the teams of a pillar, tribe or domain own: the same as a
 * team's page uses (`groupFilter`), for several teams. Null when it has no teams: then nothing
 * belongs to it (an empty owner filter would mean everything).
 */
export const clusterFilter = (teams: { id: string }[]): Filters | null => (teams.length ? { owner: teams.map((t) => t.id) } : null);

/** What a pillar, tribe or domain with nothing in it says, in plain words; "" when it has teams. */
export function clusterEmpty(kind: ClusterKind, contents: { tribes: unknown[]; pillars: unknown[]; teams: unknown[] }): string {
  if (kind === "domain" && !contents.tribes.length) return "No tribe is part of this domain yet.";
  if (kind === "tribe" && !contents.pillars.length) return "No pillar is part of this tribe yet.";
  if (contents.teams.length) return "";
  return kind === "pillar" ? "No team is part of this pillar yet." : kind === "tribe" ? "No team is part of the pillars of this tribe yet." : "No team is part of the tribes of this domain yet.";
}
