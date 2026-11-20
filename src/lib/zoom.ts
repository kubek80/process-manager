/**
 * Zooming the map with Ctrl + scroll (Cmd + scroll on a Mac; a pinch on a trackpad arrives as a
 * wheel event with Ctrl held). The point under the pointer stays where it is.
 */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.5;
/** The smallest zoom "Fit" goes down to: below it a flow is a pattern of boxes, nothing more. */
export const ZOOM_FLOOR = 0.1;

/**
 * Keeps a zoom within its limits. Not rounded: a pinch sends steps far smaller than a percent.
 * `from`: the zoom it starts from. "Fit" can show a long flow below the usual limit; zooming out
 * from there goes no further, zooming in works as always.
 */
export const clampZoom = (z: number, from?: number) => Math.min(ZOOM_MAX, Math.max(Math.min(ZOOM_MIN, from ?? ZOOM_MIN), z));

/** The zoom after a press on "Zoom in" (1) or "Zoom out" (-1): the next tenth, within the limits. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const next = dir > 0 ? Math.floor(z * 10 + 1e-6) / 10 + 0.1 : Math.ceil(z * 10 - 1e-6) / 10 - 0.1;
  return +clampZoom(next, z).toFixed(2);
}

/** Pixels per line and per page for wheel events that count in lines (Firefox) or pages. */
const LINE = 16, PAGE = 400;

/**
 * The zoom after one wheel event: scrolling up zooms in, down zooms out. A mouse wheel notch
 * (about 100 pixels) changes it by about a tenth; a trackpad pinch sends many small steps.
 */
export function wheelZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  const px = deltaY * (deltaMode === 1 ? LINE : deltaMode === 2 ? PAGE : 1);
  // one event never jumps more than a quarter, whatever the device sends
  const step = Math.max(-0.25, Math.min(0.25, -px * 0.001));
  return clampZoom(zoom * Math.exp(step), zoom);
}

/**
 * Where to scroll to keep the point under the pointer in place when the zoom changes from `from`
 * to `to`. `pointer` is the pointer's position inside the visible part of the map, `scroll` how
 * far the map is scrolled. Content positions grow with the zoom.
 */
export function scrollForZoom(from: number, to: number, pointer: { x: number; y: number }, scroll: { left: number; top: number }): { left: number; top: number } {
  const k = to / from;
  return {
    left: Math.max(0, (scroll.left + pointer.x) * k - pointer.x),
    top: Math.max(0, (scroll.top + pointer.y) * k - pointer.y),
  };
}

/** Whether a wheel event asks for a zoom rather than a scroll. */
export const isZoomWheel = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey;

/** "Ctrl" or "Cmd": what the hint says, by the device. */
export function zoomKey(platform = typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : ""): "Ctrl" | "Cmd" {
  return /Mac|iPhone|iPad/i.test(platform) ? "Cmd" : "Ctrl";
}

/**
 * How wide the column of lane names is at a zoom: narrower when the drawing is small, so that the
 * drawing gets the room and a name never runs into the lines of a short lane.
 */
export function laneColumn(zoom: number, narrowScreen = false): number {
  if (narrowScreen) return zoom >= 0.6 ? 96 : 80;
  // at the working zoom (60%) the drawing needs the width more than the names do
  return zoom >= 0.75 ? 156 : zoom >= 0.5 ? 120 : zoom >= 0.35 ? 108 : 96;
}

/**
 * A lane's name on the lines it has, broken between words. `fits`: how many characters fit a line,
 * or a test whether a line fits (measured). What does not fit ends in "…" after the last whole word
 * that does; a word is never cut: when not even the first word fits, the name shows its initial
 * (the whole name is in the lane's label and tooltip).
 */
