import type { Process, Requirement, Standard, Step } from "../types";

/**
 * What changed between two versions of a process or a standard, in words a reader understands:
 * which steps or requirements were added, removed or changed, and which details of the whole
 * document are different. Used by the version history and when two people edited at once.
 */
export interface Change {
  kind: "added" | "removed" | "changed";
  /** What it is about, e.g. "Step", "Requirement", "Details". */
  what: string;
  /** The thing itself: a step title, a requirement id and title, a field name. */
  label: string;
  /** For changes: which parts are different. */
  details?: string[];
}

type Doc = Record<string, unknown>;

// nothing, an empty list and an empty text are the same to a reader
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a: unknown, b: unknown) => (blank(a) && blank(b)) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isObject = (v: unknown): v is Doc => !!v && typeof v === "object" && !Array.isArray(v);

/** Names for the fields of a document, a step and a requirement. */
const FIELD: Record<string, string> = {
  title: "title", summary: "summary", category: "category", owner: "owner", tiers: "tiers", languages: "languages", environments: "environments",
  estimatedDuration: "typical duration", tags: "tags", status: "status", replacedBy: "replaced by", review: "review", resources: "links",
  standards: "standards", actors: "participants", scope: "scope", exceptionProcessId: "exception process",
  actor: "who does it", type: "kind", description: "description", instructions: "instructions", tool: "tool", url: "link", urlLabel: "link text",
  duration: "duration", outcome: "result", subProcessId: "sub-process", next: "what comes next",
  level: "level", statement: "statement", rationale: "reason", guidance: "how to comply", examples: "examples", verification: "how it is checked",
  processId: "helpful process",
};
const name = (key: string) => FIELD[key] ?? key;

/** Which of the given fields differ between two objects, by their readable names. */
function changedFields(a: Doc, b: Doc, skip: string[]): string[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !skip.includes(k));
  return keys.filter((k) => !same(a[k], b[k])).map(name);
}

/** Added, removed and changed items of a list whose items have an id. */
function compareItems<T extends { id: string }>(what: string, before: T[], after: T[], label: (t: T) => string, changes: Change[]) {
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
    if (!prev) changes.push({ kind: "added", what, label: label(x) });
    else {
      const details = changedFields(prev as unknown as Doc, follow(x), ["id"]);
      if (details.length) changes.push({ kind: "changed", what, label: label(x), details });
    }
  }
  for (const x of gone) if (![...renamed.values()].includes(x.id)) changes.push({ kind: "removed", what, label: label(x) });
  for (const [, id] of renamed) now.set(id, old.get(id)!); // for the order below, a renamed item is still there
  // the same items in another order
  const kept = (list: T[], other: Map<string, T>, id: (x: T) => string) => list.map(id).filter((i) => other.has(i)).join("\n");
  if (kept(before, now, (x) => x.id) !== kept(after, old, (x) => oldIdOf(x.id))) changes.push({ kind: "changed", what: "Details", label: `order of the ${what.toLowerCase()}s` });
}

// what a version holds, without the entries that are not objects (a broken version is still compared, not crashed on)
const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter((x) => isObject(x)) : []);

export function compareProcesses(before: Process, after: Process): Change[] {
  if (!isObject(before) || !isObject(after)) return [];
  const changes: Change[] = [];
  // updatedAt changes with every save and says nothing; steps and prerequisites are listed on their own
  for (const field of changedFields(before as unknown as Doc, after as unknown as Doc, ["steps", "prerequisites", "updatedAt", "$schema", "schemaVersion", "id"])) {
    changes.push({ kind: "changed", what: "Details", label: field });
  }
  // prerequisites have no id: they are matched by title, and two with the same title in the order they come
  const oldPre = list(before.prerequisites), newPre = list(after.prerequisites);
  const left = [...oldPre];
  const pairs: [number, number][] = []; // [position before, position after]
  newPre.forEach((q, at) => {
    const i = left.findIndex((o) => o.title === q.title);
    if (i < 0) return void changes.push({ kind: "added", what: "Before you start", label: q.title });
    const [prev] = left.splice(i, 1);
    pairs.push([oldPre.indexOf(prev), at]);
    if (!same(prev, q)) changes.push({ kind: "changed", what: "Before you start", label: q.title });
  });
  for (const q of left) changes.push({ kind: "removed", what: "Before you start", label: q.title });
  if (pairs.some(([was], i) => i > 0 && was < pairs[i - 1][0])) changes.push({ kind: "changed", what: "Details", label: "order of what is needed before you start" });
  compareItems<Step>("Step", list(before.steps), list(after.steps), (s) => s.title, changes);
  return changes;
}

export function compareStandards(before: Standard, after: Standard): Change[] {
  if (!isObject(before) || !isObject(after)) return [];
  const changes: Change[] = [];
  for (const field of changedFields(before as unknown as Doc, after as unknown as Doc, ["requirements", "updatedAt", "$schema", "schemaVersion", "id"])) {
    changes.push({ kind: "changed", what: "Details", label: field });
  }
  compareItems<Requirement>("Requirement", list(before.requirements), list(after.requirements), (r) => `${r.id} ${r.title}`, changes);
  return changes;
}

export function compare(kind: "process" | "standard", before: unknown, after: unknown): Change[] {
  return kind === "process" ? compareProcesses(before as Process, after as Process) : compareStandards(before as Standard, after as Standard);
}

/** One line for a change, e.g. `Step “Approve the budget” changed: who does it, duration`. */
export function describeChange(c: Change): string {
  if (c.what === "Details") return `${c.label[0].toUpperCase()}${c.label.slice(1)} changed`;
  const verb = c.kind === "added" ? "added" : c.kind === "removed" ? "removed" : "changed";
  return `${c.what} “${c.label}” ${verb}${c.details?.length ? `: ${c.details.join(", ")}` : ""}`;
}

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
