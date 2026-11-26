import type { Catalog, Issue, Level, Process, Standard, Status, StepType, TargetKind } from "../types";
import { cap, compare, describeChange, fieldName, itemWords, type Change, type FieldContext } from "./diff";
import { EXAMPLE } from "./edit";
import { dayOf, formatDateTime, today } from "./dates";
import { personLabel, type PersonRef } from "./members";
import { DUPLICATE_ITEMS, LIST_WORDS, refusalIssues } from "./validate";

/**
 * The editing screen, as plain functions: which kind of draft a document has, what its state is
 * called, which call "Save draft" and "Publish" make, what the outline lists and where the
 * checker's problems belong. The screens in components/Edit*.tsx wire these to React.
 *
 * Two kinds of "not published":
 * - a document that was never published (`status: "draft"`): saving it stores it as itself while
 *   nothing is to fix and keeps it in its working draft otherwise (`saveCallOf`); publishing it
 *   is an ordinary save with `status: "active"`;
 * - unpublished changes to a published document: a working draft kept beside it, saved with
 *   `PUT …/draft` and published with `POST …/publish`. Readers keep the published version.
 */
export type DraftKind = "unpublished" | "working";

/** Which kind of draft a document is edited in: by its stored status. */
export const draftKindOf = (status: Status | undefined): DraftKind => (status === "draft" ? "unpublished" : "working");

/** The calls behind "Save draft" and "Publish". */
export type SaveCall = "save-version" | "save-working-draft" | "replace-working-draft" | "recreate-as-draft";
export type PublishCall = "save-version-as-active" | "publish-working-draft";
/**
 * Which call "Save draft" makes. A published document: its working draft. A never-published one
 * is saved as itself while nothing is to fix (`toFix`: the checker finds something that stops
 * publishing); with something to fix it is saved as its working draft, which only its editors
 * see - so saving always works. Once nothing is to fix any more and a working draft exists
 * (`working`), the save stores the document itself in place of the working draft.
 * `gone`: the document was deleted by somebody else while it was open. Bringing it back is the
 * ordinary save that creates something new, as a draft readers do not see until it is published.
 */
export const saveCallOf = (kind: DraftKind, gone = false, o: { toFix?: boolean; working?: boolean } = {}): SaveCall =>
  (gone ? "recreate-as-draft"
    : kind === "working" || o.toFix ? "save-working-draft"
      : o.working ? "replace-working-draft" : "save-version");
export const publishCallOf = (kind: DraftKind): PublishCall => (kind === "unpublished" ? "save-version-as-active" : "publish-working-draft");

export type StateKey = "draft" | "published" | "changes" | "retired";
export interface EditState {
  key: StateKey;
  /** The word in the pill. */
  pill: string;
  /** The one sentence next to it. */
  sentence: string;
}

/**
 * What the editing bar says about the document: never published, published, with unpublished
 * changes (saved as a working draft, or only on this screen so far), or retired.
 */
export function editState(o: { status: Status | undefined; version: number; working: boolean; dirty: boolean }): EditState {
  if (o.status === "draft") return { key: "draft", pill: "Draft", sentence: "Readers do not see this yet" };
  const v = o.version ? `version ${o.version}` : "the published version";
  if (o.working || o.dirty) {
    return { key: "changes", pill: "Unpublished changes", sentence: `Readers still see ${v}${o.status === "deprecated" ? ", marked as retired" : ""}` };
  }
  if (o.status === "deprecated") return { key: "retired", pill: "Retired", sentence: `Readers see ${v}, marked as retired` };
  return { key: "published", pill: "Published", sentence: o.version ? `Version ${o.version}` : "Readers see this" };
}

/**
 * Why a published document cannot be retired, unpublished or brought back into use right now,
 * or "" when it can. The server refuses these while a working draft exists.
 */
export function statusChangeBlocked(o: { working: boolean; dirty: boolean }): string {
  if (o.working) return "Publish or discard the unpublished changes first.";
  if (o.dirty) return "Save or discard your changes first.";
  return "";
}

// ---------- the outline

export type ProcessSection = "about" | "before" | "people" | "steps" | "links" | "standards";
export type StandardSection = "about" | "scope" | "requirements" | "background";
export type Section = ProcessSection | StandardSection;

/** What is selected on the editing screen: a section of the outline, or one step or requirement. */
export type Selection = { section: Section; item?: string };

export const PROCESS_SECTIONS: { id: ProcessSection; label: string }[] = [
  { id: "about", label: "About" },
  { id: "before", label: "Before you start" },
  { id: "people", label: "Who takes part" },
  { id: "steps", label: "Steps" },
  { id: "links", label: "Links and resources" },
  { id: "standards", label: "Standards it helps to meet" },
];
export const STANDARD_SECTIONS: { id: StandardSection; label: string }[] = [
  { id: "about", label: "About" },
  { id: "scope", label: "Scope and exceptions" },
  { id: "requirements", label: "Requirements" },
  { id: "background", label: "Background" },
];

/** The first part of a checker path: "steps[2].next[0].to" -> ["steps", 2]. */
function head(path: string): [string, number | undefined] {
  const m = path.match(/^([A-Za-z$]+)(?:\[(\d+)\])?/);
  return m ? [m[1], m[2] === undefined ? undefined : Number(m[2])] : ["", undefined];
}

/** Where a problem the checker found belongs in the outline of a process. */
export function processIssueTarget(p: Pick<Process, "steps">, path: string): Selection {
  const [key, i] = head(path);
  switch (key) {
    case "steps": {
      const step = i !== undefined && Array.isArray(p.steps) ? p.steps[i] : undefined;
      return step?.id ? { section: "steps", item: step.id } : { section: "steps" };
    }
    case "prerequisites": return { section: "before" };
    case "actors": return { section: "people" };
    case "resources": return { section: "links" };
    case "standards": return { section: "standards" };
    // the name, summary, owner, lists, review rhythm and anything about the whole document
    default: return { section: "about" };
  }
}

/** Where a problem the checker found belongs in the outline of a standard. */
export function standardIssueTarget(s: Pick<Standard, "requirements">, path: string): Selection {
  const [key, i] = head(path);
  switch (key) {
    case "requirements": {
      const r = i !== undefined && Array.isArray(s.requirements) ? s.requirements[i] : undefined;
      return r?.id ? { section: "requirements", item: r.id } : { section: "requirements" };
    }
    // a standard's scope, exceptions and where it applies are changed together, under "Scope and exceptions"
    case "scope": case "exceptionProcessId": case "tiers": case "languages": case "environments": case "tags": return { section: "scope" };
    case "resources": return { section: "background" };
    default: return { section: "about" };
  }
}

export const issueTarget = (kind: TargetKind, doc: Process | Standard, path: string): Selection =>
  kind === "process" ? processIssueTarget(doc as Process, path) : standardIssueTarget(doc as Standard, path);

/** How many errors and warnings belong to each section and each item: "about", "steps", "steps/<id>". */
/** `examples`: how many of the errors are example texts still to be replaced (see exampleIssues). */
export interface IssueCount { errors: number; warnings: number; examples: number }
export function issuesByPlace(kind: TargetKind, doc: Process | Standard, issues: Issue[]): Map<string, IssueCount> {
  const out = new Map<string, IssueCount>();
  const add = (key: string, issue: Issue) => {
    const c = out.get(key) ?? { errors: 0, warnings: 0, examples: 0 };
    if (issue.level === "error") c.errors++; else c.warnings++;
    if (issue.level === "error" && isExampleIssue(issue)) c.examples++;
    out.set(key, c);
  };
  for (const issue of issues) {
    const t = issueTarget(kind, doc, issue.path);
    add(t.section, issue);
    if (t.item) add(`${t.section}/${t.item}`, issue);
  }
  return out;
}

