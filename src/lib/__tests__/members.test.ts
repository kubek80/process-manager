import { describe, expect, it } from "vitest";
import { GROUP, groupKindOf, hasMembers, looksLikeEmail, MEMBER_ROLE, membersOf, OWNER_ROLE, rankLabel, rankOf, roleFor } from "../members";
import type { Assignment, Membership, Role } from "../../types";

const a = (email: string, role: Role, scope = ""): Assignment => ({ email, role, scope, grantedBy: "dana@example.com", grantedAt: "2026-11-16T10:00:00Z" });

describe("the members of a team, a platform and a practice", () => {
  const all = [
    a("riley@example.com", "practice-owner", "security"), a("riley@example.com", "owner", "security"),
    a("casey@example.com", "owner", "cloud-platform-team"), a("bo@example.com", "owner", "cloud-platform-team"),
    a("jordan@example.com", "owner", "cloud-platform-team"), a("jordan@example.com", "platform-owner", "google-cloud"), a("jordan@example.com", "practice-owner", "engineering"),
    a("alex@example.com", "process-editor"), a("kim@example.com", "standards-editor"), a("dana@example.com", "admin"),
  ];

  it("are the people with the role for that group, sorted by email", () => {
    expect(membersOf(all, "team", "cloud-platform-team").map((m) => m.email)).toEqual(["bo@example.com", "casey@example.com", "jordan@example.com"]);
    expect(membersOf(all, "platform", "google-cloud").map((m) => m.email)).toEqual(["jordan@example.com"]);
    expect(membersOf(all, "practice", "engineering").map((m) => m.email)).toEqual(["jordan@example.com"]);
  });

  it("tell a team from a practice with the same id", () => {
    expect(membersOf(all, "team", "security").map((m) => m.role)).toEqual(["owner"]);
    expect(membersOf(all, "practice", "security").map((m) => m.role)).toEqual(["practice-owner"]);
    expect(membersOf(all, "platform", "security")).toEqual([]);
  });

  it("do not include people whose role covers everything, or nobody at all", () => {
    expect(membersOf(all, "team", "network-team")).toEqual([]);
    expect(membersOf(all, "team", "")).toEqual([]); // roles without a group are not "members of no group"
  });

  it("work on what everyone may read, once per person", () => {
    const list: Membership[] = [
      { email: "jordan@example.com", role: "platform-owner", scope: "google-cloud" },
      { email: "jordan@example.com", role: "platform-owner", scope: "google-cloud" },
      { email: "ann@example.com", role: "platform-owner", scope: "google-cloud" },
    ];
    expect(membersOf(list, "platform", "google-cloud").map((m) => m.email)).toEqual(["ann@example.com", "jordan@example.com"]);
  });

  it("come from one owner role per kind of group, and one member role for a platform and a practice", () => {
    expect(OWNER_ROLE).toEqual({ team: "owner", platform: "platform-owner", practice: "practice-owner" });
    expect(MEMBER_ROLE).toEqual({ platform: "platform-member", practice: "practice-member" });
    expect(roleFor("team", "member")).toBeUndefined();
    expect(roleFor("practice", "member")).toBe("practice-member");
    expect(roleFor("team", "owner")).toBe("owner");
    expect(hasMembers("team")).toBe(false);
    expect(hasMembers("platform")).toBe(true);
    expect(groupKindOf("platform-member")).toBe("platform");
    expect(groupKindOf("practice-member")).toBe("practice");
    expect(rankOf("platform-member")).toBe("member");
    expect(rankOf("practice-owner")).toBe("owner");
    expect(rankOf("owner")).toBe("owner");
    expect(rankOf("admin")).toBeUndefined();
    expect(rankLabel("platform", "member")).toBe("Platform member");
    expect(rankLabel("practice", "owner")).toBe("Practice owner");
    expect(rankLabel("team", "owner")).toBe("Owner");
    expect(GROUP.team.member).toBeUndefined();
    expect(groupKindOf("platform-owner")).toBe("platform");
    expect(groupKindOf("practice-owner")).toBe("practice");
    expect(groupKindOf("owner")).toBe("team");
    expect(groupKindOf("standards-editor")).toBeUndefined();
  });

  it("tell owners from members of the same platform", () => {
    const list: Membership[] = [
      { email: "jordan@example.com", role: "platform-owner", scope: "google-cloud" },
      { email: "morgan@example.com", role: "platform-member", scope: "google-cloud" },
      { email: "ann@example.com", role: "platform-member", scope: "azure" },
      { email: "kim@example.com", role: "practice-member", scope: "google-cloud" },
    ];
    expect(membersOf(list, "platform", "google-cloud").map((m) => m.email)).toEqual(["jordan@example.com"]);
    expect(membersOf(list, "platform", "google-cloud", "owner").map((m) => m.email)).toEqual(["jordan@example.com"]);
    expect(membersOf(list, "platform", "google-cloud", "member").map((m) => m.email)).toEqual(["morgan@example.com"]);
    expect(membersOf(list, "practice", "google-cloud", "member").map((m) => m.email)).toEqual(["kim@example.com"]);
    expect(membersOf(list, "team", "google-cloud", "member")).toEqual([]);
  });

  it("recognises an email address", () => {
    expect(looksLikeEmail(" kim@example.com ")).toBe(true);
    for (const bad of ["kim", "kim@", "@example.com", "kim@example", "kim lee@example.com", ""]) expect(looksLikeEmail(bad)).toBe(false);
  });
});
