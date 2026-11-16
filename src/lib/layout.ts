import type { Process, Step } from "../types";

export const L = { W: 208, H: 94, GAPX: 64, GAPY: 30, PADY: 26, PADX: 44, HEADER: 172 };
/** Tighter measures for the small charts in the guide. */
export const L_COMPACT: typeof L = { W: 188, H: 88, GAPX: 44, GAPY: 26, PADY: 22, PADX: 32, HEADER: 136 };

export interface NodeBox { step: Step; index: number; lane: number; col: number; sub: number; x: number; y: number }
export interface LaneBox { actorIndex: number; y: number; h: number }
/** `lx`,`ly` is the centre of the label and `lw` the widest it may be drawn; `px`,`py` is where the "insert a step" button goes. */
export interface EdgePath { from: string; to: string; label?: string; d: string; back: boolean; lx: number; ly: number; lw: number; px: number; py: number }
export interface Layout { nodes: NodeBox[]; lanes: LaneBox[]; edges: EdgePath[]; width: number; height: number }

type Pt = [number, number];
type Dims = typeof L;
const DEFAULT = L;

function roundedPath(pts: Pt[], r = 12): string {
  const p = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0] || q[1] !== pts[i - 1][1]);
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [px, py] = p[i - 1], [cx, cy] = p[i], [nx, ny] = p[i + 1];
    const r1 = Math.min(r, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx + Math.sign(px - cx) * r1, ay = cy + Math.sign(py - cy) * r1;
    const bx = cx + Math.sign(nx - cx) * r1, by = cy + Math.sign(ny - cy) * r1;
    d += ` L${ax},${ay} Q${cx},${cy} ${bx},${by}`;
  }
  const last = p[p.length - 1];
  return d + ` L${last[0]},${last[1]}`;
}

/** Middle of the longest segment: where the "insert a step here" button goes. */
function midPoint(pts: Pt[]): Pt {
  let best = -1, at: Pt = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    if (len > best) { best = len; at = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2]; }
  }
  return at;
}

/** How wide a label is drawn, near enough to keep labels apart (11.5px semi-bold text in a pill). */
export const labelWidth = (text: string, max: number) => Math.min(max, 20 + text.length * 6.6);
const LABEL_H = 20;

