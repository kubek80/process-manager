import type { Status, TargetKind } from "../types";

/**
 * Requests for a process or standard that does not exist yet. Everyone signed in sees them, can
 * ask for one and vote; whoever could create it moves it along (the server says who: `canManage`).
 */

export type RequestState = "open" | "planned" | "done" | "declined";
/** What the list shows: one state, or everything. */
export type RequestFilter = RequestState | "all";

export interface DocRequest {
  id: number;
  kind: TargetKind;
  title: string;
  description: string;
  platform: string;
  practice: string;
  requestedBy: { name: string; email: string };
  createdAt: string;
  state: RequestState;
  stateNote: string;
  stateBy: string;
  stateAt: string;
  /** The process or standard (of the same kind) that answers it, once done. */
  linkedId: string;
  /** Done, but what answered it was deleted since (`linkedId` is then empty). An older server leaves it out. */
  linkedGone?: boolean;
  votes: number;
  votedByMe: boolean;
  mine: boolean;
  canManage: boolean;
}

/** What somebody fills in to ask for something. */
export interface NewRequest { kind: TargetKind; title: string; description: string; platform?: string; practice?: string }

export const REQUEST_FILTERS: RequestFilter[] = ["open", "planned", "done", "declined", "all"];
export const STATE_LABEL: Record<RequestFilter, string> = { open: "Open", planned: "Planned", done: "Done", declined: "Declined", all: "All" };

export const TITLE_MIN = 5, TITLE_MAX = 120, TEXT_MIN = 10, TEXT_MAX = 1000;

/** Most wanted first: the most votes, then the newest. */
export function sortRequests(list: DocRequest[]): DocRequest[] {
  return [...list].sort((a, b) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

/** The requests a filter keeps, most wanted first. */
export function filterRequests(list: DocRequest[], state: RequestFilter, kind?: TargetKind): DocRequest[] {
  return sortRequests(list.filter((r) => (state === "all" || r.state === state) && (!kind || r.kind === kind)));
}

/** How many requests each filter would show (for the counts next to the filter buttons). */
export function stateCounts(list: DocRequest[], kind?: TargetKind): Record<RequestFilter, number> {
  const counts: Record<RequestFilter, number> = { open: 0, planned: 0, done: 0, declined: 0, all: 0 };
  for (const r of list) if (!kind || r.kind === kind) { counts[r.state]++; counts.all++; }
  return counts;
}

/** What is wrong with a request before it is sent, in plain words; empty when it can be sent. */
export function requestProblems(r: Pick<NewRequest, "title" | "description">): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {};
  const t = r.title.trim().length, d = r.description.trim().length;
  if (t < TITLE_MIN) out.title = `Give it a name of at least ${TITLE_MIN} characters.`;
  else if (t > TITLE_MAX) out.title = `The name can be at most ${TITLE_MAX} characters.`;
  if (d < TEXT_MIN) out.description = `Say in a sentence what is needed and why (at least ${TEXT_MIN} characters).`;
  else if (d > TEXT_MAX) out.description = `At most ${TEXT_MAX} characters.`;
  return out;
}

// ---------- similar titles: so people vote instead of asking twice

const STOP = new Set([
  "a", "an", "the", "to", "for", "of", "and", "or", "in", "on", "with", "how", "new", "my", "our", "your", "is", "be", "by", "at",
  "from", "into", "about", "we", "i", "it", "its", "this", "that", "need", "needs", "want", "please", "process", "standard", "processes", "standards",
]);

/** The words of a title that say something, in a simple common form (lower case, no plural s). */
export function titleWords(title: string): string[] {
  const words = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return [...new Set(words)];
}

export interface Similar<T> { item: T; shared: number }

/**
 * What already exists with a title that looks like `title`: at least two shared words (or the
 * only word, for a one-word title), best match first. A plain word match - enough to make
 * somebody look before asking twice.
 */
export function similarTitles<T extends { title: string }>(title: string, candidates: T[], limit = 5): Similar<T>[] {
  const want = titleWords(title);
  if (!want.length) return [];
  const need = Math.min(2, want.length);
  const out: Similar<T>[] = [];
  for (const item of candidates) {
    const have = new Set(titleWords(item.title));
    const shared = want.filter((w) => have.has(w)).length;
    if (shared >= need) out.push({ item, shared });
  }
  return out.sort((a, b) => b.shared - a.shared || a.item.title.localeCompare(b.item.title)).slice(0, limit);
}

// ---------- the address: #/requests?state=done&kind=process

export interface RequestsView { state?: RequestFilter; kind?: TargetKind }

export function parseRequestsQuery(query: string): RequestsView {
  const out: RequestsView = {};
  for (const part of query.split("&")) {
    const [key, value] = part.split("=");
    if (key === "state" && (REQUEST_FILTERS as string[]).includes(value)) out.state = value as RequestFilter;
    if (key === "kind" && (value === "process" || value === "standard")) out.kind = value;
  }
  return out;
}

export function requestsQuery(v: RequestsView): string {
  const parts = [v.state ? `state=${v.state}` : "", v.kind ? `kind=${v.kind}` : ""].filter(Boolean);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** A vote, as it looks right after clicking: put back when the server refuses. */
export function toggledVote(r: DocRequest): DocRequest {
  return { ...r, votedByMe: !r.votedByMe, votes: Math.max(0, r.votes + (r.votedByMe ? -1 : 1)) };
}

// ---------- what answers a done request

/** What a done request shows as its answer. */
export type Answer =
  | { kind: "doc"; id: string; title: string }   // a process or standard the app has: a link
  | { kind: "gone" }                             // it was deleted since
  | { kind: "unknown"; id: string }              // an id the app does not have (deleted, or not visible): text only
  | { kind: "none" };                            // done without a link (an older entry)

export function answerOf(r: Pick<DocRequest, "linkedId" | "linkedGone">, docs: { id: string; title: string }[]): Answer {
  if (r.linkedGone) return { kind: "gone" };
  if (!r.linkedId) return { kind: "none" };
  const doc = docs.find((d) => d.id === r.linkedId);
  return doc ? { kind: "doc", id: doc.id, title: doc.title } : { kind: "unknown", id: r.linkedId };
}

/** What may answer a request: published processes or standards only (not drafts, not retired ones), by title. */
export function answerChoices<T extends { id: string; title: string; status?: Status }>(docs: T[]): T[] {
  return docs.filter((d) => (d.status ?? "active") === "active").sort((a, b) => a.title.localeCompare(b.title));
}

/** One wording per action: the button and the title of its dialog say the same. */
export const ACTION_LABEL = {
  planned: "Mark as planned", done: "Mark as done", declined: "Decline request", open: "Back to open",
  withdraw: "Withdraw", remove: "Remove",
} as const;
