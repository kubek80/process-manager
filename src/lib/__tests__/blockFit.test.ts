import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import * as flows from "../../guide/flows";
import type { Process } from "../../types";
import { BLOCK_MIN_H, BLOCK_TEXT, blockTextWidth, L, L_COMPACT } from "../layout";

// A block of the map holds, in the type scale, its kind (12/16), two lines of its title (14/20) and
// the line of tool and duration (12/16). Its height comes from that, so a title never sits on the
// line under it; what does not fit across ends in "…". Checked with the longest texts of the
// Guide's charts and of the sample processes.

const ROOT = join(__dirname, "..", "..", "..");
const css = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
const sample: Process[] = readdirSync(join(ROOT, "processes")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(ROOT, "processes", f), "utf8")));
const guide = Object.values(flows) as Process[];

/** Roboto at 14 px in Medium: 5.9 to 6.7 px a character in the sample's titles (measured in a browser); 6.8 to be safe. */
const TITLE_CHAR = 6.8;
/** How many lines a title wraps to in a width, word by word. */
function lines(text: string, width: number, char = TITLE_CHAR): number {
  let n = 1, line = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = word.length * char;
    if (line === 0) line = w;
    else if (line + char + w <= width) line += char + w;
    else { n++; line = w; }
    if (w > width) n += Math.floor(w / width);
  }
  return n;
}

describe("a block of the map", () => {
  it("is as high as what it holds, on the map and in the Guide's smaller charts", () => {
    const t = BLOCK_TEXT;
    expect(BLOCK_MIN_H).toBe(2 * t.border + t.padTop + t.kicker + t.titleGap + t.titleLines * t.titleLine + t.breath + t.meta + t.padBottom);
    expect(L.H).toBeGreaterThanOrEqual(BLOCK_MIN_H);
    expect(L_COMPACT.H).toBeGreaterThanOrEqual(BLOCK_MIN_H);
  });

  it("is drawn with the measures the layout counts with", () => {
    expect(css).toMatch(/\.block-main \{[^}]*padding: 12px 10px 9px 13px;/);
    expect(css).toMatch(/\.block \{[^}]*border: 1px solid/);
    expect(css).toMatch(/\.block-type \{[^}]*font-size: var\(--fs-sm\); line-height: var\(--lh-sm\)/);
    expect(css).toMatch(/\.block-title \{[^}]*font-size: var\(--fs-md\);[^}]*line-height: var\(--lh-md\);[^}]*-webkit-line-clamp: 2;/);
    expect(css).toMatch(/\.block-meta \{[^}]*font-size: var\(--fs-sm\); line-height: var\(--lh-sm\);[^}]*white-space: nowrap; overflow: hidden;/);
    // each part of the line of tool and duration ends in "…" when it is cut
    expect(css).toMatch(/\.block-meta > span \{[^}]*overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/);
  });

  it("holds the longest titles of the Guide's charts and of the sample in two lines", () => {
    const over: string[] = [];
    for (const [where, list, picture, W] of [["the Guide", guide, true, L_COMPACT.W], ["the sample", sample, false, L.W]] as const) {
      const room = blockTextWidth(W, picture);
      const steps = list.flatMap((p) => p.steps.filter((s) => s.type !== "decision").map((s) => ({ p: p.id, s })));
      const longest = [...steps].sort((a, b) => b.s.title.length - a.s.title.length).slice(0, 12);
      expect(longest.length).toBeGreaterThan(5);
      for (const { p, s } of longest) if (lines(s.title, room) > BLOCK_TEXT.titleLines) over.push(`${where}: ${p} › ${s.title} (${lines(s.title, room)} lines in ${room}px)`);
    }
    expect(over).toEqual([]);
  });

  it("has room across for its text beside the icon", () => {
    expect(blockTextWidth(L.W)).toBe(L.W - 2 - 13 - 10 - 34 - 10);
    expect(blockTextWidth(L_COMPACT.W, true)).toBe(L_COMPACT.W - 2 - 13 - 10 - 30 - 10);
    // the longest meta texts are wider than that: they end in "…" (see the stylesheet above), never under the block
    const metas = [...guide, ...sample].flatMap((p) => p.steps.map((s) => s.duration ?? "")).sort((a, b) => b.length - a.length);
    expect(metas[0].length * 6.2).toBeGreaterThan(blockTextWidth(L_COMPACT.W, true) / 2);
  });
});
