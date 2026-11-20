import type { Governed, Status } from "../types";

export type ReviewState = "none" | "ok" | "soon" | "overdue";
export interface ReviewInfo {
  state: ReviewState; dueAt?: string; days?: number; label: string;
  /** Never reviewed yet: the first review is counted from when it was first published. */
  first?: boolean;
}

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

/** Within this many days a review is "due"; after its date it is "overdue". */
export const DUE_DAYS = 30;

/**
 * When must the owner next confirm that the process or standard is still correct? Counted from
 * its last review; one that was never reviewed counts from `since`, when it was first published
 * (`firstPublished(meta[id])`: `meta[id].publishedAt`, from an older server `createdAt`). Its first review is
 * then due, and overdue, by the same rule as every later one. Without `since` nobody knows how
 * long it has gone unreviewed, so it is overdue.
 */
export function reviewInfo(p: Pick<Governed, "status" | "review">, today = new Date().toISOString().slice(0, 10), since?: string): ReviewInfo {
  if (!p.review || statusOf(p) !== "active") return { state: "none", label: "No review planned" };
  const last = p.review.lastReviewedAt;
  const start = since ? since.slice(0, 10) : "";
  if (!last && !isDate(start)) return { state: "overdue", label: "Never reviewed" };
  // a date that cannot be read (stored from outside the app) must not take the page down:
  // nobody knows when it was reviewed, so it is due
  if (last && !isDate(last)) return { state: "overdue", label: "Review date cannot be read" };
  const first = !last;
  const dueAt = addMonths(last || start, p.review.intervalMonths);
  const days = Math.round((Date.parse(dueAt) - Date.parse(today)) / 86400000);
  const extra = first ? { first } : {};
  if (days < 0) return { state: "overdue", dueAt, days, label: `Review overdue since ${dueAt}`, ...extra };
  if (days <= DUE_DAYS) return { state: "soon", dueAt, days, label: first ? `First review due ${dueAt}` : `Review due ${dueAt}`, ...extra };
  return { state: "ok", dueAt, days, label: first ? `First review due ${dueAt}` : `Next review ${dueAt}`, ...extra };
}

/**
 * The review in the page's quiet line (under the facts): when it was last confirmed, the date of
 * the first review while that is not near, and otherwise "Not reviewed yet" - a review that is due
 * or overdue is already a mark at the top, which says when.
 */
export function quietReview(review: ReviewInfo, lastReviewedAt?: string): string {
  if (lastReviewedAt) return `Reviewed ${lastReviewedAt}`;
  if (review.first && review.state === "ok") return review.label;
  return "Not reviewed yet";
}

/** What the lists say about when a document came about (`DocMeta`). */
export interface Dates { publishedAt?: string; createdAt?: string }

/**
 * When readers could first see it, where a first review is counted from: `publishedAt` from the
 * server; an older server sends only `createdAt`, when its first version was saved.
 */
export const firstPublished = (m?: Dates): string | undefined => m?.publishedAt || m?.createdAt || undefined;

/** `reviewInfo` with the first review counted from when it was first published. Every page decides "needs a review" with this. */
export const reviewOf = (p: Pick<Governed, "status" | "review">, meta?: Dates, today?: string): ReviewInfo =>
  reviewInfo(p, today, firstPublished(meta));

/** Whether its owner should confirm it soon, or should have already. */
export const needsReview = (p: Pick<Governed, "status" | "review">, meta?: Dates, today?: string): boolean =>
  ["overdue", "soon"].includes(reviewOf(p, meta, today).state);

/** A name as it is stored with a review: the format allows 60 characters. */
export function reviewer(name?: string): string {
  const chars = [...(name ?? "").trim()];
  return chars.length > 60 ? `${chars.slice(0, 59).join("")}…` : chars.join("");
}

export const STATUS_LABEL: Record<Status, string> = { draft: "Draft", active: "Active", deprecated: "Retired" };
