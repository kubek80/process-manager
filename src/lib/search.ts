import type { Catalog, Level, Process, Rigour, Standard, TargetKind } from "../types";
import type { SearchState } from "./store";
import { appliesTo, type Profile } from "./edit";

// One search over processes and standards: every word of the query must be found somewhere in a
// document; the filters narrow the results down (several values of one filter: any of them;
// different filters: all of them). For every filter, each option says how many results it would
// give, so that the page can show the counts and leave out what gives nothing.

/** The filters of the lists and the results page; the results page carries them in the address. */
export type Filters = Omit<SearchState, "q" | "pageNo" | "size" | "mode" | "sort">;
export type FilterKey = keyof Filters;
export const FILTER_KEYS: FilterKey[] = ["type", "category", "platform", "practice", "rigour", "owner"];
export const FILTER_LABEL: Record<FilterKey, string> = { type: "Type", rigour: "Rigour", category: "Category", practice: "Practice", platform: "Platform", owner: "Owner" };
/** The category value of what has no category: not a valid id, so it cannot clash with one. */
export const NO_CATEGORY = "-";
export const NO_CATEGORY_LABEL = "Other";
export const KINDS: TargetKind[] = ["process", "standard"];
export const KIND_LABEL: Record<TargetKind, string> = { process: "Processes", standard: "Standards" };
export const RIGOURS: Rigour[] = ["mandatory", "recommended", "optional"];
export const RIGOUR_LABEL: Record<Rigour, string> = { mandatory: "Mandatory", recommended: "Recommended", optional: "Optional" };
/** What a level of a requirement means for the rigour of a standard. */
export const LEVEL_RIGOUR: Record<Level, Rigour> = { must: "mandatory", should: "recommended", may: "optional" };

/** A place inside a document where the query was found: a step, a requirement, a prerequisite, the scope. */
export interface Hit {
  where: "step" | "requirement" | "prerequisite" | "scope" | "summary";
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
  /** For a standard: how many of its requirements apply (to the application chosen in `profile`). */
  rules: number;
  /** With a `found` list: how it was found (by words, by meaning, or both). */
  by?: ("words" | "meaning")[];
}

/**
 * A yes/no filter worked out by the page, e.g. "only my bookmarks". When `on`, only what it says
 * yes to is shown; the output says for each how many results it would give.
 */
export interface Flag { on: boolean; test: (kind: TargetKind, doc: Process | Standard) => boolean }

export interface Option { value: string; label: string; count: number; chosen: boolean }

export interface SearchInput {
  processes: Process[];
  standards: Standard[];
  catalog: Pick<Catalog, "teams" | "tools"> & Partial<Pick<Catalog, "categories" | "practices" | "platforms" | "tiers" | "environments" | "languages">>;
  q?: string;
  filters?: Filters;
  /**
   * Which drafts may be shown: none (false), all (true), or those this says yes to - in editor
   * mode, the drafts the person may edit, as in the libraries.
   */
  drafts: boolean | ((kind: "process" | "standard", doc: Process | Standard) => boolean);
  /** "My application": only what applies to it, and of a standard only the requirements that do. */
  profile?: Profile;
  flags?: Record<string, Flag>;
  /**
   * What was found some other way (search by meaning, or both ways together), best first: then
   * the query is not searched for here; exactly these documents are found, in this order and with
   * these places inside, and the filters, counts and flags work on them as on a word search.
   * What is not among the documents the page has is ignored.
   */
  found?: { kind: TargetKind; id: string; score: number; hits: Hit[]; by?: ("words" | "meaning")[] }[];
}

export interface SearchOutput {
  results: Result[];
  /** Every option of every filter, with the number of results it would give together with the other filters. */
  options: Record<FilterKey, Option[]>;
  /** For every flag, how many results there are with it on (and everything else as chosen). */
  flags: Record<string, number>;
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
  rules: number;
  flags: Record<string, boolean>;
}

