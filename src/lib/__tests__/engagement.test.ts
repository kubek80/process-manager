import { describe, expect, it } from "vitest";
import { countsIn, EMPTY_ENGAGEMENT, NO_COUNTS, sortBookmarks, withBookmark, withUpvote } from "../engagement";
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
