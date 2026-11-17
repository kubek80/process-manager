import { describe, expect, it } from "vitest";
import type { Catalog, Process, Standard } from "../../types";
import { excerpt, filterCount, matchRanges, rigourText, search, toggleFilter, wordsOf, type Filters, type SearchInput } from "../search";
import { href, pageTitle, parseRoute, type Route } from "../store";
import { catalog as sampleCatalog, processes as sampleProcesses, standards as sampleStandards } from "./fixtures";

const catalog: Catalog = {
  tiers: [], environments: [], languages: [],
  teams: [{ id: "cloud-team", name: "Cloud team" }, { id: "security", name: "Cyber Security" }],
  practices: [{ id: "security", name: "Cyber security" }, { id: "engineering", name: "Engineering" }],
  platforms: [{ id: "google-cloud", name: "Google Cloud" }, { id: "azure", name: "Azure" }, { id: "unused", name: "Unused platform" }],
  categories: [{ id: "cloud", name: "Cloud" }, { id: "network", name: "Network" }],
  tools: [{ id: "servicenow", name: "ServiceNow" }],
};

const proc = (id: string, title: string, extra: Partial<Process> = {}): Process => ({
  schemaVersion: "1.0", id, title, summary: `Summary of ${title}.`, status: "active", prerequisites: [], actors: [{ id: "me", name: "You" }],
  steps: [{ id: "start", title: "Start", actor: "me", type: "task", next: [] }], ...extra,
});
const std = (id: string, title: string, extra: Partial<Standard> = {}): Standard => ({
  schemaVersion: "1.0", id, title, summary: `Summary of ${title}.`, owner: "security", status: "active",
  requirements: [{ id: "X-01", title: "A rule", level: "must", statement: "Always.", verification: { method: "review" } }], ...extra,
});

const gcp = proc("request-gcp-project", "Request a GCP project", {
  category: "cloud", platform: "google-cloud", rigour: "mandatory", owner: "cloud-team", tags: ["gcp"],
  steps: [
    { id: "raise", title: "Raise the request", actor: "me", type: "form", description: "Open a ticket in the portal.", tool: "servicenow", next: [] },
    { id: "budget", title: "Get a budget code", actor: "me", type: "task", description: "Your finance contact gives you a cost centre.", next: [] },
  ],
  prerequisites: [{ title: "Billing account", description: "A billing account must exist." }],
});
const azure = proc("request-azure-landing-zone", "Request an Azure landing zone", { category: "cloud", platform: "azure", rigour: "mandatory", summary: "A subscription for your team." });
const library = proc("publish-library", "Publish an internal library", { category: "network", practice: "engineering", rigour: "recommended", summary: "Share code with a ticket." });
const draft = proc("secret-draft", "Draft about tickets", { status: "draft", platform: "azure", rigour: "optional" });
const logging = std("secure-logging", "Secure logging", {
  category: "network", practice: "security", tags: ["logs"], scope: "Every service that writes a ticket number to its logs.",
  requirements: [
    { id: "SEC-LOG-01", title: "No secrets in logs", level: "must", statement: "Passwords and tokens are never written.", verification: { method: "review" } },
    { id: "SEC-LOG-02", title: "Structured logs", level: "must", statement: "Logs are JSON.", verification: { method: "review" } },
    { id: "SEC-LOG-03", title: "Keep logs", level: "should", statement: "Keep them for a year in the café.", verification: { method: "manual" } },
  ],
});
const iac = std("infrastructure-as-code", "Infrastructure as code", { owner: "cloud-team", practice: "engineering", platform: "google-cloud", requirements: [
  { id: "IAC-01", title: "Use Terraform", level: "should", statement: "Describe resources as code.", verification: { method: "review" } },
  { id: "IAC-02", title: "Tag resources", level: "may", statement: "Label what you create.", verification: { method: "review" } },
] });

const input = (q = "", filters: Filters = {}, drafts = false): SearchInput =>
  ({ processes: [gcp, azure, library, draft], standards: [logging, iac], catalog, q, filters, drafts });
