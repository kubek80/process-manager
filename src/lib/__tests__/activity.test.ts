import { describe, expect, it } from "vitest";
import { ACTION, describeEntry, shownTarget } from "../activity";
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
