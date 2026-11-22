import { describe, expect, it } from "vitest";
import {
  checkerSummary, issueText, draftKindOf, editState, issuesByPlace, issuesFor, processIssueTarget, processOutline, publishCallOf, saveCallOf,
  standardIssueTarget, standardOutline, statusChangeBlocked,
} from "../editing";
import { validateProcess } from "../validate";
import { author, deleteReady, DELETE_PAUSE, outlineCollapsed, outlineKey, savedByText, steppedMessage, unpublishedLine, baseBehindSentence, draftSaveBase, exampleIssues, publishLines, valueByName, withoutReviewDates } from "../editing";
import { compare } from "../diff";
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
    expect(checkerSummary([])).toEqual({ level: "good", text: "Nothing to fix" });
    expect(checkerSummary([{ level: "warning", path: "x", message: "m" }])).toEqual({ level: "hint", text: "1 suggestion" });
    expect(checkerSummary([{ level: "error", path: "x", message: "m" }, { level: "error", path: "y", message: "m" }, { level: "warning", path: "x", message: "m" }])).toEqual({ level: "bad", text: "2 to fix" });
  });
});

describe("a problem in words", () => {
  it("names the field, not the path", () => {
    expect(issueText({ level: "error", path: "steps[1].actor", message: "must be one of: me, boss" })).toBe("Choose who does it from the list.");
    expect(issueText({ level: "error", path: "title", message: "is too short (minimum 3 characters)" })).toBe("Write the name in a few more words.");
    expect(issueText({ level: "error", path: "steps[1].next[0].to", message: "points at a step that does not exist" })).toBe("Goes to points at a step that does not exist");
    expect(issueText({ level: "error", path: "(root)", message: "is missing the required field \"id\"" })).toBe("Give it an id in the JSON (More › JSON).");
  });
  it("is an instruction in the person's words: never a path, a schema word or a number of characters", () => {
    const cases: [string, string, string, ("process" | "standard")?][] = [
      ["prerequisites[1].title", "is too short (minimum 3 characters)", "Write the prerequisite in a few more words."],
      ["prerequisites[0].title", "is empty", "Write the prerequisite."],
      ["resources[0].url", "must be a full link starting with http:// or https://", "Link 1: start the address with https://"],
      ["resources[1].title", "is too short (minimum 2 characters)", "Link 2: write the name of the link in a few more words."],
      ["steps[0].resources[2].url", "must be a full link starting with http:// or https://", "Link 3: start the address with https://"],
      ["steps[3].title", "is empty", "Write what happens in this step."],
      ["steps[3].instructions[1]", "is empty", "Write action 2, or remove it."],
      ["steps[3].next[0].label", "is empty", "Name the answer, e.g. Approved."],
      ["actors[2].name", "is empty", "Write the name of who takes part."],
      ["summary", "is too short (minimum 10 characters)", "Write the summary in a sentence or two."],
      ["requirements[0].id", "must be upper case with dashes, e.g. \"SEC-LOG-01\"", "Write the id in capitals and digits joined by dashes, e.g. SEC-LOG-01.", "standard"],
      ["requirements[0].statement", "is too short (minimum 10 characters)", "Write the rule as a whole sentence.", "standard"],
      ["requirements[0].review.lookFor", "needs at least 1 item(s)", "Write at least one sign of a violation.", "standard"],
      ["title", "is too long (maximum 80 characters)", "Shorten the name: it holds at most 80 characters.", "process"],
      ["updatedAt", "must match the pattern ^\\d{4}-\\d{2}-\\d{2}$", "Write the date as year-month-day, e.g. 2026-11-20.", "process"],
      ["steps[0]", "has a field \"owner\" that the schema does not allow - remove or rename it", "“owner” is not part of a process: remove it in the JSON (More › JSON).", "process"],
      ["steps[0].title", "is still the example: write your own before publishing.", "What happens is still the example text: write your own."],
    ];
    for (const [path, message, said, kind] of cases) {
      const text = issueText({ level: "error", path, message }, kind);
      expect(text).toBe(said);
      expect(text).not.toMatch(/\[\d+\]|minimum|schema|must be|item\(s\)/);
    }
  });
});


