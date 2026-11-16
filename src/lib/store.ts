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
  | { page: "library" } | { page: "standards" } | { page: "catalog" } | { page: "guide" }
  | { page: "admin"; section: AdminSection }
  | { page: "process"; id: string; tab: Tab; item?: string }
  | { page: "standard"; id: string; tab: StandardTab; item?: string };

const parse = (h: string = location.hash): Route => {
  if (h.startsWith("#/catalog")) return { page: "catalog" };
  if (h.startsWith("#/guide")) return { page: "guide" };
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
// A page that has unsaved edits says so here. Moving on inside the app (a link, Back, signing
// out) then asks first, the same way the browser asks before closing the tab.

const unsaved = new Map<string, string>(); // what is being edited -> what to call it
/** Where the thing with this key is edited: leaving that place is what loses the edits. */
const placeOf = (r: Route): string | null =>
  r.page === "process" ? `process/${r.id}` : r.page === "standard" ? `standard/${r.id}` : r.page === "admin" && r.section === "lists" ? "catalog" : null;

/** Marks something as having unsaved edits until the returned function is called. */
export function guardLeaving(key: string, what: string): () => void {
  unsaved.set(key, what);
  return () => { unsaved.delete(key); };
}
/** What would be lost by going to `to` (or by leaving the app when `to` is missing), if anything. */
export function unsavedWork(to?: Route): string | null {
  const staying = to ? placeOf(to) : null;
  for (const [key, what] of unsaved) if (key !== staying) return what;
  return null;
}

/**
 * The current route. `confirmLeave` is asked before a move that would lose unsaved edits; when
 * it says no, the address is put back and the page stays.
 */
export function useRoute(confirmLeave?: (what: string) => Promise<boolean>): Route {
  const [route, setRoute] = useState<Route>(() => parse());
  const ask = useRef(confirmLeave);
  ask.current = confirmLeave;
  useEffect(() => {
    let shown = location.hash; // the address of what is on screen
    let allowed: string | null = null; // an address the person agreed to move to
    const on = async () => {
      const target = location.hash;
      const lost = target === allowed ? null : unsavedWork(parse(target));
      allowed = null;
      if (!lost || !ask.current) { shown = target; setRoute(parse(target)); return; }
      history.replaceState(null, "", shown || "#/"); // stay where we are while asking
      if (await ask.current(lost)) { allowed = target; location.hash = target; }
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const href = (r: Route): string => {
  switch (r.page) {
    case "library": return "#/";
    case "standards": return "#/standards";
    case "catalog": return "#/catalog";
    case "guide": return "#/guide";
    case "admin": return `#/admin/${r.section}`;
    case "standard": return `#/s/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
    case "process": return `#/p/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
  }
};
export const go = (r: Route) => { location.hash = href(r); };

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