const ids = (q = "", filters: Filters = {}, drafts = false) => search(input(q, filters, drafts)).results.map((r) => r.doc.id);
const count = (q: string, filters: Filters, key: keyof Filters, value: string) =>
  search(input(q, filters)).options[key].find((o) => o.value === value)?.count;

describe("search: matching", () => {
  it("returns everything, by title, without a query or filters", () => {
    expect(ids()).toEqual(["infrastructure-as-code", "publish-library", "request-gcp-project", "request-azure-landing-zone", "secure-logging"]);
  });
  it("needs every word, wherever it is in the document", () => {
    expect(ids("gcp budget")).toEqual(["request-gcp-project"]); // title + a step
    expect(ids("gcp nothing-like-this")).toEqual([]);
    expect(ids("servicenow")).toEqual(["request-gcp-project"]); // the name of a step's tool
    expect(ids("billing")).toEqual(["request-gcp-project"]); // a prerequisite
    expect(ids("sec-log-02")).toEqual(["secure-logging"]); // a requirement id
    expect(ids("passwords")).toEqual(["secure-logging"]); // a requirement statement
    expect(ids("google")).toEqual(["infrastructure-as-code", "request-gcp-project"]); // the name of the platform
    expect(ids("engineering")).toEqual(["infrastructure-as-code", "publish-library"]); // the name of the practice
    expect(ids("cyber")).toEqual(["secure-logging"]); // the name of the owner team and the practice
  });
  it("ignores case and accents", () => {
    expect(ids("CAFE")).toEqual(["secure-logging"]);
    expect(ids("Résumé")).toEqual(ids("resume"));
    expect(wordsOf("  Café  GCP ")).toEqual(["cafe", "gcp"]);
  });
  it("puts title matches first, then tags and ids, then the summary, then the inside", () => {
    // "ticket": a step of the GCP process, the scope of logging, the summary of the library, the title of the draft (hidden)
    expect(ids("ticket")).toEqual(["publish-library", "request-gcp-project", "secure-logging"]);
    expect(ids("ticket", {}, true)[0]).toBe("secret-draft");
    // "logs": title of none, tag of secure-logging; "logging" in its title
    expect(ids("logging")[0]).toBe("secure-logging");
    const zone = proc("zone-tag", "Something else", { tags: ["landing"] });
    const out = search({ ...input("landing"), processes: [zone, azure] }).results.map((r) => r.doc.id);
    expect(out).toEqual(["request-azure-landing-zone", "zone-tag"]);
  });
});

describe("search: where it was found inside", () => {
  it("names the steps and requirements, to open them directly", () => {
    const [r] = search(input("budget")).results;
    expect(r.hits).toEqual([{ where: "step", item: "budget", label: "Get a budget code" }]);
    const [s] = search(input("tokens")).results;
    expect(s.hits[0]).toMatchObject({ where: "requirement", item: "SEC-LOG-01", label: "No secrets in logs", snippet: "Passwords and tokens are never written." });
  });
  it("shows at most three, those with most words first", () => {
    const many = std("many", "Many", { requirements: ["a", "b", "c", "d"].map((x, i) => ({
      id: `M-0${i}`, title: `Rule ${x}`, level: "must" as const, statement: i === 3 ? "alpha beta" : "alpha", verification: { method: "review" as const },
    })) });
    const [r] = search({ ...input("alpha beta"), processes: [], standards: [many] }).results;
    expect(r.hits.map((h) => h.item)).toEqual(["M-03", "M-00", "M-01"]); // the place with both words first
    const [r2] = search({ ...input("alpha"), processes: [], standards: [many] }).results;
    expect(r2.hits.map((h) => h.item)).toEqual(["M-00", "M-01", "M-02"]);
  });
  it("finds the scope and prerequisites, without a link to an item", () => {
    expect(search(input("ticket number")).results[0].hits[0]).toMatchObject({ where: "scope", label: "Scope" });
    expect(search(input("billing")).results[0].hits[0]).toMatchObject({ where: "prerequisite", label: "Billing account" });
  });
  it("has nothing to point at without a query", () => {
    expect(search(input()).results.every((r) => r.hits.length === 0)).toBe(true);
  });
});

