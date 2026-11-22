import { describe, expect, it, vi } from "vitest";
import { watchFonts, type FontSetLike } from "../media";

function fontSet(status: string) {
  let resolve!: () => void;
  const listeners = new Set<() => void>();
  const set: FontSetLike = {
    status,
    ready: new Promise<void>((r) => { resolve = r; }),
    addEventListener: (_t, f) => { listeners.add(f); },
    removeEventListener: (_t, f) => { listeners.delete(f); },
  };
  return { set, arrive: () => resolve(), later: () => listeners.forEach((f) => f()), listeners };
}

describe("measuring text again once fonts arrive", () => {
  it("measures again when the fonts that were loading have arrived", async () => {
    const f = fontSet("loading"), loaded = vi.fn();
    watchFonts(f.set, loaded);
    expect(loaded).not.toHaveBeenCalled();
    f.arrive();
    await Promise.resolve(); await Promise.resolve();
    expect(loaded).toHaveBeenCalledTimes(1);
  });
  it("does nothing more when every font had arrived already (no jump on the default font)", async () => {
    const f = fontSet("loaded"), loaded = vi.fn();
    watchFonts(f.set, loaded);
    f.arrive();
    await Promise.resolve(); await Promise.resolve();
    expect(loaded).not.toHaveBeenCalled();
  });
  it("measures again for a font that arrives later, and stops when asked", () => {
    const f = fontSet("loaded"), loaded = vi.fn();
    const stop = watchFonts(f.set, loaded);
    f.later();
    expect(loaded).toHaveBeenCalledTimes(1);
    stop();
    expect(f.listeners.size).toBe(0);
    f.later();
    expect(loaded).toHaveBeenCalledTimes(1);
  });
  it("works where the browser has no fonts to watch", () => {
    expect(() => watchFonts(undefined, () => {})()).not.toThrow();
  });
});
