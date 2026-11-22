import type { Area, CodeCategory, CodeFile, Requirement } from "../codemap/types";
import { fold, wordsOf } from "./search";

/**
 * The logic of Admin › Code map (`CodeMapPage.tsx`): placing the requirements of a file on its
 * lines, where else a file is described, the search over the whole map, the counts of a
 * category, and the files before and after one. The categories are passed in, so that this
 * module stays small and testable; the page passes `CATEGORIES` of `src/codemap`.
 */

/** "12 files · 2 charts · 3 tables": what a category holds; parts with none are left out, files never. */
export function countLine(c: Pick<CodeCategory, "files" | "charts" | "tables">): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  return [n(c.files.length, "file"), c.charts.length ? n(c.charts.length, "chart") : "", c.tables?.length ? n(c.tables.length, "table") : ""].filter(Boolean).join(" · ");
}

/** The first sentence of a text: up to the first full stop followed by a space (or the end). */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^.*?[.!?](?=\s|$)/s);
  return m ? m[0] : t;
}

/** The categories of an area, in the order of the map. */
export const categoriesOf = (categories: CodeCategory[], area: Area) => categories.filter((c) => c.area === area);

/** The category with this id, if there is one. */
export const categoryById = (categories: CodeCategory[], id: string | undefined) => (id ? categories.find((c) => c.id === id) : undefined);

/** The file with this path in a category, if it is there. */
export const fileIn = (c: CodeCategory | undefined, path: string | undefined): CodeFile | undefined => (c && path ? c.files.find((f) => f.path === path) : undefined);

/** The other categories that describe the same file, in the order of the map. */
export function alsoIn(categories: CodeCategory[], path: string, except?: string): CodeCategory[] {
  return categories.filter((c) => c.id !== except && c.files.some((f) => f.path === path));
}

/**
 * Where a link to a file named somewhere in a category (a table's "created in", an example's
 * stage) opens it: in this category when the file is one of its own, else in the first category
 * that has it; nowhere when no category describes it.
 */
export function fileHome(categories: CodeCategory[], current: string | undefined, path: string): string | undefined {
  const here = categoryById(categories, current);
  if (here?.files.some((f) => f.path === path)) return here.id;
  return categories.find((c) => c.files.some((f) => f.path === path))?.id;
}

/** The files before and after one in its category, in the category's order. */
export function neighbours(c: CodeCategory, path: string): { prev?: CodeFile; next?: CodeFile; index: number } {
  const i = c.files.findIndex((f) => f.path === path);
  if (i < 0) return { index: -1 };
  return { prev: i > 0 ? c.files[i - 1] : undefined, next: i < c.files.length - 1 ? c.files[i + 1] : undefined, index: i };
}

