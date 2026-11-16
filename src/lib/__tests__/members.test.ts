import { describe, expect, it } from "vitest";
import { looksLikeEmail, membersOf } from "../members";
import type { Assignment, Role } from "../../types";

const a = (email: string, role: Role, scope = ""): Assignment => ({ email, role, scope, grantedBy: "dana@example.com", grantedAt: "2026-11-16T10:00:00Z" });

describe("the members of a team", () => {
  const all = [
    a("riley@example.com", "standards-editor", "security"), a("riley@example.com", "owner", "security"),
    a("casey@example.com", "owner", "cloud-platform-team"), a("bo@example.com", "owner", "cloud-platform-team"),
    a("alex@example.com", "process-editor"), a("kim@example.com", "standards-editor"), a("dana@example.com", "admin"),
  ];

  it("are the people with a role that is limited to it, in a stable order", () => {
    expect(membersOf(all, "cloud-platform-team").map((m) => m.email)).toEqual(["bo@example.com", "casey@example.com"]);
    const [riley] = membersOf(all, "security");
    expect(riley.email).toBe("riley@example.com");
    expect(riley.roles.map((r) => r.role)).toEqual(["owner", "standards-editor"]); // Owner first, however they were given
  });

  it("do not include people whose role covers everything, or nobody at all", () => {
    expect(membersOf(all, "network-team")).toEqual([]);
    expect(membersOf(all, "")).toEqual([]); // roles without a team are not "members of no team"
  });

  it("recognises an email address", () => {
    expect(looksLikeEmail(" kim@example.com ")).toBe(true);
    for (const bad of ["kim", "kim@", "@example.com", "kim@example", "kim lee@example.com", ""]) expect(looksLikeEmail(bad)).toBe(false);
  });
});
