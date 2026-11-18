import { describe, expect, it } from "vitest";
import { forgetUnsaved, guardLeaving, hasUnsaved, href, parseRoute, unsavedWork, type Route } from "../store";
import { blankProcess, blankStandard } from "../edit";

describe("addresses", () => {
  const routes: Route[] = [
    { page: "library" }, { page: "standards" }, { page: "catalog" }, { page: "guide" }, { page: "admin", section: "skills" },
    { page: "process", id: "request-gcp-project", tab: "list" },
    { page: "process", id: "request-gcp-project", tab: "flow", item: "raise-request" },
    { page: "standard", id: "secure-logging", tab: "feedback" },
    { page: "standard", id: "secure-logging", tab: "doc", item: "SEC-LOG-03" },
    { page: "edit-process", id: "request-gcp-project" },
    { page: "edit-process", id: "request-gcp-project", item: "raise-request" },
    { page: "edit-standard", id: "secure-logging" },
    { page: "edit-standard", id: "secure-logging", item: "SEC-LOG-03" },
  ];
  it("lead back to the same place, including the open step or requirement", () => {
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });
  it("fall back to something sensible", () => {
    expect(parseRoute("")).toEqual({ page: "home" });
    expect(parseRoute("#/nonsense")).toEqual({ page: "home" });
    expect(parseRoute("#/processes")).toEqual({ page: "library" });
    expect(parseRoute("#/p/some-process")).toEqual({ page: "process", id: "some-process", tab: "flow" });
    expect(parseRoute("#/s/some-standard")).toEqual({ page: "standard", id: "some-standard", tab: "doc" });
    expect(parseRoute("#/admin")).toEqual({ page: "admin", section: "access" });
    // a requirement id is upper case, a step id lower case: the wrong kind is simply not an item
    expect(parseRoute("#/s/secure-logging/doc/lower-case")).toEqual({ page: "standard", id: "secure-logging", tab: "doc" });
    expect(parseRoute("#/s/secure-logging/edit/lower-case")).toEqual({ page: "edit-standard", id: "secure-logging" });
  });
  it("of the JSON tab, which no longer exists, open the editing screen", () => {
    expect(parseRoute("#/p/some-process/json")).toEqual({ page: "edit-process", id: "some-process" });
    expect(parseRoute("#/s/some-standard/json")).toEqual({ page: "edit-standard", id: "some-standard" });
    expect(href({ page: "process", id: "x", tab: "json" })).toBe("#/p/x/edit");
  });
});

describe("unsaved work", () => {
  it("is only lost by leaving the place where it is edited", () => {
    expect(unsavedWork()).toBeNull();
    const release = guardLeaving("process/demo", "this process");
    // other steps on the editing screen of the same process keep the edits
    expect(unsavedWork({ page: "edit-process", id: "demo" })).toBeNull();
    expect(unsavedWork({ page: "edit-process", id: "demo", item: "ask" })).toBeNull();
    // everything else loses them: the reader's page, another process, a list, the guide, signing out
    expect(unsavedWork({ page: "process", id: "demo", tab: "flow" })).toBe("this process");
    expect(unsavedWork({ page: "edit-process", id: "other" })).toBe("this process");
    expect(unsavedWork({ page: "library" })).toBe("this process");
    expect(unsavedWork({ page: "guide" })).toBe("this process");
    expect(unsavedWork()).toBe("this process");
    release();
    expect(unsavedWork({ page: "library" })).toBeNull();
  });
  it("covers the lists and text in the JSON tab that is not part of the draft", () => {
    const lists = guardLeaving("catalog", "the lists");
    expect(unsavedWork({ page: "admin", section: "lists" })).toBeNull();
    expect(unsavedWork({ page: "admin", section: "access" })).toBe("the lists");
    lists();
    // leaving the JSON tab drops text that has problems, even within the same process
    const json = guardLeaving("process/demo#json", "the JSON of this process");
    expect(unsavedWork({ page: "process", id: "demo", tab: "flow" })).toBe("the JSON of this process");
    json();
    expect(unsavedWork()).toBeNull();
  });
});

describe("something new takes its address from its name", () => {
  it("for a process", () => {
    const p = blankProcess(["request-a-database"], "  Request a database ");
    expect(p.id).toBe("request-a-database-2");
    expect(p.title).toBe("Request a database");
    expect(p.status).toBe("draft");
    expect(blankProcess([], "!!!").id).toBe("new-process");
    expect(blankProcess(["new-process"]).id).toBe("new-process-2");
  });
  it("for a standard", () => {
    const s = blankStandard([], "security", "Secure logging");
    expect(s.id).toBe("secure-logging");
    expect(s.title).toBe("Secure logging");
    expect(s.owner).toBe("security");
    expect(s.status).toBe("draft");
  });
});

describe("the guard knows where edits live", () => {
  it("staying on the editing screen loses nothing; the reader's page of the same process does", () => {
    const json = guardLeaving("process/demo#json", "the JSON of this process");
    const doc = guardLeaving("process/demo", "this process");
    expect(unsavedWork({ page: "edit-process", id: "demo" })).toBeNull();
    expect(unsavedWork({ page: "edit-process", id: "demo", item: "a-step" })).toBeNull();
    expect(unsavedWork({ page: "process", id: "demo", tab: "flow" })).toBe("the JSON of this process");
    expect(unsavedWork({ page: "edit-process", id: "other" })).not.toBeNull();
    doc();
    expect(hasUnsaved("process/demo#json")).toBe(true);
    json();
    expect(hasUnsaved("process/demo#json")).toBe(false);
  });
  it("forgets everything about something that was deleted", () => {
    guardLeaving("process/gone", "this process");
    guardLeaving("process/gone#json", "the JSON of this process");
    guardLeaving("process/gone-too", "this process");
    forgetUnsaved("process/gone");
    expect(hasUnsaved("process/gone")).toBe(false);
    expect(hasUnsaved("process/gone#json")).toBe(false);
    expect(unsavedWork()).toBe("this process"); // the other one is still there
    forgetUnsaved("process/gone-too");
    expect(unsavedWork()).toBeNull();
  });
});