/** The lines of a file's text; a last line break does not make an empty last line. */
export function linesOf(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Where the requirements of a file go on its text. */
export interface Placement {
  /** The requirements shown above a line, by the line's index (from 0), in the order they were written. */
  byLine: Map<number, Requirement[]>;
  /** The requirements without an anchor: shown at the top of the file. */
  top: Requirement[];
  /** The requirements whose anchor is in no line (the code moved): also shown at the top, marked as not placed. */
  lost: Requirement[];
}

/** Places each requirement with an anchor above the FIRST line that contains its text exactly. */
export function placeComments(lines: string[], requirements: Requirement[]): Placement {
  const byLine = new Map<number, Requirement[]>();
  const top: Requirement[] = [], lost: Requirement[] = [];
  for (const r of requirements) {
    if (r.at === undefined || !r.at.trim()) { top.push(r); continue; }
    const i = lines.findIndex((l) => l.includes(r.at!));
    if (i < 0) { lost.push(r); continue; }
    const at = byLine.get(i);
    if (at) at.push(r); else byLine.set(i, [r]);
  }
  return { byLine, top, lost };
}

/** The line numbers (from 1) that carry comments, in order. */
export const commentedLines = (p: Placement): number[] => [...p.byLine.keys()].sort((a, b) => a - b).map((i) => i + 1);

/** "3 comments in this file", "1 comment in this file". */
export const commentCount = (n: number) => `${n} ${n === 1 ? "comment" : "comments"} in this file`;

/** How a language writes a comment that fills a line: by the file's extension. */
function commentStyle(path: string): { line: string[]; block: boolean } {
  const base = path.split("/").pop() ?? "";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")).toLowerCase() : "";
  if (base === "Dockerfile" || [".sh", ".yml", ".yaml"].includes(ext)) return { line: ["#"], block: false };
  if (ext === ".sql") return { line: ["--"], block: true };
  if ([".go", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".mod"].includes(ext)) return { line: ext === ".css" ? [] : ["//"], block: true };
  if (ext === ".html" || ext === ".md") return { line: [], block: false };
  return { line: [], block: false };
}

/**
 * Which lines are nothing but a comment, so that the page can show them a little quieter. A
 * cheap guess, not a parser: a line that starts with the language's line comment, and the lines
 * of a block comment that starts at the beginning of a line. A comment marker inside a string
 * can fool it; that only changes a shade.
 */
export function commentLineFlags(path: string, lines: string[]): boolean[] {
  const style = commentStyle(path);
  const out: boolean[] = new Array(lines.length).fill(false);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (inBlock) {
      out[i] = true;
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (!t) continue;
    if (style.line.some((m) => t.startsWith(m))) { out[i] = true; continue; }
    if (style.block && t.startsWith("/*")) {
      out[i] = true;
      if (!t.slice(2).includes("*/")) inBlock = true;
    }
  }
  return out;
}

// ---------- the search over the whole map

/** One place the search found. `file` is set where the hit opens a file (a file, or one of its requirements). */
export interface MapHit {
  kind: "file" | "requirement" | "table";
  /** The text shown, in which the words are marked. */
  text: string;
  /** A second line: the role of a file, the file of a requirement, the purpose of a table. */
  detail?: string;
  /** The file the hit belongs to (a path). */
  file?: string;
  /** The table the hit belongs to (its name). */
  table?: string;
}
export interface MapResult { category: CodeCategory; hits: MapHit[] }

/** True when every word is in the text (folded: case and accents do not matter). */
const hasAll = (text: string, words: string[]) => { const t = fold(text); return words.every((w) => t.includes(w)); };

/**
 * Searches paths, roles, requirements and table names (with their purpose and columns) over the
 * whole map. A hit needs every word of the query in one place. Results are grouped by category,
 * in the map's order, and within one: files, then requirements, then tables.
 */
export function searchMap(categories: CodeCategory[], q: string): MapResult[] {
  const words = wordsOf(q);
  if (!words.length) return [];
  const out: MapResult[] = [];
  for (const c of categories) {
    const files: MapHit[] = [], reqs: MapHit[] = [], tables: MapHit[] = [];
    for (const r of c.requirements) if (hasAll(r, words)) reqs.push({ kind: "requirement", text: r, detail: c.title });
    for (const f of c.files) {
      if (hasAll(`${f.path} ${f.role}`, words)) files.push({ kind: "file", text: f.path, detail: f.role, file: f.path });
      for (const r of f.requirements) if (hasAll(r.text, words)) reqs.push({ kind: "requirement", text: r.text, detail: f.path, file: f.path });
    }
    for (const t of c.tables ?? []) {
      const columns = t.columns.map((col) => col.name).join(" ");
      if (hasAll(`${t.name} ${t.purpose} ${columns}`, words)) tables.push({ kind: "table", text: t.name, detail: t.purpose, table: t.name });
    }
    const hits = [...files, ...reqs, ...tables];
    if (hits.length) out.push({ category: c, hits });
  }
  return out;
}

/** The number of hits over all categories. */
export const hitCount = (results: MapResult[]) => results.reduce((n, r) => n + r.hits.length, 0);

/** The id a table's block has on its category's page, so that a hit can jump to it. */
export const tableAnchor = (name: string) => `code-table-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/**
 * The parts of a text of the map: what the writers put between backticks (`docs.Store.Save`) is
 * code; a backtick without its pair stays as it was written.
 */
export function inlineParts(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [];
  let rest = text;
  for (;;) {
    const a = rest.indexOf("`");
    const b = a < 0 ? -1 : rest.indexOf("`", a + 1);
    if (a < 0 || b < 0 || b === a + 1) {
      if (rest) out.push({ code: false, text: rest });
      return out;
    }
    if (a > 0) out.push({ code: false, text: rest.slice(0, a) });
    out.push({ code: true, text: rest.slice(a + 1, b) });
    rest = rest.slice(b + 1);
  }
}
