import { describe, expect, it } from "vitest";
import {
  ALL_PROPERTIES, BAD, cleanLook, contrast, DEFAULT_NAME, derive, distance, inkOn, isDark, lookProblems, lookProperties, luminance, mix, nameOf, NEAR_RED,
  PALETTES, readable, SURFACES, tidyLook,
} from "../theme";

const light = Object.values(SURFACES.light), dark = Object.values(SURFACES.dark);
const min = (c: string, bgs: string[]) => Math.min(...bgs.map((b) => contrast(c, b)));

describe("contrast per WCAG", () => {
  it("measures luminance and contrast ratios", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrast("#ffffff", "#ffffff")).toBe(1);
    // known pairs: #767676 on white is the classic 4.54:1
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrast("#4f46e5", "#ffffff")).toBeGreaterThan(6);
  });
  it("mixes like color-mix in srgb", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#4f46e5", "#ffffff", 0)).toBe("#ffffff");
    expect(mix("#4f46e5", "#ffffff", 1)).toBe("#4f46e5");
  });
  it("puts white or near-black ink on a colour, whichever reads better", () => {
    expect(inkOn("#4f46e5")).toBe("#ffffff");
    expect(inkOn("#facc15")).toBe("#11121c");
    for (const c of ["#777777", "#ff0000", "#00ff00", "#0000ff", "#808000"]) expect(contrast(inkOn(c), c)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the readable variant of a colour", () => {
  it("keeps a colour that already reads well", () => {
    expect(readable("#4F46E5", light)).toBe("#4f46e5");
    expect(readable("#fde047", dark)).toBe("#fde047");
  });
  it("darkens a light colour on the light surfaces and lightens a dark one on the dark surfaces, only as far as needed", () => {
    const yellow = readable("#facc15", light);
    expect(min(yellow, light)).toBeGreaterThanOrEqual(4.5);
    expect(min(yellow, light)).toBeLessThan(4.9); // as close to the chosen colour as possible
    expect(luminance(yellow)).toBeLessThan(luminance("#facc15"));
    const navy = readable("#002855", dark);
    expect(min(navy, dark)).toBeGreaterThanOrEqual(4.5);
    expect(min(navy, dark)).toBeLessThan(4.9);
    expect(luminance(navy)).toBeGreaterThan(luminance("#002855"));
  });
  it("finds a passing colour for any colour, also a grey and the extremes", () => {
    for (const c of ["#ffffff", "#000000", "#808080", "#ff0000", "#00ffff", "#facc15", "#f0f0f0", "#0a0a0a"]) {
      expect(min(readable(c, light), light), c).toBeGreaterThanOrEqual(4.5);
      expect(min(readable(c, dark), dark), c).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the derived tokens", () => {
  it("leave every part that was not chosen to the default look in CSS", () => {
    expect(derive({})).toEqual({ tokens: { light: {}, dark: {} }, colors: [] });
    expect(derive({ name: "Acme", brand: "nope" }).colors).toEqual([]);
  });
  it("give the brand colour a readable accent, its ink and a soft tint in both themes", () => {
    const d = derive({ brand: "#facc15" });
    for (const mode of ["light", "dark"] as const) {
      const t = d.tokens[mode], s = SURFACES[mode];
      expect(Object.keys(t).sort()).toEqual(["accent", "accent-ink", "accent-soft"]);
      expect(min(t.accent, [s.bg, s.surface, s.surface2, t["accent-soft"]])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(4.5);
    }
    const [c] = d.colors;
    expect(c).toMatchObject({ part: "brand", chosen: "#facc15", adjusted: { light: true, dark: false }, nearRed: false });
    expect(c.used.dark).toBe("#facc15");
    // the light tint stays a pale yellow, not a pale brown
    expect(d.tokens.light["accent-soft"]).toBe(mix("#facc15", "#ffffff", 0.1));
  });
  it("give each kind a readable colour on its own tint, and a line", () => {
    const d = derive({ process: "#99f6e4", standard: "#1e1b4b" });
    for (const mode of ["light", "dark"] as const) {
      const t = d.tokens[mode], s = SURFACES[mode];
      for (const k of ["process", "standard"]) {
        expect(min(t[`kind-${k}`], [s.bg, s.surface, s.surface2, t[`kind-${k}-bg`]])).toBeGreaterThanOrEqual(4.5);
        expect(t[`kind-${k}-line`]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(d.colors.map((c) => c.part)).toEqual(["process", "standard"]);
    expect(d.colors[1].adjusted).toEqual({ light: false, dark: true });
  });
  it("warn when a colour looks like the red of problems, not otherwise", () => {
    expect(distance(BAD.light, BAD.light)).toBe(0);
    for (const red of ["#dc2626", "#be123c", "#e11d48", "#b91c1c"]) expect(derive({ brand: red }).colors[0].nearRed, red).toBe(true);
    for (const other of ["#4f46e5", "#0f766e", "#6d28d9", "#facc15", "#334155", "#0369a1", "#808080"]) expect(derive({ brand: other }).colors[0].nearRed, other).toBe(false);
    expect(distance("#dc2626", BAD.light)).toBeLessThan(NEAR_RED);
  });
  it("as element properties: the chosen colours, and initial for the rest so that the defaults apply", () => {
    const p = lookProperties({ brand: "#0369a1" });
    expect(Object.keys(p).sort()).toEqual([...ALL_PROPERTIES].sort());
    expect(p["--theme-light-accent"]).toBe("#0369a1");
    expect(p["--theme-dark-accent"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(p["--theme-light-kind-process"]).toBe("initial");
    expect(ALL_PROPERTIES).toHaveLength(18);
  });
  it("the ready-made palettes start with the default look, and none of them looks like the red of problems", () => {
    expect(PALETTES[0].colors).toEqual({});
    for (const p of PALETTES) expect(derive(p.colors).colors.filter((c) => c.nearRed), p.name).toEqual([]);
  });
});

describe("reading and checking a look", () => {
  it("keeps only valid parts of what came from storage or the server", () => {
    expect(cleanLook(null)).toEqual({});
    expect(cleanLook("x")).toEqual({});
    expect(cleanLook({ name: "  Acme  ", logo: "a".repeat(64), brand: "#AABBCC", process: "red", standard: 7, appearance: "sepia", extra: 1 }))
      .toEqual({ name: "Acme", logo: "a".repeat(64), brand: "#aabbcc" });
    expect(cleanLook({ name: "x".repeat(41), logo: "../etc", appearance: "dark" })).toEqual({ appearance: "dark" });
  });
  it("tidies what is saved and says what is wrong in plain words", () => {
    expect(tidyLook({ name: "  ", brand: "#AA00BB", appearance: undefined })).toEqual({ brand: "#aa00bb" });
    expect(lookProblems({ name: "Acme", brand: "#123456" })).toEqual([]);
    expect(lookProblems({ name: "x".repeat(41), brand: "blue", standard: "#12345" })).toEqual([
      "The name is 41 characters long; it can be at most 40.",
      "The brand colour must be written as # and six digits or letters a-f, e.g. #4f46e5.",
      "The colour of standards must be written as # and six digits or letters a-f, e.g. #4f46e5.",
    ]);
    expect(lookProblems({ name: "A‮B" })).toEqual(["The name contains characters that change the reading direction. Remove them and try again."]);
    expect(lookProblems({ name: "A\tB" })).toEqual(["The name contains control characters. Remove them and try again."]);
  });
  it("names the portal", () => {
    expect(nameOf({})).toBe(DEFAULT_NAME);
    expect(nameOf({ name: " Acme Hub " })).toBe("Acme Hub");
  });
});

describe("light or dark", () => {
  it("the person's own choice wins, then the look's appearance, then the device", () => {
    expect(isDark("dark", "light", false)).toBe(true);
    expect(isDark("light", "dark", true)).toBe(false);
    expect(isDark(null, "dark", false)).toBe(true);
    expect(isDark(null, "light", true)).toBe(false);
    expect(isDark(null, "device", true)).toBe(true);
    expect(isDark(null, undefined, true)).toBe(true); // no appearance set: as the device is set, as before
    expect(isDark(null, undefined, false)).toBe(false);
    expect(isDark("garbage", "dark", false)).toBe(true);
  });
});
