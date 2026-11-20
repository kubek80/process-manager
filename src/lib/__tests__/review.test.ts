import { describe, expect, it } from "vitest";
import { reviewInfo } from "../lifecycle";
import { responsibilities, urgent } from "../responsibilities";
import type { Perms } from "../../types";
import { base } from "./fixtures";

const TODAY = "2026-11-20";
const never = (intervalMonths = 6) => ({ ...base(), review: { intervalMonths } });

describe("the first review", () => {
  it("is not overdue right after the first publication: it is due one interval later", () => {
    expect(reviewInfo(never(), TODAY, "2026-11-20T09:12:00Z")).toEqual({ state: "ok", dueAt: "2027-05-20", days: 181, label: "First review due 2027-05-20", first: true });
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
  const perms: Perms = { admin: false, catalog: false, processes: false, standards: false, owns: ["cloud-platform-team"], platforms: [], practices: [] };
  const fresh = { ...base(), id: "fresh", title: "Fresh", review: { intervalMonths: 6 } };
  const old = { ...base(), id: "old", title: "Old", review: { intervalMonths: 6 } };
  const since = { process: { fresh: { createdAt: "2026-11-19T10:00:00Z" }, old: { createdAt: "2025-01-01T10:00:00Z" } } };
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