/** The problems that belong to what is selected. A section shows its own and those of its items. */
export function issuesFor(kind: TargetKind, doc: Process | Standard, issues: Issue[], sel: Selection): Issue[] {
  return issues.filter((i) => {
    const t = issueTarget(kind, doc, i.path);
    return t.section === sel.section && (sel.item === undefined ? true : t.item === sel.item);
  });
}

export interface OutlineEntry {
  /** "about", "steps", or "steps/<id>" for an item. */
  key: string;
  section: Section;
  item?: string;
  label: string;
  /** For an item: "1", "2" for steps, the requirement id for requirements. */
  number?: string;
  /** How many things a section holds, where that helps (steps, lanes, links). */
  count?: number;
  depth: 0 | 1;
  /** A step: its kind, who does it, and the position of that participant (the colour of its lane). */
  type?: StepType;
  who?: string;
  lane?: number;
  /** A requirement: its level. */
  level?: Level;
}

/** Where the outline's choice (open or collapsed) is remembered, per person, in this browser. */
export const outlineKey = (email?: string) => `pm:outline:${email ?? ""}`;
/**
 * Whether the outline shows as a narrow rail (numbers and kind icons only): only when the person
 * chose it ("rail", remembered); open, with the names, at every desktop width otherwise. (Below
 * 1280 pixels the outline slides over the screen and is never a rail.)
 */
export function outlineCollapsed(stored: string | null | undefined): boolean {
  return stored === "rail";
}

/** What the outline of a process lists, in order: its sections, and every step under "Steps". */
export function processOutline(p: Process): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const counts: Partial<Record<ProcessSection, number>> = {
    before: p.prerequisites?.length ?? 0, people: p.actors?.length ?? 0, steps: p.steps?.length ?? 0,
    links: p.resources?.length ?? 0, standards: p.standards?.length ?? 0,
  };
  for (const s of PROCESS_SECTIONS) {
    out.push({ key: s.id, section: s.id, label: s.label, count: counts[s.id], depth: 0 });
    if (s.id === "steps") (p.steps ?? []).forEach((step, i) => {
      const lane = (p.actors ?? []).findIndex((a) => a.id === step.actor);
      out.push({
        key: `steps/${step.id}`, section: "steps", item: step.id, label: step.title || "(no name yet)", number: String(i + 1), depth: 1,
        type: step.type, who: lane >= 0 ? p.actors[lane].name : step.actor, lane: lane >= 0 ? lane : undefined,
      });
    });
  }
  return out;
}

/** What the outline of a standard lists: its sections, and every requirement under "Requirements". */
export function standardOutline(s: Standard): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const counts: Partial<Record<StandardSection, number>> = { requirements: s.requirements?.length ?? 0, background: s.resources?.length ?? 0 };
  for (const sec of STANDARD_SECTIONS) {
    out.push({ key: sec.id, section: sec.id, label: sec.label, count: counts[sec.id], depth: 0 });
    if (sec.id === "requirements") (s.requirements ?? []).forEach((r) => out.push({ key: `requirements/${r.id}`, section: "requirements", item: r.id, label: r.title || "(no name yet)", number: r.id, depth: 1, level: r.level }));
  }
  return out;
}

/**
 * Where a dragged item lands, as the item it is put before (`null`: at the end), or `undefined`
 * when it stays where it is. `to` is the gap it is dropped into: 0 before the first item,
 * `ids.length` after the last.
 */
export function dropBefore(ids: string[], id: string, to: number): string | null | undefined {
  const from = ids.indexOf(id);
  if (from < 0 || to < 0 || to > ids.length || to === from || to === from + 1) return undefined;
  return to === ids.length ? null : ids[to];
}

/** The outline key of a selection. */
export const selectionKey = (sel: Selection) => (sel.item ? `${sel.section}/${sel.item}` : sel.section);

/**
 * The checker's summary on the editing bar, in two words only: "to fix" (stops publishing; calm
 * amber while it is only example text still to replace, red otherwise) and "suggestions" (never
 * stop anything). "Nothing to fix" when there is neither.
 */
export function checkerSummary(issues: Issue[]): { level: "bad" | "warn" | "hint" | "good"; text: string } {
  const errors = issues.filter((i) => i.level === "error");
  const hints = issues.length - errors.length;
  if (errors.length) return { level: errors.every((i) => isExampleIssue(i)) ? "warn" : "bad", text: `${errors.length} to fix` };
  if (hints) return { level: "hint", text: `${hints} suggestion${hints > 1 ? "s" : ""}` };
  return { level: "good", text: "Nothing to fix" };
}

/**
 * Suggestions about a step or requirement that is new on this screen wait until the person has
 * left it once: while it is being written, "say what to do" is not news. `isNew` says whether an
 * item was added on this screen and not left yet; problems that stop publishing always show.
 */
export function withoutEarlySuggestions(kind: TargetKind, doc: Process | Standard, issues: Issue[], isNew: (item: string) => boolean): Issue[] {
  return issues.filter((i) => {
    if (i.level !== "warning") return true;
    const t = issueTarget(kind, doc, i.path);
    return !t.item || !isNew(t.item);
  });
}

/** Whose field a checker path is about: "steps[2].title" is a step's, "requirements[0].title" a requirement's. */
export function pathContext(path: string, kind?: TargetKind): FieldContext | undefined {
  const first = path.match(/^[A-Za-z$]+/)?.[0];
  if (first === "steps") return /^steps\[\d+\]/.test(path) ? "step" : kind;
  if (first === "requirements") return /^requirements\[\d+\]/.test(path) ? "requirement" : kind;
  if (first === "actors" && /^actors\[\d+\]/.test(path)) return "participant";
  if (first === "prerequisites" && /^prerequisites\[\d+\]/.test(path)) return "prerequisite";
  return kind;
}

/**
 * A problem in words, as an instruction to the person: what to do, in the words of the field's
 * label ("Write what happens in this step.", "Link 1: start the address with https://"). Never a
 * path, a schema word or a number of characters. `kind`: a process or a standard (their fields are
 * not all called alike). The place (which step) is shown by where the problem is listed.
 * For the lists (`kind` "lists", `doc` the lists checked) the sentence names the list and the
 * entry itself, since a list of problems shows them all at once: "Give the team “Cloud Platform
 * team” a name." (`listIssueText`).
 */
