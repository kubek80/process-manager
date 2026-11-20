import { describe, expect, it } from "vitest";
import { ACTION, describeEntry, detailParts, shownTarget } from "../activity";
import type { AuditEntry } from "../../types";

const entry = (action: string, target: string, more: Partial<AuditEntry> = {}): AuditEntry =>
  ({ id: 1, at: "2026-11-20T03:34:00Z", email: "jordan@example.com", name: "Jordan Platform", action, target, detail: "", ...more });
const titles = { process: { "request-gcp-project": "Request a GCP project" }, standard: { "secure-logging": "Secure logging" } };

describe("the activity list", () => {
  it("does not show the id of an uploaded icon", () => {
    expect(shownTarget("icon.upload", "623f35".padEnd(64, "a"))).toBe("");
    expect(shownTarget("some.other", "a".repeat(64))).toBe("");
  });
  it("shows what was changed for everything else", () => {
    expect(shownTarget("process.save", "request-gcp-project")).toBe("request-gcp-project");
    expect(shownTarget("access.change", "alex@example.com")).toBe("alex@example.com");
  });
  it("has words for every action the server writes", () => {
    const server = [
      "process.save", "process.publish", "process.review", "process.discard", "process.delete",
      "standard.save", "standard.publish", "standard.review", "standard.discard", "standard.delete",
      "lists.save", "access.grant", "access.revoke", "access.change", "access.remove",
      "feedback.fixed", "feedback.reopen", "feedback.delete", "skill.guidance", "icon.upload", "theme.change",
      "request.create", "request.state", "request.delete", "content.import", "content.convert",
    ];
    for (const a of server) expect(ACTION[a], a).toBeTruthy();
  });
  it("names a document by its title, with its id as the hint", () => {
    expect(describeEntry(entry("process.save", "request-gcp-project", { detail: "version 2" }), titles)).toEqual({
      who: "Jordan Platform", person: true, words: "saved the process", detail: "version 2",
      target: { text: "“Request a GCP project”", hint: "request-gcp-project", quoted: true },
    });
    expect(describeEntry(entry("feedback.fixed", "standard secure-logging"), titles)).toMatchObject({
      words: "marked feedback as fixed on the standard", target: { text: "“Secure logging”", hint: "secure-logging", quoted: true },
    });
  });
  it("keeps the id of a document the page cannot name (deleted, or not visible)", () => {
    expect(describeEntry(entry("process.delete", "old-one"), titles).target).toEqual({ text: "old-one", code: true });
  });
  it("says that the portal itself imported or upgraded content", () => {
    const e = describeEntry(entry("content.import", "sample content", { email: "import", name: "Import", detail: "25 documents added or changed" }), titles);
    expect(e).toMatchObject({ who: "The portal", person: false, words: "imported", target: { text: "the sample content" } });
    expect(describeEntry(entry("content.convert", "lists", { email: "system", name: "Process Manager" }), titles).target).toBeUndefined();
  });
  it("has no raw name for the change of the look", () => {
    const e = describeEntry(entry("theme.change", "look", { detail: "Brand colour #0055aa" }), titles);
    expect(e.words).toBe("changed the look of the portal");
    expect(e.target).toBeUndefined();
  });
});

describe("the activity list in words a reader knows", () => {
  it("names a request by its title, its number as the hint", () => {
    const asked = describeEntry(entry("request.create", "request 6", { detail: "Asked for a process: “Order a TLS certificate”" }), titles);
    expect(asked).toMatchObject({ words: "asked for a new process:", target: { text: "“Order a TLS certificate”", hint: "request 6", quoted: true } });
    expect(asked.detail).toBeUndefined();
    const planned = describeEntry(entry("request.state", "request 6", { detail: "“Order a TLS certificate”: planned. Note: next month" }), titles);
    expect(planned).toMatchObject({ words: "changed the state of the request", target: { text: "“Order a TLS certificate”", hint: "request 6" }, detail: "planned. Note: next month" });
    expect(describeEntry(entry("request.delete", "request 6", { detail: "something else" }), titles).target).toEqual({ text: "request 6" });
  });
  it("names a person by their name where the page knows it, the address as the hint", () => {
    const names = { "morgan.lee@example.com": "Morgan Lee" };
    expect(describeEntry(entry("access.change", "morgan.lee@example.com"), titles, names).target).toEqual({ text: "Morgan Lee", hint: "morgan.lee@example.com" });
    expect(describeEntry(entry("access.change", "nobody@example.com"), titles, names).target).toEqual({ text: "nobody@example.com" });
  });
  it("cuts the detail into words, people and colours", () => {
    expect(detailParts("reported by sam@example.com", { "sam@example.com": "Sam Consumer" })).toEqual([
      { text: "reported by " }, { text: "Sam Consumer", person: "sam@example.com" },
    ]);
    expect(detailParts("name “Hub”; brand colour #be185d; logo added")).toEqual([
      { text: "name “Hub”; brand colour " }, { text: "#be185d", colour: "#be185d" }, { text: "; logo added" },
    ]);
    expect(detailParts("version 2")).toEqual([{ text: "version 2" }]);
    expect(detailParts("x@example.com: added Owner")).toEqual([{ text: "x@example.com", person: "x@example.com" }, { text: ": added Owner" }]);
  });
});
