import type { Catalog, TargetKind } from "../types";

/** Use of processes and standards over a period, for admins (Admin > Statistics). */

export type Period = "7" | "30" | "90" | "365" | "all";
export const PERIODS: { id: Period; label: string }[] = [
  { id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }, { id: "365", label: "A year" }, { id: "all", label: "All time" },
];

export interface StatTotals { views: number; people: number; downloads: number; upvotes: number; feedbackOpened: number; feedbackHandled: number; requests: number;
  /** the part of views and downloads that belongs to processes and standards deleted since (not in the table) */
  deletedViews?: number; deletedDownloads?: number;
}
export interface StatRow {
  kind: TargetKind; id: string; title: string; status: string; owner: string; platform: string; practice: string; category: string;
  /** within the period */
  views: number; people: number; downloads: number; upvotes: number; feedbackHandled: number;
  /** as of now */
  upvotesTotal: number; feedbackOpen: number;
}
export interface StatGroup { id: string; name: string; documents: number; views: number; people: number; downloads: number; upvotes: number; feedbackHandled: number }
export type GroupBy = "platform" | "practice" | "team";
export interface StatWeek {
  week: string; views: number; people: number; downloads: number;
  /** how many days of this week (1-7) are inside the period; an older server leaves it out (a full week) */
  days?: number;
}
/** Whether only part of this week is inside the period. */
export const partialWeek = (w: StatWeek) => w.days !== undefined && w.days < 7;
export interface Statistics {
  period: string; from: string; to: string;
  totals: StatTotals;
  rows: StatRow[];
  groups?: Partial<Record<GroupBy, StatGroup[]>>;
  trend: StatWeek[];
}

export const csvHref = (period: Period) => `/api/admin/statistics.csv?period=${period}`;

// ---------- the table

export type SortKey = "title" | "views" | "people" | "downloads" | "upvotes" | "feedbackOpen" | "feedbackHandled";
export type SortDir = "asc" | "desc";

/** Sorted by one column; equal values keep a stable order by title. Numbers start with the largest. */
export function sortRows(rows: StatRow[], key: SortKey, dir: SortDir): StatRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const by = key === "title" ? a.title.localeCompare(b.title) : (a[key] ?? 0) - (b[key] ?? 0);
    return by * sign || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

/** The direction a column starts in when it is chosen: names A to Z, numbers the largest first. */
export const firstDir = (key: SortKey): SortDir => (key === "title" ? "asc" : "desc");

// ---------- totals by platform, practice or team

const NONE = "";
/** What the documents that belong to no platform, practice or team are called in the totals. */
export const NONE_LABEL: Record<GroupBy, string> = { platform: "No platform", practice: "No practice", team: "No owning team" };

/**
 * Totals per platform, practice or owning team. The server's groups are used when it sent them
 * (with names from the lists where it left one out); otherwise they are added up from the rows.
 * Documents that belong to none come last, as "No platform" (practice, owning team); the server
 * sends them as an entry with an empty id.
 */
export function groupTotals(stats: Pick<Statistics, "rows" | "groups">, by: GroupBy, catalog: Catalog): StatGroup[] {
  const list = by === "platform" ? catalog.platforms : by === "practice" ? catalog.practices : catalog.teams;
  const nameOf = (id: string) => (list ?? []).find((x) => x.id === id)?.name ?? id;
  let groups = stats.groups?.[by];
  if (!groups) {
    const sum = new Map<string, StatGroup>();
    for (const r of stats.rows) {
      const id = (by === "team" ? r.owner : r[by]) || NONE;
      const g = sum.get(id) ?? { id, name: "", documents: 0, views: 0, people: 0, downloads: 0, upvotes: 0, feedbackHandled: 0 };
      // "people" cannot be added up across documents (one person may have read several): the
      // largest is a lower bound, which is what is shown when the server does not count it
      g.documents++; g.views += r.views; g.people = Math.max(g.people, r.people); g.downloads += r.downloads; g.upvotes += r.upvotes; g.feedbackHandled += r.feedbackHandled;
      sum.set(id, g);
    }
    groups = [...sum.values()];
  }
  return groups.map((g) => ({ ...g, id: g.id || NONE, name: !g.id ? NONE_LABEL[by] : g.name || nameOf(g.id) }))
    .sort((a, b) => Number(!a.id) - Number(!b.id) || b.views - a.views || a.name.localeCompare(b.name));
}

// ---------- the trend chart

/**
 * The weeks from the first to the last, each one present: a week without any view is a zero,
 * not a gap that joins its neighbours. Weeks start on Monday (`YYYY-MM-DD`).
 */
export function fillWeeks(trend: StatWeek[]): StatWeek[] {
  if (trend.length < 2) return [...trend];
  const sorted = [...trend].sort((a, b) => a.week.localeCompare(b.week));
  const by = new Map(sorted.map((w) => [w.week, w]));
  const out: StatWeek[] = [];
  const end = Date.parse(`${sorted[sorted.length - 1].week}T00:00:00Z`);
  for (let t = Date.parse(`${sorted[0].week}T00:00:00Z`); t <= end && out.length < 600; t += 7 * 86400_000) {
    const week = new Date(t).toISOString().slice(0, 10);
    out.push(by.get(week) ?? { week, views: 0, people: 0, downloads: 0, days: 7 });
  }
  return out;
}

/** A round top for the axis and the lines across it: 0, a quarter, a half… of a round number. */
export function chartScale(max: number, lines = 4): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: lines, ticks: Array.from({ length: lines + 1 }, (_, i) => i) };
  const raw = max / lines;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 3, 4, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);
  const top = step * lines;
  return { top, ticks: Array.from({ length: lines + 1 }, (_, i) => i * step) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "9 Nov" for the week of 2026-11-09. */
export function weekLabel(week: string): string {
  const [, m, d] = week.split("-").map(Number);
  return m ? `${d} ${MONTHS[m - 1]}` : week;
}

/** Which week labels fit under the chart: every n-th, so they never run into each other. */
export function labelEvery(weeks: number, room = 9): number {
  return Math.max(1, Math.ceil(weeks / room));
}

/** A compact number for an axis: 1 200 -> "1.2k". */
export function short(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** "Week of 9 Nov", with the number of days when only part of it is inside the period. */
export function weekName(w: StatWeek): string {
  return `Week of ${weekLabel(w.week)}${partialWeek(w) ? `, ${w.days} ${w.days === 1 ? "day" : "days"}` : ""}`;
}

/**
 * The calm sentence that explains why the totals are higher than the table: views and downloads
 * of processes and standards that were deleted since. Empty when there are none.
 */
export function deletedNote(t: Pick<StatTotals, "deletedViews" | "deletedDownloads">): string {
  const v = t.deletedViews ?? 0, d = t.deletedDownloads ?? 0;
  if (!v && !d) return "";
  const parts = [v ? `${v.toLocaleString("en-GB")} ${v === 1 ? "view" : "views"}` : "", d ? `${d.toLocaleString("en-GB")} skill ${d === 1 ? "download" : "downloads"}` : ""].filter(Boolean);
  return `The totals include ${parts.join(" and ")} of processes and standards that were deleted since; the table below shows only those that still exist.`;
}