const str = (x: unknown) => (typeof x === "string" ? x : "");
const list = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x.filter((v) => v && typeof v === "object") : []);
const nameIn = (l: { id: string; name: string }[] | undefined, id?: string) => (id ? (l ?? []).find((x) => x.id === id)?.name ?? id : "");

function item(hit: Hit, texts: unknown[]): Item {
  const t = texts.map(str).filter(Boolean);
  return { hit, texts: t, norms: t.map(fold) };
}

function index(kind: TargetKind, d: Process | Standard, c: SearchInput["catalog"], profile: Profile, flags: Record<string, Flag>): Doc {
  const fields: Field[] = [
    { norm: fold(str(d.title)), weight: WEIGHT.title },
    { norm: fold(str(d.id)), weight: WEIGHT.id },
    { norm: fold((Array.isArray(d.tags) ? d.tags : []).map(str).join(" ")), weight: WEIGHT.tags },
    { norm: fold([nameIn(c.categories, d.category), nameIn(c.practices, d.practice), nameIn(c.platforms, d.platform), nameIn(c.teams, d.owner)].join(" ")), weight: WEIGHT.names },
    { norm: fold(str(d.summary)), weight: WEIGHT.summary },
  ];
  const items: Item[] = [];
  const rigour: Partial<Record<Rigour, number>> = {};
  let rules = 0;
  if (kind === "process") {
    const p = d as Process;
    for (const s of list(p.steps)) items.push(item({ where: "step", item: str(s.id), label: str(s.title) || str(s.id) }, [s.title, s.description, nameIn(c.tools, s.tool)]));
    for (const pr of list(p.prerequisites)) items.push(item({ where: "prerequisite", label: str(pr.title) }, [pr.title, pr.description]));
    if (p.rigour && RIGOUR_LABEL[p.rigour]) rigour[p.rigour] = 1;
  } else {
    const s = d as Standard;
    for (const r of list(s.requirements)) {
      items.push(item({ where: "requirement", item: str(r.id), label: str(r.title) || str(r.id) }, [r.title, r.id, r.statement]));
      if (!appliesTo(r, profile)) continue;
      rules++;
      const rg = LEVEL_RIGOUR[r.level];
      if (rg) rigour[rg] = (rigour[rg] ?? 0) + 1;
    }
    if (str(s.scope)) items.push(item({ where: "scope", label: "Scope" }, [s.scope]));
  }
  const one = (x?: string) => (x ? [x] : []);
  return {
    kind, doc: d, fields, items, rigour, rules,
    values: {
      type: [kind], rigour: RIGOURS.filter((r) => rigour[r]), category: [str(d.category) || NO_CATEGORY],
      practice: one(str(d.practice)), platform: one(str(d.platform)), owner: one(str(d.owner)),
    },
    flags: Object.fromEntries(Object.entries(flags).map(([k, f]) => [k, f.test(kind, d)])),
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

const passes = (d: Doc, filters: Filters, flags: Record<string, Flag>, skip?: string) =>
  FILTER_KEYS.every((k) => {
    const chosen = filters[k];
    return k === skip || !chosen?.length || d.values[k].some((v) => (chosen as string[]).includes(v));
  }) && Object.entries(flags).every(([k, f]) => k === skip || !f.on || d.flags[k]);

const byTitle = (a: Result, b: Result) => str(a.doc.title).localeCompare(str(b.doc.title)) || str(a.doc.id).localeCompare(str(b.doc.id));

export function search(input: SearchInput): SearchOutput {
  const { catalog: c, drafts } = input;
  const filters = input.filters ?? {};
  const profile = input.profile ?? {};
  const flags = input.flags ?? {};
  const words = wordsOf(input.q);
  const visible = (kind: "process" | "standard") => (d: Process | Standard) =>
    (d.status !== "draft" || (typeof drafts === "function" ? drafts(kind, d) : drafts)) && appliesTo(d, profile);
  const docs = [
    ...input.processes.filter(visible("process")).map((p) => index("process", p, c, profile, flags)),
    ...input.standards.filter(visible("standard")).map((s) => index("standard", s, c, profile, flags)),
  ];
  // what the query finds, before the filters
  const given = input.found ? new Map(input.found.map((f, rank) => [`${f.kind}:${f.id}`, { f, rank }] as const)) : null;
  const found = given
    ? docs.flatMap((d) => {
      const g = given.get(`${d.kind}:${d.doc.id}`);
      return g ? [{ d, score: g.f.score, rank: g.rank, hits: g.f.hits, by: g.f.by }] : [];
    }).sort((a, b) => a.rank - b.rank)
    : docs.map((d) => ({ d, score: words.length ? scoreOf(d, words) : 1, rank: 0, hits: undefined, by: undefined })).filter((x) => x.score > 0);

  const results = found
    .filter(({ d }) => passes(d, filters, flags))
    .map(({ d, score, hits, by }): Result => ({ kind: d.kind, doc: d.doc, score, rigour: d.rigour, rules: d.rules, hits: hits ?? hitsOf(d, words), ...(by ? { by } : {}) }));
  if (!given) results.sort((a, b) => b.score - a.score || byTitle(a, b));

  const counts = (k: FilterKey) => {
    const n = new Map<string, number>();
    for (const { d } of found) if (passes(d, filters, flags, k)) for (const v of d.values[k]) n.set(v, (n.get(v) ?? 0) + 1);
    return n;
  };
  const optionsFor = (k: FilterKey, known: { value: string; label: string }[]): Option[] => {
    const n = counts(k);
    const chosen = (filters[k] ?? []) as string[];
    const all = [...known];
    // a value that is used, or asked for, but not in the list still shows (under its id), so that it can be removed
    const extra = new Set<string>([...docs.flatMap((d) => d.values[k]), ...chosen].filter((v) => !all.some((o) => o.value === v)));
    for (const v of [...extra].sort()) if (v !== NO_CATEGORY) all.push({ value: v, label: v });
    // what has no category comes last
    if (extra.has(NO_CATEGORY)) all.push({ value: NO_CATEGORY, label: NO_CATEGORY_LABEL });
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
      owner: optionsFor("owner", named(c.teams)),
    },
    flags: Object.fromEntries(Object.keys(flags).map((k) => [k, found.filter(({ d }) => d.flags[k] && passes(d, filters, flags, k)).length])),
  };
}

// ---------- "My application": tier, environment, language

/**
 * "My application" narrows the lists to what applies to one application: one tier, one
 * environment, one language (a single choice each, as the process and standard pages use the
 * same choice to hide what does not apply).
 */
export type ProfileKey = keyof Profile;
export const PROFILE_KEYS: ProfileKey[] = ["tier", "environment", "language"];
export const PROFILE_LABEL: Record<ProfileKey, string> = { tier: "Tier", environment: "Environment", language: "Language" };
const PROFILE_ANY: Record<ProfileKey, string> = { tier: "Any tier", environment: "Any environment", language: "Any language" };
const PROFILE_LIST: Record<ProfileKey, "tiers" | "environments" | "languages"> = { tier: "tiers", environment: "environments", language: "languages" };
/** What the dropdowns of "My application" say about themselves. */
export const PROFILE_HINT: Record<ProfileKey, string> = {
  tier: "Shows only what applies to an application of this tier.",
  environment: "Shows only what applies to an application in this environment.",
  language: "Shows only what applies to an application written in this language.",
};

/**
 * The options of "My application", each with how many results it would give with everything
 * else as chosen: first "Any …" (the value ""), then the list in its order. A list that is empty
 * gives no options (the dropdown is left out). A chosen value that is not in the list any more
 * still shows (under its id), so that it can be changed.
 */
export function profileOptions(input: SearchInput): Record<ProfileKey, Option[]> {
  const profile = input.profile ?? {};
  const out = {} as Record<ProfileKey, Option[]>;
  for (const k of PROFILE_KEYS) {
    const list = [...(input.catalog[PROFILE_LIST[k]] ?? [])];
    const now = profile[k];
    if (now && !list.some((x) => x.id === now)) list.push({ id: now, name: now } as (typeof list)[number]);
    if (!list.length) { out[k] = []; continue; }
    const rest: Profile = { ...profile };
    delete rest[k];
    const base = search({ ...input, profile: rest }).results;
    out[k] = [
      { value: "", label: PROFILE_ANY[k], count: base.length, chosen: !now },
      ...list.map((x) => ({ value: x.id, label: x.name, count: base.filter((r) => appliesTo(r.doc, { [k]: x.id })).length, chosen: now === x.id })),
    ];
  }
  return out;
}

// ---------- a filter that has nothing to offer

type Subject = TargetKind | "any";
const NOTHING: Record<Subject, string> = { process: "No process here", standard: "No standard here", any: "Nothing here" };

/**
 * Why a filter has nothing to choose, when every one of its options would give nothing. `total`
 * is how many results there are now (this filter has nothing chosen, so it does not count):
 * none at all, and it is the other choices that leave nothing; else nothing shown has a value
 * for it, which the sentence says in the words of that filter.
 */
export function emptyFilterText(key: FilterKey | ProfileKey, subject: Subject, total: number): string {
  if (total === 0) return "Nothing matches the other choices, so there is nothing to choose here.";
  const who = NOTHING[subject];
  switch (key) {
    case "rigour": return subject === "standard" ? `${who} gives its requirements a level (must, should or may).` : `${who} says how binding it is.`;
    case "category": return `${who} has a category.`;
    case "platform": return `${who} belongs to a platform.`;
    case "practice": return `${who} belongs to a practice.`;
    case "owner": return `${who} names the team that maintains it.`;
    case "type": return "There is nothing here to choose between.";
    default: return `${who} is limited to particular ${PROFILE_LIST[key]}: everything applies.`;
  }
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

/**
 * The filters of an address without the values that name nothing that exists (an old link: a
 * platform since removed, a mistyped id), and how many were left out. A value counts as existing
 * when it is in the lists or when a process or standard uses it (an entry used but no longer in
 * the lists still shows, under its id, so that it can be found and removed); "Other" (no category)
 * always exists.
 */
export function knownFilters(f: Filters, catalog: SearchInput["catalog"], docs: (Process | Standard)[]): { filters: Filters; dropped: number } {
  const ids = (l?: { id: string }[]) => (l ?? []).map((x) => x.id);
  const used = (field: "category" | "platform" | "practice" | "owner") => docs.map((d) => str(d[field])).filter(Boolean);
  const exists: Record<FilterKey, Set<string>> = {
    type: new Set(KINDS), rigour: new Set(RIGOURS),
    category: new Set([NO_CATEGORY, ...ids(catalog.categories), ...used("category")]),
    platform: new Set([...ids(catalog.platforms), ...used("platform")]),
    practice: new Set([...ids(catalog.practices), ...used("practice")]),
    owner: new Set([...ids(catalog.teams), ...used("owner")]),
  };
  const out: Record<string, string[]> = {};
  let dropped = 0;
  for (const k of FILTER_KEYS) {
    const now = (f[k] ?? []) as string[];
    const keep = now.filter((v) => exists[k].has(v));
    dropped += now.length - keep.length;
    if (keep.length) out[k] = keep;
  }
  return { filters: out as Filters, dropped };
}

/** What the page says once when an address named a filter value that does not exist. */
export const DROPPED_FILTER_TEXT = "A filter in this link no longer exists and was left out.";

/**
 * A count as a filter shows it. `atLeast`: the results are only the closest of more that matched
 * (search by meaning), so a count says how many there are at least: "12+", "at least 12 results".
 */
export const countText = (n: number, atLeast?: boolean) => (atLeast && n > 0 ? `${n}+` : String(n));
export const countWords = (n: number, atLeast?: boolean) => `${atLeast && n > 0 ? "at least " : ""}${n} ${n === 1 ? "result" : "results"}`;

/** "3 mandatory, 2 recommended" for a standard; "Mandatory" for a process. */
export function rigourLine(kind: TargetKind, rigour: Partial<Record<Rigour, number>>): string {
  if (kind === "process") return RIGOURS.filter((x) => rigour[x]).map((x) => RIGOUR_LABEL[x]).join(", ");
  return RIGOURS.filter((x) => rigour[x]).map((x) => `${rigour[x]} ${RIGOUR_LABEL[x].toLowerCase()}`).join(", ");
}
export const rigourText = (r: Result) => rigourLine(r.kind, r.rigour);

// ---------- showing the matches

/** Words shorter than this are marked only as whole words. */
const SHORT_WORD = 3;
/**
 * Where the words are in a text, as [start, end) ranges of the original text, merged and in
 * order. Accents and case do not matter. A word of one or two letters ("a", "ci") is marked only
 * where it is a word of its own: inside other words it would mark fragments everywhere.
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
  const inWord = (i: number) => i >= 0 && i < norm.length && /[\p{L}\p{N}]/u.test(norm[i]);
  for (const w of words) {
    if (!w) continue;
    for (let at = norm.indexOf(w); at >= 0; at = norm.indexOf(w, at + w.length)) {
      const endNorm = at + w.length;
      // a word of one or two letters is marked only where it stands alone, never inside another word
      if (w.length < SHORT_WORD && (inWord(at - 1) || inWord(endNorm))) continue;
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

// ---------- the type as tabs: all, processes, standards

export type TypeTab = "" | TargetKind;
/** The tab a choice of types is: one kind, or all (none chosen, or both). */
export function typeTab(f: Filters): TypeTab {
  const t = (f.type ?? []).filter((x): x is TargetKind => KINDS.includes(x as TargetKind));
  return t.length === 1 ? t[0] : "";
}
/** The filters with the type set to one tab. */
export function withTypeTab(f: Filters, tab: TypeTab): Filters {
  const out = { ...f };
  if (tab) out.type = [tab]; else delete out.type;
  return out;
}

/** What "My application" says when folded: the chosen tier, environment and language, or that none is chosen. */
export function appSummary(options: Partial<Record<ProfileKey, Option[]>>): string {
  const on = PROFILE_KEYS.flatMap((k) => (options[k] ?? []).filter((o) => o.chosen && o.value !== "").map((o) => o.label));
  return on.length ? on.join(" · ") : "Not chosen";
}

// ---------- the words of the levels

/** A level as a process has it (mandatory, recommended, optional) or as a requirement has it (must, should, may). */
export type AnyLevel = Rigour | Level;
const LEVEL_WORD: Record<AnyLevel, string> = { mandatory: "Mandatory", recommended: "Recommended", optional: "Optional", must: "Must", should: "Should", may: "May" };
/** The word of a level: "Mandatory" for a process, "Must" for a requirement. */
export const levelWord = (l: AnyLevel): string => LEVEL_WORD[l] ?? String(l);
/** The requirement level that counts as a rigour: mandatory is must, and so on. */
export const RIGOUR_LEVEL: Record<Rigour, Level> = { mandatory: "must", recommended: "should", optional: "may" };

/**
 * The name of a rigour option in the filter, in the words of what is listed: "Mandatory" for
 * processes, "Must" for standards, both where they are mixed ("Mandatory or must").
 */
export function rigourOptionLabel(r: Rigour, subject: TargetKind | "any"): string {
  if (subject === "process") return RIGOUR_LABEL[r];
  if (subject === "standard") return levelWord(RIGOUR_LEVEL[r]);
  return `${RIGOUR_LABEL[r]} or ${levelWord(RIGOUR_LEVEL[r]).toLowerCase()}`;
}
/** The name of the rigour filter: "Rigour" everywhere (its options say "Must" or "Mandatory" by the kind). */
export const rigourFilterName = (_subject: TargetKind | "any") => "Rigour";
