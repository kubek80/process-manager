import { describe, expect, it } from "vitest";
import {
  checkerSummary, issueText, draftKindOf, editState, issuesByPlace, issuesFor, processIssueTarget, processOutline, publishCallOf, saveCallOf,
  standardIssueTarget, standardOutline, statusChangeBlocked,
} from "../editing";
import { validateProcess } from "../validate";
import { author, baseBehindSentence, draftSaveBase, exampleIssues, publishLines, withoutReviewDates } from "../editing";
import { blankProcess, blankStandard, addRequirement, addStepAfter, EXAMPLE } from "../edit";

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
  it("something deleted by somebody else while it was open comes back as a new draft", () => {
    expect(saveCallOf("working", true)).toBe("recreate-as-draft");
    expect(saveCallOf("unpublished", true)).toBe("recreate-as-draft");
    expect(saveCallOf("working", false)).toBe("save-working-draft");
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

describe("a problem in words", () => {
  it("names the field, not the path", () => {
    expect(issueText({ level: "error", path: "steps[1].actor", message: "must be one of: me, boss" })).toBe("Who does it must be one of: me, boss");
    expect(issueText({ level: "error", path: "title", message: "is too short (minimum 3 characters)" })).toBe("Name is too short (minimum 3 characters)");
    expect(issueText({ level: "error", path: "steps[1].next[0].to", message: "points at a step that does not exist" })).toBe("Goes to points at a step that does not exist");
    expect(issueText({ level: "warning", path: "steps[2]", message: "cannot be reached from the first step" })).toBe("Cannot be reached from the first step");
    expect(issueText({ level: "error", path: "(root)", message: "is missing the required field \"id\"" })).toBe("Is missing the required field \"id\"");
  });
});


describe("the example texts of something new", () => {
  it("are problems to fix before publishing, where they are", () => {
    const p = blankProcess([], "Order a laptop");
    const issues = exampleIssues("process", p);
    expect(issues.map((i) => i.path)).toEqual(["summary", "steps[0].title", "steps[0].instructions[0]"]);
    expect(issues.every((i) => i.level === "error")).toBe(true);
    expect(issueText(issues[0])).toBe("Summary still has the example text. Say it in your own words before publishing.");
    expect(processIssueTarget(p, issues[1].path)).toEqual({ section: "steps", item: "first-step" });
    // a step added later starts with an example name too
    const more = addStepAfter({ ...p, summary: "Real words." }, "first-step").process;
    expect(exampleIssues("process", more).map((i) => i.path)).toContain("steps[1].title");
  });
  it("of a standard and of a new requirement too", () => {
    const s = blankStandard([], "security", "Secure logging");
    expect(exampleIssues("standard", s).map((i) => i.path)).toEqual(["summary", "requirements[0].title", "requirements[0].statement", "requirements[0].rationale"]);
    const added = addRequirement({ ...s, summary: "Mine." }, "REQ-01").standard;
    expect(exampleIssues("standard", added).map((i) => i.path)).toContain("requirements[1].statement");
  });
  it("are gone once they are written over, and never flag real content", () => {
    const p = blankProcess([], "Order a laptop");
    p.summary = "You get a laptop.";
    p.steps[0] = { ...p.steps[0], title: "Choose the model", instructions: ["Open the shop."] };
    expect(exampleIssues("process", p)).toEqual([]);
    expect(EXAMPLE.processSummary).toBe(blankProcess([]).summary);
  });
});

describe("what the Publish dialog lists", () => {
  it("shows short fields as before and after, and long ones by where they changed", () => {
    const a = base(), b = base();
    b.title = "Demo process renamed";
    b.steps[1] = { ...b.steps[1], title: "Approve it quickly", instructions: ["Read it.", "Approve."] };
    const lines = publishLines("process", a, b);
    expect(lines).toContain("Name: “Demo process” → “Demo process renamed”");
    const long = base(), short = base();
    long.summary = "A long summary ".repeat(8).trim();
    short.summary = "Short now.";
    expect(publishLines("process", long, short)).toEqual(["Summary changed, now “Short now.”"]);
    expect(publishLines("process", short, long)).toEqual(["Summary changed"]);
    expect(lines.find((l) => l.startsWith("Step “Approve it quickly” changed"))).toBe("Step “Approve it quickly” changed: name “Approve it” → “Approve it quickly”, instructions");
  });
  it("leaves out the review dates the server keeps from the published version", () => {
    const a = base(), b = base();
    b.review = { intervalMonths: 6, lastReviewedAt: "2026-11-01", reviewedBy: "Casey" };
    expect(publishLines("process", a, b)).toEqual([]);
    expect(withoutReviewDates(b).review).toEqual({ intervalMonths: 6 });
    b.review = { intervalMonths: 12 };
    expect(publishLines("process", a, b)).toEqual(["Review changed"]);
  });
  it("of a standard names the requirement", () => {
    const a = baseStandard(), b = baseStandard();
    b.requirements[0] = { ...b.requirements[0], level: "should" };
    expect(publishLines("standard", a, b)).toEqual(["Requirement “DEMO-01 First rule” changed: level “must” → “should”"]);
  });
});

describe("the banner about a draft started from an older version", () => {
  it("only shows when a newer version was really published, and says so truly", () => {
    expect(baseBehindSentence(5, 5)).toBe("");
    expect(baseBehindSentence(0, 5)).toBe("");
    expect(baseBehindSentence(4, 6)).toMatch(/^Version 6 was published after these changes were started from version 4\./);
  });
});

describe("a working draft keeps the version it was made from", () => {
  it("is created on that version, also when it has to be created again", () => {
    // opened on version 4, nobody had a draft
    expect(draftSaveBase(0, 4, null)).toBe(4);
    // somebody published (version 5) and the draft is gone: "Save mine as a new draft" still says 4,
    // so publishing meets "Somebody else published first" instead of going over version 5
    expect(draftSaveBase(0, 4, null)).toBe(4);
    // an ordinary save of an existing draft keeps its base
    expect(draftSaveBase(3, 4, null)).toBeUndefined();
    // after "Continue from theirs" (version 5) the next save moves the draft onto it
    expect(draftSaveBase(3, 5, 5)).toBe(5);
    // nothing known: the server's current version
    expect(draftSaveBase(0, 0, null)).toBeUndefined();
  });
});

describe("who saved", () => {
  it("is named, or is you in another window", () => {
    expect(author({ updatedBy: "alex@example.com", updatedByName: "Alex Editor" }, "dana@example.com")).toEqual({ you: false, name: "Alex Editor" });
    expect(author({ updatedBy: "alex@example.com" }, "dana@example.com").name).toBe("alex@example.com");
    expect(author({ updatedBy: "Alex@Example.com" }, "alex@example.com")).toEqual({ you: true, name: "You" });
    expect(author(undefined, "alex@example.com").name).toBe("Somebody else");
  });
});

describe("a new document's example texts read calmer than real problems", () => {
  const example = { level: "error" as const, path: "summary", message: exampleIssues("process", blankProcess([], "X"))[0].message };
  const real = { level: "error" as const, path: "title", message: "is too short" };
  it("are counted as things to fill in when they are all there is", () => {
    expect(checkerSummary([example, example, example])).toEqual({ level: "warn", text: "3 to fill in" });
    expect(checkerSummary([example])).toEqual({ level: "warn", text: "1 to fill in" });
  });
  it("are problems as soon as a real one is among them", () => {
    expect(checkerSummary([example, real])).toEqual({ level: "bad", text: "2 problems" });
  });
  it("are told apart per place in the outline", () => {
    const p = blankProcess([], "X");
    const by = issuesByPlace("process", p, exampleIssues("process", p));
    expect(by.get("about")).toEqual({ errors: 1, warnings: 0, examples: 1 });
    expect(by.get("steps/first-step")).toEqual({ errors: 2, warnings: 0, examples: 2 });
  });
});
