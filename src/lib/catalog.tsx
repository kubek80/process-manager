import { createContext, useContext } from "react";
import type { Catalog } from "../types";
import type { GroupKind } from "./members";

export const EMPTY_CATALOG: Catalog = { tiers: [], environments: [], languages: [], teams: [], practices: [], platforms: [], categories: [], tools: [], paths: [], patterns: [], pillars: [], tribes: [], domains: [] };

/** The lists with every list present: one that is missing (an older file, an older server) is empty. */
export const completeCatalog = (c: Partial<Catalog> | null | undefined): Catalog => ({
  ...c,
  tiers: c?.tiers ?? [], environments: c?.environments ?? [], languages: c?.languages ?? [],
  teams: c?.teams ?? [], practices: c?.practices ?? [], platforms: c?.platforms ?? [], categories: c?.categories ?? [],
  tools: c?.tools ?? [], paths: c?.paths ?? [], patterns: c?.patterns ?? [], pillars: c?.pillars ?? [], tribes: c?.tribes ?? [], domains: c?.domains ?? [],
});

export interface CatalogApi {
  catalog: Catalog;
  /** The version of the lists that `catalog` is. */
  version: number;
  /**
   * Saves changed lists on top of version `base` (default: the version shown) and returns the
   * new version. Used by the lists editor and by "add new…" pickers. Rejects with an ApiError;
   * its `conflict` is set when somebody else changed the lists in the meantime.
   */
  save: (c: Catalog, base?: number, note?: string) => Promise<number>;
  /** Fetches the lists as the server has them now. */
  reload: () => Promise<{ saved: Catalog; version: number }>;
}

export const CatalogContext = createContext<CatalogApi>({
  catalog: EMPTY_CATALOG, version: 0, save: async () => 0, reload: async () => ({ saved: EMPTY_CATALOG, version: 0 }),
});
export const useCatalog = () => useContext(CatalogContext);

const nameOf = (list: { id: string; name: string }[], id?: string) => (id ? list.find((x) => x.id === id)?.name ?? id : "");
export const toolName = (c: Catalog, id?: string) => nameOf(c.tools, id);
export const teamName = (c: Catalog, id?: string) => nameOf(c.teams, id);
export const practiceName = (c: Catalog, id?: string) => nameOf(c.practices ?? [], id);
export const platformName = (c: Catalog, id?: string) => nameOf(c.platforms ?? [], id);
export const categoryName = (c: Catalog, id?: string) => nameOf(c.categories ?? [], id);
/**
 * The category and the team that looks after a process or standard, as the head of its page says
 * it: "Cloud · Owned by Cloud Platform team", "Security · Issued by Cyber Security". Empty when
 * neither is set.
 */
export const ownedBy = (c: Catalog, kind: "process" | "standard", doc: { category?: string; owner?: string }) =>
  [doc.category ? categoryName(c, doc.category) : "", doc.owner ? `${kind === "process" ? "Owned by" : "Issued by"} ${teamName(c, doc.owner)}` : ""].filter(Boolean).join(" · ");
/** The name of a team, a platform or a practice. */
export const groupName = (c: Catalog, kind: GroupKind, id?: string) =>
  kind === "team" ? teamName(c, id) : kind === "platform" ? platformName(c, id) : practiceName(c, id);
export const languageLabel = (c: Catalog, langs?: string[]) =>
  !langs?.length ? "Any language" : langs.map((l) => nameOf(c.languages, l)).join(", ");
export const environmentLabel = (c: Catalog, envs?: string[]) =>
  !envs?.length ? "All environments" : envs.map((e) => nameOf(c.environments, e)).join(", ");
export const tierLabel = (c: Catalog, tiers?: string[]) =>
  !tiers?.length ? "All tiers" : tiers.map((t) => nameOf(c.tiers, t)).join(", ");
/** The paths a process or standard is for, in words: "Greenfield, Paved path", or "Any path" when it names none. */
export const pathLabel = (c: Pick<Catalog, "paths">, paths?: string[]) =>
  !paths?.length ? "Any path" : paths.map((p) => nameOf(c.paths ?? [], p)).join(", ");

/** "1 process", "2 processes and 1 standard", "3 standards"; "" for none. */
export function docCount(processes: number, standards: number): string {
  const parts: string[] = [];
  if (processes) parts.push(`${processes} process${processes === 1 ? "" : "es"}`);
  if (standards) parts.push(`${standards} standard${standards === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/** Whether an entry of the lists can be removed, and if not, why. */
export function removeHint(usedBy: string, members: number, noun: string): string {
  const why: string[] = [];
  if (usedBy) why.push(`still used by ${usedBy}`);
  // a team has Owners only; a platform and a practice have owners and members
  const roles = noun === "team" ? "its Owners" : "its owners or members";
  if (members) why.push(`${members} ${members === 1 ? `person is still one of ${roles}` : `people are still ${roles}`}`);
  if (!why.length) return "Nothing uses it, so it is safe to remove.";
  const first = why.join(", and ");
  return `${first[0].toUpperCase()}${first.slice(1)}. ${usedBy ? "Change those first" : "Take their roles first"}${usedBy && members ? " and take their roles" : ""}, then it can be removed.`;
}
