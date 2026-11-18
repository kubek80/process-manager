import { describe, expect, it } from "vitest";
import type { Catalog, Process, Standard } from "../../types";
import { DEFAULT_PAGE_SIZE, pageNumbers, pageOf, showingText, sizeOf } from "../paging";
import { cardLines, reviewLine, rigourLine, tiersText } from "../cardLines";

describe("pages of a list", () => {
  it("works out which items a page shows", () => {
    expect(pageOf(57, 2, 12)).toEqual({ page: 2, pages: 5, first: 13, last: 24, total: 57, start: 12, end: 24 });
    expect(pageOf(57, 5, 12)).toMatchObject({ first: 49, last: 57, start: 48, end: 57 });
  });
  it("shows the last page for a page past the end, and the first for nonsense", () => {
    expect(pageOf(10, 9, 4)).toMatchObject({ page: 3, first: 9, last: 10 });
    expect(pageOf(10, 0, 4).page).toBe(1);
    expect(pageOf(10, Number.NaN, 4).page).toBe(1);
  });
  it("has one empty page when there is nothing", () => {
    expect(pageOf(0, 3, 12)).toEqual({ page: 1, pages: 1, first: 0, last: 0, total: 0, start: 0, end: 0 });
  });
  it("offers the first, the last and the pages around the current one", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageNumbers(1, 10)).toEqual([1, 2, "gap", 10]);
    // a gap of one page shows that page instead
    expect(pageNumbers(4, 10)).toEqual([1, 2, 3, 4, 5, "gap", 10]);
    expect(pageNumbers(10, 10)).toEqual([1, "gap", 9, 10]);
  });
  it("says what is shown", () => {
    const noun = { one: "process", many: "processes" };
    expect(showingText(pageOf(57, 2, 12), noun)).toBe("Showing 13–24 of 57 processes");
    expect(showingText(pageOf(7, 1, 12), noun)).toBe("7 processes");
    expect(showingText(pageOf(1, 1, 12), noun)).toBe("1 process");
    expect(showingText(pageOf(0, 1, 12), noun)).toBe("No processes");
  });
  it("accepts only the page sizes it offers", () => {
    expect(sizeOf("48")).toBe(48);
    expect(sizeOf(13)).toBe(DEFAULT_PAGE_SIZE);
    expect(sizeOf(null)).toBe(DEFAULT_PAGE_SIZE);
  });
});

const catalog: Catalog = {
  tiers: [{ id: "t0", name: "Tier 0" }, { id: "t1", name: "Tier 1" }],
  environments: [{ id: "prod", name: "Production" }, { id: "staging", name: "Staging" }],
  languages: [{ id: "go", name: "Go" }],
  teams: [{ id: "cloud", name: "Cloud team" }], practices: [{ id: "eng", name: "Engineering" }], platforms: [{ id: "gcp", name: "Google Cloud" }],
  categories: [], tools: [],
};
const proc: Process = {
  schemaVersion: "1.0", id: "p", title: "P", summary: "", owner: "cloud", platform: "gcp", rigour: "mandatory", estimatedDuration: "2 days",
  environments: ["staging", "prod"], prerequisites: [], actors: [],
  steps: [
    { id: "a", title: "A", actor: "me", type: "task", next: [] },
    { id: "b", title: "B", actor: "them", type: "task", next: [] },
    { id: "c", title: "C", actor: "me", type: "task", next: [] },
  ],
};
const std: Standard = {
  schemaVersion: "1.0", id: "s", title: "S", summary: "", owner: "cloud", practice: "eng", languages: ["go"],
  review: { intervalMonths: 6, lastReviewedAt: "2026-01-01" },
  requirements: [
    { id: "R1", title: "r", level: "must", statement: "", verification: { method: "review" } },
    { id: "R2", title: "r", level: "should", statement: "", verification: { method: "review" } },
  ],
};
const lines = (l: ReturnType<typeof cardLines>) => l.map((x) => `${x.name}: ${x.value}`);

