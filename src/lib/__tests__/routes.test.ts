import { describe, expect, it } from "vitest";
import { guardLeaving, href, parseRoute, unsavedWork, type Route } from "../store";
import { blankProcess, blankStandard } from "../edit";

describe("addresses", () => {
  const routes: Route[] = [
    { page: "library" }, { page: "standards" }, { page: "catalog" }, { page: "guide" }, { page: "admin", section: "skills" },
    { page: "process", id: "request-gcp-project", tab: "list" },
    { page: "process", id: "request-gcp-project", tab: "flow", item: "raise-request" },
    { page: "standard", id: "secure-logging", tab: "feedback" },
    { page: "standard", id: "secure-logging", tab: "doc", item: "SEC-LOG-03" },
  ];
  it("lead back to the same place, including the open step or requirement", () => {
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });
  it("fall back to something sensible", () => {
    expect(parseRoute("")).toEqual({ page: "library" });
    expect(parseRoute("#/nonsense")).toEqual({ page: "library" });
    expect(parseRoute("#/p/some-process")).toEqual({ page: "process", id: "some-process", tab: "flow" });
    expect(parseRoute("#/s/some-standard")).toEqual({ page: "standard", id: "some-standard", tab: "doc" });
    expect(parseRoute("#/admin")).toEqual({ page: "admin", section: "access" });
    // a requirement id is upper case, a step id lower case: the wrong kind is simply not an item
    expect(parseRoute("#/s/secure-logging/doc/lower-case")).toEqual({ page: "standard", id: "secure-logging", tab: "doc" });
  });
});

describe("unsaved work", () => {
  it("is only lost by leaving the place where it is edited", () => {
    expect(unsavedWork()).toBeNull();
    const release = guardLeaving("process/demo", "this process");
    // other tabs and steps of the same process keep the edits
    expect(unsavedWork({ page: "process", id: "demo", tab: "list" })).toBeNull();
    expect(unsavedWork({ page: "process", id: "demo", tab: "flow", item: "ask" })).toBeNull();
    // everything else loses them: another process, a list, the guide, signing out
    expect(unsavedWork({ page: "process", id: "other", tab: "flow" })).toBe("this process");
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
