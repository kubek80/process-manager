import type { Catalog, Process, Service } from "../types";
import { plainOfHtml } from "./richText";

/**
 * Services: what a team does for others on request, found and read in the place Services
 * (`#/services`, `#/service/:id`), requested through its front-door form, and requested by a step
 * of a process (a step of the kind "service"). The pure parts of those pages live here.
 */

/** The words of a service's button: its own, else "Request this service" (the server's `docs.DefaultFormLabel`). */
export const DEFAULT_FORM_LABEL = "Request this service";
export const formWords = (s: Pick<Service, "formLabel">) => (s.formLabel?.trim() ? s.formLabel.trim() : DEFAULT_FORM_LABEL);

/** A service of the lists; undefined for an id the lists do not have. */
export const serviceOf = (c: Pick<Catalog, "services">, id: string | undefined): Service | undefined =>
  id ? (c.services ?? []).find((s) => s.id === id) : undefined;

/** The services a team performs, by name. */
export const servicesOfTeam = (c: Pick<Catalog, "services">, team: string): Service[] =>
  (c.services ?? []).filter((s) => s.team === team).sort((a, b) => a.name.localeCompare(b.name));

/** The words a service is found by: its name, summary, the team that performs it and the words of its description. */
export function serviceWords(c: Pick<Catalog, "teams">, s: Service): string {
  const team = c.teams.find((t) => t.id === s.team)?.name ?? s.team ?? "";
  return `${s.name} ${s.summary ?? ""} ${team} ${plainOfHtml(s.description)}`.toLowerCase();
}

/**
 * The services the list shows: every word searched for is found (in any order), of the team
 * chosen if one is; by name.
 */
export function findServices(c: Pick<Catalog, "teams" | "services">, q: string | undefined, team?: string): Service[] {
  const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return (c.services ?? [])
    .filter((s) => !team || s.team === team)
    .filter((s) => { const text = serviceWords(c, s); return words.every((w) => text.includes(w)); })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The teams that perform at least one service, by name: the choice of team on the list (shown once there are two or more). */
export function serviceTeams(c: Pick<Catalog, "teams" | "services">): { id: string; name: string; count: number }[] {
  const count = new Map<string, number>();
  for (const s of c.services ?? []) if (s.team) count.set(s.team, (count.get(s.team) ?? 0) + 1);
  return [...count].map(([id, n]) => ({ id, name: c.teams.find((t) => t.id === id)?.name ?? id, count: n })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where a service is used: the published processes (retired ones too, marked as such) with the
 * steps that request it. Never a draft: what is not published is not shown here, even to those who
 * may see it elsewhere.
 */
export function serviceUses(processes: Process[], id: string): { process: Process; steps: { id: string; title: string; number: number }[]; retired: boolean }[] {
  return processes
    .filter((p) => (p.status ?? "active") !== "draft" && Array.isArray(p.steps))
    .map((p) => ({
      process: p,
      retired: p.status === "deprecated",
      steps: p.steps.map((s, i) => ({ s, i })).filter(({ s }) => s && s.service === id).map(({ s, i }) => ({ id: s.id, title: s.title, number: i + 1 })),
    }))
    .filter((u) => u.steps.length > 0)
    .sort((a, b) => Number(a.retired) - Number(b.retired) || a.process.title.localeCompare(b.process.title));
}
