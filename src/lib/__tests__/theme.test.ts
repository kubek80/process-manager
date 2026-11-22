import { describe, expect, it } from "vitest";
import {
  ALL_PROPERTIES, ALIKE, BAR, cleanLook, COLOR_PARTS, FONT_FAMILY, FONT_PROPERTY, seenWithout, STATE_PARTS, TOKENS, confusion, contrast, DEFAULT_NAME, derive, distance, FILL_MIN, inkOn, isDark, kindsAlikeText, lookProblems, lookProperties, luminance, mix, nameOf, SEMANTIC, underlineLinks,
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
    expect(derive({})).toEqual({ tokens: { light: {}, dark: {} }, colors: [], kindsAlike: [] });
    expect(derive({ name: "Acme", brand: "nope" }).colors).toEqual([]);
  });
  it("give the brand colour a readable accent, its ink and a soft tint in both themes", () => {
    const d = derive({ brand: "#facc15" });
    for (const mode of ["light", "dark"] as const) {
      const t = d.tokens[mode], s = SURFACES[mode];
      expect(Object.keys(t).sort()).toEqual(["accent", "accent-fill", "accent-ink", "accent-soft"]);
      expect(min(t.accent, [s.bg, s.surface, s.surface2, t["accent-soft"]])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["accent-ink"], t["accent-fill"])).toBeGreaterThanOrEqual(4.5);
    }
    const [c] = d.colors;
    expect(c).toMatchObject({ part: "brand", chosen: "#facc15", adjusted: { light: true, dark: false }, like: ["warn"] });
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
    expect(distance(SEMANTIC.bad.light, SEMANTIC.bad.light)).toBe(0);
    for (const red of ["#dc2626", "#be123c", "#e11d48", "#b91c1c"]) expect(derive({ brand: red }).colors[0].like, red).toContain("bad");
    for (const other of ["#4f46e5", "#0f766e", "#6d28d9", "#334155", "#0369a1", "#808080"]) expect(derive({ brand: other }).colors[0].like, other).toEqual([]);
    expect(distance("#dc2626", SEMANTIC.bad.light)).toBeLessThan(ALIKE);
  });
  it("warn when a colour is grey", () => {
    for (const g of ["#808080", "#6b6b70", "#3f3f46"]) expect(derive({ brand: g }).colors[0].grey, g).toBe(true);
    for (const c of ["#4f46e5", "#0369a1", "#facc15", "#166534", "#2b4c7e"]) expect(derive({ brand: c }).colors[0].grey, c).toBe(false);
  });
  it("as element properties: the chosen colours, and initial for the rest so that the defaults apply", () => {
    const p = lookProperties({ brand: "#0369a1" });
    expect(Object.keys(p).sort()).toEqual([...ALL_PROPERTIES].sort());
    expect(p["--theme-light-accent"]).toBe("#0369a1");
    expect(p["--theme-dark-accent"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(p["--theme-light-kind-process"]).toBe("initial");
    expect(ALL_PROPERTIES).toHaveLength(71);
    expect(p[FONT_PROPERTY]).toBe("initial");
    expect(lookProperties({ font: "roboto" })[FONT_PROPERTY]).toBe(FONT_FAMILY.roboto);
  });
  it("the ready-made palettes start with the default look, and none of them looks like the red of problems", () => {
    expect(PALETTES[0].colors).toEqual({});
    for (const p of PALETTES) {
      const d = derive(p.colors);
      expect(d.colors.filter((c) => c.like.length || c.grey).map((c) => c.part), p.name).toEqual([]);
      expect(d.kindsAlike, p.name).toEqual([]);
    }
  });
});

