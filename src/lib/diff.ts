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

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
  for (const x of after) {
    const prev = old.get(x.id);
    if (!prev) changes.push({ kind: "added", what, label: label(x) });
    else {
      const details = changedFields(prev as unknown as Doc, x as unknown as Doc, ["id"]);
      if (details.length) changes.push({ kind: "changed", what, label: label(x), details });
    }
  }
  for (const x of before) if (!now.has(x.id)) changes.push({ kind: "removed", what, label: label(x) });
  // the same items in another order
  const kept = (list: T[], other: Map<string, T>) => list.filter((x) => other.has(x.id)).map((x) => x.id).join("\n");
  if (kept(before, now) !== kept(after, old)) changes.push({ kind: "changed", what: "Details", label: `order of the ${what.toLowerCase()}s` });
}

const list = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export function compareProcesses(before: Process, after: Process): Change[] {
  const changes: Change[] = [];
  // updatedAt changes with every save and says nothing; steps and prerequisites are listed on their own
  for (const field of changedFields(before as unknown as Doc, after as unknown as Doc, ["steps", "prerequisites", "updatedAt", "$schema", "schemaVersion", "id"])) {
    changes.push({ kind: "changed", what: "Details", label: field });
  }
  const oldPre = list(before.prerequisites), newPre = list(after.prerequisites);
  const titles = (l: typeof oldPre) => new Set(l.map((q) => q.title));
  for (const q of newPre) if (!titles(oldPre).has(q.title)) changes.push({ kind: "added", what: "Before you start", label: q.title });
  for (const q of oldPre) if (!titles(newPre).has(q.title)) changes.push({ kind: "removed", what: "Before you start", label: q.title });
  for (const q of newPre) {
    const prev = oldPre.find((o) => o.title === q.title);
    if (prev && !same(prev, q)) changes.push({ kind: "changed", what: "Before you start", label: q.title });
  }
  compareItems<Step>("Step", list(before.steps), list(after.steps), (s) => s.title, changes);
  return changes;
}

export function compareStandards(before: Standard, after: Standard): Change[] {
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
