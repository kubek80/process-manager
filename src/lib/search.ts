import type { Catalog, Level, Process, Rigour, Standard, TargetKind } from "../types";
import type { SearchState } from "./store";

// One search over processes and standards: every word of the query must be found somewhere in a
// document; the filters narrow the results down (several values of one filter: any of them;
// different filters: all of them). For every filter, each option says how many results it would
// give, so that the page can show the counts and leave out what gives nothing.

/** The filters of the results page, as the address carries them. */
export type Filters = Omit<SearchState, "q">;
export type FilterKey = keyof Filters;
export const FILTER_KEYS: FilterKey[] = ["type", "rigour", "category", "practice", "platform"];
export const FILTER_LABEL: Record<FilterKey, string> = { type: "Type", rigour: "Rigour", category: "Category", practice: "Practice", platform: "Platform" };
export const KINDS: TargetKind[] = ["process", "standard"];
export const KIND_LABEL: Record<TargetKind, string> = { process: "Processes", standard: "Standards" };
export const RIGOURS: Rigour[] = ["mandatory", "recommended", "optional"];
export const RIGOUR_LABEL: Record<Rigour, string> = { mandatory: "Mandatory", recommended: "Recommended", optional: "Optional" };
/** What a level of a requirement means for the rigour of a standard. */
export const LEVEL_RIGOUR: Record<Level, Rigour> = { must: "mandatory", should: "recommended", may: "optional" };

/** A place inside a document where the query was found: a step, a requirement, a prerequisite, the scope. */
export interface Hit {
  where: "step" | "requirement" | "prerequisite" | "scope";
  /** The step id or requirement id, to open it directly. */
  item?: string;
  label: string;
  /** A short piece of the text around the match, when the match is not in the label. */
  snippet?: string;
}

export interface Result {
  kind: TargetKind;
  doc: Process | Standard;
  score: number;
  /** For a process its rigour; for a standard how many requirements it has of each rigour. */
  rigour: Partial<Record<Rigour, number>>;
  /** Up to three places inside where the query was found. Empty without a query. */
  hits: Hit[];
}

export interface Option { value: string; label: string; count: number; chosen: boolean }

export interface SearchInput {
  processes: Process[];
  standards: Standard[];
  catalog: Pick<Catalog, "teams" | "tools"> & Partial<Pick<Catalog, "categories" | "practices" | "platforms">>;
  q?: string;
  filters?: Filters;
  /** Whether drafts may be shown (editor mode). */
  drafts: boolean;
}

export interface SearchOutput {
  results: Result[];
  /** Every option of every filter, with the number of results it would give together with the other filters. */
  options: Record<FilterKey, Option[]>;
}

/** Lower case, without accents: "Résumé" and "resume" are the same word. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** The words of a query, folded. */
export const wordsOf = (q: string | undefined) => [...new Set(fold(q ?? "").split(/\s+/).filter(Boolean))];

const WEIGHT = { title: 100, id: 60, tags: 60, names: 40, summary: 20, inside: 5 } as const;
const MAX_HITS = 3;

interface Field { norm: string; weight: number }
interface Item { hit: Hit; texts: string[]; norms: string[] }
interface Doc {
  kind: TargetKind;
  doc: Process | Standard;
  fields: Field[];
  items: Item[];
  values: Record<FilterKey, string[]>;
  rigour: Partial<Record<Rigour, number>>;
}

const str = (x: unknown) => (typeof x === "string" ? x : "");
const list = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x.filter((v) => v && typeof v === "object") : []);
const nameIn = (l: { id: string; name: string }[] | undefined, id?: string) => (id ? (l ?? []).find((x) => x.id === id)?.name ?? id : "");

function item(hit: Hit, texts: unknown[]): Item {
  const t = texts.map(str).filter(Boolean);
  return { hit, texts: t, norms: t.map(fold) };
}

