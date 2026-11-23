import { itemWords } from "./diff";

/**
 * Walking the items of the editing screen one after the other (the steps of a process, the
 * requirements of a standard) from the head of the fields, without going back to the outline:
 * which item is next, what its arrow is called, which key does it, and which field of the next
 * item takes the keyboard (the same one, so that one can type a name, step on, type the next).
 */

/** The item before (`-1`) or after (`1`) `current` in `ids`; none at the ends or when `current` is not there. */
export function stepTarget(ids: readonly string[], current: string | null | undefined, dir: -1 | 1): string | undefined {
  const at = current ? ids.indexOf(current) : -1;
  if (at < 0) return undefined;
  return ids[at + dir];
}

/** The shortcut, in the words the buttons' tooltips and the outline's hint use. */
export const STEP_KEYS = { prev: "Alt + Page Up", next: "Alt + Page Down" } as const;

/**
 * Which way a key press steps: Alt + Page Up the previous item, Alt + Page Down the next one, 0
 * for anything else. Alt + ↑ ↓ already moves an item and Alt + ← → is the browser's Back and
 * Forward; Ctrl + Page Up / Down changes the browser's tab. Works while typing in a field.
 */
export function stepKey(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): -1 | 0 | 1 {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return 0;
  return e.key === "PageUp" ? -1 : e.key === "PageDown" ? 1 : 0;
}

/**
 * What an arrow is called, for screen readers and its tooltip: "Next step: Approve the monthly
 * budget", "Previous requirement: SEC-LOG-01 No secrets in logs", "Next step: Step 4 (no name
 * yet)". At an end: "No previous step" (the arrow stays, unavailable, so the head does not jump).
 */
export function stepLabel(noun: "step" | "requirement", dir: -1 | 1, item?: { n: number; name?: string; id?: string }): string {
  const way = dir < 0 ? "Previous" : "Next";
  if (!item) return `No ${way.toLowerCase()} ${noun}`;
  const name = (item.name ?? "").trim();
  const Noun = noun === "step" ? "Step" : "Requirement";
  const words = name || itemWords({ what: `${Noun} ${item.n}`, label: "" });
  return `${way} ${noun}: ${item.id && noun === "requirement" ? `${item.id} ` : ""}${words}`;
}

/** What is known about a control of the fields, to find "the same one" in the fields of another item. */
export interface FieldFacts {
  /** `data-field`, where the field has one. */
  field?: string | null;
  ariaLabel?: string | null;
  /** The text of the label of the field it is in ("What happens"). */
  label?: string | null;
  /** Its classes. */
  className?: string | null;
}

/**
 * A key that names a control the same way in every item: its `data-field`, else its name with the
 * numbers taken out ("Action 2" and "Action 1" are both "Action #": the first action of the next
 * item is the same field), else the label of its field, else a class of its own. `null`: nothing
 * to go by.
 */
export function fieldKey(f: FieldFacts): string | null {
  if (f.field) return `field:${f.field}`;
  const aria = f.ariaLabel?.trim();
  // an arrow of the head keeps its way: "Next step: …" is the next arrow in every item
  if (aria) {
    const arrow = aria.match(/^(Previous|Next|No previous|No next) /);
    if (arrow) return `arrow:${/next/i.test(arrow[1]) ? "next" : "prev"}`;
    return `name:${aria.replace(/\d+/g, "#").replace(/[“"].*$/, "").trim()}`;
  }
  const label = f.label?.trim();
  if (label) return `label:${label}`;
  const own = (f.className ?? "").split(/\s+/).find((c) => c && !GENERIC.has(c));
  return own ? `class:${own}` : null;
}
const GENERIC = new Set(["btn", "small", "ghost", "icon-btn", "chip", "on", "grow", "mono", "danger", "waiting"]);

/** The facts of a control on screen (see `fieldKey`). */
export function factsOf(el: Element): FieldFacts {
  const labelEl = el.closest(".field")?.querySelector(".field-label");
  return {
    field: el.getAttribute("data-field"),
    ariaLabel: el.getAttribute("aria-label"),
    label: labelEl?.firstChild?.textContent ?? null,
    className: el.getAttribute("class"),
  };
}

/** The controls of the fields that can take the keyboard, in their order. */
const CONTROLS = "input, textarea, select, button, [tabindex='0']";

/**
 * Puts the keyboard on the control of `box` that has `key` (see `fieldKey`), else on its first
 * field. Returns whether it found the same one.
 */
export function focusSameField(box: ParentNode, key: string | null): boolean {
  const shown = [...box.querySelectorAll<HTMLElement>(CONTROLS)].filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length);
  const same = key ? shown.find((el) => fieldKey(factsOf(el)) === key) : undefined;
  const first = same ?? shown.find((el) => el.matches("input, textarea, select") && !el.closest(".fields-head")) ?? shown[0];
  first?.focus();
  return !!same;
}
