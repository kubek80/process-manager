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
  const first = (p: "teams" | "tools") => (p === "teams" ? "teams" : "tools");
  const placeOf = (l: string): "teams" | "tools" => (["teams", "pillars", "tribes", "domains", "practices", "platforms"].includes(l) ? "teams" : "tools");
  const at = (editor: boolean, place: "teams" | "tools", list: string | undefined, id: string | undefined, current: string) => addressedList(editor, place, list, id, current, first, placeOf);
  it("in Admin, opens what it names; an address of the place it shows leaves the page as it is (its unsaved changes too)", () => {
    expect(at(true, "teams", "tribes", "cloud-tribe", "teams")).toEqual({ list: "tribes", id: "cloud-tribe" });
    expect(at(true, "teams", "domains", undefined, "teams")).toEqual({ list: "domains", id: null });
    expect(at(true, "teams", undefined, undefined, "pillars")).toBeNull();
    // the other place: its first list, on the same page (one draft)
    expect(at(true, "tools", undefined, undefined, "pillars")).toEqual({ list: "tools", id: null });
    expect(at(true, "teams", undefined, undefined, "paths")).toEqual({ list: "teams", id: null });
  });
  it("for readers, follows it always: a place without a list is its first list", () => {
    expect(at(false, "teams", undefined, undefined, "pillars")).toEqual({ list: "teams", id: null });
    expect(at(false, "tools", undefined, undefined, "teams")).toEqual({ list: "tools", id: null });
    expect(at(false, "tools", "paths", "greenfield", "teams")).toEqual({ list: "paths", id: "greenfield" });
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
