import type { Process, Status } from "../types";

export type ReviewState = "none" | "ok" | "soon" | "overdue";
export interface ReviewInfo { state: ReviewState; dueAt?: string; days?: number; label: string }

export const statusOf = (p: Process): Status => p.status ?? "active";

const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** When must the owner next confirm that the process is still correct? */
export function reviewInfo(p: Process, today = new Date().toISOString().slice(0, 10)): ReviewInfo {
  if (!p.review || statusOf(p) !== "active") return { state: "none", label: "No review planned" };
  if (!p.review.lastReviewedAt) return { state: "overdue", label: "Never reviewed" };
  const dueAt = addMonths(p.review.lastReviewedAt, p.review.intervalMonths);
  const days = Math.round((Date.parse(dueAt) - Date.parse(today)) / 86400000);
  if (days < 0) return { state: "overdue", dueAt, days, label: `Review overdue since ${dueAt}` };
  if (days <= 30) return { state: "soon", dueAt, days, label: `Review due ${dueAt}` };
  return { state: "ok", dueAt, days, label: `Next review ${dueAt}` };
}

export const STATUS_LABEL: Record<Status, string> = { draft: "Draft", active: "Active", deprecated: "Retired" };
