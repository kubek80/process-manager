import { describe, expect, it } from "vitest";
import { iconContentType, iconFileProblem, ICON_RULES } from "../icons";

describe("choosing an icon", () => {
  it("says the rules before anything is chosen", () => {
    expect(ICON_RULES).toBe("PNG, JPEG, WebP or SVG. Square, at most 64 KB.");
  });
  it("takes PNG, JPEG, WebP and SVG up to 64 KB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]) expect(iconFileProblem({ type, size: 1000 })).toBe("");
    expect(iconFileProblem({ type: "image/png", size: 64 * 1024 })).toBe("");
  });
  it("refuses other kinds, larger files and empty files in plain words", () => {
    expect(iconFileProblem({ type: "image/gif", size: 10 })).toMatch(/not a PNG, JPEG, WebP or SVG/);
    expect(iconFileProblem({ type: "image/png", size: 64 * 1024 + 1 })).toMatch(/is 65 KB.*at most 64 KB/);
    expect(iconFileProblem({ type: "image/png", size: 0 })).toBe("This file is empty.");
  });
  it("recognises an .svg file the browser did not type", () => {
    expect(iconFileProblem({ type: "", size: 10, name: "Logo.SVG" })).toBe("");
    expect(iconContentType({ type: "", name: "logo.svg" })).toBe("image/svg+xml");
    expect(iconContentType({ type: "image/png", name: "a.png" })).toBe("image/png");
  });
});
