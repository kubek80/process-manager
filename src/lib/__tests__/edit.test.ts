import { describe, expect, it } from "vitest";
import {
  addRequirement, addStepAfter, appliesTo, blankProcess, blankStandard, deleteRequirement, deleteStep, insertStep, moveRequirement, moveStep, nextRequirementId,
  renameStepId, slugify, tidy, tidyStandard, uniqueId, updateRequirement, updateStep,
} from "../edit";
import { hasErrors, validateProcess, validateStandard } from "../validate";
import { base, baseStandard } from "./fixtures";

const flow = (p: ReturnType<typeof base>) => p.steps.map((s) => `${s.id}>${s.next.map((n) => (n.label ? `${n.to}(${n.label})` : n.to)).join(",")}`).join(" ");
const spec = { title: "Check the budget", type: "review" as const, actor: "boss" };

describe("slugify and uniqueId", () => {
  it("makes kebab-case ids", () => {
    expect(slugify("  Fill in the ServiceNow request! ")).toBe("fill-in-the-servicenow-request");
    expect(slugify("Żółć & co_op")).toBe("zoc-co-op");
    expect(slugify("!!!")).toBe("");
    expect(slugify("a".repeat(100))).toHaveLength(60);
  });
  it("avoids taken ids", () => {
    expect(uniqueId("step", [])).toBe("step");
    expect(uniqueId("step", ["step", "step-2"])).toBe("step-3");
    expect(uniqueId("", ["item"])).toBe("item-2");
  });
});

describe("tidy", () => {
  it("drops empty optional fields but keeps required ones", () => {
    const p = base();
    p.category = "  ";
    p.tiers = [];
    p.languages = [];
    p.environments = [];
    p.standards = [];
    p.tags = ["", "gcp"];
    p.resources = [{ title: "", url: "" }, { title: "Repo", url: "https://x.example", description: "" }];
    p.steps[0] = { ...p.steps[0], tool: "", duration: " ", instructions: ["  Do it ", "", "  "], resources: [] };
    p.steps[1] = { ...p.steps[1], instructions: [""] };
    p.steps[2].next[0] = { to: "done", label: "" };
    p.replacedBy = "other";
    const t = tidy(p);
    expect(t).not.toHaveProperty("category");
    expect(t).not.toHaveProperty("tiers");
    expect(t).not.toHaveProperty("languages");
    expect(t).not.toHaveProperty("environments");
    expect(t).not.toHaveProperty("standards");
    expect(t).not.toHaveProperty("replacedBy"); // only meaningful when deprecated
    expect(t.tags).toEqual(["gcp"]);
    expect(t.resources).toEqual([{ title: "Repo", url: "https://x.example" }]);
    expect(t.steps[0]).not.toHaveProperty("tool");
    expect(t.steps[0]).not.toHaveProperty("resources");
    expect(t.steps[0].instructions).toEqual(["Do it"]);
    expect(t.steps[1]).not.toHaveProperty("instructions");
    expect(t.steps[2].next[0]).toEqual({ to: "done" });
    expect(t.title).toBe("Demo process");
  });
  it("keeps replacedBy on a deprecated process and does not change the input", () => {
    const p = { ...base(), status: "deprecated" as const, replacedBy: "other" };
    const copy = JSON.stringify(p);
    expect(tidy(p).replacedBy).toBe("other");
    expect(JSON.stringify(p)).toBe(copy);
  });
});

