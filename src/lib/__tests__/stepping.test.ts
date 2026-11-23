import { describe, expect, it } from "vitest";
import { fieldKey, stepKey, stepLabel, stepTarget } from "../stepping";

describe("stepping through the items from the head of the fields", () => {
  const ids = ["a", "b", "c"];
  it("goes to the item before or after, and nowhere at the ends", () => {
    expect(stepTarget(ids, "b", 1)).toBe("c");
    expect(stepTarget(ids, "b", -1)).toBe("a");
    expect(stepTarget(ids, "a", -1)).toBeUndefined();
    expect(stepTarget(ids, "c", 1)).toBeUndefined();
    expect(stepTarget(ids, "x", 1)).toBeUndefined();
    expect(stepTarget(ids, null, 1)).toBeUndefined();
  });

  it("is Alt + Page Up / Page Down, and nothing else", () => {
    const k = (key: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
      stepKey({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
    expect(k("PageUp", { altKey: true })).toBe(-1);
    expect(k("PageDown", { altKey: true })).toBe(1);
    // Alt + arrows move an item or go Back: never stepping
    expect(k("ArrowDown", { altKey: true })).toBe(0);
    expect(k("ArrowRight", { altKey: true })).toBe(0);
    // Ctrl + Page Down changes the browser's tab; a plain Page Down scrolls
    expect(k("PageDown", { ctrlKey: true })).toBe(0);
    expect(k("PageDown", { altKey: true, ctrlKey: true })).toBe(0);
    expect(k("PageDown", { altKey: true, shiftKey: true })).toBe(0);
    expect(k("PageDown")).toBe(0);
  });

  it("names the arrows by the item they lead to, also one without a name", () => {
    expect(stepLabel("step", -1, { n: 1, name: "Decide the project details" })).toBe("Previous step: Decide the project details");
    expect(stepLabel("step", 1, { n: 3, name: "Approve the monthly budget" })).toBe("Next step: Approve the monthly budget");
    expect(stepLabel("step", 1, { n: 4, name: "  " })).toBe("Next step: Step 4 (no name yet)");
    expect(stepLabel("requirement", 1, { n: 3, name: "Log security events", id: "SEC-LOG-03" })).toBe("Next requirement: SEC-LOG-03 Log security events");
    expect(stepLabel("requirement", -1, { n: 1, name: "", id: "SEC-LOG-01" })).toBe("Previous requirement: SEC-LOG-01 Requirement 1 (no name yet)");
    expect(stepLabel("step", -1)).toBe("No previous step");
    expect(stepLabel("requirement", 1)).toBe("No next requirement");
  });

  it("finds the same field in the next item: by its data, its name without numbers, its label", () => {
    expect(fieldKey({ field: "summary", ariaLabel: "Summary" })).toBe("field:summary");
    // "Exactly what to do": action 2 leads to the first action of the next step
    expect(fieldKey({ ariaLabel: "Action 2" })).toBe(fieldKey({ ariaLabel: "Action 1" }));
    expect(fieldKey({ ariaLabel: "Action 2" })).not.toBe(fieldKey({ ariaLabel: "Remove action 2" }));
    expect(fieldKey({ label: "What happens", className: "step-title" })).toBe("label:What happens");
    // the arrows themselves: the next arrow is the next arrow, whatever item it names
    expect(fieldKey({ ariaLabel: "Next step: Approve the monthly budget" })).toBe(fieldKey({ ariaLabel: "No next step" }));
    expect(fieldKey({ ariaLabel: "Previous step: Decide" })).toBe("arrow:prev");
    expect(fieldKey({ className: "btn small move-select" })).toBe("class:move-select");
    expect(fieldKey({ className: "btn small" })).toBeNull();
    expect(fieldKey({})).toBeNull();
  });
});
