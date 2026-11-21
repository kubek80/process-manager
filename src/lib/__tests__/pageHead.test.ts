import { describe, expect, it } from "vitest";
import { engagementLines } from "../../components/Engage";
import { ownedBy } from "../catalog";
import { catalog } from "./fixtures";

const counts = (c: Partial<{ views: number; people: number; downloads: number }>) => ({ views: 0, people: 0, downloads: 0, upvotes: 0, handled: 0, ...c }) as never;

describe("the numbers in the head of a process or standard", () => {
  it("says only what is worth a word", () => {
    expect(engagementLines(counts({}), 0, 0)).toEqual([{ key: "views", text: "No views yet" }]);
  });
  it("counts views, people, downloads and feedback in short words", () => {
    expect(engagementLines(counts({ views: 200, people: 36, downloads: 1 }), 2, 3).map((l) => l.text)).toEqual([
      "200 views by 36 people", "1 skill download", "2 pieces of feedback open", "3 pieces of feedback handled",
    ]);
    expect(engagementLines(counts({ views: 1, people: 1 }), 1).map((l) => l.text)).toEqual(["1 view by 1 person", "1 piece of feedback open"]);
  });
});

describe("the category and the team that looks after it", () => {
  it("says it as the head of the page does, for a process and for a standard", () => {
    expect(ownedBy(catalog, "process", { category: "source-control", owner: "developer-experience-team" })).toBe("Source control · Owned by Developer Experience team");
    expect(ownedBy(catalog, "standard", { category: "source-control", owner: "security" })).toBe("Source control · Issued by Cyber Security");
  });
  it("leaves out what is not set, and shows an id nobody has in the lists as it is", () => {
    expect(ownedBy(catalog, "process", { owner: "security" })).toBe("Owned by Cyber Security");
    expect(ownedBy(catalog, "process", { category: "source-control" })).toBe("Source control");
    expect(ownedBy(catalog, "process", {})).toBe("");
    expect(ownedBy(catalog, "process", { owner: "a-team-that-left" })).toBe("Owned by a-team-that-left");
  });
});
