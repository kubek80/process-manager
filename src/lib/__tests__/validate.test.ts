import { describe, expect, it } from "vitest";
import { extractJson, hasErrors, validateCatalog, validateProcess } from "../validate";
import { aiFlow, automationFlow, feedbackFlow, followFlow, reviewFlow } from "../../guide/flows";
import { base, catalog, example, processFiles, processes } from "./fixtures";

const ctx = { processIds: processes.map((p) => p.id), catalog };
const find = (issues: ReturnType<typeof validateProcess>, path: string) => issues.filter((i) => i.path === path);

describe("the content in the repository", () => {
  it("has a valid catalog", () => expect(validateCatalog(catalog)).toEqual([]));

  it.each(processes.map((p, i) => [processFiles[i], p] as const))("%s is valid with no warnings and matches its file name", (file, p) => {
    expect(validateProcess(p, ctx)).toEqual([]);
    expect(file).toBe(`${p.id}.json`);
  });

  it("has a valid prompt example and valid guide flows", () => {
    for (const p of [example, followFlow, aiFlow, feedbackFlow, reviewFlow, automationFlow]) expect(hasErrors(validateProcess(p)), p.id).toBe(false);
  });
});

describe("schema errors are explained in plain words", () => {
  const check = (mutate: (p: any) => void) => { const p: any = base(); mutate(p); return validateProcess(p); };

  it("missing field", () => expect(check((p) => delete p.title)[0]).toMatchObject({ level: "error", path: "(root)", message: 'is missing the required field "title"' }));
  it("unknown field", () => expect(check((p) => (p.steps[0].colour = "red"))[0].message).toContain('"colour" that the schema does not allow'));
  it("unknown step type", () => expect(check((p) => (p.steps[0].type = "magic"))[0]).toMatchObject({ path: "steps[0].type" }));
  it("bad id", () => expect(check((p) => (p.steps[0].id = "Ask It"))[0].message).toContain("kebab-case"));
  it("bad link", () => expect(check((p) => (p.steps[0].url = "servicenow"))[0].message).toContain("http://"));
  it("first actor must be me", () => expect(hasErrors(check((p) => (p.actors[0].id = "requester")))).toBe(true));
  it("too short", () => expect(check((p) => (p.title = "x"))[0].message).toContain("too short"));
  it("wrong type", () => expect(check((p) => (p.steps = "none"))[0].message).toContain("must be of type array"));
  it("wrong version", () => expect(check((p) => (p.schemaVersion = "2.0"))[0].message).toContain('exactly "1.0"'));
  it("empty steps", () => expect(check((p) => (p.steps = []))[0].message).toContain("at least 1"));
  it("bad status", () => expect(check((p) => (p.status = "live"))[0].message).toContain("draft, active, deprecated"));
  it("not an object at all", () => expect(hasErrors(validateProcess("nope"))).toBe(true));
  it("reports each problem once", () => {
    const issues = check((p) => { delete p.title; delete p.summary; });
    expect(issues).toHaveLength(2);
  });
});

