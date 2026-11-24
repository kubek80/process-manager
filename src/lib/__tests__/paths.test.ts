import { describe, expect, it } from "vitest";
import type { Catalog, Process, Standard } from "../../types";
import { completeCatalog, EMPTY_CATALOG, pathLabel } from "../catalog";
import { otherNameClashes, pathsOf, pathsSentence, pathTitle, pathWords } from "../paths";
import { appliesTo, tidy, tidyStandard } from "../edit";
import { appSummary, emptyFilterText, FILTER_HINT, FILTER_KEYS, knownFilters, NO_PATH, NO_PATH_LABEL, PROFILE_KEYS, profileOptions, search, toggleFilter, type SearchInput } from "../search";
import { href, parseRoute } from "../store";
import { hasErrors, LIST_WORDS, refusalIssues, validateCatalog, validateProcess, validateStandard } from "../validate";
import { issueText, listIssueField, listIssuePlace, refusalText, valueByName } from "../editing";
import { fieldName } from "../diff";
import { tidyLists } from "../groups";
import { base, baseStandard, catalog as sample, processes as sampleProcesses, standards as sampleStandards, readJson } from "./fixtures";

const PATHS = [
  { id: "greenfield", name: "Greenfield", alsoCalled: ["green field"], symbol: "sprout" as const, description: "Something new." },
  { id: "brownfield", name: "Brownfield", symbol: "buildings" as const },
  { id: "paved-path", name: "Paved path", alsoCalled: ["golden path", "paved road"], symbol: "road" as const },
];
const catalog: Catalog = { ...sample, paths: PATHS };

const proc = (id: string, title: string, paths?: string[]): Process => ({ ...base(), id, title, ...(paths ? { paths } : {}) });
const std = (id: string, title: string, paths?: string[]): Standard => ({ ...baseStandard(), id, title, ...(paths ? { paths } : {}) });

describe("the paths in the sample", () => {
  it("are a list of three with their pictures, in the sample and in the demo set alike", () => {
    expect(sample.paths?.map((p) => `${p.id}/${p.symbol}`)).toEqual(["greenfield/sprout", "brownfield/buildings", "paved-path/road"]);
    const demo = readJson<Catalog>("demo/catalog/catalog.json");
    expect(demo.paths).toEqual(sample.paths);
  });
  it("are named by some documents, none, one or two, and every one is in the list", () => {
    const counts = [...sampleProcesses, ...sampleStandards].map((d) => d.paths?.length ?? 0);
    expect(counts).toContain(0);
    expect(counts).toContain(1);
    expect(counts).toContain(2);
    for (const d of [...sampleProcesses, ...sampleStandards]) for (const p of d.paths ?? []) expect(sample.paths!.map((x) => x.id)).toContain(p);
  });
});

describe("the lists", () => {
  it("are complete with an empty list of paths when stored without one", () => {
    expect(completeCatalog({ teams: [] } as Partial<Catalog>).paths).toEqual([]);
    expect(EMPTY_CATALOG.paths).toEqual([]);
    // saved by the app, the key is always there: an admin who removed every path does not get them back
    expect(tidyLists(completeCatalog({ ...EMPTY_CATALOG, paths: undefined })).paths).toEqual([]);
    expect(tidyLists({ ...catalog, paths: [{ id: "x", name: "X", description: "  " }] }).paths).toEqual([{ id: "x", name: "X" }]);
  });
  it("check the paths like the other lists: unique ids, a picture the portal draws", () => {
    expect(LIST_WORDS.paths).toEqual({ one: "path", many: "paths" });
    const twice = validateCatalog({ ...catalog, paths: [...PATHS, { id: "greenfield", name: "New" }] });
    expect(twice.map((i) => i.message)).toContain("Two paths have the id “greenfield” (“Greenfield” and “New”): remove one of them.");
    const odd = validateCatalog({ ...catalog, paths: [{ id: "x", name: "Lift and shift", symbol: "unicorn" as never }] });
    expect(hasErrors(odd)).toBe(true);
    expect(odd.map((i) => issueText(i, "lists", { ...catalog, paths: [{ id: "x", name: "Lift and shift", symbol: "unicorn" }] })))
      .toContain("The picture of the path “Lift and shift” is not one the portal knows: choose one of the pictures, or none.");
    expect(listIssuePlace("paths[0].symbol")).toEqual({ list: "paths", index: 0, field: "symbol" });
    expect(validateCatalog(catalog)).toEqual([]);
  });
  it("say the paths of a document in words", () => {
    expect(pathLabel(catalog, undefined)).toBe("Any path");
    expect(pathLabel(catalog, ["greenfield", "gone"])).toBe("Greenfield, gone");
    expect(valueByName("paths", ["paved-path", "brownfield"], catalog)).toBe("Paved path, Brownfield");
    // a document's paths are "paths"; a requirement's review paths stay "files"
    expect(fieldName("paths", "process")).toBe("paths");
    expect(fieldName("paths", "standard")).toBe("paths");
    expect(fieldName("paths")).toBe("files");
  });
});