describe("the example texts of something new", () => {
  it("are problems to fix before publishing, where they are", () => {
    const p = blankProcess([], "Order a laptop");
    const issues = exampleIssues("process", p);
    expect(issues.map((i) => i.path)).toEqual(["summary", "steps[0].title", "steps[0].instructions[0]"]);
    expect(issues.every((i) => i.level === "error")).toBe(true);
    expect(issueText(issues[0])).toBe("Summary is still the example text: write your own.");
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
    expect(lines.find((l) => l.startsWith("Step “Approve it quickly” changed"))).toBe("Step “Approve it quickly” changed: what happens “Approve it” → “Approve it quickly”, what to do");
  });
  it("leaves out the review dates the server keeps from the published version", () => {
    const a = base(), b = base();
    b.review = { intervalMonths: 6, lastReviewedAt: "2026-11-01", reviewedBy: "Casey" };
    expect(publishLines("process", a, b)).toEqual([]);
    expect(withoutReviewDates(b).review).toEqual({ intervalMonths: 6 });
    b.review = { intervalMonths: 12 };
    expect(publishLines("process", a, b)).toEqual(["Review changed"]);
  });
  it("shows participants, teams, tools, tiers and the like by their names, never by their ids", () => {
    const a = base(), b = base();
    b.steps[0] = { ...b.steps[0], actor: "boss", tool: "azure-portal" };
    b.owner = "security";
    b.tiers = ["tier-0", "tier-1"];
    const lines = publishLines("process", a, b, catalog);
    expect(lines).toContain("Step “Ask for it” changed: who does it “You” → “Line manager”, tool nothing → “Azure portal”");
    const team = (id: string) => catalog.teams.find((t) => t.id === id)!.name;
    expect(lines).toContain(`Owning team changed from “${team("cloud-platform-team")}” to “${team("security")}”`);
    expect(lines).toContain("Application tiers: nothing → “Tier 0, Tier 1”");
    expect(lines.join(" ")).not.toMatch(/“(me|boss|security|tier-0|azure-portal)”/);
  });
  it("names a value by its list, and keeps one it does not know", () => {
    expect(valueByName("actor", "me", catalog, [])).toBe("You");
    expect(valueByName("actor", "boss", catalog, [{ id: "boss", name: "Line manager" }])).toBe("Line manager");
    expect(valueByName("tool", "azure-portal", catalog)).toBe("Azure portal");
    expect(valueByName("tool", "gone-tool", catalog)).toBe("gone-tool");
    expect(valueByName("languages", [], catalog)).toBeUndefined();
    expect(valueByName("title", "Approve", catalog)).toBe("Approve");
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
    expect(checkerSummary([example, example, example])).toEqual({ level: "warn", text: "3 to fix" });
    expect(checkerSummary([example])).toEqual({ level: "warn", text: "1 to fix" });
  });
  it("are problems as soon as a real one is among them", () => {
    expect(checkerSummary([example, real])).toEqual({ level: "bad", text: "2 to fix" });
  });
  it("are told apart per place in the outline", () => {
    const p = blankProcess([], "X");
    const by = issuesByPlace("process", p, exampleIssues("process", p));
    expect(by.get("about")).toEqual({ errors: 1, warnings: 0, examples: 1 });
    expect(by.get("steps/first-step")).toEqual({ errors: 2, warnings: 0, examples: 2 });
  });
});

describe("who saved a version, in the versions list", () => {
  it("is the person's name where known, else the email, and a plain word for imports and the portal", () => {
    expect(savedByText({ savedBy: "riley@example.com", savedByName: "Riley Security" })).toBe("Riley Security");
    expect(savedByText({ savedBy: "riley@example.com" })).toBe("riley@example.com");
    expect(savedByText({ savedBy: "import" })).toBe("Imported");
    expect(savedByText({ savedBy: "system" })).toBe("Updated by the portal");
  });
});

describe("the reader's line about unpublished changes", () => {
  const at = new Date(2026, 10, 20, 2, 9).toISOString();
  const draft = { updatedAt: at, updatedBy: "alex@example.com", updatedByName: "Alex Editor" };
  it("tells the person who made them that they are theirs", () => {
    expect(unpublishedLine(draft, "Alex@example.com")).toBe("You have unpublished changes (saved 2026-11-20 02:09). Readers see the published version.");
    expect(unpublishedLine({ ...draft, updatedAt: new Date(2026, 10, 17, 9, 30).toISOString() }, "alex@example.com"))
      .toBe("You have unpublished changes (saved 2026-11-17 09:30). Readers see the published version.");
  });
  it("names the person to other editors", () => {
    expect(unpublishedLine(draft, "jordan@example.com")).toBe("There are unpublished changes by Alex Editor, saved 2026-11-20 02:09. Readers see the published version.");
    expect(unpublishedLine({ ...draft, updatedByName: undefined }, undefined)).toBe("There are unpublished changes by alex@example.com, saved 2026-11-20 02:09. Readers see the published version.");
  });
});

