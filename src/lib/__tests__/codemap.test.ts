import { describe, expect, it } from "vitest";
import type { CodeCategory } from "../../codemap/types";
import {
  alsoIn, categoriesOf, commentCount, commentLineFlags, commentedLines, countLine, fileHome, fileIn, firstSentence, hitCount,
  inlineParts, linesOf, neighbours, placeComments, searchMap, tableAnchor,
} from "../codemap";

// made-up categories: the logic must not depend on what the real map holds at the moment
const cat = (id: string, over: Partial<CodeCategory> = {}): CodeCategory => ({
  id, area: "data", title: id.toUpperCase(), summary: "A summary that is long enough to say something. And a second sentence.",
  requirements: [], charts: [], files: [], ...over,
});
const saving = cat("saving", {
  requirements: ["A save made from an outdated version is refused with 409."],
  files: [
    { path: "server/internal/docs/store.go", role: "Saves versions.", requirements: [{ text: "Refuses an outdated save.", at: "func (s *Store) Save(" }] },
    { path: "server/internal/docs/drafts.go", role: "Working drafts.", requirements: [] },
    { path: "src/lib/draft.ts", role: "useDraft in the app.", requirements: [] },
  ],
  tables: [{ name: "documents", purpose: "One row per document.", columns: [{ name: "body", type: "jsonb" }], createdIn: "server/internal/db/migrations/0001_init.sql", writtenBy: ["server/internal/docs/store.go"] }],
  charts: [{ process: { schemaVersion: "1.0", id: "code-x", title: "x", summary: "", prerequisites: [], actors: [], steps: [] }, caption: "c" }],
});
const vectors = cat("vectors", {
  files: [{ path: "server/internal/docs/store.go", role: "Calls the index after a save.", requirements: [{ text: "Never indexes a draft." }] }],
  tables: [{ name: "pm_index.parts", purpose: "Vectors of the parts.", columns: [{ name: "embedding", type: "vector(768)" }], createdIn: "server/internal/retrieval/index.go", writtenBy: ["server/internal/retrieval/index.go"] }],
});
const look = cat("look", { area: "app", files: [{ path: "src/styles.css", role: "The tokens.", requirements: [] }] });
const all = [saving, vectors, look];

describe("the code map's counts and words", () => {
  it("counts files always and charts and tables only where there are some", () => {
    expect(countLine(saving)).toBe("3 files · 1 chart · 1 table");
    expect(countLine(look)).toBe("1 file");
    expect(countLine(cat("x", { files: [], charts: [saving.charts[0], saving.charts[0]] }))).toBe("0 files · 2 charts");
  });
  it("takes the first sentence of a summary", () => {
    expect(firstSentence("It saves. Then it indexes.")).toBe("It saves.");
    expect(firstSentence("Reads docs.Store.Save and more. Next.")).toBe("Reads docs.Store.Save and more.");
    expect(firstSentence("No full stop")).toBe("No full stop");
    expect(firstSentence("")).toBe("");
  });
  it("says how many comments a file has", () => {
    expect(commentCount(1)).toBe("1 comment in this file");
    expect(commentCount(3)).toBe("3 comments in this file");
  });
});

describe("where a file is", () => {
  it("finds the categories of an area and a file in a category", () => {
    expect(categoriesOf(all, "data").map((c) => c.id)).toEqual(["saving", "vectors"]);
    expect(fileIn(saving, "src/lib/draft.ts")?.role).toBe("useDraft in the app.");
    expect(fileIn(saving, "src/styles.css")).toBeUndefined();
    expect(fileIn(undefined, "src/styles.css")).toBeUndefined();
  });
  it("lists the other categories that describe the same file, in the map's order", () => {
    expect(alsoIn(all, "server/internal/docs/store.go", "saving").map((c) => c.id)).toEqual(["vectors"]);
    expect(alsoIn(all, "server/internal/docs/store.go", "vectors").map((c) => c.id)).toEqual(["saving"]);
    expect(alsoIn(all, "src/styles.css", "look")).toEqual([]);
  });
  it("opens a named file in this category when it is one of its own, else where it is described", () => {
    expect(fileHome(all, "vectors", "server/internal/docs/store.go")).toBe("vectors");
    expect(fileHome(all, "look", "server/internal/docs/store.go")).toBe("saving");
    expect(fileHome(all, "saving", "server/internal/retrieval/index.go")).toBeUndefined();
  });
  it("gives the files before and after one", () => {
    expect(neighbours(saving, "server/internal/docs/store.go")).toMatchObject({ prev: undefined, next: { path: "server/internal/docs/drafts.go" }, index: 0 });
    expect(neighbours(saving, "server/internal/docs/drafts.go")).toMatchObject({ prev: { path: "server/internal/docs/store.go" }, next: { path: "src/lib/draft.ts" }, index: 1 });
    expect(neighbours(saving, "src/lib/draft.ts").next).toBeUndefined();
    expect(neighbours(saving, "nowhere.go")).toEqual({ index: -1 });
  });
});