describe("changing the flow", () => {
  it("inserts on an arrow, keeping the branch label on the way in", () => {
    const { process, id } = insertStep(base(), { afterId: "ok", beforeId: "fix" }, spec);
    expect(id).toBe("check-the-budget");
    expect(flow(process)).toBe("ask>approve approve>ok ok>done(Yes),check-the-budget(No) check-the-budget>fix fix>approve done>");
    expect(process.steps.map((s) => s.id)[3]).toBe("check-the-budget"); // listed right after its source
    expect(validateProcess(process)).toEqual([]);
  });
  it("inserts after a step, taking over what followed", () => {
    const { process } = insertStep(base(), { afterId: "ask" }, spec);
    expect(flow(process)).toContain("ask>check-the-budget check-the-budget>approve");
  });
  it("adds a branch to a decision", () => {
    const { process } = insertStep(base(), { afterId: "ok" }, spec);
    expect(flow(process)).toContain("ok>done(Yes),fix(No),check-the-budget(Other) check-the-budget>");
  });
  it("gives a unique id and ignores an unknown source", () => {
    const once = insertStep(base(), { afterId: "ask" }, spec).process;
    expect(insertStep(once, { afterId: "ask" }, spec).id).toBe("check-the-budget-2");
    const p = base();
    expect(insertStep(p, { afterId: "nope" }, spec).process).toBe(p);
    expect(insertStep(base(), { afterId: "ask" }, { ...spec, title: "???" }).id).toBe("new-step");
  });

  it("addStepAfter appends, branches on decisions, and falls back to the last step", () => {
    expect(flow(addStepAfter(base(), "ask").process)).toContain("ask>new-step new-step>approve");
    expect(flow(addStepAfter(base(), "ok").process)).toContain("new-step(Other)");
    expect(flow(addStepAfter(base(), null).process)).toContain("done>new-step new-step>");
    expect(addStepAfter({ ...base(), steps: [] }, null).process.steps).toHaveLength(1);
    const r = addStepAfter(base(), "boss-step-that-is-missing");
    expect(r.process.steps.at(-1)!.id).toBe("new-step");
  });

  it("deleting a step reconnects its neighbours", () => {
    expect(flow(deleteStep(base(), "approve"))).toBe("ask>ok ok>done(Yes),fix(No) fix>ok done>");
    // removing a branch target carries the label over and never creates a self-loop or a duplicate
    expect(flow(deleteStep(base(), "fix"))).toBe("ask>approve approve>ok ok>done(Yes),approve(No) done>");
    const p = base();
    expect(deleteStep(p, "nope")).toBe(p);
    const single = { ...base(), steps: [base().steps[4]] };
    expect(deleteStep(single, "done")).toBe(single);
  });

  it("moveStep reorders the list only", () => {
    const moved = moveStep(base(), "fix", -1);
    expect(moved.steps.map((s) => s.id)).toEqual(["ask", "approve", "fix", "ok", "done"]);
    expect(flow(moved)).toContain("fix>approve");
    const p = base();
    expect(moveStep(p, "ask", -1)).toBe(p);
    expect(moveStep(p, "done", 1)).toBe(p);
    expect(moveStep(p, "nope", 1)).toBe(p);
  });

  it("renameStepId updates every reference", () => {
    const { process, id } = renameStepId(base(), "approve", "manager-approves");
    expect(id).toBe("manager-approves");
    expect(flow(process)).toBe("ask>manager-approves manager-approves>ok ok>done(Yes),fix(No) fix>manager-approves done>");
    expect(renameStepId(base(), "approve", "ask").id).toBe("ask-2");
    const p = base();
    expect(renameStepId(p, "approve", "approve").process).toBe(p);
  });

  it("updateStep patches one step", () => {
    const p = updateStep(base(), "ask", { actor: "boss" });
    expect(p.steps[0].actor).toBe("boss");
    expect(p.steps[1].actor).toBe("boss");
    expect(base().steps[0].actor).toBe("me");
  });
});

describe("blankProcess", () => {
  it("is a valid draft with a fresh id", () => {
    const p = blankProcess(["new-process"]);
    expect(p.id).toBe("new-process-2");
    expect(p.status).toBe("draft");
    expect(hasErrors(validateProcess(p))).toBe(false);
  });
});

