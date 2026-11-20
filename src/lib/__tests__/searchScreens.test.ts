import { describe, expect, it } from "vitest";
import { cardGroups, groupOf, rigourParts, shortFact, type CardLine } from "../cardLines";
import { modeLine } from "../meaning";
import { appSummary, typeTab, withTypeTab, type Option } from "../search";
import { agoText, mostViewed, recentlyUpdated, shownOnHome, type MetaByKind } from "../sorting";

const line = (key: string, value = "x", warn?: boolean): CardLine => ({ key, name: key, value, ...(warn ? { warn } : {}) });

describe("the card: groups of facts", () => {
  it("puts what to compare first, who looks after it second, what needs acting on in the marks", () => {
    const lines = ["owner", "platform", "practice", "rigour", "environments", "languages", "lead", "steps", "usedBy"].map((k) => line(k));
    const g = cardGroups([...lines, line("review", "Due 2026-12-01", true)]);
    expect(g.key.map((l) => l.key)).toEqual(["rigour", "lead", "steps", "usedBy"]);
    expect(g.who.map((l) => l.key)).toEqual(["owner", "platform", "practice", "environments", "languages"]);
    expect(g.attention.map((l) => l.key)).toEqual(["review"]);
  });
  it("a fact it does not know goes with the others about who and where; a warning is always a mark", () => {
    expect(groupOf(line("something"))).toBe("who");
    expect(groupOf(line("rules", "3", true))).toBe("attention");
    expect(groupOf(line("rules", "3"))).toBe("key");
  });
  it("the rigour parts, strongest first, only those there are", () => {
    expect(rigourParts({ optional: 1, mandatory: 3 })).toEqual([{ rigour: "mandatory", n: 3 }, { rigour: "optional", n: 1 }]);
    expect(rigourParts({ recommended: 0 })).toEqual([]);
  });
  it("short facts say what the number is of", () => {
    expect(shortFact(line("steps", "5 of 10 are yours"), "process")).toBe("5 of 10 steps are yours");
    expect(shortFact(line("rules", "5"), "standard")).toBe("5 requirements");
    expect(shortFact(line("rules", "1"), "standard")).toBe("1 requirement");
    expect(shortFact(line("rules", "2 of 5 apply to your application"), "standard")).toBe("2 of 5 requirements apply");
    expect(shortFact(line("usedBy", "2 processes"), "process")).toBe("Used by 2 processes");
    expect(shortFact(line("lead", "2-3 weeks"), "process")).toBe("2-3 weeks");
  });
});

describe("the search page", () => {
  it("one short line for the chosen way of searching, true for the provider", () => {
    expect(modeLine("words", "builtin")).toBe("Finds what contains every word you type.");
    expect(modeLine("both", undefined)).toMatch(/words and meaning/);
    expect(modeLine("meaning", "builtin")).toMatch(/even when none is really close/);
    expect(modeLine("meaning", "vertex")).toMatch(/other words/);
    expect(modeLine("meaning", undefined)).not.toMatch(/other words|none is really close/);
  });
  it("the type tabs: one kind, or all", () => {
    expect(typeTab({})).toBe("");
    expect(typeTab({ type: ["process"] })).toBe("process");
    expect(typeTab({ type: ["process", "standard"] })).toBe("");
    expect(typeTab({ type: ["nonsense" as "process"] })).toBe("");
    expect(withTypeTab({ category: ["cloud"] }, "standard")).toEqual({ category: ["cloud"], type: ["standard"] });
    expect(withTypeTab({ type: ["standard"], owner: ["x"] }, "")).toEqual({ owner: ["x"] });
  });
  it("My application, folded, says what is chosen", () => {
    const o = (value: string, label: string, chosen: boolean): Option => ({ value, label, chosen, count: 1 });
    expect(appSummary({ tier: [o("", "Any tier", true), o("t1", "Tier 1", false)] })).toBe("Not chosen");
    expect(appSummary({ tier: [o("", "Any tier", false), o("t1", "Tier 1", true)], environment: [o("prod", "Production", true)] })).toBe("Tier 1 · Production");
  });
});

describe("Home: recently updated, most viewed", () => {
  const r = (kind: "process" | "standard", id: string, status?: string) => ({ kind, doc: { id, title: id.toUpperCase(), ...(status ? { status } : {}) } });
  const items = [r("process", "a"), r("standard", "b"), r("process", "draft", "draft"), r("standard", "old", "deprecated"), r("process", "c", "active"), r("process", "nodate")];
  const meta: MetaByKind = {
    process: { a: { version: 1, updatedAt: "2026-11-01T10:00:00Z", updatedBy: "", createdAt: "" }, draft: { version: 1, updatedAt: "2026-11-19T10:00:00Z", updatedBy: "", createdAt: "" }, c: { version: 1, updatedAt: "2026-11-10T10:00:00Z", updatedBy: "", createdAt: "" } },
    standard: { b: { version: 1, updatedAt: "2026-11-05T10:00:00Z", updatedBy: "", createdAt: "" }, old: { version: 1, updatedAt: "2026-11-20T10:00:00Z", updatedBy: "", createdAt: "" } },
  };
  it("never a draft or anything retired", () => {
    expect(shownOnHome(r("process", "x"))).toBe(true);
    expect(shownOnHome(r("process", "x", "active"))).toBe(true);
    expect(shownOnHome(r("process", "x", "draft"))).toBe(false);
    expect(shownOnHome(r("process", "x", "deprecated"))).toBe(false);
  });
  it("recently updated: newest first, without a date left out, at most n", () => {
    expect(recentlyUpdated(items, meta, 5).map((x) => x.item.doc.id)).toEqual(["c", "b", "a"]);
    expect(recentlyUpdated(items, meta, 2).map((x) => x.item.doc.id)).toEqual(["c", "b"]);
    expect(recentlyUpdated(items, undefined, 5)).toEqual([]);
  });
  it("most viewed: most first, unopened left out, the same count by title", () => {
    const views: Record<string, number> = { a: 3, b: 9, draft: 50, old: 40, c: 3, nodate: 0 };
    expect(mostViewed(items, (x) => views[x.doc.id], 5).map((x) => [x.item.doc.id, x.views])).toEqual([["b", 9], ["a", 3], ["c", 3]]);
  });
  it("when, in words", () => {
    const now = new Date("2026-11-20T09:00:00Z");
    expect(agoText("2026-11-20T01:00:00Z", now)).toBe("today");
    expect(agoText("2026-11-19T23:00:00Z", now)).toBe("yesterday");
    expect(agoText("2026-11-15T12:00:00Z", now)).toBe("5 days ago");
    expect(agoText("2026-10-30T12:00:00Z", now)).toBe("3 weeks ago");
    expect(agoText("2026-06-01T12:00:00Z", now)).toBe("2026-06-01");
    expect(agoText("nonsense", now)).toBe("");
  });
});
