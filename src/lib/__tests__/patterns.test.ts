import { describe, expect, it } from "vitest";
import type { Catalog, Process, Standard } from "../../types";
import { completeCatalog, EMPTY_CATALOG } from "../catalog";
import { patternLabel, patternNameClashes, patternsOf, patternTitle, patternWords } from "../patterns";
import { tidy, tidyStandard } from "../edit";
import { emptyFilterText, FILTER_KEYS, FILTER_LABEL, knownFilters, PROFILE_KEYS, search, toggleFilter, type SearchInput } from "../search";
import { href, parseRoute } from "../store";
import { hasErrors, LIST_WORDS, refusalIssues, validateCatalog, validateProcess, validateStandard } from "../validate";
import { issueText, listEntryWords, publishLines, refusalText, valueByName } from "../editing";
import { compare, describeChange, fieldName } from "../diff";
import { tidyLists } from "../groups";
import { base, baseStandard, catalog as sample, processes as sampleProcesses, standards as sampleStandards, readJson } from "./fixtures";

// The architecture patterns: a tenth list, and on a process or standard a tag. Unlike the path, a
// pattern never hides anything: it is a filter and a word to search by, not a part of My application.

const PATTERNS = [
  { id: "api-first", name: "API-first", alsoCalled: ["contract-first"] },
  { id: "event-driven", name: "Event-driven", alsoCalled: ["event-based", "EDA"], description: "Services react to events." },
  { id: "microservices", name: "Microservices" },
];
const catalog: Catalog = { ...sample, patterns: PATTERNS };

const proc = (id: string, title: string, patterns?: string[]): Process => ({ ...base(), id, title, ...(patterns ? { patterns } : {}) });
const std = (id: string, title: string, patterns?: string[]): Standard => ({ ...baseStandard(), id, title, ...(patterns ? { patterns } : {}) });

describe("the patterns in the sample", () => {
  it("are six with descriptions and other names, sorted by name, the same in the demo set", () => {
    expect(sample.patterns?.map((p) => p.name)).toEqual(["API-first", "Batch and data pipelines", "Event-driven", "Microservices", "Serverless", "Static site behind a CDN"]);
    for (const p of sample.patterns!) {
      expect(p.description?.length).toBeGreaterThan(20);
      expect(p.alsoCalled?.length).toBeGreaterThan(0);
    }
    expect(readJson<Catalog>("demo/catalog/catalog.json").patterns).toEqual(sample.patterns);
    expect(validateCatalog(sample)).toEqual([]);
  });
  it("tag only the two sample processes that are about one; no sample standard is tagged", () => {
    const tagged = [...sampleProcesses, ...sampleStandards].filter((d) => d.patterns?.length).map((d) => `${d.id}:${d.patterns!.join(",")}`);
    expect(tagged).toEqual(["onboard-api-to-apigee:api-first", "onboard-site-to-akamai:static-site-cdn"]);
  });
});