describe("the checker", () => {
  it("refuses a path that is not in the list, on a process and on a standard", () => {
    const p = validateProcess(proc("p-demo", "Demo process", ["greenfield", "golden-path"]), { catalog });
    expect(p.filter((i) => i.path.startsWith("paths"))).toEqual([{ level: "error", path: "paths[1]", message: "“golden-path” is not one of the paths. Remove it under “Which path it is for”." }]);
    const s = validateStandard(std("s-demo", "Demo standard", ["unknown"]), { catalog });
    expect(s.filter((i) => i.path.startsWith("paths"))).toEqual([{ level: "error", path: "paths[0]", message: "“unknown” is not one of the paths. Remove it under “Which path it is for”." }]);
    // the words are the checker's own: a whole sentence, as it is
    expect(issueText(s.find((i) => i.path === "paths[0]")!, "standard")).toBe("“unknown” is not one of the paths. Remove it under “Which path it is for”.");
    expect(validateProcess(proc("p-demo", "Demo process", ["greenfield", "paved-path"]), { catalog }).filter((i) => i.path.startsWith("paths"))).toEqual([]);
    // lists without paths: none can be named
    expect(hasErrors(validateProcess(proc("p-demo", "Demo process", ["greenfield"]), { catalog: { ...catalog, paths: undefined } }))).toBe(true);
  });
  it("takes the format from the schema: unique ids, slugs", () => {
    expect(hasErrors(validateProcess(proc("p-demo", "Demo process", ["greenfield", "greenfield"]), { catalog }))).toBe(true);
    expect(hasErrors(validateStandard(std("s-demo", "Demo standard", ["Paved Path"]), { catalog }))).toBe(true);
  });
  it("leaves empty paths out of what is saved", () => {
    expect("paths" in tidy(proc("p-demo", "Demo process", []))).toBe(false);
    expect("paths" in tidyStandard(std("s-demo", "Demo standard", []))).toBe(false);
    expect(tidy(proc("p-demo", "Demo process", ["brownfield"])).paths).toEqual(["brownfield"]);
  });
});

