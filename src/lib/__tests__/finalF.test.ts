import { describe, expect, it } from "vitest";
import { reviewLine, reviewMarkText, reviewOverdue, tiersShort, TIERS_MAX } from "../cardLines";
import { noWordsText, otherWay } from "../meaning";
import { base } from "./fixtures";

const catalog = { tiers: [{ id: "t0", name: "Tier 0" }, { id: "t1", name: "Tier 1" }, { id: "t2", name: "Tier 2" }, { id: "long", name: "Business critical systems" }] } as never;

describe("the tiers in the corner of a card stay on one line", () => {
  it("names them while short, counts them when long, and keeps the full list", () => {
    expect(tiersShort({}, catalog)).toEqual({ short: "All tiers", full: "All tiers" });
    expect(tiersShort({ tiers: ["t0", "t1"] }, catalog)).toEqual({ short: "Tier 0, Tier 1", full: "Tier 0, Tier 1" });
    expect(tiersShort({ tiers: ["t0", "t1", "t2"] }, catalog)).toEqual({ short: "3 tiers", full: "Tier 0, Tier 1, Tier 2" });
    // one tier is never "1 tiers": its name, however long (the corner cuts it with its tooltip)
    expect(tiersShort({ tiers: ["long"] }, catalog).short).toBe("Business critical systems");
    expect(tiersShort({ tiers: ["t0", "long"] }, catalog).short).toBe("2 tiers");
    expect("Tier 0, Tier 1".length).toBeLessThanOrEqual(TIERS_MAX);
  });
});

describe("the review mark on a card says what the page says", () => {
  const TODAY = "2026-11-20";
  const never = { ...base(), review: { intervalMonths: 6 } };
  it("a first review that is due reads “First review due …”", () => {
    const line = reviewLine(never, TODAY, { publishedAt: "2026-06-01T10:00:00Z" });
    expect(line).toBe("First review due 2026-12-01");
    expect(reviewMarkText(line)).toBe("First review due 2026-12-01");
    expect(reviewOverdue(line)).toBe(false);
  });
  it("a later review that is due, and any overdue review, read as before", () => {
    const due = reviewLine({ ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-06-01" } }, TODAY);
    expect(reviewMarkText(due)).toBe("Review due 2026-12-01");
    expect(reviewOverdue(due)).toBe(false);
    const late = reviewLine(never, TODAY, { publishedAt: "2026-05-01T10:00:00Z" });
    expect(reviewMarkText(late)).toBe("Review overdue since 2026-11-01");
    expect(reviewOverdue(late)).toBe(true);
    expect(reviewOverdue("Never reviewed")).toBe(true);
    expect(reviewMarkText("Never reviewed")).toBe("Never reviewed");
  });
});

describe("a word search that finds nothing is never a dead end", () => {
  it("says when nothing comes close by meaning either", () => {
    expect(noWordsText("buy a laptop", 3, "nothing")).toBe("Nothing matches “buy a laptop”, and nothing comes close by meaning either. Try fewer or other words.");
    expect(noWordsText("laptop", 1, "nothing")).toContain("Try another word.");
    expect(noWordsText("buy a laptop", 3, "not-tried")).toBe("Nothing matches “buy a laptop”. Every word must be found, so try fewer words.");
    expect(noWordsText("laptop", 1, "problem")).toContain("search by meaning is not available right now");
  });
  it("offers the closest by meaning only before it was looked for, never the same search again", () => {
    const o = { offered: true, q: "buy a laptop", show: "words" as const, mode: "words" as const, filtered: false };
    expect(otherWay({ ...o, closest: "not-tried" })).toBe("closest");
    expect(otherWay({ ...o, closest: "nothing" })).toBeNull();
    expect(otherWay({ ...o, closest: "problem" })).toBeNull();
    // with filters chosen the closest is not looked for: a search by meaning with them is another search
    expect(otherWay({ ...o, filtered: true, closest: "not-tried" })).toBe("meaning");
    expect(otherWay({ ...o, show: "meaning", mode: "meaning", closest: "not-tried" })).toBe("words");
    expect(otherWay({ ...o, mode: "both", show: "both", closest: "not-tried" })).toBeNull();
    expect(otherWay({ ...o, offered: false, closest: "not-tried" })).toBeNull();
    expect(otherWay({ ...o, q: " ", closest: "not-tried" })).toBeNull();
  });
});
