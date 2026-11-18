import { useCallback, useEffect, useRef, useState } from "react";
import type { Assignment, AuditEntry, Catalog, DocMeta, DocVersion, Feedback, FeedbackByTarget, Me, Membership, Process, Role, Skill, SkillDetail, Standard, TargetKind } from "../types";
import type { Conflict } from "./draftState";
import { completeCatalog } from "./catalog";
import { completePerms } from "./rights";
import { parseRequestsQuery, requestsQuery, type DocRequest, type NewRequest, type RequestState, type RequestsView } from "./requests";
import type { Period, Statistics } from "./statistics";
import type { AdminUser, UserRole } from "./users";

export class ApiError extends Error {
  /** Set when a save was refused because somebody else saved (or deleted) first. */
  conflict?: Conflict;
  constructor(public status: number, message: string) { super(message); }
}

/** Sent to the window when the server no longer knows the session (it expired, or was ended elsewhere). */
export const SIGNED_OUT = "pm:signed-out";

/** One place for every call to the server: JSON in and out, the CSRF header, readable errors. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await request<T>(method, path, body)).data;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json", "X-Requested-With": "process-manager" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "The server cannot be reached. Is it running?");
  }
  if (res.status === 204) return { data: undefined as T, headers: res.headers };
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // The session ended. The page stays as it is - somebody may be in the middle of an edit -
    // and the app asks to sign in again on top of it.
    if (res.status === 401 && path !== "/api/me") {
      window.dispatchEvent(new Event(SIGNED_OUT));
      throw new ApiError(401, "You are signed out. Sign in again, then repeat what you were doing.");
    }
    const err = new ApiError(res.status, data?.error ?? `The server answered ${res.status}.`);
    if (res.status === 409 && data?.conflict) err.conflict = data.conflict as Conflict;
    throw err;
  }
  return { data: data as T, headers: res.headers };
}

export async function loadMe(): Promise<Me> {
  const me = await call<Me>("GET", "/api/me");
  return me.perms ? { ...me, perms: completePerms(me.perms) } : me;
}
export const devLogin = (email: string) => call<void>("POST", "/auth/dev/login", { email });
export const logout = () => call<void>("POST", "/auth/logout");

// Content: processes, standards and the lists live in the database. Every save is a new
// version; a save says which version it was made from (`base`) and is refused when somebody
// else saved in the meantime (ApiError.conflict).
export type MetaById = Record<string, DocMeta>;
const saveQuery = (base: number, note = "") => `?base=${base}${note.trim() ? `&note=${encodeURIComponent(note.trim())}` : ""}`;

/** An older server sends no `createdAt`: the date of the last save stands in for it. */
export function completeMeta(meta: Record<string, Partial<DocMeta>> | undefined): MetaById {
  const out: MetaById = {};
  for (const [id, m] of Object.entries(meta ?? {})) out[id] = { version: 0, updatedAt: "", updatedBy: "", ...m, createdAt: m.createdAt || m.updatedAt || "" };
  return out;
}

export async function loadProcesses(): Promise<{ docs: Process[]; meta: MetaById }> {
  const r = await call<{ processes: Process[]; meta?: MetaById }>("GET", "/api/processes");
  return { docs: r.processes, meta: completeMeta(r.meta) };
}
export const putProcess = (p: Process, base: number, note?: string) => call<DocMeta>("PUT", `/api/processes/${p.id}${saveQuery(base, note)}`, p);
export const removeProcess = (id: string, base: number) => call<void>("DELETE", `/api/processes/${id}?base=${base}`);
export async function loadStandards(): Promise<{ docs: Standard[]; meta: MetaById }> {
  const r = await call<{ standards: Standard[]; meta?: MetaById }>("GET", "/api/standards");
  return { docs: r.standards, meta: completeMeta(r.meta) };
}
export const putStandard = (s: Standard, base: number, note?: string) => call<DocMeta>("PUT", `/api/standards/${s.id}${saveQuery(base, note)}`, s);
export const removeStandard = (id: string, base: number) => call<void>("DELETE", `/api/standards/${id}?base=${base}`);