function index(kind: TargetKind, d: Process | Standard, c: SearchInput["catalog"]): Doc {
  const fields: Field[] = [
    { norm: fold(str(d.title)), weight: WEIGHT.title },
    { norm: fold(str(d.id)), weight: WEIGHT.id },
    { norm: fold((Array.isArray(d.tags) ? d.tags : []).map(str).join(" ")), weight: WEIGHT.tags },
    { norm: fold([nameIn(c.categories, d.category), nameIn(c.practices, d.practice), nameIn(c.platforms, d.platform), nameIn(c.teams, d.owner)].join(" ")), weight: WEIGHT.names },
    { norm: fold(str(d.summary)), weight: WEIGHT.summary },
  ];
  const items: Item[] = [];
  const rigour: Partial<Record<Rigour, number>> = {};
  if (kind === "process") {
    const p = d as Process;
    for (const s of list(p.steps)) items.push(item({ where: "step", item: str(s.id), label: str(s.title) || str(s.id) }, [s.title, s.description, nameIn(c.tools, s.tool)]));
    for (const pr of list(p.prerequisites)) items.push(item({ where: "prerequisite", label: str(pr.title) }, [pr.title, pr.description]));
    if (p.rigour && RIGOUR_LABEL[p.rigour]) rigour[p.rigour] = 1;
  } else {
    const s = d as Standard;
    for (const r of list(s.requirements)) {
      items.push(item({ where: "requirement", item: str(r.id), label: str(r.title) || str(r.id) }, [r.title, r.id, r.statement]));
      const rg = LEVEL_RIGOUR[r.level];
      if (rg) rigour[rg] = (rigour[rg] ?? 0) + 1;
    }
    if (str(s.scope)) items.push(item({ where: "scope", label: "Scope" }, [s.scope]));
  }
  const one = (x?: string) => (x ? [x] : []);
  return {
    kind, doc: d, fields, items, rigour,
    values: { type: [kind], rigour: RIGOURS.filter((r) => rigour[r]), category: one(d.category), practice: one(d.practice), platform: one(d.platform) },
  };
}

/** How well a document matches the words: 0 when one of them is nowhere in it. */
function scoreOf(d: Doc, words: string[]): number {
  let total = 0;
  for (const w of words) {
    let best = 0;
    for (const f of d.fields) if (f.weight > best && f.norm.includes(w)) best = f.weight;
    if (!best && d.items.some((it) => it.norms.some((n) => n.includes(w)))) best = WEIGHT.inside;
    if (!best) return 0;
    total += best;
  }
  // the whole query in the title, or the title starting with it, comes first
  const title = d.fields[0].norm;
  const phrase = words.join(" ");
  if (words.length && title.startsWith(phrase)) total += 50;
  else if (words.length > 1 && title.includes(phrase)) total += 25;
  return total;
}

/** The places inside a document that match most words, best first. */
function hitsOf(d: Doc, words: string[]): Hit[] {
  if (!words.length) return [];
  const found: { hit: Hit; n: number; at: number }[] = [];
  d.items.forEach((it, at) => {
    const n = words.filter((w) => it.norms.some((t) => t.includes(w))).length;
    if (!n) return;
    const hit = { ...it.hit };
    // the label says enough when a word is in it; otherwise a piece of the text that matched
    if (!words.some((w) => fold(it.hit.label).includes(w))) {
      const i = it.norms.findIndex((t) => words.some((w) => t.includes(w)));
      if (i >= 0) hit.snippet = excerpt(it.texts[i], words);
    }
    found.push({ hit, n, at });
  });
  return found.sort((a, b) => b.n - a.n || a.at - b.at).slice(0, MAX_HITS).map((f) => f.hit);
}

const passes = (d: Doc, filters: Filters, skip?: FilterKey) =>
  FILTER_KEYS.every((k) => {
    const chosen = filters[k];
    return k === skip || !chosen?.length || d.values[k].some((v) => (chosen as string[]).includes(v));
  });

const byTitle = (a: Result, b: Result) => str(a.doc.title).localeCompare(str(b.doc.title)) || str(a.doc.id).localeCompare(str(b.doc.id));

