import { describe, expect, it } from "vitest";
import { BURST_MS, UNDO_LIMIT, discard, edit, fieldChanged, isDirty, redo, savedAs, serverHas, start, undo } from "../draftState";

type Doc = { title: string; tags?: string[] };
const tidy = (d: Doc): Doc => ({ title: d.title.trim(), ...(d.tags?.length ? { tags: d.tags } : {}) });
const v1: Doc = { title: "One" };
const later = (n: number) => n * (BURST_MS + 1);

describe("editing", () => {
  it("starts clean and becomes unsaved with the first real change", () => {
    let s = start(v1, 1);
    expect(isDirty(s, tidy)).toBe(false);
    s = edit(s, { title: "One " }, later(1)); // a trailing blank is tidied away on save
    expect(isDirty(s, tidy)).toBe(false);
    s = edit(s, { title: "One and a half" }, later(2));
    expect(isDirty(s, tidy)).toBe(true);
  });

  it("undoes and redoes step by step, and a new change ends redo", () => {
    let s = start(v1, 1);
    s = edit(s, { title: "Two" }, later(1));
    s = edit(s, { title: "Three" }, later(2));
    s = undo(s);
    expect(s.draft.title).toBe("Two");
    s = undo(s);
    expect(s.draft.title).toBe("One");
    expect(undo(s)).toBe(s);
    s = redo(redo(s));
    expect(s.draft.title).toBe("Three");
    expect(redo(s)).toBe(s);
    s = edit(undo(s), { title: "Other" }, later(9));
    expect(s.future).toEqual([]);
    expect(undo(s).draft.title).toBe("Two");
  });

  it("treats a burst of typing as one step and ignores changes that change nothing", () => {
    let s = start(v1, 1);
    s = edit(s, { title: "O" }, 1000);
    s = edit(s, { title: "On" }, 1100);
    s = edit(s, { title: "One more" }, 1200);
    expect(s.past).toHaveLength(1);
    expect(undo(s).draft).toEqual(v1);
    expect(edit(s, { title: "One more" }, 5000)).toBe(s);
    // after an undo the next change is a step of its own, even right away
    s = edit(undo(s), { title: "X" }, 1250);
    expect(undo(s).draft).toEqual(v1);
  });

  it("keeps a limited number of steps", () => {
    let s = start(v1, 1);
    for (let i = 0; i < UNDO_LIMIT + 20; i++) s = edit(s, { title: `T${i}` }, later(i + 1));
    expect(s.past).toHaveLength(UNDO_LIMIT);
  });

  it("can undo a discard", () => {
    let s = edit(start(v1, 1), { title: "Hours of work" }, later(1));
    s = discard(s, later(1) + 5);
    expect(isDirty(s, tidy)).toBe(false);
    expect(undo(s).draft.title).toBe("Hours of work");
  });
});

describe("saving", () => {
  it("is clean after a save and based on the new version", () => {
    let s = edit(start(v1, 1), { title: " Two " }, later(1));
    const sent = tidy(s.draft);
    s = savedAs(s, sent, 2, tidy);
    expect(s.base).toBe(2);
    expect(s.draft).toEqual({ title: "Two" });
    expect(isDirty(s, tidy)).toBe(false);
    expect(undo(s).draft).toEqual(v1); // the steps before the save can still be undone
  });

  it("keeps what was typed while the save was on its way", () => {
    let s = edit(start(v1, 1), { title: "Two" }, later(1));
    const sent = tidy(s.draft);
    s = edit(s, { title: "Two and more" }, later(2)); // typed before the server answered
    s = savedAs(s, sent, 2, tidy);
    expect(s.draft.title).toBe("Two and more");
    expect(s.base).toBe(2);
    expect(isDirty(s, tidy)).toBe(true);
  });
});

describe("somebody else saved", () => {
  const theirs: Doc = { title: "Theirs" };

  it("follows the server when there are no edits of our own", () => {
    const s = serverHas(start(v1, 1), theirs, 2, tidy);
    expect(s.draft).toEqual(theirs);
    expect(s.base).toBe(2);
    expect(serverHas(s, theirs, 2, tidy)).toBe(s);
  });

  it("keeps our edits and the old base, so that the save is refused instead of overwriting theirs", () => {
    let s = edit(start(v1, 1), { title: "Mine" }, later(1));
    s = serverHas(s, theirs, 2, tidy);
    expect(s.draft.title).toBe("Mine");
    expect(s.base).toBe(1);
    // once we chose theirs, we follow again
    s = serverHas(discard(s, later(2)), theirs, 2, tidy);
    expect(s.draft).toEqual(theirs);
  });
});

describe("what counts as one step to undo", () => {
  type Flow = { title: string; steps: { id: string; actor: string }[] };
  const same = (d: Flow) => d;
  const flow: Flow = { title: "T", steps: [{ id: "a", actor: "me" }, { id: "b", actor: "me" }] };

  it("keeps separate actions separate even when they follow each other quickly", () => {
    let s = start(flow, 1);
    s = edit(s, { ...flow, steps: [flow.steps[0]] }, 1000); // delete a step
    s = edit(s, { ...s.draft, steps: [{ id: "a", actor: "boss" }] }, 1300); // move it to another lane
    s = edit(s, { ...s.draft, title: "T2" }, 1600); // rename the process
    expect(s.past).toHaveLength(3);
    s = undo(s);
    expect(s.draft.title).toBe("T");
    expect(s.draft.steps[0].actor).toBe("boss");
    s = undo(undo(s));
    expect(isDirty(s, same)).toBe(false);
  });

  it("joins typing in one field, but not typing in two fields", () => {
    let s = start(flow, 1);
    s = edit(s, { ...flow, title: "Ti" }, 1000);
    s = edit(s, { ...flow, title: "Tit" }, 1100);
    s = edit(s, { ...s.draft, steps: [{ id: "a", actor: "m" }, flow.steps[1]] }, 1200);
    expect(s.past).toHaveLength(2);
  });

  it("finds the one value that changed", () => {
    expect(fieldChanged(flow, { ...flow, title: "X" })).toBe("title");
    expect(fieldChanged(flow, { ...flow, steps: [{ id: "a", actor: "x" }, flow.steps[1]] })).toBe("steps.0.actor");
    expect(fieldChanged(flow, { title: "X", steps: [{ id: "a", actor: "x" }, flow.steps[1]] })).toBeNull();
    expect(fieldChanged(flow, { ...flow, steps: [flow.steps[0]] })).toBeNull();
    expect(fieldChanged(flow, structuredClone(flow))).toBe("");
  });
});

describe("answers that arrive late", () => {
  it("ignores a refresh that is older than our own save", () => {
    let s = edit(start(v1, 1), { title: "Two" }, later(1));
    s = savedAs(s, { title: "Two" }, 2, tidy);
    const after = serverHas(s, v1, 1, tidy); // a refresh that left before the save and arrives after it
    expect(after).toBe(s);
    expect(after.draft.title).toBe("Two");
  });

  it("does not call a stored document changed because tidying would alter it", () => {
    const stored: Doc = { title: "Stored with a blank ", tags: [] };
    expect(isDirty(start(stored, 3), tidy)).toBe(false);
  });
});