export function issueText(issue: Issue, kind?: TargetKind | "lists", doc?: unknown): string {
  const message = typeof issue.message === "string" ? issue.message : "";
  const path = typeof issue.path === "string" ? issue.path : "";
  // a whole sentence already ("Say exactly what the reader does in this step.")
  if (/^[A-Z“]/.test(message)) return message;
  if (kind === "lists") return listIssueText(path, message, doc);
  const context = pathContext(path, kind);
  const missing = message.match(/^is missing the required field "(\w+)"$/);
  if (missing) return requiredText(missing[1], context);
  const parts = [...path.matchAll(/([A-Za-z$]+)(?:\[(\d+)\])?/g)].map((m) => ({ key: m[1], i: m[2] === undefined ? undefined : Number(m[2]) }));
  const last = parts[parts.length - 1] ?? { key: "", i: undefined };
  // a link is named by its place in its list: "Link 2: …"
  const link = [...parts].reverse().find((x) => x.key === "resources" && x.i !== undefined);
  const prefix = link ? `Link ${link.i! + 1}: ` : "";
  const say = (t: string) => (prefix ? `${prefix}${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);
  const field = fieldName(last.key, link ? undefined : context);
  if (/^is empty$/.test(message) || /^is too short/.test(message)) return say(shortText(last.key, last.i, context, !!link, /^is empty$/.test(message)));
  const long = message.match(/^is too long \(maximum (\d+)/);
  if (long) return say(`Shorten ${theField(field)}: it holds at most ${long[1]} characters.`);
  if (/full link/.test(message)) return say("Start the address with https://");
  if (/upper case with dashes/.test(message)) return "Write the id in capitals and digits joined by dashes, e.g. SEC-LOG-01.";
  if (/kebab-case/.test(message)) return say("Use only lowercase letters, digits and dashes here.");
  if (/pattern \^\\d\{4\}/.test(message)) return say("Write the date as year-month-day, e.g. 2026-11-20.");
  if (/^must be one of/.test(message)) return say(`Choose ${theField(field)} from the list.`);
  if (message === DUPLICATE_ITEMS) return say(`Name each entry once in ${theField(field)}: remove the one named twice.`);
  const extra = message.match(/^has a field "([^"]+)"/);
  if (extra) return `“${extra[1]}” is not part of a ${kind ?? "document"}: remove it in the JSON (More › JSON).`;
  const few = message.match(/^needs at least (\d+)/);
  if (few) return MIN_ITEMS[last.key] ?? say(`Add ${theField(field)}.`);
  const many = message.match(/^has too many items \(maximum (\d+)\)/);
  if (many) return say(`Keep at most ${many[1]} ${field}: remove some.`);
  if (/^must be of type|^must be exactly|^must match/.test(message)) return say(`${cap(theField(field))} is not in a form the portal can use: repair it in the JSON (More › JSON).`);
  if (message === EXAMPLE_MESSAGE) return say(`${cap(field)} is still the example text: write your own.`);
  return last.key && path !== "(root)" ? say(`${cap(field)} ${message}`) : cap(message);
}

/**
 * Where a problem is, in words: "Step 3 “Approve”", "Requirement SEC-LOG-01", "Link 2",
 * "Prerequisite 1 (no name yet)", else the section ("About"). For lists of problems outside the
 * editing screen's outline, such as the AI dialog's.
 */
export function issuePlace(kind: TargetKind, doc: unknown, path: string): string {
  const d = (doc && typeof doc === "object" ? doc : {}) as Record<string, unknown>;
  const m = (typeof path === "string" ? path : "").match(/^(steps|requirements|actors|prerequisites|resources)\[(\d+)\]/);
  if (m) {
    const i = Number(m[2]);
    const list = Array.isArray(d[m[1]]) ? (d[m[1]] as Record<string, unknown>[]) : [];
    const item = list[i] && typeof list[i] === "object" ? list[i] : {};
    const name = typeof item.title === "string" ? item.title.trim() : typeof item.name === "string" ? item.name.trim() : "";
    if (m[1] === "requirements") return `Requirement ${typeof item.id === "string" && item.id ? item.id : i + 1}${name ? ` “${name}”` : ""}`;
    const what = { steps: "Step", actors: "Participant", prerequisites: "Prerequisite", resources: "Link" }[m[1] as "steps"];
    return name ? `${what} ${i + 1} “${name}”` : `${what} ${i + 1} (no name yet)`;
  }
  const t = issueTarget(kind, (kind === "process" ? { steps: [] } : { requirements: [] }) as unknown as Process, path);
  return (kind === "process" ? PROCESS_SECTIONS : STANDARD_SECTIONS).find((x) => x.id === t.section)?.label ?? "About";
}

// ---------- the problems of the lists (Admin › Lists)

/** What a list's entry and its fields are called in a sentence. */
const LIST_NOUN: Record<string, { one: string; many: string }> = LIST_WORDS;
/** The fields of an entry of the lists, as the page's labels call them. */
const LIST_FIELD: Record<string, string> = {
  name: "name", id: "id", description: "description", url: "link", icon: "icon", contact: "other ways to reach them", contacts: "contact details",
  email: "group email", slack: "Slack channel", slackUrl: "link to the Slack channel", chat: "Google Chat space", chatUrl: "link to the Chat space",
  confluence: "Confluence page", page: "page link", form: "request form", symbol: "picture", alsoCalled: "other names", tribe: "tribe", domain: "domain",
};

/** Which list, entry and field a problem of the lists is about: "teams[3].contacts.slackUrl". */
export function listIssuePlace(path: string): { list?: keyof typeof LIST_WORDS; index?: number; field?: string; contact?: boolean } {
  const m = (typeof path === "string" ? path : "").match(/^([a-z]+)(?:\[(\d+)\])?(?:\.([A-Za-z]+))?(?:\.([A-Za-z]+))?/);
  if (!m || !(m[1] in LIST_WORDS)) return {};
  const list = m[1] as keyof typeof LIST_WORDS;
  const index = m[2] === undefined ? undefined : Number(m[2]);
  if (m[3] === "contacts") return { list, index, field: m[4] ?? "contacts", contact: !!m[4] };
  return { list, index, field: m[3] };
}

/** An entry of the lists in a sentence: "the team “Cloud Platform team”", else by its id, never by its place. */
export function listEntryWords(doc: unknown, list: string, index: number): string {
  const noun = LIST_NOUN[list]?.one ?? "entry";
  const entries = doc && typeof doc === "object" ? (doc as Record<string, unknown>)[list] : undefined;
  const entry = Array.isArray(entries) && entries[index] && typeof entries[index] === "object" ? (entries[index] as Record<string, unknown>) : {};
  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  // a name far too long is the problem itself: its beginning is enough to know it
  if (name) return `the ${noun} “${name.length > 60 ? `${name.slice(0, 57).trimEnd()}…` : name}”`;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (id) return `the ${noun} with the id “${id}”`;
  return `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun} without a name`;
}

/**
 * A problem of the lists as an instruction that names the list, the entry and the field by the
 * words of the page, never by a path: "Give the team “Cloud Platform team” a name.", "The link to
 * the Slack channel of the platform “Google Cloud” is not a whole link: write it with https:// at
 * the start.". One nobody foresaw
 * is still a sentence about its entry.
 */
function listIssueText(path: string, message: string, doc: unknown): string {
  const { list, index, field, contact } = listIssuePlace(path);
  if (!list) {
    const extra = message.match(/^has a field "([^"]+)"/);
    if (extra) return `The lists hold “${extra[1]}”, which the portal does not know: ask whoever looks after the portal to remove it.`;
    const missing = message.match(/^is missing the required field "(\w+)"$/);
    if (missing) return `The list of ${LIST_NOUN[missing[1]]?.many ?? missing[1]} is missing: ask whoever looks after the portal to put it back.`;
    return "The lists are not in a form the portal can use: ask whoever looks after the portal.";
  }
  if (index === undefined) return `The list of ${LIST_NOUN[list].many} is not in a form the portal can use: ask whoever looks after the portal.`;
  const entry = listEntryWords(doc, list, index);
  const Entry = cap(entry);
  const missing = message.match(/^is missing the required field "(\w+)"$/);
  const key = missing ? missing[1] : field ?? "";
  const words = LIST_FIELD[key] ?? key;
  const value = (() => {
    const e = doc && typeof doc === "object" ? ((doc as Record<string, unknown>)[list] as unknown[] | undefined)?.[index] : undefined;
    const holder = contact && e && typeof e === "object" ? (e as Record<string, unknown>).contacts : e;
    const v = holder && typeof holder === "object" && key ? (holder as Record<string, unknown>)[key] : undefined;
    return typeof v === "string" ? v : "";
  })();
  if (key === "name" && (missing || /^is empty$|^is too short/.test(message))) return `Give ${entry} a name.`;
  if (key === "id" && (missing || /kebab-case|^is empty$|^is too long/.test(message)))
    return `${Entry} has ${missing || !value.trim() ? "no id" : `an id the portal cannot use (“${value}”)`}: remove it and add it again under the same name.`;
  if (key === "icon") return `The icon of ${entry} is not an image the portal knows: choose the image again, or remove the icon.`;
  if (key === "alsoCalled") return `Check the other names of ${entry}: at most 5, each written once, none empty and none longer than 40 characters.`;
  if (key === "symbol") return `The picture of ${entry} is not one the portal knows: choose one of the pictures, or none.`;
  if (missing) return `Fill in the ${words} of ${entry}.`;
  if (/^is empty$|^is too short/.test(message)) return `Fill in the ${words} of ${entry}, or leave it out.`;
  const long = message.match(/^is too long \(maximum (\d+)/);
  if (long) return `Shorten the ${words} of ${entry} to at most ${long[1]} characters.`;
  if (/full link/.test(message)) return `The ${words} of ${entry} is not a whole link: ${/\s/.test(value.trim()) ? "remove the spaces and " : ""}write it with https:// at the start.`;
  if (/email address/.test(message)) return `The group email of ${entry} is not an email address: write one, like team@company.com.`;
  const extra = message.match(/^has a field "([^"]+)"/);
  if (extra) return `${Entry} has a detail the portal does not know (“${extra[1]}”): ask whoever looks after the portal to remove it.`;
  return key ? `Check the ${words} of ${entry}: the portal cannot use what is there.` : `Check ${entry}: the portal cannot use what is there.`;
}

