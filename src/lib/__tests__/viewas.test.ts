import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changeBlocked, isViewingAs, mayViewAs, NO_PERMS, opensChange, pageWhileViewing, readerOf, viewingRefusal } from "../rights";
import { ACTING_AS_HEADER, changeHeaders, href, loadMe, parseRoute } from "../store";
import { msUntilEnd, NO_ROLES_READER, NO_ROLES_READER_NAME, personChanged, personOption, returnPlace, VIEW_AS_HOME, viewAsName, viewAsProblem, viewingEnds } from "../users";

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
    // every address the router opens the editing screen for: the same decision as the router's
    const editing = ["#/p/request-gcp-project/edit", "#/s/secure-logging/edit", "#/p/x/edit/step-2", "#/s/x/edit/REQ-1",
      "#/p/x/json", "#/s/x/json", "#/p/x/editor", "#/p/x/editing", "#/p/x/edit?x", "#/s/x/jsonx",
      // a new document opens on the editing screen of its address
      "#/p/new-process-name/edit", "#/s/new-standard/edit"];
    for (const h of editing) {
      expect(opensChange(h), h).toBe(true);
      expect(["edit-process", "edit-standard"]).toContain(parseRoute(h).page);
    }
    for (const h of ["#/p/request-gcp-project", "#/p/editors", "#/s/edit", "#/p/edit", "#/admin/access", "#/mine", "#/p/x/flow", "#/s/x/doc", "#/", ""]) {
      expect(opensChange(h), h).toBe(false);
      expect(["edit-process", "edit-standard"]).not.toContain(parseRoute(h).page);
    }
    expect(readerOf("#/p/x/json")).toBe(href({ page: "process", id: "x", tab: "flow" }));
    expect(readerOf("#/s/y/edit/REQ-1")).toBe(href({ page: "standard", id: "y", tab: "doc" }));
    expect(readerOf("#/mine")).toBe("#/mine");
  });

  it("never shows the editing screen while viewing, whatever the address", () => {
    expect(pageWhileViewing(parseRoute("#/p/x/json"), asCasey)).toMatchObject({ page: "process", id: "x" });
    expect(pageWhileViewing(parseRoute("#/s/y/editor"), asCasey)).toMatchObject({ page: "standard", id: "y" });
    expect(pageWhileViewing(parseRoute("#/p/x/edit"), dana)).toMatchObject({ page: "edit-process", id: "x" });
    expect(pageWhileViewing(parseRoute("#/mine"), asCasey)).toMatchObject({ page: "mine" });
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
  it("takes anybody by address, also somebody without roles, and the built-in reader with no roles", () => {
    expect(viewAsProblem("", "dana@example.com")).toBe("Type the person's email address, or choose somebody from the list.");
    expect(viewAsProblem("sam@", "dana@example.com")).toBe("That is not an email address. Write one, such as name@company.com.");
    expect(viewAsProblem(" Dana@Example.com ", "dana@example.com")).toBe("This is you: the portal already shows your own view.");
    expect(viewAsProblem("never.seen@example.org", "dana@example.com")).toBe("");
    expect(viewAsProblem(NO_ROLES_READER, "dana@example.com")).toBe("");
    expect(personOption({ email: "sam@example.com", name: "Sam Consumer", roles: false })).toBe("Sam Consumer · no roles");
    expect(personOption({ email: "x@example.com", roles: true })).toBe("has roles");
    // the same address and name as the server (server/internal/httpapi/viewas.go)
    const go = fs.readFileSync(path.resolve(__dirname, "../../../server/internal/httpapi/viewas.go"), "utf8");
    expect(fs.readFileSync(path.resolve(__dirname, "../../../server/internal/rbac/rbac.go"), "utf8")).toContain(`const NoRolesReader = "${NO_ROLES_READER}"`);
    expect(go).toContain(`NoRolesReaderName = "${NO_ROLES_READER_NAME}"`);
  });
  it("reloads a page when the portal answers it as somebody else, in either direction", () => {
    const admin = { authenticated: true, user: { email: "dana@example.com" } };
    const viewing = { authenticated: true, user: { email: "casey@example.com" }, viewedBy: { email: "dana@example.com" } };
    expect(personChanged(admin, viewing)).toBe(true); // viewing started in another tab
    expect(personChanged(viewing, admin)).toBe(true); // stopped in another tab, or the hour passed
    expect(personChanged(viewing, { ...viewing, user: { email: "jordan@example.com" } })).toBe(true);
    expect(personChanged(admin, { authenticated: true, user: { email: "Dana@Example.com " } })).toBe(false);
    expect(personChanged(viewing, { ...viewing })).toBe(false);
    expect(personChanged(admin, { authenticated: false })).toBe(false); // signed out: the sign-in prompt, not a reload
    expect(personChanged({ authenticated: false }, admin)).toBe(false);
  });

  it("knows when viewing ends by itself", () => {
    const now = Date.parse("2026-11-24T15:00:00Z");
    expect(msUntilEnd("2026-11-24T15:42:00Z", now)).toBe(42 * 60_000 + 1000);
    expect(msUntilEnd("2026-11-24T14:00:00Z", now)).toBe(1000);
    expect(msUntilEnd(undefined, now)).toBeNull();
    expect(msUntilEnd("nonsense", now)).toBeNull();
  });
});

describe("the header that says whom a page acts as", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const answer = (me: object) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(me), { status: 200 })));

  it("is the address the page was opened for, sent with every change, and only after /api/me said it", async () => {
    answer({ authenticated: true, provider: "dev", user: { email: "Dana+x@example.com", name: "Dana" } });
    await loadMe();
    expect(changeHeaders()[ACTING_AS_HEADER]).toBe("Dana%2Bx%40example.com");
    expect(changeHeaders()["X-Requested-With"]).toBe("process-manager");
    expect(changeHeaders("image/png")["Content-Type"]).toBe("image/png");
    // only looking (the check for a changed view) does not change whom the page acts as
    answer({ authenticated: true, provider: "dev", user: { email: "casey@example.com", name: "Casey" }, viewedBy: { email: "dana@example.com", name: "Dana" } });
    await loadMe(false);
    expect(changeHeaders()[ACTING_AS_HEADER]).toBe("Dana%2Bx%40example.com");
    answer({ authenticated: false, provider: "dev" });
    await loadMe();
    expect(changeHeaders()[ACTING_AS_HEADER]).toBeUndefined();
  });
});
