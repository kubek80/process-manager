import { describe, expect, it } from "vitest";
import { addActor, answerChanges, appendRequirement, appendStep, blankProcess, deleteStep, EXAMPLE, flowMoveBlocked, moveRequirementTo, moveStepInFlow, nudgeStep, setStepType } from "../edit";
import { dropBefore, processOutline, standardOutline, withoutEarlySuggestions } from "../editing";
import { validateProcess } from "../validate";
import type { Process } from "../../types";
import { base, baseStandard, readJson } from "./fixtures";

const flow = (p: Process) => p.steps.map((s) => `${s.id}>${s.next.map((n) => (n.label ? `${n.to}(${n.label})` : n.to)).join(",")}`).join(" ");

/** a > b > c > d > e, all done by me */
const line = (): Process => ({
  ...base(),
  steps: ["a", "b", "c", "d", "e"].map((id, i, all) => ({ id, title: id.toUpperCase(), actor: "me", type: "task", next: all[i + 1] ? [{ to: all[i + 1] }] : [] })),
});

describe("moving a step in the flow", () => {
  it("puts it before another step: the arrows change, and the numbers follow", () => {
    const p = moveStepInFlow(line(), "d", "b");
    expect(flow(p)).toBe("a>d d>b b>c c>e e>");
    expect(p.steps.map((s) => s.id)).toEqual(["a", "d", "b", "c", "e"]);
  });
  it("moves a step later, and to the end", () => {
    expect(flow(moveStepInFlow(line(), "b", "e"))).toBe("a>c c>d d>b b>e e>");
    expect(flow(moveStepInFlow(line(), "b", null))).toBe("a>c c>d d>e e>b b>");
    expect(flow(moveStepInFlow(line(), "a", null))).toBe("b>c c>d d>e e>a a>");
  });
  it("moves a step to the start", () => {
    const p = moveStepInFlow(line(), "c", "a");
    expect(flow(p)).toBe("c>a a>b b>d d>e e>");
  });
  it("keeps the name of a branch that led to the target", () => {
    // fix goes before done: the decision's "Yes" now leads to fix, and fix to done
    const p = moveStepInFlow(base(), "fix", "done");
    expect(flow(p)).toBe("ask>approve approve>ok ok>fix(Yes),approve(No) fix>done done>");
    expect(validateProcess(p)).toEqual([]);
  });
  it("moves a decision with its answers: the answer that carried the flow on is reconnected", () => {
    // ask > approve > ok? (Yes: done, No: fix > approve); ok before approve
    const p = moveStepInFlow(base(), "ok", "approve");
    // every arrow into the step it is put before now goes into it, the loop back from "fix" too
    expect(flow(p)).toBe("ask>ok ok>approve(Yes),fix(No) approve>done fix>ok done>");
    expect(answerChanges(base(), p)).toEqual(["“Yes” of “Approved?” now leads to “Approve it”"]);
    expect(flowMoveBlocked(base(), "ok")).toBe("");
  });
  it("does nothing for an unknown step or target, or onto itself", () => {
    const p = line();
    expect(moveStepInFlow(p, "zz", "a")).toBe(p);
    expect(moveStepInFlow(p, "a", "zz")).toBe(p);
    expect(moveStepInFlow(p, "a", "a")).toBe(p);
  });
  it("moves one place with the keys", () => {
    expect(flow(nudgeStep(line(), "c", -1))).toBe("a>c c>b b>d d>e e>");
    expect(flow(nudgeStep(line(), "c", 1))).toBe("a>b b>d d>c c>e e>");
    expect(flow(nudgeStep(line(), "d", 1))).toBe("a>b b>c c>e e>d d>");
    const p = line();
    expect(nudgeStep(p, "a", -1)).toBe(p);
    expect(nudgeStep(p, "e", 1)).toBe(p);
  });
  it("to the end after a decision becomes a branch of it", () => {
    const b = base();
    const ok = b.steps.find((s) => s.id === "ok")!;
    const p = { ...b, steps: [...b.steps.filter((s) => s.id !== "ok"), ok] };
    expect(flow(moveStepInFlow(p, "ask", null))).toContain("ok>done(Yes),fix(No),ask(Other) ask>");
  });
});

