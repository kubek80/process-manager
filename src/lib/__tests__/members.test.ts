import { describe, expect, it } from "vitest";
import { groupKindOf, looksLikeEmail, MEMBER_ROLE, membersOf } from "../members";
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

  it("come from one role per kind of group", () => {
    expect(MEMBER_ROLE).toEqual({ team: "owner", platform: "platform-owner", practice: "practice-owner" });
    expect(groupKindOf("platform-owner")).toBe("platform");
    expect(groupKindOf("practice-owner")).toBe("practice");
    expect(groupKindOf("owner")).toBe("team");
    expect(groupKindOf("standards-editor")).toBeUndefined();
  });

  it("recognises an email address", () => {
    expect(looksLikeEmail(" kim@example.com ")).toBe(true);
    for (const bad of ["kim", "kim@", "@example.com", "kim@example", "kim lee@example.com", ""]) expect(looksLikeEmail(bad)).toBe(false);
  });
});
