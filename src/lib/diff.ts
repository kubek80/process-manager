import type { Catalog, Process, Requirement, Rigour, Standard, Step } from "../types";

/**
 * What changed between two versions of a process or a standard, in words a reader understands:
 * which steps or requirements were added, removed or changed, and which details of the whole
 * document are different. Used by the version history and when two people edited at once.
 */
export interface Change {
  kind: "added" | "removed" | "changed";
  /** What it is about, e.g. "Step", "Requirement", "Details". */
  what: string;
  /** The thing itself: a step title, a requirement id and title, a field name. Empty: an item without a name yet. */
  label: string;
  /** For a step, participant or requirement: its id. */
  id?: string;
  /** How an item without a name is called by its place, e.g. "Step 3", "Prerequisite 2", "Requirement SEC-01". */
  unnamed?: string;
  /** For changes: which parts are different. */
  details?: string[];
  /** For a detail that holds one value (category, practice, platform, rigour): what it was and what it is now, by name. Empty: not set. */
  from?: string;
  to?: string;
}

export const RIGOUR_NAME: Record<Rigour, string> = { mandatory: "Mandatory", recommended: "Recommended", optional: "Optional" };

type Doc = Record<string, unknown>;

// nothing, an empty list and an empty text are the same to a reader
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => (blank(a) && blank(b)) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isObject = (v: unknown): v is Doc => !!v && typeof v === "object" && !Array.isArray(v);

/** What a field belongs to: its name depends on it ("name" of a process, "short name" of a requirement). */
export type FieldContext = "process" | "standard" | "step" | "requirement" | "participant" | "prerequisite" | "link";

/** Names for the fields, as the labels on the editing screen call them. */
const FIELD: Record<string, string> = {
  title: "name", summary: "summary", category: "category", practice: "practice", platform: "platform", rigour: "rigour", owner: "owning team", tiers: "application tiers", languages: "languages", environments: "environments",
  estimatedDuration: "typical lead time", tags: "tags", status: "status", replacedBy: "use instead", review: "review", resources: "links",
  standards: "standards it helps to meet", actors: "who takes part", prerequisites: "before you start", scope: "scope", exceptionProcessId: "how to ask for an exception",
  actor: "who does it", type: "kind of step", description: "description", instructions: "what to do", tool: "tool", url: "link", urlLabel: "link text",
  duration: "typical time", outcome: "result", subProcessId: "sub-process", next: "what comes next",
  level: "level", statement: "the rule", rationale: "why", guidance: "steps to comply", examples: "examples", verification: "how it is checked",
  processId: "process that helps", id: "id", name: "name", teamId: "team", lookFor: "signs of a violation", paths: "files", label: "name of the answer", to: "goes to",
};
/** Where a field is called otherwise in one place. */
const IN: Partial<Record<FieldContext, Record<string, string>>> = {
  // a document's paths (greenfield, brownfield…); a requirement's review "paths" are files
  process: { resources: "links and resources", paths: "paths" },
  standard: { owner: "issued by", resources: "background", paths: "paths" },
  step: { title: "what happens", description: "context", resources: "skills and links", processId: "process" },
  requirement: { title: "short name", review: "signs of a violation", processId: "process that helps to comply" },
  participant: { description: "how to reach them" },
  link: { title: "name", url: "address", description: "what it does for the reader", kind: "kind" },
  prerequisite: { description: "why it is needed", processId: "process that provides it" },
};
const name = (key: string, context?: FieldContext) => (context && IN[context]?.[key]) ?? FIELD[key] ?? key;
/** A field of a document, a step or a requirement in words, e.g. "who does it" for `actor`; `context` says whose field it is. */
export const fieldName = name;

/**
 * A step, prerequisite, participant or requirement in a sentence: `Step “Approve”`, or for one
 * without a name yet (just added, or its name cleared) by its place: `Step 3 (no name yet)`.
 */
export function itemWords(c: Pick<Change, "what" | "label" | "unnamed">): string {
  const label = typeof c.label === "string" ? c.label.trim() : "";
  if (label) return `${c.what} “${label}”`;
  return `${c.unnamed || c.what} (no name yet)`;
}

/** Which of the given fields differ between two objects, by their readable names. */
function changedFields(a: Doc, b: Doc, skip: string[], context?: FieldContext): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.includes(k));
  return keys.filter((k) => !same(a[k], b[k])).map((k) => name(k, context));
}

