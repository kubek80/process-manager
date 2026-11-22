import { describe, expect, it } from "vitest";
import { choicesOf, deleteBlocked, isLastAdmin, normalRoles, roleLine, roleProblems, rolesDiff, rolesOf, shownRoles, userMatches, type AdminUser, type Groups } from "../users";

const groups: Groups = {
  team: [{ id: "cloud-platform", name: "Cloud Platform" }],
  platform: [{ id: "gcp", name: "Google Cloud" }, { id: "akamai", name: "Akamai" }],
  practice: [{ id: "engineering", name: "Engineering" }],
};
const dana: AdminUser = { email: "dana@example.com", name: "Dana", bootstrap: true, roles: [] };
const ana: AdminUser = { email: "ana@example.com", name: "Ana", bootstrap: false, roles: [{ role: "admin", scope: "" }, { role: "platform-owner", scope: "gcp" }] };
const sam: AdminUser = { email: "sam@example.com", bootstrap: false, roles: [{ role: "owner", scope: "cloud-platform" }] };

describe("roles as readable lines", () => {
  it("names the team, platform or practice", () => {
    expect(roleLine({ role: "platform-owner", scope: "gcp" }, groups)).toBe("Platform owner for Google Cloud");
    expect(roleLine({ role: "owner", scope: "cloud-platform" }, groups)).toBe("Owner for Cloud Platform");
    expect(roleLine({ role: "admin", scope: "" }, groups)).toBe("Admin");
    expect(roleLine({ role: "practice-owner", scope: "gone" }, groups)).toBe("Practice owner for gone");
    expect(roleLine({ role: "platform-member", scope: "gcp" }, groups)).toBe("Platform member for Google Cloud");
    expect(roleLine({ role: "practice-member", scope: "engineering" }, groups)).toBe("Practice member for Engineering");
  });
  it("orders the member roles after the owner roles, and each needs its platform or practice", () => {
    const morgan = [{ role: "practice-member" as const, scope: "engineering" }, { role: "platform-member" as const, scope: "gcp" }, { role: "owner" as const, scope: "cloud-platform" }, { role: "platform-owner" as const, scope: "akamai" }];
    expect(normalRoles(morgan).map((r) => r.role)).toEqual(["platform-owner", "platform-member", "practice-member", "owner"]);
    expect(normalRoles([{ role: "platform-member", scope: "" }])).toEqual([]);
    const c = choicesOf([]);
    c["practice-member"] = { on: true, scopes: [""] };
    expect(roleProblems({ email: "new@example.com", users: [], groups, me: "dana@example.com", choices: c })).toEqual(["Choose the practice for Practice member, or remove that line."]);
    c["practice-member"] = { on: true, scopes: ["engineering"] };
    expect(rolesOf(c)).toEqual([{ role: "practice-member", scope: "engineering" }]);
    expect(userMatches({ email: "m@example.com", bootstrap: false, roles: [{ role: "platform-member", scope: "gcp" }] }, "member google", groups)).toBe(true);
  });
  it("shows the admin role that comes from the server settings", () => {
    expect(shownRoles(dana)).toEqual([{ role: "admin", scope: "" }]);
    expect(shownRoles(ana)).toEqual(ana.roles.map(({ role, scope }) => ({ role, scope })));
  });
  it("the search finds by name, email and role", () => {
    expect(userMatches(ana, "google", groups)).toBe(true);
    expect(userMatches(ana, "ana admin", groups)).toBe(true);
    expect(userMatches(sam, "google", groups)).toBe(false);
    expect(userMatches(sam, "", groups)).toBe(true);
  });
});

