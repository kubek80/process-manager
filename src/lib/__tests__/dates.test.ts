import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "../dates";

describe("dates", () => {
  // a moment is written in the reader's own time: the expectations are worked out in the same time zone
  it("keeps a plain date as it is", () => {
    expect(formatDate("2026-11-13")).toBe("2026-11-13");
    expect(formatDateTime("2026-11-13")).toBe("2026-11-13");
  });
  it("writes a moment as date and time, without seconds", () => {
    const at = "2026-11-20T06:44:31.123Z";
    const d = new Date(at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(formatDate(at)).toBe(day);
    expect(formatDateTime(at)).toBe(`${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    expect(formatDateTime(at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it("pads single digits", () => {
    const d = new Date(2026, 0, 5, 7, 3);
    expect(formatDateTime(d.toISOString())).toBe("2026-01-05 07:03");
    expect(formatDate(d.toISOString())).toBe("2026-01-05");
  });
  it("says nothing for nothing or nonsense", () => {
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("not a date")).toBe("");
  });
});
