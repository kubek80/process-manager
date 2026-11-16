import { useCallback, useEffect, useRef, useState } from "react";
import type { Assignment, AuditEntry, Catalog, DocMeta, DocVersion, Feedback, FeedbackByTarget, Me, Process, Role, Skill, SkillDetail, Standard, TargetKind } from "../types";
import type { Conflict } from "./draftState";

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

export const loadMe = () => call<Me>("GET", "/api/me");
export const devLogin = (email: string) => call<void>("POST", "/auth/dev/login", { email });
export const logout = () => call<void>("POST", "/auth/logout");

// Content: processes, standards and the lists live in the database. Every save is a new
// version; a save says which version it was made from (`base`) and is refused when somebody
// else saved in the meantime (ApiError.conflict).
export type MetaById = Record<string, DocMeta>;
const saveQuery = (base: number, note = "") => `?base=${base}${note.trim() ? `&note=${encodeURIComponent(note.trim())}` : ""}`;

export async function loadProcesses(): Promise<{ docs: Process[]; meta: MetaById }> {
  const r = await call<{ processes: Process[]; meta?: MetaById }>("GET", "/api/processes");
  return { docs: r.processes, meta: r.meta ?? {} };
}
export const putProcess = (p: Process, base: number, note?: string) => call<DocMeta>("PUT", `/api/processes/${p.id}${saveQuery(base, note)}`, p);
export const removeProcess = (id: string, base: number) => call<void>("DELETE", `/api/processes/${id}?base=${base}`);
export async function loadStandards(): Promise<{ docs: Standard[]; meta: MetaById }> {
  const r = await call<{ standards: Standard[]; meta?: MetaById }>("GET", "/api/standards");
  return { docs: r.standards, meta: r.meta ?? {} };
}
export const putStandard = (s: Standard, base: number, note?: string) => call<DocMeta>("PUT", `/api/standards/${s.id}${saveQuery(base, note)}`, s);
export const removeStandard = (id: string, base: number) => call<void>("DELETE", `/api/standards/${id}?base=${base}`);

/**
 * Records that a process or standard was reviewed and is still correct: today and the person's
 * name, as a version of its own. For the team or unit that owns it and for whoever may edit it.
 */
export const confirmReview = <T extends Process | Standard>(kind: TargetKind, id: string, base: number) =>
  call<DocMeta & { document: T }>("POST", `/api/${kind === "process" ? "processes" : "standards"}/${id}/review?base=${base}`);

