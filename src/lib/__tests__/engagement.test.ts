import { describe, expect, it } from "vitest";
import { countsIn, EMPTY_ENGAGEMENT, mergeLoaded, NO_COUNTS, sortBookmarks, withBookmark, withUpvote, withViews, type Change } from "../engagement";
import type { EngagementData } from "../store";

const data: EngagementData = {
  counts: { process: { gcp: { views: 10, people: 4, downloads: 2, upvotes: 3, handled: 1 } }, standard: {} },
  mine: { bookmarks: [{ kind: "process", id: "gcp", at: "2026-11-01T10:00:00Z" }], upvotes: [] },
};

describe("engagement numbers", () => {
  it("treats a document with nothing yet as zeros", () => {
    expect(countsIn(EMPTY_ENGAGEMENT, "process", "nope")).toEqual(NO_COUNTS);
    expect(countsIn({ ...data, counts: { process: { x: { views: 2 } }, standard: {} } }, "process", "x")).toEqual({ ...NO_COUNTS, views: 2 });
    expect(countsIn(data, "process", "gcp").views).toBe(10);
  });

  it("an upvote counts once and can be taken back", () => {
    const on = withUpvote(data, "process", "gcp", true);
    expect(countsIn(on, "process", "gcp").upvotes).toBe(4);
    expect(on.mine.upvotes).toEqual([{ kind: "process", id: "gcp" }]);
    expect(countsIn(withUpvote(on, "process", "gcp", true), "process", "gcp").upvotes).toBe(4); // twice is once
    const off = withUpvote(on, "process", "gcp", false);
    expect(countsIn(off, "process", "gcp").upvotes).toBe(3);
    expect(off.mine.upvotes).toEqual([]);
    expect(countsIn(withUpvote(EMPTY_ENGAGEMENT, "standard", "s", false), "standard", "s").upvotes).toBe(0); // never below zero
    expect(countsIn(withUpvote(data, "process", "gcp", true, 9), "process", "gcp").upvotes).toBe(9); // the server's number wins
  });

  it("a bookmark is added newest first and removed again", () => {
    const on = withBookmark(data, "standard", "iac", true, "2026-11-10T00:00:00Z");
    expect(sortBookmarks(on.mine.bookmarks).map((b) => b.id)).toEqual(["iac", "gcp"]);
    expect(withBookmark(on, "process", "gcp", false).mine.bookmarks.map((b) => b.id)).toEqual(["iac"]);
    expect(withBookmark(data, "process", "gcp", true).mine.bookmarks).toHaveLength(1); // no duplicate
  });
});

describe("numbers that arrive while the person changes things", () => {
  const bookmark = (on: boolean, settled: number | null): Change => ({ key: "b:standard/iac", apply: (d) => withBookmark(d, "standard", "iac", on, "2026-11-18T00:00:00Z"), settled });

  it("an answer that set off before a click does not undo the click", () => {
    // load 1 started, then the person bookmarked (still on its way): the old answer lands without it
    const { data: d, keep } = mergeLoaded(data, [bookmark(true, null)], 1);
    expect(d.mine.bookmarks.map((b) => b.id)).toContain("iac");
    expect(keep).toHaveLength(1);
  });

  it("keeps a confirmed change over loads that started before the confirmation, and drops it after", () => {
    const c = bookmark(true, 3); // confirmed when load 3 was the last one started
    expect(mergeLoaded(data, [c], 3).data.mine.bookmarks.map((b) => b.id)).toContain("iac");
    const later = mergeLoaded(data, [c], 4); // load 4 started after: the server's answer is the truth
    expect(later.keep).toHaveLength(0);
    expect(later.data).toBe(data);
  });

  it("a taken-back upvote stays taken back although the old answer still has it", () => {
    const loaded = withUpvote(data, "process", "gcp", true); // the server still counted it: 4, mine
    const c: Change = { key: "u:process/gcp", apply: (d) => withUpvote(d, "process", "gcp", false), settled: null };
    const { data: d } = mergeLoaded(loaded, [c], 2);
    expect(countsIn(d, "process", "gcp").upvotes).toBe(3);
    expect(d.mine.upvotes).toEqual([]);
  });
});

describe("a recorded view", () => {
  it("sets that document's numbers from the server's answer and leaves the others alone", () => {
    const d = withViews(data, "standard", "iac", 1, 1);
    expect(countsIn(d, "standard", "iac")).toEqual({ ...NO_COUNTS, views: 1, people: 1 });
    expect(d.counts.process.gcp).toBe(data.counts.process.gcp);
  });
  it("never goes back below numbers that are already newer", () => {
    expect(countsIn(withViews(data, "process", "gcp", 8, 3), "process", "gcp")).toMatchObject({ views: 10, people: 4 });
    expect(countsIn(withViews(data, "process", "gcp", 11, 5), "process", "gcp")).toMatchObject({ views: 11, people: 5, upvotes: 3 });
  });
});