/**
 * A save the server refused, in the words of the app's own checker (`refusalIssues`, `issueText`):
 * the problems one after the other, then how many more there are. Anything else the server said
 * (a sentence already, such as what is still in use) is shown as it is.
 */
export function refusalText(error: string, kind: TargetKind | "lists", doc: unknown): string {
  const r = refusalIssues(error);
  if (!r) return cap(typeof error === "string" ? error.trim() : "");
  const lines = r.issues.map((i) => issueText(i, kind, doc)).map((t) => (/[.!?:/]$/.test(t) ? t : `${t}.`));
  if (r.more) lines.push(`And ${r.more} more to fix.`);
  return lines.join(" ");
}

/**
 * Where the field a problem of the lists is about is in the details of its entry (Admin › Lists),
 * to bring the keyboard to it and mark it: CSS selectors to try in order. An id cannot be changed,
 * so its problems lead to the name; a problem of the whole entry too.
 */
export function listIssueField(path: string): string[] {
  const { field, contact } = listIssuePlace(path);
  if (contact) return [`[data-contact-field="${field}"] input`, ".contact-fields input"];
  switch (field) {
    case "description": return ['[data-field="description"]', '.contact-fields textarea[id$="-description"]'];
    case "contact": return ['.contact-fields input[id$="-contact"]'];
    case "url": return ['[data-field="url"]'];
    case "icon": return [".icon-field button"];
    case "alsoCalled": return ['[data-field="alsoCalled"]'];
    case "symbol": return [".symbol-picker button"];
    case "tribe": return ['[data-field="tribe"]'];
    case "domain": return ['[data-field="domain"]'];
    default: return ['[data-field="name"]'];
  }
}

/** "the name", "what happens": a field in a sentence. */
const theField = (f: string) => (/^(the |what |who |how |why |where )/.test(f) ? f : `the ${f}`);

const MIN_ITEMS: Record<string, string> = {
  steps: "Add a step.", requirements: "Add a requirement.", actors: "Add who takes part.", lookFor: "Write at least one sign of a violation.",
};

/** A text that is empty (or too short to say anything) as what to write. */
function shortText(key: string, i: number | undefined, context: FieldContext | undefined, isLink: boolean, empty: boolean): string {
  const more = empty ? "" : " in a few more words";
  if (isLink) return key === "url" ? "Write the address, starting with https://" : `Write the name of the link${more}.`;
  switch (key) {
    case "title":
      if (context === "step") return empty ? "Write what happens in this step." : "Write what happens in this step in a few more words.";
      if (context === "requirement") return empty ? "Give the requirement a short name." : "Give the requirement a short name of a few words.";
      if (context === "prerequisite") return empty ? "Write the prerequisite." : "Write the prerequisite in a few more words.";
      return `Write the name${more}.`;
    case "summary": return empty ? "Write the summary." : "Write the summary in a sentence or two.";
    case "statement": return empty ? "Write the rule." : "Write the rule as a whole sentence.";
    case "name": return context === "participant" ? "Write the name of who takes part." : `Write the name${more}.`;
    case "label": return "Name the answer, e.g. Approved.";
    case "instructions": return i === undefined ? "Write what to do." : `Write action ${i + 1}, or remove it.`;
    case "guidance": return i === undefined ? "Write the steps to comply." : `Write step ${i + 1} to comply, or remove it.`;
    case "good": case "bad": return i === undefined ? "Write the example." : `Write example ${i + 1}, or remove it.`;
    case "lookFor": return i === undefined ? "Write a sign of a violation." : `Write sign ${i + 1}, or remove it.`;
    case "paths": return "Write the files, or remove the empty line.";
    case "id": return "Give the requirement an id, e.g. SEC-LOG-01.";
    case "url": return "Write the address, starting with https://";
    default: return `Fill in ${theField(fieldName(key, context))}${more}.`;
  }
}

/** A field that must be there, by what the editing screen calls it. */
const REQUIRED: Record<string, string> = {
  summary: "Write the summary.", statement: "Write the rule.", owner: "Choose the team that issues it.",
  actor: "Choose who does it.", type: "Choose the kind of step.", level: "Choose the level.", verification: "Say how it is checked.",
  name: "Write the name.", id: "Give the requirement an id, e.g. SEC-LOG-01.", steps: "Add a step.", requirements: "Add a requirement.", actors: "Add who takes part.",
  url: "Write the address, starting with https://", to: "Choose where the answer goes.", lookFor: "Write at least one sign of a violation.",
};
function requiredText(key: string, context?: FieldContext): string {
  if (key === "id" && context !== "requirement") return "Give it an id in the JSON (More › JSON).";
  if (key === "title") return context === "step" ? "Write what happens in this step." : context === "requirement" ? "Give the requirement a short name." : context === "prerequisite" ? "Write the prerequisite." : "Write the name.";
  return REQUIRED[key] ?? `Fill in ${theField(fieldName(key, context))}.`;
}

// ---------- example texts

const EXAMPLE_MESSAGE = "is still the example: write your own before publishing.";
/** Whether a problem is an example text left in (it waits for publishing, not for saving). */
export const isExampleIssue = (i: Issue) => i.message === EXAMPLE_MESSAGE;

/**
 * The example texts a blank process or standard starts with, as problems to fix before
 * publishing (not before saving a draft). The texts are the ones `blankProcess`, `blankStandard`,
 * `addStepAfter` and `addRequirement` put in (EXAMPLE in lib/edit).
 */
