import { useState, useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Feedback, Process } from "../types";
import { FlowView } from "./FlowView";
import { Modal } from "./ui";
import "../picture.css";

/**
 * A process drawn as a picture in a text: the Guide's charts, the code map's charts, and every
 * other place a flow illustrates something rather than being worked through. One component, so
 * that the box, the caption, the tools and "Enlarge" are written once; it draws with the map
 * itself (`FlowView` with `picture`), so a picture looks and moves exactly like a process.
 *
 * - It opens whole where that is still readable (70% or more, at most 100%), else at 80%, cut,
 *   with the cut edges shown (`pictureZoom`); it keeps that height from the first paint. "Fit"
 *   shows the whole flow, as on the map.
 * - Dragging with the mouse pans it; a touch screen pans it natively (sideways; up and down the
 *   page scrolls on, since a picture is as high as its drawing). The tools zoom (Fit, −, the
 *   percentage, +), Ctrl or ⌘ + scroll and a trackpad pinch zoom around the pointer; a plain
 *   scroll over it scrolls the page.
 * - "Enlarge" opens it in a dialog as large as the window; Escape closes it.
 * - Printed, it is drawn whole, fitted to the paper.
 * Nothing in it can be selected, edited or reported.
 */
export function ProcessPicture({ process, caption, title, className, ...rest }: {
  process: Process;
  /** What the picture shows, under it (and under the title of its dialog). */
  caption?: ReactNode;
  /** A heading above the picture (`h3`), where the text around it has none. */
  title?: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "className">) {
  const printing = usePrintingOnce();
  const [big, setBig] = useState(false);
  const name = process.title || "the flow";
  return (
    <figure className={`process-picture ${className ?? ""}`.trim()} {...rest}>
      {title && <h3 className="picture-title">{title}</h3>}
      <FlowView key={printing ? "print" : "screen"} picture={printing ? "print" : "inline"} editable={false} process={process}
        selectedId={null} done={NO_STEPS} feedback={NO_FEEDBACK} onSelect={nothing}
        onEnlarge={{ label: `Enlarge the chart “${name}”`, open: () => setBig(true) }} />
      {caption && <figcaption>{caption}</figcaption>}
      {big && (
        <Modal title={name} subtitle={caption} onClose={() => setBig(false)} className="picture-dialog">
          <FlowView picture="enlarged" editable={false} process={process} selectedId={null} done={NO_STEPS} feedback={NO_FEEDBACK} onSelect={nothing} />
        </Modal>
      )}
    </figure>
  );
}

const NO_STEPS = new Set<string>();
const NO_FEEDBACK: Feedback[] = [];
const nothing = () => {};

// Whether the page is being printed, for every picture at once: one set of listeners on the
// window however many pictures a page has (the Guide has about 15), attached while one is shown.
// The pictures are drawn again for the paper before the browser lays it out (flushSync).
let printingNow = false;
const watchers = new Set<() => void>();
let unwatch: (() => void) | null = null;
function watchPrinting(changed: () => void) {
  watchers.add(changed);
  if (!unwatch && typeof window !== "undefined") {
    const set = (on: boolean) => { if (printingNow === on) return; printingNow = on; flushSync(() => watchers.forEach((w) => w())); };
    const before = () => set(true), after = () => set(false);
    const media = window.matchMedia?.("print");
    const change = (e: MediaQueryListEvent) => set(e.matches);
    printingNow = !!media?.matches;
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    media?.addEventListener?.("change", change);
    unwatch = () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      media?.removeEventListener?.("change", change);
    };
  }
  return () => {
    watchers.delete(changed);
    if (!watchers.size && unwatch) { unwatch(); unwatch = null; }
  };
}
function usePrintingOnce(): boolean {
  return useSyncExternalStore(watchPrinting, () => printingNow, () => false);
}
