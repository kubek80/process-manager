// The look of the portal (Admin > Theming): its name, logo, brand colour, the colours of the two
// kinds, of the buttons and of the states (success, warning, information, problem), the font and
// the appearance for people who have not chosen light or dark themselves.
//
// The server keeps only what the admin chose. Everything else is worked out here, for light and
// for dark: the readable variant of each colour on the surfaces of that theme (text at least
// 4.5:1 per WCAG, which also covers large marks and borders at 3:1), the ink on top of it, its
// soft tint and its line colour. They are set as CSS custom properties on the root element
// (`--theme-light-…`, `--theme-dark-…`); the token blocks in styles.css and lists.css read them,
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
  appearance?: Appearance;
  /** The font (default: Inter, the portal's own). */
  font?: Font;
}
export type Font = "roboto";
export const FONTS: Font[] = ["roboto"];
/** What the font custom property is set to for each font: the chosen family, then the fallbacks of styles.css follow. */
export const FONT_FAMILY: Record<Font, string> = { roboto: '"Roboto Variable", Roboto' };
export type StatePart = "success" | "warning" | "info" | "problem";
export type ButtonPart = "mainButton" | "otherButtons";
export type ColorPart = "brand" | "process" | "standard" | ButtonPart | StatePart;
/** Every colour of a look, in the order the section shows them. */
export const COLOR_PARTS: ColorPart[] = ["brand", "process", "standard", "mainButton", "otherButtons", "success", "warning", "info", "problem"];
export const STATE_PARTS: StatePart[] = ["success", "warning", "info", "problem"];

export const DEFAULT_NAME = "Process Manager";
export const MAX_NAME = 40;
/** The colours of the default look, as the colour pickers show them. */
export const DEFAULT_COLOR: Record<ColorPart, string> = {
  brand: "#4f46e5", process: "#0f766e", standard: "#6d28d9", mainButton: "#4f46e5", otherButtons: "#171a26",
  success: "#15803d", warning: "#b45309", info: "#4f46e5", problem: "#be123c",
};
export const DEFAULT_APPEARANCE: Appearance = "device";
const HEX = /^#[0-9a-f]{6}$/i;
const ICON_ID = /^[a-f0-9]{64}$/;

/** The surfaces of each theme (styles.css): a colour must be readable on all of them. */
export const SURFACES = {
  light: { bg: "#f4f5f9", surface: "#ffffff", surface2: "#f8f9fc" },
  dark: { bg: "#0f1118", surface: "#181b25", surface2: "#1e222e" },
} as const;
/** The editing bar, dark in both themes (edit.css): the colours of buttons and states must also read on it. */
export const BAR = ["#1c1d22", "#24262d"] as const;
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

/** The default colours of the states (styles.css), as text in each theme: what a colour must not be mistaken for. */
export const SEMANTIC = {
  bad: { light: "#be123c", dark: "#fb7185" },
  warn: { light: "#b45309", dark: "#fbbf24" },
  good: { light: "#15803d", dark: "#4ade80" },
} as const;
export type Semantic = keyof typeof SEMANTIC;
/** The token (styles.css) of each state: success is --good, warning --warn, problem --bad, information --info. */
export const STATE_TOKEN: Record<StatePart, Semantic | "info"> = { success: "good", warning: "warn", info: "info", problem: "bad" };
const SEMANTIC_PART: Record<Semantic, StatePart> = { good: "success", warn: "warning", bad: "problem" };
/** The default colours of the kinds in each theme (lists.css): what an unchosen kind looks like. */
const KIND_DEFAULT = { process: { light: "#0f766e", dark: "#5eead4" }, standard: { light: "#6d28d9", dark: "#c4b5fd" } } as const;

// ---------- the derived tokens

export type Mode = "light" | "dark";
export interface ColorUse {
  part: ColorPart;
  chosen: string;
  /** The colour text, links and marks use in each theme. */
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
  /** Custom properties for each theme, without the `--theme-<mode>-` prefix: only for chosen colours. */
  tokens: Record<Mode, Record<string, string>>;
  colors: ColorUse[];
  /** Processes and standards look alike in these themes. */
  kindsAlike: Mode[];
}

