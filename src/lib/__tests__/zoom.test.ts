import { describe, expect, it } from "vitest";
import { fitZoom, hiddenEdges, scrollToShow, clampZoom, isZoomWheel, scrollForZoom, wheelZoom, zoomKey, ZOOM_MAX, ZOOM_MIN } from "../zoom";

describe("Ctrl + scroll on the map", () => {
  it("scrolling up zooms in, down zooms out, by about a tenth per notch of a mouse wheel", () => {
    expect(wheelZoom(1, -100)).toBeCloseTo(1.11, 2);
    expect(wheelZoom(1, 100)).toBeCloseTo(0.9, 2);
    // Firefox counts in lines
    expect(wheelZoom(1, -3, 1)).toBeCloseTo(wheelZoom(1, -48), 5);
  });
  it("a trackpad pinch sends small steps that add up smoothly", () => {
    let z = 1;
    for (let i = 0; i < 10; i++) z = wheelZoom(z, -4);
    expect(z).toBeGreaterThan(1.02);
    expect(z).toBeLessThan(1.06);
  });
  it("stays within its limits, whatever the device sends", () => {
    expect(wheelZoom(1, -100000)).toBeLessThanOrEqual(1.29);
    expect(wheelZoom(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
    expect(wheelZoom(ZOOM_MIN, 100)).toBe(ZOOM_MIN);
    expect(clampZoom(0.123)).toBe(ZOOM_MIN);
    expect(clampZoom(1.2345)).toBe(1.2345);
  });
  it("keeps the point under the pointer in place", () => {
    const pointer = { x: 200, y: 100 }, scroll = { left: 300, top: 50 };
    const next = scrollForZoom(1, 2, pointer, scroll);
    // the content point under the pointer was at (500, 150); at twice the size it is at (1000, 300)
    expect(next).toEqual({ left: 800, top: 200 });
    // and zooming back puts it where it was
    expect(scrollForZoom(2, 1, pointer, next)).toEqual(scroll);
    // never scrolls before the start
    expect(scrollForZoom(1, 0.5, { x: 400, y: 400 }, { left: 0, top: 0 })).toEqual({ left: 0, top: 0 });
  });
  it("only with Ctrl or Cmd held: a plain scroll keeps scrolling the page", () => {
    expect(isZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(isZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
  });
  it("names the key of the device", () => {
    expect(zoomKey("MacIntel")).toBe("Cmd");
    expect(zoomKey("Win32")).toBe("Ctrl");
    expect(zoomKey("Linux x86_64")).toBe("Ctrl");
  });
});


describe("fitting the map", () => {
  it("fits the column in steps of 5%, never above 100% and never below the floor", () => {
    expect(fitZoom(1000, 800, 0.6)).toBe(1);
    expect(fitZoom(700, 1000, 0.6)).toBe(0.7);
    expect(fitZoom(700, 1040, 0.6)).toBe(0.65);
    // a long flow: readable on opening (60%), the whole of it on request (40%)
    expect(fitZoom(700, 2400, 0.6)).toBe(0.6);
    expect(fitZoom(700, 2400, 0.4)).toBe(0.4);
    expect(fitZoom(700, 1600, 0.4)).toBe(0.4);
    expect(fitZoom(0, 1600, 0.4)).toBe(1);
  });
});

describe("bringing a selected step into view", () => {
  const view = { left: 0, top: 0, width: 600, height: 400 };
  it("leaves a block that is fully visible alone", () => {
    expect(scrollToShow({ x: 100, y: 50, w: 200, h: 90 }, 1, view)).toBeNull();
  });
  it("scrolls just far enough for a block to the right or below, with a margin", () => {
    expect(scrollToShow({ x: 900, y: 50, w: 200, h: 90 }, 1, view)).toEqual({ left: 1100 + 24 - 600, top: 0 });
    expect(scrollToShow({ x: 100, y: 500, w: 200, h: 90 }, 1, view)).toEqual({ left: 0, top: 590 + 24 - 400 });
  });
  it("scrolls back for a block to the left, and counts the zoom", () => {
    expect(scrollToShow({ x: 100, y: 50, w: 200, h: 90 }, 1, { ...view, left: 500 })).toEqual({ left: 76, top: 0 });
    // at 60% the block at x 1000 starts at 600 on screen
    expect(scrollToShow({ x: 1000, y: 0, w: 200, h: 90 }, 0.6, view)).toEqual({ left: 1200 * 0.6 + 24 - 600, top: 0 });
  });
});

describe("the fade at the edges of the map", () => {
  it("shows where more of the flow is hidden", () => {
    expect(hiddenEdges(0, 1000, 1000)).toEqual({ left: false, right: false });
    expect(hiddenEdges(0, 2000, 1000)).toEqual({ left: false, right: true });
    expect(hiddenEdges(500, 2000, 1000)).toEqual({ left: true, right: true });
    expect(hiddenEdges(1000, 2000, 1000)).toEqual({ left: true, right: false });
  });
});
