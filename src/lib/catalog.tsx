import { createContext, useContext } from "react";
import type { Catalog } from "../types";
import type { GroupKind } from "./members";

export const EMPTY_CATALOG: Catalog = { tiers: [], environments: [], languages: [], teams: [], practices: [], platforms: [], categories: [], tools: [] };

/** The lists with every list present: one that is missing (an older file, an older server) is empty. */
export const completeCatalog = (c: Partial<Catalog> | null | undefined): Catalog => ({
  ...c,
  tiers: c?.tiers ?? [], environments: c?.environments ?? [], languages: c?.languages ?? [],
  teams: c?.teams ?? [], practices: c?.practices ?? [], platforms: c?.platforms ?? [], categories: c?.categories ?? [],
  tools: c?.tools ?? [],
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
/** The name of a team, a platform or a practice. */
export const groupName = (c: Catalog, kind: GroupKind, id?: string) =>
  kind === "team" ? teamName(c, id) : kind === "platform" ? platformName(c, id) : practiceName(c, id);
export const languageLabel = (c: Catalog, langs?: string[]) =>
  !langs?.length ? "Any language" : langs.map((l) => nameOf(c.languages, l)).join(", ");
export const environmentLabel = (c: Catalog, envs?: string[]) =>
  !envs?.length ? "All environments" : envs.map((e) => nameOf(c.environments, e)).join(", ");
export const tierLabel = (c: Catalog, tiers?: string[]) =>
  !tiers?.length ? "All tiers" : tiers.map((t) => nameOf(c.tiers, t)).join(", ");
