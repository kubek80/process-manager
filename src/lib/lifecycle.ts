import type { Governed, Status } from "../types";

export type ReviewState = "none" | "ok" | "soon" | "overdue";
export interface ReviewInfo { state: ReviewState; dueAt?: string; days?: number; label: string }

export const statusOf = (p: Pick<Governed, "status">): Status => p.status ?? "active";

/** Whether a text is a real day in the form 2026-11-16 (the format only checks what it looks like). */
export function isDate(iso: unknown): boolean {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** When must the owner next confirm that the process is still correct? */
export function reviewInfo(p: Pick<Governed, "status" | "review">, today = new Date().toISOString().slice(0, 10)): ReviewInfo {
  if (!p.review || statusOf(p) !== "active") return { state: "none", label: "No review planned" };
  if (!p.review.lastReviewedAt) return { state: "overdue", label: "Never reviewed" };
  // a date that cannot be read (stored from outside the app) must not take the page down:
  // nobody knows when it was reviewed, so it is due
  if (!isDate(p.review.lastReviewedAt)) return { state: "overdue", label: "Review date cannot be read" };
  const dueAt = addMonths(p.review.lastReviewedAt, p.review.intervalMonths);
  const days = Math.round((Date.parse(dueAt) - Date.parse(today)) / 86400000);
  if (days < 0) return { state: "overdue", dueAt, days, label: `Review overdue since ${dueAt}` };
  if (days <= 30) return { state: "soon", dueAt, days, label: `Review due ${dueAt}` };
  return { state: "ok", dueAt, days, label: `Next review ${dueAt}` };
}

/** A name as it is stored with a review: the format allows 60 characters. */
export function reviewer(name?: string): string {
  const chars = [...(name ?? "").trim()];
  return chars.length > 60 ? `${chars.slice(0, 59).join("")}…` : chars.join("");
}

export const STATUS_LABEL: Record<Status, string> = { draft: "Draft", active: "Active", deprecated: "Retired" };
