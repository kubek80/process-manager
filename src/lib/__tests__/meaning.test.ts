import { describe, expect, it } from "vitest";
import type { Catalog, Process, Standard } from "../../types";
import { fromMeaning, fuse, meaningHits, mergeHits, modeOf, needsServer, nextAsked, planOf, problemOf, type Found, type MeaningState } from "../meaning";
import { search } from "../search";
import { ApiError, type MeaningResult } from "../store";

const catalog: Catalog = {
  tiers: [], environments: [], languages: [], practices: [], tools: [],
  teams: [{ id: "cloud-team", name: "Cloud team" }],
  platforms: [{ id: "google-cloud", name: "Google Cloud" }, { id: "azure", name: "Azure" }],
  categories: [{ id: "cloud", name: "Cloud" }],
};
const proc = (id: string, title: string, extra: Partial<Process> = {}): Process => ({
  schemaVersion: "1.0", id, title, summary: `Summary of ${title}.`, status: "active", actors: [{ id: "me", name: "You" }],
  prerequisites: [{ title: "Approved cost centre", description: "Finance gives you one." }],
  steps: [{ id: "decide", title: "Decide the project details", actor: "me", type: "task", next: [] }], ...extra,
});
const std = (id: string, title: string, extra: Partial<Standard> = {}): Standard => ({
  schemaVersion: "1.0", id, title, summary: `Summary of ${title}.`, owner: "cloud-team", status: "active", scope: "All services.",
  requirements: [{ id: "SEC-LOG-01", title: "No secrets in logs", level: "must", statement: "Never.", verification: { method: "review" } }], ...extra,
});
const gcp = proc("request-gcp-project", "Request a GCP project", { platform: "google-cloud" });
const azure = proc("request-azure", "Request an Azure subscription", { platform: "azure" });
const draft = proc("hidden-draft", "A draft", { status: "draft" });
const logging = std("secure-logging", "Secure logging");
const docOf = (k: string, id: string) => [...(k === "process" ? [gcp, azure, draft] : [logging])].find((d) => d.id === id);
const hit = (part: string, item = "", snippet = "") => ({ part, item, label: "server label", snippet, score: 0.5 });

describe("the places search by meaning found", () => {
  it("takes the names from the document and points at the step, requirement or prerequisite", () => {
    expect(meaningHits("process", gcp, [hit("step", "decide", "…the project details…"), hit("prerequisite", "0"), hit("summary", "", "Something else entirely.")])).toEqual([
      { where: "step", item: "decide", label: "Decide the project details", snippet: "…the project details…" },
      { where: "prerequisite", label: "Approved cost centre" },
      { where: "summary", label: "Summary", snippet: "Something else entirely." },
    ]);
    expect(meaningHits("standard", logging, [hit("requirement", "SEC-LOG-01"), hit("scope", "", "All services.")])).toEqual([
      { where: "requirement", item: "SEC-LOG-01", label: "No secrets in logs" },
      { where: "scope", label: "Scope", snippet: "All services." },
    ]);
  });
  it("leaves out what the document does not have, and does not repeat the summary on the card", () => {
    expect(meaningHits("process", gcp, [hit("step", "gone"), hit("prerequisite", "7"), hit("prerequisite", "x"), hit("requirement", "SEC-LOG-01"), hit("scope"), hit("other")])).toEqual([]);
    expect(meaningHits("process", gcp, [hit("summary", "", "Summary of Request a GCP project.")])).toEqual([{ where: "summary", label: "Summary" }]);
    expect(meaningHits("process", gcp, undefined)).toEqual([]);
    expect(meaningHits("process", gcp, [hit("step", "decide"), hit("step", "decide"), null as never])).toHaveLength(1);
  });
});

