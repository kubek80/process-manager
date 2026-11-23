import { describe, expect, it } from "vitest";
import { firstPublished, needsReview, quietReview, reviewInfo, reviewOf } from "../lifecycle";
import { reviewLine } from "../cardLines";
import { addMonths, dayOf, today } from "../dates";
import { savedMeta } from "../store";
import { responsibilities, urgent } from "../responsibilities";
import type { Perms } from "../../types";
import { base } from "./fixtures";

const TODAY = "2026-11-20";
// a moment at this time of the reader's own day (the tests run in any time zone: a first publication counts from the reader's day)
const localAt = (day: string, hour: number) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, hour).toISOString(); };
const never = (intervalMonths = 6) => ({ ...base(), review: { intervalMonths } });

describe("the reader's day", () => {
  it("counts the first review from the day the first publication fell on for the reader", () => {
    const since = "2026-05-20T23:30:00Z"; // the 21st in Auckland, the 20th in Los Angeles
    expect(reviewInfo(never(), TODAY, since).dueAt).toBe(addMonths(dayOf(since), 6));
  });
  it("uses a stored review date as written and today as the reader's day", () => {
    const r = reviewInfo({ ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-06-01" } });
    expect(r.dueAt).toBe("2026-12-01");
    expect(r).toEqual(reviewInfo({ ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-06-01" } }, today()));
  });
  it("is due a day later for a reader whose day has not yet turned", () => {
    const due = { ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-05-23" } }; // due 2026-11-23
    const at = new Date("2026-11-24T07:50:00Z"); // 23:50 on the 23rd in Los Angeles, the 24th in UTC and Auckland
    expect(reviewInfo(due, today(at, "America/Los_Angeles"))).toMatchObject({ state: "soon", days: 0 });
    expect(reviewInfo(due, today(at, "UTC"))).toMatchObject({ state: "overdue", days: -1 });
    expect(reviewInfo(due, today(at, "Pacific/Auckland"))).toMatchObject({ state: "overdue", days: -1 });
  });
});

describe("the first review", () => {
  it("is not overdue right after the first publication: it is due one interval later", () => {
    expect(reviewInfo(never(), TODAY, localAt("2026-11-20", 9))).toEqual({ state: "ok", dueAt: "2027-05-20", days: 181, label: "First review due 2027-05-20", first: true });
  });
  it("becomes due and overdue by the same rule as a reviewed one", () => {
    expect(reviewInfo(never(), TODAY, "2026-06-01")).toMatchObject({ state: "soon", dueAt: "2026-12-01", label: "First review due 2026-12-01", first: true });
    expect(reviewInfo(never(), TODAY, "2026-05-01")).toMatchObject({ state: "overdue", dueAt: "2026-11-01", label: "Review overdue since 2026-11-01", first: true });
    // the same dates for one reviewed on that day
    expect(reviewInfo({ ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-06-01" } }, TODAY)).toMatchObject({ state: "soon", label: "Review due 2026-12-01" });
  });
  it("counts from the last review once there is one, whatever the first publication", () => {
    const r = reviewInfo({ ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-10-01" } }, TODAY, "2020-01-01");
    expect(r).toMatchObject({ state: "ok", label: "Next review 2027-04-01" });
    expect(r.first).toBeUndefined();
  });
  it("is overdue when nobody knows when it was published", () => {
    expect(reviewInfo(never(), TODAY)).toEqual({ state: "overdue", label: "Never reviewed" });
    expect(reviewInfo(never(), TODAY, "")).toEqual({ state: "overdue", label: "Never reviewed" });
    expect(reviewInfo(never(), TODAY, "not a date")).toEqual({ state: "overdue", label: "Never reviewed" });
  });
  it("plans nothing for a draft", () => expect(reviewInfo({ ...never(), status: "draft" }, TODAY, "2020-01-01").state).toBe("none"));
});

describe("My responsibilities and the first review", () => {
  const perms: Perms = { admin: false, catalog: false, processes: false, standards: false, owns: ["cloud-platform-team"], platforms: [], practices: [], memberPlatforms: [], memberPractices: [] };
  const fresh = { ...base(), id: "fresh", title: "Fresh", review: { intervalMonths: 6 } };
  const old = { ...base(), id: "old", title: "Old", review: { intervalMonths: 6 } };
  const since = { process: { fresh: { createdAt: localAt("2026-11-19", 10) }, old: { createdAt: "2025-01-01T10:00:00Z" } } };
  it("asks for no review of something just published, and for one long unreviewed", () => {
    const { tasks, owned } = responsibilities(perms, null, [fresh, old], [], { process: {}, standard: {} }, TODAY, since);
    expect(tasks.map((t) => `${t.kind}:${t.item.doc.id}`)).toEqual(["review-overdue:old"]);
    expect(owned.find((o) => o.doc.id === "fresh")?.review.label).toBe("First review due 2027-05-19");
    expect(urgent(tasks)).toBe(1);
  });
  it("without the dates, both count as never reviewed", () => {
    const { tasks } = responsibilities(perms, null, [fresh, old], [], { process: {}, standard: {} }, TODAY);
    expect(tasks.map((t) => t.kind)).toEqual(["review-overdue", "review-overdue"]);
  });
});

describe("when the first review is counted from", () => {
  it("is when it was first published, not when its first draft was saved", () => {
    const meta = { createdAt: "2026-01-02T10:00:00Z", publishedAt: localAt("2026-11-20", 8) };
    expect(firstPublished(meta)).toBe(meta.publishedAt);
    expect(reviewOf(never(), meta, TODAY)).toMatchObject({ state: "ok", label: "First review due 2027-05-20", first: true });
    expect(needsReview(never(), meta, TODAY)).toBe(false);
    // counted from the first draft it would be overdue
    expect(needsReview(never(), { createdAt: meta.createdAt }, TODAY)).toBe(true);
  });
  it("falls back to the first save from an older server, and to never reviewed without either", () => {
    expect(firstPublished({ createdAt: "2026-11-19T10:00:00Z" })).toBe("2026-11-19T10:00:00Z");
    expect(firstPublished(undefined)).toBeUndefined();
    expect(reviewOf(never(), undefined, TODAY)).toEqual({ state: "overdue", label: "Never reviewed" });
  });
  it("is the same everywhere: the cards, My responsibilities and the top bar badge", () => {
    const doc = { ...base(), id: "fresh", title: "Fresh", review: { intervalMonths: 6 } };
    const meta = { createdAt: localAt("2025-01-01", 10), publishedAt: localAt("2026-11-20", 8) };
    expect(reviewLine(doc, TODAY, meta)).toBe("");
    expect(reviewLine(doc, TODAY, { createdAt: meta.createdAt })).toBe("Overdue since 2025-07-01");
    const perms: Perms = { admin: false, catalog: false, processes: false, standards: false, owns: ["cloud-platform-team"], platforms: [], practices: [], memberPlatforms: [], memberPractices: [] };
    const { tasks } = responsibilities(perms, null, [doc], [], { process: {}, standard: {} }, TODAY, { process: { fresh: meta } });
    expect(tasks).toEqual([]);
  });
});

describe("what the app knows after a save", () => {
  const before = { version: 1, updatedAt: "2026-11-01T10:00:00Z", updatedBy: "alex", createdAt: "2026-11-01T10:00:00Z" };
  it("a save that publishes for the first time is when it was first published", () => {
    expect(savedMeta(before, { version: 2, updatedAt: "2026-11-20T10:00:00Z", updatedBy: "alex" }, { status: "active" }))
      .toEqual({ version: 2, updatedAt: "2026-11-20T10:00:00Z", updatedBy: "alex", createdAt: "2026-11-01T10:00:00Z", publishedAt: "2026-11-20T10:00:00Z" });
  });
  it("a draft saved again is not published; a later save keeps the first publication", () => {
    expect(savedMeta(before, { version: 2, updatedAt: "2026-11-20T10:00:00Z", updatedBy: "alex" }, { status: "draft" }).publishedAt).toBeUndefined();
    const published = { ...before, publishedAt: "2026-11-05T10:00:00Z" };
    expect(savedMeta(published, { version: 3, updatedAt: "2026-11-20T10:00:00Z", updatedBy: "alex" }, {}).publishedAt).toBe("2026-11-05T10:00:00Z");
  });
  it("a new document saved straight as published", () => {
    expect(savedMeta(undefined, { version: 1, updatedAt: "2026-11-20T10:00:00Z", updatedBy: "alex" }, {}))
      .toMatchObject({ createdAt: "2026-11-20T10:00:00Z", publishedAt: "2026-11-20T10:00:00Z" });
  });
});

describe("the page's quiet line about the review", () => {
  it("says when it was last confirmed", () => {
    expect(quietReview(reviewInfo({ ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-10-01" } }, TODAY), "2026-10-01")).toBe("Reviewed 2026-10-01");
  });
  it("names the first review while it is not near", () => {
    expect(quietReview(reviewInfo(never(), TODAY, "2026-11-20"))).toBe("First review due 2027-05-20");
  });
  it("never says \"Never reviewed\" beside a mark that already says the review is due or overdue", () => {
    expect(quietReview(reviewInfo(never(), TODAY, "2026-06-01"))).toBe("Not reviewed yet");
    expect(quietReview(reviewInfo(never(), TODAY, "2026-05-01"))).toBe("Not reviewed yet");
    expect(quietReview(reviewInfo(never(), TODAY))).toBe("Not reviewed yet");
  });
});
