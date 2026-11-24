// The look of the portal (Admin > Theming): its name, logo, brand colour, second colour, ink (the
// text and the dark surfaces), the colours of the two kinds, of the buttons and of the states
// (success, warning, information, problem), the highlight, the quiet surface, the font and the
// appearance for people who have not chosen light or dark themselves. The default look is the
// designer's palette (DESIGNER): Ocean, Sky, Snow, Midnight, Sun, Earth, Grain, Land and Berry.
//
// The server keeps only what the admin chose. Everything else is worked out here, for light and
// for dark: the readable variant of each colour on the surfaces of that theme (text at least
// 4.5:1 per WCAG, which also covers large marks and borders at 3:1), the ink on top of it, its
// soft tint and its line colour. They are set as CSS custom properties on the root element
// (`--theme-light-…`, `--theme-dark-…`); the token blocks in styles.css read them,
// falling back to the hand-tuned default look, and pick the light or the dark set by `data-theme`.
// Nothing here builds style text or code at run time.

import { useSyncExternalStore } from "react";

export type Appearance = "light" | "dark" | "device";
/** What the admin chose; a part left out is the default look of that part. */
export interface Look {
  name?: string;
  /** An uploaded icon (its id): the logo. */
  logo?: string;
  brand?: string;
  /** The second primary colour (default Sky): the light page ground and the Sky tints. */
  secondary?: string;
  /** The ink (default Midnight): text, the editing bar and the ground of the dark look. */
  ink?: string;
  process?: string;
  standard?: string;
  /** The one main button of a view (default: the brand colour). */
  mainButton?: string;
  /** The other, outlined buttons (default: neutral). */
  otherButtons?: string;
  success?: string;
  warning?: string;
  info?: string;
  problem?: string;
  /** Highlights (default Sun): the words a search found. */
  highlight?: string;
  /** A quiet, warm surface (default Grain): notes and asides. */
  quiet?: string;
  appearance?: Appearance;
  /** The font (default: Roboto, the designer's). */
  font?: Font;
}
/** The fonts a look may choose; left out, Roboto. "roboto" is kept as a choice that older looks stored. */
export type Font = "roboto" | "inter";
export const FONTS: Font[] = ["roboto", "inter"];
/** What the font custom property is set to for each font: the chosen family, then the fallbacks of styles.css follow. */
export const FONT_FAMILY: Record<Font, string> = { roboto: '"Roboto Variable", Roboto', inter: '"Inter Variable", Inter' };
export const DEFAULT_FONT: Font = "roboto";
export type StatePart = "success" | "warning" | "info" | "problem";
export type ButtonPart = "mainButton" | "otherButtons";
export type ColorPart = "brand" | "secondary" | "ink" | "process" | "standard" | ButtonPart | StatePart | "highlight" | "quiet";
/** Every colour of a look, in the order the section shows them. */
export const COLOR_PARTS: ColorPart[] = ["brand", "secondary", "ink", "process", "standard", "mainButton", "otherButtons", "success", "warning", "info", "problem", "highlight", "quiet"];
export const STATE_PARTS: StatePart[] = ["success", "warning", "info", "problem"];

export const DEFAULT_NAME = "Process Manager";
export const MAX_NAME = 40;
/** The designer's palette: primary Ocean, Sky, Snow and Midnight; secondary Sun, Earth, Grain, Land and Berry. */
export const DESIGNER = {
  ocean: "#1971ed", sky: "#66c5ff", snow: "#ffffff", midnight: "#0e0d26",
  sun: "#f3ea5d", earth: "#ff6720", grain: "#e6cda8", land: "#00b35f", berry: "#913199",
} as const;
/** The designer gave no red: problems keep a red of their own, far from Earth (warnings) and Berry (standards). */
export const PROBLEM_RED = "#be123c";
/**
 * Processes keep a teal of their own: Ocean and Berry differ almost only in hue, and people who
 * cannot tell red from green would hardly tell processes from standards (seenWithout); this teal
 * stays apart from Berry for them, from Land (success) and from the brand.
 */
export const PROCESS_TEAL = "#0f766e";
/** The colours of the default look, as the colour pickers show them. */
export const DEFAULT_COLOR: Record<ColorPart, string> = {
  brand: DESIGNER.ocean, secondary: DESIGNER.sky, ink: DESIGNER.midnight, process: PROCESS_TEAL, standard: DESIGNER.berry,
  mainButton: DESIGNER.ocean, otherButtons: DESIGNER.midnight,
  success: DESIGNER.land, warning: DESIGNER.earth, info: DESIGNER.ocean, problem: PROBLEM_RED,
  highlight: DESIGNER.sun, quiet: DESIGNER.grain,
};
/**
 * The default look as if every colour were chosen, except those that follow another (main buttons
 * and information follow the brand, other buttons the text): the token blocks of styles.css hold
 * exactly what `derive` works out for it (a unit test keeps them equal).
 */
export const DEFAULT_LOOK: Look = {
  brand: DEFAULT_COLOR.brand, secondary: DEFAULT_COLOR.secondary, ink: DEFAULT_COLOR.ink, process: DEFAULT_COLOR.process, standard: DEFAULT_COLOR.standard,
  success: DEFAULT_COLOR.success, warning: DEFAULT_COLOR.warning, problem: DEFAULT_COLOR.problem, highlight: DEFAULT_COLOR.highlight, quiet: DEFAULT_COLOR.quiet,
};
/** The name of a colour of the designer's palette ("Ocean"), or undefined. */
export function paletteName(hex: string | undefined): string | undefined {
  if (!hex) return undefined;
  const h = hex.toLowerCase();
  const hit = (Object.keys(DESIGNER) as (keyof typeof DESIGNER)[]).find((k) => DESIGNER[k] === h);
  return hit ? hit[0].toUpperCase() + hit.slice(1) : undefined;
}
export const DEFAULT_APPEARANCE: Appearance = "device";
const HEX = /^#[0-9a-f]{6}$/i;
const ICON_ID = /^[a-f0-9]{64}$/;
const SNOW = DESIGNER.snow;

