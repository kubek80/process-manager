import { describe, expect, it } from "vitest";
import { clampZoom, isZoomWheel, scrollForZoom, wheelZoom, zoomKey, ZOOM_MAX, ZOOM_MIN } from "../zoom";

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
