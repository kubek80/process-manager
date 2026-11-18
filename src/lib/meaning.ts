import { useCallback, useEffect, useRef, useState } from "react";
import type { Process, Standard, TargetKind } from "../types";
import type { Hit } from "./search";
import { ApiError, searchByMeaning, type MeaningResult } from "./store";

// Search by meaning: the server ranks the published processes and standards by how close they
// are to what was typed; the page then filters, counts and pages that list itself, as it does
// for the word search. This file holds what decides it: how the server's answer becomes cards,
// how "Both" puts the two lists together, and when the server is asked.

/** How the search page searches. Words is the default and is not written in the address. */
export type SearchMode = "words" | "meaning" | "both";
export const SEARCH_MODES: SearchMode[] = ["words", "meaning", "both"];
/** The two ways a result can have been found. */
export type FoundBy = "words" | "meaning";

/** A document found, in the order of the list it is in, with where inside it was found. */
export interface Found {
  kind: TargetKind;
  id: string;
  score: number;
  hits: Hit[];
  by: FoundBy[];
}

const MAX_HITS = 3;
const str = (x: unknown) => (typeof x === "string" ? x : "");
const list = <T,>(x: T[] | undefined): T[] => (Array.isArray(x) ? x.filter((v) => v && typeof v === "object") : []);

/**
 * The places the server found, as the cards show them. The label comes from the document the
 * page has (the server's label, e.g. "Step 3: …", says what the card already says in its own
 * words); a place the document no longer has is left out. A prerequisite has no address of its
 * own: it opens the map, where "Before you start" is.
 */
export function meaningHits(kind: TargetKind, doc: Process | Standard, hits: MeaningResult["hits"] | undefined): Hit[] {
  const out: Hit[] = [];
  for (const h of Array.isArray(hits) ? hits : []) {
    if (!h || typeof h !== "object") continue;
    const snippet = str(h.snippet).replace(/\s+/g, " ").trim() || undefined;
    let hit: Hit | null = null;
    if (h.part === "summary") hit = { where: "summary", label: "Summary" };
    else if (h.part === "scope" && kind === "standard") hit = { where: "scope", label: "Scope" };
    else if (h.part === "step" && kind === "process") {
      const s = list((doc as Process).steps).find((x) => x.id === h.item);
      if (s) hit = { where: "step", item: s.id, label: str(s.title) || s.id };
    } else if (h.part === "requirement" && kind === "standard") {
      const r = list((doc as Standard).requirements).find((x) => x.id === h.item);
      if (r) hit = { where: "requirement", item: r.id, label: str(r.title) || r.id };
    } else if (h.part === "prerequisite" && kind === "process") {
      const p = list((doc as Process).prerequisites)[Number(h.item)];
      if (p && /^\d+$/.test(str(h.item))) hit = { where: "prerequisite", label: str(p.title) };
    }
    if (!hit) continue;
    // the summary is on the card already: its snippet would say it twice
    if (snippet && !(hit.where === "summary" && repeatsSummary(str(doc.summary), snippet))) hit.snippet = snippet;
    if (!out.some((o) => sameHit(o, hit!))) out.push(hit);
    if (out.length >= MAX_HITS) break;
  }
  return out;
}

/** Whether a piece of text says what the summary on the card says already (perhaps with more after it). */
function repeatsSummary(summary: string, snippet: string): boolean {
  const sum = summary.replace(/\s+/g, " ").trim();
  const bit = snippet.replace(/^…\s*|\s*…$/g, "").trim();
  return !!sum && !!bit && (sum.includes(bit) || bit.startsWith(sum));
}

const hitKey = (h: Hit) => `${h.where}:${h.item ?? h.label}`;
const sameHit = (a: Hit, b: Hit) => hitKey(a) === hitKey(b);

/**
 * The server's answer as a list of what this person has: in the server's order, each document
 * once, what the page does not have (a draft, something not visible to them) left out.
 */
export function fromMeaning(results: MeaningResult[] | undefined, docOf: (kind: TargetKind, id: string) => Process | Standard | undefined): Found[] {
  const seen = new Set<string>();
  const out: Found[] = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || (r.kind !== "process" && r.kind !== "standard") || typeof r.id !== "string") continue;
    const key = `${r.kind}:${r.id}`;
    const doc = docOf(r.kind, r.id);
    if (!doc || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: r.kind, id: r.id, score: Number(r.score) || 0, hits: meaningHits(r.kind, doc, r.hits), by: ["meaning"] });
  }
  return out;
}