describe("search: filters", () => {
  it("any of the values within one filter, all filters together", () => {
    expect(ids("", { platform: ["azure", "google-cloud"] })).toEqual(["infrastructure-as-code", "request-gcp-project", "request-azure-landing-zone"]);
    expect(ids("", { platform: ["azure", "google-cloud"], type: ["standard"] })).toEqual(["infrastructure-as-code"]);
    expect(ids("", { category: ["cloud"], rigour: ["recommended"] })).toEqual([]);
    expect(ids("gcp", { type: ["process", "standard"] })).toEqual(["request-gcp-project"]);
  });
  it("a standard has a rigour when one of its requirements has that level", () => {
    expect(ids("", { rigour: ["mandatory"] })).toEqual(["request-gcp-project", "request-azure-landing-zone", "secure-logging"]);
    expect(ids("", { rigour: ["recommended"] })).toEqual(["infrastructure-as-code", "publish-library", "secure-logging"]);
    expect(ids("", { rigour: ["optional"] })).toEqual(["infrastructure-as-code"]);
  });
  it("counts, for every option, the results it would give with the other filters", () => {
    const out = search(input("", { platform: ["azure"] }));
    expect(out.results.length).toBe(1);
    // the platform filter does not narrow its own counts: another platform can be added
    expect(out.options.platform.map((o) => [o.value, o.count, o.chosen])).toEqual([
      ["azure", 1, true], ["google-cloud", 2, false], ["unused", 0, false],
    ]);
    // the other filters are counted within the chosen platform
    expect(out.options.type.map((o) => [o.label, o.count])).toEqual([["Processes", 1], ["Standards", 0]]);
    expect(out.options.rigour.map((o) => o.count)).toEqual([1, 0, 0]);
    expect(count("", {}, "category", "network")).toBe(2);
    expect(count("logs", {}, "category", "network")).toBe(1);
    expect(count("", { type: ["standard"] }, "rigour", "mandatory")).toBe(1);
  });
  it("keeps a value that is not in the lists, so that it can be removed", () => {
    const out = search(input("", { platform: ["gone"] }));
    expect(out.results).toEqual([]);
    expect(out.options.platform.find((o) => o.value === "gone")).toEqual({ value: "gone", label: "gone", count: 0, chosen: true });
  });
  it("is changed one value at a time", () => {
    let f: Filters = {};
    f = toggleFilter(f, "platform", "azure");
    f = toggleFilter(f, "platform", "github");
    f = toggleFilter(f, "type", "process");
    expect(f).toEqual({ platform: ["azure", "github"], type: ["process"] });
    expect(filterCount(f)).toBe(3);
    f = toggleFilter(f, "type", "process");
    expect(f).toEqual({ platform: ["azure", "github"] });
  });
});

describe("search: drafts", () => {
  it("are left out, also of the counts, unless asked for", () => {
    expect(ids("draft")).toEqual([]);
    expect(count("", {}, "rigour", "optional")).toBe(1); // only the standard, not the draft process
    expect(ids("draft", {}, true)).toEqual(["secret-draft"]);
    expect(search(input("", {}, true)).options.rigour.find((o) => o.value === "optional")?.count).toBe(2);
  });
  it("can be limited to the drafts somebody may edit, counts included", () => {
    const azureOnly = (kind: "process" | "standard", d: { platform?: string }) => kind === "process" && d.platform === "azure";
    const noAzure = (_kind: "process" | "standard", d: { platform?: string }) => d.platform !== "azure";
    expect(search({ ...input("draft"), drafts: azureOnly }).results.map((r) => r.doc.id)).toEqual(["secret-draft"]);
    expect(search({ ...input("draft"), drafts: noAzure }).results).toEqual([]);
    expect(search({ ...input(""), drafts: noAzure }).options.rigour.find((o) => o.value === "optional")?.count).toBe(1);
    // what is not a draft is never left out
    expect(search({ ...input("gcp"), drafts: () => false }).results.map((r) => r.doc.id)).toEqual(["request-gcp-project"]);
  });
});

