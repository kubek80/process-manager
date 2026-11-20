import { describe, expect, it } from "vitest";
import { draftMovedOn, draftRevisionToSend, newerChangesLine, saveCallOf, statusChangedSentence } from "../editing";

describe("Save draft always works", () => {
  it("saves a never-published document as itself while nothing is to fix", () => {
    expect(saveCallOf("unpublished")).toBe("save-version");
    expect(saveCallOf("unpublished", false, { toFix: false, working: false })).toBe("save-version");
  });
  it("keeps what still has something to fix as its working draft", () => {
    expect(saveCallOf("unpublished", false, { toFix: true })).toBe("save-working-draft");
    expect(saveCallOf("unpublished", false, { toFix: true, working: true })).toBe("save-working-draft");
  });
  it("stores it as itself again, in place of the working draft, once nothing is to fix", () => {
    expect(saveCallOf("unpublished", false, { toFix: false, working: true })).toBe("replace-working-draft");
  });
  it("saves a published document's changes as its working draft, whatever is to fix", () => {
    expect(saveCallOf("working", false, { toFix: false })).toBe("save-working-draft");
    expect(saveCallOf("working", false, { toFix: true, working: true })).toBe("save-working-draft");
  });
  it("brings something deleted back as a draft of its own", () => {
    expect(saveCallOf("unpublished", true, { toFix: false, working: true })).toBe("recreate-as-draft");
    expect(saveCallOf("working", true)).toBe("recreate-as-draft");
  });
});

describe("what somebody else did meanwhile", () => {
  const dana = { updatedBy: "dana@example.com", updatedByName: "Dana Admin", updatedAt: "2026-11-20T09:12:00Z" };
  it("names the person and what they did", () => {
    expect(statusChangedSentence("process", "active", { ...dana, status: "deprecated" }, "alex@example.com"))
      .toMatch(/^Dana Admin retired this process at .+, while you were editing\. Readers see it marked as retired\./);
    expect(statusChangedSentence("process", undefined, { ...dana, status: "draft" }, "alex@example.com")).toMatch(/^Dana Admin unpublished this process/);
    expect(statusChangedSentence("standard", "draft", { ...dana, status: "active" }, "alex@example.com")).toMatch(/^Dana Admin published this standard/);
    expect(statusChangedSentence("process", "deprecated", { ...dana, status: "active" }, "alex@example.com")).toMatch(/^Dana Admin brought this process back into use at /);
  });
  it("says nothing when the status is the same, or it was the person themselves", () => {
    expect(statusChangedSentence("process", "active", { ...dana, status: "active" }, "alex@example.com")).toBe("");
    expect(statusChangedSentence("process", "active", { ...dana, status: "deprecated" }, "DANA@example.com")).toBe("");
    expect(statusChangedSentence("process", "active", undefined, "alex@example.com")).toBe("");
  });
  it("falls back to the email, then to somebody else", () => {
    expect(statusChangedSentence("process", "active", { status: "deprecated", updatedBy: "dana@example.com" })).toMatch(/^dana@example\.com retired/);
  });
});

describe("the reader's page of a never-published document with newer changes", () => {
  it("tells its editors, by name when it was somebody else", () => {
    expect(newerChangesLine({ updatedAt: "", updatedBy: "alex@example.com" }, "alex@example.com")).toBe("There are newer changes on the editing screen.");
    expect(newerChangesLine({ updatedAt: "", updatedBy: "dana@example.com", updatedByName: "Dana Admin" }, "alex@example.com"))
      .toBe("There are newer changes on the editing screen by Dana Admin.");
  });
});

describe("a save of the shared draft is made from the revision the changes came from", () => {
  it("sends the revision the changes were started from, not a newer one loaded meanwhile", () => {
    expect(draftRevisionToSend(3)).toBe(3);
    expect(draftRevisionToSend(0)).toBe(0);
    // a plain version conflict does not change which draft the changes came from
    expect(draftRevisionToSend(3, { exists: true, version: 9 })).toBe(3);
  });
  it("goes over theirs only after the question", () => {
    expect(draftRevisionToSend(3, { draft: true, exists: true, version: 5 })).toBe(5);
    expect(draftRevisionToSend(3, { draft: true, exists: false })).toBe(0);
  });
  it("marks the screen behind when somebody else saved the draft after the changes were started", () => {
    expect(draftMovedOn({ dirty: true, editedFrom: 1, working: { revision: 2 } })).toBe(true);
    expect(draftMovedOn({ dirty: true, editedFrom: 0, working: { revision: 1 } })).toBe(true);
    expect(draftMovedOn({ dirty: true, editedFrom: 2, working: { revision: 2 } })).toBe(false);
    expect(draftMovedOn({ dirty: false, editedFrom: 1, working: { revision: 2 } })).toBe(false);
    expect(draftMovedOn({ dirty: true, editedFrom: 0, working: null })).toBe(false);
  });
});