describe("the lines of a card", () => {
  it("for a process: one fact per line, in a fixed order, only what has something to say", () => {
    expect(lines(cardLines({ kind: "process", doc: proc, catalog, rigour: { mandatory: 1 }, rules: 0, mayEdit: false }))).toEqual([
      "Owner: Cloud team", "Platform: Google Cloud", "Rigour: Mandatory", "Environments: Staging, Production",
      "Lead time: 2 days", "Steps: 2 of 3 are yours",
    ]);
  });
  it("names how many processes use it as a sub-process", () => {
    expect(lines(cardLines({ kind: "process", doc: { ...proc, environments: undefined }, catalog, rigour: {}, rules: 0, mayEdit: false, usedBy: 2 })))
      .toContain("Used by: 2 processes");
  });
  it("for a standard: its rigour and requirements, those that apply to my application", () => {
    const base = { kind: "standard" as const, doc: std, catalog, mayEdit: false };
    expect(lines(cardLines({ ...base, rigour: { mandatory: 1, recommended: 1 }, rules: 2 }))).toEqual([
      "Owner: Cloud team", "Practice: Engineering", "Rigour: 1 mandatory, 1 recommended", "Languages: Go", "Requirements: 2",
    ]);
    expect(lines(cardLines({ ...base, rigour: { mandatory: 1 }, rules: 1 }))).toContain("Requirements: 1 of 2 apply to your application");
  });
  it("shows where the review stands only to those who may change it, and only when it is due", () => {
    const facts = { kind: "standard" as const, doc: std, catalog, rigour: {}, rules: 2 };
    expect(cardLines({ ...facts, mayEdit: false, today: "2026-11-17" }).some((l) => l.key === "review")).toBe(false);
    expect(cardLines({ ...facts, mayEdit: true, today: "2026-11-17" }).find((l) => l.key === "review")).toEqual({ key: "review", name: "Review", value: "Overdue since 2026-07-01", warn: true });
    expect(cardLines({ ...facts, mayEdit: true, today: "2026-03-01" }).some((l) => l.key === "review")).toBe(false);
    expect(reviewLine(std, "2026-06-20")).toBe("Due 2026-07-01");
  });
  it("puts the tiers in the corner: the names, or all of them", () => {
    expect(tiersText({ tiers: ["t0", "t1"] }, catalog)).toBe("Tier 0, Tier 1");
    expect(tiersText({}, catalog)).toBe("All tiers");
    expect(tiersText({ tiers: ["gone"] }, catalog)).toBe("gone");
  });
  it("describes the rigour", () => {
    expect(rigourLine("process", { recommended: 1 })).toBe("Recommended");
    expect(rigourLine("standard", { mandatory: 3, optional: 1 })).toBe("3 mandatory, 1 optional");
    expect(rigourLine("standard", {})).toBe("");
  });
  it("copes with a document stored without proper lists", () => {
    const odd = { ...proc, steps: "x" as unknown as Process["steps"], environments: "prod" as unknown as string[] };
    expect(lines(cardLines({ kind: "process", doc: odd, catalog, rigour: {}, rules: 0, mayEdit: false }))).toEqual(["Owner: Cloud team", "Platform: Google Cloud", "Lead time: 2 days"]);
  });
});

describe("what is remembered and what is known", () => {
  it("remembers the page of a list only in a form it can use", async () => {
    const { storedPage } = await import("../paging");
    expect(storedPage(JSON.stringify({ what: "[\"q\"]", page: 3 }))).toEqual({ what: "[\"q\"]", page: 3 });
    for (const bad of [null, "", "{", "3", JSON.stringify({ what: "x", page: 0 }), JSON.stringify({ what: "x", page: 1.5 }), JSON.stringify({ page: 2 })])
      expect(storedPage(bad)).toBeNull();
  });
  it("does not take bookmarks and upvotes for facts before they are in", async () => {
    const { bookmarksUnknown, engagementKnown } = await import("../known");
    expect(engagementKnown({ ready: false })).toBe(false);
    expect(engagementKnown({ ready: true, failed: true })).toBe(false);
    expect(engagementKnown({ ready: true })).toBe(true);
    expect(engagementKnown({ ready: true, known: false, failed: false })).toBe(false);
    expect(engagementKnown({ ready: true, known: true, failed: false })).toBe(true);
    expect(bookmarksUnknown({ ready: false })).toBe("loading your bookmarks…");
    expect(bookmarksUnknown({ ready: true, failed: true })).toBe("your bookmarks could not be loaded");
    expect(bookmarksUnknown({ ready: true })).toBeUndefined();
  });
});