export async function loadCatalog(): Promise<{ catalog: Catalog; version: number }> {
  const { data: c, headers } = await request<Partial<Catalog>>("GET", "/api/catalog");
  return {
    catalog: { ...c, tiers: c.tiers ?? [], environments: c.environments ?? [], languages: c.languages ?? [], teams: c.teams ?? [], tools: c.tools ?? [] },
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

// skills and review agents generated from processes and standards
export const loadSkills = async () => (await call<{ skills: Skill[] }>("GET", "/api/skills")).skills;
export const loadSkill = (id: string) => call<SkillDetail>("GET", `/api/skills/${id}`);
export const loadSkillVersion = async (id: string, version: number) => (await call<{ content: string }>("GET", `/api/skills/${id}/versions/${version}`)).content;
export const putSkillExtra = (id: string, extra: string) => call<SkillDetail>("PUT", `/api/skills/${id}/extra`, { extra });

// admin panel
export interface Access { assignments: Assignment[]; bootstrapAdmins: string[]; roles: Role[] }
export const loadAccess = () => call<Access>("GET", "/api/admin/access");
export const grantAccess = (a: { email: string; role: Role; scope: string }) => call<Access>("POST", "/api/admin/access", a);
export const revokeAccess = (a: { email: string; role: Role; scope: string }) => call<Access>("DELETE", "/api/admin/access", a);
/** A page of the activity log, newest first. `before` is the id of the last entry already shown. */
export const loadAudit = (limit = 100, before = 0) => call<{ entries: AuditEntry[]; more: boolean }>("GET", `/api/admin/audit?limit=${limit}${before ? `&before=${before}` : ""}`);
export interface SystemInfo { provider: string; baseUrl: string; notify: string; processes: number; standards: number; skills: number; assignments: number; openFeedback: number }
export const loadSystem = () => call<SystemInfo>("GET", "/api/admin/system");

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

export type Tab = "flow" | "list" | "feedback" | "skills" | "json";
export type StandardTab = "doc" | "feedback" | "skills" | "json";
export type AdminSection = "access" | "lists" | "skills" | "health" | "activity" | "system";
/** `item` is the step or the requirement that is open, so that a link can point at one. */
export type Route =
  | { page: "library" } | { page: "standards" } | { page: "catalog" } | { page: "guide" } | { page: "mine" }
  | { page: "admin"; section: AdminSection }
  | { page: "process"; id: string; tab: Tab; item?: string }
  | { page: "standard"; id: string; tab: StandardTab; item?: string };

const parse = (h: string = location.hash): Route => {
  if (h.startsWith("#/catalog")) return { page: "catalog" };
  if (h.startsWith("#/guide")) return { page: "guide" };
  if (h.startsWith("#/mine")) return { page: "mine" };
  if (h.startsWith("#/standards")) return { page: "standards" };
  const admin = h.match(/^#\/admin(?:\/(access|lists|skills|health|activity|system))?/);
  if (admin) return { page: "admin", section: (admin[1] as AdminSection) ?? "access" };
  const s = h.match(/^#\/s\/([a-z0-9-]+)(?:\/(doc|feedback|skills|json)(?:\/([A-Z][A-Z0-9-]*))?)?/);
  if (s) return { page: "standard", id: s[1], tab: (s[2] as StandardTab) ?? "doc", ...(s[3] ? { item: s[3] } : {}) };
  const m = h.match(/^#\/p\/([a-z0-9-]+)(?:\/(flow|list|feedback|skills|json)(?:\/([a-z0-9-]+))?)?/);
  return m ? { page: "process", id: m[1], tab: (m[2] as Tab) ?? "flow", ...(m[3] ? { item: m[3] } : {}) } : { page: "library" };
};
/** The route an address stands for; exported for tests. */
export const parseRoute = (hash: string): Route => parse(hash);

// ---------- unsaved work
// A page that has unsaved edits says so here. Leaving it then asks first: moving on inside the
// app (a link, Back, signing out) and closing or reloading the tab.

const unsaved = new Map<string, string>(); // what is being edited -> what to call it
/**
 * The places a route keeps open: leaving all places where something is edited is what loses
 * the edits. Text typed in the JSON tab lives only while that tab is open.
 */
const placesOf = (r: Route): string[] => {
  const doc = r.page === "process" ? `process/${r.id}` : r.page === "standard" ? `standard/${r.id}` : r.page === "admin" && r.section === "lists" ? "catalog" : null;
  if (!doc) return [];
  return (r.page === "process" || r.page === "standard") && r.tab === "json" ? [doc, `${doc}#json`] : [doc];
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
    case "library": return "#/";
    case "standards": return "#/standards";
    case "catalog": return "#/catalog";
    case "guide": return "#/guide";
    case "mine": return "#/mine";
    case "admin": return `#/admin/${r.section}`;
    case "standard": return `#/s/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
    case "process": return `#/p/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
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
    case "library": here = "Processes"; break;
    case "standards": here = "Standards"; break;
    case "catalog": here = "Teams & tools"; break;
    case "guide": here = "Guide"; break;
    case "mine": here = "My responsibilities"; break;
    case "admin": here = `${r.section.slice(0, 1).toUpperCase()}${r.section.slice(1)} · Admin`; break;
    case "process": here = of(names.process, "Process not found"); break;
    case "standard": here = of(names.standard, "Standard not found"); break;
  }
  return here ? `${here} · ${APP}` : APP;
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