describe("the path filter and the search", () => {
  const docs = { processes: [proc("a", "Alpha", ["greenfield"]), proc("b", "Beta", ["brownfield", "paved-path"]), proc("c", "Gamma")], standards: [std("s", "Rules", ["paved-path"])] };
  const input = (extra: Partial<SearchInput> = {}): SearchInput => ({ ...docs, catalog, drafts: true, ...extra });
  const ids = (extra: Partial<SearchInput> = {}) => search(input(extra)).results.map((r) => r.doc.id).sort();

  it("offers every path of the list with how many each gives, then what names none", () => {
    expect(FILTER_KEYS).toContain("path");
    const opts = search(input()).options.path;
    // the filter means "made for this path"; what names none has its own option
    expect(opts.map((o) => `${o.label}:${o.count}`)).toEqual(["Made for Greenfield:1", "Made for Brownfield:1", "Made for Paved path:2", "Not tied to a path:1"]);
    expect(NO_PATH_LABEL).toBe("Not tied to a path");
    expect(FILTER_HINT.path).toBe("Shows what is made for the path you choose; what is for any path is left out. To see everything that applies to your application's path, choose it under My application.");
    expect(opts.at(-1)!.value).toBe(NO_PATH);
  });
  it("finds what names a path; several paths are any of them", () => {
    expect(ids({ filters: { path: ["paved-path"] } })).toEqual(["b", "s"]);
    expect(ids({ filters: { path: ["greenfield", "brownfield"] } })).toEqual(["a", "b"]);
    expect(ids({ filters: { path: [NO_PATH] } })).toEqual(["c"]);
    expect(toggleFilter({}, "path", "greenfield")).toEqual({ path: ["greenfield"] });
  });
  it("has nothing to offer without paths", () => {
    expect(search(input({ catalog: { ...catalog, paths: [] }, processes: [proc("c", "Gamma")], standards: [] })).options.path).toEqual([]);
    expect(emptyFilterText("path", "process", 3)).toBe("No process here is made for a particular path: everything is for any path.");
  });
  it("finds a path by its name and by what else it is called: the golden path is the paved path", () => {
    expect(ids({ q: "golden path" })).toEqual(["b", "s"]);
    expect(ids({ q: "greenfield" })).toEqual(["a"]);
    expect(ids({ q: "green field" })).toEqual(["a"]);
    expect(pathWords(PATHS[2])).toEqual(["Paved path", "golden path", "paved road"]);
    // the other names belong to the entry, not to its picture
    expect(pathWords({ name: "Toll road", alsoCalled: undefined })).toEqual(["Toll road"]);
    expect(pathWords({ name: "Lift", alsoCalled: [" rehost ", "", "  "] })).toEqual(["Lift", "rehost"]);
    const toll = { ...catalog, paths: [...PATHS, { id: "toll", name: "Toll road", symbol: "road" as const }] };
    expect(search({ ...input({ catalog: toll }), processes: [proc("t-demo", "Toll demo", ["toll"])], standards: [], q: "golden path" }).results).toEqual([]);
  });
  it("keeps the filter in the address, and drops a path that no longer exists", () => {
    const r = parseRoute("#/search?path=paved-path,greenfield&q=x");
    expect(r).toMatchObject({ page: "search", path: ["paved-path", "greenfield"] });
    expect(href({ page: "search", path: ["brownfield"] })).toBe("#/search?path=brownfield");
    expect(href({ page: "library", path: [NO_PATH] })).toContain("path=-");
    const known = knownFilters({ path: ["paved-path", "dirt-road", NO_PATH] }, catalog, [...docs.processes, ...docs.standards]);
    expect(known).toEqual({ filters: { path: ["paved-path", NO_PATH] }, dropped: 1 });
  });
});

describe("My application: the path", () => {
  it("hides what is for other paths only; what names none applies whatever the path", () => {
    expect(PROFILE_KEYS).toContain("path");
    expect(appliesTo({ paths: ["greenfield"] }, { path: "brownfield" })).toBe(false);
    expect(appliesTo({ paths: ["greenfield", "brownfield"] }, { path: "brownfield" })).toBe(true);
    expect(appliesTo({}, { path: "brownfield" })).toBe(true);
    expect(appliesTo({ paths: ["greenfield"] }, {})).toBe(true);
    const docs = { processes: [proc("a", "Alpha", ["greenfield"]), proc("c", "Gamma")], standards: [] };
    const out = search({ ...docs, catalog, drafts: true, profile: { path: "brownfield" } });
    expect(out.results.map((r) => r.doc.id)).toEqual(["c"]);
    const opts = profileOptions({ ...docs, catalog, drafts: true, profile: { path: "brownfield" } });
    expect(opts.path.map((o) => `${o.label}:${o.count}:${o.chosen}`)).toEqual(["Any path:2:false", "Greenfield:2:false", "Brownfield:1:true", "Paved path:1:false"]);
    expect(appSummary(opts)).toBe("Brownfield");
  });
});

describe("the words of the pictures", () => {
  it("say which paths a document is for, or that it applies whatever the path", () => {
    expect(pathsSentence("process", [])).toBe("This process applies whatever the path.");
    expect(pathsSentence("standard", [{ name: "Paved path" }])).toBe("This standard is for Paved path.");
    expect(pathsSentence("process", [{ name: "A" }, { name: "B" }, { name: "C" }])).toBe("This process is for A, B and C.");
  });
  it("take the entries in the order of the list, and an id no longer in it by its id", () => {
    expect(pathsOf(PATHS, ["paved-path", "gone", "greenfield", "gone"]).map((e) => e.name)).toEqual(["Greenfield", "Paved path", "gone"]);
    expect(pathsOf(PATHS, "greenfield")).toEqual([]);
    expect(pathsOf(undefined, ["x"])).toEqual([{ id: "x", name: "x" }]);
  });
});