/** Places found both ways once, the word search's first (its labels show the words found). */
export function mergeHits(a: Hit[], b: Hit[]): Hit[] {
  const out: Hit[] = [];
  for (const h of [...a, ...b]) {
    const at = out.findIndex((o) => sameHit(o, h));
    if (at < 0) out.push({ ...h });
    else if (!out[at].snippet && h.snippet) out[at] = { ...out[at], snippet: h.snippet };
  }
  return out.slice(0, MAX_HITS);
}

/** How strongly reciprocal rank fusion holds on to the order: the usual 60. */
export const FUSION_K = 60;

/**
 * "Both": everything either list found, ordered by reciprocal rank fusion - each list gives a
 * document 1 / (60 + its place in that list), and the two are added - so that being high in
 * either list counts, and being in both counts more. A tie goes to the better single place, then
 * to the word search.
 */
export function fuse(words: Found[], meaning: Found[], k = FUSION_K): Found[] {
  const all = new Map<string, Found & { best: number; w: number }>();
  const add = (l: Found[], by: FoundBy) => l.forEach((f, i) => {
    const key = `${f.kind}:${f.id}`;
    const part = 1 / (k + i + 1);
    const was = all.get(key);
    if (!was) { all.set(key, { kind: f.kind, id: f.id, score: part, hits: [...f.hits], by: [by], best: i, w: by === "words" ? i : Infinity }); return; }
    if (was.by.includes(by)) return;
    was.score += part;
    was.best = Math.min(was.best, i);
    if (by === "words") was.w = i;
    was.hits = by === "words" ? mergeHits(f.hits, was.hits) : mergeHits(was.hits, f.hits);
    was.by = ["words", "meaning"];
  });
  add(words, "words");
  add(meaning, "meaning");
  return [...all.values()]
    .sort((a, b) => b.score - a.score || a.best - b.best || a.w - b.w)
    .map(({ kind, id, score, hits, by }) => ({ kind, id, score, hits, by }));
}

// ---------- when the server is asked

/**
 * What the query sent to the server last is, after something happened on the page. The server is
 * asked when somebody submits the search, changes the mode, or arrives with a query (a link, Back,
 * Home's search box) - typing alone does not ask: each search may call an outside service.
 */
export type AskEvent =
  | { type: "arrive"; q: string }
  | { type: "submit"; q: string }
  | { type: "mode"; q: string }
  | { type: "type"; q: string };
export function nextAsked(asked: string, e: AskEvent): string {
  return e.type === "type" ? asked : e.q.trim();
}

/** Whether a query goes to the server: only with Meaning or Both, only when there is something to search for. */
export const needsServer = (mode: SearchMode, asked: string, available: boolean) => available && mode !== "words" && asked.trim() !== "";

/** What went wrong when the server was asked. */
export type MeaningProblem =
  /** the person searched very often; the server's sentence says so */
  | { kind: "busy"; message: string }
  /** the service that compares the texts cannot be reached, or another failure */
  | { kind: "unavailable"; message: string }
  /** the server is still building what it searches; the server's sentence says so */
  | { kind: "notready"; message: string }
  /** search by meaning was switched off on the server while the page was open */
  | { kind: "off"; message: string };

export function problemOf(e: unknown): MeaningProblem {
  const status = e instanceof ApiError ? e.status : 0;
  const message = e instanceof Error ? e.message : String(e);
  if (status === 404) return { kind: "off", message };
  if (status === 429) return { kind: "busy", message: message || "You searched very often. Wait a moment, then search again." };
  if (status === 503) return { kind: "notready", message: message || "Search by meaning is not ready yet. Try again in a moment, or search by words." };
  return { kind: "unavailable", message: "Search by meaning is not available right now." };
}

/** The mode in the address: anything but "meaning" or "both" is Words. */
export const modeOf = (m: unknown): SearchMode => (m === "meaning" || m === "both" ? m : "words");

// ---------- the person's own choice, for their next search

const modeKey = (email?: string) => `pm:search-mode:${(email ?? "").toLowerCase()}`;
export function rememberedMode(email?: string): SearchMode {
  try { return modeOf(localStorage.getItem(modeKey(email))); } catch { return "words"; }
}
export function rememberMode(email: string | undefined, m: SearchMode) {
  try { localStorage.setItem(modeKey(email), m); } catch { /* private mode: it lasts for this page */ }
}

// ---------- asking the server

/** Answers already had, for a short while: Back to the results does not ask again. */
const answers = new Map<string, { at: number; results: MeaningResult[] }>();
const KEEP_MS = 2 * 60 * 1000;
const KEEP_N = 30;

