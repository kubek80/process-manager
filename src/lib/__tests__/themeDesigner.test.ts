import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ALERT, ALERT_TEXT, confusion, contrast, DEFAULT_COLOR, fullTokens, MAP_TOKENS, readingPairs, TEXT_MIN, DEFAULT_LOOK, derive, DESIGNER, distance, groundOf, INK_TEXT, kindsAlikeToColourBlindText, lookProperties, mix, paletteName, PALETTES,
  PROBLEM_RED, PROCESS_TEAL, seenWithout, SURFACES, TINT_STEPS, TOKENS, warningCount,
} from "../theme";

const SRC = join(__dirname, "..", "..");
const sheets = readdirSync(SRC).filter((f) => f.endsWith(".css"));
const read = (f: string) => readFileSync(join(SRC, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the designer's look is the default", () => {
  it("gives every job its colour of the palette; problems and processes keep colours of their own", () => {
    expect(DEFAULT_COLOR).toMatchObject({
      brand: DESIGNER.ocean, mainButton: DESIGNER.ocean, info: DESIGNER.sky, secondary: DESIGNER.sky, ink: DESIGNER.midnight, otherButtons: DESIGNER.midnight,
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
      // the quietest text also reads on the tints used for table heads, hovered rows and selected areas
      for (const k of ["ocean-10", "sky-10"]) expect(contrast(t["text-3"], t[k]), `${m} text-3 on ${k}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.accent, t["accent-soft"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["bar-text"], t.bar)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["bar-muted"], t["bar-2"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["highlight-ink"], t.highlight)).toBeGreaterThanOrEqual(4.5);
    }
    // Midnight is the ink of the light look and the ground of the dark one; Snow the surfaces; Sky at 10 % the page ground
    expect(d.tokens.light.text).toBe(DESIGNER.midnight);
    expect(d.tokens.dark.bg).toBe(DESIGNER.midnight);
    expect(SURFACES.light).toEqual({ bg: mix(DESIGNER.sky, "#ffffff", 0.1), surface: "#ffffff", surface2: mix(DESIGNER.sky, "#ffffff", 0.1), raised: "#ffffff" });
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

describe("every pair of text and ground a look produces reads", () => {
  // the default, and the looks a critic tried: a light ink, a red brand (Information follows it), a yellow second colour, Lagoon
  const looks: [string, Parameters<typeof derive>[0]][] = [
    ["the default look", {}],
    ["a light ink", { ink: "#9aa0b4" }],
    ["a red brand", { brand: "#d6336c" }],
    ["a yellow second colour", { secondary: "#f3ea5d" }],
    ["Lagoon", { ...PALETTES.find((p) => p.name === "Lagoon")!.colors, font: "inter" }],
    ["a navy brand and a grey ink", { brand: "#0b1f3a", ink: "#3f3f46", quiet: "#8a6d3b", highlight: "#7c3aed" }],
  ];
  for (const [name, look] of looks) {
    it(`in ${name}, in both themes`, () => {
      const wrong: string[] = [];
      for (const m of ["light", "dark"] as const) {
        for (const p of readingPairs(fullTokens(look, m))) {
          const c = contrast(p.fg, p.bg);
          if (c < p.min) wrong.push(`${m}: ${p.what} ${c.toFixed(2)} < ${p.min}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
  it("worked-out text keeps a margin over 4.5:1, so that a hover tint or a half-transparent ground still passes", () => {
    const wrong: string[] = [];
    for (const m of ["light", "dark"] as const) {
      for (const p of readingPairs(fullTokens({}, m))) if (p.worked && contrast(p.fg, p.bg) < TEXT_MIN - 0.02) wrong.push(`${m}: ${p.what} ${contrast(p.fg, p.bg).toFixed(2)}`);
    }
    expect(wrong).toEqual([]);
  });
  it("every pair the map, the bar, the segments and the controls draw is in the list", () => {
    const what = readingPairs(fullTokens({}, "dark")).map((p) => p.what);
    for (const w of ["accent on seg-on", "text-3 on ocean-10", "bad on bad-bg", "bar-muted on bar-2", "step-check on its tile", "lane-2 on its tile", "control-line on surface", "mark-brown on mark-brown-bg"]) expect(what).toContain(w);
  });
});

describe("the map joins the look", () => {
  it("names no colour of its own: the kinds of steps and the lanes are tokens", async () => {
    const { STEP_META, LANE_COLORS, LANE_TILES } = await import("../stepMeta");
    const src = readFileSync(join(SRC, "lib", "stepMeta.ts"), "utf8");
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    for (const m of Object.values(STEP_META)) { expect(m.color).toMatch(/^var\(--step-(work|check|system|plain)\)$/); expect(m.tile).toBe(m.color.replace(")", "-bg)")); }
    expect(new Set(Object.values(STEP_META).map((m) => m.color)).size).toBe(4);
    expect(LANE_COLORS).toEqual(LANE_TILES.map((t) => t.replace("-bg)", ")")));
    for (const k of Object.keys(MAP_TOKENS)) expect(read("styles.css")).toContain(`--${k}: var(--${MAP_TOKENS[k][0]}); --${k}-bg: var(--${MAP_TOKENS[k][1]});`);
  });
  it("lanes are never a state, and neighbouring lanes differ also for people who cannot tell red from green", () => {
    const states = ["good", "warn", "bad", "info"];
    const lanes = Object.keys(MAP_TOKENS).filter((k) => k.startsWith("lane-"));
    for (const l of lanes) expect(states).not.toContain(MAP_TOKENS[l][0]);
    for (const m of ["light", "dark"] as const) {
      const t = fullTokens({}, m);
      for (let i = 0; i < lanes.length; i++) {
        const a = t[MAP_TOKENS[lanes[i]][0]], b = t[MAP_TOKENS[lanes[(i + 1) % lanes.length]][0]];
        const cb = Math.min(...(["deuteranopia", "protanopia"] as const).map((k) => distance(seenWithout(a, k), seenWithout(b, k))));
        expect(Math.min(distance(a, b), cb), `${m}: ${lanes[i]} beside the next`).toBeGreaterThanOrEqual(15);
        for (const s of ["good", "warn", "bad"]) expect(distance(a, t[s]), `${m}: ${lanes[i]} like ${s}`).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe("the warnings cover what a look cannot keep", () => {
  it("a second colour like the highlight; information follows the second colour, no longer the brand", () => {
    expect(derive({ secondary: "#f3ea5d" }).colors[0].warnings).toContain("The second colour looks like the highlight: the page ground and what is selected will look like words found by a search.");
    // a red brand still says it looks like problems, but notices no longer follow it
    expect(derive({ brand: "#d6336c" }).colors[0].like).toContain("bad");
    expect(confusion("brand", "bad")).not.toContain("Notices");
    expect(derive({ brand: "#d6336c" }).colors.flatMap((c) => c.warnings).join(" ")).not.toContain("Notices that only inform");
    // a red second colour, which information follows, says so; a red information colour of its own says it too
    expect(derive({ secondary: "#d6336c" }).colors[0].warnings).toContain("Notices that only inform, and information alerts, are in the second colour: they will look like problem notices. Give Information a colour of its own under States.");
    expect(derive({ info: "#d6336c" }).colors.find((c) => c.part === "info")!.warnings).toContain("Notices that only inform will look like problems.");
    expect(derive({ secondary: "#d6336c", info: "#1971ed" }).colors.find((c) => c.part === "secondary")!.warnings.join(" ")).not.toContain("Notices");
  });
});

describe("the designer's alerts", () => {
  it("are the one exception to the tint steps: their grounds are the designer's own (information: Sky at 13 %), and only alerts use them", () => {
    const wrong: string[] = [];
    for (const f of sheets) {
      for (const m of read(f).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (/var\(--alert-(info|success|warn|bad)-(bg|icon)\)/.test(m[2]) && !/\.alert|\.toast/.test(m[1])) wrong.push(`${f}: ${m[1].trim()}`);
      }
    }
    expect(wrong).toEqual([]);
  });
  const light = fullTokens({}, "light"), dark = fullTokens({}, "dark");
  it("are the designer's values in the default look, light", () => {
    expect([light["alert-info-bg"], light["alert-success-bg"], light["alert-warn-bg"], light["alert-bad-bg"]]).toEqual(["#ebf7ff", "#f4ffdb", "#fffae0", "#ffebeb"]);
    expect(light["alert-info-icon"]).toBe("#0074bc");
    expect(light["alert-text"]).toBe("#13130c");
    expect(ALERT_TEXT).toBe("#13130c");
    // the information ground is Sky at 13 % over Snow, the designer's own strength for alerts
    expect(mix(DESIGNER.sky, DESIGNER.snow, 0.13)).toBe("#ebf7ff");
    // the icons the portal chose for the other three: a dark green, a dark mustard, a red
    expect([light["alert-success-icon"], light["alert-warn-icon"], light["alert-bad-icon"]]).toEqual([ALERT.success.icon, ALERT.warning.icon, ALERT.problem.icon]);
  });
  it("read: one text on every ground, each icon at least 4.5:1 on its own (3:1 in the dark look), the mark in it too", () => {
    for (const a of ["info", "success", "warn", "bad"]) {
      expect(contrast(light["alert-text"], light[`alert-${a}-bg`]), a).toBeGreaterThanOrEqual(12);
      expect(contrast(light[`alert-${a}-icon`], light[`alert-${a}-bg`]), a).toBeGreaterThanOrEqual(4.5);
      expect(contrast(light[`alert-${a}-icon`], light.surface), `${a}: the white mark in its icon`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark["alert-text"], dark[`alert-${a}-bg`]), `${a} dark`).toBeGreaterThanOrEqual(TEXT_MIN);
      expect(contrast(dark[`alert-${a}-icon`], dark[`alert-${a}-bg`]), `${a} dark`).toBeGreaterThanOrEqual(3);
      expect(contrast(dark[`alert-${a}-icon`], dark.bg), `${a} dark: the dark mark in its icon`).toBeGreaterThanOrEqual(3);
    }
  });
  it("keep their four hues in the dark look, apart from each other and from the ground", () => {
    const bgs = ["info", "success", "warn", "bad"].map((a) => dark[`alert-${a}-bg`]);
    for (let i = 0; i < bgs.length; i++) {
      expect(contrast(bgs[i], dark.bg), "stands off the dark ground").toBeGreaterThan(1.1);
      for (let j = i + 1; j < bgs.length; j++) expect(distance(bgs[i], bgs[j])).toBeGreaterThan(5);
    }
  });
  it("follow a changed state colour: a ground of its hue at the designer's lightness, an icon that reads on it", () => {
    const hsl = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b); return (max + min) / 2; };
    for (const [part, token, chosen] of [["success", "alert-success", "#0d9488"], ["warning", "alert-warn", "#7c3aed"], ["problem", "alert-bad", "#9333ea"], ["info", "alert-info", "#16a34a"]] as const) {
      const t = derive({ [part]: chosen }).tokens.light;
      expect(t[`${token}-bg`], part).not.toBe(ALERT[part].bg);
      expect(Math.abs(hsl(t[`${token}-bg`]) - hsl(ALERT[part].bg)), `${part}: same lightness`).toBeLessThan(0.01);
      expect(contrast(t[`${token}-icon`], t[`${token}-bg`]), part).toBeGreaterThanOrEqual(4.5);
    }
    // information without a colour of its own follows the second colour
    const second = derive({ secondary: "#f59e0b" }).tokens.light;
    expect(second["alert-info-bg"]).not.toBe("#ebf7ff");
    expect(second.info).not.toBe(fullTokens({}, "light").info);
    // an admin's stored information colour keeps working, and wins over the second colour
    expect(derive({ info: "#4f46e5", secondary: "#f59e0b" }).tokens.light.info).toBe(derive({ info: "#4f46e5" }).tokens.light.info);
    // a changed ink is the alerts' text too; the default ink keeps the designer's
    expect(derive({ ink: "#1f2937" }).tokens.light["alert-text"]).toBe(derive({ ink: "#1f2937" }).tokens.light.text);
  });
});