describe("the roles dialog", () => {
  it("turns stored roles into choices and back, in a fixed order and once each", () => {
    const c = choicesOf([{ role: "platform-owner", scope: "akamai" }, { role: "process-editor", scope: "" }, { role: "platform-owner", scope: "gcp" }]);
    expect(c["platform-owner"]).toEqual({ on: true, scopes: ["akamai", "gcp"] });
    expect(c.admin.on).toBe(false);
    expect(rolesOf(c)).toEqual([{ role: "process-editor", scope: "" }, { role: "platform-owner", scope: "akamai" }, { role: "platform-owner", scope: "gcp" }]);
  });
  it("sends the complete set: an empty pick and a repeated pick are left out", () => {
    const c = choicesOf([]);
    c["practice-owner"] = { on: true, scopes: ["engineering", "", "engineering"] };
    c.admin.on = true;
    expect(rolesOf(c)).toEqual([{ role: "admin", scope: "" }, { role: "practice-owner", scope: "engineering" }]);
    expect(normalRoles([{ role: "admin", scope: "x" }])).toEqual([{ role: "admin", scope: "" }]);
  });
  it("says what changes", () => {
    const d = rolesDiff(ana.roles, [{ role: "platform-owner", scope: "gcp" }, { role: "platform-owner", scope: "akamai" }]);
    expect(d.added).toEqual([{ role: "platform-owner", scope: "akamai" }]);
    expect(d.removed).toEqual([{ role: "admin", scope: "" }]);
  });
  it("adding: needs an address, a new person and at least one role", () => {
    const base = { users: [dana, ana, sam], groups, me: "dana@example.com" };
    expect(roleProblems({ ...base, email: "nobody", choices: choicesOf([{ role: "admin", scope: "" }]) })[0]).toMatch(/email address/);
    expect(roleProblems({ ...base, email: "SAM@example.com", choices: choicesOf([{ role: "admin", scope: "" }]) })[0]).toMatch(/already has roles/);
    expect(roleProblems({ ...base, email: "new@example.com", choices: choicesOf([]) })).toEqual(["Give at least one role. Everyone who can sign in can already read."]);
    expect(roleProblems({ ...base, email: "new@example.com", choices: choicesOf([{ role: "catalog-manager", scope: "" }]) })).toEqual([]);
  });
  it("a limited role needs its team, platform or practice, each once, still in the lists", () => {
    const base = { email: "new@example.com", users: [], groups, me: "dana@example.com" };
    const c = choicesOf([]);
    c["platform-owner"] = { on: true, scopes: [""] };
    expect(roleProblems({ ...base, choices: c })).toContain("Choose the platform for Platform owner, or remove that line.");
    // a role is ticked: the list says what is missing for it, not "give at least one role"
    c.owner = { on: true, scopes: [""] };
    expect(roleProblems({ ...base, choices: c })).toEqual(["Choose the platform for Platform owner, or remove that line.", "Choose the team for Owner, or remove that line."]);
    c["platform-owner"] = { on: true, scopes: ["gcp", "gcp"] };
    expect(roleProblems({ ...base, choices: c })).toContain("Platform owner for Google Cloud is chosen twice.");
    c["platform-owner"] = { on: true, scopes: ["old"] };
    expect(roleProblems({ ...base, choices: c })[0]).toMatch(/“old” is no longer in the lists/);
  });
  it("protects the last admin and one's own admin role", () => {
    const only = { ...ana };
    const c = choicesOf(only.roles);
    c.admin.on = false;
    expect(roleProblems({ email: only.email, choices: c, user: only, users: [only, sam], groups, me: "x@example.com" })[0]).toMatch(/only admin/);
    // with an admin from the server settings there is always another
    expect(roleProblems({ email: only.email, choices: c, user: only, users: [only, dana], groups, me: "x@example.com" })).toEqual([]);
    expect(roleProblems({ email: only.email, choices: c, user: only, users: [only, dana], groups, me: "ana@example.com" })[0]).toMatch(/your own admin role/);
    // taking everything away from somebody else is fine: they can still read
    expect(roleProblems({ email: sam.email, choices: choicesOf([]), user: sam, users: [dana, sam], groups, me: "dana@example.com" })).toEqual([]);
  });
});

describe("deleting a person", () => {
  it("is refused, in plain words, for oneself, an admin from the server settings and the last admin", () => {
    expect(deleteBlocked(sam, [dana, sam], "SAM@example.com")).toMatch(/cannot delete yourself/);
    expect(deleteBlocked(dana, [dana, sam], "ana@example.com")).toMatch(/settings where the portal is installed/);
    expect(isLastAdmin(ana, [ana, sam])).toBe(true);
    expect(deleteBlocked(ana, [ana, sam], "sam@example.com")).toMatch(/only admin/);
    expect(deleteBlocked(ana, [ana, dana], "dana@example.com")).toBe("");
    expect(deleteBlocked(sam, [dana, sam], "dana@example.com")).toBe("");
  });
});