describe("adding from the outline", () => {
  it("adds a named step at the end, done by whoever did the last one, without example text", () => {
    const r = appendStep(line(), "Check the laptop");
    expect(r.id).toBe("check-the-laptop");
    expect(flow(r.process)).toBe("a>b b>c c>d d>e e>check-the-laptop check-the-laptop>");
    expect(r.process.steps.at(-1)).toMatchObject({ title: "Check the laptop", actor: "me", type: "task" });
  });
  it("on a blank process, the first name replaces the example step", () => {
    const r = appendStep(blankProcess([], "Order a laptop"), "Choose a model");
    expect(r.id).toBe("choose-a-model");
    expect(r.process.steps).toHaveLength(1);
    expect(r.process.steps[0]).toMatchObject({ id: "choose-a-model", title: "Choose a model", actor: "me", type: "task", instructions: undefined });
    // the next one is added after it
    expect(appendStep(r.process, "Fill in the form").process.steps.map((s) => s.id)).toEqual(["choose-a-model", "fill-in-the-form"]);
  });
  it("adds the first step of an empty process", () => {
    const r = appendStep({ ...line(), steps: [] }, "Start");
    expect(r.process.steps).toEqual([{ id: "start", title: "Start", actor: "me", type: "task", next: [] }]);
  });
  it("adds a requirement with its name; the rule is still to be written", () => {
    const r = appendRequirement(baseStandard(), "No shared accounts");
    const added = r.standard.requirements.at(-1)!;
    expect(added).toMatchObject({ id: r.id, title: "No shared accounts", statement: EXAMPLE.statement });
  });
});

describe("a step that becomes a decision", () => {
  it("gets Yes (what followed) and No (back to the step before)", () => {
    const p = setStepType(line(), "c", "decision");
    expect(flow(p)).toContain("c>d(Yes),b(No)");
  });
  it("keeps paths it already has, and changes nothing else for other kinds", () => {
    expect(setStepType(base(), "approve", "review").steps[1].type).toBe("review");
    expect(flow(setStepType(base(), "approve", "review"))).toBe(flow(base()));
    const first = setStepType(line(), "a", "decision");
    expect(flow(first)).toContain("a>b"); // nothing before it to go back to
  });
});

describe("a participant added from a step", () => {
  const teams = [{ id: "it-desk", name: "IT service desk", contact: "#it-desk" }];
  it("is the team of the list when the name is one", () => {
    const r = addActor(base(), "it service desk", teams);
    expect(r.id).toBe("it-desk");
    expect(r.process.actors.at(-1)).toEqual({ id: "it-desk", name: "IT service desk", description: "#it-desk", teamId: "it-desk" });
  });
  it("is a role of its own otherwise, with a free id", () => {
    const r = addActor(base(), "Line manager", teams);
    expect(r.id).toBe("line-manager");
    expect(addActor(r.process, "Line manager", teams).id).toBe("line-manager-2");
  });
});

describe("moving requirements", () => {
  it("puts one before another, or at the end", () => {
    const s = baseStandard();
    const ids = s.requirements.map((r) => r.id);
    const last = ids[ids.length - 1];
    expect(moveRequirementTo(s, last, ids[0]).requirements.map((r) => r.id)).toEqual([last, ...ids.slice(0, -1)]);
    expect(moveRequirementTo(s, ids[0], null).requirements.map((r) => r.id)).toEqual([...ids.slice(1), ids[0]]);
    expect(moveRequirementTo(s, ids[0], ids[0])).toBe(s);
    expect(moveRequirementTo(s, "NOPE", null)).toBe(s);
  });
});

describe("dropping in the outline", () => {
  const ids = ["a", "b", "c", "d"];
  it("says what the item is put before", () => {
    expect(dropBefore(ids, "d", 0)).toBe("a");
    expect(dropBefore(ids, "a", 3)).toBe("d");
    expect(dropBefore(ids, "a", 4)).toBeNull();
  });
  it("is no move when dropped next to itself or outside", () => {
    expect(dropBefore(ids, "b", 1)).toBeUndefined();
    expect(dropBefore(ids, "b", 2)).toBeUndefined();
    expect(dropBefore(ids, "x", 0)).toBeUndefined();
    expect(dropBefore(ids, "a", 9)).toBeUndefined();
  });
});

