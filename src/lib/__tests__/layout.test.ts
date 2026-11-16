import { describe, expect, it } from "vitest";
import { L, L_COMPACT, labelWidth, layoutProcess } from "../layout";
import * as guideFlows from "../../guide/flows";
import type { Process, Step } from "../../types";
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

describe("labels on the map", () => {
  type Box = { x0: number; x1: number; y0: number; y1: number; id: string };
  const labelBoxes = (l: ReturnType<typeof layoutProcess>): Box[] => l.edges.filter((e) => e.label).map((e) => {
    const w = labelWidth(e.label!, e.lw);
    return { x0: e.lx - w / 2, x1: e.lx + w / 2, y0: e.ly - 10, y1: e.ly + 10, id: `${e.from}>${e.to}` };
  });
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const expectApart = (l: ReturnType<typeof layoutProcess>, name: string) => {
    const boxes = labelBoxes(l);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlap(boxes[i], boxes[j]), `${name}: label of ${boxes[i].id} lies on the label of ${boxes[j].id}`).toBe(0);
  };
  const step = (id: string, actor: string, next: Step["next"], type: Step["type"] = "task"): Step => ({ id, title: id, actor, type, next });
  const flow = (steps: Step[], actors = ["me", "boss"]): Process => ({ ...base(), actors: actors.map((id) => ({ id, name: id })), steps });

  it("do not lie on each other in any sample process or guide chart, in both sizes", () => {
    const all: [string, Process][] = [...processes.map((p): [string, Process] => [p.id, p]), ...Object.entries(guideFlows as Record<string, Process>), ["base", base()]];
    expect(all.some(([, p]) => p.steps.some((s) => s.next.some((n) => n.label)))).toBe(true);
    for (const [name, p] of all) {
      expectApart(layoutProcess(p), name);
      expectApart(layoutProcess(p, L_COMPACT), `${name} (compact)`);
    }
  });

  it("two decisions that lead to the same step each name their path at their own end", () => {
    // start > first? > second? > end, and both decisions also lead to "redo" below
    const p = flow([
      step("start", "me", [{ to: "first" }]),
      step("first", "me", [{ to: "second", label: "Approved" }, { to: "redo", label: "Rejected" }], "decision"),
      step("second", "me", [{ to: "end", label: "Approved" }, { to: "redo", label: "Rejected" }], "decision"),
      step("redo", "boss", [{ to: "start" }]),
      step("end", "me", []),
    ]);
    const l = layoutProcess(p);
    expectApart(l, "two decisions");
    const node = Object.fromEntries(l.nodes.map((n) => [n.step.id, n]));
    // each label sits where the path leaves its own decision: in the gap right after that block
    for (const e of l.edges.filter((x) => x.label)) {
      const from = node[e.from].x + L.W;
      expect(e.lx, `${e.from}>${e.to}`).toBeGreaterThan(from);
      expect(e.lx, `${e.from}>${e.to}`).toBeLessThan(from + L.GAPX);
      expect(Math.abs(e.ly - (node[e.from].y + L.H / 2))).toBeLessThan(L.H); // and beside it, not down at the target
    }
    const [a, b] = l.edges.filter((e) => e.to === "redo");
    expect([a.lx, a.ly]).not.toEqual([b.lx, b.ly]);
  });

  it("paths that leave one decision in the same direction get a place each", () => {
    const p = flow([
      step("ask", "me", [{ to: "a", label: "Small" }, { to: "b", label: "Medium" }, { to: "c", label: "Large" }, { to: "d", label: "Huge" }], "decision"),
      step("a", "me", []), step("b", "me", []), step("c", "boss", []), step("d", "boss", []),
    ]);
    const l = layoutProcess(p);
    expectApart(l, "fan-out");
    expect(new Set(l.edges.map((e) => `${e.lx},${e.ly}`)).size).toBe(4);
    // loops back from one decision as well
    const loops = flow([
      step("one", "me", [{ to: "two" }]), step("two", "me", [{ to: "check" }]),
      step("check", "me", [{ to: "one", label: "Start again" }, { to: "two", label: "Repeat" }, { to: "end", label: "Fine" }], "decision"),
      step("end", "me", []),
    ]);
    expectApart(layoutProcess(loops), "loops");
  });

  it("keeps long labels short on the map and off the blocks", () => {
    const long = "Rejected because the budget owner did not answer in time";
    const p = flow([
      step("ask", "me", [{ to: "yes", label: long }, { to: "no", label: `${long} again` }], "decision"),
      step("yes", "me", []), step("no", "boss", []),
    ]);
    for (const dims of [L, L_COMPACT]) {
      const l = layoutProcess(p, dims);
      expectApart(l, "long");
      for (const e of l.edges) {
        expect(e.lw).toBeLessThanOrEqual(dims.W); // never wider than a block: the full text is in the tooltip
        expect(labelWidth(e.label!, e.lw)).toBe(e.lw);
      }
      // a label may reach a few pixels over the edge of a neighbouring block, never over its content
      for (const box of labelBoxes(l))
        for (const n of l.nodes) {
          const wide = Math.min(box.x1, n.x + dims.W) - Math.max(box.x0, n.x), high = Math.min(box.y1, n.y + dims.H) - Math.max(box.y0, n.y);
          expect(wide <= 12 || high <= 0, `${box.id} covers ${n.step.id}`).toBe(true);
        }
    }
  });

  it("gives every line in a crowded gap its own place", () => {
    // eight steps in one column all lead to the same next step: eight lines turn in one gap
    const actors = ["me", "a", "b", "c", "d", "e", "f", "g"];
    const p = flow([...actors.map((a, i) => step(`s${i}`, a, [{ to: "end" }])), step("end", "me", [])], actors);
    const turns = layoutProcess(p).edges.map((e) => e.d.match(/Q([\d.]+),/)?.[1]).filter(Boolean);
    expect(turns.length).toBeGreaterThanOrEqual(6);
    expect(new Set(turns).size).toBe(turns.length);
    const xs = turns.map(Number), gapStart = L.HEADER + L.PADX + L.W;
    for (const x of xs) { expect(x).toBeGreaterThan(gapStart); expect(x).toBeLessThan(gapStart + L.GAPX); }
  });
});

