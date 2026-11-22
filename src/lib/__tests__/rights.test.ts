import { describe, expect, it } from "vitest";
import { belongsChoice, belongsRefused, canChangeDetails, canCreate, canDraft, canEdit, canManage, canManageMembers, canOpenAdmin, canPublish, completePerms, editsAll, groupRank, isMember, newDocPlaces, NO_PERMS, placesOf, roleLabel, seesDrafts, wouldLoseEdit, wouldLosePublish } from "../rights";
import type { Perms } from "../../types";

const perms = (p: Partial<Perms>): Perms => ({ ...NO_PERMS, ...p });
const gcp = { owner: "cloud-platform-team", platform: "google-cloud" };
const azure = { owner: "azure-platform-team", platform: "azure" };
const engineering = { owner: "developer-experience-team", practice: "engineering" };

describe("who may change a process or standard", () => {
  it("a reader may change nothing and gets no editing at all", () => {
    for (const kind of ["process", "standard"] as const) {
      expect(canEdit(NO_PERMS, kind, gcp)).toBe(false);
      expect(canManage(NO_PERMS, kind, gcp)).toBe(false);
      expect(canCreate(NO_PERMS, kind)).toBe(false);
    }
    expect(canOpenAdmin(NO_PERMS)).toBe(false);
    expect(roleLabel(NO_PERMS)).toBe("Reader");
  });

  it("an admin may change everything", () => {
    const admin = perms({ admin: true, catalog: true, processes: true, standards: true });
    expect(canEdit(admin, "process", {})).toBe(true);
    expect(canEdit(admin, "standard", azure)).toBe(true);
    expect(canOpenAdmin(admin)).toBe(true);
    expect(roleLabel(admin)).toBe("Admin");
  });

  it("a process editor changes every process and no standard; a standards editor the other way round", () => {
    const p = perms({ processes: true });
    expect(canEdit(p, "process", azure)).toBe(true);
    expect(canEdit(p, "process")).toBe(true);
    expect(canEdit(p, "standard", azure)).toBe(false);
    expect(canCreate(p, "process")).toBe(true);
    expect(canCreate(p, "standard")).toBe(false);
    const s = perms({ standards: true });
    expect(canEdit(s, "standard", engineering)).toBe(true);
    expect(canEdit(s, "process", engineering)).toBe(false);
    expect(editsAll(s, "standard")).toBe(true);
    expect(roleLabel(perms({ processes: true, catalog: true }))).toBe("Process editor · Manages the lists");
    expect(canOpenAdmin(perms({ catalog: true }))).toBe(true);
  });

  it("a platform or practice owner changes processes and standards of theirs only", () => {
    const jordan = perms({ platforms: ["google-cloud"], practices: ["engineering"], owns: ["cloud-platform-team"] });
    for (const kind of ["process", "standard"] as const) {
      expect(canEdit(jordan, kind, gcp)).toBe(true);
      expect(canEdit(jordan, kind, engineering)).toBe(true);
      expect(canEdit(jordan, kind, azure)).toBe(false);
      expect(canEdit(jordan, kind, {})).toBe(false);
      expect(canEdit(jordan, kind)).toBe(false);
      expect(editsAll(jordan, kind)).toBe(false);
      // creating is offered: what they create is filled in with one of theirs
      expect(canCreate(jordan, kind)).toBe(true);
    }
    expect(canOpenAdmin(jordan)).toBe(false);
    expect(roleLabel(jordan)).toBe("Platform owner · Practice owner · Owner");
  });

  it("an Owner of a team manages what the team maintains but does not change it", () => {
    const casey = perms({ owns: ["cloud-platform-team"] });
    expect(canEdit(casey, "process", gcp)).toBe(false);
    expect(canManage(casey, "process", gcp)).toBe(true);
    expect(canManage(casey, "standard", gcp)).toBe(true);
    expect(canManage(casey, "process", azure)).toBe(false);
    expect(canCreate(casey, "process")).toBe(false);
    expect(roleLabel(casey)).toBe("Owner");
    // whoever may edit also manages
    expect(canManage(perms({ practices: ["engineering"] }), "standard", engineering)).toBe(true);
  });

  it("a platform owner cannot move something of theirs away, nor take over something else", () => {
    const jordan = perms({ platforms: ["google-cloud"], practices: ["engineering"] });
    expect(wouldLoseEdit(jordan, "process", gcp, { ...gcp, platform: "azure" })).toBe(true);
    expect(wouldLoseEdit(jordan, "process", gcp, { ...gcp, platform: undefined })).toBe(true);
    // still theirs through the practice
    expect(wouldLoseEdit(jordan, "process", gcp, { platform: "azure", practice: "engineering" })).toBe(false);
    expect(wouldLoseEdit(jordan, "process", gcp, gcp)).toBe(false);
    // not theirs to begin with: nothing to lose (they cannot edit it at all)
    expect(wouldLoseEdit(jordan, "process", azure, gcp)).toBe(false);
    // somebody who edits everything never loses it
    expect(wouldLoseEdit(perms({ processes: true }), "process", gcp, azure)).toBe(false);
  });

  it("works with rights from a server that leaves lists out", () => {
    const p = completePerms({ processes: true } as Partial<Perms>);
    expect(p).toEqual({ ...NO_PERMS, processes: true });
    expect(canEdit({ admin: false, catalog: false, processes: false, standards: false } as Perms, "process", gcp)).toBe(false);
    expect(completePerms(undefined)).toEqual(NO_PERMS);
    expect(completePerms({ memberPlatforms: ["google-cloud"] }).memberPractices).toEqual([]);
  });

  it("somebody who edits only through ownership sets a platform or practice only from one of theirs to one of theirs", () => {
    const jordan = perms({ platforms: ["google-cloud"], practices: ["engineering"] });
    const library = { owner: "developer-experience-team", practice: "engineering", platform: "github" };
    // the pickers
    expect(belongsChoice(jordan, "process", "platform", "github")).toBe("locked");
    expect(belongsChoice(jordan, "process", "practice", "engineering")).toBe("own");
    expect(belongsChoice(jordan, "process", "platform", undefined)).toBe("own");
    expect(belongsChoice(jordan, "standard", "practice", "security")).toBe("locked");
    expect(belongsChoice(perms({ processes: true }), "process", "platform", "github")).toBe("any");
    expect(belongsChoice(perms({ processes: true }), "standard", "platform", "github")).toBe("locked"); // a process editor is not a standards editor
    // the saves
    expect(belongsRefused(jordan, "process", library, { ...library, summary: "x", owner: "cloud-platform-team" } as never)).toEqual([]);
    expect(belongsRefused(jordan, "process", library, { ...library, platform: "google-cloud" })).toEqual(["platform"]);
    expect(belongsRefused(jordan, "process", library, { ...library, platform: undefined })).toEqual(["platform"]);
    expect(belongsRefused(jordan, "process", library, { ...library, practice: undefined })).toEqual([]);
    expect(belongsRefused(jordan, "process", library, { ...library, practice: "security", platform: "azure" })).toEqual(["platform", "practice"]);
    expect(belongsRefused(jordan, "process", gcp, { ...gcp, platform: "azure" })).toEqual(["platform"]);
    expect(belongsRefused(jordan, "process", gcp, { ...gcp, practice: "engineering" })).toEqual([]);
    expect(belongsRefused(jordan, "process", { platform: "" }, { platform: undefined })).toEqual([]); // empty is none
    // creating: every platform and practice set must be his
    expect(belongsRefused(jordan, "process", undefined, { platform: "google-cloud", practice: "engineering" })).toEqual([]);
    expect(belongsRefused(jordan, "standard", undefined, { practice: "engineering", platform: "azure" })).toEqual(["platform"]);
    // general editors are not restricted
    expect(belongsRefused(perms({ standards: true }), "standard", library, { platform: "azure", practice: "security" })).toEqual([]);
    expect(belongsRefused(perms({ admin: true }), "process", library, {})).toEqual([]);
  });

  it("keeps everybody who is not a member where they were with drafts", () => {
    const jordan = perms({ platforms: ["google-cloud"] });
    const casey = perms({ owns: ["cloud-platform-team"] });
    expect(canDraft(jordan, "process", gcp)).toBe(true);
    expect(canDraft(jordan, "process", azure)).toBe(false);
    expect(canDraft(casey, "process", gcp)).toBe(false); // a team's Owner reviews, does not change
    expect(seesDrafts(casey, "process", gcp)).toBe(true);
    expect(seesDrafts(casey, "process", azure)).toBe(false);
    expect(seesDrafts(NO_PERMS, "process", gcp)).toBe(false);
    expect(canPublish).toBe(canEdit);
    expect(isMember(jordan)).toBe(false);
  });
});

