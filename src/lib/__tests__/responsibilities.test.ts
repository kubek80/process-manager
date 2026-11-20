import { describe, expect, it } from "vitest";
import { accountRoles, changedBy, groupsOf, myGroups, responsibilities, reviewsDue, urgent } from "../responsibilities";
import type { Feedback, FeedbackByTarget, Perms } from "../../types";
import { base, baseStandard } from "./fixtures";

const perms = (p: Partial<Perms>): Perms => ({ admin: false, catalog: false, processes: false, standards: false, owns: [], platforms: [], practices: [], ...p });
const fb = (id: string, targetId: string, createdAt: string, resolved = false): Feedback => ({
  id, targetKind: "process", targetId, kind: "broken", text: `Problem ${id}`, author: { name: "Sam", email: "sam@example.com" }, createdAt,
  resolved, alsoHit: 0, alsoHitByMe: false, stale: false, mine: false, canManage: true,
});
const TODAY = "2026-11-16";

describe("whose it is", () => {
  it("is what the person's teams maintain and what belongs to their platforms and practices", () => {
    const jordan = perms({ owns: ["cloud-platform-team"], platforms: ["google-cloud"], practices: ["engineering", "security"] });
    expect(myGroups(jordan)).toEqual([
      { kind: "team", id: "cloud-platform-team" }, { kind: "platform", id: "google-cloud" },
      { kind: "practice", id: "engineering" }, { kind: "practice", id: "security" },
    ]);
    expect(myGroups(perms({ processes: true, admin: true }))).toEqual([]); // editing everything is not owning anything
    expect(groupsOf(jordan, { owner: "cloud-platform-team", platform: "google-cloud", practice: "engineering" }).map((g) => g.kind)).toEqual(["team", "platform", "practice"]);
    expect(groupsOf(jordan, { owner: "security", platform: "azure" })).toEqual([]); // a team with the id of a practice is not the practice
    expect(groupsOf(jordan, { practice: "security" })).toEqual([{ kind: "practice", id: "security" }]);
    expect(groupsOf(jordan, {})).toEqual([]);
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

  it("can be narrowed to one team, platform or practice, and says through which it is yours", () => {
    const both = perms({ owns: ["cloud-platform-team"], practices: ["security"], platforms: ["google-cloud"] });
    const secStd = { ...baseStandard(), id: "sec-std", owner: "security", practice: "security" };
    const gcp = { ...base(), id: "gcp", title: "GCP", owner: "security", platform: "google-cloud" };
    const all = responsibilities(both, null, [mine, theirs, gcp], [std, secStd], feedback, TODAY);
    // "theirs" is maintained by the team security, which this person is not Owner of
    expect(all.owned.map((o) => o.doc.id).sort()).toEqual(["demo-standard", "gcp", "mine", "sec-std"]);
    // teams first, then platforms, then practices
    expect(all.owned.map((o) => `${o.groups[0].kind}:${o.doc.id}`)).toEqual(["team:demo-standard", "team:mine", "platform:gcp", "practice:sec-std"]);
    expect(responsibilities(both, "practice:security", [mine, theirs, gcp], [std, secStd], feedback, TODAY).owned.map((o) => o.doc.id)).toEqual(["sec-std"]);
    expect(responsibilities(both, "team:security", [mine, theirs, gcp], [std, secStd], feedback, TODAY).owned).toEqual([]);
    expect(responsibilities(both, "platform:google-cloud", [mine, theirs, gcp], [std, secStd], feedback, TODAY).owned.map((o) => o.doc.id)).toEqual(["gcp"]);
    const twice = responsibilities(perms({ owns: ["cloud-platform-team"], platforms: ["google-cloud"] }), null, [{ ...mine, platform: "google-cloud" }], [], feedback, TODAY);
    expect(twice.owned[0].groups).toEqual([{ kind: "team", id: "cloud-platform-team" }, { kind: "platform", id: "google-cloud" }]);
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

describe("who made the last change", () => {
  it("names the person where the page knows them, else their email", () => {
    expect(changedBy("Jordan@example.com", { "jordan@example.com": "Jordan Platform" })).toBe("Jordan Platform");
    expect(changedBy("riley@example.com", {})).toBe("riley@example.com");
  });
  it("has plain words for changes no person made", () => {
    expect(changedBy("import")).toBe("Imported");
    expect(changedBy("system")).toBe("Updated by the portal");
    expect(changedBy(undefined)).toBe("");
  });
});

describe("the roles in the account menu", () => {
  const groups = {
    team: [{ id: "cloud-platform-team", name: "Cloud Platform team" }],
    platform: [{ id: "gcp", name: "Google Cloud" }],
    practice: [{ id: "engineering", name: "Engineering" }],
  };
  it("says of what somebody is an owner, in the words of Admin > Access", () => {
    expect(accountRoles(perms({ platforms: ["gcp"], practices: ["engineering"], owns: ["cloud-platform-team"] }), groups))
      .toEqual(["Platform owner for Google Cloud", "Practice owner for Engineering", "Owner for Cloud Platform team"]);
  });
  it("names the editors and the lists manager, and a reader as a reader", () => {
    expect(accountRoles(perms({ processes: true, catalog: true }), groups)).toEqual(["Lists manager", "Process editor"]);
    expect(accountRoles(perms({}), groups)).toEqual(["Reader"]);
  });
  it("an admin is an admin, with whatever they own besides", () => {
    expect(accountRoles(perms({ admin: true, catalog: true, processes: true, standards: true, owns: ["cloud-platform-team"] }), groups))
      .toEqual(["Admin", "Owner for Cloud Platform team"]);
  });
  it("an entry no longer in the lists is named by its id", () => {
    expect(accountRoles(perms({ owns: ["gone-team"] }), groups)).toEqual(["Owner for gone-team"]);
  });
});

describe("the reviews tile", () => {
  it("takes the colour of the worst case and says the split in words", () => {
    expect(reviewsDue(6, 5)).toEqual({ count: 11, tone: "bad", label: "reviews due", split: "6 overdue · 5 due" });
    expect(reviewsDue(0, 2)).toEqual({ count: 2, tone: "warn", label: "reviews due", split: "" });
    expect(reviewsDue(1, 0)).toEqual({ count: 1, tone: "bad", label: "review due", split: "it is overdue" });
    expect(reviewsDue(3, 0).split).toBe("all overdue");
    expect(reviewsDue(0, 0)).toMatchObject({ count: 0, tone: "good", split: "" });
  });
});
