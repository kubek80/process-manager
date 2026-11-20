import { describe, expect, it } from "vitest";
import { afterFit, panHint, laneChars, wrapWords, fitWhole, hiddenEdges, laneColumn, laneLabel, openingZoom, scrollToCentre, stepZoom, clampZoom, isZoomWheel, scrollForZoom, wheelZoom, zoomKey, ZOOM_FLOOR, ZOOM_MAX, ZOOM_MIN } from "../zoom";

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


describe("opening the map", () => {
  it("is as large as fits the width beside the lane names, in steps of 5%, never above 100% nor below the floor", () => {
    expect(openingZoom(1000, 800, 0.6)).toBe(1);
    expect(openingZoom(700, 1000, 0.6)).toBe(0.7);
    expect(openingZoom(700, 1040, 0.6)).toBe(0.65);
    // a long flow stays readable (60%) and scrolls sideways
    expect(openingZoom(700, 2400, 0.6)).toBe(0.6);
    expect(openingZoom(0, 1600, 0.6)).toBe(1);
    // the lane column takes its share of the width
    expect(openingZoom(856, 1000, 0.6, laneColumn)).toBe(0.7);
    // the height counts too: a long flow opens as large as fits the height, at most 100%
    expect(openingZoom(700, 3300, 0.6, () => 0, { view: 545, content: 628 })).toBe(0.85);
    expect(openingZoom(700, 3300, 0.6, () => 0, { view: 750, content: 628 })).toBe(1);
    // never below the floor, and the width wins when it allows more
    expect(openingZoom(700, 3300, 0.6, () => 0, { view: 200, content: 628 })).toBe(0.6);
    expect(openingZoom(2000, 1000, 0.6, () => 0, { view: 100, content: 628 })).toBe(1);
  });
});

describe("Fit: the whole flow", () => {
  it("fits width and height together, in whole percents, never above 100%", () => {
    expect(fitWhole({ width: 1000, height: 600 }, { width: 800, height: 300 })).toBe(1);
    expect(fitWhole({ width: 700, height: 600 }, { width: 1000, height: 300 })).toBe(0.7);
    // the height decides
    expect(fitWhole({ width: 2000, height: 300 }, { width: 1000, height: 600 })).toBe(0.5);
  });
  it("goes below the usual 40% when a long flow needs it: the release process at 1366 px", () => {
    // 14 steps, 3287 px of drawing at 100%, 450 px high, in a map 888 px wide and 420 px high
    const z = fitWhole({ width: 888, height: 420 }, { width: 3287, height: 450 }, laneColumn);
    expect(z).toBeLessThan(ZOOM_MIN);
    expect(laneColumn(z) + 3287 * z).toBeLessThanOrEqual(888);
    expect(laneColumn(z + 0.01) + 3287 * (z + 0.01)).toBeGreaterThan(888);
    // never smaller than a picture of boxes
    expect(fitWhole({ width: 100, height: 100 }, { width: 100000, height: 100 })).toBe(ZOOM_FLOOR);
  });
  it("counts the lane column at the width it has at that zoom", () => {
    expect(laneColumn(1)).toBe(156);
    expect(laneColumn(0.6)).toBe(120);
    expect(laneColumn(0.5)).toBe(120);
    expect(laneColumn(0.4)).toBe(108);
    expect(laneColumn(0.2)).toBe(96);
    expect(laneColumn(0.5, true)).toBe(80);
    const z = fitWhole({ width: 600, height: 1000 }, { width: 2000, height: 100 }, laneColumn);
    expect(laneColumn(z) + 2000 * z).toBeLessThanOrEqual(600);
  });
});

describe("the zoom buttons", () => {
  it("go a tenth at a time, within the limits", () => {
    expect(stepZoom(0.6, 1)).toBe(0.7);
    expect(stepZoom(0.65, 1)).toBe(0.7);
    expect(stepZoom(0.6, -1)).toBe(0.5);
    expect(stepZoom(0.4, -1)).toBe(ZOOM_MIN);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
  });
  it("after a Fit below 40%: zooming out goes no further, zooming in works", () => {
    expect(stepZoom(0.22, -1)).toBe(0.22);
    expect(stepZoom(0.22, 1)).toBe(0.3);
    expect(clampZoom(0.1, 0.22)).toBe(0.22);
    expect(wheelZoom(0.22, 100)).toBe(0.22);
    expect(wheelZoom(0.22, -100)).toBeGreaterThan(0.22);
  });
});

describe("the lane names", () => {
  it("show what the lane has room for", () => {
    expect(laneLabel(90, 156)).toEqual({ avatar: true, count: true, lines: 3, small: false });
    expect(laneLabel(64, 156)).toEqual({ avatar: true, count: true, lines: 2, small: false });
    // narrower column: no round mark
    expect(laneLabel(64, 124).avatar).toBe(false);
    // a low lane: the name alone, in smaller type
    expect(laneLabel(40, 124)).toEqual({ avatar: false, count: false, lines: 2, small: true });
    expect(laneLabel(26, 104)).toEqual({ avatar: false, count: false, lines: 1, small: true });
  });
});

