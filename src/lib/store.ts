import { useCallback, useEffect, useState } from "react";
import type { Catalog, Feedback, Me, Process } from "../types";

export interface Loaded { processes: Process[]; broken: { file: string; error: string }[] }

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

export const loadProcesses = () => call<Loaded>("GET", "/api/processes");
export const putProcess = (p: Process) => call<void>("PUT", `/api/processes/${p.id}`, p);
export const removeProcess = (id: string) => call<void>("DELETE", `/api/processes/${id}`);

export async function loadCatalog(): Promise<Catalog> {
  const c = await call<Partial<Catalog>>("GET", "/api/catalog");
  return { ...c, tiers: c.tiers ?? [], languages: c.languages ?? [], teams: c.teams ?? [], tools: c.tools ?? [] };
}
export const putCatalog = (c: Catalog) => call<void>("PUT", "/api/catalog", c);

export const loadFeedback = () => call<Record<string, Feedback[]>>("GET", "/api/feedback");
export const createFeedback = (f: { processId: string; stepId?: string; kind: string; text: string }) => call<Feedback>("POST", "/api/feedback", f);
export const setAlsoHit = (id: string, on: boolean) => call<Feedback>(on ? "POST" : "DELETE", `/api/feedback/${id}/also-hit`);
export const setResolved = (id: string, resolved: boolean) => call<Feedback>("PATCH", `/api/feedback/${id}`, { resolved });
export const deleteFeedback = (id: string) => call<void>("DELETE", `/api/feedback/${id}`);

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

export type Tab = "flow" | "list" | "feedback" | "json";
export type Route = { page: "library" } | { page: "catalog" } | { page: "guide" } | { page: "process"; id: string; tab: Tab };

const parse = (): Route => {
  if (location.hash.startsWith("#/catalog")) return { page: "catalog" };
  if (location.hash.startsWith("#/guide")) return { page: "guide" };
  const m = location.hash.match(/^#\/p\/([a-z0-9-]+)(?:\/(flow|list|feedback|json))?/);
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

export const go = (r: Route) => { location.hash = r.page === "library" ? "#/" : r.page === "catalog" ? "#/catalog" : r.page === "guide" ? "#/guide" : `#/p/${r.id}/${r.tab}`; };

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
