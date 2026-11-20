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
