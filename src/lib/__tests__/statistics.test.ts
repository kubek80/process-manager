import { describe, expect, it } from "vitest";
import type { Catalog } from "../../types";
import { EMPTY_CATALOG } from "../catalog";
import { chartScale, csvHref, fillWeeks, groupTotals, labelEvery, short, sortRows, weekLabel, type StatRow } from "../statistics";

const row = (id: string, p: Partial<StatRow> = {}): StatRow => ({
  kind: "process", id, title: id, status: "active", owner: "", platform: "", practice: "", category: "",
  views: 0, people: 0, downloads: 0, upvotes: 0, feedbackHandled: 0, upvotesTotal: 0, feedbackOpen: 0, ...p,
});

describe("the table of statistics", () => {
  const rows = [row("b", { views: 5, people: 2 }), row("a", { views: 5, people: 4 }), row("c", { views: 9 })];
  it("sorts by a number, ties by name", () => {
    expect(sortRows(rows, "views", "desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortRows(rows, "views", "asc").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "people", "desc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts by name", () => {
    expect(sortRows(rows, "title", "asc").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "title", "desc").map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("downloads all of a period as a file", () => expect(csvHref("90")).toBe("/api/admin/statistics.csv?period=90"));
});

describe("totals by platform, practice or team", () => {
  const catalog: Catalog = { ...EMPTY_CATALOG, platforms: [{ id: "gcp", name: "Google Cloud" } as Catalog["platforms"][number]], teams: [{ id: "dns", name: "DNS team" } as Catalog["teams"][number]] };
  const rows = [row("a", { platform: "gcp", views: 3, people: 2, owner: "dns" }), row("b", { platform: "gcp", views: 4, people: 3 }), row("c", { views: 10, people: 1 })];
  it("are added up from the rows when the server sent none, with None last", () => {
    expect(groupTotals({ rows }, "platform", catalog)).toEqual([
      { id: "gcp", name: "Google Cloud", documents: 2, views: 7, people: 3, downloads: 0, upvotes: 0, feedbackHandled: 0 },
      { id: "", name: "None", documents: 1, views: 10, people: 1, downloads: 0, upvotes: 0, feedbackHandled: 0 },
    ]);
    expect(groupTotals({ rows }, "team", catalog).map((g) => g.name)).toEqual(["DNS team", "None"]);
  });
  it("use the server's groups, naming those it left without a name", () => {
    const groups = { platform: [{ id: "gcp", name: "", documents: 1, views: 1, people: 1, downloads: 0, upvotes: 0, feedbackHandled: 0 }, { id: "aws", name: "Amazon", documents: 1, views: 5, people: 1, downloads: 0, upvotes: 0, feedbackHandled: 0 }] };
    expect(groupTotals({ rows, groups }, "platform", catalog).map((g) => g.name)).toEqual(["Amazon", "Google Cloud"]);
  });
});

describe("the trend chart", () => {
  it("fills weeks without views with zeros", () => {
    const weeks = fillWeeks([{ week: "2026-11-09", views: 4, people: 2, downloads: 0 }, { week: "2026-10-26", views: 1, people: 1, downloads: 1 }]);
    expect(weeks.map((w) => [w.week, w.views])).toEqual([["2026-10-26", 1], ["2026-11-02", 0], ["2026-11-09", 4]]);
    expect(fillWeeks([])).toEqual([]);
    expect(fillWeeks([{ week: "2026-11-09", views: 1, people: 1, downloads: 0 }])).toHaveLength(1);
  });
  it("has a round top with whole numbers", () => {
    expect(chartScale(7)).toEqual({ top: 8, ticks: [0, 2, 4, 6, 8] });
    expect(chartScale(1)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
    expect(chartScale(0)).toEqual({ top: 4, ticks: [0, 1, 2, 3, 4] });
    expect(chartScale(130).top).toBe(160);
    expect(chartScale(1100).top).toBe(1200);
    for (const max of [3, 17, 99, 1234]) {
      const s = chartScale(max);
      expect(s.top).toBeGreaterThanOrEqual(max);
      expect(s.ticks.every(Number.isInteger)).toBe(true);
    }
  });
  it("labels readably", () => {
    expect(weekLabel("2026-11-09")).toBe("9 Nov");
    expect(labelEvery(52, 9)).toBe(6);
    expect(labelEvery(3, 9)).toBe(1);
    expect(short(950)).toBe("950");
    expect(short(1200)).toBe("1.2k");
    expect(short(25_000)).toBe("25k");
  });
});