/** Swim-lane layout: lanes are rows (one per actor), time flows left to right. */
export function layoutProcess(p: Process, L: Dims = DEFAULT): Layout {
  const steps = p.steps;
  const idx = new Map(steps.map((s, i) => [s.id, i]));
  const laneOf = new Map(p.actors.map((a, i) => [a.id, i]));

  // 1. classify back edges (loops) with a DFS so that ranking only uses forward edges
  const state = new Array<number>(steps.length).fill(0);
  const back = new Set<string>();
  const dfs = (i: number) => {
    state[i] = 1;
    for (const n of steps[i].next) {
      const j = idx.get(n.to);
      if (j === undefined) continue;
      if (state[j] === 1) back.add(`${i}>${j}`);
      else if (state[j] === 0) dfs(j);
    }
    state[i] = 2;
  };
  steps.forEach((_, i) => state[i] === 0 && dfs(i));

  // 2. column = longest forward path from a start
  const col = new Array<number>(steps.length).fill(0);
  const indeg = new Array<number>(steps.length).fill(0);
  const fwd: number[][] = steps.map(() => []);
  steps.forEach((s, i) => s.next.forEach((n) => {
    const j = idx.get(n.to);
    if (j !== undefined && j !== i && !back.has(`${i}>${j}`)) { fwd[i].push(j); indeg[j]++; }
  }));
  const queue = steps.map((_, i) => i).filter((i) => indeg[i] === 0);
  while (queue.length) {
    const i = queue.shift()!;
    for (const j of fwd[i]) {
      col[j] = Math.max(col[j], col[i] + 1);
      if (--indeg[j] === 0) queue.push(j);
    }
  }

  // 3. stack steps that share lane + column
  const slot = new Map<string, number>();
  const laneRows = p.actors.map(() => 1);
  const pre = steps.map((s, i) => {
    const lane = laneOf.get(s.actor) ?? 0;
    const key = `${lane}:${col[i]}`;
    const sub = slot.get(key) ?? 0;
    slot.set(key, sub + 1);
    laneRows[lane] = Math.max(laneRows[lane], sub + 1);
    return { lane, sub };
  });

  const lanes: LaneBox[] = [];
  let y = 0;
  laneRows.forEach((rows, actorIndex) => {
    const h = L.PADY * 2 + rows * L.H + (rows - 1) * L.GAPY;
    lanes.push({ actorIndex, y, h });
    y += h;
  });

  const colX = (c: number) => L.HEADER + L.PADX + c * (L.W + L.GAPX);
  const nodes: NodeBox[] = steps.map((step, i) => ({
    step, index: i, lane: pre[i].lane, col: col[i], sub: pre[i].sub,
    x: colX(col[i]),
    y: lanes[pre[i].lane].y + L.PADY + pre[i].sub * (L.H + L.GAPY),
  }));
  const maxCol = Math.max(0, ...col);

  // 4. orthogonal edge routing through the free gaps between columns and rows
  const occupied = new Set(nodes.map((n) => `${n.lane}:${n.sub}:${n.col}`));
  const rowClear = (n: NodeBox, from: number, to: number) => {
    for (let c = from + 1; c < to; c++) if (occupied.has(`${n.lane}:${n.sub}:${c}`)) return false;
    return true;
  };
  const gapSlots = new Map<number, Map<string, number>>();
  const OFFS = [0, -12, 12, -24, 24];
  const gapX = (gapCol: number, owner: string) => {
    let m = gapSlots.get(gapCol);
    if (!m) gapSlots.set(gapCol, (m = new Map()));
    if (!m.has(owner)) m.set(owner, m.size);
    const k = m.get(owner)!, n = m.size;
    // up to five lines keep the familiar places; more are spread evenly so that no two share one
    const off = n <= OFFS.length ? OFFS[k] : (k / (n - 1) - 0.5) * (L.GAPX - 12);
    return colX(gapCol) + L.W + L.GAPX / 2 + off;
  };
  let channelUse = 0;

  // Where a label may go, nearest to its own source first. A label is named where the path leaves
  // its decision, so two decisions that lead to the same step never put their labels on one spot.
  interface Plan { edge: number; text: string; max: number; spots: Pt[]; span: number }
  const OFF = Math.min(15, L.PADY - LABEL_H / 2 - 1); // from the edge of a block to the middle of a label between two rows
  const rowTops = lanes.flatMap((lane, i) => Array.from({ length: laneRows[i] }, (_, r) => lane.y + L.PADY + r * (L.H + L.GAPY)));
  const maxInRow = L.GAPX + 20, maxBetweenRows = L.W / 2 + L.GAPX / 2 - 6;
  /** Along a vertical run from the source row: just outside the source's row, then just past every row it crosses. */
  const runSpots = (x: number, s: NodeBox, toY: number): Pt[] => {
    const sy = s.y + L.H / 2, down = toY > sy;
    const first: Pt = [x, down ? s.y + L.H + OFF : s.y - OFF];
    const crossed = rowTops.filter((t) => (down ? t > s.y && t + L.H / 2 < toY : t < s.y && t + L.H / 2 > toY)).sort((a, b) => (down ? a - b : b - a));
    return [first, ...crossed.map((t): Pt => [x, down ? t + L.H + OFF : t - OFF])];
  };
  const plans: Plan[] = [];

  const edges: EdgePath[] = [];
  // two passes: the first only counts the lines in each gap, so that the second can space them
  const route = (final: boolean) => nodes.forEach((s) => s.step.next.forEach((n) => {
    const j = idx.get(n.to);
    if (j === undefined || j === s.index) return;
    const t = nodes[j];
    const sy = s.y + L.H / 2, ty = t.y + L.H / 2;
    const sr = s.x + L.W, tl = t.x;
    const isBack = t.col <= s.col;
    let pts: Pt[];
    if (isBack) {
      const cy = s.y + L.H + 9 + (channelUse++ % 3) * 5;
      const x2 = gapX(t.col - 1, "in:" + t.step.id);
      pts = [[s.x + L.W / 2, s.y + L.H], [s.x + L.W / 2, cy], [x2, cy], [x2, ty], [tl, ty]];
    } else if (t.col === s.col + 1) {
      const mx = gapX(s.col, "out:" + s.step.id);
      pts = sy === ty ? [[sr, sy], [tl, ty]] : [[sr, sy], [mx, sy], [mx, ty], [tl, ty]];
    } else if (rowClear(s, s.col, t.col)) {
      const mx = gapX(t.col - 1, "in:" + t.step.id);
      pts = sy === ty ? [[sr, sy], [tl, ty]] : [[sr, sy], [mx, sy], [mx, ty], [tl, ty]];
    } else if (rowClear(t, s.col, t.col)) {
      const mx = gapX(s.col, "out:" + s.step.id);
      pts = [[sr, sy], [mx, sy], [mx, ty], [tl, ty]];
    } else {
      const x1 = gapX(s.col, "out:" + s.step.id);
      const x2 = gapX(t.col - 1, "in:" + t.step.id);
      const cy = s.y + L.H + 9 + (channelUse++ % 3) * 5;
      pts = [[sr, sy], [x1, sy], [x1, cy], [x2, cy], [x2, ty], [tl, ty]];
    }
    if (!final) return;
    const [px, py] = midPoint(pts);
    if (n.label) {
      const second = pts[1];
      let spots: Pt[], max = maxBetweenRows;
      if (isBack) spots = [[s.x + L.W / 2, s.y + L.H + OFF]]; // under the block, where the loop sets off
      else if (second[1] === sy && second[0] - sr >= L.GAPX) { spots = [[sr + L.GAPX / 2, sy - 16]]; max = maxInRow; } // runs along the row: above the line, in the first gap
      else spots = runSpots(second[0], s, pts[2][1]); // turns up or down in the gap: beside that turn, between the rows
      plans.push({ edge: edges.length, text: n.label, max, spots, span: Math.abs(pts[Math.min(2, pts.length - 1)][1] - sy) });
    }
    edges.push({ from: s.step.id, to: t.step.id, label: n.label, d: roundedPath(pts), back: isBack, lx: px, ly: py, lw: maxBetweenRows, px, py });
  }));
  route(false);
  channelUse = 0;
  route(true);

  const width = colX(maxCol) + L.W + L.PADX;
  placeLabels(plans, edges, { left: L.HEADER + 4, right: width - 4, top: 2, bottom: y - 2 });
  return { nodes, lanes, edges, width, height: y };
}

