import { describe, expect, it } from "vitest";
import { countingDay, utcMidnightHere } from "../dates";
import { cutEdges } from "../../components/ui";
import { requestActions } from "../../components/RequestsPage";

describe("the counting day in the reader's own time", () => {
  it("says when midnight UTC is where the reader is", () => {
    expect(utcMidnightHere(-60)).toBe("01:00"); // Central Europe in winter
    expect(utcMidnightHere(300)).toBe("19:00"); // New York in winter
    expect(utcMidnightHere(-330)).toBe("05:30"); // India
    expect(utcMidnightHere(0)).toBe("");
    expect(countingDay(-60)).toBe("A day is counted from 01:00 to 01:00 your time (midnight to midnight UTC).");
    expect(countingDay(0)).toMatch(/midnight to midnight UTC, which is your time too/);
  });
});

describe("a strip that scrolls sideways", () => {
  it("names the edges that have more behind them", () => {
    expect(cutEdges(0, 300, 300)).toBe("");
    expect(cutEdges(0, 600, 300)).toBe("end");
    expect(cutEdges(150, 600, 300)).toBe("start end");
    expect(cutEdges(300, 600, 300)).toBe("start");
    expect(cutEdges(-300, 600, 300)).toBe("start"); // right to left
  });
});

describe("the actions of a request", () => {
  it("shows the one next step and puts the others under More", () => {
    expect(requestActions({ state: "open", canManage: true }, false)).toEqual({ next: "planned", more: ["done", "declined"] });
    expect(requestActions({ state: "planned", canManage: true }, false)).toEqual({ next: "done", more: ["declined", "open"] });
    expect(requestActions({ state: "done", canManage: true }, false)).toEqual({ next: "open", more: [] });
    expect(requestActions({ state: "declined", canManage: true }, true)).toEqual({ next: "open", more: ["remove"] });
  });
  it("lets the person who asked withdraw an open request, and an admin remove the others", () => {
    expect(requestActions({ state: "open", mine: true }, false)).toEqual({ next: "withdraw", more: [] });
    expect(requestActions({ state: "open", mine: true, canManage: true }, true)).toEqual({ next: "planned", more: ["done", "declined", "withdraw"] });
    expect(requestActions({ state: "open" }, true)).toEqual({ next: "remove", more: [] });
    expect(requestActions({ state: "open" }, false)).toEqual({ next: undefined, more: [] });
  });
});
