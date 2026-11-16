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
    expect(answersFor(casey, "cloud-platform-team")).toBe(true);
    expect(answersFor(casey, "security")).toBe(false);
    expect(answersFor(casey, undefined)).toBe(false);
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
  const r = responsibilities(["cloud-platform-team"], [fine, theirs, draft, soon, mine, noRhythm], [std], feedback, TODAY);

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
    expect(responsibilities([], [mine], [std], feedback, TODAY)).toEqual({ owned: [], tasks: [] });
  });
});
