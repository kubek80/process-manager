import { describe, expect, it } from "vitest";
import { compareProcesses, compareStandards, describeChange, fieldName, itemWords } from "../diff";
import { moveOf, noteMove, deletedSentence, goneDraftSentence, issueField, issueText, pathContext, publishList, publishLines, savedWhen, steppedMessage } from "../editing";
import { deleteStep, moveStepInFlow, restructureNotice, shortName } from "../edit";
import { base, baseStandard } from "./fixtures";
import type { Process } from "../../types";

// D1: an item without a name (just added, or its name cleared) is said in proper words everywhere
describe("an item without a name", () => {
  it("is called by its place", () => {
    expect(itemWords({ what: "Step", label: "", unnamed: "Step 3" })).toBe("Step 3 (no name yet)");
    expect(itemWords({ what: "Step", label: "  ", unnamed: "Step 3" })).toBe("Step 3 (no name yet)");
    expect(itemWords({ what: "Step", label: "Approve" })).toBe("Step “Approve”");
    expect(itemWords({ what: "Step", label: undefined as unknown as string })).toBe("Step (no name yet)");
  });

  it("is described in every kind of change of a process", () => {
    const p = base();
    const q: Process = structuredClone(p);
    q.prerequisites = [{ title: "" }];
    q.steps[1] = { ...q.steps[1], title: "" };
    q.actors = [...q.actors, { id: "new", name: "" }];
    const lines = compareProcesses(p, q).map(describeChange);
    expect(lines).toContain("Prerequisite 1 (no name yet) added");
    expect(lines).toContain("Step 2 (no name yet) changed: what happens");
    expect(lines).toContain(`Participant ${q.actors.length} (no name yet) added`);
    expect(lines.join("\n")).not.toMatch(/“”/);
    // a title that is not even a text (a broken version) is no reason to fail
    const broken = { ...q, prerequisites: [{}], steps: [{ ...q.steps[0], title: undefined }, ...q.steps.slice(1)] } as unknown as Process;
    expect(() => compareProcesses(p, broken).map(describeChange)).not.toThrow();
    expect(() => publishLines("process", p, broken)).not.toThrow();
  });

  it("of a standard is called by its id", () => {
    const s = baseStandard(), t = baseStandard();
    t.requirements[0] = { ...t.requirements[0], title: "" };
    expect(compareStandards(s, t).map(describeChange)).toEqual([`Requirement ${s.requirements[0].id} (no name yet) changed: short name`]);
  });

  it("is said by Undo and Redo", () => {
    expect(steppedMessage("undo", { kind: "added", what: "Before you start", label: "", unnamed: "Prerequisite 2" })).toBe("Prerequisite 2 (no name yet) is back.");
    expect(steppedMessage("redo", { kind: "changed", what: "Step", label: "", unnamed: "Step 4", details: ["what happens"] })).toBe("Step 4 (no name yet) is changed again: what happens.");
    expect(steppedMessage("undo", { kind: "changed", what: "Details", label: "" })).toBe("It is as it was.");
  });

  it("is said by Undo of a participant change, by the participant's name", () => {
    const p = base(), q = structuredClone(p);
    q.actors[1] = { ...q.actors[1], name: "Finance" };
    const c = compareProcesses(q, p)[0];
    expect(steppedMessage("undo", c)).toBe(`Participant “${p.actors[1].name}” is as it was: name.`);
  });

  it("is cut short safely", () => {
    expect(shortName(undefined)).toBe("");
    expect(shortName("")).toBe("");
    expect(shortName("A very long name of a step indeed", 10)).toBe("A very lo…");
  });

  it("does not stop the message after a delete or a move", () => {
    const p = base();
    const q = { ...p, steps: p.steps.map((s) => ({ ...s, title: "" })) };
    expect(() => restructureNotice(q, deleteStep(q, q.steps[1].id), "deleted")).not.toThrow();
    expect(() => restructureNotice(q, moveStepInFlow(q, q.steps[3].id, q.steps[1].id))).not.toThrow();
  });
});

describe("field names follow the labels on the editing screen", () => {
  it("names a field by whose it is", () => {
    expect(fieldName("title", "process")).toBe("name");
    expect(fieldName("title", "step")).toBe("what happens");
    expect(fieldName("title", "requirement")).toBe("short name");
    expect(fieldName("estimatedDuration", "process")).toBe("typical lead time");
    expect(fieldName("owner", "standard")).toBe("issued by");
    expect(fieldName("owner", "process")).toBe("owning team");
    expect(fieldName("duration", "step")).toBe("typical time");
  });
  it("says the checker's problems with the field's own label", () => {
    expect(pathContext("requirements[2].title")).toBe("requirement");
    expect(pathContext("steps[0].next[1].to")).toBe("step");
    expect(pathContext("title", "standard")).toBe("standard");
    expect(issueText({ level: "error", path: "requirements[2].title", message: "is too short (minimum 3 characters)" })).toBe("Short name is too short (minimum 3 characters)");
    expect(issueText({ level: "error", path: "steps[1].title", message: "is too short (minimum 3 characters)" })).toBe("What happens is too short (minimum 3 characters)");
    expect(issueText({ level: "error", path: "title", message: "is too short (minimum 3 characters)" }, "process")).toBe("Name is too short (minimum 3 characters)");
    expect(issueText({ level: "error", path: "requirements[0]", message: "is missing the required field \"title\"" })).toBe("Write the short name.");
    expect(issueText({ level: "error", path: "steps[0]", message: "is missing the required field \"title\"" })).toBe("Say what happens in this step.");
  });
});

