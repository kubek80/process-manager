import { describe, expect, it } from "vitest";
import {
  addRequirement, addStepAfter, appliesTo, blankProcess, blankStandard, deleteRequirement, deleteStep, insertStep, moveRequirement, moveStep, nextRequirementId,
  prerequisiteKeys, renameStepId, slugify, tidy, tidyStandard, uniqueId, updateRequirement, updateStep,
} from "../edit";
import { hasErrors, isDrawableProcess, isDrawableStandard, validateProcess, validateStandard } from "../validate";
import type { Process, Standard } from "../../types";
import { base, baseStandard, catalog } from "./fixtures";

const flow = (p: ReturnType<typeof base>) => p.steps.map((s) => `${s.id}>${s.next.map((n) => (n.label ? `${n.to}(${n.label})` : n.to)).join(",")}`).join(" ");
const spec = { title: "Check the budget", type: "review" as const, actor: "boss" };

describe("slugify and uniqueId", () => {
  it("makes kebab-case ids", () => {
    expect(slugify("  Fill in the ServiceNow request! ")).toBe("fill-in-the-servicenow-request");
    expect(slugify("Żółć & co_op")).toBe("zoc-co-op");
    expect(slugify("!!!")).toBe("");
    expect(slugify("a".repeat(100))).toHaveLength(60);
  });
  it("never ends with a dash, also when a long title is cut in the middle of a word break", () => {
    const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    // the 60th character is the space before "now": cutting there must not leave "…-"
    const cut = slugify(`${"a".repeat(59)} now and then`);
    expect(cut).toBe("a".repeat(59));
    for (const title of [
      "Ask the platform team to create the production namespace for - the new service",
      `${"word ".repeat(11)}tail - end of a very long title`,
      `${"x".repeat(58)} - y`, `${"x".repeat(59)}- y`, `${"x".repeat(60)} y`, "- - -", "a -", "-a-",
    ]) {
      const slug = slugify(title);
      expect(slug.length).toBeLessThanOrEqual(60);
      if (slug) expect(slug, title).toMatch(SLUG);
    }
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
  it("passes a document that is not complete through instead of failing on it", () => {
    // what a broken stored document or an old revision can look like; the page then offers the JSON tab
    const broken: unknown[] = [
      { id: "x", title: "No lists at all" },
      { id: "x", title: "Wrong kinds", prerequisites: "none", actors: null, steps: {}, tags: "a,b", resources: "link" },
      { id: "x", title: "Odd entries", prerequisites: [null, "text"], actors: [7], steps: [null, "step", { id: "s" }, { id: "t", next: "end", instructions: "do it", resources: [null, {}] }] },
    ];
    for (const doc of broken) {
      const out = tidy(doc as Process);
      expect(out.title).toBe((doc as Process).title);
      expect(isDrawableProcess(out)).toBe(false);
      expect(hasErrors(validateProcess(out))).toBe(true); // and the checker still explains what is wrong
    }
    expect(tidy({ id: "x", steps: [{ id: "s", next: [{ to: "t", label: "" }] }] } as unknown as Process).steps[0].next).toEqual([{ to: "t" }]);
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

  it("deleting a decision leaves its path names with decisions only", () => {
    // ask > approve > ok? (Yes: done, No: fix): without the decision, "approve" simply leads to both, unnamed
    expect(flow(deleteStep(base(), "ok"))).toBe("ask>approve approve>done,fix fix>approve done>");
    // a named way in does not put its name on every path it inherits
    const named = base();
    named.steps[1].next = [{ to: "ok", label: "Checked" }];
    expect(flow(deleteStep(named, "ok"))).toContain("approve>done,fix ");
    // ... but one way in and one way out keeps the name of the way in
    expect(flow(deleteStep(named, "approve"))).toContain("ask>ok ");
    const one = base();
    one.steps[0].next = [{ to: "approve", label: "Send" }];
    expect(flow(deleteStep(one, "approve"))).toContain("ask>ok(Send) ");
  });
  it("a decision that takes over the paths of a deleted decision keeps every name once", () => {
    const p = base();
    // first? (Yes: ok, No: done); ok? (Yes: done, No: fix)
    p.steps[1] = { ...p.steps[1], type: "decision", next: [{ to: "ok", label: "Yes" }, { to: "done", label: "No" }] };
    const next = deleteStep(p, "ok").steps.find((s) => s.id === "approve")!.next;
    expect(next.map((n) => n.to)).toEqual(["done", "fix"]); // "done" was reachable twice: listed once
    const labels = next.map((n) => n.label);
    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
    const issues = validateProcess(deleteStep(p, "ok"));
    expect(issues.filter((i) => i.message.includes("label"))).toEqual([]);
  });
  it("a new decision starts with two named paths where the flow has them", () => {
    const decision = { title: "Is it urgent", type: "decision" as const, actor: "boss" };
    // on an arrow: what followed is "Yes", "No" goes back to the step before
    const onArrow = insertStep(base(), { afterId: "ask", beforeId: "approve" }, decision).process;
    expect(flow(onArrow)).toContain("ask>is-it-urgent is-it-urgent>approve(Yes),ask(No) ");
    expect(validateProcess(onArrow)).toEqual([]);
    // after a step: the same
    const after = insertStep(base(), { afterId: "ask" }, decision).process;
    expect(flow(after)).toContain("is-it-urgent>approve(Yes),ask(No) ");
    expect(validateProcess(after)).toEqual([]);
    // a name that is already there is kept and not used twice
    const kept = base();
    kept.steps[0].next = [{ to: "approve", label: "No" }];
    expect(flow(insertStep(kept, { afterId: "ask" }, decision).process)).toContain("is-it-urgent>approve(No),ask(Yes) ");
    // at the very end there is nothing to point at yet: the checker says what is missing
    const atEnd = insertStep(base(), { afterId: "done" }, decision).process;
    expect(flow(atEnd)).toContain("done>is-it-urgent is-it-urgent>");
    expect(hasErrors(validateProcess(atEnd))).toBe(true);
    // other kinds of step are not touched
    expect(flow(insertStep(base(), { afterId: "ask", beforeId: "approve" }, spec).process)).toContain("check-the-budget>approve ");
  });
  it("a second extra branch on a decision gets a name of its own", () => {
    const once = insertStep(base(), { afterId: "ok" }, spec).process;
    const twice = insertStep(once, { afterId: "ok" }, { ...spec, title: "Ask finance" }).process;
    expect(twice.steps.find((s) => s.id === "ok")!.next.map((n) => n.label)).toEqual(["Yes", "No", "Other", "Other 2"]);
    expect(flow(addStepAfter(once, "ok").process)).toContain("new-step(Other 2)");
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
    expect(p).not.toHaveProperty("category"); // a category is an id from the list: none until one is picked
    expect(hasErrors(validateProcess(p))).toBe(false);
  });
  it("belongs to the platform or practice its maker chose", () => {
    const p = blankProcess([], "Request a bucket", { platform: "google-cloud" });
    expect(p).toMatchObject({ id: "request-a-bucket", platform: "google-cloud" });
    expect(p).not.toHaveProperty("practice");
    expect(hasErrors(validateProcess(p, { catalog }))).toBe(false);
  });
  it("tidy drops a category, practice, platform or rigour that was cleared", () => {
    const t = tidy({ ...base(), category: "", practice: " ", platform: undefined, rigour: undefined });
    for (const f of ["category", "practice", "platform", "rigour"]) expect(t).not.toHaveProperty(f);
    expect(tidy({ ...base(), category: "cloud", rigour: "optional" })).toMatchObject({ category: "cloud", rigour: "optional" });
    expect(tidyStandard({ ...baseStandard(), practice: "", platform: "github" })).toMatchObject({ platform: "github" });
    expect(tidyStandard({ ...baseStandard(), practice: "" })).not.toHaveProperty("practice");
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

  it("blankStandard is a valid draft issued by the given team", () => {
    const s = blankStandard(["new-standard"], "security");
    expect(s).toMatchObject({ id: "new-standard-2", status: "draft", owner: "security" });
    expect(hasErrors(validateStandard(s))).toBe(false);
    expect(blankStandard([], "dns-team", "DNS names", { practice: "engineering" })).toMatchObject({ id: "dns-names", owner: "dns-team", practice: "engineering" });
  });
});

describe("partial standards", () => {
  it("tidyStandard passes a standard that is not complete through instead of failing on it", () => {
    const broken: unknown[] = [
      { id: "x", title: "No requirements" },
      { id: "x", title: "Wrong kinds", requirements: "none", tags: "a", resources: 3 },
      { id: "x", title: "Odd entries", requirements: [null, "REQ", { id: "A-1" }, { id: "A-2", guidance: "text", examples: "none", review: "yes", verification: null }, { id: "A-3", examples: { good: [1, " x "] }, review: { lookFor: [" a ", 2], paths: "src" } }] },
    ];
    for (const doc of broken) {
      const out = tidyStandard(doc as Standard);
      expect(out.title).toBe((doc as Standard).title);
      expect(isDrawableStandard(out)).toBe(false);
      expect(hasErrors(validateStandard(out))).toBe(true);
    }
  });
});

describe("prerequisite ticks", () => {
  it("are remembered by title, so they follow a prerequisite when the list is reordered", () => {
    const list = [{ title: "Approved cost centre" }, { title: "Manager approval" }];
    const keys = prerequisiteKeys(list);
    expect(keys).toEqual(["prereq:approved-cost-centre", "prereq:manager-approval"]);
    expect(prerequisiteKeys([...list].reverse())).toEqual([...keys].reverse());
  });
  it("are different for every prerequisite, also with the same or an empty title", () => {
    const keys = prerequisiteKeys([{ title: "Access" }, { title: "Access" }, { title: "" }, { title: "!!!" }]);
    expect(keys).toEqual(["prereq:access", "prereq:access-2", "prereq:item", "prereq:item-2"]);
    expect(prerequisiteKeys(undefined as unknown as { title: string }[])).toEqual([]);
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