/** How much of the colour goes into its soft tint and into its line, per theme. */
const TINT = { accent: { light: 0.1, dark: 0.18 }, kind: { light: 0.12, dark: 0.16 }, state: { light: 0.1, dark: 0.16 }, line: { light: 0.4, dark: 0.32 } };
const stateTokens = (t: string) => [t, `${t}-bg`, `${t}-fill`, `${t}-ink`];
/** Which custom properties a colour part sets. */
export const TOKENS: Record<ColorPart, string[]> = {
  brand: ["accent", "accent-fill", "accent-ink", "accent-soft"],
  process: ["kind-process", "kind-process-fill", "kind-process-ink", "kind-process-bg", "kind-process-line"],
  standard: ["kind-standard", "kind-standard-fill", "kind-standard-ink", "kind-standard-bg", "kind-standard-line"],
  mainButton: ["action-fill", "action-ink"],
  otherButtons: ["action-other", "action-other-line", "action-other-soft"],
  success: stateTokens("good"), warning: stateTokens("warn"), info: stateTokens("info"), problem: stateTokens("bad"),
};

/**
 * One colour in one theme: the readable variant for text, the fill for filled surfaces with the
 * ink on it, the soft tint and the line. The fill keeps the chosen colour (a yellow button with
 * black ink) unless it would vanish into the surface (a navy button on the dark surface), then it
 * is the readable variant.
 */
export function deriveColor(chosen: string, mode: Mode, tint: number, also: readonly string[] = []): { text: string; fill: string; ink: string; soft: string; line: string } {
  const s = SURFACES[mode];
  const base = [s.bg, s.surface, s.surface2, ...also];
  let text = readable(chosen, base);
  // the tint of the light theme comes from the chosen colour itself (a yellow stays a pale yellow);
  // in the dark theme from the readable one, since a dark colour would vanish in a dark surface
  let soft = mix(mode === "light" ? chosen : text, s.surface, tint);
  // text in that colour also stands on its own tint (a soft button, a tag)
  for (let i = 0; i < 3 && contrast(text, soft) < 4.5; i++) {
    text = readable(text, [...base, soft]);
    if (mode === "dark") soft = mix(text, s.surface, tint);
  }
  const fill = [s.surface, ...also].every((b) => contrast(chosen, b) >= FILL_MIN) ? chosen.toLowerCase() : text;
  return { text, fill, ink: inkOn(fill), soft, line: mix(text, s.surface, TINT.line[mode]) };
}
/** A fill must stand this far from the surface (contrast ratio) to be kept as chosen. */
export const FILL_MIN = 1.4;

