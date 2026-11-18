import { describe, expect, it } from "vitest";
import { shownTarget } from "../activity";

describe("the activity list", () => {
  it("does not show the id of an uploaded icon", () => {
    expect(shownTarget("icon.upload", "623f35".padEnd(64, "a"))).toBe("");
    expect(shownTarget("some.other", "a".repeat(64))).toBe("");
  });
  it("shows what was changed for everything else", () => {
    expect(shownTarget("process.save", "request-gcp-project")).toBe("request-gcp-project");
    expect(shownTarget("access.change", "alex@example.com")).toBe("alex@example.com");
  });
});