describe("the outline as a narrow rail", () => {
  it("is open, with the names, at every desktop width until the person narrows it", () => {
    expect(outlineCollapsed(null)).toBe(false);
    expect(outlineCollapsed(undefined)).toBe(false);
    expect(outlineCollapsed("open")).toBe(false);
    expect(outlineCollapsed("something else")).toBe(false);
  });
  it("stays a rail once the person chose it", () => {
    expect(outlineCollapsed("rail")).toBe(true);
  });
  it("is remembered per person", () => {
    expect(outlineKey("alex@example.com")).toBe("pm:outline:alex@example.com");
    expect(outlineKey("alex@example.com")).not.toBe(outlineKey("sam@example.com"));
  });
});

describe("what Undo and Redo say", () => {
  const p = base();
  const without = { ...p, steps: p.steps.filter((s) => s.id !== "fix") };
  const main = (a: typeof p, b: typeof p) => { const c = compare("process", a, b, catalog); return c.find((x) => x.kind !== "changed") ?? c[0]; };
  it("says what is true now, not what was undone", () => {
    // a step was deleted; Undo brings it back
    expect(steppedMessage("undo", main(without, p))).toBe("Step “Fix the request” is back.");
    // Redo deletes it again
    expect(steppedMessage("redo", main(p, without))).toBe("Step “Fix the request” is deleted again.");
    // a step was added; Undo takes it out, Redo puts it back
    expect(steppedMessage("undo", main(p, without))).toBe("Step “Fix the request” is gone again.");
    expect(steppedMessage("redo", main(without, p))).toBe("Step “Fix the request” is added again.");
  });
  it("for a changed step, a detail and a value", () => {
    const renamed = { ...p, steps: p.steps.map((s) => (s.id === "ask" ? { ...s, instructions: ["Another line."] } : s)) };
    expect(steppedMessage("undo", main(renamed, p))).toBe("Step “Ask for it”: what to do as before.");
    expect(steppedMessage("redo", main(p, renamed))).toBe("Step “Ask for it”: what to do changed again.");
    const platform = { ...p, platform: "gcp" };
    const name = catalog.platforms.find((x) => x.id === "gcp")?.name ?? "gcp";
    expect(steppedMessage("redo", main(p, platform))).toBe(`Platform is “${name}” again.`);
    expect(steppedMessage("undo", main(platform, p))).toBe("Platform is empty again.");
    expect(steppedMessage("undo", main(p, { ...p, summary: "Other." }))).toBe("Summary is as it was.");
  });
  it("without a difference, plainly", () => {
    // plural names take "are"; links and prerequisites are named one by one, with a capital
    expect(steppedMessage("undo", { kind: "changed", what: "Details", label: "application tiers" })).toBe("Application tiers are as they were.");
    expect(steppedMessage("redo", { kind: "changed", what: "Details", label: "environments" })).toBe("Environments are changed again.");
    expect(steppedMessage("undo", { kind: "changed", what: "Details", label: "order of the steps" })).toBe("Order of the steps is as it was.");
    expect(steppedMessage("undo", main({ ...p, resources: [{ title: "Supplier form", url: "https://x.example.com" }] }, p))).toBe("Link “Supplier form” is gone again.");
    expect(steppedMessage("redo", main(p, { ...p, resources: [{ title: "Supplier form", url: "https://x.example.com" }] }))).toBe("Link “Supplier form” is added again.");
    expect(steppedMessage("undo", main(p, { ...p, prerequisites: [{ title: "A cost centre" }] }))).toBe("Prerequisite “A cost centre” is back.");
    expect(steppedMessage("undo")).toBe("Undone.");
    expect(steppedMessage("redo")).toBe("Done again.");
  });
});