/** Added, removed and changed items of a list whose items have an id. */
function compareItems<T extends { id: string }>(what: string, before: T[], after: T[], label: (t: T) => string, changes: Change[], context?: FieldContext, place: (t: T, i: number) => string = (_, i) => `${what} ${i + 1}`) {
  // a name is always a text, also in a version that is broken
  const named = (x: T) => { const l = label(x); return typeof l === "string" ? l : ""; };
  const old = new Map(before.map((x) => [x.id, x]));
  const now = new Map(after.map((x) => [x.id, x]));
  // An item that only got another id (a new step is renamed from "new-step" when it is given
  // its name) is the same item: pairing it up avoids reporting it as removed and added, and
  // its neighbours as changed because they point at the new id.
  const renamed = new Map<string, string>(); // new id -> old id
  const gone = before.filter((x) => !now.has(x.id));
  for (const x of after) {
    if (old.has(x.id)) continue;
    const twin = gone.find((g) => ![...renamed.values()].includes(g.id) && !changedFields(g as unknown as Doc, x as unknown as Doc, ["id", "next"]).length);
    if (twin) renamed.set(x.id, twin.id);
  }
  const oldIdOf = (id: string) => renamed.get(id) ?? id;
  const follow = (x: T): Doc => {
    const next = (x as unknown as { next?: { to: string }[] }).next;
    return Array.isArray(next) ? { ...(x as unknown as Doc), next: next.map((n) => ({ ...n, to: oldIdOf(n.to) })) } : (x as unknown as Doc);
  };
  for (const x of after) {
    const prev = old.get(oldIdOf(x.id));
    const at = { id: x.id, unnamed: place(x, after.indexOf(x)) };
    if (!prev) changes.push({ kind: "added", what, label: named(x), ...at });
    else {
      const details = changedFields(prev as unknown as Doc, follow(x), ["id"], context);
      if (details.length) changes.push({ kind: "changed", what, label: named(x), details, ...at });
    }
  }
  for (const x of gone) if (![...renamed.values()].includes(x.id)) changes.push({ kind: "removed", what, label: named(x), id: x.id, unnamed: place(x, before.indexOf(x)) });
  for (const [, id] of renamed) now.set(id, old.get(id)!); // for the order below, a renamed item is still there
  // the same items in another order
  const kept = (list: T[], other: Map<string, T>, id: (x: T) => string) => list.map(id).filter((i) => other.has(i)).join("\n");
  if (kept(before, now, (x) => x.id) !== kept(after, old, (x) => oldIdOf(x.id))) changes.push({ kind: "changed", what: "Details", label: `order of the ${what.toLowerCase()}s` });
}

// what a version holds, without the entries that are not objects (a broken version is still compared, not crashed on)
const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter((x) => isObject(x)) : []);

/** The details that hold one value from a list: said with what they were and what they are now. */
const VALUED = ["category", "practice", "platform", "rigour", "owner", "status"] as const;
/** A status as the editing bar calls it. */
const STATUS_NAME: Record<string, string> = { draft: "Draft", active: "Published", deprecated: "Retired" };

/** The changed details of a whole document; those in VALUED say from what to what, by name where the lists are known. */
function detailChanges(before: Doc, after: Doc, skip: string[], catalog?: Catalog, context?: FieldContext): Change[] {
  const nameIn = (list: { id: string; name: string }[] | undefined, v: unknown) => (typeof v === "string" && v ? list?.find((x) => x.id === v)?.name ?? v : "");
  const valueName = (field: (typeof VALUED)[number], v: unknown): string => {
    if (field === "rigour") return typeof v === "string" ? RIGOUR_NAME[v as Rigour] ?? v : "";
    if (field === "status") return typeof v === "string" ? STATUS_NAME[v] ?? v : "";
    const list = field === "category" ? catalog?.categories : field === "practice" ? catalog?.practices : field === "owner" ? catalog?.teams : catalog?.platforms;
    return nameIn(list, v);
  };
  const changes: Change[] = changedFields(before, after, [...skip, ...VALUED], context).map((label) => ({ kind: "changed", what: "Details", label }));
  for (const field of VALUED) {
    if (same(before[field], after[field])) continue;
    changes.push({ kind: "changed", what: "Details", label: name(field, context), from: valueName(field, before[field]), to: valueName(field, after[field]) });
  }
  return changes;
}

/**
 * Items without an id (prerequisites, links), matched by their name, two with the same name in the
 * order they come: added, removed and changed ones, and a change of their order. `what`: "Prerequisite",
 * "Link"; `order`: the words for a change of their order.
 */