describe("rules the schema cannot express", () => {
  const check = (mutate: (p: any) => void, c = ctx) => { const p: any = base(); mutate(p); return validateProcess(p, c); };

  it("a clean process has no findings", () => expect(check(() => {})).toEqual([]));
  it("unknown actor", () => expect(find(check((p) => (p.steps[1].actor = "nobody")), "steps[1].actor")[0]).toMatchObject({ level: "error" }));
  it("unknown next step", () => expect(find(check((p) => (p.steps[0].next[0].to = "nowhere")), "steps[0].next[0].to")).toHaveLength(1));
  it("step pointing to itself", () => expect(check((p) => (p.steps[0].next[0].to = "ask")).some((i) => i.message.includes("itself"))).toBe(true));
  it("same target twice", () => expect(check((p) => p.steps[0].next.push({ to: "approve" })).some((i) => i.message.includes("listed twice"))).toBe(true));
  it("duplicate step id", () => expect(check((p) => (p.steps[3].id = "ask")).some((i) => i.message.includes('duplicate step id "ask"'))).toBe(true));
  it("duplicate actor id", () => expect(check((p) => p.actors.push({ id: "boss", name: "Other" })).some((i) => i.message.includes("duplicate actor id"))).toBe(true));
  it("decision needs two paths", () => expect(check((p) => p.steps[2].next.pop()).some((i) => i.message.includes("at least two outgoing paths"))).toBe(true));
  it("decision paths need labels", () => expect(check((p) => delete p.steps[2].next[0].label).some((i) => i.message.includes("needs a label"))).toBe(true));
  it("subprocess needs a process", () => expect(find(check((p) => (p.steps[0].type = "subprocess")), "steps[0].subProcessId")[0].level).toBe("error"));
  it("unknown sub-process is a warning", () => expect(find(check((p) => (p.steps[0].subProcessId = "not-written-yet")), "steps[0].subProcessId")[0].level).toBe("warning"));
  it("known sub-process is fine", () => expect(check((p) => (p.steps[0].subProcessId = "raise-servicenow-request"))).toEqual([]));
  it("cannot be its own sub-process or prerequisite", () => {
    expect(hasErrors(check((p) => (p.steps[0].subProcessId = "demo")))).toBe(true);
    expect(hasErrors(check((p) => p.prerequisites.push({ title: "Itself", processId: "demo" })))).toBe(true);
  });
  it("unknown prerequisite process is a warning", () => expect(check((p) => p.prerequisites.push({ title: "Later", processId: "later" }))[0].level).toBe("warning"));
  it("my steps need instructions", () => expect(check((p) => delete p.steps[0].instructions)[0]).toMatchObject({ level: "warning", path: "steps[0].instructions" }));
  it("actor without steps", () => expect(check((p) => p.actors.push({ id: "idle", name: "Idle" }))[0].message).toContain("has no steps"));
  it("unreachable step", () => expect(check((p) => p.steps.push({ id: "island", title: "Island", actor: "boss", type: "task", next: [] })).some((i) => i.message.includes("cannot be reached"))).toBe(true));
  it("process that never ends", () => expect(check((p) => (p.steps[4].next = [{ to: "ask" }])).some((i) => i.message.includes("never ends"))).toBe(true));

  it("catalog references", () => {
    expect(find(check((p) => (p.owner = "ghost-team")), "owner")[0].level).toBe("warning");
    expect(find(check((p) => (p.steps[0].tool = "abacus")), "steps[0].tool")[0].level).toBe("warning");
    expect(find(check((p) => (p.actors[1].teamId = "ghost-team")), "actors[1].teamId")[0].level).toBe("warning");
    expect(find(check((p) => (p.tiers = ["tier-9"])), "tiers[0]")[0].level).toBe("error");
    expect(find(check((p) => (p.languages = ["cobol"])), "languages[0]")[0].level).toBe("error");
    expect(check((p) => { p.tiers = ["tier-0"]; p.languages = ["go"]; p.steps[0].tool = "servicenow"; })).toEqual([]);
  });
  it("skips catalog checks without a catalog", () => expect(validateProcess({ ...base(), tiers: ["tier-9"], owner: "ghost" })).toEqual([]));

  it("life-cycle", () => {
    expect(find(check((p) => delete p.review), "review")[0].level).toBe("warning");
    expect(find(check((p) => delete p.owner), "owner")[0].level).toBe("warning");
    expect(check((p) => { p.status = "draft"; delete p.review; delete p.owner; })).toEqual([]);
    expect(find(check((p) => (p.replacedBy = "request-gcp-project")), "replacedBy")[0].message).toContain("deprecated");
    expect(check((p) => { p.status = "deprecated"; p.replacedBy = "request-gcp-project"; })).toEqual([]);
    expect(hasErrors(check((p) => { p.status = "deprecated"; p.replacedBy = "demo"; }))).toBe(true);
    expect(find(check((p) => { p.status = "deprecated"; p.replacedBy = "gone"; }), "replacedBy")[0].level).toBe("warning");
  });
});

describe("catalog checks", () => {
  it("rejects a wrong shape", () => expect(hasErrors(validateCatalog({ teams: [] }))).toBe(true));
  it("rejects duplicate ids", () => {
    const issues = validateCatalog({ ...catalog, tools: [...catalog.tools, catalog.tools[0]] });
    expect(issues[0].message).toContain("duplicate id");
  });
});

describe("extractJson", () => {
  it("reads plain JSON", () => expect(extractJson('{"a":1}')).toEqual({ value: { a: 1 } }));
  it("reads a fenced block inside chatter", () => expect(extractJson('Sure!\n```json\n{"a":[1,2]}\n```\nAnything else?').value).toEqual({ a: [1, 2] }));
  it("reads an unlabelled fence", () => expect(extractJson('```\n{"a":1}\n```').value).toEqual({ a: 1 }));
  it("reads JSON surrounded by text", () => expect(extractJson('Here: {"a":1} done').value).toEqual({ a: 1 }));
  it("explains empty input", () => expect(extractJson("  ").error).toContain("Nothing pasted"));
  it("explains missing JSON", () => expect(extractJson("no braces here").error).toContain("No JSON object"));
  it("explains broken JSON", () => expect(extractJson('{"a":}').error).toContain("not valid JSON"));
});

describe("isWellFormed", () => {
  it("accepts a process with logic problems but rejects a wrong shape", async () => {
    const { isWellFormed } = await import("../validate");
    const p: any = base();
    p.steps[2].next = []; // a decision without paths: wrong, but drawable
    expect(isWellFormed(p)).toBe(true);
    expect(hasErrors(validateProcess(p))).toBe(true);
    delete p.steps;
    expect(isWellFormed(p)).toBe(false);
    expect(isWellFormed(null)).toBe(false);
  });
});