/** Works out every colour of a look for light and for dark. */
export function derive(look: Look): Derived {
  const tokens: Derived["tokens"] = { light: {}, dark: {} };
  const colors: ColorUse[] = [];
  for (const part of COLOR_PARTS) {
    const chosen = look[part];
    if (!isHex(chosen)) continue;
    const c = chosen.toLowerCase();
    const used = {} as Record<Mode, string>, fill = {} as Record<Mode, string>, adjusted = {} as Record<Mode, boolean>;
    for (const mode of ["light", "dark"] as const) {
      // buttons and states also stand on the dark editing bar
      const also = mode === "dark" && !["brand", "process", "standard"].includes(part) ? BAR : [];
      const tint = part === "brand" || part === "otherButtons" || part === "mainButton" ? TINT.accent[mode] : part === "process" || part === "standard" ? TINT.kind[mode] : TINT.state[mode];
      const d = deriveColor(c, mode, tint, also);
      // a main button is a fill: what it shows is the fill, not a text colour
      used[mode] = part === "mainButton" ? d.fill : d.text;
      fill[mode] = d.fill;
      adjusted[mode] = distance(used[mode], c) >= VISIBLE;
      const t = tokens[mode];
      if (part === "brand") Object.assign(t, { accent: d.text, "accent-fill": d.fill, "accent-ink": d.ink, "accent-soft": d.soft });
      else if (part === "process" || part === "standard") Object.assign(t, { [`kind-${part}`]: d.text, [`kind-${part}-fill`]: d.fill, [`kind-${part}-ink`]: d.ink, [`kind-${part}-bg`]: d.soft, [`kind-${part}-line`]: d.line });
      else if (part === "mainButton") Object.assign(t, { "action-fill": d.fill, "action-ink": d.ink });
      else if (part === "otherButtons") Object.assign(t, { "action-other": d.text, "action-other-line": d.line, "action-other-soft": d.soft });
      else {
        const k = STATE_TOKEN[part];
        Object.assign(t, { [k]: d.text, [`${k}-bg`]: d.soft, [`${k}-fill`]: d.fill, [`${k}-ink`]: d.ink });
      }
    }
    colors.push({ part, chosen: c, used, fill, adjusted, like: [], grey: part !== "otherButtons" && chroma(c) < GREY, warnings: [] });
  }
  // what each part looks like in use, chosen or not
  const eff = effective(look, colors);
  const byPart = (p: ColorPart) => colors.find((c) => c.part === p);
  for (const c of colors) {
    if (c.part === "brand" || c.part === "process" || c.part === "standard") {
      c.like = (Object.keys(SEMANTIC) as Semantic[]).filter((k) => {
        const state = SEMANTIC_PART[k];
        return (!look[state] && distance(c.chosen, SEMANTIC[k].light) < ALIKE) || alike(eff[c.part], eff[state]);
      });
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
  for (const c of colors) if (c.grey) c.warnings.push(GREY_TEXT[c.part]);
  const kindsAlike = (["light", "dark"] as const).filter((m) => distance(eff.process.text[m], eff.standard.text[m]) < ALIKE);
  return { tokens, colors, kindsAlike };
}

/** A colour as it is used in each theme: as text and as a fill. */
interface InUse { text: Record<Mode, string>; fill: Record<Mode, string> }
const both = (light: string, dark: string): InUse => ({ text: { light, dark }, fill: { light, dark } });
/** The defaults of the look (styles.css, lists.css) where nothing was chosen. */
const DEFAULT_USE: Record<"brand" | "process" | "standard" | Semantic, InUse> = {
  brand: both("#4f46e5", "#8b8cf8"), process: both(KIND_DEFAULT.process.light, KIND_DEFAULT.process.dark), standard: both(KIND_DEFAULT.standard.light, KIND_DEFAULT.standard.dark),
  good: both(SEMANTIC.good.light, SEMANTIC.good.dark), warn: both(SEMANTIC.warn.light, SEMANTIC.warn.dark), bad: both(SEMANTIC.bad.light, SEMANTIC.bad.dark),
};
function effective(look: Look, colors: ColorUse[]): Record<ColorPart, InUse> {
  const of = (p: ColorPart): InUse | undefined => { const c = colors.find((x) => x.part === p); return c && { text: c.used, fill: c.fill }; };
  const brand = of("brand") ?? DEFAULT_USE.brand;
  return {
    brand, process: of("process") ?? DEFAULT_USE.process, standard: of("standard") ?? DEFAULT_USE.standard,
    // a main button without its own colour is in the brand colour; information too
    mainButton: of("mainButton") ?? { text: brand.fill, fill: brand.fill }, info: of("info") ?? brand,
    otherButtons: of("otherButtons") ?? both("#171a26", "#eceef5"),
    success: of("success") ?? DEFAULT_USE.good, warning: of("warning") ?? DEFAULT_USE.warn, problem: of("problem") ?? DEFAULT_USE.bad,
  };
}
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
export function confusion(part: "brand" | "process" | "standard", like: Semantic): string {
  const what = part === "brand" ? "the brand colour" : `the colour of ${part === "process" ? "processes" : "standards"}`;
  const effect = part === "brand"
    ? {
      bad: "Buttons that save or approve will look like buttons that delete, and links like error messages.",
      warn: "Buttons and links will look like warnings, and a warning will no longer stand out.",
      good: "Buttons and links will look like confirmations, and “all is well” will no longer stand out.",
    }[like]
    : KIND_EFFECT[part][like].replace(/^./, (x) => x.toUpperCase());
  return `This looks like ${SEMANTIC_NAME[like]}: ${effect} You can still use ${what}.`;
}
/** How many warnings a look gets: what each colour will be mistaken for, and two kinds that look alike. */
export function warningCount(d: Derived): number {
  return d.colors.reduce((n, c) => n + c.warnings.length + (c.part === "brand" || c.part === "process" || c.part === "standard" ? c.like.length : 0), 0) + (d.kindsAlike.length ? 1 : 0);
}
/** "1 warning", "7 warnings". */
export const warningsText = (n: number) => `${n} warning${n === 1 ? "" : "s"}`;

/** The sentence for processes and standards that look alike. */
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
  brand: "The brand colour", process: "The colour of processes", standard: "The colour of standards", mainButton: "The colour of main buttons", otherButtons: "The colour of other buttons",
  success: "The colour of success", warning: "The colour of warnings", info: "The colour of information", problem: "The colour of problems",
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
  if (l.font !== undefined && !FONTS.includes(l.font)) out.push("The font must be Roboto, or the default font.");
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

/** Ready-made sets of colours to start from. The first is the default look. */
export const PALETTES: { name: string; colors: Partial<Record<ColorPart, string>> }[] = [
  { name: "Default", colors: {} },
  { name: "Ocean", colors: { brand: "#0369a1", process: "#0f766e", standard: "#7e22ce" } },
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
