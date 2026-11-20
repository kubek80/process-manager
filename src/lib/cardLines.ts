import type { Catalog, Process, Rigour, Standard, TargetKind } from "../types";
import { rigourLine } from "./search";
import { reviewInfo } from "./lifecycle";

export { rigourLine };

// What a card in the lists and the search results says about a process or a standard: one piece
// of information per line, always in the same order, and only the lines that have something to say.

export interface CardLine {
  /** Stable, for tests and styling: owner, platform, practice, rigour, environments, languages, lead, steps, usedBy, rules, review. */
  key: string;
  name: string;
  value: string;
  /** Something the reader (an editor) should act on. */
  warn?: boolean;
  /** The entries the value names, with their icons (languages): for showing each with its icon. */
  items?: { name: string; icon?: string }[];
}

export interface CardFacts {
  kind: TargetKind;
  doc: Process | Standard;
  catalog: Pick<Catalog, "teams" | "tiers" | "environments" | "languages"> & Partial<Pick<Catalog, "platforms" | "practices" | "categories">>;
  /** For a process its rigour; for a standard how many of its (applicable) requirements have each rigour. */
  rigour: Partial<Record<Rigour, number>>;
  /** For a standard: how many requirements apply to the application chosen in "My application". */
  rules: number;
  /** Whether the reader may change it: only they see where its review stands. */
  mayEdit: boolean;
  /** How many processes use this process as a sub-process. */
  usedBy?: number;
  today?: string;
}

const nameIn = (l: { id: string; name: string }[] | undefined, id?: unknown) =>
  typeof id === "string" && id ? (l ?? []).find((x) => x.id === id)?.name ?? id : "";
const names = (l: { id: string; name: string }[] | undefined, ids: unknown) =>
  (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x).map((x) => nameIn(l, x)).join(", ");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The tiers it applies to, for the corner of the card: "Tier 0, Tier 1" or "All tiers". */
export function tiersText(doc: { tiers?: unknown }, catalog: Pick<Catalog, "tiers">): string {
  return names(catalog.tiers, doc.tiers) || "All tiers";
}

/** "Overdue since 2026-03-01" and the like; "" when there is nothing to do yet. */
export function reviewLine(doc: Process | Standard, today?: string): string {
  const r = reviewInfo(doc, today);
  if (r.state === "overdue") return r.dueAt ? `Overdue since ${r.dueAt}` : r.label;
  if (r.state === "soon") return `Due ${r.dueAt}`;
  return "";
}

/** The lines of a card, in their fixed order. */
export function cardLines(f: CardFacts): CardLine[] {
  const { doc, catalog: c } = f;
  const out: CardLine[] = [];
  const add = (key: string, name: string, value: string, warn?: boolean) => { if (value) out.push({ key, name, value, ...(warn ? { warn } : {}) }); };
  add("owner", "Owner", nameIn(c.teams, doc.owner));
  add("platform", "Platform", nameIn(c.platforms, doc.platform));
  add("practice", "Practice", nameIn(c.practices, doc.practice));
  add("rigour", "Rigour", rigourLine(f.kind, f.rigour));
  // where else it applies, only when it is narrowed down (the tiers are in the corner)
  add("environments", "Environments", names(c.environments, doc.environments));
  add("languages", "Languages", names(c.languages, doc.languages));
  const langs = out.find((l) => l.key === "languages");
  if (langs) langs.items = (Array.isArray(doc.languages) ? doc.languages : []).filter((x) => typeof x === "string" && x)
    .map((id) => { const l = (c.languages ?? []).find((x) => x.id === id); return { name: l?.name ?? id, ...(l?.icon ? { icon: l.icon } : {}) }; });
  if (f.kind === "process") {
    const p = doc as Process;
    add("lead", "Lead time", typeof p.estimatedDuration === "string" ? p.estimatedDuration.trim() : "");
    const steps = Array.isArray(p.steps) ? p.steps.filter((s) => s && typeof s === "object") : [];
    if (steps.length) add("steps", "Steps", `${steps.filter((s) => s.actor === "me").length} of ${steps.length} are yours`);
    if (f.usedBy) add("usedBy", "Used by", plural(f.usedBy, "process", "processes"));
  } else {
    const total = Array.isArray((doc as Standard).requirements) ? (doc as Standard).requirements.filter((r) => r && typeof r === "object").length : 0;
    add("rules", "Requirements", f.rules === total ? String(total) : `${f.rules} of ${total} apply to your application`);
  }
  if (f.mayEdit) add("review", "Review", reviewLine(doc, f.today), true);
  return out;
}

/**
 * Where each line goes on the card: what to compare first (`key`: how binding it is, how long it
 * takes, how much of it is the reader's), who looks after it and where it applies (`who`), and
 * what an editor must act on (`attention`, shown as a mark at the top). Each group keeps the fixed
 * order of `cardLines`.
 */
export type CardGroup = "key" | "who" | "attention";
const GROUP: Record<string, CardGroup> = {
  rigour: "key", lead: "key", steps: "key", rules: "key", usedBy: "key",
  owner: "who", platform: "who", practice: "who", environments: "who", languages: "who",
};
export const groupOf = (l: CardLine): CardGroup => (l.warn ? "attention" : GROUP[l.key] ?? "who");
export function cardGroups(lines: CardLine[]): Record<CardGroup, CardLine[]> {
  const out: Record<CardGroup, CardLine[]> = { key: [], who: [], attention: [] };
  for (const l of lines) out[groupOf(l)].push(l);
  return out;
}

/** The parts of a rigour mark, strongest first: for a process its one rigour, for a standard how many requirements have each. */
export interface RigourPart { rigour: Rigour; n: number }
export function rigourParts(rigour: Partial<Record<Rigour, number>>): RigourPart[] {
  return (["mandatory", "recommended", "optional"] as Rigour[]).filter((r) => (rigour[r] ?? 0) > 0).map((r) => ({ rigour: r, n: rigour[r]! }));
}

/** The short text of a key fact on the card: "5 of 10 steps are yours", "3 of 5 requirements apply". */
export function shortFact(l: CardLine, kind: TargetKind): string {
  if (l.key === "steps") return l.value.replace(/ are yours$/, " steps are yours");
  if (l.key === "rules" && kind === "standard") {
    const m = /^(\d+) of (\d+) apply/.exec(l.value);
    if (m) return `${m[1]} of ${m[2]} requirements apply`;
    return `${l.value} ${l.value === "1" ? "requirement" : "requirements"}`;
  }
  if (l.key === "usedBy") return `Used by ${l.value}`;
  return l.value;
}
