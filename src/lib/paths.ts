import type { PathEntry, TargetKind } from "../types";

/**
 * The paths a process or standard can be for (greenfield, brownfield, paved path, and any an
 * organisation adds): a list like the tiers. A document names zero or more (`"paths"`), and names
 * one only when it is meant only for that kind of work; none means it applies whatever the path.
 * The pictures are drawn by `PathMark` (components/marks.tsx).
 */

/** The other names of a path as the entry gives them ("golden path"), trimmed, without empty ones. */
export const otherNames = (entry: Pick<PathEntry, "alsoCalled">): string[] =>
  (Array.isArray(entry.alsoCalled) ? entry.alsoCalled : []).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);

/**
 * The words a path is found by: its name and its other names, so that searching for "golden path"
 * finds what is for the paved path. The server's chunk text says the same (`docs.PathNames`).
 */
export function pathWords(entry: Pick<PathEntry, "name" | "alsoCalled">): string[] {
  return [entry.name, ...otherNames(entry)].filter(Boolean);
}

/** A path with its other names, for a tooltip: "Paved path, also called golden path or paved road". */
export function pathTitle(entry: Pick<PathEntry, "name" | "alsoCalled">): string {
  const also = otherNames(entry);
  if (!also.length) return entry.name;
  const said = also.length === 1 ? also[0] : `${also.slice(0, -1).join(", ")} or ${also[also.length - 1]}`;
  return `${entry.name}, also called ${said}`;
}

/**
 * Other names that two entries claim, or that are another entry's name, whatever their case: a
 * search or an agent could not tell which is meant. One sentence each, naming both. The paths and
 * the architecture patterns have other names; `noun` names the list ("path" by default).
 */
export function otherNameClashes(entries: Pick<PathEntry, "id" | "name" | "alsoCalled">[] | undefined, noun: { one: string; many: string } = { one: "path", many: "paths" }): { index: number; message: string }[] {
  const out: { index: number; message: string }[] = [];
  const list = entries ?? [];
  const key = (s: string) => s.trim().toLowerCase();
  list.forEach((e, i) => {
    for (const also of otherNames(e)) {
      const other = list.findIndex((x, j) => j !== i && (key(x.name ?? "") === key(also) || (j < i && otherNames(x).some((y) => key(y) === key(also)))));
      if (other < 0) continue;
      const o = list[other];
      out.push({
        index: i,
        message: key(o.name ?? "") === key(also)
          ? `The ${noun.one} “${e.name}” is also called “${also}”, which is the name of the ${noun.one} “${o.name}”: take it off “${e.name}”.`
          : `The ${noun.many} “${o.name}” and “${e.name}” are both also called “${also}”: keep it on one of them.`,
      });
    }
  });
  return out;
}

/**
 * The entries a document names, in the order of the list; an id that is not in the list (any
 * more) as an entry of its own under its id, after the others. Anything that is not a list of
 * ids gives none.
 */
export function pathsOf<T extends { id: string; name: string } = PathEntry>(list: T[] | undefined, ids: unknown): T[] {
  const want = (Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === "string" && x !== "");
  if (!want.length) return [];
  const known = (list ?? []).filter((e) => want.includes(e.id));
  const unknown = want.filter((id, i) => want.indexOf(id) === i && !(list ?? []).some((e) => e.id === id)).map((id) => ({ id, name: id }) as T);
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
