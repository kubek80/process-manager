import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// The designer's type scale: body text in three sizes (--fs-sm 12/16, --fs-md 14/20, --fs-lg 16/24)
// and three weights (--fw-regular 400, --fw-medium 500, --fw-strong 700), italic for emphasis;
// headings in the steps --fs-h4 … --fs-display, never in the regular weight. Every stylesheet of
// the app keeps to it; print.css sets paper in points and is left out.

const SRC = join(__dirname, "..", "..");
const sheets = readdirSync(SRC).filter((f) => f.endsWith(".css") && f !== "print.css");
const BODY = ["sm", "md", "lg"], HEADING = ["h4", "h3", "h2", "h1", "display"];
const sizeOk = /^var\(--fs-(sm|md|lg|h4|h3|h2|h1|display)(, *\d+px)?\)$/;
const weightOk = /^var\(--fw-(regular|medium|strong)(, *\d{3})?\)$/;

/** Every rule of a stylesheet: its selector and its declarations, comments left out. */
function rules(css: string): { selector: string; decls: [string, string][] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; decls: [string, string][] }[] = [];
  for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const decls = m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/\s*!important$/, "")] as [string, string];
    });
    out.push({ selector: m[1].trim(), decls });
  }
  return out;
}

describe("the type scale", () => {
  it("is defined once, with the designer's sizes, line heights and weights", () => {
    const css = readFileSync(join(SRC, "styles.css"), "utf8");
    for (const t of ["--fs-lg: 16px; --lh-lg: 24px", "--fs-md: 14px; --lh-md: 20px", "--fs-sm: 12px; --lh-sm: 16px", "--fw-regular: 400; --fw-medium: 500; --fw-strong: 700"]) expect(css).toContain(t);
    expect(css).toMatch(/--font-family: var\(--theme-font, "Roboto Variable", Roboto\), Helvetica, Arial, sans-serif;/);
  });

  it("every font size and weight in every stylesheet is one of its tokens", () => {
    const wrong: string[] = [];
    expect(sheets.length).toBeGreaterThan(10);
    for (const f of sheets) {
      for (const { selector, decls } of rules(readFileSync(join(SRC, f), "utf8"))) {
        for (const [prop, value] of decls) {
          const at = `${f}: ${selector.split("\n").pop()} { ${prop}: ${value} }`;
          if (prop === "font-size" && !sizeOk.test(value) && value !== "inherit" && value !== "0") wrong.push(at);
          if (prop === "font-weight" && !weightOk.test(value) && value !== "inherit") wrong.push(at);
          // the shorthand: no size or weight written as a number
          if (prop === "font" && value !== "inherit" && (/\d+(\.\d+)?(px|pt|em|rem)\b/.test(value.replace(/var\([^)]*\)/g, "")) || /(^|\s)\d{3}(\s|$)/.test(value.replace(/var\([^)]*\)/g, "")))) wrong.push(at);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every line height is the one of its size: no normal, no multiplier, no length of its own", () => {
    // a single-line badge (a count, a kind tag, a key) takes its size's line height too; its box is set by its height
    const lhOk = /^var\(--lh-(sm|md|lg|h4|h3|h2|h1|display)(, *\d+px)?\)$/;
    const wrong: string[] = [];
    for (const f of sheets) {
      for (const { selector, decls } of rules(readFileSync(join(SRC, f), "utf8"))) {
        for (const [prop, value] of decls) {
          if (prop === "line-height" && !lhOk.test(value) && value !== "inherit" && value !== "0") wrong.push(`${f}: ${selector.split("\n").pop()} { line-height: ${value} }`);
          if (prop === "font" && value.includes("/") && !/\/var\(--lh-/.test(value)) wrong.push(`${f}: ${selector.split("\n").pop()} { font: ${value} }`);
        }
        const size = decls.find(([p]) => p === "font-size")?.[1] ?? "";
        const lh = decls.find(([p]) => p === "line-height")?.[1] ?? "";
        const step = /^var\(--fs-([a-z0-9]+)/.exec(size)?.[1];
        if (step && lh.startsWith("var(--lh-") && !lh.startsWith(`var(--lh-${step}`)) wrong.push(`${f}: ${selector} (${size} with ${lh})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("headings are told apart by their sizes and never take the regular weight", () => {
    const wrong: string[] = [];
    for (const f of sheets) {
      for (const { selector, decls } of rules(readFileSync(join(SRC, f), "utf8"))) {
        const size = decls.find(([p]) => p === "font-size")?.[1] ?? "";
        const weight = decls.find(([p]) => p === "font-weight")?.[1] ?? "";
        if (HEADING.some((h) => size.startsWith(`var(--fs-${h}`)) && weight.startsWith("var(--fw-regular")) wrong.push(`${f}: ${selector}`);
        // a body size keeps its own line height when the rule sets one from the scale
        const lh = decls.find(([p]) => p === "line-height")?.[1] ?? "";
        const body = BODY.find((b) => size.startsWith(`var(--fs-${b}`));
        if (body && lh.startsWith("var(--lh-") && !lh.startsWith(`var(--lh-${body}`)) wrong.push(`${f}: ${selector} (${size} with ${lh})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("no text is set in a size or weight of its own in the components either", () => {
    const dir = join(SRC, "components");
    const wrong = readdirSync(dir).filter((f) => f.endsWith(".tsx")).flatMap((f) =>
      [...readFileSync(join(dir, f), "utf8").matchAll(/font(Size|Weight)\s*:\s*["']?([^,}"']+)/g)]
        .filter((m) => !/^var\(--f[sw]-/.test(m[2].trim()))
        .map((m) => `${f}: ${m[0]}`));
    expect(wrong).toEqual([]);
  });
});
