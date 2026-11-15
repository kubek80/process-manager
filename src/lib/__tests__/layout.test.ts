import { describe, expect, it } from "vitest";
import { L, L_COMPACT, layoutProcess } from "../layout";
import { base, processes } from "./fixtures";

const byId = (l: ReturnType<typeof layoutProcess>) => Object.fromEntries(l.nodes.map((n) => [n.step.id, n]));

describe("swim-lane layout", () => {
  const l = layoutProcess(base());
  const n = byId(l);

  it("puts each step in the lane of its actor, with my lane first", () => {
    expect(l.lanes).toHaveLength(2);
    expect(l.lanes[0].y).toBe(0);
    expect([n.ask.lane, n.fix.lane, n.done.lane]).toEqual([0, 0, 0]);
    expect([n.approve.lane, n.ok.lane]).toEqual([1, 1]);
    for (const node of l.nodes) {
      const lane = l.lanes[node.lane];
      expect(node.y).toBeGreaterThanOrEqual(lane.y);
      expect(node.y + L.H).toBeLessThanOrEqual(lane.y + lane.h);
    }
  });

  it("orders columns by the longest path and ignores loops for ranking", () => {
    expect([n.ask.col, n.approve.col, n.ok.col, n.fix.col, n.done.col]).toEqual([0, 1, 2, 3, 3]);
  });

  it("stacks steps that share a lane and a column", () => {
    expect(n.fix.sub).not.toBe(n.done.sub);
    expect(n.fix.x).toBe(n.done.x);
    expect(Math.abs(n.fix.y - n.done.y)).toBe(L.H + L.GAPY);
  });

  it("never overlaps two blocks", () => {
    for (const p of [base(), ...processes]) {
      const nodes = layoutProcess(p).nodes;
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const apart = a.x + L.W <= b.x || b.x + L.W <= a.x || a.y + L.H <= b.y || b.y + L.H <= a.y;
          expect(apart, `${p.id}: ${a.step.id} overlaps ${b.step.id}`).toBe(true);
        }
    }
  });

  it("draws one arrow per link, marks loops, and keeps everything on the canvas", () => {
    expect(l.edges).toHaveLength(5);
    expect(l.edges.filter((e) => e.back).map((e) => `${e.from}>${e.to}`)).toEqual(["fix>approve"]);
    expect(l.edges.find((e) => e.from === "ok" && e.to === "fix")!.label).toBe("No");
    for (const e of l.edges) {
      expect(e.d).toMatch(/^M[\d.]+,[\d.]+ /);
      for (const [x, y] of [[e.lx, e.ly], [e.px, e.py]]) {
        expect(x).toBeGreaterThan(L.HEADER);
        expect(x).toBeLessThan(l.width);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(l.height);
      }
    }
    for (const node of l.nodes) expect(node.x + L.W).toBeLessThanOrEqual(l.width);
    expect(l.height).toBe(l.lanes.reduce((h, lane) => h + lane.h, 0));
  });

  it("ignores links to steps that do not exist and survives an unknown actor", () => {
    const p = base();
    p.steps[0].next.push({ to: "ghost" });
    p.steps[1].actor = "nobody";
    const out = layoutProcess(p);
    expect(out.edges).toHaveLength(5);
    expect(byId(out).approve.lane).toBe(0);
  });

  it("handles a single step and parallel paths", () => {
    const one = layoutProcess({ ...base(), steps: [{ id: "only", title: "Only", actor: "me", type: "task", next: [] }] });
    expect(one.nodes).toHaveLength(1);
    expect(one.edges).toHaveLength(0);
    const akamai = layoutProcess(processes.find((p) => p.id === "onboard-site-to-akamai")!);
    const a = byId(akamai);
    expect(a["create-property"].col).toBe(a["define-waf-policy"].col);
    expect(a["test-on-staging"].col).toBe(a["create-property"].col + 1);
  });

  it("uses the compact measures when asked", () => {
    const small = layoutProcess(base(), L_COMPACT);
    expect(small.width).toBeLessThan(l.width);
    expect(small.nodes[0].x).toBe(L_COMPACT.HEADER + L_COMPACT.PADX);
  });
});
