import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changeBlocked, isViewingAs, mayViewAs, NO_PERMS, opensChange, viewingRefusal } from "../rights";
import { returnPlace, VIEW_AS_HOME, viewAsName, viewingEnds } from "../users";

const admin = { ...NO_PERMS, admin: true, catalog: true, processes: true, standards: true };
const dana = { user: { email: "dana@example.com", name: "Dana Admin" }, perms: admin };
const asCasey = { user: { email: "casey@example.com", name: "Casey Owner" }, perms: { ...NO_PERMS, owns: ["cloud-platform-team"] }, viewedBy: { email: "dana@example.com", name: "Dana Admin", until: "2026-11-24T15:42:00Z" } };

describe("viewing the portal as somebody else", () => {
  it("is started only by an admin, not while already viewing, never as oneself", () => {
    expect(mayViewAs(dana, "casey@example.com")).toBe(true);
    expect(mayViewAs(dana, "DANA@example.com ")).toBe(false);
    expect(mayViewAs(dana, "")).toBe(false);
    expect(mayViewAs({ ...dana, perms: { ...admin, admin: false } }, "casey@example.com")).toBe(false);
    expect(mayViewAs({ user: dana.user }, "casey@example.com")).toBe(false);
    // viewing as another admin: their rights, but no second viewing from there
    expect(mayViewAs({ ...asCasey, perms: admin }, "jordan@example.com")).toBe(false);
  });

  it("says why nothing can be changed, in the server's own sentence", () => {
    expect(isViewingAs(asCasey)).toBe(true);
    expect(isViewingAs(dana)).toBe(false);
    expect(changeBlocked(dana)).toBe("");
    expect(changeBlocked(asCasey)).toBe("You are viewing the portal as Casey Owner, so nothing can be changed. Stop viewing first.");
    expect(changeBlocked({ ...asCasey, user: { email: "kim@example.com", name: "" } })).toBe(viewingRefusal("kim@example.com"));
    // the server writes the same sentence (server/internal/httpapi/viewas.go)
    const go = fs.readFileSync(path.resolve(__dirname, "../../../server/internal/httpapi/viewas.go"), "utf8");
    const [before, after] = viewingRefusal("\u0000").split("\u0000");
    expect(go).toContain(`"${before}" + personLabel(s.Email, s.Name) + "${after}"`);
  });

  it("keeps the editing screen closed, and only it", () => {
    for (const h of ["#/p/request-gcp-project/edit", "#/s/secure-logging/edit", "#/p/x/edit/step-2"]) expect(opensChange(h), h).toBe(true);
    for (const h of ["#/p/request-gcp-project", "#/p/editors", "#/s/edit", "#/admin/access", "#/mine", "#/p/x/editing"]) expect(opensChange(h), h).toBe(false);
  });

  it("goes back to where it started, never to the editing screen, else to Admin › Access", () => {
    expect(returnPlace("#/team/cloud-platform-team")).toBe("#/team/cloud-platform-team");
    expect(returnPlace("#/admin/access")).toBe("#/admin/access");
    expect(returnPlace(null)).toBe(VIEW_AS_HOME);
    expect(returnPlace("")).toBe(VIEW_AS_HOME);
    expect(returnPlace("https://elsewhere.example.com/")).toBe(VIEW_AS_HOME);
    expect(returnPlace("javascript:alert(1)")).toBe(VIEW_AS_HOME);
    expect(returnPlace("#/p/x/edit")).toBe(VIEW_AS_HOME);
    expect(VIEW_AS_HOME).toBe("#/admin/access");
  });

  it("says when it ends by itself, in the reader's time", () => {
    const at = new Date("2026-11-24T15:42:00Z");
    const hh = String(at.getHours()).padStart(2, "0"), mm = String(at.getMinutes()).padStart(2, "0");
    expect(viewingEnds("2026-11-24T15:42:00Z")).toBe(`${hh}:${mm}`);
    expect(viewingEnds(undefined)).toBe("");
    expect(viewingEnds("nonsense")).toBe("");
    expect(viewAsName("Casey Owner")).toBe("View the portal as Casey Owner");
  });
});