describe("the server's answer as results", () => {
  const answer: MeaningResult[] = [
    { kind: "standard", id: "secure-logging", score: 0.9, hits: [] },
    { kind: "process", id: "not-mine", score: 0.8, hits: [] },
    { kind: "process", id: "request-gcp-project", score: 0.7, hits: [hit("step", "decide")] },
    { kind: "process", id: "request-gcp-project", score: 0.6, hits: [] },
    { kind: "widget" as never, id: "x", score: 1, hits: [] },
  ];
  it("keeps the server's order, ignores what this person does not have and repeats nothing", () => {
    const f = fromMeaning(answer, docOf);
    expect(f.map((x) => x.id)).toEqual(["secure-logging", "request-gcp-project"]);
    expect(f[1]).toMatchObject({ score: 0.7, by: ["meaning"], hits: [{ where: "step", item: "decide" }] });
  });
  it("is filtered and counted by the same search, in the server's order", () => {
    const found = fromMeaning([
      { kind: "process", id: "request-azure", score: 0.9, hits: [] },
      { kind: "process", id: "hidden-draft", score: 0.85, hits: [] },
      { kind: "process", id: "request-gcp-project", score: 0.8, hits: [] },
    ], docOf);
    const all = search({ processes: [gcp, azure, draft], standards: [logging], catalog, q: "zzz", drafts: false, found });
    expect(all.results.map((r) => r.doc.id)).toEqual(["request-azure", "request-gcp-project"]); // the draft is not shown
    expect(all.options.platform.find((o) => o.value === "google-cloud")?.count).toBe(1);
    const one = search({ processes: [gcp, azure], standards: [logging], catalog, q: "zzz", drafts: false, found, filters: { platform: ["google-cloud"] } });
    expect(one.results.map((r) => r.doc.id)).toEqual(["request-gcp-project"]);
    expect(one.options.platform.find((o) => o.value === "azure")?.count).toBe(1);
    expect(search({ processes: [gcp], standards: [], catalog, drafts: false, found: [] }).results).toEqual([]);
  });
});

describe("both ways together", () => {
  const f = (id: string, by: "words" | "meaning", hits: Found["hits"] = []): Found => ({ kind: "process", id, score: 1, hits, by: [by] });
  it("rewards being high in either list, and more being in both", () => {
    const words = [f("a", "words"), f("b", "words"), f("c", "words")];
    const meaning = [f("x", "meaning"), f("c", "meaning"), f("a", "meaning")];
    const out = fuse(words, meaning);
    expect(out.map((x) => x.id)).toEqual(["a", "c", "x", "b"]);
    expect(out.find((x) => x.id === "c")?.by).toEqual(["words", "meaning"]);
    expect(out.find((x) => x.id === "x")?.by).toEqual(["meaning"]);
    // the same place one each way: the better single place wins, then words
    expect(fuse([f("w", "words")], [f("m", "meaning")]).map((x) => x.id)).toEqual(["w", "m"]);
    expect(fuse([], [f("m", "meaning")]).map((x) => x.id)).toEqual(["m"]);
  });
  it("shows a place found both ways once", () => {
    const step = { where: "step" as const, item: "decide", label: "Decide" };
    const out = fuse([f("a", "words", [step])], [f("a", "meaning", [{ ...step, snippet: "…details…" }, { where: "summary", label: "Summary" }])]);
    expect(out[0].hits).toEqual([{ ...step, snippet: "…details…" }, { where: "summary", label: "Summary" }]);
    expect(mergeHits([step, step], [])).toHaveLength(1);
    const many = ["1", "2", "3", "4"].map((i) => ({ where: "step" as const, item: i, label: i }));
    expect(mergeHits(many, [])).toHaveLength(3);
  });
});