export function wrapWords(text: string, fits: number | ((line: string) => boolean), lines: number): string[] {
  const ok = typeof fits === "number" ? (l: string) => l.length <= fits : fits;
  const words = (typeof text === "string" ? text : "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (!ok(words[0])) return [words[0].charAt(0).toUpperCase()];
  const out: string[] = [];
  let i = 0, cut = false;
  while (i < words.length && out.length < lines) {
    if (!ok(words[i])) { cut = true; break; } // a word longer than a line: the name stops before it
    let line = words[i++];
    while (i < words.length && ok(`${line} ${words[i]}`)) line += ` ${words[i++]}`;
    out.push(line);
  }
  if (cut || i < words.length) {
    // the last line ends with "…" after a whole word, made room for if needed
    let last = out[out.length - 1];
    while (last.includes(" ") && !ok(`${last}…`)) last = last.slice(0, last.lastIndexOf(" "));
    out[out.length - 1] = `${last}…`;
  }
  return out;
}

/** How many characters of a lane's name fit a line of a column `width` pixels wide (padding and the round mark taken off). */
export function laneChars(width: number, small: boolean, avatar: boolean): number {
  const room = width - 24 - (avatar ? 40 : 0);
  return Math.max(4, Math.floor(room / (small ? 6.1 : 7.1)));
}

/**
 * "Fit" is an overview on request: it lasts until a step is selected or the process is changed,
 * which return to the working zoom (the one the map opened at); a press on the zoom buttons ends
 * it where the person zoomed to. Returns the zoom to show, and whether the map is still fitted.
 */
export function afterFit(state: { fitted: boolean; zoom: number; working: number }, event: "select" | "edit" | "zoom"): { fitted: boolean; zoom: number } {
  if (!state.fitted) return { fitted: false, zoom: state.zoom };
  if (event === "zoom") return { fitted: false, zoom: state.zoom };
  return { fitted: false, zoom: state.working };
}

/**
 * What a lane's name shows in a lane `height` pixels high (at the zoom on screen), in a column
 * `column` wide: the round mark only when there is room for it, the count of steps when there is
 * room below the name, the name on up to three lines, in smaller type in a low lane.
 */
export function laneLabel(height: number, column: number): { avatar: boolean; count: boolean; lines: 1 | 2 | 3; small: boolean } {
  const lines = height >= 70 ? 3 : height >= 30 ? 2 : 1;
  return { avatar: column >= 140 && height >= 60, count: height >= 60, lines, small: height < 44 };
}

/**
 * The zoom at which the WHOLE flow is in view: the lane column (its width at that zoom, from
 * `column`) and the drawing (`content`, at 100%) side by side in `view`. Never above 100%; as low as
 * it takes, down to ZOOM_FLOOR. In whole percents.
 */
export function fitWhole(view: { width: number; height: number }, content: { width: number; height: number }, column: (z: number) => number = () => 0): number {
  if (!view.width || !content.width) return 1;
  for (let p = 100; p > ZOOM_FLOOR * 100; p--) {
    const z = p / 100;
    if (column(z) + content.width * z <= view.width && content.height * z <= view.height) return z;
  }
  return ZOOM_FLOOR;
}

/**
 * The zoom a map opens at: the larger of "fits the width" (the drawing and the lane column side by
 * side) and "fits the height" (the drawing in the height the map has, `height`), in steps of 5%,
 * never above 100% and never below `floor` (where a step's name can still be read). A long flow
 * then opens in a size one can read, using the height, and scrolls sideways.
 */
export function openingZoom(viewWidth: number, contentWidth: number, floor: number, column: (z: number) => number = () => 0, height?: { view: number; content: number }): number {
  if (!viewWidth || !contentWidth) return 1;
  let byWidth = floor;
  for (let p = 100; p >= floor * 100; p -= 5) {
    const z = p / 100;
    if (column(z) + contentWidth * z <= viewWidth) { byWidth = z; break; }
  }
  let byHeight = floor;
  if (height && height.view > 0 && height.content > 0) {
    for (let p = 100; p >= floor * 100; p -= 5) {
      const z = p / 100;
      if (height.content * z <= height.view) { byHeight = z; break; }
    }
  }
  return Math.max(byWidth, byHeight);
}

/**
 * Where to scroll so that a selected block (its box in pixels on screen, inside the scrolled
 * drawing) sits in the middle of the view, with room around it for where the flow goes next.
 * A block already well inside the view (`comfort` from each edge, at most a fifth of the view)
 * is left where it is; an axis on which everything fits is not scrolled. Null: nothing to do.
 */
export function scrollToCentre(
  box: { x: number; y: number; w: number; h: number },
  view: { left: number; top: number; width: number; height: number },
  content: { width: number; height: number },
  comfort = 160,
): { left: number; top: number } | null {
  const axis = (start: number, size: number, from: number, length: number, total: number) => {
    if (total <= length + 1) return from;
    const room = Math.min(comfort, length / 5);
    if (start >= from + room && start + size <= from + length - room) return from;
    return Math.round(Math.max(0, Math.min(total - length, start + size / 2 - length / 2)));
  };
  const left = axis(box.x, box.w, view.left, view.width, content.width), top = axis(box.y, box.h, view.top, view.height, content.height);
  return left === view.left && top === view.top ? null : { left, top };
}

/** Which edges of a scrolled map hide more of it: there the map fades out. */
export function hiddenEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): { left: boolean; right: boolean } {
  return { left: scrollLeft > 2, right: scrollLeft + clientWidth < scrollWidth - 2 };
}