describe("a member of a platform or a practice", () => {
  const morgan = perms({ memberPlatforms: ["google-cloud"], memberPractices: ["engineering"] });

  it("drafts and sees the drafts of what belongs to theirs, but publishes and manages nothing", () => {
    for (const kind of ["process", "standard"] as const) {
      expect(canDraft(morgan, kind, gcp)).toBe(true);
      expect(canDraft(morgan, kind, engineering)).toBe(true);
      expect(canDraft(morgan, kind, azure)).toBe(false);
      expect(canDraft(morgan, kind, {})).toBe(false);
      expect(canPublish(morgan, kind, gcp)).toBe(false);
      expect(canEdit(morgan, kind, gcp)).toBe(false);
      expect(canManage(morgan, kind, gcp)).toBe(false); // no reviews to confirm, no feedback to answer
      expect(seesDrafts(morgan, kind, gcp)).toBe(true);
      expect(seesDrafts(morgan, kind, azure)).toBe(false);
      expect(canCreate(morgan, kind)).toBe(true);
    }
    expect(isMember(morgan)).toBe(true);
    expect(canOpenAdmin(morgan)).toBe(false);
    expect(roleLabel(morgan)).toBe("Platform member · Practice member");
  });

  it("places a draft only on their platforms and practices, and is told before it would leave their reach", () => {
    expect(placesOf(morgan, "platform")).toEqual(["google-cloud"]);
    expect(belongsChoice(morgan, "process", "platform", "google-cloud")).toBe("own");
    expect(belongsChoice(morgan, "process", "platform", undefined)).toBe("own");
    expect(belongsChoice(morgan, "process", "platform", "azure")).toBe("locked");
    expect(belongsRefused(morgan, "process", undefined, { platform: "google-cloud", practice: "engineering" })).toEqual([]);
    expect(belongsRefused(morgan, "process", undefined, { platform: "azure" })).toEqual(["platform"]);
    expect(belongsRefused(morgan, "process", gcp, { ...gcp, platform: "azure" })).toEqual(["platform"]);
    expect(wouldLoseEdit(morgan, "process", gcp, { ...gcp, platform: undefined })).toBe(true);
    expect(wouldLoseEdit(morgan, "process", gcp, { platform: undefined, practice: "engineering" })).toBe(false);
    expect(wouldLosePublish(morgan, "process", gcp, engineering)).toBe(false); // never could publish
  });

  it("an owner who moves something to where they are only a member is told they can no longer publish it", () => {
    const both = perms({ platforms: ["google-cloud"], memberPractices: ["engineering"] });
    expect(wouldLosePublish(both, "process", gcp, { platform: undefined, practice: "engineering" })).toBe(true);
    expect(wouldLoseEdit(both, "process", gcp, { platform: undefined, practice: "engineering" })).toBe(false);
    expect(wouldLosePublish(both, "process", gcp, gcp)).toBe(false);
    expect(wouldLosePublish(both, "process", gcp, azure)).toBe(false); // that one is out of reach altogether
    expect(placesOf(perms({ platforms: ["b", "a"], memberPlatforms: ["a", "c"] }), "platform")).toEqual(["a", "b", "c"]);
  });

  it("chooses where a new document goes among their own, owned first; a general editor does not choose", () => {
    const both = perms({ platforms: ["google-cloud"], memberPlatforms: ["azure", "google-cloud"], memberPractices: ["engineering"] });
    expect(newDocPlaces(both, "process")).toEqual([
      { kind: "platform", id: "google-cloud", publishes: true },
      { kind: "platform", id: "azure", publishes: false },
      { kind: "practice", id: "engineering", publishes: false },
    ]);
    expect(newDocPlaces(perms({ processes: true, memberPlatforms: ["azure"] }), "process")).toEqual([]);
    expect(newDocPlaces(NO_PERMS, "process")).toEqual([]);
  });

  it("is told apart from an owner in a group, the stronger winning", () => {
    const both = perms({ platforms: ["google-cloud"], memberPlatforms: ["google-cloud", "azure"], owns: ["cloud-platform-team"] });
    expect(groupRank(both, "platform", "google-cloud")).toBe("owner");
    expect(groupRank(both, "platform", "azure")).toBe("member");
    expect(groupRank(both, "practice", "azure")).toBeUndefined();
    expect(groupRank(both, "team", "cloud-platform-team")).toBe("owner");
    expect(groupRank(both, "platform", "")).toBeUndefined();
  });
});