describe("fills, warnings and adjustments people can see", () => {
  it("a fill keeps the chosen colour with the ink that reads on it, unless it vanishes into the surface", () => {
    const d = derive({ brand: "#facc15" });
    expect(d.tokens.light["accent-fill"]).toBe("#facc15"); // a yellow button with black ink...
    expect(d.tokens.light["accent-ink"]).toBe("#11121c");
    expect(d.tokens.light.accent).not.toBe("#facc15"); // ...while yellow text would be unreadable
    const navy = derive({ brand: "#0b1f3a" });
    expect(navy.tokens.light["accent-fill"]).toBe("#0b1f3a");
    expect(navy.tokens.dark["accent-fill"]).toBe(navy.tokens.dark.accent); // navy would vanish on the dark surface
    for (const c of ["#facc15", "#0b1f3a", "#808080", "#ffffff", "#000000", "#0369a1", "#dc2626"]) {
      for (const mode of ["light", "dark"] as const) {
        const t = derive({ brand: c, process: c }).tokens[mode];
        expect(contrast(t["accent-ink"], t["accent-fill"]), `${c} ${mode}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["kind-process-ink"], t["kind-process-fill"]), `${c} ${mode}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["accent-fill"], SURFACES[mode].surface), `${c} ${mode}`).toBeGreaterThanOrEqual(FILL_MIN);
      }
    }
  });
  it("reports an adjustment only when it can be seen", () => {
    expect(derive({ brand: "#2563eb" }).colors[0].adjusted.light).toBe(false);
    expect(derive({ brand: "#facc15" }).colors[0].adjusted.light).toBe(true);
  });
  it("says what would be confused with what: amber, green, red, and the two kinds", () => {
    expect(derive({ brand: "#c2410c" }).colors[0].like).toEqual(["warn"]);
    expect(derive({ process: "#166534" }).colors[0].like).toEqual(["good"]);
    expect(confusion("brand", "bad")).toContain("Buttons that save or approve will look like buttons that delete");
    expect(confusion("standard", "warn")).toContain("Every standard will look as if its review were due.");
    expect(derive({ process: "#6d28d9" }).kindsAlike).toContain("light");
    expect(derive({ process: "#0369a1", standard: "#0284c7" }).kindsAlike.length).toBeGreaterThan(0);
    expect(derive({}).kindsAlike).toEqual([]);
    expect(kindsAlikeText(["dark"])).toBe("Processes and standards will be hard to tell apart in the dark look: their marks and tags have nearly the same colour. Choose colours further apart.");
  });
  it("underlines links when the brand colour is nearly grey", () => {
    for (const g of ["#808080", "#334155", "#0b1f3a"]) expect(underlineLinks({ brand: g }), g).toBe(true);
    for (const c of ["#4f46e5", "#2b4c7e", "#facc15"]) expect(underlineLinks({ brand: c }), c).toBe(false);
    expect(underlineLinks({})).toBe(false);
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

describe("the Theming section in the app", () => {
  it("has its own address, keeps unsaved changes when left for it, and the tab title names the portal as set", async () => {
    const { href, pageTitle, parseRoute } = await import("../store");
    const { normalizeHex } = await import("../theme");
    expect(parseRoute("#/admin/theming")).toEqual({ page: "admin", section: "theming" });
    expect(href({ page: "admin", section: "theming" })).toBe("#/admin/theming");
    expect(pageTitle({ page: "admin", section: "theming" })).toBe("Theming · Admin · Process Manager");
    expect(pageTitle({ page: "library" }, {}, "Acme Hub")).toBe("Processes · Acme Hub");
    expect(pageTitle({ page: "home" }, {}, "Acme Hub")).toBe("Acme Hub");
    expect(normalizeHex("0055AA")).toBe("#0055aa");
    expect(normalizeHex(" #05a ")).toBe("#0055aa");
    expect(normalizeHex("#0055a")).toBeNull();
    expect(normalizeHex("blue")).toBeNull();
  });
});

describe("buttons and states", () => {
  const words = (look: Parameters<typeof derive>[0], part: string) => derive(look).colors.find((c) => c.part === part)?.warnings ?? [];
  it("leave the buttons and the states to the default look when nothing is chosen", () => {
    const d = derive({ brand: "#0369a1" });
    for (const mode of ["light", "dark"] as const) expect(Object.keys(d.tokens[mode]).some((k) => /^(action|good|warn|bad|info)/.test(k))).toBe(false);
  });
  it("work out every token of a button or a state, readable in both themes and on the dark editing bar", () => {
    for (const c of ["#facc15", "#0b1f3a", "#808080", "#ffffff", "#000000", "#0369a1", "#dc2626", "#16a34a"]) {
      const look = Object.fromEntries(COLOR_PARTS.filter((p) => p !== "brand" && p !== "process" && p !== "standard").map((p) => [p, c]));
      const d = derive(look);
      for (const mode of ["light", "dark"] as const) {
        const t = d.tokens[mode], s = SURFACES[mode];
        const bgs = mode === "dark" ? [s.bg, s.surface, s.surface2, ...BAR] : [s.bg, s.surface, s.surface2];
        expect(Object.keys(t).sort()).toEqual([...TOKENS.mainButton, ...TOKENS.otherButtons, ...STATE_PARTS.flatMap((p) => TOKENS[p])].sort());
        expect(contrast(t["action-ink"], t["action-fill"]), `${c} ${mode}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t["action-fill"], s.surface), `${c} ${mode}`).toBeGreaterThanOrEqual(FILL_MIN);
        expect(min(t["action-other"], [...bgs, t["action-other-soft"]]), `${c} ${mode}`).toBeGreaterThanOrEqual(4.5);
        for (const k of ["good", "warn", "bad", "info"]) {
          expect(min(t[k], [...bgs, t[`${k}-bg`]]), `${k} ${c} ${mode}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t[`${k}-ink`], t[`${k}-fill`]), `${k} ${c} ${mode}`).toBeGreaterThanOrEqual(4.5);
        }
        if (mode === "dark") for (const b of BAR) expect(contrast(t["action-fill"], b), `${c} on the bar`).toBeGreaterThanOrEqual(FILL_MIN);
      }
    }
  });
  it("keep a chosen fill as it is: an orange warning badge stays orange, with the ink that reads on it", () => {
    const d = derive({ warning: "#ea580c", info: "#2563eb", mainButton: "#15803d" });
    expect(d.tokens.light["warn-fill"]).toBe("#ea580c");
    expect(d.tokens.light["action-fill"]).toBe("#15803d");
    expect(d.tokens.light["action-ink"]).toBe("#ffffff");
    expect(d.tokens.light.warn).not.toBe("#ea580c"); // orange text on white would be too light
    expect(d.colors.flatMap((c) => c.warnings)).toEqual([]);
  });
  it("say when main buttons look like buttons that delete", () => {
    expect(words({ mainButton: "#dc2626" }, "mainButton")).toContain("Main buttons will look like buttons that delete: “Publish” and “Delete” will have nearly the same colour.");
    // said once, with the later of the two parts
    expect(words({ mainButton: "#dc2626", problem: "#e11d48" }, "mainButton")).toEqual([]);
    expect(words({ mainButton: "#dc2626", problem: "#e11d48" }, "problem")).toContain("Main buttons will look like buttons that delete: “Publish” and “Delete” will have nearly the same colour.");
    expect(words({ mainButton: "#15803d" }, "mainButton")).toEqual([]);
    expect(words({ otherButtons: "#e11d48" }, "otherButtons")).toContain("Other buttons will look like buttons that delete, which are drawn in the colour of problems.");
    expect(words({ otherButtons: "#334155" }, "otherButtons")).toEqual([]); // a grey for the other buttons is the neutral look, not a problem
  });
  it("say when two states are hard to tell apart", () => {
    expect(words({ success: "#ca8a04", warning: "#d97706" }, "warning")).toContain("Success and warnings will be hard to tell apart: “Published” and “Review due” will have nearly the same colour.");
    expect(words({ warning: "#dc2626" }, "warning")).toContain("Warnings and problems will be hard to tell apart: “Review due” and “Review overdue” will have nearly the same colour.");
    expect(words({ success: "#be123c" }, "success")).toContain("Success and problems will be hard to tell apart: “Nothing to fix” and “1 to fix” will have nearly the same colour.");
    expect(words({ info: "#b45309" }, "info")).toContain("Notices that only inform will look like warnings.");
    expect(words({ info: "#0369a1" }, "info")).toEqual([]);
  });
  it("say when success and problems differ only in hue, which people who cannot tell red from green do not see", () => {
    // to them, the default green and red are nearly the same colour
    expect(distance(seenWithout("#15803d", "deuteranopia"), seenWithout("#be123c", "deuteranopia"))).toBeLessThan(ALIKE);
    expect(words({ success: "#16a34a" }, "success").join(" ")).toContain("People who cannot tell red from green");
    // a clearly lighter or bluer success colour is seen as different
    expect(words({ success: "#0369a1" }, "success")).toEqual([]);
  });
  it("say when a state looks like the brand or a kind left at its default, and when it is grey", () => {
    expect(words({ success: "#4f46e5" }, "success")).toContain("This looks like the brand colour: confirmations will look like buttons and links, and will no longer stand out.");
    expect(words({ warning: "#0f766e" }, "warning")).toContain("This looks like the colour of processes: every process will look as if its review were due.");
    expect(words({ problem: "#6b6b70" }, "problem")).toContain("This colour is nearly grey: problems hardly stand out from ordinary text.");
    // a brand colour is compared with the states as chosen: a blue brand next to a blue warning is said with the brand
    expect(derive({ brand: "#2563eb", warning: "#1d4ed8" }).colors[0].like).toEqual(["warn"]);
    expect(derive({ brand: "#dc2626", problem: "#7c3aed" }).colors[0].like).toEqual([]);
  });
});

describe("reading and checking buttons, states and the font", () => {
  it("keeps the valid parts and says what is wrong", () => {
    expect(cleanLook({ mainButton: "#15803D", otherButtons: "x", success: "#166534", warning: "#ea580c", info: 3, problem: "#b91c1c", font: "roboto" }))
      .toEqual({ mainButton: "#15803d", success: "#166534", warning: "#ea580c", problem: "#b91c1c", font: "roboto" });
    expect(cleanLook({ font: "Comic Sans" })).toEqual({});
    expect(tidyLook({ info: "#2563EB", font: "roboto" })).toEqual({ info: "#2563eb", font: "roboto" });
    expect(lookProblems({ mainButton: "green", problem: "#12" })).toEqual([
      "The colour of main buttons must be written as # and six digits or letters a-f, e.g. #4f46e5.",
      "The colour of problems must be written as # and six digits or letters a-f, e.g. #4f46e5.",
    ]);
    expect(lookProblems({ font: "comic" as never })).toEqual(["The font must be Roboto, or the default font."]);
  });
});