/**
 * Gives every label a place of its own: the shorter path takes the spot nearest the source, a longer
 * one that would land on it moves on along its own line, and labels that still touch are moved apart
 * sideways, each staying beside its own line. Also moves the "insert" button off a label.
 */
function placeLabels(plans: { edge: number; text: string; max: number; spots: Pt[]; span: number }[], edges: EdgePath[], box: { left: number; right: number; top: number; bottom: number }) {
  interface Placed { edge: number; x: number; y: number; w: number }
  const GAP = 4;
  const hit = (a: { x: number; y: number; w: number }, b: Placed) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + GAP && Math.abs(a.y - b.y) < LABEL_H + GAP;
  const placed: Placed[] = [];
  for (const p of [...plans].sort((a, b) => a.span - b.span)) {
    const w = labelWidth(p.text, p.max);
    const free = p.spots.find(([x, y]) => !placed.some((q) => hit({ x, y, w }, q))) ?? p.spots[0];
    placed.push({ edge: p.edge, x: free[0], y: free[1], w });
    edges[p.edge].lw = p.max;
  }
  // what still overlaps is pushed apart sideways, half each way
  for (let round = 0; round < 8; round++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (!hit(a, b)) continue;
      const [l, r] = a.x < b.x || (a.x === b.x && a.edge < b.edge) ? [a, b] : [b, a];
      const push = ((l.w + r.w) / 2 + GAP - (r.x - l.x)) / 2 + 0.5;
      l.x -= push; r.x += push; moved = true;
    }
    if (!moved) break;
  }
  for (const q of placed) {
    const e = edges[q.edge];
    e.lx = Math.round(Math.max(box.left + q.w / 2, Math.min(box.right - q.w / 2, q.x)));
    e.ly = Math.round(Math.max(box.top + LABEL_H / 2, Math.min(box.bottom - LABEL_H / 2, q.y)));
    if (Math.abs(e.px - e.lx) < q.w / 2 + 12 && Math.abs(e.py - e.ly) < LABEL_H / 2 + 4) e.py += e.py >= e.ly ? 20 : -20; // keep the button clear of the label
  }
}