describe("who manages the people and details of a group", () => {
  const jordan = perms({ platforms: ["google-cloud"], owns: ["cloud-platform-team"] });
  const morgan = perms({ memberPlatforms: ["google-cloud"] });
  it("members are added by an admin or an owner of that platform or practice", () => {
    expect(canManageMembers(perms({ admin: true }), "platform", "azure")).toBe(true);
    expect(canManageMembers(jordan, "platform", "google-cloud")).toBe(true);
    expect(canManageMembers(jordan, "platform", "azure")).toBe(false);
    expect(canManageMembers(jordan, "practice", "google-cloud")).toBe(false);
    expect(canManageMembers(morgan, "platform", "google-cloud")).toBe(false);
    expect(canManageMembers(perms({ catalog: true }), "platform", "google-cloud")).toBe(false);
    // a team has no members, only Owners, who are given by admins
    expect(canManageMembers(perms({ admin: true }), "team", "cloud-platform-team")).toBe(false);
    expect(canManageMembers(jordan, "team", "cloud-platform-team")).toBe(false);
  });
  it("details are changed by an admin, a lists manager or an owner of that group", () => {
    expect(canChangeDetails(perms({ admin: true }), "practice", "security")).toBe(true);
    expect(canChangeDetails(perms({ catalog: true }), "team", "network-team")).toBe(true);
    expect(canChangeDetails(jordan, "platform", "google-cloud")).toBe(true);
    expect(canChangeDetails(jordan, "team", "cloud-platform-team")).toBe(true);
    expect(canChangeDetails(jordan, "team", "network-team")).toBe(false);
    expect(canChangeDetails(jordan, "platform", "azure")).toBe(false);
    expect(canChangeDetails(morgan, "platform", "google-cloud")).toBe(false);
    expect(canChangeDetails(NO_PERMS, "team", "")).toBe(false);
  });
});
