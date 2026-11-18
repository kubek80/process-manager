import { describe, expect, it } from "vitest";
import {
  checkerSummary, draftKindOf, editState, issuesByPlace, issuesFor, processIssueTarget, processOutline, publishCallOf, saveCallOf,
  standardIssueTarget, standardOutline, statusChangeBlocked,
} from "../editing";
import { validateProcess } from "../validate";
import { base, baseStandard, catalog } from "./fixtures";

describe("which calls a draft uses", () => {
  it("a document that was never published is saved and published as ordinary versions", () => {
    expect(draftKindOf("draft")).toBe("unpublished");
    expect(saveCallOf("unpublished")).toBe("save-version");
    expect(publishCallOf("unpublished")).toBe("save-version-as-active");
  });
  it("changes to a published or retired document go into the working draft beside it", () => {
    for (const status of ["active", "deprecated", undefined] as const) expect(draftKindOf(status)).toBe("working");
    expect(saveCallOf("working")).toBe("save-working-draft");
    expect(publishCallOf("working")).toBe("publish-working-draft");
  });
});

describe("the state on the editing bar", () => {
  it("says in one sentence what readers see", () => {
    expect(editState({ status: "draft", version: 3, working: false, dirty: true })).toEqual({ key: "draft", pill: "Draft", sentence: "Readers do not see this yet" });
    expect(editState({ status: "active", version: 7, working: false, dirty: false })).toEqual({ key: "published", pill: "Published", sentence: "Version 7" });
    expect(editState({ status: "active", version: 7, working: true, dirty: false })).toEqual({ key: "changes", pill: "Unpublished changes", sentence: "Readers still see version 7" });
    // edits not saved yet are unpublished changes too
    expect(editState({ status: "active", version: 7, working: false, dirty: true }).key).toBe("changes");
    expect(editState({ status: "deprecated", version: 4, working: false, dirty: false })).toEqual({ key: "retired", pill: "Retired", sentence: "Readers see version 4, marked as retired" });
    expect(editState({ status: "deprecated", version: 4, working: true, dirty: false }).sentence).toBe("Readers still see version 4, marked as retired");
  });
  it("retiring and unpublishing wait until the unpublished changes are published or discarded", () => {
    expect(statusChangeBlocked({ working: true, dirty: false })).toMatch(/publish or discard/i);
    expect(statusChangeBlocked({ working: false, dirty: true })).toMatch(/save or discard/i);
    expect(statusChangeBlocked({ working: false, dirty: false })).toBe("");
  });
});

describe("the outline", () => {
  it("of a process lists its sections and every step by number", () => {
    const o = processOutline(base());
    expect(o.filter((e) => e.depth === 0).map((e) => e.label)).toEqual(["About", "Before you start", "Who takes part", "Steps", "Links and resources", "Standards it helps to meet"]);
    const steps = o.filter((e) => e.depth === 1);
    expect(steps.map((e) => `${e.number}. ${e.label}`)).toEqual(["1. Ask for it", "2. Approve it", "3. Approved?", "4. Fix the request", "5. Check the result"]);
    expect(steps[0]).toMatchObject({ key: "steps/ask", section: "steps", item: "ask" });
    // the steps come right after their section
    expect(o.findIndex((e) => e.key === "steps/ask")).toBe(o.findIndex((e) => e.key === "steps") + 1);
    expect(o.find((e) => e.key === "people")?.count).toBe(2);
  });
  it("of a standard lists its requirements by id", () => {
    const o = standardOutline(baseStandard());
    expect(o.filter((e) => e.depth === 0).map((e) => e.label)).toEqual(["About", "Scope and exceptions", "Requirements", "Background"]);
    expect(o.filter((e) => e.depth === 1).map((e) => e.number)).toEqual(["DEMO-01", "DEMO-02"]);
  });
  it("names a step that has no name yet", () => {
    const p = base();
    p.steps[0].title = "";
    expect(processOutline(p).find((e) => e.item === "ask")?.label).toBe("(no name yet)");
  });
});

describe("where the checker's problems are shown", () => {
  it("a problem in a step belongs to that step", () => {
    const p = base();
    expect(processIssueTarget(p, "steps[1].next[0].to")).toEqual({ section: "steps", item: "approve" });
    expect(processIssueTarget(p, "steps[9].title")).toEqual({ section: "steps" });
    expect(processIssueTarget(p, "steps")).toEqual({ section: "steps" });
  });
  it("other problems belong to their section, the rest to About", () => {
    const p = base();
    expect(processIssueTarget(p, "prerequisites[0].processId").section).toBe("before");
    expect(processIssueTarget(p, "actors[1].teamId").section).toBe("people");
    expect(processIssueTarget(p, "resources[0].url").section).toBe("links");
    expect(processIssueTarget(p, "standards[0]").section).toBe("standards");
    for (const path of ["title", "owner", "tiers[0]", "review.lastReviewedAt", "replacedBy", "(root)", ""]) expect(processIssueTarget(p, path).section).toBe("about");
    const s = baseStandard();
    expect(standardIssueTarget(s, "requirements[1].statement")).toEqual({ section: "requirements", item: "DEMO-02" });
    expect(standardIssueTarget(s, "exceptionProcessId").section).toBe("scope");
    expect(standardIssueTarget(s, "resources[0]").section).toBe("background");
    expect(standardIssueTarget(s, "owner").section).toBe("about");
  });
  it("are counted per section and per item, so the outline can mark them", () => {
    const p = base();
    p.steps[1].next = [{ to: "nowhere" }];
    p.owner = "nobody-we-know";
    const issues = validateProcess(p, { catalog });
    const by = issuesByPlace("process", p, issues);
    expect(by.get("steps/approve")?.errors).toBeGreaterThan(0);
    expect(by.get("steps")?.errors).toBe(by.get("steps/approve")?.errors);
    expect(by.get("about")?.warnings).toBeGreaterThan(0);
    expect(by.get("steps/ask")).toBeUndefined();
    // the selected step shows only its own; its section all of its steps'
    expect(issuesFor("process", p, issues, { section: "steps", item: "approve" }).length).toBe(by.get("steps/approve")!.errors + by.get("steps/approve")!.warnings);
    expect(issuesFor("process", p, issues, { section: "steps", item: "ask" })).toEqual([]);
  });
  it("are summed up in a few words", () => {
    expect(checkerSummary([])).toEqual({ level: "good", text: "No problems" });
    expect(checkerSummary([{ level: "warning", path: "x", message: "m" }])).toEqual({ level: "warn", text: "1 hint" });
    expect(checkerSummary([{ level: "error", path: "x", message: "m" }, { level: "error", path: "y", message: "m" }, { level: "warning", path: "x", message: "m" }])).toEqual({ level: "bad", text: "2 problems" });
  });
});