describe("the lists", () => {
  it("are complete with an empty list of patterns when stored without one; nothing is added", () => {
    expect(completeCatalog({ teams: [] } as Partial<Catalog>).patterns).toEqual([]);
    expect(EMPTY_CATALOG.patterns).toEqual([]);
    expect(tidyLists(completeCatalog({ ...EMPTY_CATALOG, patterns: undefined })).patterns).toEqual([]);
    expect(tidyLists({ ...catalog, patterns: [{ id: "x", name: "X", description: " ", alsoCalled: [" eda ", ""] }] }).patterns).toEqual([{ id: "x", name: "X", alsoCalled: ["eda"] }]);
    // the format allows lists without the key
    const { patterns: _p, ...without } = catalog;
    void _p;
    expect(validateCatalog(without)).toEqual([]);
  });
  it("check the patterns like the other lists: unique ids, other names that belong to one pattern", () => {
    expect(LIST_WORDS.patterns).toEqual({ one: "architecture pattern", many: "architecture patterns" });
    const twice = validateCatalog({ ...catalog, patterns: [...PATTERNS, { id: "api-first", name: "API first" }] });
    expect(twice.map((i) => i.message)).toContain("Two architecture patterns have the id “api-first” (“API-first” and “API first”): remove one of them.");
    const clash = { ...catalog, patterns: [{ id: "a", name: "Event-driven", alsoCalled: ["EDA"] }, { id: "b", name: "Streaming", alsoCalled: ["eda"] }, { id: "c", name: "Reactive", alsoCalled: ["streaming"] }] };
    expect(validateCatalog(clash).map((i) => `${i.path}: ${i.message}`)).toEqual([
      "patterns[1].alsoCalled: The architecture patterns “Event-driven” and “Streaming” are both also called “eda”: keep it on one of them.",
      "patterns[2].alsoCalled: The architecture pattern “Reactive” is also called “streaming”, which is the name of the architecture pattern “Streaming”: take it off “Reactive”.",
    ]);
    expect(patternNameClashes(PATTERNS)).toEqual([]);
    // a problem of an entry names it by its name, with "an" before "architecture"
    expect(listEntryWords({ patterns: [{ id: "x" }] }, "patterns", 0)).toBe("the architecture pattern with the id “x”");
    expect(listEntryWords({ patterns: [{}] }, "patterns", 0)).toBe("an architecture pattern without a name");
    const long = validateCatalog({ ...catalog, patterns: [{ id: "x", name: "X", alsoCalled: ["a", "b", "c", "d", "e", "f"] }] });
    expect(long.map((i) => issueText(i, "lists", { patterns: [{ id: "x", name: "X" }] }))).toContain("Check the other names of the architecture pattern “X”: at most 5, each written once, none empty and none longer than 40 characters.");
    // a pattern has no picture
    expect(hasErrors(validateCatalog({ ...catalog, patterns: [{ id: "x", name: "X", symbol: "road" } as never] }))).toBe(true);
  });
  it("say the patterns of a document in words, in the order of the list, an unknown one by its id", () => {
    expect(patternLabel(catalog, undefined)).toBe("");
    expect(patternLabel(catalog, ["microservices", "gone", "api-first"])).toBe("API-first, Microservices, gone");
    expect(patternsOf(catalog.patterns, ["gone"])).toEqual([{ id: "gone", name: "gone" }]);
    expect(patternsOf(catalog.patterns, "event-driven")).toEqual([]);
    expect(patternTitle(PATTERNS[1])).toBe("Event-driven, also called event-based or EDA");
    expect(valueByName("patterns", ["event-driven", "api-first"], catalog)).toBe("Event-driven, API-first");
    expect(fieldName("patterns", "process")).toBe("architecture patterns");
  });
});

describe("the checker", () => {
  it("refuses a pattern that is not in the list, on a process and on a standard", () => {
    const p = validateProcess(proc("p-demo", "Demo process", ["api-first", "soa"]), { catalog });
    expect(p.filter((i) => i.path.startsWith("patterns"))).toEqual([{ level: "error", path: "patterns[1]", message: "“soa” is not one of the architecture patterns. Remove it under “Architecture patterns”." }]);
    const s = validateStandard(std("s-demo", "Demo standard", ["unknown"]), { catalog });
    expect(s.filter((i) => i.path.startsWith("patterns"))).toEqual([{ level: "error", path: "patterns[0]", message: "“unknown” is not one of the architecture patterns. Remove it under “Architecture patterns”." }]);
    expect(validateProcess(proc("p-demo", "Demo process", ["api-first", "microservices"]), { catalog }).filter((i) => i.path.startsWith("patterns"))).toEqual([]);
    // lists without patterns: none can be named
    expect(hasErrors(validateProcess(proc("p-demo", "Demo process", ["api-first"]), { catalog: { ...catalog, patterns: undefined } }))).toBe(true);
  });
  it("takes the format from the schema: each once, slugs", () => {
    const twice = validateProcess(proc("p-demo", "Demo process", ["api-first", "api-first"]), { catalog });
    expect(twice.map((i) => issueText(i, "process"))).toContain("Name each entry once in the architecture patterns: remove the one named twice.");
    expect(hasErrors(validateStandard(std("s-demo", "Demo standard", ["Event Driven"]), { catalog }))).toBe(true);
  });
  it("words the server's refusal of an unknown pattern as its own", () => {
    const error = "patterns[0]: \"soa\" is not a known architecture pattern. Known architecture patterns: api-first, event-driven";
    expect(refusalIssues(error)).toEqual({ issues: [{ level: "error", path: "patterns[0]", message: "“soa” is not one of the architecture patterns. Remove it under “Architecture patterns”." }], more: 0 });
    expect(refusalText(error, "process", {})).toBe("“soa” is not one of the architecture patterns. Remove it under “Architecture patterns”.");
  });
  it("leaves empty patterns out of what is saved", () => {
    expect("patterns" in tidy(proc("p-demo", "Demo process", []))).toBe(false);
    expect("patterns" in tidyStandard(std("s-demo", "Demo standard", []))).toBe(false);
    expect(tidy(proc("p-demo", "Demo process", ["api-first"])).patterns).toEqual(["api-first"]);
  });
});