/** The tints of the designer's rule: backgrounds use only these parts of Ocean (the brand) and Sky (the second colour). */
export const TINT_STEPS = [10, 35, 75, 100] as const;
/**
 * The surfaces of one theme: a colour must be readable on all of them. `raised` is what a chosen
 * segment, tab count, chip or page number stands on (--seg-on).
 */
export interface Surfaces { bg: string; surface: string; surface2: string; raised: string }
export interface Ground { light: Surfaces; dark: Surfaces; bar: readonly [string, string] }
/**
 * The ground of a look. Light: Snow surfaces on a page ground of Sky at 10 %. Dark: the ink
 * (Midnight) is the ground, its surfaces are the ink lifted with a little Snow; an ink too light to
 * carry light text is deepened first. The editing bar is the ink in both themes.
 */
export function groundOf(look: Pick<Look, "secondary" | "ink"> = {}): Ground {
  // (isHex is defined further down: this runs while the module loads)
  const sec = typeof look.secondary === "string" && HEX.test(look.secondary) ? look.secondary.toLowerCase() : DEFAULT_COLOR.secondary;
  const deep = darkGround(look.ink);
  const tint = mix(sec, SNOW, 0.1);
  return {
    light: { bg: tint, surface: SNOW, surface2: tint, raised: SNOW },
    dark: { bg: deep, surface: mix(SNOW, deep, 0.05), surface2: mix(SNOW, deep, 0.08), raised: mix(SNOW, deep, 0.12) },
    bar: [deep, mix(SNOW, deep, 0.08)],
  };
}
/** The ground of the dark look: the ink, deepened until light text reads on it at 15:1. */
function darkGround(ink: string | undefined): string {
  return readable(typeof ink === "string" && HEX.test(ink) ? ink.toLowerCase() : DEFAULT_COLOR.ink, [SNOW], 15);
}
/** The surfaces of the default look (styles.css): a colour must be readable on all of them. */
export const SURFACES: Record<Mode, Surfaces> = { light: groundOf().light, dark: groundOf().dark };
/** The editing bar of the default look, dark in both themes (edit.css): the colours of buttons and states must also read on it. */
export const BAR = groundOf().bar;
/** The two inks a filled colour can carry. */
const INK = { white: "#ffffff", black: "#11121c" } as const;

// ---------- colour arithmetic (WCAG 2.x)

type RGB = [number, number, number];
export const isHex = (s: unknown): s is string => typeof s === "string" && HEX.test(s);
export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}
/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** `t` of colour a mixed into b (0: b, 1: a), as `color-mix(in srgb, a t, b)`. */
export function mix(a: string, b: string, t: number): string {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([0, 1, 2].map((i) => p[i] * t + q[i] * (1 - t)) as RGB);
}

function toHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * The colour as close as possible to `hex` (same hue and saturation, only lighter or darker)
 * that reaches `min` contrast on every one of `backgrounds`. Light backgrounds make it darker,
 * dark ones lighter. A colour that already passes is returned as it is.
 */
export function readable(hex: string, backgrounds: readonly string[], min = 4.5): string {
  const passes = (c: string) => backgrounds.every((b) => contrast(c, b) >= min);
  if (passes(hex)) return hex.toLowerCase();
  const darker = backgrounds.reduce((n, b) => n + luminance(b), 0) / backgrounds.length > 0.18;
  const [h, s, l] = toHsl(hexToRgb(hex));
  // the lightness that passes and is nearest to the chosen one: halve the distance 24 times
  let ok = darker ? 0 : 1, bad = l;
  for (let i = 0; i < 24; i++) {
    const mid = (ok + bad) / 2;
    if (passes(rgbToHex(fromHsl(h, s, mid)))) ok = mid; else bad = mid;
  }
  // rounding to whole steps of 1/255 may fall just short: one more step in the right direction
  let out = rgbToHex(fromHsl(h, s, ok));
  for (let i = 0; i < 4 && !passes(out); i++) out = rgbToHex(fromHsl(h, s, darker ? Math.max(0, ok - (i + 1) / 255) : Math.min(1, ok + (i + 1) / 255)));
  return out;
}

/** White or near-black, whichever reads better on `hex`; pure black where even near-black falls short of 4.5:1. */
export function inkOn(hex: string): string {
  const ink = contrast(INK.white, hex) >= contrast(INK.black, hex) ? INK.white : INK.black;
  return contrast(ink, hex) < 4.5 && contrast("#000000", hex) > contrast(ink, hex) ? "#000000" : ink;
}

