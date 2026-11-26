import { describe, expect, it } from "vitest";
import { addressedList, tabAfterKey } from "../listTabs";
import { fitsOneLine } from "../search";

const KEYS = ["teams", "tribes", "domains", "practices", "platforms", "categories", "tools", "patterns", "tiers", "paths", "environments", "languages"] as const;

describe("the lists' tabs with the keyboard", () => {
  it("move through all of them in order across the groups, and round", () => {
    expect(tabAfterKey(KEYS, "platforms", "ArrowRight")).toBe("categories"); // from Who into What
    expect(tabAfterKey(KEYS, "categories", "ArrowLeft")).toBe("platforms");
    expect(tabAfterKey(KEYS, "languages", "ArrowRight")).toBe("teams");
    expect(tabAfterKey(KEYS, "teams", "ArrowLeft")).toBe("languages");
  });
  it("go to the first and the last with Home and End; other keys move nothing", () => {
    expect(tabAfterKey(KEYS, "tools", "Home")).toBe("teams");
    expect(tabAfterKey(KEYS, "tools", "End")).toBe("languages");
    expect(tabAfterKey(KEYS, "tools", "ArrowDown")).toBeNull();
    expect(tabAfterKey(KEYS, "tools", "Enter")).toBeNull();
    expect(tabAfterKey([], "tools", "Home")).toBeNull();
  });
  it("count only the tabs shown (an empty optional list is left out for readers)", () => {
    const shown = KEYS.filter((k) => k !== "tribes" && k !== "domains");
    expect(tabAfterKey(shown, "teams", "ArrowRight")).toBe("practices");
  });
});

describe("the address of the lists", () => {
  it("in Admin › Lists, opens what it names and otherwise leaves the page as it is (its unsaved changes too)", () => {
    expect(addressedList(true, "tribes", "cloud-tribe", "teams")).toEqual({ list: "tribes", id: "cloud-tribe" });
    expect(addressedList(true, "domains", undefined, "teams")).toEqual({ list: "domains", id: null });
    expect(addressedList(true, undefined, undefined, "teams")).toBeNull();
  });
  it("on Teams & tools, follows it always: no list is the first list", () => {
    expect(addressedList(false, undefined, undefined, "teams")).toEqual({ list: "teams", id: null });
    expect(addressedList(false, "tools", "github", "teams")).toEqual({ list: "tools", id: "github" });
  });
});

describe("a filter's name and value on one line", () => {
  it("only when both fit whole beside the count and the chevron", () => {
    expect(fitsOneLine(200, 60, 80, [16], 8)).toBe(true); // 60+80+16+16 = 172
    expect(fitsOneLine(200, 150, 80, [16], 8)).toBe(false);
    expect(fitsOneLine(172, 60, 80, [16], 8)).toBe(true);
    expect(fitsOneLine(171, 60, 80, [16], 8)).toBe(false);
    expect(fitsOneLine(200, 60, 80, [20, 16], 8)).toBe(true); // with the count of chosen values
  });
});
