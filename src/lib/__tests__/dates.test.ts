import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDays, addMonths, dayOf, daysBetween, formatDate, formatDateTime, formatShortDay, isDay, today } from "../dates";

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

// just before and just after midnight UTC, the reader's day differs from the UTC day both ways
const BEFORE = new Date("2026-11-23T23:50:00Z"); // Auckland (UTC+13): 12:50 on the 24th; Los Angeles (UTC-8): 15:50 on the 23rd
const AFTER = new Date("2026-11-24T00:10:00Z"); // Auckland: 13:10 on the 24th; Los Angeles: 16:10 on the 23rd
const EVENING = new Date("2026-11-24T07:50:00Z"); // Los Angeles: 23:50 on the 23rd
const MORNING = new Date("2026-11-23T11:10:00Z"); // Auckland: 00:10 on the 24th

describe("the reader's day", () => {
  it("today is the day where the reader is", () => {
    expect(today(BEFORE, "UTC")).toBe("2026-11-23");
    expect(today(AFTER, "UTC")).toBe("2026-11-24");
    expect(today(BEFORE, "Pacific/Auckland")).toBe("2026-11-24");
    expect(today(AFTER, "Pacific/Auckland")).toBe("2026-11-24");
    expect(today(BEFORE, "America/Los_Angeles")).toBe("2026-11-23");
    expect(today(AFTER, "America/Los_Angeles")).toBe("2026-11-23");
    expect(today(EVENING, "America/Los_Angeles")).toBe("2026-11-23");
    expect(today(EVENING, "UTC")).toBe("2026-11-24");
    expect(today(MORNING, "Pacific/Auckland")).toBe("2026-11-24");
    expect(today(MORNING, "UTC")).toBe("2026-11-23");
  });
  it("without a zone it is the browser's own", () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    expect(today()).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    expect(today(BEFORE)).toBe(dayOf(BEFORE));
    expect(dayOf(BEFORE.toISOString())).toBe(formatDate(BEFORE.toISOString()));
  });
  it("a moment falls on the reader's day; a day is kept as written, never shifted", () => {
    expect(dayOf(BEFORE.toISOString(), "Pacific/Auckland")).toBe("2026-11-24");
    expect(dayOf(BEFORE.toISOString(), "UTC")).toBe("2026-11-23");
    expect(dayOf(EVENING, "America/Los_Angeles")).toBe("2026-11-23");
    expect(dayOf("2026-11-24T07:50:00+00:00", "America/Los_Angeles")).toBe("2026-11-23");
    for (const zone of ["Pacific/Auckland", "America/Los_Angeles", "UTC", undefined]) expect(dayOf("2026-11-13", zone)).toBe("2026-11-13");
    expect(dayOf("")).toBe("");
    expect(dayOf(null)).toBe("");
    expect(dayOf("nonsense")).toBe("");
    expect(dayOf(new Date(NaN))).toBe("");
  });
  it("counts, adds and checks calendar days the same in every zone", () => {
    expect(daysBetween("2026-11-23", "2026-11-24")).toBe(1);
    expect(daysBetween("2026-11-24", "2026-11-23")).toBe(-1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // over the change to summer time in Europe
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-11-23", "nope")).toBeNaN();
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-11-09", 7)).toBe("2026-11-16");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-05-23", 6)).toBe("2026-11-23");
    expect(addMonths("2026-01-31", 1)).toBe("2026-03-03"); // as the server's AddDate does
    expect(addMonths("2025-11-23", 12)).toBe("2026-11-23");
    expect(isDay("2024-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "", undefined, 20261116]) expect(isDay(bad)).toBe(false);
  });
  it("writes a day in short words for a chart", () => {
    expect(formatShortDay("2026-11-09")).toBe("9 Nov");
    expect(formatShortDay("2027-01-04")).toBe("4 Jan");
    expect(formatShortDay("soon")).toBe("soon");
  });
});

describe("no day is built by hand outside dates.ts", () => {
  // `toISOString().slice(0, 10)` and the UTC getters give the UTC day, not the reader's
  const root = path.resolve(__dirname, "../../..");
  const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "codemap" ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  it("in the app and the scripts", () => {
    const found = [...files(path.join(root, "src")), ...files(path.join(root, "scripts"))]
      .filter((f) => !f.endsWith(path.join("src", "lib", "dates.ts")))
      .flatMap((f) => fs.readFileSync(f, "utf8").split("\n").map((line, i) => ({ f: path.relative(root, f), i: i + 1, line })))
      .filter(({ line }) => /toISOString\(\)\s*\.slice\(0,\s*10\)|\.getUTC(FullYear|Month|Date)\(|\.getFullYear\(/.test(line))
      .map(({ f, i }) => `${f}:${i}`);
    expect(found).toEqual([]);
  });
});