export function exampleIssues(kind: TargetKind, doc: Process | Standard): Issue[] {
  const out: Issue[] = [];
  const is = (v: unknown, ...texts: string[]) => typeof v === "string" && texts.includes(v.trim());
  const flag = (path: string) => out.push({ level: "error", path, message: EXAMPLE_MESSAGE });
  if (is(doc.summary, EXAMPLE.processSummary, EXAMPLE.standardSummary)) flag("summary");
  if (kind === "process") {
    const steps = Array.isArray((doc as Process).steps) ? (doc as Process).steps : [];
    steps.forEach((st, i) => {
      if (is(st?.title, EXAMPLE.firstStep, EXAMPLE.newStep)) flag(`steps[${i}].title`);
      (Array.isArray(st?.instructions) ? st.instructions : []).forEach((ins, j) => { if (is(ins, EXAMPLE.instruction)) flag(`steps[${i}].instructions[${j}]`); });
    });
  } else {
    const reqs = Array.isArray((doc as Standard).requirements) ? (doc as Standard).requirements : [];
    reqs.forEach((r, i) => {
      if (is(r?.title, EXAMPLE.firstRequirement, EXAMPLE.newRequirement)) flag(`requirements[${i}].title`);
      if (is(r?.statement, EXAMPLE.statement)) flag(`requirements[${i}].statement`);
      if (is(r?.rationale, EXAMPLE.rationale)) flag(`requirements[${i}].rationale`);
    });
  }
  return out;
}

// ---------- what publishing changes

/** The review dates: the server keeps those of the published version, so they are never a change of the draft. */
export function withoutReviewDates<T extends Process | Standard>(doc: T): T {
  if (!doc || typeof doc !== "object" || !doc.review || typeof doc.review !== "object") return doc;
  const { lastReviewedAt: _a, reviewedBy: _b, ...review } = doc.review; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...doc, review };
}

/** A value short enough to show before and after: a line of text, a number, nothing. */
const shortValue = (v: unknown): v is string | number | undefined | null =>
  v === undefined || v === null || typeof v === "number" || (typeof v === "string" && v.length <= 70 && !v.includes("\n"));
const quoted = (v: unknown) => (v === undefined || v === null || v === "" ? "nothing" : `“${v}”`);
const keyFor = (label: string, context: FieldContext | undefined, ...objects: unknown[]) => {
  const keys = new Set(objects.flatMap((o) => (o && typeof o === "object" ? Object.keys(o) : [])));
  return [...keys].find((k) => fieldName(k, context) === label);
};

/**
 * A value as a reader knows it: a participant, team, tool, category, platform, practice, tier,
 * environment or language by its name instead of its id ("me" is "You"), a list of them joined
 * ("Tier 0, Tier 1"). Anything else as it is; an id not found in its list as it is.
 */
export function valueByName(key: string, v: unknown, catalog?: Catalog, actors: { id: string; name: string }[] = []): unknown {
  const LISTS: Record<string, keyof Catalog> = {
    owner: "teams", teamId: "teams", tool: "tools", category: "categories", practice: "practices", platform: "platforms",
    tiers: "tiers", environments: "environments", languages: "languages", paths: "paths", patterns: "patterns",
  };
  const name = (id: unknown): unknown => {
    if (typeof id !== "string" || !id) return id;
    if (key === "actor") return actors.find((a) => a.id === id)?.name ?? (id === "me" ? "You" : id);
    const list = LISTS[key] ? (catalog?.[LISTS[key]] as { id: string; name: string }[] | undefined) : undefined;
    return list?.find((x) => x.id === id)?.name ?? id;
  };
  if (key !== "actor" && !LISTS[key]) return v;
  if (Array.isArray(v)) return v.length ? v.map(name).join(", ") : undefined;
  return name(v);
}

/** Where the items of a kind of change are in a document, and whose fields they have. */
const ITEMS: Record<string, { list: string; context: FieldContext }> = {
  Step: { list: "steps", context: "step" }, Requirement: { list: "requirements", context: "requirement" }, Participant: { list: "actors", context: "participant" },
};

/**
 * One line of the Publish list: what readers will see differently, in plain words - a short
 * field as before and after ("Name: “A” → “B”"), a long one by what and where it is ("Step
 * “Approve the budget” changed: what to do"). `before` is the version readers see now.
 */