describe("who deleted it, who published the shared draft", () => {
  const at = new Date(2026, 10, 20, 9, 12).toISOString();
  it("names the person when the versions say who", () => {
    expect(savedWhen(at)).toBe("at 2026-11-20 09:12");
    expect(savedWhen(undefined)).toBe("");
    expect(deletedSentence({ version: 7, deleted: true, savedBy: "alex@example.com", savedByName: "Alex Editor", savedAt: at })).toBe("Alex Editor deleted it at 2026-11-20 09:12, while you were editing.");
    expect(deletedSentence({ version: 7, deleted: true, savedBy: "alex@example.com", savedAt: at }, "ALEX@example.com")).toBe("You deleted it in another window at 2026-11-20 09:12, while you were editing.");
    expect(deletedSentence(undefined)).toBe("Somebody else deleted it while you were editing.");
  });
  it("tells a publish from a discard", () => {
    const v6 = { version: 6, deleted: false, savedBy: "dana@example.com", savedByName: "Dana Admin", savedAt: at };
    expect(goneDraftSentence(v6, 5)).toBe("Dana Admin published it as version 6 at 2026-11-20 09:12, while you were editing.");
    expect(goneDraftSentence(v6, 6)).toBe("The shared draft was discarded, perhaps in another window, while you were editing.");
    expect(goneDraftSentence(undefined, 5)).toMatch(/published or discarded/);
  });
});

describe("the checker's list leads to the field", () => {
  it("finds a field by where it is and by its own label", () => {
    expect(issueField("steps[2].instructions[1]").selectors[0]).toBe(".ins-rows > li:nth-child(2) textarea");
    expect(issueField("steps[2].next[1].to").selectors[0]).toBe(".path-rows > li:nth-child(2) select");
    expect(issueField("steps[2].title")).toEqual({ selectors: ["input.step-title"], label: "what happens" });
    expect(issueField("requirements[0].title").label).toBe("short name");
    expect(issueField("prerequisites[1].title").selectors[0]).toBe('[aria-label="Prerequisite 2"]');
    expect(issueField("actors[2]").selectors[0]).toBe('[aria-label="Name of participant 3"]');
    expect(issueField("summary", "process").selectors[0]).toBe('[data-field="summary"]');
    expect(issueField("owner", "standard").label).toBe("issued by");
  });
});

describe("the Publish list marks what would undo a change published since", () => {
  it("compares the version the draft started from, the version readers see and the draft", () => {
    const base0 = { ...base(), estimatedDuration: "1-3 weeks" };
    // somebody published: a shorter lead time, a renamed step, a new step
    const current = structuredClone(base0);
    current.estimatedDuration = "1-2 weeks";
    current.steps[1] = { ...current.steps[1], title: "Approve it quickly" };
    current.steps.push({ id: "tell", title: "Tell the team", actor: "me", type: "task", next: [] });
    // the draft was started from base0 and changed only the summary
    const draft = { ...structuredClone(base0), summary: "A summary of my own." };
    const lines = publishList("process", current, draft, undefined, base0);
    const marked = (start: string) => lines.find((l) => l.text.startsWith(start))?.undoes;
    expect(marked("Typical lead time")).toBe(true);
    expect(marked("Step “Approve it” changed")).toBe(true);
    expect(marked("Step “Tell the team” removed")).toBe(true);
    expect(marked("Summary")).toBe(false);
    // without the version it started from nothing is marked
    expect(publishList("process", current, draft).some((l) => l.undoes)).toBe(false);
  });
  it("does not mark a change the draft makes on purpose to something they also changed", () => {
    const base0 = base(), current = { ...base(), estimatedDuration: "2 days" }, draft = { ...base(), estimatedDuration: "3 days" };
    expect(publishList("process", current, draft, undefined, base0)[0]).toEqual({ text: "Typical lead time: “2 days” → “3 days”", undoes: false });
  });
});

describe("a message about answers", () => {
  it("does not end a question with a second mark", () => {
    const p = base();
    // "Yes" of "Approved?" now goes to the decision itself's neighbour named with a question mark
    const q = { ...p, steps: p.steps.map((s) => (s.id === "ok" ? { ...s, next: s.next.map((n) => (n.label === "Yes" ? { ...n, to: "approve" } : n)) } : s.id === "approve" ? { ...s, title: "Is it approved?" } : s)) };
    const said = restructureNotice({ ...p, steps: p.steps.map((s) => (s.id === "approve" ? { ...s, title: "Is it approved?" } : s)) }, q)!;
    expect(said.title).toMatch(/now goes to step \d+ “Is it approved\?”\.$/);
  });
});

describe("a move is remembered with the document it made", () => {
  it("so a swap of two neighbours names the one that was moved", () => {
    const doc = { steps: [] };
    noteMove(doc, "fix");
    expect(moveOf(doc)).toBe("fix");
    expect(moveOf({ steps: [] })).toBeUndefined();
    expect(moveOf(undefined)).toBeUndefined();
  });
});
