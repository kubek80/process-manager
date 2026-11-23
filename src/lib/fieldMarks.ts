import { useEffect } from "react";
import type { Issue } from "../types";

/**
 * Marking the fields that have a problem, for every screen that shows a checker's problems on
 * their fields: the editing screen of a process or standard (`EditFrame`) and Admin › Lists
 * (`CatalogPage`). The words are always `issueText`'s; each screen only says where a problem's
 * field is (`find`). The look is in styles.css (`.has-problem`, `[data-problem]`).
 */
export interface FieldMarking {
  /** The box the fields are in; nothing is marked while it is not on the page. */
  box: () => HTMLElement | null;
  /** The field a problem is about, inside the box, or null when it is not shown. */
  find: (issue: Issue, box: HTMLElement) => HTMLElement | null;
  /** What to do, in words (`issueText`). */
  text: (issue: Issue) => string;
  /** An example text still to replace: marked in the calmer colour. */
  example?: (issue: Issue) => boolean;
}

/** The element around a field that says under it what to do. */
const HOLDER = ".field, .mini-field, .path-row, .ins-rows > li";

/**
 * Marks every field that has a problem, the moment it has one: the field is outlined
 * (`.has-problem`, calmer `.has-example` for an example text still to replace) with
 * aria-invalid, and the line around it says what to do under it (`data-problem`, shown by CSS),
 * so nothing is added to what React draws. `issues`: the problems of what the fields show; only
 * errors mark a field, suggestions never do.
 */
export function useFieldMarks(issues: Issue[] | undefined, how: FieldMarking) {
  useEffect(() => {
    const box = how.box();
    if (!box) return;
    const wanted = new Map<HTMLElement, { text: string; example: boolean; holder: HTMLElement }>();
    for (const issue of issues ?? []) {
      if (issue.level !== "error") continue;
      const el = how.find(issue, box);
      if (!el || wanted.has(el)) continue;
      const holder = el.closest<HTMLElement>(HOLDER) ?? el.parentElement ?? el;
      wanted.set(el, { text: how.text(issue), example: !!how.example?.(issue), holder });
    }
    for (const el of box.querySelectorAll<HTMLElement>(".has-problem, .has-example")) {
      if (wanted.has(el)) continue;
      el.classList.remove("has-problem", "has-example");
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-description");
    }
    const holders = new Set([...wanted.values()].map((w) => w.holder));
    for (const h of box.querySelectorAll<HTMLElement>("[data-problem]")) if (!holders.has(h)) h.removeAttribute("data-problem");
    for (const [el, w] of wanted) {
      el.classList.toggle("has-problem", !w.example);
      el.classList.toggle("has-example", w.example);
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-description", w.text);
      w.holder.setAttribute("data-problem", w.text);
      w.holder.classList.toggle("problem-example", w.example);
    }
  });
}

/**
 * Brings the keyboard to a field once it is shown (after a list closed, a tab or an entry was
 * chosen, a panel slid in): tries `find` for a moment, then scrolls the field into the middle,
 * focuses it and hands it to `mark` (not called when it never appeared).
 */
export function focusWhenShown(find: () => HTMLElement | null, mark?: (el: HTMLElement) => void, delay = 60) {
  let tries = 40;
  const attempt = () => {
    const el = find();
    if (!el) { if (tries-- > 0) setTimeout(attempt, 40); return; }
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
    mark?.(el);
  };
  setTimeout(attempt, delay);
}
