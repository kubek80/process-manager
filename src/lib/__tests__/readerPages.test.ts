import { describe, expect, it } from "vitest";
import { arrivalTab, printedLine } from "../media";
import { skillPreview, skillPurpose } from "../../components/SkillPanel";

describe("the tab a process opens on", () => {
  it("opens the checklist on a phone when the map would be shown without a step", () => {
    expect(arrivalTab("flow", undefined, true)).toBe("list");
  });
  it("stays on the map when a step on it is named, or on a larger screen", () => {
    expect(arrivalTab("flow", "s3", true)).toBeNull();
    expect(arrivalTab("flow", undefined, false)).toBeNull();
  });
  it("leaves every other tab alone", () => {
    for (const t of ["list", "feedback", "skills"]) expect(arrivalTab(t, undefined, true)).toBeNull();
  });
});

describe("the last line of a printed page", () => {
  it("says which one, which version, when its content changed, and when and from where it was printed", () => {
    const line = printedLine({ title: "Request a GCP project", version: 3, changed: "2026-11-13", printedAt: "2026-11-20", address: "https://pm.example.com/#/p/request-gcp-project" });
    expect(line).toBe("Request a GCP project · Version 3 · content changed 2026-11-13 · printed 2026-11-20 from https://pm.example.com/#/p/request-gcp-project");
  });
  it("leaves out what is not known", () => {
    expect(printedLine({ title: "", printedAt: "2026-11-20" })).toBe("(no name yet) · printed 2026-11-20");
  });
});

describe("the preview of a skill", () => {
  const file = "---\nname: process-request-gcp-project\ndescription: \"Follow the process\"\n---\n\n# Process: Request a GCP project\n\nText.\n";
  it("leaves out the front matter (Copy and Download keep the whole file)", () => {
    expect(skillPreview(file)).toBe("# Process: Request a GCP project\n\nText.\n");
  });
  it("keeps a text without front matter as it is, also with a rule further down", () => {
    expect(skillPreview("# Title\n\n---\n\nMore")).toBe("# Title\n\n---\n\nMore");
  });
  it("understands Windows line ends", () => {
    expect(skillPreview("---\r\nname: x\r\n---\r\n# T")).toBe("# T");
  });
  it("says in a sentence what each kind of file is for", () => {
    expect(skillPurpose("skill", "process")).toMatch(/AI coding assistant/);
    expect(skillPurpose("review-agent", "standard")).toMatch(/pull request/);
  });
});
