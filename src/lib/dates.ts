// One way to write dates and times everywhere in the app: a date as on the pages ("2026-11-13"),
// a moment as "2026-11-20 06:44" in the reader's own time. Only Home's "Recently updated" says
// "today" or "3 days ago".

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const parse = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---------- the reader's day
//
// A day ("2026-11-13") is a calendar day. A day stored in a document (the last review, `updatedAt`)
// is shown as written and never shifted. A moment (a timestamp) falls on the READER's day: in
// Auckland in the morning it is already tomorrow in the reader's terms, while it is still today in
// UTC. `zone` names a time zone ("Pacific/Auckland", "UTC"); left out, it is the reader's own (the
// browser's). The arithmetic on days below is done on calendar days and is the same in every zone.

const zoned = new Map<string, Intl.DateTimeFormat>();
const dayIn = (d: Date, zone?: string): string => {
  if (!zone) return localDay(d);
  let f = zoned.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    zoned.set(zone, f);
  }
  const parts = f.formatToParts(d);
  const part = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/** Today as a day ("2026-11-13") for the reader: `now` in `zone` (the browser's clock and zone by default). */
export function today(now: Date = new Date(), zone?: string): string {
  return dayIn(now, zone);
}

/**
 * The day something happened, for the reader: a day is kept as it is, a moment becomes the day it
 * fell on in `zone` (the reader's own by default). "" for nothing or nonsense.
 */
export function dayOf(value?: string | Date | null, zone?: string): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : dayIn(value, zone);
  if (value && DAY_ONLY.test(value)) return value;
  const d = parse(value);
  return d ? dayIn(d, zone) : "";
}

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000;
const fromNumber = (n: number): string => {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Whether a text is a real day in the form 2026-11-16 (not 2026-02-30). */
export function isDay(value: unknown): boolean {
  if (typeof value !== "string" || !DAY_ONLY.test(value)) return false;
  const n = dayNumber(value);
  return Number.isFinite(n) && fromNumber(n) === value;
}

/** How many days from one day to another: 1 from 2026-11-13 to 2026-11-14, negative backwards. NaN when either is not a day. */
export function daysBetween(from: string, to: string): number {
  return isDay(from) && isDay(to) ? Math.round(dayNumber(to) - dayNumber(from)) : NaN;
}

/** The day `n` days after `day` (before, when negative). */
export function addDays(day: string, n: number): string {
  return fromNumber(Math.round(dayNumber(day)) + n);
}

/** The day `n` months after `day`; past the end of a shorter month it runs on, as the calendar arithmetic of the format does (2026-01-31 + 1 month: 2026-03-03). */
export function addMonths(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromNumber(Math.round(d.getTime() / 86_400_000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A day in short words, "9 Nov" for 2026-11-09: for the axis of a chart. Anything else is returned as it is. */
export function formatShortDay(day: string): string {
  if (!isDay(day)) return day;
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "2026-11-13". A date without a time is kept as it is; a moment is the reader's own day. "" for nothing or nonsense. */
export function formatDate(value?: string | null): string {
  if (value && DAY_ONLY.test(value)) return value;
  const d = parse(value);
  return d ? localDay(d) : "";
}

/** "2026-11-20 06:44", in the reader's own time. A date without a time is just the date. "" for nothing or nonsense. */
export function formatDateTime(value?: string | null): string {
  if (value && DAY_ONLY.test(value)) return value;
  const d = parse(value);
  return d ? `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
}

/**
 * When the portal's counting day (midnight to midnight UTC) starts in the reader's own time, as
 * "01:00"; `offset` is `Date.getTimezoneOffset()` (minutes behind UTC). "" where it is midnight
 * there too.
 */
export function utcMidnightHere(offset: number): string {
  const minutes = ((-offset % 1440) + 1440) % 1440;
  return minutes === 0 ? "" : `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The counting day in the reader's terms: "A day is counted from 01:00 to 01:00 your time (midnight to midnight UTC)." */
export function countingDay(offset: number): string {
  const at = utcMidnightHere(offset);
  return at ? `A day is counted from ${at} to ${at} your time (midnight to midnight UTC).` : "A day is counted from midnight to midnight UTC, which is your time too.";
}