/** CIE76 distance between two colours (in CIELAB): below about 25 they look alike. */
export function distance(a: string, b: string): number {
  const lab = (hex: string) => {
    const lin = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const [x, y, z] = [
      (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047,
      0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2],
      (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883,
    ].map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
/** How colourful a colour is (CIELAB chroma): 0 for a grey, about 130 for the brightest red. */
export function chroma(hex: string): number {
  // the distance to the grey of the same lightness
  const l = luminance(hex);
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  const g = Math.round(v * 255);
  return distance(hex, rgbToHex([g, g, g]));
}
/** Below this chroma a colour counts as nearly grey (a slate, a navy close to black). */
export const GREY = 22;
/** How alike two colours may be (CIELAB distance) before the section warns that they will be confused. */
export const ALIKE = 25;
/** A change smaller than this (CIELAB distance) cannot be seen: it is not reported as an adjustment. */
export const VISIBLE = 4;

export type Semantic = "bad" | "warn" | "good";
/** The token (styles.css) of each state: success is --good, warning --warn, problem --bad, information --info. */
export const STATE_TOKEN: Record<StatePart, Semantic | "info"> = { success: "good", warning: "warn", info: "info", problem: "bad" };
const SEMANTIC_PART: Record<Semantic, StatePart> = { good: "success", warn: "warning", bad: "problem" };

// ---------- the derived tokens

export type Mode = "light" | "dark";
export interface ColorUse {
  part: ColorPart;
  chosen: string;
  /** The colour text, links and marks use in each theme (for the ink: the text, and the ground of the dark look). */
  used: Record<Mode, string>;
  /** The colour filled surfaces use in each theme (buttons, checked boxes, selected pills), with `ink` on top. */
  fill: Record<Mode, string>;
  /** It had to be made visibly lighter or darker to stay readable in that theme. */
  adjusted: Record<Mode, boolean>;
  /** The semantic colours it looks like, in either theme. */
  like: Semantic[];
  /** It is nearly grey: marks and links in it hardly stand out from ordinary text. */
  grey: boolean;
  /**
   * Plain sentences on what will be mistaken for what (its grey included); a brand or kind colour
   * that looks like a state is in `like`, worded by `confusion`.
   */
  warnings: string[];
}
export interface Derived {
  /** Custom properties for each theme, without the `--theme-<mode>-` prefix: only for chosen colours (all of them once the ground is chosen). */
  tokens: Record<Mode, Record<string, string>>;
  colors: ColorUse[];
  /** Processes and standards look alike in these themes. */
  kindsAlike: Mode[];
  /** People who cannot tell red from green will mistake processes for standards in these themes. */
  kindsAlikeToColourBlind: Mode[];
}

/**
 * How much of the colour goes into its soft tint and into its line, per theme. Light: the 10 %
 * step of the designer's tints. Dark (tints over Midnight): a dark ground swallows a weak tint, so
 * the brand's soft surfaces take the 35 % step; the kinds and states keep a quieter tint.
 */
const TINT = { accent: { light: 0.1, dark: 0.35 }, kind: { light: 0.1, dark: 0.16 }, state: { light: 0.1, dark: 0.16 }, line: { light: 0.4, dark: 0.32 } };
const stateTokens = (t: string) => [t, `${t}-bg`, `${t}-fill`, `${t}-ink`];
const tintTokens = (name: string) => TINT_STEPS.map((n) => `${name}-${n}`);
/** The surfaces and text of a theme, worked out from the ink and the second colour. */
const GROUND_TOKENS = ["bg", "surface", "surface-2", "seg-on", "line", "line-strong", "control-line", "text", "text-2", "text-3", "bar", "bar-2", "bar-line", "bar-text", "bar-muted", "mark-green", "mark-green-bg"];
/** Which custom properties a colour part sets. */
export const TOKENS: Record<ColorPart, string[]> = {
  brand: ["accent", "accent-fill", "accent-ink", "accent-soft", ...tintTokens("ocean")],
  secondary: [...tintTokens("sky"), "mark-sky", "mark-sky-bg"],
  ink: GROUND_TOKENS,
  process: ["kind-process", "kind-process-fill", "kind-process-ink", "kind-process-bg", "kind-process-line"],
  standard: ["kind-standard", "kind-standard-fill", "kind-standard-ink", "kind-standard-bg", "kind-standard-line"],
  mainButton: ["action-fill", "action-ink"],
  otherButtons: ["action-other", "action-other-line", "action-other-soft"],
  success: stateTokens("good"), warning: stateTokens("warn"), info: stateTokens("info"), problem: stateTokens("bad"),
  highlight: ["highlight", "highlight-ink", "search-mark"],
  quiet: ["quiet", "quiet-line", "mark-brown", "mark-brown-bg"],
};
/** Parts that follow another while not chosen (the brand, or the neutral text): the CSS says so, nothing is worked out for them. */
const FOLLOWS: ColorPart[] = ["mainButton", "otherButtons", "info"];

/**
 * One colour in one theme: the readable variant for text, the fill for filled surfaces with the
 * ink on it, the soft tint and the line. The fill keeps the chosen colour (a yellow button with
 * black ink) unless it would vanish into the surface (a navy button on the dark surface), then it
 * is the readable variant.
 */
export function deriveColor(chosen: string, mode: Mode, tint: number, also: readonly string[] = [], surfaces: Surfaces = SURFACES[mode]): { text: string; fill: string; ink: string; soft: string; line: string } {
  const s = surfaces;
  const base = [s.bg, s.surface, s.surface2, s.raised, ...also];
  let text = readable(chosen, base, TEXT_MIN);
  const fill = [s.surface, ...also].every((b) => contrast(chosen, b) >= FILL_MIN) ? chosen.toLowerCase() : text;
  // the tint of the light theme comes from the chosen colour itself (a yellow stays a pale yellow);
  // in the dark theme from the fill, since a dark colour would vanish in a dark surface
  const soft = mix(mode === "light" ? chosen : fill, s.surface, tint);
  // text in that colour also stands on its own tint (a soft button, a tag)
  for (let i = 0; i < 3 && contrast(text, soft) < TEXT_MIN; i++) text = readable(text, [...base, soft], TEXT_MIN);
  return { text, fill, ink: inkOn(fill), soft, line: mix(text, s.surface, TINT.line[mode]) };
}
/** A fill must stand this far from the surface (contrast ratio) to be kept as chosen. */
export const FILL_MIN = 1.4;
/**
 * What worked-out text aims at: 4.5:1 is the rule, the rest is a margin for what is laid over a
 * ground (a hover tint, a half-transparent pill), so that composites still pass.
 */
export const TEXT_MIN = 4.7;
/** An outline that shows where a field is: inputs, selects, text areas and chips (WCAG 1.4.11). */
export const CONTROL_MIN = 3;

/** The largest of `steps` of `color` over `ground` on which `text` still reads (4.5:1); the smallest step otherwise. */
function tintUnder(color: string, ground: string, text: string, steps: number[]): string {
  for (const t of steps) { const m = mix(color, ground, t); if (contrast(text, m) >= 4.5) return m; }
  return mix(color, ground, steps[steps.length - 1]);
}

/** The surfaces, text and editing bar of a look in both themes (the GROUND_TOKENS). */
function groundTokens(look: Look): Record<Mode, Record<string, string>> {
  const g = groundOf(look);
  const ink = isHex(look.ink) ? look.ink.toLowerCase() : DEFAULT_COLOR.ink;
  const deep = g.dark.bg;
  const brand = isHex(look.brand) ? look.brand.toLowerCase() : DEFAULT_COLOR.brand;
  // text also stands on the raised segment and on the brand's 10 % tint (a table head, the reader's own lane, a selected row)
  const L = [g.light.bg, g.light.surface, g.light.surface2, g.light.raised, mix(brand, SNOW, 0.1)];
  const D = [g.dark.bg, g.dark.surface, g.dark.surface2, g.dark.raised, mix(brand, deep, 0.1)];
  const bar = { bar: g.bar[0], "bar-2": g.bar[1], "bar-line": mix(SNOW, deep, 0.18), "bar-text": mix(SNOW, deep, 0.96), "bar-muted": readable(mix(SNOW, deep, 0.7), g.bar, TEXT_MIN) };
  const controls = (start: string, grounds: string[]) => readable(start, grounds, CONTROL_MIN);
  return {
    light: {
      bg: g.light.bg, surface: g.light.surface, "surface-2": g.light.surface2, "seg-on": g.light.raised, line: mix(ink, SNOW, 0.12), "line-strong": mix(ink, SNOW, 0.22),
      "control-line": controls(mix(ink, SNOW, 0.4), L.slice(0, 4)),
      text: readable(ink, L, 12), "text-2": readable(mix(ink, SNOW, 0.8), L, 7), "text-3": readable(mix(ink, SNOW, 0.64), L, TEXT_MIN), ...bar,
    },
    dark: {
      bg: g.dark.bg, surface: g.dark.surface, "surface-2": g.dark.surface2, "seg-on": g.dark.raised, line: mix(SNOW, deep, 0.13), "line-strong": mix(SNOW, deep, 0.22),
      "control-line": controls(mix(SNOW, deep, 0.36), D.slice(0, 4)),
      text: mix(SNOW, deep, 0.95), "text-2": readable(mix(SNOW, deep, 0.75), D, 7), "text-3": readable(mix(SNOW, deep, 0.58), D, TEXT_MIN), ...bar,
    },
  };
}
/** The designer's tints (10, 35, 75 and 100 %) of a colour: over Snow in the light look, over the dark ground in the dark one. */
function tints(name: string, color: string, ground: Ground): Record<Mode, Record<string, string>> {
  const of = (over: string) => Object.fromEntries(TINT_STEPS.map((n) => [`${name}-${n}`, mix(color, over, n / 100)]));
  return { light: of(SNOW), dark: of(ground.dark.bg) };
}
/** The highlight: the colour itself as a mark, its ink, and the search mark that text in the ordinary colour still reads on. */
function highlightTokens(color: string, ground: Ground, text: Record<Mode, string>): Record<Mode, Record<string, string>> {
  const ink = inkOn(color);
  return {
    light: { highlight: color, "highlight-ink": ink, "search-mark": tintUnder(color, SNOW, text.light, [1, 0.75, 0.35, 0.1]) },
    dark: { highlight: color, "highlight-ink": ink, "search-mark": tintUnder(color, ground.dark.bg, text.dark, [0.35, 0.25, 0.15, 0.1]) },
  };
}
/** The quiet surface: a tint the quietest text (--text-3) still reads on, and its line. */
function quietTokens(color: string, ground: Ground, text3: Record<Mode, string>): Record<Mode, Record<string, string>> {
  return {
    light: { quiet: tintUnder(color, SNOW, text3.light, [0.35, 0.2, 0.1]), "quiet-line": mix(color, SNOW, 0.75) },
    dark: { quiet: tintUnder(color, ground.dark.bg, text3.dark, [0.16, 0.1, 0.06]), "quiet-line": mix(color, ground.dark.bg, 0.35) },
  };
}

/**
 * A mark that is no state: a colour with its readable text and icon variant (`--mark-<name>`) and
 * its soft tile (`--mark-<name>-bg`) in each theme, as for the kinds. Green comes from Land, brown
 * from the quiet surface (Grain), sky from the second colour. The pictures of the paths and the
 * lanes of the map build on them, so that a mark never reads as a warning or a success.
 */
function markTokens(name: string, color: string, ground: Ground): Record<Mode, Record<string, string>> {
  // pale colours (Grain, Sky) need a stronger tile than the kinds to show at all: 20 % in both looks
  const of = (mode: Mode) => { const d = deriveColor(color, mode, 0.2, [], ground[mode]); return { [`mark-${name}`]: d.text, [`mark-${name}-bg`]: d.soft }; };
  return { light: of("light"), dark: of("dark") };
}

/** A colour as it is used in each theme: as text and as a fill. */
interface InUse { text: Record<Mode, string>; fill: Record<Mode, string> }

/** Works out every colour of a look for light and for dark. */
export function derive(look: Look): Derived {
  const tokens: Derived["tokens"] = { light: {}, dark: {} };
  const colors: ColorUse[] = [];
  const ground = groundOf(look);
  // a chosen ink or second colour changes the surfaces every colour is measured on: then every colour is worked out
  const groundChosen = isHex(look.ink) || isHex(look.secondary);
  const gt = groundTokens(look);
  const put = (part: ColorPart, t: Record<Mode, Record<string, string>>) => { void part; Object.assign(tokens.light, t.light); Object.assign(tokens.dark, t.dark); };
  if (groundChosen) { put("ink", gt); put("ink", markTokens("green", DESIGNER.land, ground)); }
  const use = {} as Record<ColorPart, InUse>;
  const add = (part: ColorPart, c: string, used: Record<Mode, string>, fill: Record<Mode, string>) => {
    use[part] = { text: used, fill };
    if (!isHex(look[part])) return;
    const adjusted = { light: distance(used.light, c) >= VISIBLE, dark: distance(used.dark, c) >= VISIBLE };
    colors.push({ part, chosen: c, used, fill, adjusted, like: [], grey: !["otherButtons", "ink", "secondary", "highlight", "quiet"].includes(part) && chroma(c) < GREY, warnings: [] });
  };
  for (const part of COLOR_PARTS) {
    const chosen = look[part];
    const own = isHex(chosen);
    const c = (own ? chosen : DEFAULT_COLOR[part]).toLowerCase();
    if (part === "ink") { add(part, c, { light: gt.light.text, dark: gt.dark.bg }, { light: gt.light.text, dark: gt.dark.bg }); continue; }
    if (part === "secondary") {
      if (own || groundChosen) { put(part, tints("sky", c, ground)); put(part, markTokens("sky", c, ground)); }
      add(part, c, { light: c, dark: c }, { light: c, dark: c });
      continue;
    }
    if (part === "highlight" || part === "quiet") {
      if (own || groundChosen) put(part, part === "highlight" ? highlightTokens(c, ground, { light: gt.light.text, dark: gt.dark.text }) : quietTokens(c, ground, { light: gt.light["text-3"], dark: gt.dark["text-3"] }));
      if (part === "quiet" && (own || groundChosen)) put(part, markTokens("brown", c, ground));
      add(part, c, { light: c, dark: c }, { light: c, dark: c });
      continue;
    }
    // a part that follows another and has no colour of its own: what it follows says how it looks (below)
    if (!own && FOLLOWS.includes(part)) continue;
    const emit = own || groundChosen;
    const used = {} as Record<Mode, string>, fill = {} as Record<Mode, string>;
    for (const mode of ["light", "dark"] as const) {
      // buttons and states also stand on the dark editing bar
      const also = mode === "dark" && !["brand", "process", "standard"].includes(part) ? ground.bar : [];
      const tint = part === "brand" || part === "otherButtons" || part === "mainButton" ? TINT.accent[mode] : part === "process" || part === "standard" ? TINT.kind[mode] : TINT.state[mode];
      const d = deriveColor(c, mode, tint, also, ground[mode]);
      // a main button is a fill: what it shows is the fill, not a text colour
      used[mode] = part === "mainButton" ? d.fill : d.text;
      fill[mode] = d.fill;
      if (!emit) continue;
      const t = tokens[mode];
      if (part === "brand") Object.assign(t, { accent: d.text, "accent-fill": d.fill, "accent-ink": d.ink, "accent-soft": d.soft });
      else if (part === "process" || part === "standard") Object.assign(t, { [`kind-${part}`]: d.text, [`kind-${part}-fill`]: d.fill, [`kind-${part}-ink`]: d.ink, [`kind-${part}-bg`]: d.soft, [`kind-${part}-line`]: d.line });
      else if (part === "mainButton") Object.assign(t, { "action-fill": d.fill, "action-ink": d.ink });
      else if (part === "otherButtons") Object.assign(t, { "action-other": d.text, "action-other-line": d.line, "action-other-soft": d.soft });
      else {
        const k = STATE_TOKEN[part as StatePart];
        Object.assign(t, { [k]: d.text, [`${k}-bg`]: d.soft, [`${k}-fill`]: d.fill, [`${k}-ink`]: d.ink });
      }
    }
    if (part === "brand" && emit) put(part, tints("ocean", c, ground));
    add(part, c, used, fill);
  }
  // what each part looks like in use, chosen or not: a main button without its own colour is in the brand colour, information too
  const eff: Record<ColorPart, InUse> = {
    ...use,
    mainButton: use.mainButton ?? { text: use.brand.fill, fill: use.brand.fill },
    info: use.info ?? use.brand,
    otherButtons: use.otherButtons ?? { text: { light: gt.light.text, dark: gt.dark.text }, fill: { light: gt.light.text, dark: gt.dark.text } },
  };
  const byPart = (p: ColorPart) => colors.find((c) => c.part === p);
  for (const c of colors) {
    if (c.part === "brand" || c.part === "process" || c.part === "standard") {
      c.like = (Object.keys(SEMANTIC_PART) as Semantic[]).filter((k) => alike(eff[c.part], eff[SEMANTIC_PART[k]]));
    }
  }
  // pairs that will be confused: the warning stands with the later of the two chosen parts. Main buttons
  // without a colour of their own are the brand colour, which says itself what it looks like.
  const needsOwn = new Set<ColorPart>();
  const pair = (a: ColorPart, b: ColorPart, text: string, test = alike) => {
    if (needsOwn.has(a) && !byPart(a)) return;
    const at = [byPart(a), byPart(b)].filter((c) => !!c).sort((x, y) => COLOR_PARTS.indexOf(y!.part) - COLOR_PARTS.indexOf(x!.part))[0];
    if (at && test(eff[a], eff[b])) at.warnings.push(text);
  };
  pair("mainButton", "problem", "Main buttons will look like buttons that delete: “Publish” and “Delete” will have nearly the same colour.");
  needsOwn.add("mainButton");
  pair("mainButton", "success", "Main buttons will look like good news: “Publish…” and “Nothing to fix” will have nearly the same colour.");
  pair("mainButton", "warning", "Main buttons will look like warnings: “Publish…” and “Review due” will have nearly the same colour.");
  needsOwn.clear();
  pair("otherButtons", "problem", "Other buttons will look like buttons that delete, which are drawn in the colour of problems.");
  pair("success", "warning", "Success and warnings will be hard to tell apart: “Published” and “Review due” will have nearly the same colour.");
  pair("warning", "problem", "Warnings and problems will be hard to tell apart: “Review due” and “Review overdue” will have nearly the same colour.");
  if (alike(eff.success, eff.problem)) pair("success", "problem", "Success and problems will be hard to tell apart: “Nothing to fix” and “1 to fix” will have nearly the same colour.");
  else pair("success", "problem", "People who cannot tell red from green will hardly see a difference between success and problems: the two colours differ almost only in their hue. The icons beside them still tell them apart; making one of the two clearly lighter or darker helps more.", alikeToColourBlind);
  pair("info", "success", "Notices that only inform will look like confirmations.");
  pair("info", "warning", "Notices that only inform will look like warnings.");
  pair("info", "problem", "Notices that only inform will look like problems.");
  pair("secondary", "highlight", "The second colour looks like the highlight: the page ground and what is selected will look like words found by a search.");
  pair("highlight", "warning", "Highlights will look like warnings: a word found by the search and “Review due” will have nearly the same colour.");
  pair("highlight", "problem", "Highlights will look like problems: a word found by the search will look like something to fix.");
  // a chosen state close to the brand or a kind left at its default (a chosen brand or kind says it itself)
  for (const state of ["success", "warning", "problem"] as const) {
    const c = byPart(state);
    if (!c) continue;
    const k = STATE_TOKEN[state] as Semantic;
    if (!look.brand && alike(eff.brand, eff[state])) c.warnings.push(`This looks like the brand colour: ${STATE_PLURAL[state]} will look like buttons and links, and will no longer stand out.`);
    for (const kind of ["process", "standard"] as const) {
      if (!look[kind] && alike(eff[kind], eff[state])) c.warnings.push(`This looks like the colour of ${kind === "process" ? "processes" : "standards"}: ${KIND_EFFECT[kind][k]}`);
    }
  }
  const ink = byPart("ink");
  if (ink && (ink.adjusted.light || ink.adjusted.dark)) ink.warnings.push(INK_TEXT);
  for (const c of colors) if (c.grey) c.warnings.push(GREY_TEXT[c.part]);
  const kindsAlike = MODES.filter((m) => distance(eff.process.text[m], eff.standard.text[m]) < ALIKE);
  const kindsAlikeToColourBlind = MODES.filter((m) => !kindsAlike.includes(m) && (["deuteranopia", "protanopia"] as const).some((k) => distance(seenWithout(eff.process.text[m], k), seenWithout(eff.standard.text[m], k)) < ALIKE));
  return { tokens, colors, kindsAlike, kindsAlikeToColourBlind };
}
/** An ink too light for text, or for the ground of the dark look. */
export const INK_TEXT = "This colour is too light to be the colour of text as it is: text is made darker in the light look, and the dark look's ground darker, so that everything stays readable.";

/** What the default look's colours are in use (styles.css), worked out once. */
let defaults: ReturnType<typeof derive> | null = null;
const defaultUse = (part: ColorPart, mode: Mode, as: "used" | "fill" = "used") => {
  defaults ??= derive(DEFAULT_LOOK);
  return defaults.colors.find((c) => c.part === part)![as][mode];
};
/** The default colours of the states, as text in each theme: what a colour must not be mistaken for. */
export const SEMANTIC: Record<Semantic, Record<Mode, string>> = {
  get bad() { return { light: defaultUse("problem", "light"), dark: defaultUse("problem", "dark") }; },
  get warn() { return { light: defaultUse("warning", "light"), dark: defaultUse("warning", "dark") }; },
  get good() { return { light: defaultUse("success", "light"), dark: defaultUse("success", "dark") }; },
};

const MODES = ["light", "dark"] as const;
/** Two colours that will be mistaken for each other in either theme, as text or as a fill. */
function alike(a: InUse, b: InUse): boolean {
  return MODES.some((m) => distance(a.text[m], b.text[m]) < ALIKE || distance(a.fill[m], b.fill[m]) < ALIKE);
}
/**
 * How a colour looks to somebody who cannot tell red from green (complete deuteranopia or
 * protanopia, after Machado, Oliveira and Fernandes 2009), in linear RGB.
 */
const COLOUR_BLIND = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
} as const;
export function seenWithout(hex: string, kind: keyof typeof COLOUR_BLIND): string {
  const lin = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const out = COLOUR_BLIND[kind].map((row) => Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
  return rgbToHex(out.map((c) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)) as RGB);
}
/** Two colours that people who cannot tell red from green will mistake for each other, as text in either theme. */
function alikeToColourBlind(a: InUse, b: InUse): boolean {
  return MODES.some((m) => (["deuteranopia", "protanopia"] as const).some((k) => distance(seenWithout(a.text[m], k), seenWithout(b.text[m], k)) < ALIKE));
}
const STATE_PLURAL: Record<StatePart, string> = { success: "confirmations", warning: "warnings", info: "notices", problem: "problems" };
const KIND_EFFECT: Record<"process" | "standard", Record<Semantic, string>> = {
  process: {
    bad: "every process will look as if something were wrong with it.",
    warn: "every process will look as if its review were due.",
    good: "processes will look like confirmations, and good news will no longer stand out.",
  },
  standard: {
    bad: "every standard will look as if something were wrong with it.",
    warn: "every standard will look as if its review were due.",
    good: "standards will look like confirmations, and good news will no longer stand out.",
  },
};
const GREY_TEXT: Record<ColorPart, string> = {
  brand: "This colour is nearly grey: buttons and what is selected hardly stand out, so links are underlined to tell them from text.",
  secondary: "", ink: "", highlight: "", quiet: "",
  process: "This colour is nearly grey: the mark of processes hardly stands out from ordinary text.",
  standard: "This colour is nearly grey: the mark of standards hardly stands out from ordinary text.",
  mainButton: "This colour is nearly grey: the main button of a view hardly stands out from the other buttons.",
  otherButtons: "",
  success: "This colour is nearly grey: confirmations hardly stand out from ordinary text.",
  warning: "This colour is nearly grey: warnings hardly stand out from ordinary text.",
  info: "This colour is nearly grey: notices hardly stand out from ordinary text.",
  problem: "This colour is nearly grey: problems hardly stand out from ordinary text.",
};

const SEMANTIC_NAME: Record<Semantic, string> = { bad: "the colour that marks problems", warn: "the colour of warnings such as “Review due”", good: "the colour of good news such as “Published”" };
/** What a brand or kind colour that looks like a state will be confused with, in plain words. */
export function confusion(part: "brand" | "process" | "standard", like: Semantic, infoFollowsBrand = false): string {
  const what = part === "brand" ? "the brand colour" : `the colour of ${part === "process" ? "processes" : "standards"}`;
  const effect = part === "brand"
    ? {
      bad: "Buttons that save or approve will look like buttons that delete, and links like error messages.",
      warn: "Buttons and links will look like warnings, and a warning will no longer stand out.",
      good: "Buttons and links will look like confirmations, and “all is well” will no longer stand out.",
    }[like]
    : KIND_EFFECT[part][like].replace(/^./, (x) => x.toUpperCase());
  // information has no colour of its own: its notices are in the brand colour too
  const notices = part === "brand" && infoFollowsBrand
    ? ` Notices that only inform are in the brand colour too: they will look like ${({ bad: "problem notices", warn: "warnings", good: "confirmations" } as const)[like]}; give Information a colour of its own under States.`
    : "";
  return `This looks like ${SEMANTIC_NAME[like]}: ${effect}${notices} You can still use ${what}.`;
}
/** How many warnings a look gets: what each colour will be mistaken for, and two kinds that look alike. */
export function warningCount(d: Derived): number {
  return d.colors.reduce((n, c) => n + c.warnings.length + (c.part === "brand" || c.part === "process" || c.part === "standard" ? c.like.length : 0), 0) + (d.kindsAlike.length ? 1 : 0) + (d.kindsAlikeToColourBlind.length ? 1 : 0);
}
/** "1 warning", "7 warnings". */
export const warningsText = (n: number) => `${n} warning${n === 1 ? "" : "s"}`;

/** The sentence for processes and standards that look alike. */
/** The sentence for processes and standards that people who cannot tell red from green will mistake for each other. */
export function kindsAlikeToColourBlindText(modes: Mode[]): string {
  const where = modes.length === 2 ? "" : modes[0] === "light" ? " in the light look" : " in the dark look";
  return `People who cannot tell red from green will hardly tell processes from standards${where}: their colours differ almost only in hue. The round and square marks still tell them apart; making one clearly lighter or darker helps more.`;
}
export function kindsAlikeText(modes: Mode[]): string {
  const where = modes.length === 2 ? "" : modes[0] === "light" ? " in the light look" : " in the dark look";
  return `Processes and standards will be hard to tell apart${where}: their marks and tags have nearly the same colour. Choose colours further apart.`;
}

/** The custom property that carries the chosen font (styles.css puts the fallbacks after it). */
export const FONT_PROPERTY = "--theme-font";
/** Every custom property the look may set on an element, chosen or not. */
export const ALL_PROPERTIES = [...(["light", "dark"] as const).flatMap((m) => Object.values(TOKENS).flat().map((t) => `--theme-${m}-${t}`)), FONT_PROPERTY];

/**
 * The custom properties of a look for an element's `style`: the chosen colours, and `initial`
 * for the parts left at their default, so that the CSS defaults apply there even inside an
 * element whose parent has another look (the preview).
 */
export function lookProperties(look: Look): Record<string, string> {
  const { tokens } = derive(look);
  const out: Record<string, string> = {};
  for (const p of ALL_PROPERTIES) out[p] = "initial";
  for (const mode of ["light", "dark"] as const) for (const [k, v] of Object.entries(tokens[mode])) out[`--theme-${mode}-${k}`] = v;
  if (look.font) out[FONT_PROPERTY] = FONT_FAMILY[look.font];
  return out;
}

/** Links are underlined when the brand colour is nearly grey: colour alone would not tell them from text. */
export const underlineLinks = (look: Look) => isHex(look.brand) && chroma(look.brand) < GREY;

// ---------- reading a look

/** Only the parts of `x` that are a valid look: what came from storage or the server. */
export function cleanLook(x: unknown): Look {
  if (!x || typeof x !== "object") return {};
  const o = x as Record<string, unknown>;
  const out: Look = {};
  if (typeof o.name === "string" && o.name.trim() && o.name.trim().length <= MAX_NAME) out.name = o.name.trim();
  if (typeof o.logo === "string" && ICON_ID.test(o.logo)) out.logo = o.logo;
  for (const p of COLOR_PARTS) if (isHex(o[p])) out[p] = (o[p] as string).toLowerCase();
  if (o.appearance === "light" || o.appearance === "dark" || o.appearance === "device") out.appearance = o.appearance;
  if (FONTS.includes(o.font as Font)) out.font = o.font as Font;
  return out;
}

/** The look as it is saved: parts equal to nothing are left out, the name trimmed. */
export function tidyLook(l: Look): Look {
  const out: Look = {};
  if (l.name?.trim()) out.name = l.name.trim();
  if (l.logo) out.logo = l.logo;
  for (const p of COLOR_PARTS) if (l[p]) out[p] = l[p]!.toLowerCase();
  if (l.appearance) out.appearance = l.appearance;
  if (l.font) out.font = l.font;
  return out;
}

/** Each colour in a sentence, as the server says it. */
export const COLOR_WHAT: Record<ColorPart, string> = {
  brand: "The brand colour", secondary: "The second colour", ink: "The ink", process: "The colour of processes", standard: "The colour of standards", mainButton: "The colour of main buttons", otherButtons: "The colour of other buttons",
  success: "The colour of success", warning: "The colour of warnings", info: "The colour of information", problem: "The colour of problems",
  highlight: "The highlight", quiet: "The quiet surface",
};

/** What is wrong with a look before it is saved, one plain sentence per problem (the server checks again). */
export function lookProblems(l: Look): string[] {
  const out: string[] = [];
  const name = l.name?.trim() ?? "";
  if (name.length > MAX_NAME) out.push(`The name is ${name.length} characters long; it can be at most ${MAX_NAME}.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) out.push("The name contains control characters. Remove them and try again.");
  if (/[‪-‮⁦-⁩]/.test(name)) out.push("The name contains characters that change the reading direction. Remove them and try again.");
  for (const p of COLOR_PARTS) {
    if (l[p] !== undefined && !isHex(l[p])) out.push(`${COLOR_WHAT[p]} must be written as # and six digits or letters a-f, e.g. #4f46e5.`);
  }
  if (l.font !== undefined && !FONTS.includes(l.font)) out.push("The font must be Inter, or the default font (Roboto).");
  return out;
}

/**
 * A colour as typed: "#0055aa", "0055AA" and the short "#05a" are all #0055aa. null: it is not
 * a colour (yet).
 */
export function normalizeHex(typed: string): string | null {
  let t = typed.trim().toLowerCase();
  if (!t.startsWith("#")) t = `#${t}`;
  if (/^#[0-9a-f]{3}$/.test(t)) t = `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  return HEX.test(t) ? t : null;
}

/** The portal's name as a look gives it. */
export const nameOf = (l: Look) => l.name?.trim() || DEFAULT_NAME;

/**
 * Ready-made sets of colours to start from: they set the brand and the two kinds only. The first is
 * the default look, the designer's (Ocean, with Berry for standards); the others are named so that
 * none can be taken for one of the designer's colours.
 */
export const PALETTES: { name: string; colors: Partial<Record<ColorPart, string>> }[] = [
  { name: "Default", colors: {} },
  { name: "Lagoon", colors: { brand: "#0369a1", process: "#0f766e", standard: "#7e22ce" } },
  { name: "Evergreen", colors: { brand: "#0f766e", process: "#1d4ed8", standard: "#a21caf" } },
  { name: "Steel", colors: { brand: "#2b4c7e", process: "#0e7490", standard: "#6d28d9" } },
  { name: "Plum", colors: { brand: "#7e22ce", process: "#0f766e", standard: "#1d4ed8" } },
];

// ---------- light or dark

/** The person's own choice from the switch in the top bar, kept as before under this key. */
export const OWN_KEY = "pm:theme";
/** The last look, so that a reload starts with it instead of the default look. */
export const LOOK_KEY = "pm:look";

/** Whether the page is dark: the person's own choice wins, then the look's appearance, then the device. */
export function isDark(own: string | null, appearance: Appearance | undefined, deviceDark: boolean): boolean {
  if (own === "dark" || own === "light") return own === "dark";
  const a = appearance ?? DEFAULT_APPEARANCE;
  return a === "dark" || (a === "device" && deviceDark);
}

// ---------- the look of this page (browser only)

interface State { look: Look; revision: number; own: string | null; deviceDark: boolean; known: boolean }
/** `known`: the look came from this browser's last visit or from the server (not merely the default). */
let state: State = { look: {}, revision: 0, own: null, deviceDark: false, known: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; apply(); listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

/** Sets the look's custom properties and light or dark on the root element. */
function apply() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const { tokens } = derive(state.look);
  for (const p of ALL_PROPERTIES) root.style.removeProperty(p);
  for (const mode of ["light", "dark"] as const) for (const [k, v] of Object.entries(tokens[mode])) root.style.setProperty(`--theme-${mode}-${k}`, v);
  if (state.look.font) root.style.setProperty(FONT_PROPERTY, FONT_FAMILY[state.look.font]);
  root.dataset.theme = isDark(state.own, state.look.appearance, state.deviceDark) ? "dark" : "light";
  root.toggleAttribute("data-link-lines", underlineLinks(state.look));
}

let started = false;
/**
 * Puts the last look and light or dark in place before the app is first drawn, then follows the
 * device's setting. Called once, when the app's script starts.
 */
export function startLook() {
  if (started || typeof window === "undefined") return;
  started = true;
  let cached: { look?: unknown; revision?: unknown } | null = null;
  try { cached = JSON.parse(read(LOOK_KEY) ?? "null"); } catch { cached = null; }
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", (e) => set({ deviceDark: e.matches }));
  set({ look: cleanLook(cached?.look), revision: typeof cached?.revision === "number" ? cached.revision : 0, own: read(OWN_KEY), deviceDark: !!media?.matches, known: !!cached });
}

/** Takes a look the server sent (or an admin just saved) into use, and keeps it for the next visit. */
export function takeLook(look: Look, revision: number) {
  const clean = cleanLook(look);
  write(LOOK_KEY, JSON.stringify({ look: clean, revision }));
  set({ look: clean, revision, known: true });
}

/**
 * Fetches the look from the server and takes it into use. Fails quietly: the last look stays.
 * Either way the look counts as known afterwards, so that nothing waits for it any longer.
 */
export async function refreshLook(): Promise<void> {
  // a new visitor waits for the look before anything is drawn: never longer than this
  const stop = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = setTimeout(() => stop?.abort(), 3000);
  try {
    const res = await fetch("/api/theme", { cache: "no-cache", signal: stop?.signal });
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.revision === "number") takeLook(data.look, data.revision);
  } catch { /* offline, too slow or an older server: keep the last look */ } finally {
    clearTimeout(timer);
    if (!state.known) set({ known: true });
  }
}

/** Forgets the person's own choice of light or dark: they see what the look sets for new visitors. */
export function forgetOwnChoice() {
  try { localStorage.removeItem(OWN_KEY); } catch { /* private mode */ }
  set({ own: null });
}

/** The person's own choice of light or dark, from the switch in the top bar. */
export function chooseDark(dark: boolean) {
  const own = dark ? "dark" : "light";
  write(OWN_KEY, own);
  set({ own });
}

/** The portal's name now (for messages written outside React). */
export const portalName = () => nameOf(state.look);
/** Where the logo is served, or null when the default mark is shown. */
export const logoUrl = (l: Look) => (l.logo ? `/api/theme/logo?v=${l.logo.slice(0, 16)}` : null);

const snapshot = () => state;
/** The look in use, its revision, and whether the page is dark. */
export function useLook(): { look: Look; revision: number; name: string; dark: boolean; own: "light" | "dark" | null; known: boolean } {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const own = s.own === "light" || s.own === "dark" ? s.own : null;
  return { look: s.look, revision: s.revision, name: nameOf(s.look), dark: isDark(s.own, s.look.appearance, s.deviceDark), own, known: s.known };
}