describe("when the server is asked", () => {
  it("on arriving, on Search, on a change of mode - not while typing", () => {
    expect(nextAsked("gcp", { type: "type", q: "gcp proj" })).toBe("gcp");
    expect(nextAsked("gcp", { type: "submit", q: " gcp project " })).toBe("gcp project");
    expect(nextAsked("", { type: "arrive", q: "logs" })).toBe("logs");
    expect(nextAsked("logs", { type: "mode", q: "logging" })).toBe("logging");
  });
  it("only with Meaning or Both, when offered and there is something to search for", () => {
    expect(needsServer("meaning", "gcp", true)).toBe(true);
    expect(needsServer("both", "gcp", true)).toBe(true);
    expect(needsServer("words", "gcp", true)).toBe(false);
    expect(needsServer("meaning", "  ", true)).toBe(false);
    expect(needsServer("meaning", "gcp", false)).toBe(false);
  });
  it("reads the mode from the address; anything else is Words", () => {
    expect(modeOf("meaning")).toBe("meaning");
    expect(modeOf("both")).toBe("both");
    expect(modeOf(undefined)).toBe("words");
    expect(modeOf("vector")).toBe("words");
  });
  it("tells a refusal for searching too often, an unreachable service and search switched off apart", () => {
    expect(problemOf(new ApiError(429, "You searched very often."))).toEqual({ kind: "busy", message: "You searched very often." });
    expect(problemOf(new ApiError(502, "The provider failed."))).toMatchObject({ kind: "unavailable", message: "Search by meaning is not available right now." });
    expect(problemOf(new ApiError(0, "The server cannot be reached."))).toMatchObject({ kind: "unavailable" });
    expect(problemOf(new ApiError(404, "Search by meaning is not switched on."))).toMatchObject({ kind: "off" });
  });
});

describe("what the page shows", () => {
  const st = (s: Partial<MeaningState> = {}): MeaningState => ({ for: "", loading: null, answer: null, problem: null, ...s });
  const res: MeaningResult[] = [{ kind: "process", id: "a", score: 1, hits: [] }];
  it("Words, or meaning not offered: the word search follows the typing", () => {
    expect(planOf("words", "gcp pro", "gcp", true, st())).toMatchObject({ q: "gcp pro", show: "words", busy: false });
    expect(planOf("meaning", "gcp pro", "gcp", false, st())).toMatchObject({ q: "gcp pro", show: "words" });
    expect(planOf("meaning", "gcp", "gcp", true, st({ for: "gcp", problem: { kind: "off", message: "" } }))).toMatchObject({ q: "gcp", show: "words", problem: null });
  });
  it("an empty search shows everything", () => {
    expect(planOf("meaning", "", "", true, st())).toMatchObject({ q: "", show: "words" });
  });
  it("the answer for what was asked; while waiting, what was shown before", () => {
    expect(planOf("meaning", "gcp", "gcp", true, st({ for: "gcp", answer: { query: "gcp", results: res } }))).toMatchObject({ q: "gcp", show: "meaning", meaning: res, busy: false });
    expect(planOf("both", "gcp", "gcp", true, st({ for: "gcp", answer: { query: "gcp", results: res } }))).toMatchObject({ show: "both" });
    const waiting = st({ for: "logs", loading: "logs", answer: { query: "gcp", results: res } });
    expect(planOf("meaning", "logs", "logs", true, waiting)).toMatchObject({ q: "gcp", show: "meaning", busy: true });
    // asked, and the request not even sent yet: waiting too, never the answer of before as if it were new
    expect(planOf("meaning", "logs", "logs", true, st({ for: "gcp", answer: { query: "gcp", results: res } }))).toMatchObject({ q: "gcp", busy: true });
    expect(planOf("meaning", "logs", "logs", true, st({ for: "logs", loading: "logs" }))).toMatchObject({ q: "logs", show: "none", busy: true });
    expect(planOf("both", "logs", "logs", true, st({ for: "logs", loading: "logs" }))).toMatchObject({ q: "logs", show: "words", busy: true });
  });
  it("a problem: nothing by meaning; Both shows what words find", () => {
    const busy = { kind: "busy" as const, message: "You searched very often." };
    expect(planOf("meaning", "gcp", "gcp", true, st({ for: "gcp", problem: busy, answer: { query: "old", results: res } }))).toMatchObject({ q: "gcp", show: "none", problem: busy });
    expect(planOf("both", "gcp", "gcp", true, st({ for: "gcp", problem: { kind: "unavailable", message: "x" } }))).toMatchObject({ q: "gcp", show: "words", problem: { kind: "unavailable" } });
    // a problem with an earlier query does not stand for a new one
    expect(planOf("meaning", "logs", "logs", true, st({ for: "gcp", problem: busy }))).toMatchObject({ busy: true, problem: null });
  });
});
