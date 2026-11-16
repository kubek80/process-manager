import { useCallback, useEffect, useState } from "react";
import type { Assignment, AuditEntry, Catalog, DocVersion, Feedback, FeedbackByTarget, Me, Process, Role, Skill, SkillDetail, Standard, TargetKind } from "../types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** One place for every call to the server: JSON in and out, the CSRF header, readable errors. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // the session ended: start again from the sign-in screen
    if (res.status === 401 && path !== "/api/me") window.location.reload();
    throw new ApiError(res.status, data?.error ?? `The server answered ${res.status}.`);
  }
  return data as T;
}

export const loadMe = () => call<Me>("GET", "/api/me");
export const devLogin = (email: string) => call<void>("POST", "/auth/dev/login", { email });
export const logout = () => call<void>("POST", "/auth/logout");

// content: processes, standards and the lists live in the database; every save is a new revision
export const loadProcesses = async () => (await call<{ processes: Process[] }>("GET", "/api/processes")).processes;
export const putProcess = (p: Process) => call<void>("PUT", `/api/processes/${p.id}`, p);
export const removeProcess = (id: string) => call<void>("DELETE", `/api/processes/${id}`);
export const loadStandards = async () => (await call<{ standards: Standard[] }>("GET", "/api/standards")).standards;
export const putStandard = (s: Standard) => call<void>("PUT", `/api/standards/${s.id}`, s);
export const removeStandard = (id: string) => call<void>("DELETE", `/api/standards/${id}`);

export async function loadCatalog(): Promise<Catalog> {
  const c = await call<Partial<Catalog>>("GET", "/api/catalog");
  return { ...c, tiers: c.tiers ?? [], environments: c.environments ?? [], languages: c.languages ?? [], teams: c.teams ?? [], tools: c.tools ?? [] };
}
export const putCatalog = (c: Catalog) => call<void>("PUT", "/api/catalog", c);

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
export const loadAudit = async (limit = 100) => (await call<{ entries: AuditEntry[] }>("GET", `/api/admin/audit?limit=${limit}`)).entries;
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
export type Route =
  | { page: "library" } | { page: "standards" } | { page: "catalog" } | { page: "guide" }
  | { page: "admin"; section: AdminSection }
  | { page: "process"; id: string; tab: Tab }
  | { page: "standard"; id: string; tab: StandardTab };

const parse = (): Route => {
  const h = location.hash;
  if (h.startsWith("#/catalog")) return { page: "catalog" };
  if (h.startsWith("#/guide")) return { page: "guide" };
  if (h.startsWith("#/standards")) return { page: "standards" };
  const admin = h.match(/^#\/admin(?:\/(access|lists|skills|health|activity|system))?/);
  if (admin) return { page: "admin", section: (admin[1] as AdminSection) ?? "access" };
  const s = h.match(/^#\/s\/([a-z0-9-]+)(?:\/(doc|feedback|skills|json))?/);
  if (s) return { page: "standard", id: s[1], tab: (s[2] as StandardTab) ?? "doc" };
  const m = h.match(/^#\/p\/([a-z0-9-]+)(?:\/(flow|list|feedback|skills|json))?/);
  return m ? { page: "process", id: m[1], tab: (m[2] as Tab) ?? "flow" } : { page: "library" };
};

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
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
    case "standard": return `#/s/${r.id}/${r.tab}`;
    case "process": return `#/p/${r.id}/${r.tab}`;
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
