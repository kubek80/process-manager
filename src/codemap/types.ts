import type { Process } from "../types";

/**
 * The code map (Admin › Code map): the portal's own source, sorted into categories for whoever
 * reviews it. Every category says what that part must do (its requirements), shows how it works
 * in flow charts, lists its files with what each must do, and, where it stores something, the
 * tables. The files themselves are read from the server (`GET /api/admin/source`), only where
 * the portal runs beside its source code.
 *
 * This is the one place of the app written for developers: implementation terms are right here.
 * `src/codemap/__tests__/codemap.test.ts` keeps it true: every path exists, every anchor is in
 * its file, and every source file is in at least one category.
 */

/** The four groups the categories are shown in. */
export type Area = "data" | "server" | "app" | "around";

/**
 * Something the code must do or must never do, shown as a comment. With `at`, it is shown
 * inside the file, above the first line that contains that exact text (a function's signature,
 * a constant's name): choose text that stays when the lines around it move.
 */
export type Requirement = { text: string; at?: string };

/** One source file in a category. The same file may be in several categories, with other words. */
export type CodeFile = {
  /** From the root of the repository, with forward slashes: "server/internal/docs/store.go". */
  path: string;
  /** What the file is for, in one sentence. */
  role: string;
  /** What it must do or keep true, as far as this category is concerned. */
  requirements: Requirement[];
  /** The tests that cover it, as paths. */
  tests?: string[];
};

export type TableColumn = { name: string; type: string; note?: string };

/** One table of the database, as a reviewer needs it. */
export type CodeTable = {
  name: string;
  /** What a row is. */
  purpose: string;
  columns: TableColumn[];
  /** The primary key, what refers to what, the indexes and checks worth knowing. */
  keys?: string[];
  /** The migration file, or the Go file, that creates it (a path). */
  createdIn: string;
  /** The files that write it (paths). */
  writtenBy: string[];
  /** The files that read it, where that is not obvious (paths). */
  readBy?: string[];
  /** What must stay true of its rows. */
  rules?: string[];
};

/** The same piece of data at each stage of a journey: a document as a row, as parts, as vectors. */
export type CodeExample = {
  title: string;
  /** What the example shows, in a sentence. */
  caption: string;
  stages: {
    /** "Stored in the table documents", "Cut into parts". */
    label: string;
    /** The file where this stage happens (a path). */
    where?: string;
    /** What the data looks like here: JSON, SQL or text, shown as written. Short enough to read. */
    shape: string;
    /** What changed from the stage before. */
    note?: string;
  }[];
};

/** A flow chart: a process drawn by the map, as in the Guide (`flow` and `s` of `src/codemap/chart.ts`). */
export type CodeChart = { process: Process; caption: string };

export type CodeCategory = {
  /** Used in the address: `#/admin/code/{id}`. Lower case, digits and hyphens. */
  id: string;
  area: Area;
  title: string;
  /** What this part of the portal does, in two or three sentences. */
  summary: string;
  /** What the whole part must do or must never do: the reviewer's checklist. */
  requirements: string[];
  charts: CodeChart[];
  tables?: CodeTable[];
  examples?: CodeExample[];
  files: CodeFile[];
  /** The file to read first (a path that is in `files`). */
  start?: string;
};