function compareNamed(what: string, before: Doc[], after: Doc[], changes: Change[], context: FieldContext | undefined, order: string) {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const at = (i: number) => `${what} ${i + 1}`;
  // first by name; what is left is paired by its place (a renamed one is the same item, changed)
  const pair = new Map<number, number>(); // position after -> position before
  const free = new Set(before.map((_, i) => i));
  after.forEach((q, i) => {
    const j = [...free].find((k) => before[k].title === q.title);
    if (j !== undefined) { pair.set(i, j); free.delete(j); }
  });
  after.forEach((_, i) => { if (!pair.has(i) && free.has(i)) { pair.set(i, i); free.delete(i); } });
  after.forEach((q, i) => {
    const j = pair.get(i);
    if (j === undefined) return void changes.push({ kind: "added", what, label: text(q.title), unnamed: at(i) });
    const prev = before[j];
    if (!same(prev, q)) changes.push({ kind: "changed", what, label: text(q.title), unnamed: at(i), details: changedFields(prev, q, [], context) });
  });
  for (const k of free) changes.push({ kind: "removed", what, label: text(before[k].title), unnamed: at(k) });
  const pairs = [...pair.entries()].sort((a, b) => a[0] - b[0]);
  if (pairs.some(([, was], i) => i > 0 && was < pairs[i - 1][1])) changes.push({ kind: "changed", what: "Details", label: order });
}

export function compareProcesses(before: Process, after: Process, catalog?: Catalog): Change[] {
  if (!isObject(before) || !isObject(after)) return [];
  // updatedAt changes with every save and says nothing; steps, prerequisites and links are listed one by one
  const changes = detailChanges(before as unknown as Doc, after as unknown as Doc, ["steps", "prerequisites", "actors", "resources", "updatedAt", "$schema", "schemaVersion", "id"], catalog, "process");
  compareNamed("Prerequisite", list(before.prerequisites) as unknown as Doc[], list(after.prerequisites) as unknown as Doc[], changes, "prerequisite", "order of what is needed before you start");
  compareNamed("Link", list(before.resources) as unknown as Doc[], list(after.resources) as unknown as Doc[], changes, "link", "order of the links");
  compareItems("Participant", list(before.actors), list(after.actors), (a) => a.name, changes, "participant");
  compareItems<Step>("Step", list(before.steps), list(after.steps), (s) => s.title, changes, "step");
  return changes;
}

export function compareStandards(before: Standard, after: Standard, catalog?: Catalog): Change[] {
  if (!isObject(before) || !isObject(after)) return [];
  const changes = detailChanges(before as unknown as Doc, after as unknown as Doc, ["requirements", "resources", "updatedAt", "$schema", "schemaVersion", "id"], catalog, "standard");
  compareNamed("Link", list(before.resources) as unknown as Doc[], list(after.resources) as unknown as Doc[], changes, "link", "order of the links");
  // a requirement is named by its id and name; without a name yet, by its id
  compareItems<Requirement>("Requirement", list(before.requirements), list(after.requirements), (r) => (typeof r.title === "string" && r.title.trim() ? `${r.id} ${r.title}` : ""), changes, "requirement",
    (r) => `Requirement ${r.id}`);
  return changes;
}

/** `catalog` gives the names of categories, practices and platforms; without it their ids are shown. */
export function compare(kind: "process" | "standard", before: unknown, after: unknown, catalog?: Catalog): Change[] {
  return kind === "process" ? compareProcesses(before as Process, after as Process, catalog) : compareStandards(before as Standard, after as Standard, catalog);
}

/**
 * One line for a change, e.g. `Step “Approve the budget” changed: who does it, duration` or
 * `Platform changed from “Azure” to “Google Cloud”`.
 */
export function describeChange(c: Change): string {
  // a step, prerequisite or requirement can have no name yet (just added, or its name cleared)
  const label = (typeof c.label === "string" ? c.label.trim() : "") || "An item without a name";
  const Label = cap(label);
  if (c.what === "Details" && (c.from !== undefined || c.to !== undefined)) {
    if (c.from && c.to) return `${Label} changed from “${c.from}” to “${c.to}”`;
    if (c.to) return `${Label} set to “${c.to}”`;
    if (c.from) return `${Label} no longer set (was “${c.from}”)`;
  }
  if (c.what === "Details") return `${Label} changed`;
  const verb = c.kind === "added" ? "added" : c.kind === "removed" ? "removed" : "changed";
  return `${itemWords(c)} ${verb}${c.details?.length ? `: ${c.details.join(", ")}` : ""}`;
}

/** A text with its first letter in upper case; "" stays "". */
export const cap = (t: string) => (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : "");

/** A short summary, e.g. "2 steps added, 1 changed, details changed". */
export function summarize(changes: Change[]): string {
  if (!changes.length) return "Nothing that readers see changed";
  const count = (kind: Change["kind"]) => changes.filter((c) => c.kind === kind && c.what !== "Details").length;
  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}`;
  if (count("added")) parts.push(plural(count("added"), "added"));
  if (count("changed")) parts.push(plural(count("changed"), "changed"));
  if (count("removed")) parts.push(plural(count("removed"), "removed"));
  if (changes.some((c) => c.what === "Details")) parts.push("details changed");
  return parts.join(", ");
}
