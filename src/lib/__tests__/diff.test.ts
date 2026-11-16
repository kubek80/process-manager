import { describe, expect, it } from "vitest";
import { compare, compareProcesses, compareStandards, describeChange, summarize } from "../diff";
import { base, baseStandard } from "./fixtures";

describe("what changed between two versions of a process", () => {
  it("finds nothing in two equal versions, and ignores the date of the save", () => {
    expect(compareProcesses(base(), base())).toEqual([]);
    expect(compareProcesses(base(), { ...base(), updatedAt: "2026-12-01" })).toEqual([]);
    expect(summarize([])).toBe("Nothing that readers see changed");
  });

  it("names added, removed and changed steps", () => {
    const after = base();
    after.steps = after.steps.filter((s) => s.id !== "fix");
    after.steps.find((s) => s.id === "ok")!.next = [{ to: "done", label: "Yes" }, { to: "approve", label: "No" }];
    after.steps.find((s) => s.id === "approve")!.duration = "1 working day";
    after.steps.find((s) => s.id === "approve")!.actor = "me";
    after.steps.push({ id: "tell", title: "Tell the team", actor: "me", type: "communication", next: [] });
    after.steps.find((s) => s.id === "done")!.next = [{ to: "tell" }];
    const lines = compareProcesses(base(), after).map(describeChange);
    expect(lines).toEqual([
      "Step “Approve it” changed: who does it, duration",
      "Step “Approved?” changed: what comes next",
      "Step “Check the result” changed: what comes next",
      "Step “Tell the team” added",
      "Step “Fix the request” removed",
    ]);
    expect(summarize(compareProcesses(base(), after))).toBe("1 added, 3 changed, 1 removed");
  });

  it("names changed details, prerequisites and a new order", () => {
    const after = base();
    after.title = "Demo process, renamed";
    after.tiers = ["tier-0"];
    after.prerequisites = [{ title: "A cost centre" }];
    [after.steps[3], after.steps[4]] = [after.steps[4], after.steps[3]];
    expect(compareProcesses(base(), after).map(describeChange)).toEqual([
      "Title changed", "Tiers changed", "Before you start “A cost centre” added", "Order of the steps changed",
    ]);
    const back = compareProcesses(after, base()).map(describeChange);
    expect(back).toContain("Before you start “A cost centre” removed");
    const edited = { ...after, prerequisites: [{ title: "A cost centre", description: "Ask finance." }] };
    expect(compareProcesses(after, edited).map(describeChange)).toEqual(["Before you start “A cost centre” changed"]);
    expect(summarize(compareProcesses(base(), after))).toBe("1 added, details changed");
  });

  it("copes with a version that has no steps at all", () => {
    const broken = { ...base(), steps: undefined, prerequisites: undefined } as unknown as ReturnType<typeof base>;
    expect(compareProcesses(broken, base()).filter((c) => c.kind === "added")).toHaveLength(5);
    expect(compareProcesses(base(), broken).filter((c) => c.kind === "removed")).toHaveLength(5);
  });
});

describe("what changed between two versions of a standard", () => {
  it("names requirements by id and title", () => {
    const after = baseStandard();
    after.requirements[0].level = "should";
    after.requirements[0].guidance = ["Do it like this."];
    after.requirements.splice(1, 1);
    after.requirements.push({ id: "DEMO-03", title: "Third rule", level: "may", statement: "Something may be true.", verification: { method: "manual" } });
    after.scope = "Everything we run.";
    expect(compareStandards(baseStandard(), after).map(describeChange)).toEqual([
      "Scope changed",
      "Requirement “DEMO-01 First rule” changed: level, how to comply",
      "Requirement “DEMO-03 Third rule” added",
      "Requirement “DEMO-02 Second rule” removed",
    ]);
    expect(compare("standard", baseStandard(), after)).toHaveLength(4);
    expect(compare("process", base(), base())).toEqual([]);
  });
});

describe("comparing versions does not mislead", () => {
  it("treats a step that only got another id as the same step", () => {
    const before = base();
    before.steps.push({ id: "new-step", title: "New step", actor: "me", type: "task", next: [] });
    before.steps[4].next = [{ to: "new-step" }];
    const after = base();
    after.steps.push({ id: "tell-the-team", title: "New step", actor: "me", type: "task", next: [] });
    after.steps[4].next = [{ to: "tell-the-team" }];
    expect(compareProcesses(before, after)).toEqual([]);
    // with another id and another name there is nothing left to recognise it by: it is a new step
    after.steps[5].title = "Tell the team";
    expect(compareProcesses(before, after).map(describeChange)).toEqual([
      "Step “Check the result” changed: what comes next", "Step “Tell the team” added", "Step “New step” removed",
    ]);
  });

  it("copes with two prerequisites of the same name, and reports a new order", () => {
    const twice = { ...base(), prerequisites: [{ title: "Access" }, { title: "Access", description: "To the second system." }, { title: "Budget" }] };
    expect(compareProcesses(twice, structuredClone(twice))).toEqual([]);
    const reordered = { ...twice, prerequisites: [twice.prerequisites[2], twice.prerequisites[0], twice.prerequisites[1]] };
    expect(compareProcesses(twice, reordered).map(describeChange)).toEqual(["Order of what is needed before you start changed"]);
    const one = { ...twice, prerequisites: [{ title: "Access" }, { title: "Budget" }] };
    expect(compareProcesses(twice, one).map(describeChange)).toEqual(["Before you start “Access” removed"]);
  });

  it("does not call an empty list a change, and survives a version that is not a document", () => {
    expect(compareProcesses(base(), { ...base(), tags: [], resources: [] })).toEqual([]);
    expect(compareStandards(baseStandard(), { ...baseStandard(), tags: [] })).toEqual([]);
    expect(compare("process", null, base())).toEqual([]);
    expect(compare("standard", baseStandard(), "broken")).toEqual([]);
    const holes = { ...base(), steps: [null, base().steps[0]] } as unknown as ReturnType<typeof base>;
    expect(() => compareProcesses(holes, base())).not.toThrow();
  });
});
