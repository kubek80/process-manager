import { describe, expect, it } from "vitest";
import { answersFor, myTeams, responsibilities, urgent } from "../responsibilities";
import type { Feedback, FeedbackByTarget, Perms } from "../../types";
import { base, baseStandard } from "./fixtures";

const perms = (p: Partial<Perms>): Perms => ({ admin: false, catalog: false, processes: false, standards: false, standardUnits: [], owns: [], ...p });
const fb = (id: string, targetId: string, createdAt: string, resolved = false): Feedback => ({
  id, targetKind: "process", targetId, kind: "broken", text: `Problem ${id}`, author: { name: "Sam", email: "sam@example.com" }, createdAt,
  resolved, alsoHit: 0, alsoHitByMe: false, stale: false, mine: false, canManage: true,
});
const TODAY = "2026-11-16";

describe("whose it is", () => {
  it("is what the teams own that somebody is owner of, and the units they edit standards for", () => {
    expect(myTeams(perms({ owns: ["cloud-platform-team"], standardUnits: ["security", "cloud-platform-team"] }))).toEqual(["cloud-platform-team", "security"]);
    expect(myTeams(perms({ processes: true, admin: true }))).toEqual([]); // editing everything is not owning anything
    const casey = perms({ owns: ["cloud-platform-team"] });
    expect(answersFor(casey, "process", "cloud-platform-team")).toBe(true);
    expect(answersFor(casey, "standard", "cloud-platform-team")).toBe(true);
    expect(answersFor(casey, "process", "security")).toBe(false);
    expect(answersFor(casey, "process", undefined)).toBe(false);
    // editing a unit's standards makes its standards yours, not the processes it happens to own
    const editor = perms({ standardUnits: ["security"] });
    expect(answersFor(editor, "standard", "security")).toBe(true);
    expect(answersFor(editor, "process", "security")).toBe(false);
  });
});

describe("what needs doing", () => {
  const mine = { ...base(), id: "mine", title: "Mine", review: { intervalMonths: 6, lastReviewedAt: "2026-01-01" } }; // overdue since July
  const soon = { ...base(), id: "soon", title: "Soon", review: { intervalMonths: 6, lastReviewedAt: "2026-06-01" } }; // due 1 December
  const fine = { ...base(), id: "fine", title: "Fine", review: { intervalMonths: 12, lastReviewedAt: "2026-10-01" } };
  const draft = { ...base(), id: "draft", title: "Draft", status: "draft" as const };
  const noRhythm = { ...base(), id: "no-rhythm", title: "No rhythm", review: undefined };
  const theirs = { ...base(), id: "theirs", title: "Theirs", owner: "security", review: { intervalMonths: 6, lastReviewedAt: "2020-01-01" } };
  const std = { ...baseStandard(), owner: "cloud-platform-team", review: { intervalMonths: 12, lastReviewedAt: "2025-01-01" } };
  const feedback: FeedbackByTarget = {
    process: { fine: [fb("new", "fine", "2026-11-10T10:00:00Z"), fb("old", "fine", "2026-10-01T10:00:00Z"), fb("done", "fine", "2026-09-01T10:00:00Z", true)], theirs: [fb("x", "theirs", "2026-11-01T10:00:00Z")] },
    standard: {},
  };
  const r = responsibilities(perms({ owns: ["cloud-platform-team"] }), null, [fine, theirs, draft, soon, mine, noRhythm], [std], feedback, TODAY);

  it("covers only what the person's teams own", () => {
    expect(r.owned.map((o) => o.doc.id)).toEqual(["demo-standard", "draft", "fine", "mine", "no-rhythm", "soon"]);
    expect(r.owned.find((o) => o.doc.id === "fine")!.open.map((f) => f.id)).toEqual(["old", "new"]);
  });

  it("lists the most urgent first: overdue reviews, then feedback by age, then what is due soon, drafts, and what has no rhythm", () => {
    expect(r.tasks.map((t) => `${t.kind}:${t.feedback?.id ?? t.item.doc.id}`)).toEqual([
      "review-overdue:demo-standard", "review-overdue:mine", "feedback:old", "feedback:new", "review-soon:soon", "draft:draft", "no-rhythm:no-rhythm",
    ]);
    expect(urgent(r.tasks)).toBe(4);
  });

  it("is empty for somebody who owns nothing", () => {
    expect(responsibilities(perms({ processes: true }), null, [mine], [std], feedback, TODAY)).toEqual({ owned: [], tasks: [] });
  });

  it("can be narrowed to one team, and follows what each role covers", () => {
    const both = perms({ owns: ["cloud-platform-team"], standardUnits: ["security"] });
    const secStd = { ...baseStandard(), id: "sec-std", owner: "security" };
    const all = responsibilities(both, null, [mine, theirs], [std, secStd], feedback, TODAY);
    // "theirs" is a process of security: a standards editor of that unit does not answer for it
    expect(all.owned.map((o) => o.doc.id).sort()).toEqual(["demo-standard", "mine", "sec-std"]);
    expect(responsibilities(both, "security", [mine, theirs], [std, secStd], feedback, TODAY).owned.map((o) => o.doc.id)).toEqual(["sec-std"]);
  });
});

describe("the order of what needs doing", () => {
  const p = (id: string, lastReviewedAt?: string) => ({ ...base(), id, title: id, review: { intervalMonths: 6, ...(lastReviewedAt ? { lastReviewedAt } : {}) } });
  const owner = perms({ owns: ["cloud-platform-team"] });

  it("puts the feedback that waits longest first, whatever it is about", () => {
    const overdue = p("overdue", "2025-01-01"), fine = p("fine", "2026-10-01");
    const feedback: FeedbackByTarget = {
      process: { overdue: [fb("second", "overdue", "2026-11-10T10:00:00Z")], fine: [fb("first", "fine", "2026-09-01T10:00:00Z"), fb("third", "fine", "2026-11-12T10:00:00Z")] },
      standard: {},
    };
    const r = responsibilities(owner, null, [overdue, fine], [], feedback, TODAY);
    expect(r.tasks.filter((t) => t.kind === "feedback").map((t) => t.feedback!.id)).toEqual(["first", "second", "third"]);
  });

  it("puts what was never reviewed before everything that is overdue, and the most overdue next", () => {
    const r = responsibilities(owner, null, [p("a-bit", "2026-04-01"), p("never"), p("long", "2024-01-01")], [], { process: {}, standard: {} }, TODAY);
    expect(r.tasks.map((t) => t.item.doc.id)).toEqual(["never", "long", "a-bit"]);
  });

  it("survives a review date that is not a date", () => {
    const r = responsibilities(owner, null, [p("broken", "2026-13-45")], [], { process: {}, standard: {} }, TODAY);
    expect(r.tasks.map((t) => `${t.kind}:${t.item.review.label}`)).toEqual(["review-overdue:Review date cannot be read"]);
  });
});