// Unpublished changes to a published process or standard: one shared working draft beside it,
// seen only by its editors. Readers, skills and search keep the published version until it is
// published. `revision` counts the saves of the draft; a save says which one it was made from.
/** `updatedByName`: the person's name when the server knew it; `updatedBy` is their email. */
export interface WorkingDraft<T> { doc: T; base: number; revision: number; updatedBy: string; updatedByName?: string; updatedAt: string }
export interface DraftSaved { revision: number; base: number; updatedBy: string; updatedByName?: string; updatedAt: string }
const docsPath = (kind: TargetKind, id: string) => `/api/${kind === "process" ? "processes" : "standards"}/${encodeURIComponent(id)}`;
/** The working draft, or null when there is none. */
export async function loadWorkingDraft<T>(kind: TargetKind, id: string): Promise<WorkingDraft<T> | null> {
  // no draft: 204 without a body (an older server answered 404)
  try { return (await call<WorkingDraft<T> | undefined>("GET", `${docsPath(kind, id)}/draft`)) ?? null; } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
/**
 * Saves the working draft on top of revision `rev` (0: creates it). `base`: the published version
 * the changes were made from - with rev 0 the draft is created on it (so that publishing meets
 * any version published since), with a revision it moves the draft onto that version.
 */
export const putWorkingDraft = <T>(kind: TargetKind, id: string, doc: T, rev: number, base?: number) =>
  call<DraftSaved>("PUT", `${docsPath(kind, id)}/draft?rev=${rev}${base ? `&base=${base}` : ""}`, doc);
export const deleteWorkingDraft = (kind: TargetKind, id: string, rev: number) => call<void>("DELETE", `${docsPath(kind, id)}/draft?rev=${rev}`);
/** Publishes the working draft as the next version. `over`: publish it over a version somebody else published since. */
export const publishWorkingDraft = (kind: TargetKind, id: string, rev: number, note = "", over?: number) =>
  call<{ version: number }>("POST", `${docsPath(kind, id)}/publish?rev=${rev}${note.trim() ? `&note=${encodeURIComponent(note.trim())}` : ""}${over ? `&over=${over}` : ""}`);

/**
 * Records that a process or standard was reviewed and is still correct: today and the person's
 * name, as a version of its own. For the team that owns it and for whoever may edit it.
 */
export const confirmReview = <T extends Process | Standard>(kind: TargetKind, id: string, base: number) =>
  call<DocMeta & { document: T }>("POST", `/api/${kind === "process" ? "processes" : "standards"}/${id}/review?base=${base}`);

export async function loadCatalog(): Promise<{ catalog: Catalog; version: number }> {
  const { data: c, headers } = await request<Partial<Catalog>>("GET", "/api/catalog");
  return {
    catalog: completeCatalog(c),
    version: Number(headers.get("X-Document-Version") ?? 0) || 0,
  };
}
export const putCatalog = (c: Catalog, base: number, note?: string) => call<DocMeta>("PUT", `/api/catalog${saveQuery(base, note)}`, c);

export const loadHistory = async (kind: TargetKind | "catalog", id: string) => (await call<{ versions: DocVersion[] }>("GET", `/api/history/${kind}/${id}`)).versions;
export const loadVersion = <T>(kind: TargetKind | "catalog", id: string, version: number) => call<T>("GET", `/api/history/${kind}/${id}/${version}`);

export async function loadFeedback(): Promise<FeedbackByTarget> {
  const f = await call<Partial<FeedbackByTarget>>("GET", "/api/feedback");
  return { process: f.process ?? {}, standard: f.standard ?? {} };
}
export const createFeedback = (f: { targetKind: TargetKind; targetId: string; itemId?: string; kind: string; text: string }) => call<Feedback>("POST", "/api/feedback", f);
export const setAlsoHit = (id: string, on: boolean) => call<Feedback>(on ? "POST" : "DELETE", `/api/feedback/${id}/also-hit`);
export const setResolved = (id: string, resolved: boolean) => call<Feedback>("PATCH", `/api/feedback/${id}`, { resolved });
export const deleteFeedback = (id: string) => call<void>("DELETE", `/api/feedback/${id}`);

// views, bookmarks and upvotes: counted on the server; who viewed what is never shown
export interface EngagementCounts { views: number; people: number; downloads: number; upvotes: number; handled: number }
export interface EngagementData {
  counts: Record<TargetKind, Record<string, Partial<EngagementCounts>>>;
  mine: { bookmarks: { kind: TargetKind; id: string; at: string }[]; upvotes: { kind: TargetKind; id: string }[] };
}
export async function loadEngagement(): Promise<EngagementData> {
  const r = await call<Partial<EngagementData> | null>("GET", "/api/engagement");
  return {
    counts: { process: r?.counts?.process ?? {}, standard: r?.counts?.standard ?? {} },
    mine: { bookmarks: r?.mine?.bookmarks ?? [], upvotes: r?.mine?.upvotes ?? [] },
  };
}
/** Records a view; the answer is the document's numbers after it (an older server answers with nothing). */
export const recordViewOn = (kind: TargetKind, id: string) => call<{ views?: number; people?: number } | undefined>("POST", `/api/views/${kind}/${encodeURIComponent(id)}`);
export const setBookmark = (kind: TargetKind, id: string, on: boolean) => call<void>(on ? "PUT" : "DELETE", `/api/bookmarks/${kind}/${encodeURIComponent(id)}`);
export const setUpvote = (kind: TargetKind, id: string, on: boolean) => call<{ upvotes: number }>(on ? "PUT" : "DELETE", `/api/upvotes/${kind}/${encodeURIComponent(id)}`);

// skills and review agents generated from processes and standards
export const loadSkills = async () => (await call<{ skills: Skill[] }>("GET", "/api/skills")).skills;
export const loadSkill = (id: string) => call<SkillDetail>("GET", `/api/skills/${id}`);
export const loadSkillVersion = async (id: string, version: number) => (await call<{ content: string }>("GET", `/api/skills/${id}/versions/${version}`)).content;
export const putSkillExtra = (id: string, extra: string) => call<SkillDetail>("PUT", `/api/skills/${id}/extra`, { extra });

/** Who belongs to which team, platform and practice. Everyone who is signed in may read it. */
export const loadMembers = async () => (await call<{ members?: Membership[] }>("GET", "/api/members")).members ?? [];

// admin panel
export interface Access { assignments: Assignment[]; bootstrapAdmins: string[]; roles: Role[] }
export const loadAccess = () => call<Access>("GET", "/api/admin/access");
export const grantAccess = (a: { email: string; role: Role; scope: string }) => call<Access>("POST", "/api/admin/access", a);
export const revokeAccess = (a: { email: string; role: Role; scope: string }) => call<Access>("DELETE", "/api/admin/access", a);
// People and all their roles at once (Admin > Access).
export const loadUsers = async () => (await call<{ users?: AdminUser[] }>("GET", "/api/admin/users")).users ?? [];
export const saveUserRoles = (email: string, roles: UserRole[]) => call<AdminUser>("PUT", `/api/admin/users/${encodeURIComponent(email)}`, { roles });
export const deleteUser = (email: string) => call<void>("DELETE", `/api/admin/users/${encodeURIComponent(email)}`);
/** A page of the activity log, newest first. `before` is the id of the last entry already shown. */
export const loadAudit = (limit = 100, before = 0) => call<{ entries: AuditEntry[]; more: boolean }>("GET", `/api/admin/audit?limit=${limit}${before ? `&before=${before}` : ""}`);
export interface SystemInfo { provider: string; baseUrl: string; notify: string; processes: number; standards: number; skills: number; assignments: number; openFeedback: number }
export const loadSystem = () => call<SystemInfo>("GET", "/api/admin/system");

// requests for a process or standard that does not exist yet
export const loadRequests = async () => (await call<{ requests?: DocRequest[] }>("GET", "/api/requests")).requests ?? [];
export const createRequest = (r: NewRequest) => call<DocRequest>("POST", "/api/requests", r);
/** Votes for a request (or takes the vote back); the new number of votes. */
export const voteRequest = async (id: number, on: boolean) => (await call<{ votes: number }>(on ? "PUT" : "DELETE", `/api/requests/${id}/vote`)).votes;
export const setRequestState = (id: number, s: { state: RequestState; note?: string; linkedId?: string }) => call<DocRequest>("PUT", `/api/requests/${id}/state`, s);
export const withdrawRequest = (id: number) => call<void>("DELETE", `/api/requests/${id}`);
/** One place inside a document that search by meaning found, best first. */
export interface MeaningHit { part: string; item: string; label: string; snippet: string; score: number }
/** One document search by meaning found, with up to three places inside it. */
export interface MeaningResult { kind: TargetKind; id: string; score: number; hits: MeaningHit[] }
/**
 * Search by meaning on the server: published processes and standards, best first, and whether
 * more matched than were sent (`truncated`). Refused with 404 when it is switched off, 429 when
 * one person searches very often, 502 when the service that compares the texts cannot be
 * reached, 503 while it is not ready yet. A server that takes at most 100 is asked again for 100.
 */
export async function searchByMeaning(q: string, limit = 500): Promise<{ results: MeaningResult[]; truncated: boolean }> {
  const ask = (n: number) => call<{ results?: MeaningResult[]; truncated?: boolean } | null>("GET", `/api/search?q=${encodeURIComponent(q)}&limit=${n}`);
  let r: { results?: MeaningResult[]; truncated?: boolean } | null;
  try { r = await ask(limit); } catch (e) {
    if (!(e instanceof ApiError && e.status === 400 && limit > 100)) throw e;
    r = await ask(100);
  }
  return { results: Array.isArray(r?.results) ? r!.results : [], truncated: r?.truncated === true };
}

/** Use of processes and standards over a period, for admins. */
export const loadStatistics = (period: Period) => call<Statistics>("GET", `/api/admin/statistics?period=${period}`);

/** Personal "done" ticks, kept in the browser only - they are not part of the process definition. */
export function useProgress(processId: string) {
  const key = `pm:progress:${processId}`;
  const read = () => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { return new Set<string>(); }
  };
  const [done, setDone] = useState<Set<string>>(read);
  useEffect(() => setDone(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const persist = (s: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* private mode */ } };
  const toggle = useCallback((id: string) => setDone((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(next);
    return next;
  }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => { const e = new Set<string>(); persist(e); setDone(e); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { done, toggle, reset };
}

/** "json": an older address of the text of a document; it now opens the editing screen. */
export type Tab = "flow" | "list" | "feedback" | "skills" | "json";
export type StandardTab = "doc" | "feedback" | "skills" | "json";
export type AdminSection = "access" | "lists" | "skills" | "health" | "activity" | "statistics" | "system";
/** `item` is the step or the requirement that is open, so that a link can point at one. */
export type Route =
  | { page: "home" } | ({ page: "search" } & SearchState)
  | { page: "library" } | { page: "standards" } | { page: "catalog" } | { page: "guide" } | { page: "mine" }
  | ({ page: "requests" } & RequestsView)
  | { page: "admin"; section: AdminSection }
  | { page: "process"; id: string; tab: Tab; item?: string }
  | { page: "standard"; id: string; tab: StandardTab; item?: string }
  /** The editing screen; `item` is the step or requirement that is selected. */
  | { page: "edit-process"; id: string; item?: string }
  | { page: "edit-standard"; id: string; item?: string };

/**
 * What the results page shows: the words searched for and the filters. Several values of one
 * filter mean "any of these"; different filters all apply. Empty ones are left out.
 */
export interface SearchState {
  q?: string;
  type?: TargetKind[];
  rigour?: import("../types").Rigour[];
  category?: string[];
  practice?: string[];
  platform?: string[];
  /** The team that maintains it. */
  owner?: string[];
  /** The page of the results shown, from 1 (1 is left out of the address). */
  pageNo?: number;
  /** How many results a page shows: 12, 24 or 48; left out, the person's own choice. */
  size?: number;
  /** Search by meaning, or both ways; left out, by words. */
  mode?: "meaning" | "both";
  /** The order: newest first (date added), recently updated first; left out, the best match (or by name). */
  sort?: "newest" | "updated";
}
const SEARCH_LISTS = ["type", "rigour", "category", "practice", "platform", "owner"] as const;
const SEARCH_SIZES = [12, 24, 48];
const SEARCH_ALLOWED: Partial<Record<(typeof SEARCH_LISTS)[number], string[]>> = { type: ["process", "standard"], rigour: ["mandatory", "recommended", "optional"] };
/**
 * A value from the address in plain text. A broken escape (a typed "100%") is kept as it was
 * typed instead of losing the whole value; the escapes around it are still read.
 */
export function decode(s: string): string {
  const text = s.replace(/\+/g, " ");
  try { return decodeURIComponent(text); } catch {
    return text.replace(/(%[0-9A-Fa-f]{2})+/g, (run) => { try { return decodeURIComponent(run); } catch { return run; } });
  }
}
/** `#/search?q=…&platform=azure,github`: unknown or empty parts are ignored. */
function parseSearch(query: string): Route {
  const r: { page: "search" } & SearchState = { page: "search" };
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq), raw = part.slice(eq + 1);
    if (key === "q") { const q = decode(raw); if (q.trim()) r.q = q; continue; }
    if (key === "page") { if (/^[1-9]\d{0,5}$/.test(raw)) r.pageNo = Number(raw); continue; }
    if (key === "size") { if (SEARCH_SIZES.includes(Number(raw)) && /^\d+$/.test(raw)) r.size = Number(raw); continue; }
    if (key === "mode") { if (raw === "meaning" || raw === "both") r.mode = raw; continue; }
    if (key === "sort") { if (raw === "newest" || raw === "updated") r.sort = raw; continue; }
    if (!(SEARCH_LISTS as readonly string[]).includes(key)) continue;
    const k = key as (typeof SEARCH_LISTS)[number];
    const values = [...new Set(raw.split(",").map((v) => decode(v).trim()).filter((v) => v && (!SEARCH_ALLOWED[k] || SEARCH_ALLOWED[k]!.includes(v))))];
    if (values.length) r[k] = values as never; // checked against the allowed values above
  }
  return r;
}
function searchHref(r: SearchState): string {
  const parts: string[] = [];
  if (r.q?.trim()) parts.push(`q=${encodeURIComponent(r.q)}`);
  for (const k of SEARCH_LISTS) if (r[k]?.length) parts.push(`${k}=${(r[k] as string[]).map(encodeURIComponent).join(",")}`);
  if (r.pageNo && Number.isInteger(r.pageNo) && r.pageNo > 1) parts.push(`page=${r.pageNo}`);
  if (r.size && SEARCH_SIZES.includes(r.size)) parts.push(`size=${r.size}`);
  if (r.mode === "meaning" || r.mode === "both") parts.push(`mode=${r.mode}`);
  if (r.sort === "newest" || r.sort === "updated") parts.push(`sort=${r.sort}`);
  return `#/search${parts.length ? `?${parts.join("&")}` : ""}`;
}

const parse = (h: string = location.hash): Route => {
  const search = h.match(/^#\/search(?:\?(.*))?$/);
  if (search) return parseSearch(search[1] ?? "");
  if (h.startsWith("#/processes")) return { page: "library" };
  if (h.startsWith("#/catalog")) return { page: "catalog" };
  if (h.startsWith("#/guide")) return { page: "guide" };
  if (h.startsWith("#/mine")) return { page: "mine" };
  if (h.startsWith("#/standards")) return { page: "standards" };
  const requests = h.match(/^#\/requests(?:\?(.*))?$/);
  if (requests) return { page: "requests", ...parseRequestsQuery(requests[1] ?? "") };
  const admin = h.match(/^#\/admin(?:\/(access|lists|skills|health|activity|statistics|system))?/);
  if (admin) return { page: "admin", section: (admin[1] as AdminSection) ?? "access" };
  const es = h.match(/^#\/s\/([a-z0-9-]+)\/(?:edit(?:\/([A-Z][A-Z0-9-]*))?|json)/);
  if (es) return { page: "edit-standard", id: es[1], ...(es[2] ? { item: es[2] } : {}) };
  const ep = h.match(/^#\/p\/([a-z0-9-]+)\/(?:edit(?:\/([a-z0-9-]+))?|json)/);
  if (ep) return { page: "edit-process", id: ep[1], ...(ep[2] ? { item: ep[2] } : {}) };
  const s = h.match(/^#\/s\/([a-z0-9-]+)(?:\/(doc|feedback|skills)(?:\/([A-Z][A-Z0-9-]*))?)?/);
  if (s) return { page: "standard", id: s[1], tab: (s[2] as StandardTab) ?? "doc", ...(s[3] ? { item: s[3] } : {}) };
  const m = h.match(/^#\/p\/([a-z0-9-]+)(?:\/(flow|list|feedback|skills)(?:\/([a-z0-9-]+))?)?/);
  return m ? { page: "process", id: m[1], tab: (m[2] as Tab) ?? "flow", ...(m[3] ? { item: m[3] } : {}) } : { page: "home" };
};
/** The route an address stands for; exported for tests. */
export const parseRoute = (hash: string): Route => parse(hash);

// ---------- unsaved work
// A page that has unsaved edits says so here. Leaving it then asks first: moving on inside the
// app (a link, Back, signing out) and closing or reloading the tab.

const unsaved = new Map<string, string>(); // what is being edited -> what to call it
/**
 * The places a route keeps open: leaving all places where something is edited is what loses
 * the edits. A process or standard is edited only on its editing screen (with its JSON); the
 * reader's page edits nothing.
 */
const placesOf = (r: Route): string[] => {
  if (r.page === "edit-process" || r.page === "edit-standard") {
    const doc = `${r.page === "edit-process" ? "process" : "standard"}/${r.id}`;
    return [doc, `${doc}#json`];
  }
  return r.page === "admin" && r.section === "lists" ? ["catalog"] : [];
};

const beforeUnload = (e: BeforeUnloadEvent) => { if (unsaved.size) e.preventDefault(); };
let listening = false;

/** Marks something as having unsaved edits until the returned function is called. */
export function guardLeaving(key: string, what: string): () => void {
  unsaved.set(key, what);
  if (!listening && typeof window !== "undefined") { window.addEventListener("beforeunload", beforeUnload); listening = true; }
  return () => { if (unsaved.get(key) === what) unsaved.delete(key); };
}
/** Forgets the unsaved edits of something that is gone, e.g. after it was deleted. */
export function forgetUnsaved(key: string) {
  for (const k of [...unsaved.keys()]) if (k === key || k.startsWith(`${key}#`)) unsaved.delete(k);
}
/** Whether this thing has unsaved edits. */
export const hasUnsaved = (key: string) => unsaved.has(key);
/** What would be lost by going to `to` (or by leaving the app when `to` is missing), if anything. */
export function unsavedWork(to?: Route): string | null {
  const staying = to ? placesOf(to) : [];
  for (const [key, what] of unsaved) if (!staying.includes(key)) return what;
  return null;
}

// Asked before a move that would lose unsaved edits. Set by the app (useRoute).
let confirmLeave: ((what: string) => Promise<boolean>) | undefined;
// An address the person agreed to move to although edits are lost.
let agreed: string | null = null;

/** Goes to `hash`, after asking when unsaved edits would be lost. */
async function moveTo(hash: string, replace = false) {
  const lost = unsavedWork(parse(hash));
  if (lost && confirmLeave && !(await confirmLeave(lost))) return;
  if (lost) agreed = hash;
  if (!replace) { location.hash = hash; return; }
  // the same place in the browser's history, under another address
  history.replaceState(history.state, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

type Mark = { pm?: number } | null;

/**
 * The current route. `ask` is asked before a move that would lose unsaved edits. Links and
 * buttons of the app are stopped before anything happens. The Back and Forward buttons and a
 * typed address have already moved when the app hears of them: the browser is then sent back
 * to where it was while asking, and on "leave" the same move is made again - so the history
 * stays as it was either way.
 */
export function useRoute(ask?: (what: string) => Promise<boolean>): Route {
  const [route, setRoute] = useState<Route>(() => parse());
  confirmLeave = ask;
  useEffect(() => {
    // every entry of the history gets a running number, so that a move can be told from its opposite
    let position = (history.state as Mark)?.pm ?? 0;
    if ((history.state as Mark)?.pm === undefined) history.replaceState({ pm: position }, "");
    let undoing = 0; // moves of our own that put the browser back: not news
    // where the browser itself says we are in its history, where it can tell (most browsers do)
    const at = (): number | undefined => (window as { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
    let index = at();
    let shown = location.hash; // the address of what is on screen
    const on = async () => {
      if (undoing > 0) { undoing--; return; }
      const target = location.hash;
      const mark = (history.state as Mark)?.pm;
      const fresh = mark === undefined; // an entry the browser just added (a typed address, a link)
      const lost = target === agreed ? null : unsavedWork(parse(target));
      agreed = null;
      if (!lost || !confirmLeave) {
        if (fresh) { position += 1; history.replaceState({ pm: position }, ""); } else position = mark;
        index = at();
        shown = target;
        setRoute(parse(target));
        return;
      }
      // The move that undoes what the browser just did: from its own count where it has one,
      // else from our numbers. An entry without a number may be a new one or one from before
      // the app was loaded; without the browser's count there is no telling which, and then
      // the address is put back in place instead of guessing a direction.
      const now = at();
      const back = now !== undefined && index !== undefined ? index - now : fresh ? 0 : position - mark;
      if (back === 0) {
        history.replaceState(history.state, "", shown || "#/");
        if (await confirmLeave(lost)) { agreed = target; location.hash = target; }
        return;
      }
      undoing++;
      history.go(back);
      if (await confirmLeave(lost)) {
        agreed = target;
        history.go(-back);
      }
    };
    // a link inside the app: ask before following it, so that "Stay" leaves no trace
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href^='#/']") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || !unsavedWork(parse(a.hash))) return;
      e.preventDefault();
      void moveTo(a.hash);
    };
    window.addEventListener("hashchange", on);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("hashchange", on); document.removeEventListener("click", click, true); };
  }, []);
  return route;
}

export const href = (r: Route): string => {
  switch (r.page) {
    case "home": return "#/";
    case "search": return searchHref(r);
    case "library": return "#/processes";
    case "standards": return "#/standards";
    case "catalog": return "#/catalog";
    case "guide": return "#/guide";
    case "mine": return "#/mine";
    case "requests": return `#/requests${requestsQuery(r)}`;
    case "admin": return `#/admin/${r.section}`;
    case "standard": return r.tab === "json" ? `#/s/${r.id}/edit` : `#/s/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
    case "process": return r.tab === "json" ? `#/p/${r.id}/edit` : `#/p/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
    case "edit-process": return `#/p/${r.id}/edit${r.item ? `/${r.item}` : ""}`;
    case "edit-standard": return `#/s/${r.id}/edit${r.item ? `/${r.item}` : ""}`;
  }
};
/**
 * Goes to a page of the app. With unsaved edits that would be lost, it asks first. With
 * `replace` the address changes without a new entry in the browser's history: for what is not
 * a step forward, such as a step that got another id.
 */
export const go = (r: Route, opts: { replace?: boolean } = {}) => { void moveTo(href(r), opts.replace); };

/** What the browser tab says for a page: the thing being read first, the product last. */
export function pageTitle(r: Route, names: { process?: string; standard?: string; loading?: boolean } = {}): string {
  const APP = "Process Manager";
  const of = (name: string | undefined, missing: string) => name ?? (names.loading ? "" : missing);
  let here: string;
  switch (r.page) {
    case "home": here = ""; break;
    case "search": here = r.q?.trim() ? `“${r.q.trim()}” · Search` : "Search"; break;
    case "library": here = "Processes"; break;
    case "standards": here = "Standards"; break;
    case "catalog": here = "Teams & tools"; break;
    case "guide": here = "Guide"; break;
    case "mine": here = "My responsibilities"; break;
    case "requests": here = "Requests"; break;
    case "admin": here = `${r.section.slice(0, 1).toUpperCase()}${r.section.slice(1)} · Admin`; break;
    case "process": here = of(names.process, "Process not found"); break;
    case "standard": here = of(names.standard, "Standard not found"); break;
    case "edit-process": here = names.process ? `Editing ${names.process}` : of(undefined, "Process not found"); break;
    case "edit-standard": here = names.standard ? `Editing ${names.standard}` : of(undefined, "Standard not found"); break;
  }
  return here ? `${here} · ${APP}` : APP;
}

/** Where an uploaded icon (of a tool or a language) is served. */
export const iconUrl = (id: string) => `/api/icons/${encodeURIComponent(id)}`;
/** Uploads an icon (the image's bytes as they are); the answer's `id` is what a tool or language names. */
export async function uploadIcon(file: Blob): Promise<{ id: string; contentType: string; width: number; height: number }> {
  let res: Response;
  try {
    res = await fetch("/api/icons", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-Requested-With": "process-manager" }, body: file });
  } catch {
    throw new ApiError(0, "The server cannot be reached. Is it running?");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) { window.dispatchEvent(new Event(SIGNED_OUT)); throw new ApiError(401, "You are signed out. Sign in again, then repeat what you were doing."); }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `The server answered ${res.status}.`);
  return data;
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