export function search(input: SearchInput): SearchOutput {
  const { catalog: c, drafts } = input;
  const filters = input.filters ?? {};
  const words = wordsOf(input.q);
  const visible = (d: Process | Standard) => drafts || d.status !== "draft";
  const docs = [
    ...input.processes.filter(visible).map((p) => index("process", p, c)),
    ...input.standards.filter(visible).map((s) => index("standard", s, c)),
  ];
  // what the query finds, before the filters
  const found = docs.map((d) => ({ d, score: words.length ? scoreOf(d, words) : 1 })).filter((x) => x.score > 0);

  const results = found
    .filter(({ d }) => passes(d, filters))
    .map(({ d, score }): Result => ({ kind: d.kind, doc: d.doc, score, rigour: d.rigour, hits: hitsOf(d, words) }))
    .sort((a, b) => b.score - a.score || byTitle(a, b));

  const counts = (k: FilterKey) => {
    const n = new Map<string, number>();
    for (const { d } of found) if (passes(d, filters, k)) for (const v of d.values[k]) n.set(v, (n.get(v) ?? 0) + 1);
    return n;
  };
  const optionsFor = (k: FilterKey, known: { value: string; label: string }[]): Option[] => {
    const n = counts(k);
    const chosen = (filters[k] ?? []) as string[];
    const all = [...known];
    // a value that is used, or asked for, but not in the list still shows (under its id), so that it can be removed
    const extra = new Set<string>([...docs.flatMap((d) => d.values[k]), ...chosen].filter((v) => !all.some((o) => o.value === v)));
    for (const v of [...extra].sort()) all.push({ value: v, label: v });
    return all.map((o) => ({ ...o, count: n.get(o.value) ?? 0, chosen: chosen.includes(o.value) }));
  };
  const named = (l?: { id: string; name: string }[]) =>
    [...(l ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ value: x.id, label: x.name }));

  return {
    results,
    options: {
      type: optionsFor("type", KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))),
      rigour: optionsFor("rigour", RIGOURS.map((r) => ({ value: r, label: RIGOUR_LABEL[r] }))),
      category: optionsFor("category", named(c.categories)),
      practice: optionsFor("practice", named(c.practices)),
      platform: optionsFor("platform", named(c.platforms)),
    },
  };
}

// ---------- the filters as a value

/** How many filter values are chosen. */
export const filterCount = (f: Filters) => FILTER_KEYS.reduce((n, k) => n + (f[k]?.length ?? 0), 0);

/** The filters with one value switched on or off. */
export function toggleFilter(f: Filters, key: FilterKey, value: string): Filters {
  const now = (f[key] ?? []) as string[];
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
  const out = { ...f } as Record<FilterKey, string[] | undefined>;
  if (next.length) out[key] = next; else delete out[key];
  return out as Filters;
}

/** Only the filters of a search address. */
export function filtersOf(r: Filters): Filters {
  const out: Record<string, string[]> = {};
  for (const k of FILTER_KEYS) if (r[k]?.length) out[k] = [...(r[k] as string[])];
  return out as Filters;
}

/** "3 mandatory, 2 recommended" for a standard; "Mandatory" for a process. */
export function rigourText(r: Result): string {
  if (r.kind === "process") return RIGOURS.filter((x) => r.rigour[x]).map((x) => RIGOUR_LABEL[x]).join(", ");
  return RIGOURS.filter((x) => r.rigour[x]).map((x) => `${r.rigour[x]} ${RIGOUR_LABEL[x].toLowerCase()}`).join(", ");
}

// ---------- showing the matches

/**
 * Where the words are in a text, as [start, end) ranges of the original text, merged and in
 * order. Accents and case do not matter.
 */
export function matchRanges(text: string, words: string[]): [number, number][] {
  if (!text || !words.length) return [];
  // the folded text, and for each folded character the original character it came from
  let norm = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const f = fold(ch);
    for (let j = 0; j < f.length; j++) from.push(i);
    norm += f;
    i += ch.length;
  }
  from.push(text.length);
  const ranges: [number, number][] = [];
  for (const w of words) {
    if (!w) continue;
    for (let at = norm.indexOf(w); at >= 0; at = norm.indexOf(w, at + w.length)) {
      const endNorm = at + w.length;
      // the end is the start of the next original character
      let end = from[endNorm];
      if (endNorm < norm.length && from[endNorm] === from[endNorm - 1]) end = from[endNorm] + 1;
      ranges.push([from[at], Math.max(end, from[at] + 1)]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** A piece of a long text around the first match, with "…" where it was cut. */
export function excerpt(text: string, words: string[], room = 70): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= room * 2) return t;
  const first = matchRanges(t, words)[0];
  if (!first) return `${t.slice(0, room * 2).trimEnd()}…`;
  let start = Math.max(0, first[0] - room);
  let end = Math.min(t.length, first[1] + room);
  // whole words only
  if (start > 0) { const sp = t.indexOf(" ", start); if (sp >= 0 && sp < first[0]) start = sp + 1; }
  if (end < t.length) { const sp = t.lastIndexOf(" ", end); if (sp > first[1]) end = sp; }
  return `${start > 0 ? "…" : ""}${t.slice(start, end)}${end < t.length ? "…" : ""}`;
}