describe("a selected step", () => {
  const view = { left: 0, top: 0, width: 800, height: 400 };
  const content = { width: 3000, height: 400 };
  it("is left where it is when it is well inside the view", () => {
    expect(scrollToCentre({ x: 300, y: 50, w: 125, h: 56 }, view, content)).toBeNull();
  });
  it("is brought to the middle when it is near an edge or out of view, not just inside the edge", () => {
    // near the right edge: its branches would be cut
    expect(scrollToCentre({ x: 700, y: 50, w: 125, h: 56 }, view, content)).toEqual({ left: Math.round(762.5 - 400), top: 0 });
    // far out of view
    expect(scrollToCentre({ x: 2000, y: 50, w: 125, h: 56 }, { ...view, left: 0 }, content)).toEqual({ left: Math.round(2062.5 - 400), top: 0 });
    // to the left
    expect(scrollToCentre({ x: 1000, y: 50, w: 125, h: 56 }, { ...view, left: 1500 }, content)).toEqual({ left: Math.round(1062.5 - 400), top: 0 });
  });
  it("at the very end of the flow, as far as the map scrolls", () => {
    expect(scrollToCentre({ x: 2900, y: 50, w: 90, h: 56 }, view, content)).toEqual({ left: 2200, top: 0 });
  });
  it("scrolls nowhere on an axis where the whole flow fits", () => {
    expect(scrollToCentre({ x: 700, y: 300, w: 90, h: 56 }, view, { width: 800, height: 400 })).toBeNull();
  });
  it("is also centred up and down in a tall map", () => {
    expect(scrollToCentre({ x: 300, y: 900, w: 125, h: 56 }, view, { width: 800, height: 2000 })).toEqual({ left: 0, top: Math.round(928 - 200) });
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

describe("zooming around the pointer", () => {
  it("keeps the point under the pointer in place at any zoom", () => {
    expect(scrollForZoom(1, 0.5, { x: 400, y: 0 }, { left: 0, top: 0 })).toEqual({ left: 0, top: 0 });
    expect(scrollForZoom(0.5, 1, { x: 200, y: 0 }, { left: 0, top: 0 }).left).toBe(200);
  });
});

describe("Fit is temporary", () => {
  it("returns to the working zoom when a step is selected or the process changes", () => {
    expect(afterFit({ fitted: true, zoom: 0.22, working: 0.6 }, "select")).toEqual({ fitted: false, zoom: 0.6 });
    expect(afterFit({ fitted: true, zoom: 0.22, working: 0.6 }, "edit")).toEqual({ fitted: false, zoom: 0.6 });
  });
  it("keeps a zoom the person chose with the buttons, and leaves an unfitted map alone", () => {
    expect(afterFit({ fitted: true, zoom: 0.3, working: 0.6 }, "zoom")).toEqual({ fitted: false, zoom: 0.3 });
    expect(afterFit({ fitted: false, zoom: 0.9, working: 0.6 }, "select")).toEqual({ fitted: false, zoom: 0.9 });
  });
});

describe("lane names", () => {
  it("wrap between words, never inside one", () => {
    expect(wrapWords("Site Reliability team", 12, 3)).toEqual(["Site", "Reliability", "team"]);
    expect(wrapWords("IT procurement", 12, 2)).toEqual(["IT", "procurement"]);
    expect(wrapWords("Service Management", 20, 2)).toEqual(["Service Management"]);
  });
  it("end in “…” after a whole word when they need more lines than they have", () => {
    expect(wrapWords("Site Reliability team", 12, 2)).toEqual(["Site", "Reliability…"]);
    expect(wrapWords("Change advisory board members", 14, 1)).toEqual(["Change…"]);
    expect(wrapWords("", 10, 2)).toEqual([]);
  });
  it("never cut a word: the initial when not even the first word fits, else “…” after the last whole word", () => {
    expect(wrapWords("Procurement", 9, 2)).toEqual(["P"]);
    expect(wrapWords("Change management board", 8, 1)).toEqual(["Change…"]);
    expect(wrapWords("Site Reliability team", 9, 3)).toEqual(["Site…"]);
    expect(wrapWords("Deployment pipeline", 11, 2)).toEqual(["Deployment", "pipeline"]);
    // measured: a line fits when the test says so
    const px = (l: string) => l.length * 8 <= 80;
    expect(wrapWords("Procurement team", px, 2)).toEqual(["P"]);
    expect(wrapWords("Team procurement", px, 2)).toEqual(["Team…"]);
  });
  it("count the characters a column holds", () => {
    expect(laneChars(120, false, false)).toBe(13);
    expect(laneChars(156, false, true)).toBe(12);
    expect(laneChars(80, true, false)).toBe(9);
  });
});

describe("how to move the map, by the device", () => {
  it("speaks of swiping and pinching on a touch screen, never of Ctrl", () => {
    expect(panHint(true)).toEqual({ move: "Swipe to move", zoom: "pinch to zoom" });
    expect(panHint(false, "Ctrl")).toEqual({ move: "Drag to move", zoom: "Ctrl + scroll to zoom" });
  });
});
