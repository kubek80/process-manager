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
 * Whether typing changes the address at once. With Words it does, as the results follow the
 * typing. With Meaning and Both the server is asked only when the search is run (Enter, the
 * button, a change of mode), because each search may call an outside service; the address then
 * changes only at that moment, so that it always says what the results are for - a copied link,
 * a reload, Back and Forward show what the person is looking at.
 */
export const typingMovesAddress = (mode: SearchMode, offered: boolean) => !offered || mode === "words";

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
const answers = new Map<string, { at: number; answer: Answer }>();
/** What the server answered: best first, and whether more matched than it sent. */
interface Answer { results: MeaningResult[]; truncated: boolean }
const KEEP_MS = 2 * 60 * 1000;
const KEEP_N = 30;

export interface MeaningAnswer { query: string; results: MeaningResult[]; truncated?: boolean }
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
 * What the page knows about the content, as a short text that changes whenever a process or
 * standard it has changes (a save, a reload, one more or one less). Answers kept from the server
 * are kept per query AND per this, so that after a change the next search asks again.
 */
export function contentStamp(processes: unknown[], standards: unknown[]): string {
  // FNV-1a over the documents as text: cheap, and the same content gives the same stamp
  let h = 0x811c9dc5;
  const text = JSON.stringify([processes, standards]);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${processes.length}.${standards.length}.${(h >>> 0).toString(36)}`;
}
/** Where an answer is kept: the query, for this content. */
export const answerKey = (stamp: string, q: string) => `${stamp}\n${q}`;

/**
 * Asks the server for `asked` whenever it, or `attempt`, changes and `enabled` is true. An answer
 * for a query that is no longer the one asked never replaces a newer one. `stamp` is what the
 * page knows about the content (`contentStamp`): a kept answer is used only for the same content.
 */
export function useMeaningSearch(asked: string, enabled: boolean, attempt: number, stamp = ""): MeaningState {
  const [state, setState] = useState<MeaningState>(() => {
    const had = enabled ? fresh(answerKey(stamp, asked)) : null;
    return { for: had ? asked : "", loading: null, answer: had ? { query: asked, ...had } : null, problem: null };
  });
  const current = useRef("");
  const stampNow = useRef(stamp);
  stampNow.current = stamp;
  const run = useCallback((q: string) => {
    current.current = q;
    const key = answerKey(stampNow.current, q);
    const had = fresh(key);
    if (had) { setState({ for: q, loading: null, answer: { query: q, ...had }, problem: null }); return; }
    setState((s) => ({ ...s, for: q, loading: q, problem: null }));
    asking(key, q).then((a) => {
      if (current.current !== q) return; // a newer search was asked meanwhile
      setState({ for: q, loading: null, answer: { query: q, ...a }, problem: null });
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

/** One request per query and content at a time, however often it is asked meanwhile. */
const pending = new Map<string, Promise<Answer>>();
function asking(key: string, q: string): Promise<Answer> {
  let p = pending.get(key);
  if (!p) {
    p = searchByMeaning(q).then((answer) => {
      answers.delete(key);
      answers.set(key, { at: Date.now(), answer });
      while (answers.size > KEEP_N) answers.delete(answers.keys().next().value as string);
      return answer;
    }).finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

function fresh(key: string): Answer | null {
  const had = answers.get(key);
  if (!had) return null;
  if (Date.now() - had.at > KEEP_MS) { answers.delete(key); return null; }
  return had.answer;
}

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
  /** More matched than the server sent: the filters and counts work on the closest only. */
  truncated: boolean;
  /** A newer search is awaited. */
  busy: boolean;
  problem: MeaningProblem | null;
}

/**
 * `q` is the query in the address, `asked` the one sent to the server last (with Meaning and Both
 * the address changes only when the search is run, so the two are the same there). With Words,
 * or when search by meaning is not offered, the word search follows `q`.
 */
export function planOf(mode: SearchMode, q: string, asked: string, offered: boolean, st: MeaningState): Plan {
  const plain = (query: string): Plan => ({ q: query, show: "words", meaning: [], truncated: false, busy: false, problem: null });
  if (!offered || mode === "words" || st.problem?.kind === "off") return plain(q);
  const a = asked.trim();
  if (!a) return plain("");
  const settled = st.for === a && !st.loading;
  if (settled && st.problem) return { q: a, show: mode === "meaning" ? "none" : "words", meaning: [], truncated: false, busy: false, problem: st.problem };
  if (settled && st.answer?.query === a) return { q: a, show: mode, meaning: st.answer.results, truncated: !!st.answer.truncated, busy: false, problem: null };
  // waiting: what was shown stays until the answer comes
  if (st.answer) return { q: st.answer.query, show: mode, meaning: st.answer.results, truncated: !!st.answer.truncated, busy: true, problem: null };
  return { q: a, show: mode === "meaning" ? "none" : "words", meaning: [], truncated: false, busy: true, problem: null };
}

const LITTLE = new Set(["the", "and", "for", "with", "how", "what", "who", "when", "can", "are", "was", "you", "your", "our", "from", "into", "that", "this", "not", "but", "has", "have", "its", "all", "any", "out", "get", "use"]);
/**
 * The words marked on the cards of a search by meaning: a result need not contain every word,
 * so marking "a" or "the" wherever they occur would only add noise. Short and common words are
 * left unmarked.
 */
export const markedWords = (words: string[]) => words.filter((w) => w.length >= 3 && !LITTLE.has(w));

// ---------- what the page says about it

/** The provider of search by meaning, as `/api/me` says: unknown from an older server. */
export type Provider = "builtin" | "vertex" | undefined;
export const providerOf = (p: unknown): Provider => (p === "builtin" || p === "vertex" ? p : undefined);

/**
 * The line that says what "Meaning" does - true for the provider in use. The built-in one
 * compares words and parts of words; it does not know that different words can mean the same
 * thing, and it always shows the closest, close or not. Without knowing the provider, the
 * cautious wording, which holds for both.
 */
export function meaningHelp(provider: Provider): string {
  if (provider === "builtin") return "compares the words and parts of words you type with the text of every process and standard, and shows the closest first, even when none is really close. It does not know that different words can mean the same thing.";
  if (provider === "vertex") return "finds processes and standards about what you type, even when they use other words, and shows the closest first.";
  return "puts first what comes closest to what you type, even when not every word is in it.";
}

/**
 * The one short line under the search box: what the chosen way of searching does. The full
 * explanation of all three is behind "How this works".
 */
export function modeLine(mode: SearchMode, provider: Provider): string {
  if (mode === "words") return "Finds what contains every word you type.";
  if (mode === "both") return "Shows what words and meaning find, the best of each first.";
  if (provider === "builtin") return "Shows the closest first, even when none is really close.";
  if (provider === "vertex") return "Finds what is about what you type, even in other words.";
  return "Puts first what comes closest to what you type.";
}

/** The sentence near the count when the server sent only the closest of more that matched. */
export const truncatedText = (n: number) => `Showing the ${n} closest. Add words or choose a filter to narrow it down.`;

/**
 * Whether to show the closest by meaning under a word search that found nothing: only when search
 * by meaning is offered, words are chosen, and the words were asked for on purpose (Enter, Search,
 * a link: `submitted` is what was asked then), never while typing. `wordHits` is how many the
 * words found without filters (-1: not worked out).
 */
export function closestWanted(o: { mode: SearchMode; offered: boolean; asked: string; submitted: string; wordHits: number }): boolean {
  return o.offered && o.mode === "words" && !!o.asked.trim() && o.asked.trim() === o.submitted.trim() && o.wordHits === 0;
}

/** What became of looking for the closest by meaning after words found nothing. */
export type ClosestOutcome = "found" | "nothing" | "problem" | "waiting" | "not-tried";

/**
 * The sentence of the empty state when words found nothing (no filters chosen). Once the closest
 * by meaning was looked for and nothing came close, it says so, so that nobody is offered the same
 * search again; when it could not be looked for, that is said too.
 */
export function noWordsText(q: string, nWords: number, closest: ClosestOutcome): string {
  const tip = nWords > 1 ? "Every word must be found, so try fewer words." : "Check the spelling, or try another word.";
  if (closest === "nothing") return `Nothing matches “${q}”, and nothing comes close by meaning either. ${nWords > 1 ? "Try fewer or other words." : "Try another word."}`;
  if (closest === "problem") return `Nothing matches “${q}”. ${tip} The closest by meaning could not be looked for: search by meaning is not available right now.`;
  return `Nothing matches “${q}”. ${tip}`;
}

/**
 * The sentence of the empty state when nothing is found with the chosen filters: whether the filters
 * are what hides it (`without` results without them; the page then offers "Clear all filters"), or
 * nothing matches either way.
 */
export function emptyWithFilters(q: string, without: number): string {
  if (without > 0) {
    const rest = `Without them there ${without === 1 ? "is 1 result" : `are ${without} results`}.`;
    return q ? `Nothing matches “${q}” with these filters. ${rest}` : `Nothing matches these filters. ${rest}`;
  }
  return q ? `Nothing matches “${q}”, with or without these filters.` : "Nothing matches these filters.";
}

/**
 * The other way of searching the empty state offers, if any: by words after a search by meaning
 * found nothing; the closest by meaning after words found nothing while typing (it is looked for
 * by itself once the search is run with Enter or Search, so it is not offered again then); and,
 * when filters are chosen (the closest is not looked for then), a search by meaning with them.
 */
export function otherWay(o: { offered: boolean; q: string; show: Plan["show"]; mode: SearchMode; filtered: boolean; closest: ClosestOutcome }): "words" | "closest" | "meaning" | null {
  if (!o.offered || !o.q.trim()) return null;
  if (o.show === "meaning") return "words";
  if (o.mode !== "words") return null;
  if (o.filtered) return "meaning";
  return o.closest === "not-tried" ? "closest" : null;
}