describe("search: labels and highlighting", () => {
  it("describes the rigour", () => {
    const [s] = search(input("secure")).results;
    expect(rigourText(s)).toBe("2 mandatory, 1 recommended");
    const [p] = search(input("gcp")).results;
    expect(rigourText(p)).toBe("Mandatory");
  });
  it("finds the words in the original text, accents included", () => {
    expect(matchRanges("Keep it in the Café", ["cafe"])).toEqual([[15, 19]]);
    expect(matchRanges("GCP or gcp", ["gcp"])).toEqual([[0, 3], [7, 10]]);
    expect(matchRanges("request", ["req", "quest"])).toEqual([[0, 7]]);
    expect(matchRanges("Café au lait", ["cafe"])).toEqual([[0, 5]]);
    expect(matchRanges("anything", [])).toEqual([]);
  });
  it("cuts a long text around the match", () => {
    const long = `${"word ".repeat(40)}needle ${"more ".repeat(40)}`;
    const e = excerpt(long, ["needle"], 20);
    expect(e.startsWith("…")).toBe(true);
    expect(e.endsWith("…")).toBe(true);
    expect(e).toContain("needle");
    expect(excerpt("Short text.", ["x"])).toBe("Short text.");
  });
});

describe("search: the sample content", () => {
  it("finds every sample process and standard by its own title", () => {
    for (const d of [...sampleProcesses, ...sampleStandards]) {
      const out = search({ processes: sampleProcesses, standards: sampleStandards, catalog: sampleCatalog, q: d.title, drafts: true });
      expect(out.results[0]?.doc.id, d.title).toBe(d.id);
    }
  });
});

describe("addresses of home and search", () => {
  it("home is the start, the process library has its own address", () => {
    expect(parseRoute("")).toEqual({ page: "home" });
    expect(parseRoute("#/")).toEqual({ page: "home" });
    expect(parseRoute("#/processes")).toEqual({ page: "library" });
    expect(href({ page: "home" })).toBe("#/");
    expect(href({ page: "library" })).toBe("#/processes");
  });
  it("the results page carries the whole search", () => {
    const routes: Route[] = [
      { page: "search" },
      { page: "search", q: "gcp project" },
      { page: "search", q: "a&b=c, d / é?#", type: ["process"], rigour: ["mandatory", "optional"] },
      { page: "search", category: ["cloud", "source-control"], practice: ["engineering"], platform: ["google-cloud", "azure"] },
      { page: "search", platform: ["odd,value"] },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
    expect(href({ page: "search", q: "gcp project", platform: ["azure", "github"], type: ["standard"] }))
      .toBe("#/search?q=gcp%20project&type=standard&platform=azure,github");
  });
  it("ignores what it does not know, and what is empty", () => {
    expect(parseRoute("#/search?q=&type=&foo=bar&rigour=often,mandatory&type=widget")).toEqual({ page: "search", rigour: ["mandatory"] });
    expect(parseRoute("#/search?q=%E0%A4%A&platform=azure,,azure")).toEqual({ page: "search", q: "%E0%A4%A", platform: ["azure"] });
    // a broken escape keeps the text as it was typed, and the good escapes around it are still read
    expect(parseRoute("#/search?q=100%")).toEqual({ page: "search", q: "100%" });
    expect(parseRoute("#/search?q=caf%C3%A9+100%+sure&type=process")).toEqual({ page: "search", q: "café 100% sure", type: ["process"] });
    expect(parseRoute("#/search?q=50%25")).toEqual({ page: "search", q: "50%" });
    expect(parseRoute("#/search?q=gcp+project")).toEqual({ page: "search", q: "gcp project" });
  });
  it("names the tab of the browser", () => {
    expect(pageTitle({ page: "home" })).toBe("Process Manager");
    expect(pageTitle({ page: "search" })).toBe("Search · Process Manager");
    expect(pageTitle({ page: "search", q: " gcp " })).toBe("“gcp” · Search · Process Manager");
  });
});