describe("a change of patterns in words", () => {
  it("is said with the names, on the Publish list and in the versions", () => {
    const a = proc("p-demo", "Demo process"), b = proc("p-demo", "Demo process", ["event-driven", "microservices"]);
    expect(publishLines("process", a, b, catalog)).toContain("Architecture patterns: nothing → “Event-driven, Microservices”");
    const c = proc("p-demo", "Demo process", ["event-driven"]);
    expect(publishLines("process", b, c, catalog)).toContain("Architecture patterns: “Event-driven, Microservices” → “Event-driven”");
    expect(compare("standard", std("s", "S", ["api-first"]), std("s", "S"), catalog).map(describeChange)).toEqual(["Architecture patterns changed"]);
  });
});

describe("the pattern filter and the search", () => {
  const docs = { processes: [proc("a", "Alpha", ["event-driven"]), proc("b", "Beta", ["api-first", "event-driven"]), proc("c", "Gamma")], standards: [std("s", "Rules", ["microservices"])] };
  const input = (extra: Partial<SearchInput> = {}): SearchInput => ({ ...docs, catalog, drafts: true, ...extra });
  const ids = (extra: Partial<SearchInput> = {}) => search(input(extra)).results.map((r) => r.doc.id).sort();

  it("offers the patterns by name with how many each gives, and no choice for what is not tagged", () => {
    expect(FILTER_KEYS).toContain("pattern");
    expect(FILTER_LABEL.pattern).toBe("Architecture pattern");
    expect(search(input()).options.pattern.map((o) => `${o.label}:${o.count}`)).toEqual(["API-first:1", "Event-driven:2", "Microservices:1"]);
    // a tag, never a fact about the reader's application
    expect(PROFILE_KEYS).not.toContain("pattern" as never);
  });
  it("finds what is tagged with a pattern; several patterns are any of them, with the other filters all", () => {
    expect(ids({ filters: { pattern: ["event-driven"] } })).toEqual(["a", "b"]);
    expect(ids({ filters: { pattern: ["api-first", "microservices"] } })).toEqual(["b", "s"]);
    expect(ids({ filters: { pattern: ["event-driven"], type: ["standard"] } })).toEqual([]);
    expect(toggleFilter({}, "pattern", "api-first")).toEqual({ pattern: ["api-first"] });
    // nothing is hidden by a pattern: without a filter every document is there
    expect(ids()).toEqual(["a", "b", "c", "s"]);
  });
  it("has nothing to offer when no pattern is listed or named", () => {
    expect(search(input({ catalog: { ...catalog, patterns: [] }, processes: [proc("c", "Gamma")], standards: [] })).options.pattern).toEqual([]);
    expect(search(input({ catalog: { ...catalog, patterns: undefined }, processes: [proc("c", "Gamma")], standards: [] })).options.pattern).toEqual([]);
    expect(emptyFilterText("pattern", "standard", 3)).toBe("No standard here is tagged with an architecture pattern.");
  });
  it("finds a document by the name of its pattern and by what else it is called", () => {
    expect(ids({ q: "EDA" })).toEqual(["a", "b"]);
    expect(ids({ q: "event-based" })).toEqual(["a", "b"]);
    expect(ids({ q: "contract-first" })).toEqual(["b"]);
    expect(ids({ q: "microservices" })).toEqual(["s"]);
    expect(patternWords(PATTERNS[1])).toEqual(["Event-driven", "event-based", "EDA"]);
  });
  it("keeps the filter in the address, and drops a pattern that no longer exists", () => {
    expect(parseRoute("#/search?pattern=event-driven,api-first&q=x")).toMatchObject({ page: "search", pattern: ["event-driven", "api-first"] });
    expect(parseRoute("#/processes?pattern=microservices")).toMatchObject({ page: "library", pattern: ["microservices"] });
    expect(href({ page: "standards", pattern: ["event-driven"] })).toBe("#/standards?pattern=event-driven");
    const known = knownFilters({ pattern: ["event-driven", "soa"] }, catalog, [...docs.processes, ...docs.standards]);
    expect(known).toEqual({ filters: { pattern: ["event-driven"] }, dropped: 1 });
    // one a document still names, though the list lost it, stays findable under its id
    expect(knownFilters({ pattern: ["legacy"] }, catalog, [proc("d", "Delta", ["legacy"])])).toEqual({ filters: { pattern: ["legacy"] }, dropped: 0 });
  });
});
