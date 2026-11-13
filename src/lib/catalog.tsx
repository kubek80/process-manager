import { createContext, useContext } from "react";
import type { Catalog } from "../types";

export const EMPTY_CATALOG: Catalog = { tiers: [], teams: [], tools: [] };

export interface CatalogApi {
  catalog: Catalog;
  /** Persist a changed catalog (used by the catalog page and by "add new…" pickers). */
  save: (c: Catalog) => Promise<void>;
}

export const CatalogContext = createContext<CatalogApi>({ catalog: EMPTY_CATALOG, save: async () => {} });
export const useCatalog = () => useContext(CatalogContext);

const nameOf = (list: { id: string; name: string }[], id?: string) => (id ? list.find((x) => x.id === id)?.name ?? id : "");
export const toolName = (c: Catalog, id?: string) => nameOf(c.tools, id);
export const teamName = (c: Catalog, id?: string) => nameOf(c.teams, id);
export const tierLabel = (c: Catalog, tiers?: string[]) =>
  !tiers?.length ? "All tiers" : tiers.map((t) => nameOf(c.tiers, t)).join(", ");
