/**
 * Zooming the map with Ctrl + scroll (Cmd + scroll on a Mac; a pinch on a trackpad arrives as a
 * wheel event with Ctrl held). The point under the pointer stays where it is.
 */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.5;

/** Keeps a zoom within its limits. Not rounded: a pinch sends steps far smaller than a percent. */
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

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
  return clampZoom(zoom * Math.exp(step));
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
