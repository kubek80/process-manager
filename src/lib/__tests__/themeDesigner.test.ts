import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  contrast, DEFAULT_COLOR, DEFAULT_LOOK, derive, DESIGNER, distance, groundOf, INK_TEXT, kindsAlikeToColourBlindText, lookProperties, mix, paletteName, PALETTES,
  PROBLEM_RED, PROCESS_TEAL, seenWithout, SURFACES, TINT_STEPS, TOKENS, warningCount,
} from "../theme";

const SRC = join(__dirname, "..", "..");
const sheets = readdirSync(SRC).filter((f) => f.endsWith(".css"));
const read = (f: string) => readFileSync(join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the designer's look is the default", () => {
  it("gives every job its colour of the palette; problems and processes keep colours of their own", () => {
    expect(DEFAULT_COLOR).toMatchObject({
      brand: DESIGNER.ocean, mainButton: DESIGNER.ocean, info: DESIGNER.ocean, secondary: DESIGNER.sky, ink: DESIGNER.midnight, otherButtons: DESIGNER.midnight,
      standard: DESIGNER.berry, success: DESIGNER.land, warning: DESIGNER.earth, highlight: DESIGNER.sun, quiet: DESIGNER.grain, problem: PROBLEM_RED, process: PROCESS_TEAL,
    });
    expect(DESIGNER).toEqual({ ocean: "#1971ed", sky: "#66c5ff", snow: "#ffffff", midnight: "#0e0d26", sun: "#f3ea5d", earth: "#ff6720", grain: "#e6cda8", land: "#00b35f", berry: "#913199" });
    expect(paletteName("#1971ED")).toBe("Ocean");
    expect(paletteName(PROBLEM_RED)).toBeUndefined();
    // no ready-made palette may be taken for a colour of the designer's
    for (const p of PALETTES) expect(Object.keys(DESIGNER), p.name).not.toContain(p.name.toLowerCase());
  });

  it("keeps processes and standards apart, also for people who cannot tell red from green", () => {
    const d = derive(DEFAULT_LOOK);
    expect(d.kindsAlike).toEqual([]);
    expect(d.kindsAlikeToColourBlind).toEqual([]);
    // Ocean for processes would not: blue and Berry differ almost only in hue
    const ocean = derive({ ...DEFAULT_LOOK, process: DESIGNER.ocean });
    expect(ocean.kindsAlikeToColourBlind.length).toBeGreaterThan(0);
    expect(warningCount(ocean)).toBeGreaterThan(warningCount(d));
    expect(kindsAlikeToColourBlindText(["light", "dark"])).toMatch(/^People who cannot tell red from green will hardly tell processes from standards: /);
    for (const m of ["light", "dark"] as const) {
      const t = d.tokens[m];
      expect(Math.min(...(["deuteranopia", "protanopia"] as const).map((k) => distance(seenWithout(t["kind-process"], k), seenWithout(t["kind-standard"], k))))).toBeGreaterThanOrEqual(25);
    }
  });

  it("stylesheets hold exactly what the default look works out to", () => {
    const d = derive(DEFAULT_LOOK);
    let seen = 0;
    for (const f of sheets) {
      for (const m of read(f).matchAll(/var\(--theme-(light|dark)-([a-z0-9-]+), (#[0-9a-f]{6})\)/g)) {
        expect(m[3], `${f}: --theme-${m[1]}-${m[2]}`).toBe(d.tokens[m[1] as "light" | "dark"][m[2]]);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  it("is readable: text on every surface, text on its tints, the search mark and the quiet surface", () => {
    const d = derive(DEFAULT_LOOK);
    for (const m of ["light", "dark"] as const) {
      const t = d.tokens[m];
      const grounds = [t.bg, t.surface, t["surface-2"]];
      for (const k of ["text", "text-2", "text-3", "accent", "kind-process", "kind-standard", "good", "warn", "bad"]) {
        for (const g of grounds) expect(contrast(t[k], g), `${m} ${k} on ${g}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.text, t["search-mark"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["text-3"], t.quiet)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["bar-text"], t.bar)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["bar-muted"], t["bar-2"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["highlight-ink"], t.highlight)).toBeGreaterThanOrEqual(4.5);
    }
    // Midnight is the ink of the light look and the ground of the dark one; Snow the surfaces; Sky at 10 % the page ground
    expect(d.tokens.light.text).toBe(DESIGNER.midnight);
    expect(d.tokens.dark.bg).toBe(DESIGNER.midnight);
    expect(SURFACES.light).toEqual({ bg: mix(DESIGNER.sky, "#ffffff", 0.1), surface: "#ffffff", surface2: mix(DESIGNER.sky, "#ffffff", 0.1) });
    // Sun is the search mark as it is; Ocean the main button with white ink at 4.5:1
    expect(d.tokens.light["search-mark"]).toBe(DESIGNER.sun);
    expect(d.tokens.light["accent-fill"]).toBe(DESIGNER.ocean);
    expect(d.tokens.light["accent-ink"]).toBe("#ffffff");
  });
});

describe("the designer's tints", () => {
  it("are 10, 35, 75 and 100 % of Ocean and of Sky: over Snow in the light look, over the dark ground in the dark one", () => {
    expect([...TINT_STEPS]).toEqual([10, 35, 75, 100]);
    const d = derive(DEFAULT_LOOK);
    for (const n of TINT_STEPS) {
      expect(d.tokens.light[`ocean-${n}`]).toBe(mix(DESIGNER.ocean, "#ffffff", n / 100));
      expect(d.tokens.light[`sky-${n}`]).toBe(mix(DESIGNER.sky, "#ffffff", n / 100));
      expect(d.tokens.dark[`ocean-${n}`]).toBe(mix(DESIGNER.ocean, DESIGNER.midnight, n / 100));
      expect(d.tokens.dark[`sky-${n}`]).toBe(mix(DESIGNER.sky, DESIGNER.midnight, n / 100));
    }
    // the light soft surfaces of the brand are its 10 % tint
    expect(d.tokens.light["accent-soft"]).toBe(d.tokens.light["ocean-10"]);
  });

  it("follow a changed brand and second colour", () => {
    const t = derive({ brand: "#0055aa", secondary: "#ff8800" }).tokens;
    expect(t.light["ocean-35"]).toBe(mix("#0055aa", "#ffffff", 0.35));
    expect(t.light["sky-10"]).toBe(mix("#ff8800", "#ffffff", 0.1));
    expect(t.light.bg).toBe(mix("#ff8800", "#ffffff", 0.1));
    expect(lookProperties({ brand: "#0055aa" })["--theme-light-ocean-10"]).toBe(mix("#0055aa", "#ffffff", 0.1));
  });

  it("are used for backgrounds, lines and marks only, never for text, and only in the four steps", () => {
    const wrong: string[] = [];
    for (const f of sheets) {
      const css = read(f);
      for (const m of css.matchAll(/(?:^|[;{\s])(color|-webkit-text-fill-color|caret-color)\s*:\s*([^;}]*)/g)) {
        if (/var\(--(ocean|sky)-/.test(m[2])) wrong.push(`${f}: ${m[1]}: ${m[2]}`);
      }
      for (const m of css.matchAll(/var\(--(ocean|sky)-(\d+)/g)) if (!(TINT_STEPS as readonly number[]).includes(Number(m[2]))) wrong.push(`${f}: --${m[1]}-${m[2]}`);
      // a brand colour toned down by hand, instead of one of its tints
      for (const m of css.matchAll(/color-mix\(in srgb, var\(--accent(-soft)?\) \d+%/g)) wrong.push(`${f}: ${m[0]}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the new parts of a look", () => {
  it("a chosen ink or second colour works out every colour again on the new surfaces", () => {
    const d = derive({ ink: "#3b2a1a" });
    for (const m of ["light", "dark"] as const) for (const k of [...TOKENS.ink, ...TOKENS.brand, ...TOKENS.process, "good", "warn", "bad", "search-mark", "quiet"]) expect(d.tokens[m][k], `${m} ${k}`).toMatch(/^#[0-9a-f]{6}$/);
    // the parts that follow the brand or the text still follow it
    expect(d.tokens.light["action-fill"]).toBeUndefined();
    expect(d.tokens.dark.bg).toBe(groundOf({ ink: "#3b2a1a" }).dark.bg);
    expect(d.colors.map((c) => c.part)).toEqual(["ink"]);
  });

  it("an ink too light for text is made darker, with a warning; the dark ground stays dark enough for light text", () => {
    const d = derive({ ink: "#8899aa" });
    const ink = d.colors[0];
    expect(ink.warnings).toEqual([INK_TEXT]);
    expect(contrast(d.tokens.light.text, "#ffffff")).toBeGreaterThanOrEqual(12);
    expect(contrast(d.tokens.dark.bg, "#ffffff")).toBeGreaterThanOrEqual(15);
    expect(derive({ ink: "#101828" }).colors[0].warnings).toEqual([]);
  });

  it("a highlight that cannot carry text as it is becomes a lighter mark; one that looks like a state is said", () => {
    const d = derive({ highlight: "#7c3aed" });
    expect(contrast(d.tokens.light.text ?? DESIGNER.midnight, d.tokens.light["search-mark"])).toBeGreaterThanOrEqual(4.5);
    expect(d.tokens.light["search-mark"]).not.toBe("#7c3aed");
    expect(derive({ highlight: "#ff6a1f" }).colors[0].warnings).toContain("Highlights will look like warnings: a word found by the search and “Review due” will have nearly the same colour.");
    expect(derive({ highlight: "#ffe500" }).colors[0].warnings).toEqual([]);
  });

  it("the quiet surface keeps the quietest text readable", () => {
    const d = derive({ quiet: "#8a6d3b" });
    for (const m of ["light", "dark"] as const) {
      const text3 = derive(DEFAULT_LOOK).tokens[m]["text-3"];
      expect(contrast(text3, d.tokens[m].quiet), m).toBeGreaterThanOrEqual(4.5);
    }
  });
});