describe("what the outline says about each item", () => {
  it("names who does a step, its kind and its lane", () => {
    const e = processOutline(base()).find((x) => x.item === "approve")!;
    expect(e).toMatchObject({ type: "approval", who: "Line manager", lane: 1 });
  });
  it("gives a requirement its level", () => {
    const s = baseStandard();
    expect(standardOutline(s).filter((x) => x.item).map((x) => x.level)).toEqual(s.requirements.map((r) => r.level));
  });
});

describe("the restructuring the critic did in “Release a service to production” (demo)", () => {
  const release = () => readJson<Process>("demo/processes/release-service-to-production.json");
  const to = (p: Process, id: string) => Object.fromEntries(p.steps.find((s) => s.id === id)!.next.map((n) => [n.label ?? "", n.to]));
  const order = (p: Process) => p.steps.map((s) => s.id);

  it("moves step 12 (Release healthy?) before step 10, with its answers", () => {
    const before = release();
    const p = moveStepInFlow(before, "release-healthy", "roll-out");
    expect(to(p, "start-deployment")).toEqual({ "": "release-healthy" });
    // "Yes" carried the flow on: it now leads to the step it was put before; "No" is unchanged
    expect(to(p, "release-healthy")).toEqual({ Yes: "roll-out", No: "roll-back" });
    // the steps it was cut out of are joined to where "Yes" led
    expect(to(p, "watch-release")).toEqual({ "": "close-change" });
    expect(order(p).indexOf("release-healthy")).toBe(order(p).indexOf("roll-out") - 1);
    expect(answerChanges(before, p)).toEqual(["“Yes” of “Release healthy?” now leads to “Roll out to 10%, then to all”"]);
    expect(validateProcess(p)).toEqual([]);
  });

  it("moves step 10 after step 12 (before 13): “No” now leads to it, and that is said", () => {
    const before = release();
    const p = moveStepInFlow(before, "roll-out", "roll-back");
    expect(to(p, "start-deployment")).toEqual({ "": "watch-release" });
    expect(to(p, "release-healthy")).toEqual({ Yes: "close-change", No: "roll-out" });
    expect(to(p, "roll-out")).toEqual({ "": "roll-back" });
    expect(answerChanges(before, p)).toEqual(["“No” of “Release healthy?” now leads to “Roll out to 10%, then to all”"]);
  });

  it("deletes step 8 (Book an SRE) inside a branch: both answers stay, and that is said", () => {
    const before = release();
    const p = deleteStep(before, "book-sre");
    expect(p.steps.find((s) => s.id === "tier-zero")!.next).toEqual([{ to: "start-deployment", label: "Yes" }, { to: "start-deployment", label: "No" }]);
    expect(answerChanges(before, p)).toEqual(["“Yes” of “Is it a tier 0 service?” now leads to “Start the production deployment”, as “No” does"]);
    // the checker asks to tell the two answers apart: a problem to fix, not a silent loss
    expect(validateProcess(p).some((i) => i.level === "error" && i.path.startsWith("steps[6].next"))).toBe(true);
  });

  it("moves a decision to the end with its answers", () => {
    const p = moveStepInFlow(release(), "tier-zero", null);
    expect(to(p, "tier-zero")).toEqual({ Yes: "book-sre", No: "start-deployment" });
    expect(order(p).at(-1)).toBe("tier-zero");
    expect(to(p, "change-approved").Approved).toBe("book-sre");
  });
});

describe("suggestions about something new wait until it is left", () => {
  it("hides suggestions about a new step, never problems, never those about other parts", () => {
    const issues = [
      { level: "warning" as const, path: "steps[0].instructions", message: "m" },
      { level: "error" as const, path: "steps[0].title", message: "m" },
      { level: "warning" as const, path: "steps[1].instructions", message: "m" },
      { level: "warning" as const, path: "summary", message: "m" },
    ];
    const shown = withoutEarlySuggestions("process", base(), issues, (id) => id === "ask");
    expect(shown.map((i) => i.path)).toEqual(["steps[0].title", "steps[1].instructions", "summary"]);
  });
});
