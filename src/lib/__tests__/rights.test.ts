import { describe, expect, it } from "vitest";
import { canCreate, canEdit, canEditSomething, canManage, canOpenAdmin, completePerms, editsAll, NO_PERMS, roleLabel, wouldLoseEdit } from "../rights";
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
    expect(canEditSomething(NO_PERMS)).toBe(false);
    expect(canOpenAdmin(NO_PERMS)).toBe(false);
    expect(roleLabel(NO_PERMS)).toBe("Consumer");
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
    expect(canEditSomething(jordan)).toBe(true); // the Consumer / Editor switch
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
    expect(canEditSomething(casey)).toBe(false);
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
  });
});
