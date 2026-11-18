import { describe, expect, it } from "vitest";
import type { Catalog, DocMeta, Process, TargetKind } from "../../types";
import { addedAt, sortLabel, sortOf, sortResults, type MetaByKind } from "../sorting";
import { emptyFilterText, profileOptions, search, type Option } from "../search";
import { chosenSummary, nothingToChoose } from "../../components/Lists";

// Sorting the lists, the sentences of a filter with nothing to choose, and "My application" as dropdowns.

const meta = (createdAt: string, updatedAt: string): DocMeta => ({ version: 1, createdAt, updatedAt, updatedBy: "x" });
const r = (kind: TargetKind, id: string, title: string) => ({ kind, doc: { id, title } });

describe("the order of a list", () => {
  const list = [r("process", "b", "Bravo"), r("standard", "a", "Alpha"), r("process", "c", "Charlie"), r("process", "d", "Delta")];
  const m: MetaByKind = {
    process: { b: meta("2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z"), c: meta("2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z") },
    standard: { a: meta("2026-02-01T00:00:00Z", "2026-07-01T00:00:00Z") },
  };
  it("keeps the usual order (best match or name) as it is", () => {
    expect(sortResults(list, "", m)).toBe(list);
  });
  it("puts the newest first, by the date it was added; what has no date comes last", () => {
    expect(sortResults(list, "newest", m).map((x) => x.doc.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("puts the most recently updated first", () => {
    expect(sortResults(list, "updated", m).map((x) => x.doc.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("tells processes and standards with the same id apart, and orders the same date by name", () => {
    const same = [r("process", "x", "Zulu"), r("standard", "x", "Yankee"), r("process", "y", "Alpha")];
    const t = "2026-05-05T00:00:00Z";
    const mm: MetaByKind = { process: { x: meta(t, t), y: meta(t, t) }, standard: { x: meta("2026-09-09T00:00:00Z", t) } };
    expect(sortResults(same, "newest", mm).map((x) => x.doc.title)).toEqual(["Yankee", "Alpha", "Zulu"]);
  });
  it("uses the last save as the date added when an older server leaves it out", () => {
    expect(addedAt({ version: 1, updatedAt: "2026-01-02", updatedBy: "x" } as DocMeta)).toBe("2026-01-02");
    expect(addedAt(undefined)).toBe("");
  });
  it("names the orders, and reads only those it knows", () => {
    expect(sortLabel("", true)).toBe("Best match");
    expect(sortLabel("", false)).toBe("Name");
    expect(sortLabel("newest", false)).toBe("Newest");
    expect(sortLabel("updated", true)).toBe("Recently updated");
    expect(sortOf("updated")).toBe("updated");
    for (const bad of [null, "", "name", "Newest", 3]) expect(sortOf(bad)).toBe("");
  });
});

describe("a filter with nothing to choose", () => {
  const o = (count: number, chosen = false): Option => ({ value: String(count), label: "x", count, chosen });
  it("is when every option gives nothing and none is chosen", () => {
    expect(nothingToChoose([o(0), o(0)])).toBe(true);
    expect(nothingToChoose([o(0), o(2)])).toBe(false); // one greyed among live ones stays as it is
    expect(nothingToChoose([o(0, true), o(0)])).toBe(false);
    expect(nothingToChoose([])).toBe(false);
  });
  it("says why in the words of each filter", () => {
    expect(emptyFilterText("rigour", "process", 5)).toBe("No process here says how binding it is.");
    expect(emptyFilterText("rigour", "standard", 5)).toBe("No standard here gives its requirements a level (must, should or may).");
    expect(emptyFilterText("rigour", "any", 5)).toBe("Nothing here says how binding it is.");
    expect(emptyFilterText("platform", "standard", 5)).toBe("No standard here belongs to a platform.");
    expect(emptyFilterText("practice", "process", 5)).toBe("No process here belongs to a practice.");
    expect(emptyFilterText("owner", "any", 5)).toBe("Nothing here names the team that maintains it.");
    expect(emptyFilterText("category", "process", 5)).toBe("No process here has a category.");
  });
  it("says that it is the other choices when nothing is left at all", () => {
    expect(emptyFilterText("rigour", "process", 0)).toBe("Nothing matches the other choices, so there is nothing to choose here.");
    expect(emptyFilterText("tier", "any", 0)).toBe("Nothing matches the other choices, so there is nothing to choose here.");
  });
});

describe("“My application” as dropdowns", () => {
  const catalog: Catalog = {
    teams: [], practices: [], platforms: [], categories: [], tools: [],
    tiers: [{ id: "t0", name: "Tier 0" }, { id: "t3", name: "Tier 3" }],
    environments: [{ id: "prod", name: "Production" }],
    languages: [],
  };
  const proc = (id: string, extra: Partial<Process> = {}): Process => ({
    schemaVersion: "1.0", id, title: id, summary: "", status: "active", prerequisites: [], actors: [{ id: "me", name: "You" }], steps: [], ...extra,
  });
  const processes = [proc("all"), proc("top", { tiers: ["t0"] }), proc("prod-only", { environments: ["prod"], tiers: ["t3"] })];
  it("offers Any first, then the list, each with how many results it would give", () => {
    const out = profileOptions({ processes, standards: [], catalog, drafts: false });
    expect(out.tier.map((x) => [x.label, x.count, x.chosen])).toEqual([["Any tier", 3, true], ["Tier 0", 2, false], ["Tier 3", 2, false]]);
    expect(out.environment.map((x) => [x.label, x.count])).toEqual([["Any environment", 3], ["Production", 3]]);
    expect(out.language).toEqual([]); // an empty list: no dropdown
    expect(chosenSummary(out.tier)).toBe("Any");
  });
  it("offers every entry of the list, also one that would give nothing (a fact about the reader)", () => {
    const out = profileOptions({ processes: [proc("top", { tiers: ["t0"] })], standards: [], catalog, drafts: false });
    expect(out.tier.map((x) => [x.label, x.count])).toEqual([["Any tier", 1], ["Tier 0", 1], ["Tier 3", 0]]);
    // and when nothing is left at all, every entry is still there, with 0
    const none = profileOptions({ processes: [], standards: [], catalog, drafts: false, profile: { tier: "t3" } });
    expect(none.tier.map((x) => [x.label, x.count, x.chosen])).toEqual([["Any tier", 0, false], ["Tier 0", 0, false], ["Tier 3", 0, true]]);
    expect(none.environment.map((x) => x.label)).toEqual(["Any environment", "Production"]);
  });
  it("counts with the other choices, and keeps a chosen value the list no longer has", () => {
    const out = profileOptions({ processes, standards: [], catalog, drafts: false, profile: { tier: "t0", language: "cobol" } });
    expect(out.tier.find((x) => x.chosen)?.label).toBe("Tier 0");
    expect(out.language.map((x) => [x.value, x.chosen])).toEqual([["", false], ["cobol", true]]);
    // with tier 0 chosen, Production gives what applies to tier 0 and production
    expect(out.environment.find((x) => x.value === "prod")?.count).toBe(search({ processes, standards: [], catalog, drafts: false, profile: { tier: "t0", environment: "prod" } }).results.length);
    expect(chosenSummary(out.tier)).toBe("Tier 0");
  });
});

describe("the languages line of a card", () => {
  it("carries each language with its icon, when it has one", async () => {
    const { cardLines } = await import("../cardLines");
    const c = { teams: [], tiers: [], environments: [], languages: [{ id: "go", name: "Go", icon: "a".repeat(64) }, { id: "py", name: "Python" }] };
    const doc = { schemaVersion: "1.0", id: "x", title: "X", summary: "", status: "active", prerequisites: [], actors: [], steps: [], languages: ["go", "py"] } as unknown as Process;
    const line = cardLines({ kind: "process", doc, catalog: c, rigour: {}, rules: 0, mayEdit: false }).find((l) => l.key === "languages");
    expect(line?.value).toBe("Go, Python");
    expect(line?.items).toEqual([{ name: "Go", icon: "a".repeat(64) }, { name: "Python" }]);
  });
});
