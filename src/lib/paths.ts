import type { PathEntry, PathSymbol, TargetKind } from "../types";

/**
 * The paths a process or standard can be for (greenfield, brownfield, paved path, and any an
 * organisation adds): a list like the tiers. A document names zero or more (`"paths"`); none
 * means it applies whatever the path. The pictures are drawn by `PathMark` (components/marks.tsx).
 */

/**
 * Other words people use for a path, by its picture, so that searching for them finds what is on
 * that path: "golden path" finds what is on the paved path. The server's chunk text says the same
 * (`pathAlso` in server/internal/chunking).
 */
export const PATH_ALSO: Partial<Record<PathSymbol, string[]>> = {
  road: ["golden path", "paved road"],
  sprout: ["green field"],
  buildings: ["brown field"],
};

/** The words a path is found by: its name and the other words for its picture. */
export function pathWords(entry: Pick<PathEntry, "name" | "symbol">): string[] {
  return [entry.name, ...(entry.symbol ? PATH_ALSO[entry.symbol] ?? [] : [])].filter(Boolean);
}

/**
 * The entries a document names, in the order of the list; an id that is not in the list (any
 * more) as an entry of its own under its id, after the others. Anything that is not a list of
 * ids gives none.
 */
export function pathsOf(list: PathEntry[] | undefined, ids: unknown): PathEntry[] {
  const want = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string" && x !== "");
  if (!want.length) return [];
  const known = (list ?? []).filter((e) => want.includes(e.id));
  const unknown = want.filter((id, i) => want.indexOf(id) === i && !(list ?? []).some((e) => e.id === id)).map((id) => ({ id, name: id }));
  return [...known, ...unknown];
}

/** "This process is for Greenfield and Paved path." / "This standard applies whatever the path." */
export function pathsSentence(kind: TargetKind, entries: Pick<PathEntry, "name">[]): string {
  const subject = kind === "process" ? "This process" : "This standard";
  if (!entries.length) return `${subject} applies whatever the path.`;
  const names = entries.map((e) => e.name);
  const said = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${subject} is for ${said}.`;
}