function publishLine(kind: TargetKind, c: Change, before: Record<string, unknown>, after: Record<string, unknown>, catalog?: Catalog): string {
  // values that are ids are shown by their names: a participant, a team, a tool, a tier…
  const actors = (o: Record<string, unknown>) => (Array.isArray(o.actors) ? (o.actors as unknown[]).filter((a): a is { id: string; name: string } => !!a && typeof a === "object") : []);
  const shown = (key: string, v: unknown, o: Record<string, unknown>, other: Record<string, unknown>) => valueByName(key, v, catalog, [...actors(o), ...actors(other)]);
  if (c.what === "Details" && c.from === undefined && c.to === undefined) {
    const key = keyFor(c.label, kind, before, after);
    const was = key ? shown(key, before[key], before, after) : undefined, now = key ? shown(key, after[key], after, before) : undefined;
    if (key && shortValue(was) && shortValue(now)) return `${cap(fieldName(key, kind))}: ${quoted(was)} → ${quoted(now)}`;
    // a long text that became short is shown as it is now
    if (key && typeof now === "string" && shortValue(now)) return `${cap(fieldName(key, kind))} changed, now ${quoted(now)}`;
    return describeChange(c);
  }
  const where = ITEMS[c.what];
  if (c.kind === "changed" && where && c.details?.length) {
    const items = (o: Record<string, unknown>) => (Array.isArray(o[where.list]) ? (o[where.list] as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
    const now = items(after).find((x) => x.id === c.id);
    const was = now ? items(before).find((x) => x.id === c.id) : undefined;
    const parts = c.details.map((d) => {
      const key = keyFor(d, where.context, was, now);
      const a = key && was ? shown(key, was[key], before, after) : undefined, b = key && now ? shown(key, now[key], after, before) : undefined;
      if (key && was && now && shortValue(a) && shortValue(b)) return `${d} ${quoted(a)} → ${quoted(b)}`;
      return d;
    });
    return `${itemWords(c)} changed: ${parts.join(", ")}`;
  }
  return describeChange(c);
}

/**
 * What readers will see differently once the draft is published, a line each (see publishLine).
 * Compared with the version readers see now; the review dates are left out.
 */
export function publishLines(kind: TargetKind, published: Process | Standard, draft: Process | Standard, catalog?: Catalog): string[] {
  const before = withoutReviewDates(published) as unknown as Record<string, unknown>;
  const after = withoutReviewDates(draft) as unknown as Record<string, unknown>;
  return compare(kind, before, after, catalog).map((c) => publishLine(kind, c, before, after, catalog));
}

/**
 * Said when the draft was started from an older version than readers see now - somebody really
 * published since (a review alone moves the draft along on the server). "" when it was not.
 */
export function baseBehindSentence(base: number, version: number): string {
  if (!base || version <= base) return "";
  return `Version ${version} was published after these changes were started from version ${base}. Publishing will show what changed in it and ask whether to publish yours over it.`;
}

/**
 * Who saved something, for a sentence: "You" when it was the person themselves (in another
 * window), else their name, else their email, else "Somebody else".
 */
export function author(by: { updatedBy?: string; updatedByName?: string } | undefined, myEmail?: string): { you: boolean; name: string } {
  const you = !!by?.updatedBy && !!myEmail && by.updatedBy.toLowerCase() === myEmail.toLowerCase();
  return { you, name: you ? "You" : by?.updatedByName || by?.updatedBy || "Somebody else" };
}

/**
 * Whose work a publication puts out, for the Publish dialog: somebody else when they saved what
 * is published last (the person's own unsaved changes make it theirs). Undefined: the person's.
 */
export function lastSavedByOther(by: { updatedBy?: string; updatedByName?: string } | undefined, myEmail: string | undefined, dirty: boolean): string | undefined {
  if (dirty || !by?.updatedBy || ["import", "system"].includes(by.updatedBy)) return undefined;
  const who = author(by, myEmail);
  return who.you ? undefined : who.name;
}

/** "Morgan Member’s", "James’". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** The Publish dialog's title and first line: whose changes, never claiming more than who saved them last. */
export function publishDialogWords(noun: string, first: boolean, version: number | undefined, other?: string, otherAt?: string): { title: string; subtitle: string; audience?: boolean } {
  const saved = other ? `Last saved by ${other}${otherAt ? ` ${savedWhen(otherAt)}` : ""}. ` : "";
  if (first) return { title: `Publish this ${noun}`, subtitle: saved, audience: true };
  return { title: other ? `Publish ${possessive(other)} changes` : "Publish your changes", subtitle: `${saved}Until you publish, readers see version ${version}.` };
}

/**
 * Who saved a version, for the versions list: the person's name where the portal knows it (else
 * their email), and a plain word for a version that no person saved.
 */
export function savedByText(v: { savedBy: string; savedByName?: string }): string {
  if (v.savedBy === "import") return "Imported";
  if (v.savedBy === "system") return "Updated by the portal";
  return v.savedByName || v.savedBy || "Somebody";
}

/**
 * Who a version is by, for the versions list: "Jordan Platform", or, for a version that published
 * changes somebody else saved last, "published by Jordan Platform · changes last saved by Morgan Member".
 */
export function versionByText(v: { savedBy: string; savedByName?: string; changesBy?: string; changesByName?: string }): string {
  if (!v.changesBy) return savedByText(v);
  return `published by ${savedByText(v)} · changes last saved by ${v.changesByName || v.changesBy}`;
}

/**
 * The reader's page line about unpublished changes (shown only to who may edit): the person who
 * made them reads "You have unpublished changes (saved 02:09)"; other editors are told whose
 * they are. `when` is the time in words for others ("today at 02:09"), `clock` the short one.
 */
export function unpublishedLine(draft: { updatedAt: string; updatedBy: string; updatedByName?: string }, myEmail: string | undefined, publisher?: string): string {
  const who = author(draft, myEmail);
  const at = formatDateTime(draft.updatedAt);
  if (who.you && publisher) return `You have unpublished changes${at ? ` (saved ${at})` : ""}. ${publisher} publishes them; readers see the published version until then.`;
  if (who.you) return `You have unpublished changes${at ? ` (saved ${at})` : ""}. Readers see the published version.`;
  const name = draft.updatedByName || draft.updatedBy || "an editor";
  return `There are unpublished changes by ${name}${at ? `, saved ${at}` : ""}. Readers see the published version.`;
}

/** Who publishes, for somebody who may only draft: "An owner of Google Cloud", "An owner of Google Cloud or Engineering". */
export const ownerOfWords = (places: string[]) => (places.length ? `An owner of ${listParts(places, places.length, "or").join("")}` : "An editor");

/**
 * The reader's page line of a never-published document, for its editors, when it has newer
 * changes than what is shown (kept as its working draft, as they still have something to fix).
 */
export function newerChangesLine(draft: { updatedAt: string; updatedBy: string; updatedByName?: string }, myEmail: string | undefined): string {
  const who = author(draft, myEmail);
  const at = formatDateTime(draft.updatedAt);
  return `There are newer changes on the editing screen${who.you ? "" : ` by ${who.name}`}${at ? `, saved ${at}` : ""}.`;
}

/** "at 2026-11-20 14:02": when something was saved, for a sentence. "" when not known. */
export function savedWhen(iso?: string): string {
  const at = formatDateTime(iso);
  return at ? `at ${at}` : "";
}

/** The newest entry of the list of versions, as far as the sentences below need it. */
type Latest = { version: number; deleted: boolean; savedBy: string; savedByName?: string; savedAt: string };

/** "Alex Editor deleted it at 2026-11-20 09:12, while you were editing." - by name where the versions say who. */
export function deletedSentence(latest: Latest | undefined, myEmail?: string): string {
  if (!latest?.deleted) return "Somebody else deleted it while you were editing.";
  const who = author({ updatedBy: latest.savedBy, updatedByName: latest.savedByName }, myEmail);
  const at = savedWhen(latest.savedAt);
  return `${who.you ? "You deleted it in another window" : `${who.name} deleted it`}${at ? ` ${at}` : ""}, while you were editing.`;
}

/**
 * Why the shared draft is gone: published as a new version (by whom, as which version), or
 * discarded. Without a newer version than the one the changes started from, it was discarded.
 */
export function goneDraftSentence(latest: Latest | undefined, startedFrom: number | undefined, myEmail?: string, published = true): string {
  // a never-published document: its working draft goes when somebody saves it with nothing to fix
  const did = published ? "published" : "saved";
  if (!latest || latest.deleted || !startedFrom) return `The shared draft was ${did} or discarded, perhaps in another window, while you were editing.`;
  if (latest.version <= startedFrom) return "The shared draft was discarded, perhaps in another window, while you were editing.";
  const who = author({ updatedBy: latest.savedBy, updatedByName: latest.savedByName }, myEmail);
  const at = savedWhen(latest.savedAt);
  return `${who.you ? "You" : who.name} ${published ? "published it" : "saved the draft with nothing left to fix"} as version ${latest.version}${at ? ` ${at}` : ""}${who.you ? " in another window" : ""}, while you were editing.`;
}

/**
 * The revision of the shared working draft a save is made from: the revision of the draft the
 * changes on screen were made from (`editedFrom`, 0 when they were made from the document
 * itself) - never a newer draft somebody else saved meanwhile, which the server then reports as a
 * conflict instead of being overwritten. After "Save mine over theirs" (`over`, a conflict about
 * the draft): theirs, or 0 when it is gone.
 */
export function draftRevisionToSend(editedFrom: number, over?: { draft?: boolean; exists: boolean; version?: number }): number {
  if (over?.draft) return over.exists ? over.version ?? 0 : 0;
  return editedFrom;
}

/** Somebody else saved the shared draft after the unsaved changes on screen were started from another revision. */
export const draftMovedOn = (o: { dirty: boolean; editedFrom: number; working?: { revision: number } | null }): boolean =>
  o.dirty && !!o.working && o.working.revision !== o.editedFrom;

/**
 * Said when a save of the working draft finds that somebody else retired, unpublished, published
 * or brought back the document meanwhile ("" when nothing like that happened, or it was the
 * person themselves). `was`: the status the screen knew.
 */
export function statusChangedSentence(
  noun: string, was: Status | undefined,
  now: { status: Status; updatedBy: string; updatedByName?: string; updatedAt?: string } | undefined, myEmail?: string,
): string {
  const before = was ?? "active";
  if (!now || now.status === before) return "";
  const who = author(now, myEmail);
  if (who.you) return "";
  const at = savedWhen(now.updatedAt);
  const did = (what: string, then: string, after = "") => `${who.name} ${what} this ${noun}${after}${at ? ` ${at}` : ""}, while you were editing. ${then}`;
  if (now.status === "deprecated") return did("retired", "Readers see it marked as retired. Your changes are saved as unpublished changes.");
  if (now.status === "draft") return did("unpublished", "Readers no longer see it. Your changes are saved in its draft.");
  if (before === "draft") return did("published", "Readers now see their version. Your changes are saved as unpublished changes.");
  return did("brought", "Your changes are saved as unpublished changes.", " back into use");
}

/**
 * The `base` a save of the working draft sends. Creating it (rev 0) - also again after somebody
 * published or discarded it meanwhile - creates it on the version the changes were made from, so
 * that publishing meets any version published since instead of silently going over it. A save
 * after "Continue from theirs" moves the draft onto their version. Otherwise none: the draft
 * keeps its base.
 */
export function draftSaveBase(rev: number, startedFrom: number, continueFrom: number | null): number | undefined {
  if (rev === 0) return startedFrom || undefined;
  return continueFrom ?? undefined;
}

/** "14:02" when it was today, "on 2026-11-17" otherwise: when something was saved, for the editing bar. */
export function clock(iso?: string, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return dayOf(d) === today(now) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `on ${dayOf(d)}`;
}

/**
 * What Undo or Redo did, said as what is true now: "Step “Approve” is back." after undoing its
 * delete, "Step “Approve” is deleted again." after redoing it. `change`: the main difference from
 * what was on screen to what is on screen now (compare(kind, before, now)); `kind` of it "added"
 * means it came back. Without one, a plain "Undone." / "Done again.".
 */
export function steppedMessage(dir: "undo" | "redo", change?: Change): string {
  if (!change) return dir === "undo" ? "Undone." : "Done again.";
  const Label = cap(typeof change.label === "string" ? change.label.trim() : "") || "It";
  if (change.what === "Details") {
    if (change.from !== undefined || change.to !== undefined) return change.to ? `${Label} is “${change.to}” again.` : `${Label} is empty again.`;
    const many = isPlural(Label);
    return dir === "undo" ? `${Label} ${many ? "are as they were" : "is as it was"}.` : `${Label} ${many ? "are" : "is"} changed again.`;
  }
  const thing = cap(itemWords(change));
  if (change.kind === "added") return dir === "undo" ? `${thing} is back.` : `${thing} is added again.`;
  if (change.kind === "removed") return dir === "undo" ? `${thing} is gone again.` : `${thing} is deleted again.`;
  const parts = change.details?.length ? change.details.join(", ") : "";
  return dir === "undo" ? (parts ? `${thing}: ${parts} as before.` : `${thing} is as it was.`) : (parts ? `${thing}: ${parts} changed again.` : `${thing} is changed again.`);
}

/** Whether a field's name is a plural ("Application tiers", "Tags"), for "are" or "is". */
export const isPlural = (label: string) => /s$/i.test(label.trim()) && !/^order of|status$|process$|access$|address$|is$/i.test(label.trim());

/**
 * The delete button of a step or requirement ignores presses for a moment after the selection
 * changed: after a delete the next item is selected under the same pointer, and a second click
 * (or Enter) must not delete it as well. True when a press may delete.
 */
export const DELETE_PAUSE = 700;
export function deleteReady(selectedAt: number, now: number, pause = DELETE_PAUSE): boolean {
  return now - selectedAt >= pause;
}

/**
 * The one item that moved between two orders of the same items (a step or requirement moved by
 * dragging, the keys or "Move…"), so that Undo and Redo can name it rather than a neighbour whose
 * arrows changed with it. Undefined when the items differ or more than one moved.
 */
export function movedItem(before: string[], after: string[]): string | undefined {
  if (before.length !== after.length || before.join("\n") === after.join("\n")) return undefined;
  const set = new Set(before);
  if (after.some((x) => !set.has(x))) return undefined;
  const without = (list: string[], id: string) => list.filter((x) => x !== id).join("\n");
  return before.find((id) => without(before, id) === without(after, id));
}

/** What Undo or Redo says after it took back or did again a move: the item that moved, by name. */
export function movedMessage(dir: "undo" | "redo", what: "Step" | "Requirement", label: string, unnamed: string): string {
  return `${itemWords({ what, label, unnamed })} is ${dir === "undo" ? "back in its place" : "moved again"}.`;
}

/**
 * Where the field a problem is about is on the editing screen, to bring the keyboard to it from
 * the checker's list: CSS selectors to try in order (inside the fields panel), then the label the
 * field has, to find it by. `kind`: a process or a standard.
 */
export function issueField(path: string, kind?: TargetKind): { selectors: string[]; label: string } {
  const context = pathContext(path, kind);
  const parts = [...path.matchAll(/([A-Za-z$]+)(?:\[(\d+)\])?/g)].map((m) => ({ key: m[1], i: m[2] === undefined ? undefined : Number(m[2]) }));
  const last = parts[parts.length - 1] ?? { key: "", i: undefined };
  const at = (key: string) => parts.find((p) => p.key === key)?.i;
  const nth = (i: number | undefined) => (i === undefined ? "" : `:nth-child(${i + 1})`);
  const label = fieldName(last.key, context);
  const sel: string[] = [];
  switch (last.key) {
    case "instructions": sel.push(`.ins-rows > li${nth(last.i)} textarea`, ".ins-rows textarea", ".add-row"); break;
    case "next": case "to": case "label": {
      const j = at("next");
      sel.push(last.key === "label" ? `.path-rows > li${nth(j)} .next-label` : `.path-rows > li${nth(j)} select`, ".path-rows .next-label", ".path-rows select", ".path-adds button"); break;
    }
    case "actor": sel.push(".step-core [aria-pressed=true]", ".step-core .chips button"); break;
    case "type": sel.push(".kind-pick"); break;
    case "title": case "name": case "description": case "processId": case "url":
      if (parts[0]?.key === "prerequisites") sel.push(`[aria-label="${last.key === "title" ? `Prerequisite ${(at("prerequisites") ?? 0) + 1}` : last.key === "description" ? `About prerequisite ${(at("prerequisites") ?? 0) + 1}` : `Process that provides prerequisite ${(at("prerequisites") ?? 0) + 1}`}"]`);
      else if (parts[0]?.key === "actors") sel.push(`[aria-label="${last.key === "description" ? "About" : "Name of"} participant ${(at("actors") ?? 0) + 1}"]`);
      else if (parts.some((p) => p.key === "resources")) sel.push(`[aria-label="${last.key === "url" ? "Address of" : last.key === "description" ? "What" : "Name of"} link ${(at("resources") ?? 0) + 1}${last.key === "description" ? " does for the reader" : ""}"]`);
      else if (context === "step" && last.key === "title") sel.push("input.step-title");
      break;
    case "lookFor": sel.push(".edit-fields [aria-label^='Signs of a violation']"); break;
    case "actors": if (last.i !== undefined) { sel.push(`[aria-label="Name of participant ${last.i + 1}"]`); break; } // falls through
    default: if (last.key) sel.push(`[data-field="${last.key}"]`);
  }
  return { selectors: sel, label };
}

/** A line of the Publish list; `undoes`: publishing it would take back a change published since the draft was started. */
export interface PublishLine { text: string; undoes: boolean }

/**
 * Whether a change between the version readers see now (`current`) and the draft takes back
 * something that was published after the draft was started from `base`: a three-way comparison.
 * Nothing is merged; the Publish list only marks such a line.
 */
export function undoesPublished(kind: TargetKind, c: Change, base: Process | Standard, current: Process | Standard, draft: Process | Standard): boolean {
  const o = (d: unknown) => (d && typeof d === "object" ? d as Record<string, unknown> : {});
  const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) || ((a === undefined || a === "" || (Array.isArray(a) && !a.length)) && (b === undefined || b === "" || (Array.isArray(b) && !b.length)));
  // a field: the draft still has what the base had, readers now have something else
  const reverts = (k: string, b: Record<string, unknown>, cur: Record<string, unknown>, dr: Record<string, unknown>) => eq(dr[k], b[k]) && !eq(cur[k], b[k]);
  const B = o(base), C = o(current), D = o(draft);
  if (c.what === "Details") {
    const key = [...new Set([...Object.keys(B), ...Object.keys(C), ...Object.keys(D)])].find((k) => fieldName(k, kind) === c.label);
    return !!key && reverts(key, B, C, D);
  }
  if (c.what === "Prerequisite") {
    const has = (d: Record<string, unknown>) => (Array.isArray(d.prerequisites) ? d.prerequisites as { title?: string }[] : []).some((q) => (q?.title ?? "") === c.label);
    if (c.kind === "added") return has(B) && !has(C);   // they removed it, the draft brings it back
    if (c.kind === "removed") return !has(B) && has(C); // they added it, the draft does not have it
    return false;
  }
  const where = ITEMS[c.what];
  if (!where || !c.id) return false;
  const item = (d: Record<string, unknown>) => (Array.isArray(d[where.list]) ? (d[where.list] as Record<string, unknown>[]).find((x) => x?.id === c.id) : undefined);
  const b = item(B), cur = item(C), dr = item(D);
  if (c.kind === "added") return !!b && !cur;
  if (c.kind === "removed") return !b && !!cur;
  if (!b || !cur || !dr) return false;
  return Object.keys({ ...b, ...cur, ...dr }).some((k) => c.details?.includes(fieldName(k, where.context)) && reverts(k, b, cur, dr));
}

/** The Publish list with the lines marked that would undo a change published since `base` (when it is older than `current`). */
export function publishList(kind: TargetKind, current: Process | Standard, draft: Process | Standard, catalog?: Catalog, base?: Process | Standard): PublishLine[] {
  const before = withoutReviewDates(current) as unknown as Record<string, unknown>;
  const after = withoutReviewDates(draft) as unknown as Record<string, unknown>;
  return compare(kind, before, after, catalog).map((c) => ({
    text: publishLine(kind, c, before, after, catalog),
    undoes: !!base && undoesPublished(kind, c, withoutReviewDates(base), before as unknown as Process, after as unknown as Process),
  }));
}

/**
 * Which item a move moved, remembered with the document the move made (Undo and Redo keep the very
 * same object): a swap of two neighbours cannot tell by itself which of the two was moved.
 */
const movedBy = new WeakMap<object, string>();
export const noteMove = (doc: object, id: string) => { movedBy.set(doc, id); };
export const moveOf = (doc: unknown): string | undefined => (doc && typeof doc === "object" ? movedBy.get(doc) : undefined);

/** A platform or practice a document belongs to, with its owners, for `whoPublishesSentence`. */
export interface PublishingGroup { kind: "platform" | "practice"; name: string; owners: PersonRef[] }

/**
 * A short list of things with "and": "a", "a and b", "a, b and c", "a, b, c and 2 more". The
 * parts in order, so that a page can draw each item as an element (`peopleList` for plain text).
 */
export function listParts<T>(items: readonly T[], most = 3, word = "and"): (T | string)[] {
  const shown = items.slice(0, most), rest = items.length - shown.length;
  const parts: (T | string)[] = rest > 0 ? [...shown, `${rest} more`] : [...shown];
  if (parts.length <= 1) return parts;
  const out: (T | string)[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(i === parts.length - 1 ? ` ${word} ` : ", ");
    out.push(p);
  });
  return out;
}

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
export const peopleList = (people: string[], most = 3): string => listParts(people, most).join("");