describe("the other names of a path", () => {
  it("belong to the entry: said in its tooltip, kept tidy when saved", () => {
    expect(pathTitle(PATHS[2])).toBe("Paved path, also called golden path or paved road");
    expect(pathTitle(PATHS[0])).toBe("Greenfield, also called green field");
    expect(pathTitle(PATHS[1])).toBe("Brownfield");
    expect(pathTitle({ name: "A", alsoCalled: ["x", "y", "z"] })).toBe("A, also called x, y or z");
    expect(tidyLists({ ...catalog, paths: [{ id: "a", name: "A", alsoCalled: [" golden path", "", "  "] }] }).paths).toEqual([{ id: "a", name: "A", alsoCalled: ["golden path"] }]);
    expect(tidyLists({ ...catalog, paths: [{ id: "a", name: "A", alsoCalled: [""] }] }).paths).toEqual([{ id: "a", name: "A" }]);
    expect(sample.paths!.find((p) => p.id === "paved-path")!.alsoCalled).toEqual(["golden path", "paved road"]);
  });
  it("are each claimed by one path only and are no other path's name", () => {
    expect(otherNameClashes(PATHS)).toEqual([]);
    const two = [...PATHS, { id: "lift", name: "Lift", alsoCalled: ["Golden Path", "brownfield"] }];
    expect(otherNameClashes(two)).toEqual([
      { index: 3, message: "The paths “Paved path” and “Lift” are both also called “Golden Path”: keep it on one of them." },
      { index: 3, message: "The path “Lift” is also called “brownfield”, which is the name of the path “Brownfield”: take it off “Lift”." },
    ]);
    const issues = validateCatalog({ ...catalog, paths: two });
    expect(issues.filter((i) => i.path === "paths[3].alsoCalled").map((i) => issueText(i, "lists", { ...catalog, paths: two }))).toEqual(otherNameClashes(two).map((c) => c.message));
    expect(listIssueField("paths[3].alsoCalled")).toEqual(['[data-field="alsoCalled"]']);
  });
  it("hold at most five short names, each once, none empty, in plain words", () => {
    const words = (alsoCalled: string[]) => {
      const lists = { ...catalog, paths: [{ id: "a", name: "Lift", alsoCalled }] };
      return validateCatalog(lists).map((i) => issueText(i, "lists", lists));
    };
    const said = "Check the other names of the path “Lift”: at most 5, each written once, none empty and none longer than 40 characters.";
    for (const bad of [["a", "a"], [" "], [""], ["x".repeat(41)], ["a", "b", "c", "d", "e", "f"]]) expect(words(bad)).toContain(said);
    expect(words(["a", "b"])).toEqual([]);
  });
});

describe("a refusal of the server, in the app's words", () => {
  it("says a path, a tier or another entry that is not in the lists as the checker does, without the ids of the list", () => {
    const r = refusalIssues(`paths[0]: "nope" is not a known path. Known paths: greenfield, brownfield, paved-path; tiers[1]: "tier-9" is not a known tier. Known tiers: tier-0; requirements[2].environments[0]: "moon" is not a known environment. Known environments: production; category: "x" is not a known category. Known categories: (none)`)!;
    expect(r.issues.map((i) => issueText(i, "standard"))).toEqual([
      "“nope” is not one of the paths. Remove it under “Which path it is for”.",
      "“tier-9” is not one of the application tiers. Remove it under “Where it applies”.",
      "“moon” is not one of the environments. Remove it under “Where it applies”.",
      "“x” is not one of the categories. Choose one of the list under “What it belongs to”.",
    ]);
    expect(refusalText(`paths[0]: "nope" is not a known path. Known paths: greenfield`, "process", undefined)).not.toContain("greenfield");
  });
  it("says an entry named twice as an instruction, from the server and from the app's own checker alike", () => {
    const server = refusalIssues("does not match the format: /paths: items at 0 and 2 are equal")!;
    expect(issueText(server.issues[0], "process")).toBe("Name each entry once in the paths: remove the one named twice.");
    const tiers = refusalIssues("does not match the format: /tiers: items at 0 and 1 are equal")!;
    expect(issueText(tiers.issues[0], "process")).toBe("Name each entry once in the application tiers: remove the one named twice.");
    const own = validateProcess(proc("p-demo", "Demo process", ["greenfield", "greenfield"]), { catalog });
    expect(own.map((i) => issueText(i, "process"))).toContain("Name each entry once in the paths: remove the one named twice.");
  });
});

describe("an old link to a path", () => {
  it("keeps a path that a document still names though the list no longer has it", () => {
    const docs = [proc("a-demo", "Alpha demo", ["lift"])];
    expect(knownFilters({ path: ["lift", "gone"] }, catalog, docs)).toEqual({ filters: { path: ["lift"] }, dropped: 1 });
  });
});
