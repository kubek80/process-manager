import { afterEach, describe, expect, it, vi } from "vitest";
import type { Catalog, Process, Standard } from "../../types";
import { answerKey, contentStamp, emptyWithFilters, fromMeaning, fuse, markedWords, meaningHelp, meaningHits, mergeHits, modeOf, needsServer, planOf, problemOf, providerOf, truncatedText, typingMovesAddress, type Found, type MeaningState } from "../meaning";
import { countText, countWords, search } from "../search";
import { ApiError, searchByMeaning, type MeaningResult } from "../store";

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
    expect(meaningHits("process", gcp, [hit("summary", "", "Summary of Request a GCP project. · Tags: gcp · Category: Cloud…")])).toEqual([{ where: "summary", label: "Summary" }]);
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
  it("typing moves the address only with Words; with Meaning and Both it waits for the search to be run", () => {
    expect(typingMovesAddress("words", true)).toBe(true);
    expect(typingMovesAddress("meaning", true)).toBe(false);
    expect(typingMovesAddress("both", true)).toBe(false);
    // not offered: the page is Words, whatever the address says
    expect(typingMovesAddress("meaning", false)).toBe(true);
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
  it("keeps the server's sentence when search by meaning is not ready yet", () => {
    const ready = "Search by meaning is not ready yet. Try again in a moment, or search by words.";
    expect(problemOf(new ApiError(503, ready))).toEqual({ kind: "notready", message: ready });
    expect(problemOf(new ApiError(503, ""))).toEqual({ kind: "notready", message: ready });
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

describe("the words marked on cards found by meaning", () => {
  it("leaves out short and common words", () => {
    expect(markedWords(["put", "a", "secret", "in", "the", "log"])).toEqual(["put", "secret", "log"]);
  });
});

describe("answers are kept per query and per content", () => {
  it("the stamp changes with any change to a document, and only then", () => {
    const one = contentStamp([gcp, azure], [logging]);
    expect(contentStamp([gcp, azure], [logging])).toBe(one);
    expect(contentStamp([structuredClone(gcp), azure], [logging])).toBe(one);
    expect(contentStamp([{ ...gcp, title: "Request a GCP project now" }, azure], [logging])).not.toBe(one);
    expect(contentStamp([gcp], [logging])).not.toBe(one);
    expect(contentStamp([gcp, azure], [])).not.toBe(one);
    expect(answerKey(one, "gcp")).not.toBe(answerKey(contentStamp([gcp], []), "gcp"));
    expect(answerKey(one, "gcp")).not.toBe(answerKey(one, "gcp project"));
  });
});

describe("more found than sent", () => {
  const res: MeaningResult[] = [{ kind: "process", id: "a", score: 1, hits: [] }];
  const st = (s: Partial<MeaningState>): MeaningState => ({ for: "", loading: null, answer: null, problem: null, ...s });
  it("the plan says so, also while a newer answer is awaited", () => {
    expect(planOf("meaning", "gcp", "gcp", true, st({ for: "gcp", answer: { query: "gcp", results: res, truncated: true } }))).toMatchObject({ truncated: true });
    expect(planOf("meaning", "gcp", "gcp", true, st({ for: "gcp", answer: { query: "gcp", results: res } }))).toMatchObject({ truncated: false });
    expect(planOf("both", "x", "x", true, st({ for: "x", loading: "x", answer: { query: "gcp", results: res, truncated: true } }))).toMatchObject({ truncated: true, busy: true });
    expect(planOf("words", "gcp", "gcp", true, st({ for: "gcp", answer: { query: "gcp", results: res, truncated: true } }))).toMatchObject({ truncated: false });
  });
  it("in plain words, and with counts that do not look exact", () => {
    expect(truncatedText(500)).toBe("Showing the 500 closest. Add words or choose a filter to narrow it down.");
    expect(countText(12, true)).toBe("12+");
    expect(countText(0, true)).toBe("0");
    expect(countText(12)).toBe("12");
    expect(countWords(1, true)).toBe("at least 1 result");
    expect(countWords(3)).toBe("3 results");
    expect(countWords(0, true)).toBe("0 results");
  });
});

describe("asking the server", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  it("asks for 500 and reads whether more matched", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => { calls.push(url); return answer(200, { results: [{ kind: "process", id: "a", score: 1, hits: [] }], truncated: true }); });
    expect(await searchByMeaning("gcp project")).toEqual({ results: [{ kind: "process", id: "a", score: 1, hits: [] }], truncated: true });
    expect(calls).toEqual(["/api/search?q=gcp%20project&limit=500"]);
  });
  it("an older server: no `truncated`, and asked again for 100 when it refuses 500", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return url.endsWith("limit=500") ? answer(400, { error: "limit must be from 1 to 100" }) : answer(200, { results: [] });
    });
    expect(await searchByMeaning("gcp")).toEqual({ results: [], truncated: false });
    expect(calls).toEqual(["/api/search?q=gcp&limit=500", "/api/search?q=gcp&limit=100"]);
  });
  it("other refusals are passed on", async () => {
    vi.stubGlobal("fetch", async () => answer(429, { error: "You searched very often." }));
    await expect(searchByMeaning("gcp")).rejects.toMatchObject({ status: 429, message: "You searched very often." });
  });
});

describe("what Meaning is said to do", () => {
  it("is true for the provider in use, and cautious when it is not known", () => {
    expect(providerOf("builtin")).toBe("builtin");
    expect(providerOf("vertex")).toBe("vertex");
    expect(providerOf(undefined)).toBeUndefined();
    expect(providerOf("other")).toBeUndefined();
    expect(meaningHelp("builtin")).toContain("words and parts of words");
    expect(meaningHelp("builtin")).toContain("does not know that different words can mean the same thing");
    expect(meaningHelp("builtin")).not.toMatch(/other words|about what/);
    expect(meaningHelp("vertex")).toContain("even when they use other words");
    expect(meaningHelp(undefined)).toBe("puts first what comes closest to what you type, even when not every word is in it.");
  });
});

describe("emptyWithFilters", () => {
  it("says the filters hide what there is, and how much", () => {
    expect(emptyWithFilters("cloud", 1)).toBe("Nothing matches “cloud” with these filters. Without them there is 1 result.");
    expect(emptyWithFilters("cloud", 4)).toBe("Nothing matches “cloud” with these filters. Without them there are 4 results.");
    expect(emptyWithFilters("", 12)).toBe("Nothing matches these filters. Without them there are 12 results.");
  });
  it("says when nothing matches either way", () => {
    expect(emptyWithFilters("zebra quantum", 0)).toBe("Nothing matches “zebra quantum”, with or without these filters.");
    expect(emptyWithFilters("", 0)).toBe("Nothing matches these filters.");
  });
});
