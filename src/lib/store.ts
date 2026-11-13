import { useCallback, useEffect, useState } from "react";
import type { Catalog, Feedback, Process } from "../types";

export interface Loaded { processes: Process[]; broken: { file: string; error: string }[] }

export async function loadProcesses(): Promise<Loaded> {
  const res = await fetch("/api/processes");
  if (!res.ok) throw new Error(`Could not load processes (${res.status})`);
  return res.json();
}

export async function putProcess(p: Process): Promise<void> {
  const res = await fetch(`/api/processes/${p.id}`, { method: "PUT", body: JSON.stringify(p) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Save failed (${res.status})`);
}

export async function removeProcess(id: string): Promise<void> {
  await fetch(`/api/processes/${id}`, { method: "DELETE" });
}

export async function loadCatalog(): Promise<Catalog> {
  const c = await (await fetch("/api/catalog")).json();
  return { ...c, tiers: c.tiers ?? [], languages: c.languages ?? [], teams: c.teams ?? [], tools: c.tools ?? [] };
}
export async function putCatalog(c: Catalog): Promise<void> {
  const res = await fetch("/api/catalog", { method: "PUT", body: JSON.stringify(c) });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
}
export async function loadFeedback(): Promise<Record<string, Feedback[]>> {
  return (await fetch("/api/feedback")).json();
}
export async function putFeedback(processId: string, list: Feedback[]): Promise<void> {
  const res = await fetch(`/api/feedback/${processId}`, { method: "PUT", body: JSON.stringify(list) });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
}

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