/** A sentence in parts: text, and people a page may draw as elements (by name, the address as tooltip). */
export type SentencePart = string | PersonRef;
/** The text of a sentence in parts, each person by `personLabel`. */
export const partsText = (parts: readonly SentencePart[]) => parts.map((p) => (typeof p === "string" ? p : personLabel(p))).join("");

/**
 * Who publishes a document the person may not publish (`publishPlaces` says whose ownership it
 * depends on), led by the people, by name where it is known (`owners` false: not loaded yet, so
 * they are left out). `all` false: an owner of any one of `groups`; true: somebody who owns every
 * one of them (with one group the same). `draft`: "saved" when the person's draft is saved,
 * otherwise Save draft is what keeps their work. E.g. "Jordan Platform, an owner of Google Cloud,
 * publishes this. Your draft is saved for them."
 */
export function whoPublishesParts(kind: TargetKind, need: { all: boolean; groups: PublishingGroup[] }, draft: "saved" | "unsaved" | "none", owners = true): SentencePart[] {
  const editor = kind === "process" ? "a process editor" : "a standards editor";
  const groups = need.groups;
  const names = (gs: PublishingGroup[], word: string) => listParts(gs.map((g) => g.name), gs.length, word).join("");
  const every = need.all && groups.length > 1;
  const key = (x: PersonRef) => x.email.toLowerCase();
  const parts: SentencePart[] = [];
  if (!groups.length) parts.push(`${cap(editor)} publishes this.`);
  else if (every) {
    const which = `${groups.length === 2 ? "both " : ""}${names(groups, "and")}`;
    const common = groups[0].owners.filter((o) => groups.every((g) => g.owners.some((x) => key(x) === key(o))));
    if (!owners) parts.push(`Somebody who owns ${which} publishes this.`);
    else if (!common.length) parts.push(`Nobody owns ${which} yet: ${editor} publishes this.`);
    else parts.push(`Somebody who owns ${which} publishes this: `, ...listParts(common, 3, "or"), ".");
  } else {
    const people: PersonRef[] = [];
    for (const g of groups) for (const o of g.owners) if (!people.some((x) => key(x) === key(o))) people.push(o);
    const of = names(groups, "or");
    if (!owners) parts.push(`An owner of ${of} publishes this.`);
    else if (!people.length) parts.push(`${names(groups, "and")} ${groups.length === 1 ? "has" : "have"} no owner yet: ${editor} publishes this.`);
    else if (people.length === 1) parts.push(people[0], `, an owner of ${of}, publishes this.`);
    else parts.push(`An owner of ${of} publishes this: `, ...listParts(people, 3, "or"), ".");
  }
  parts.push(draft === "saved" ? " Your draft is saved for them." : " Save draft keeps your work for them.");
  return parts;
}

/** What pressing Publish… says to somebody who may not publish: the banner above says who does. */
export const whoPublishesShort = (kind: TargetKind, need: { groups: PublishingGroup[] }) =>
  need.groups.length ? "An owner publishes this: see above." : `${kind === "process" ? "A process editor" : "A standards editor"} publishes this: see above.`;

/** `whoPublishesParts` as plain text, for the checker's list and messages. */
export const whoPublishesSentence = (kind: TargetKind, need: { all: boolean; groups: PublishingGroup[] }, draft: "saved" | "unsaved" | "none", owners = true): string =>
  partsText(whoPublishesParts(kind, need, draft, owners));