describe("comments on the lines of a file", () => {
  const text = "package docs\n\n// Save stores a version.\nfunc (s *Store) Save(ctx context.Context) error {\n\treturn nil\n}\nfunc (s *Store) Save(again)\n";
  const lines = linesOf(text);
  it("splits a text into lines without an empty last one", () => {
    expect(lines).toHaveLength(7);
    expect(linesOf("a\r\nb")).toEqual(["a", "b"]);
    expect(linesOf("")).toEqual([""]);
  });
  it("places a requirement above the FIRST line that contains its anchor, in the order they were written", () => {
    const p = placeComments(lines, [
      { text: "one", at: "func (s *Store) Save(" },
      { text: "two", at: "func (s *Store) Save(" },
      { text: "top" },
      { text: "blank anchor", at: "  " },
      { text: "moved", at: "func (s *Store) Gone(" },
      { text: "package", at: "package docs" },
    ]);
    expect([...p.byLine.entries()].map(([i, rs]) => [i, rs.map((r) => r.text)])).toEqual([[3, ["one", "two"]], [0, ["package"]]]);
    expect(p.top.map((r) => r.text)).toEqual(["top", "blank anchor"]);
    expect(p.lost.map((r) => r.text)).toEqual(["moved"]);
    expect(commentedLines(p)).toEqual([1, 4]);
  });
  it("keeps up with a file of thousands of lines", () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const started = performance.now();
    const p = placeComments(big, Array.from({ length: 50 }, (_, i) => ({ text: `r${i}`, at: `line ${i * 99}` })));
    commentLineFlags("big.go", big);
    expect(p.byLine.size).toBe(50);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("comment lines of the source, shown quieter", () => {
  it("knows line and block comments of Go and TypeScript", () => {
    expect(commentLineFlags("a.go", ["// one", "x := 1 // not the whole line", "/* block", " * inside", " */", "y := 2", "/* one line */"])).toEqual([true, false, true, true, true, false, true]);
  });
  it("knows the hash of shell, YAML and the Dockerfile, and SQL's two dashes", () => {
    expect(commentLineFlags("deploy/run.sh", ["# hi", "echo"])).toEqual([true, false]);
    expect(commentLineFlags(".github/workflows/ci.yml", ["  # step", "on: push"])).toEqual([true, false]);
    expect(commentLineFlags("Dockerfile", ["# build", "FROM x"])).toEqual([true, false]);
    expect(commentLineFlags("server/internal/db/migrations/0001_init.sql", ["-- table", "create table x ();"])).toEqual([true, false]);
  });
  it("marks nothing in CSS line comments, JSON or Markdown", () => {
    expect(commentLineFlags("a.css", ["/* tokens */", "// not css", "a {}"])).toEqual([true, false, false]);
    expect(commentLineFlags("package.json", ["// x"])).toEqual([false]);
    expect(commentLineFlags("README.md", ["# Title"])).toEqual([false]);
  });
});

describe("the search over the map", () => {
  it("finds paths, roles, requirements and tables, grouped by category in the map's order", () => {
    const r = searchMap(all, "store");
    expect(r.map((x) => x.category.id)).toEqual(["saving", "vectors"]);
    expect(r[0].hits.map((h) => [h.kind, h.text])).toEqual([["file", "server/internal/docs/store.go"]]);
  });
  it("needs every word in one place; case and accents do not matter", () => {
    expect(hitCount(searchMap(all, "OUTDATED save"))).toBe(2); // the category's requirement and the file's
    expect(searchMap(all, "outdated vector")).toEqual([]);
    expect(searchMap(all, "  ")).toEqual([]);
    expect(hitCount(searchMap(all, "réfuses"))).toBe(1);
  });
  it("finds a table by its name, its purpose or a column, and says which one", () => {
    const r = searchMap(all, "embedding");
    expect(r).toHaveLength(1);
    expect(r[0].hits).toEqual([{ kind: "table", text: "pm_index.parts", detail: "Vectors of the parts.", table: "pm_index.parts" }]);
  });
  it("points a file's requirement at its file, a category's at the category", () => {
    const hits = searchMap(all, "outdated")[0].hits;
    const own = hits.find((h) => h.detail === "SAVING");
    expect(own?.kind).toBe("requirement");
    expect(own?.file).toBeUndefined();
    expect(hits.find((h) => h.file)).toMatchObject({ kind: "requirement", file: "server/internal/docs/store.go" });
  });
  it("gives a table an anchor of plain characters", () => {
    expect(tableAnchor("pm_index.parts")).toBe("code-table-pm-index-parts");
    expect(tableAnchor("Documents")).toBe("code-table-documents");
  });
});

describe("text of the map", () => {
  it("shows what is between backticks as code", () => {
    expect(inlineParts("Calls `syncIndex` after `Save`.")).toEqual([
      { code: false, text: "Calls " }, { code: true, text: "syncIndex" }, { code: false, text: " after " }, { code: true, text: "Save" }, { code: false, text: "." },
    ]);
    expect(inlineParts("`a`")).toEqual([{ code: true, text: "a" }]);
    expect(inlineParts("one ` alone")).toEqual([{ code: false, text: "one ` alone" }]);
    expect(inlineParts("empty `` pair")).toEqual([{ code: false, text: "empty `` pair" }]);
    expect(inlineParts("")).toEqual([]);
  });
});