describe("the delete button after the selection changed", () => {
  it("ignores presses for a moment, so that a second click does not delete the next item too", () => {
    expect(DELETE_PAUSE).toBe(700);
    expect(deleteReady(1000, 1000)).toBe(false);
    expect(deleteReady(1000, 1699)).toBe(false);
    expect(deleteReady(1000, 1700)).toBe(true);
    expect(deleteReady(1000, 5000)).toBe(true);
  });
});

import { listParts, partsText, peopleList, whoPublishesParts, whoPublishesSentence, whoPublishesShort, type PublishingGroup } from "../editing";
import type { PersonRef } from "../members";

describe("who can publish what a member drafted", () => {
  const jordan = { email: "jordan@example.com", name: "Jordan Platform" };
  const ann = { email: "ann@example.com" };
  const any = (groups: PublishingGroup[]) => ({ all: false, groups });
  const every = (groups: PublishingGroup[]) => ({ all: true, groups });
  const gcp = (owners: PersonRef[]): PublishingGroup => ({ kind: "platform", name: "Google Cloud", owners });
  const eng = (owners: PersonRef[]): PublishingGroup => ({ kind: "practice", name: "Engineering", owners });
  it("leads with the one owner, by name", () => {
    expect(whoPublishesSentence("process", any([gcp([jordan])]), "saved"))
      .toBe("Jordan Platform, an owner of Google Cloud, publishes this. Your draft is saved for them.");
    expect(whoPublishesSentence("process", any([gcp([jordan])]), "unsaved"))
      .toBe("Jordan Platform, an owner of Google Cloud, publishes this. Save draft keeps your work for them.");
    // one place that has to be owned whole reads the same
    expect(whoPublishesSentence("process", every([gcp([jordan])]), "saved")).toBe(whoPublishesSentence("process", any([gcp([jordan])]), "saved"));
  });
  it("names several owners as a choice, by address where no name is known", () => {
    expect(whoPublishesSentence("standard", any([gcp([jordan, ann])]), "none"))
      .toBe("An owner of Google Cloud publishes this: Jordan Platform or ann@example.com. Save draft keeps your work for them.");
    expect(whoPublishesSentence("standard", any([gcp([jordan]), eng([ann, { email: "JORDAN@example.com" }])]), "saved"))
      .toBe("An owner of Google Cloud or Engineering publishes this: Jordan Platform or ann@example.com. Your draft is saved for them.");
    const many = ["a", "b", "c", "d", "e"].map((x) => ({ email: `${x}@example.com`, name: x.toUpperCase() }));
    expect(whoPublishesSentence("process", any([eng(many)]), "saved"))
      .toBe("An owner of Engineering publishes this: A, B, C or 2 more. Your draft is saved for them.");
  });
  it("says when nobody owns it yet, and that an editor publishes then", () => {
    expect(whoPublishesSentence("process", any([gcp([])]), "saved")).toBe("Google Cloud has no owner yet: a process editor publishes this. Your draft is saved for them.");
    expect(whoPublishesSentence("standard", any([gcp([]), eng([])]), "saved")).toBe("Google Cloud and Engineering have no owner yet: a standards editor publishes this. Your draft is saved for them.");
    expect(whoPublishesSentence("process", any([]), "none")).toBe("A process editor publishes this. Save draft keeps your work for them.");
  });
  it("asks for somebody who owns both places where the whole placement counts", () => {
    expect(whoPublishesSentence("process", every([gcp([jordan, ann]), eng([{ email: "JORDAN@example.com" }])]), "saved"))
      .toBe("Somebody who owns both Google Cloud and Engineering publishes this: Jordan Platform. Your draft is saved for them.");
    expect(whoPublishesSentence("process", every([gcp([jordan]), eng([ann])]), "saved"))
      .toBe("Nobody owns both Google Cloud and Engineering yet: a process editor publishes this. Your draft is saved for them.");
    expect(whoPublishesSentence("standard", every([gcp([]), { kind: "platform", name: "Azure", owners: [] }, eng([])]), "none"))
      .toBe("Nobody owns Google Cloud, Azure and Engineering yet: a standards editor publishes this. Save draft keeps your work for them.");
  });
  it("gives the people as parts, so the page can show each with the address as tooltip", () => {
    const parts = whoPublishesParts("process", any([gcp([jordan, ann])]), "saved");
    expect(parts.filter((p) => typeof p !== "string")).toEqual([jordan, ann]);
    expect(partsText(parts)).toBe(whoPublishesSentence("process", any([gcp([jordan, ann])]), "saved"));
  });
  it("leaves the owners out while they are not known, and still names where", () => {
    expect(whoPublishesSentence("process", any([eng([])]), "saved", false)).toBe("An owner of Engineering publishes this. Your draft is saved for them.");
    expect(whoPublishesSentence("process", every([gcp([]), eng([])]), "saved", false)).toBe("Somebody who owns both Google Cloud and Engineering publishes this. Your draft is saved for them.");
  });
  it("points at the banner when Publish… is pressed", () => {
    expect(whoPublishesShort("process", any([gcp([jordan])]))).toBe("An owner publishes this: see above.");
    expect(whoPublishesShort("standard", any([]))).toBe("A standards editor publishes this: see above.");
  });
  it("lists people briefly", () => {
    expect(peopleList([])).toBe("");
    expect(peopleList(["a"])).toBe("a");
    expect(peopleList(["a", "b"])).toBe("a and b");
    expect(peopleList(["a", "b", "c"])).toBe("a, b and c");
    expect(peopleList(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more");
    expect(listParts([1, 2])).toEqual([1, " and ", 2]);
    expect(listParts(["a", "b", "c"], 3, "or").join("")).toBe("a, b or c");
  });
});

import { ownerOfWords } from "../editing";

describe("the reader's line about one's own unpublished changes", () => {
  const mine = { updatedAt: "2026-11-22T10:00:00Z", updatedBy: "morgan@example.com", updatedByName: "Morgan Member" };
  it("tells a member who publishes them", () => {
    expect(unpublishedLine(mine, "morgan@example.com", ownerOfWords(["Google Cloud"])))
      .toMatch(/^You have unpublished changes \(saved .+\)\. An owner of Google Cloud publishes them; readers see the published version until then\.$/);
    expect(unpublishedLine(mine, "morgan@example.com")).toMatch(/\. Readers see the published version\.$/);
    expect(ownerOfWords(["Google Cloud", "Engineering"])).toBe("An owner of Google Cloud or Engineering");
    expect(ownerOfWords([])).toBe("An editor");
  });
});

import { lastSavedByOther, possessive, publishDialogWords, versionByText } from "../editing";

describe("whose work is published", () => {
  it("names the person who saved the changes last, never claiming more", () => {
    const morgan = { updatedBy: "morgan@example.com", updatedByName: "Morgan Member" };
    expect(lastSavedByOther(morgan, "jordan@example.com", false)).toBe("Morgan Member");
    expect(lastSavedByOther(morgan, "MORGAN@example.com", false)).toBeUndefined();
    expect(lastSavedByOther(morgan, "jordan@example.com", true)).toBeUndefined(); // the publisher's unsaved changes make them theirs
    expect(lastSavedByOther({ updatedBy: "import" }, "jordan@example.com", false)).toBeUndefined();
    expect(possessive("Morgan Member")).toBe("Morgan Member’s");
    expect(possessive("James")).toBe("James’");
    expect(publishDialogWords("process", false, 3, "Morgan Member")).toEqual({ title: "Publish Morgan Member’s changes", subtitle: "Last saved by Morgan Member. Until you publish, readers see version 3." });
    expect(publishDialogWords("process", false, 3)).toEqual({ title: "Publish your changes", subtitle: "Until you publish, readers see version 3." });
    expect(publishDialogWords("standard", true, 1, "Morgan Member")).toEqual({ title: "Publish this standard", subtitle: "Last saved by Morgan Member. ", audience: true });
    expect(publishDialogWords("process", false, 2, "Morgan Member", "2026-11-22T10:00:00Z").subtitle).toMatch(/^Last saved by Morgan Member at .+\. Until you publish, readers see version 2\.$/);
  });
  it("says in the list of versions who published and who saved the changes", () => {
    expect(versionByText({ savedBy: "jordan@example.com", savedByName: "Jordan Platform", changesBy: "morgan@example.com", changesByName: "Morgan Member" }))
      .toBe("published by Jordan Platform · changes last saved by Morgan Member");
    expect(versionByText({ savedBy: "jordan@example.com", changesBy: "morgan@example.com" })).toBe("published by jordan@example.com · changes last saved by morgan@example.com");
    expect(versionByText({ savedBy: "jordan@example.com", savedByName: "Jordan Platform" })).toBe("Jordan Platform");
  });
});