export interface MeaningAnswer { query: string; results: MeaningResult[] }
export interface MeaningState {
  /** The query asked last: what `loading` and `problem` are about. */
  for: string;
  /** The query being asked, while the answer is awaited. */
  loading: string | null;
  /** The last answer, kept while a newer one is awaited or failed. */
  answer: MeaningAnswer | null;
  /** What went wrong with the query asked last, if anything. */
  problem: MeaningProblem | null;
}

/**
 * Asks the server for `asked` whenever it, or `attempt`, changes and `enabled` is true. An answer
 * for a query that is no longer the one asked never replaces a newer one.
 */
export function useMeaningSearch(asked: string, enabled: boolean, attempt: number): MeaningState {
  const [state, setState] = useState<MeaningState>(() => {
    const had = enabled ? fresh(asked) : null;
    return { for: had ? asked : "", loading: null, answer: had ? { query: asked, results: had } : null, problem: null };
  });
  const current = useRef("");
  const run = useCallback((q: string) => {
    current.current = q;
    const had = fresh(q);
    if (had) { setState({ for: q, loading: null, answer: { query: q, results: had }, problem: null }); return; }
    setState((s) => ({ ...s, for: q, loading: q, problem: null }));
    asking(q).then((results) => {
      if (current.current !== q) return; // a newer search was asked meanwhile
      setState({ for: q, loading: null, answer: { query: q, results }, problem: null });
    }, (e: unknown) => {
      if (current.current !== q) return;
      setState((s) => ({ ...s, loading: null, problem: problemOf(e) }));
    });
  }, []);
  useEffect(() => {
    if (!enabled) { current.current = ""; setState((s) => (s.loading || s.problem ? { ...s, for: "", loading: null, problem: null } : s)); return; }
    run(asked);
  }, [asked, enabled, attempt, run]);
  return state;
}

/** One request per query at a time, however often it is asked meanwhile. */
const pending = new Map<string, Promise<MeaningResult[]>>();
function asking(q: string): Promise<MeaningResult[]> {
  let p = pending.get(q);
  if (!p) {
    p = searchByMeaning(q).then((results) => {
      answers.delete(q);
      answers.set(q, { at: Date.now(), results });
      while (answers.size > KEEP_N) answers.delete(answers.keys().next().value as string);
      return results;
    }).finally(() => pending.delete(q));
    pending.set(q, p);
  }
  return p;
}

function fresh(q: string): MeaningResult[] | null {
  const had = answers.get(q);
  if (!had) return null;
  if (Date.now() - had.at > KEEP_MS) { answers.delete(q); return null; }
  return had.results;
}

/** For tests: forget the answers had. */
export const forgetAnswers = () => answers.clear();

// ---------- what the page shows

/** What the results page shows, worked out from the mode, the query and the server's state. */
export interface Plan {
  /** The query the results shown are for. */
  q: string;
  /**
   * words: the word search of `q`; meaning: the server's answer; both: the two put together;
   * none: no results (yet).
   */
  show: "words" | "meaning" | "both" | "none";
  /** The server's answer for `q`, for "meaning" and "both". */
  meaning: MeaningResult[];
  /** A newer search is awaited. */
  busy: boolean;
  problem: MeaningProblem | null;
}

/**
 * `q` is the query in the address (it follows the typing), `asked` the one sent to the server
 * last. With Words, or when search by meaning is not offered, the word search follows `q`.
 */
export function planOf(mode: SearchMode, q: string, asked: string, offered: boolean, st: MeaningState): Plan {
  const plain = (query: string): Plan => ({ q: query, show: "words", meaning: [], busy: false, problem: null });
  if (!offered || mode === "words" || st.problem?.kind === "off") return plain(q);
  const a = asked.trim();
  if (!a) return plain("");
  const settled = st.for === a && !st.loading;
  if (settled && st.problem) return { q: a, show: mode === "meaning" ? "none" : "words", meaning: [], busy: false, problem: st.problem };
  if (settled && st.answer?.query === a) return { q: a, show: mode, meaning: st.answer.results, busy: false, problem: null };
  // waiting: what was shown stays until the answer comes
  if (st.answer) return { q: st.answer.query, show: mode, meaning: st.answer.results, busy: true, problem: null };
  return { q: a, show: mode === "meaning" ? "none" : "words", meaning: [], busy: true, problem: null };
}

const LITTLE = new Set(["the", "and", "for", "with", "how", "what", "who", "when", "can", "are", "was", "you", "your", "our", "from", "into", "that", "this", "not", "but", "has", "have", "its", "all", "any", "out", "get", "use"]);
/**
 * The words marked on the cards of a search by meaning: a result need not contain every word,
 * so marking "a" or "the" wherever they occur would only add noise. Short and common words are
 * left unmarked.
 */
export const markedWords = (words: string[]) => words.filter((w) => w.length >= 3 && !LITTLE.has(w));
