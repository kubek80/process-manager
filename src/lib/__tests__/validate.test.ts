import { describe, expect, it } from "vitest";
import { extractJson, hasErrors, isDrawableProcess, isDrawableStandard, validateCatalog, validateProcess, validateStandard } from "../validate";
import * as guideFlows from "../../guide/flows";
import { base, baseStandard, catalog, example, processFiles, processes, standardExample, standardFiles, standards } from "./fixtures";

const ctx = { processIds: processes.map((p) => p.id), standardIds: standards.map((s) => s.id), catalog };
const find = (issues: ReturnType<typeof validateProcess>, path: string) => issues.filter((i) => i.path === path);

describe("the content in the repository", () => {
  it("has a valid catalog", () => expect(validateCatalog(catalog)).toEqual([]));

  it.each(processes.map((p, i) => [processFiles[i], p] as const))("%s is valid with no warnings and matches its file name", (file, p) => {
    expect(validateProcess(p, ctx)).toEqual([]);
    expect(file).toBe(`${p.id}.json`);
  });

  it.each(standards.map((s, i) => [standardFiles[i], s] as const))("standard %s is valid with no warnings and matches its file name", (file, s) => {
    expect(validateStandard(s, ctx)).toEqual([]);
    expect(file).toBe(`${s.id}.json`);
  });

  it("has valid prompt examples", () => {
    expect(hasErrors(validateProcess(example))).toBe(false);
    expect(hasErrors(validateStandard(standardExample, ctx))).toBe(false);
  });

  // every flow chart in the guide is a process; a new one is checked without touching this test
  it.each(Object.entries(guideFlows))("guide flow chart %s is a valid process", (_name, flow) => {
    expect(validateProcess(flow).filter((i) => i.level === "error")).toEqual([]);
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
  it("the first actor is a complete actor like every other", () => {
    expect(check((p) => delete p.actors[0].name)[0]).toMatchObject({ level: "error", path: "actors[0]", message: expect.stringContaining('"name"') });
    expect(check((p) => (p.actors[0].colour = "red"))[0]).toMatchObject({ level: "error", path: "actors[0]", message: expect.stringContaining('"colour"') });
    expect(check((p) => (p.actors[0].name = ""))[0]).toMatchObject({ level: "error", path: "actors[0].name" });
    expect(check((p) => (p.actors[0] = "me"))[0]).toMatchObject({ level: "error", path: "actors[0]" });
    // the same holds for the second, which the schema already checked
    expect(check((p) => delete p.actors[1].name)[0]).toMatchObject({ level: "error", path: "actors[1]" });
    // and a complete first actor passes, with or without the optional fields
    expect(check((p) => (p.actors[0] = { id: "me", name: "You", description: "The requester" }))).toEqual([]);
  });
  it("too short", () => expect(check((p) => (p.title = "x"))[0].message).toContain("too short"));
  it("a name that must not be empty is said to be empty, not “minimum 1 characters”", () =>
    expect(check((p) => (p.actors[1].name = ""))[0]).toMatchObject({ path: "actors[1].name", message: "is empty" }));
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
  it("same target twice", () => expect(check((p) => p.steps[0].next.push({ to: "approve" })).some((i) => i.message.includes("already leads to this step"))).toBe(true));
  it("duplicate step id", () => expect(check((p) => (p.steps[3].id = "ask")).some((i) => i.message.includes("Two steps have the same id “ask”"))).toBe(true));
  it("duplicate actor id", () => expect(check((p) => p.actors.push({ id: "boss", name: "Other" })).some((i) => i.message.includes("Two participants have the same id"))).toBe(true));
  it("decision needs two paths", () => expect(check((p) => p.steps[2].next.pop()).some((i) => i.message.includes("at least two answers"))).toBe(true));
  it("decision paths need labels", () => expect(check((p) => delete p.steps[2].next[0].label).some((i) => i.message.includes("needs a name"))).toBe(true));
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
  it("environments and standards", () => {
    expect(find(check((p) => (p.environments = ["moon"])), "environments[0]")[0].level).toBe("error");
    expect(check((p) => (p.environments = ["production"]))).toEqual([]);
    expect(find(check((p) => (p.standards = ["not-written-yet"])), "standards[0]")[0].level).toBe("warning");
    expect(check((p) => (p.standards = ["secure-logging"]))).toEqual([]);
  });

  it("life-cycle", () => {
    expect(find(check((p) => delete p.review), "review")[0].level).toBe("warning");
    expect(find(check((p) => delete p.owner), "owner")[0].level).toBe("warning");
    expect(check((p) => { p.status = "draft"; delete p.review; delete p.owner; })).toEqual([]);
    expect(find(check((p) => (p.replacedBy = "request-gcp-project")), "replacedBy")[0].message).toContain("only counts for a retired");
    expect(check((p) => { p.status = "deprecated"; p.replacedBy = "request-gcp-project"; })).toEqual([]);
    expect(hasErrors(check((p) => { p.status = "deprecated"; p.replacedBy = "demo"; }))).toBe(true);
    expect(find(check((p) => { p.status = "deprecated"; p.replacedBy = "gone"; }), "replacedBy")[0].level).toBe("warning");
  });

  it("category, practice and platform must be in their lists, and the message names the known ones", () => {
    for (const [field, list] of [["category", "categories"], ["practice", "practices"], ["platform", "platforms"]] as const) {
      const [issue] = find(check((p) => (p[field] = "nowhere")), field);
      expect(issue.level).toBe("error");
      expect(issue.message).toContain(`“nowhere” is not one of the ${list}`);
    }
    expect(check((p) => { p.category = "cloud"; p.practice = "engineering"; p.platform = "google-cloud"; p.rigour = "recommended"; })).toEqual([]);
    // a team id is not a practice: the lists are separate
    expect(find(check((p) => (p.practice = "cloud-platform-team")), "practice")[0].level).toBe("error");
    expect(find(check((p) => (p.category = "x"), { ...ctx, catalog: { ...catalog, categories: [] } }), "category")[0].message).toContain("(the list is empty)");
  });

  it("rigour is one of three words", () => {
    expect(hasErrors(check((p) => (p.rigour = "must")))).toBe(true);
    for (const r of ["mandatory", "recommended", "optional"]) expect(check((p) => (p.rigour = r))).toEqual([]);
  });

  it("works with lists from an older file that has no practices, platforms or categories", () => {
    const old = { ...catalog, practices: undefined, platforms: undefined, categories: undefined } as never;
    expect(find(check((p) => (p.platform = "azure"), { ...ctx, catalog: old }), "platform")[0].message).toContain("(the list is empty)");
    expect(validateCatalog({ ...catalog, practices: undefined, platforms: undefined, categories: undefined })).toEqual([]);
  });
});

describe("catalog checks", () => {
  it("rejects a wrong shape", () => expect(hasErrors(validateCatalog({ teams: [] }))).toBe(true));
  it("rejects duplicate ids", () => {
    const issues = validateCatalog({ ...catalog, tools: [...catalog.tools, catalog.tools[0]] });
    expect(issues[0].message).toContain("duplicate id");
    for (const key of ["practices", "platforms", "categories"] as const) {
      const [issue] = validateCatalog({ ...catalog, [key]: [...catalog[key], catalog[key][0]] });
      expect(issue).toMatchObject({ level: "error", path: `${key}[${catalog[key].length}].id` });
    }
  });
  it("lets a team, a practice and a platform share an id", () => {
    expect(catalog.teams.some((t) => t.id === "security") && catalog.practices.some((t) => t.id === "security")).toBe(true);
    expect(validateCatalog({ ...catalog, platforms: [...catalog.platforms, { id: "security", name: "Security platform" }] })).toEqual([]);
  });
  it("teams have no kind any more", () => {
    expect(hasErrors(validateCatalog({ ...catalog, teams: [{ id: "x", name: "X", kind: "platform" }] }))).toBe(true);
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

describe("can it be drawn?", () => {
  it("a process with problems can still be drawn, so it is fixed in the editor and not in the JSON tab", () => {
    const p: any = base();
    p.steps[2].next = []; // a decision without paths
    p.steps[0].title = ""; // a name being retyped
    p.steps[1].actor = "nobody";
    expect(hasErrors(validateProcess(p))).toBe(true);
    expect(isDrawableProcess(p)).toBe(true);
    for (const real of processes) expect(isDrawableProcess(real), real.id).toBe(true);
  });
  it("a process without the structure the map needs cannot", () => {
    const broken: ((p: any) => void)[] = [
      (p) => delete p.steps, (p) => (p.steps = []), (p) => (p.steps[0].type = "magic"), (p) => delete p.steps[0].next, (p) => (p.steps[0].next = [{}]),
      (p) => (p.actors = []), (p) => delete p.actors[0].name, (p) => delete p.prerequisites, (p) => (p.steps[0].instructions = "do it"), (p) => (p.tiers = "tier-0"),
      (p) => delete p.title, (p) => (p.steps[0].resources = [{ title: "x" }]),
    ];
    for (const mutate of broken) { const p: any = base(); mutate(p); expect(isDrawableProcess(p), mutate.toString()).toBe(false); }
    for (const v of [null, "nope", [], 7]) expect(isDrawableProcess(v)).toBe(false);
  });
  it("the same for a standard", () => {
    const s: any = baseStandard();
    s.requirements[1].id = "DEMO-01"; // duplicate
    s.requirements[0].title = "x"; // too short
    expect(hasErrors(validateStandard(s))).toBe(true);
    expect(isDrawableStandard(s)).toBe(true);
    for (const real of standards) expect(isDrawableStandard(real), real.id).toBe(true);
    const broken: ((s: any) => void)[] = [
      (s) => delete s.requirements, (s) => (s.requirements = []), (s) => (s.requirements[0].level = "always"), (s) => delete s.requirements[0].verification,
      (s) => (s.requirements[0].verification.method = "magic"), (s) => (s.requirements[0].review = {}), (s) => (s.requirements[0].examples = { good: "ok" }),
      (s) => delete s.owner, (s) => (s.requirements[0].guidance = "do it"),
    ];
    for (const mutate of broken) { const x: any = baseStandard(); mutate(x); expect(isDrawableStandard(x), mutate.toString()).toBe(false); }
    expect(isDrawableStandard(null)).toBe(false);
  });
});

describe("standards", () => {
  const check = (mutate: (s: any) => void, c = ctx) => { const s: any = baseStandard(); mutate(s); return validateStandard(s, c); };

  it("a clean standard has no findings", () => expect(check(() => {})).toEqual([]));
  it("explains schema errors in plain words", () => {
    expect(check((s) => delete s.owner)[0]).toMatchObject({ level: "error", message: 'is missing the required field "owner"' });
    expect(check((s) => (s.requirements[0].id = "demo-1"))[0].message).toContain('upper case with dashes');
    expect(check((s) => (s.requirements[0].level = "always"))[0].message).toContain("must, should, may");
    expect(check((s) => (s.requirements = []))[0].message).toContain("at least 1");
    expect(check((s) => (s.requirements[0].verification = {}))[0].message).toContain('"method"');
    expect(check((s) => (s.requirements[0].review = { lookFor: [] }))[0].message).toContain("at least 1");
    expect(hasErrors(validateStandard("nope"))).toBe(true);
  });
  it("requirement ids are unique", () => expect(check((s) => (s.requirements[1].id = "DEMO-01")).some((i) => i.message.includes("Two requirements have the id DEMO-01"))).toBe(true));
  it("the owner is any team from the list", () => {
    expect(find(check((s) => (s.owner = "ghost")), "owner")[0].message).toContain("not in the list of teams");
    expect(find(check((s) => (s.owner = "ghost")), "owner")[0].level).toBe("warning");
    expect(check((s) => (s.owner = "dns-team"))).toEqual([]);
  });
  it("category, practice and platform must be in their lists", () => {
    expect(find(check((s) => (s.platform = "moon")), "platform")[0]).toMatchObject({ level: "error" });
    expect(find(check((s) => (s.practice = "moon")), "practice")[0].message).toContain("“moon” is not one of the practices");
    expect(find(check((s) => (s.category = "moon")), "category")[0].level).toBe("error");
    expect(check((s) => { s.category = "security"; s.practice = "security"; s.platform = "github"; })).toEqual([]);
    expect(hasErrors(check((s) => (s.rigour = "mandatory")))).toBe(true); // a standard's rigour follows from its requirements
  });
  it("tiers, languages and environments must exist, on the standard and on a requirement", () => {
    expect(find(check((s) => (s.tiers = ["tier-9"])), "tiers[0]")[0].level).toBe("error");
    expect(find(check((s) => (s.requirements[0].environments = ["moon"])), "requirements[0].environments[0]")[0].level).toBe("error");
    expect(check((s) => { s.environments = ["production"]; s.requirements[0].languages = ["go"]; })).toEqual([]);
  });
  it("a requirement cannot be wider than its standard", () => {
    const issues = check((s) => { s.environments = ["production"]; s.requirements[0].environments = ["production", "test"]; });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: "warning", path: "requirements[0].environments[1]" });
  });
  it("warns when a review-checked rule gives reviewers nothing to look for", () =>
    expect(find(check((s) => delete s.requirements[0].review), "requirements[0].review")[0].message).toContain("cannot be checked in pull requests"));
  it("warns when a mandatory rule gives neither a reason nor how to comply", () =>
    expect(find(check((s) => delete s.requirements[0].rationale), "requirements[0].guidance")[0].level).toBe("warning"));
  it("references to processes and other standards", () => {
    expect(find(check((s) => (s.exceptionProcessId = "later")), "exceptionProcessId")[0].level).toBe("warning");
    expect(find(check((s) => (s.requirements[0].processId = "later")), "requirements[0].processId")[0].level).toBe("warning");
    expect(check((s) => { s.exceptionProcessId = "raise-servicenow-request"; s.requirements[0].processId = "request-gcp-project"; })).toEqual([]);
  });
  it("life-cycle", () => {
    expect(find(check((s) => delete s.review), "review")[0].level).toBe("warning");
    expect(check((s) => { s.status = "draft"; delete s.review; })).toEqual([]);
    expect(find(check((s) => (s.replacedBy = "secure-logging")), "replacedBy")[0].message).toContain("only counts for a retired");
    expect(hasErrors(check((s) => { s.status = "deprecated"; s.replacedBy = "demo-standard"; }))).toBe(true);
    expect(check((s) => { s.status = "deprecated"; s.replacedBy = "secure-logging"; })).toEqual([]);
  });
  it("skips list checks without a catalog", () => expect(validateStandard({ ...baseStandard(), owner: "ghost", tiers: ["tier-9"] })).toEqual([]));
});

describe("the generated checks", () => {
  it("are up to date with the schemas (run `npm run validators` after changing a schema)", async () => {
    const fs = await import("node:fs");
    const { generate, target } = await import("../../../scripts/validators");
    expect(fs.readFileSync(target, "utf8")).toBe(generate());
  });
  it("need nothing the browser's security policy forbids", async () => {
    const fs = await import("node:fs");
    const { target } = await import("../../../scripts/validators");
    const code = fs.readFileSync(target, "utf8");
    expect(code).not.toMatch(/\beval\(|new Function|\brequire\(/);
  });
});

describe("a review date has to be a date", () => {
  it("is an error in a process and in a standard", () => {
    const p = { ...base(), review: { intervalMonths: 6, lastReviewedAt: "2026-13-45" } };
    expect(validateProcess(p).filter((i) => i.level === "error").map((i) => `${i.path}: ${i.message}`)).toEqual(["review.lastReviewedAt: The date of the last review, “2026-13-45”, is not a date."]);
    const s = { ...baseStandard(), review: { intervalMonths: 12, lastReviewedAt: "2026-02-30" } };
    expect(validateStandard(s).filter((i) => i.level === "error").map((i) => i.path)).toEqual(["review.lastReviewedAt"]);
    expect(hasErrors(validateProcess(base()))).toBe(false);
  });
});

describe("which steps are asked to say exactly what to do", () => {
  it("one rule: the reader's steps done by hand; never a decision, a wait, an automated step or a sub-process", () => {
    const p = base();
    const kinds = ["task", "form", "decision", "wait", "automation", "verify"] as const;
    p.steps = kinds.map((type, i) => ({ id: `s${i}`, title: `Step ${i}`, actor: "me", type, next: i < kinds.length - 1 ? [{ to: `s${i + 1}`, ...(type === "decision" ? { label: "Yes" } : {}) }, ...(type === "decision" ? [{ to: "s0", label: "No" }] : [])] : [] }));
    const asked = validateProcess(p).filter((i) => i.path.endsWith(".instructions")).map((i) => p.steps[Number(i.path.match(/\d+/)![0])].type);
    expect(asked).toEqual(["task", "form", "verify"]);
    // somebody else's step: not asked
    p.steps[0].actor = "boss";
    expect(validateProcess(p).some((i) => i.path === "steps[0].instructions")).toBe(false);
  });
});

describe("an empty text", () => {
  it("is said to be empty, not too short", () => {
    const p = { ...base(), prerequisites: [{ title: "" }, { title: "ab" }] };
    const issues = validateProcess(p).filter((i) => i.path.startsWith("prerequisites"));
    expect(issues.map((i) => [i.path, i.message])).toEqual([["prerequisites[0].title", "is empty"], ["prerequisites[1].title", "is too short (minimum 3 characters)"]]);
  });
});