describe("standards", () => {
  it("tidyStandard drops what is empty and keeps what is required", () => {
    const s = baseStandard();
    s.scope = " ";
    s.tiers = [];
    s.tags = ["", "logs"];
    s.replacedBy = "other";
    s.requirements[0] = { ...s.requirements[0], guidance: ["  Do it ", ""], examples: { good: ["", "  ok()  \n"], bad: [] }, review: { lookFor: ["", "  A sign "], paths: [" ", "**/*.go"], severity: undefined }, tiers: [], rationale: "" };
    s.requirements[1] = { ...s.requirements[1], review: { lookFor: ["", " "] }, examples: { good: [], bad: [""] }, verification: { method: "automated", description: "" } };
    const t = tidyStandard(s);
    expect(t).not.toHaveProperty("scope");
    expect(t).not.toHaveProperty("tiers");
    expect(t).not.toHaveProperty("replacedBy");
    expect(t.tags).toEqual(["logs"]);
    expect(t.requirements[0].guidance).toEqual(["Do it"]);
    expect(t.requirements[0].examples).toEqual({ good: ["  ok()"] }); // leading spaces are part of code
    expect(t.requirements[0].review).toEqual({ lookFor: ["A sign"], paths: ["**/*.go"] });
    expect(t.requirements[0]).not.toHaveProperty("rationale");
    expect(t.requirements[0]).not.toHaveProperty("tiers");
    expect(t.requirements[1]).not.toHaveProperty("review"); // nothing to look for: no review block
    expect(t.requirements[1]).not.toHaveProperty("examples");
    expect(t.requirements[1].verification).toEqual({ method: "automated" });
    expect(hasErrors(validateStandard(t))).toBe(false);
  });

  it("numbers new requirements after the last one, keeping the prefix and width", () => {
    expect(nextRequirementId(baseStandard())).toBe("DEMO-03");
    const s = baseStandard();
    s.requirements[1].id = "SEC-LOG-009";
    expect(nextRequirementId(s)).toBe("SEC-LOG-010");
    s.requirements.push({ ...s.requirements[0], id: "SEC-LOG-010" }, { ...s.requirements[0], id: "SEC-LOG-009" });
    s.requirements[1].id = "SEC-LOG-011";
    expect(nextRequirementId(s)).toBe("SEC-LOG-012"); // skips ids that are taken
    s.requirements = [{ ...s.requirements[0], id: "ODD" }];
    expect(nextRequirementId(s)).toBe("ODD-01");
    expect(nextRequirementId({ ...baseStandard(), requirements: [] })).toBe("REQ-01");
  });

  it("adds, changes, moves and deletes requirements", () => {
    const added = addRequirement(baseStandard(), "DEMO-01");
    expect(added.id).toBe("DEMO-03");
    expect(added.standard.requirements.map((r) => r.id)).toEqual(["DEMO-01", "DEMO-03", "DEMO-02"]);
    expect(addRequirement(baseStandard()).standard.requirements.at(-1)!.id).toBe("DEMO-03");
    expect(hasErrors(validateStandard(added.standard))).toBe(false);

    expect(updateRequirement(baseStandard(), "DEMO-02", { level: "may" }).requirements[1].level).toBe("may");
    expect(moveRequirement(baseStandard(), "DEMO-02", -1).requirements.map((r) => r.id)).toEqual(["DEMO-02", "DEMO-01"]);
    const s = baseStandard();
    expect(moveRequirement(s, "DEMO-01", -1)).toBe(s);
    expect(moveRequirement(s, "DEMO-02", 1)).toBe(s);
    expect(moveRequirement(s, "nope", 1)).toBe(s);
    expect(deleteRequirement(s, "DEMO-01").requirements.map((r) => r.id)).toEqual(["DEMO-02"]);
    const one = { ...s, requirements: [s.requirements[0]] };
    expect(deleteRequirement(one, "DEMO-01")).toBe(one); // a standard keeps at least one
  });

  it("blankStandard is a valid draft for the given unit", () => {
    const s = blankStandard(["new-standard"], "security");
    expect(s).toMatchObject({ id: "new-standard-2", status: "draft", owner: "security" });
    expect(hasErrors(validateStandard(s))).toBe(false);
  });
});

describe("appliesTo", () => {
  const doc = { tiers: ["tier-0", "tier-1"], environments: ["production"] };
  it("everything applies when nothing is asked", () => expect(appliesTo(doc, {})).toBe(true));
  it("something without limits applies everywhere", () => expect(appliesTo({}, { tier: "tier-3", language: "go", environment: "test" })).toBe(true));
  it("checks every dimension that is asked", () => {
    expect(appliesTo(doc, { tier: "tier-0" })).toBe(true);
    expect(appliesTo(doc, { tier: "tier-3" })).toBe(false);
    expect(appliesTo(doc, { tier: "tier-0", environment: "test" })).toBe(false);
    expect(appliesTo(doc, { tier: "tier-1", environment: "production", language: "python" })).toBe(true); // no language limit
    expect(appliesTo({ tiers: [] }, { tier: "tier-3" })).toBe(true); // an empty list means all
  });
});
