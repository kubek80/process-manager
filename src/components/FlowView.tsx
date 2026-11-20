import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Flag, Hand, Maximize2, Minus, Plus, User, Workflow, Wrench } from "lucide-react";
import type { Feedback, Process, StepType } from "../types";
import { diamondPoints, L as L_FULL, L_COMPACT, layoutProcess } from "../lib/layout";
import { LANE_COLORS, STEP_META } from "../lib/stepMeta";
import { toolName, useCatalog } from "../lib/catalog";
import { afterFit, fitWhole, hiddenEdges, isZoomWheel, laneChars, laneColumn, laneLabel, openingZoom, scrollForZoom, scrollToCentre, stepZoom, wheelZoom, wrapWords, zoomKey } from "../lib/zoom";
import { openCount } from "./Feedback";
import { EntryIcon } from "./EntryIcon";
import { scrollBehavior, TypeIcon } from "./ui";

import { QuickAdd, type InsertAt } from "./QuickAdd";
import "../detail.css";

export type { InsertAt };
interface Adding extends InsertAt { x: number; y: number }

/** Where a press on the map does not start moving it: controls, and blocks that can be dragged to another lane. */
const NO_PAN = "button:not(.block-main), a, input, select, textarea, label, .quick-add, [draggable='true']";
/** How far the pointer moves before a press becomes a drag of the map (and no longer a click). */
const PAN_START = 5;

export function FlowView({ process, selectedId, done, feedback, onSelect, onInsert, onMoveToLane, onReport, onEnter, editable = true, bare, openMin, follow = !bare, legend = true }: {
  /** Enter on a block: after selecting it (the editing screen moves the keyboard to its fields). */
  onEnter?: (id: string) => void;
  editable?: boolean; bare?: boolean;
  /** The legend of the kinds of steps. The editing screen leaves it out: every block names its kind, and the map needs the room. */
  legend?: boolean;
  /** The smallest zoom the map opens at (60%): names stay readable, a wider flow scrolls sideways. "Fit" shows the whole flow, whatever zoom that takes. */
  openMin?: number;
  /** Bring the selected step to the middle of the map whenever it changes or moves (every map but the guide's pictures). */
  follow?: boolean;
  /** Opens the report form for one step, without opening the step. */
  onReport?: (stepId: string) => void;
  process: Process; selectedId: string | null; done: Set<string>; feedback: Feedback[];
  onSelect: (id: string) => void;
  onInsert?: (at: InsertAt, spec: { title: string; type: StepType; actor: string }) => void;
  onMoveToLane?: (stepId: string, actorId: string) => void;
}) {
  const { catalog } = useCatalog();
  const L = bare ? L_COMPACT : L_FULL;
  const layout = useMemo(() => layoutProcess(process, L), [process, L]);
  // The lane names are a column of their own beside the scrolled drawing, outside it: nothing of
  // the drawing passes under it. Its text keeps its size at every zoom; the column gets narrower
  // when the drawing is small. HEADW is that column, in pixels.
  const narrow = useNarrowScreen();
  const column = (z: number) => (bare ? 136 : laneColumn(z, narrow));
  const [zoom, setZoomState] = useState(1);
  const HEADW = column(zoom);
  // the zoom as the last event left it: several wheel events can arrive before the next render
  const zoomNow = useRef(1);
  const setZoom = (z: number) => { zoomNow.current = z; setZoomState(z); };
  // where to scroll once the new zoom is on screen, so that the point under the pointer stays put
  const scrollTo = useRef<{ left: number; top: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  // Dragging the map with the mouse moves it around. Touch screens scroll it natively, in both
  // directions. A press that moved is a drag, not a click: the click that follows is swallowed.
  useEffect(() => {
    const el = scroller.current;
    if (!el || bare) return;
    let start: { x: number; y: number; left: number; top: number; id: number } | null = null;
    let moved = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const t = e.target as Element;
      if (t.closest(NO_PAN)) return;
      start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId };
      moved = false;
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < PAN_START) return;
      if (!moved) {
        moved = true;
        setPanning(true);
        try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
        window.getSelection()?.removeAllRanges();
      }
      el.scrollLeft = start.left - dx;
      el.scrollTop = start.top - dy;
      e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (!moved) return;
      setPanning(false);
      try { el.releasePointerCapture(e.pointerId); } catch { /* gone */ }
      // the click that ends a drag opens nothing
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [bare]);
  // Ctrl + scroll (Cmd on a Mac, a pinch on a trackpad) zooms around the pointer; a plain scroll
  // is left alone, so the page keeps scrolling
  useEffect(() => {
    const el = scroller.current;
    if (!el || bare) return;
    const wheel = (e: WheelEvent) => {
      if (!isZoomWheel(e)) return;
      e.preventDefault(); // not the browser's own zoom of the whole page
      const from = zoomNow.current, to = wheelZoom(from, e.deltaY, e.deltaMode);
      if (to === from) return;
      const box = el.getBoundingClientRect();
      const scroll = scrollTo.current ?? { left: el.scrollLeft, top: el.scrollTop };
      scrollTo.current = scrollForZoom(from, to, { x: e.clientX - box.left, y: e.clientY - box.top }, scroll);
      zoomNow.current = to;
      setZoomState(to);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [bare]);
  // the lane names follow the drawing up and down (they are outside its scrolling box)
  const lanesBox = useRef<HTMLDivElement>(null);
  const syncLanes = () => {
    const el = scroller.current, lanes = lanesBox.current;
    if (el && lanes) lanes.style.transform = `translateY(${-el.scrollTop}px)`;
  };
  useLayoutEffect(() => {
    const el = scroller.current, to = scrollTo.current;
    if (!el) return;
    if (to) {
      scrollTo.current = null;
      el.scrollLeft = to.left;
      el.scrollTop = to.top;
    }
    syncLanes();
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = scroller.current, lanes = lanesBox.current?.parentElement;
    if (!el) return;
    el.addEventListener("scroll", syncLanes, { passive: true });
    // a scroll over the lane names scrolls the map, as it would over the drawing
    const wheel = (e: WheelEvent) => {
      if (isZoomWheel(e) || el.scrollHeight <= el.clientHeight) return;
      const top = el.scrollTop;
      el.scrollTop += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      if (el.scrollTop !== top) e.preventDefault();
    };
    lanes?.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("scroll", syncLanes); lanes?.removeEventListener("wheel", wheel); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One rule for the editing map and the reader's map: open as large as fits the width, but not
  // below where a step's name can be read (60%); "Fit" shows the whole flow, whatever zoom that takes.
  const opening = openMin ?? 0.6;
  const drawW = layout.width - L.HEADER;
  // the lanes reach the right edge of the map also when the drawing is narrower than it
  const [scrollerW, setScrollerW] = useState(0);
  // the size of the visible map: when it changes (the step panel opens beside it, the screen
  // turns), the selected step is brought back to the middle
  const [viewSize, setViewSize] = useState("");
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { setScrollerW(el.clientWidth); setViewSize(`${el.clientWidth}x${el.clientHeight}`); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stageW = Math.max(drawW * zoom, scrollerW);
  const viewWidth = () => scroller.current?.parentElement?.clientWidth ?? 0;
  const wrapBox = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = scroller.current;
    if (!el) return;
    // the height the map can have: its own limit, and what is left of the screen below its top
    const max = parseFloat(getComputedStyle(el).maxHeight);
    const room = roomBelow(el) - el.getBoundingClientRect().top - 8;
    const limit = Number.isFinite(max) ? max : room;
    const height = room >= Math.min(limit, 240) ? Math.min(limit, room) : limit;
    const z = fitWhole({ width: viewWidth(), height }, { width: drawW, height: layout.height }, column);
    scrollTo.current = { left: 0, top: 0 };
    fitted.current = true;
    setZoom(z);
    el.scrollTo({ left: 0, top: 0 });
    // a map lower on the page is brought up so that the whole of it is on the screen
    requestAnimationFrame(() => {
      const box = wrapBox.current?.getBoundingClientRect();
      if (box && box.bottom > window.innerHeight) window.scrollBy({ top: Math.min(box.bottom - window.innerHeight + 16, box.top - 72), behavior: scrollBehavior() });
    });
  };
  // the zoom is chosen once, when the map opens (and when another process is shown in the same
  // place): never again because something around the map changed its size
  const opened = useRef<string | null>(null);
  // "Fit" is an overview on request: selecting a step or changing the process returns to the
  // zoom the map opened at (the working zoom), with the step in the middle
  const fitted = useRef(false);
  const working = useRef(1);
  const [recentre, setRecentre] = useState(0);
  const leaveFit = (event: "select" | "edit" | "zoom") => {
    if (!fitted.current) return;
    const next = afterFit({ fitted: true, zoom: zoomNow.current, working: working.current }, event);
    fitted.current = next.fitted;
    if (next.zoom !== zoomNow.current) { setZoom(next.zoom); setRecentre((n) => n + 1); }
  };
  useLayoutEffect(() => {
    if (opened.current === process.id || (opened.current !== null && editable)) return;
    opened.current = process.id;
    // a picture in the guide never scrolls: it gets as small as its column needs
    // the map uses its height: a long flow opens as large as fits it, and scrolls sideways
    const el = scroller.current;
    const room = el && !bare ? mapHeight(el) : 0;
    const z = openingZoom(viewWidth(), drawW, bare ? 0.3 : opening, column, room ? { view: room - 14, content: layout.height } : undefined);
    working.current = z;
    fitted.current = false;
    setZoom(z);
    scroller.current?.scrollTo({ left: 0, top: 0 });
  }, [process.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (selectedId) leaveFit("select"); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editable) leaveFit("edit"); }, [process]); // eslint-disable-line react-hooks/exhaustive-deps
  // the selected step is brought to the middle of the map (never the page scrolls), with room for
  // where it leads: when it is chosen and when it moves (added, reordered, another lane), and when
  // the map gets another size or zoom
  const node = follow && selectedId ? layout.nodes.find((n) => n.step.id === selectedId) : undefined;
  const nodeAt = node ? `${node.x},${node.y}` : "";
  useEffect(() => {
    const el = scroller.current;
    if (!el || !node) return;
    const frame = requestAnimationFrame(() => {
      const z = zoomNow.current;
      const box = { x: (node.x - L.HEADER) * z, y: node.y * z, w: L.W * z, h: L.H * z };
      const view = { left: el.scrollLeft, top: el.scrollTop, width: el.clientWidth, height: el.clientHeight };
      const to = scrollToCentre(box, view, { width: el.scrollWidth, height: el.scrollHeight });
      if (to) el.scrollTo({ ...to, behavior: scrollBehavior() });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, nodeAt, recentre, viewSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // where more of the flow is out of view, that edge fades out
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el || bare) return;
    const check = () => setEdges((e) => { const n = hiddenEdges(el.scrollLeft, el.scrollWidth, el.clientWidth); return n.left === e.left && n.right === e.right ? e : n; });
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", check); ro?.disconnect(); };
  }, [bare, zoom, layout.width]);

  const focus = hover ?? selectedId;
  const titleOf = (id: string) => { const i = process.steps.findIndex((s) => s.id === id); return i < 0 ? id : process.steps[i].title?.trim() || `step ${i + 1}`; };
  const Main = bare ? "div" : "button";
  const usedTypes = [...new Set(process.steps.map((s) => s.type))];
  const toolIcon = (id: string) => catalog.tools.find((t) => t.id === id)?.icon;
  const POP_W = 340, POP_H = 330;
  const openAdd = (at: InsertAt, x: number, y: number) => setAdding({
    ...at,
    x: Math.max(L.HEADER + 8, Math.min(x - POP_W / 2, layout.width - POP_W - 8)),
    y: Math.max(8, Math.min(y + 14, Math.max(8, layout.height - POP_H))),
  });
  const height = Math.max(layout.height, adding ? adding.y + POP_H + 12 : 0);

  const step = (dir: 1 | -1) => { leaveFit("zoom"); setZoom(stepZoom(zoomNow.current, dir)); };
  // the blocks are one stop for Tab: the selected one (or the first); the arrow keys go from step
  // to step in the order of their numbers, Enter opens the step
  const order = layout.nodes.map((n) => n.step.id);
  // the Tab stop follows the keyboard (a roving tabindex), until another step is selected
  const [roamed, setRoamed] = useState<string | null>(null);
  useEffect(() => { setRoamed(null); }, [selectedId]);
  const tabStop = roamed && order.includes(roamed) ? roamed : selectedId && order.includes(selectedId) ? selectedId : order[0];
  const roam = (e: React.KeyboardEvent, id: string) => {
    const at = order.indexOf(id);
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? at + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? order.length - 1 : null;
    if (to !== null) {
      e.preventDefault();
      const target = order[Math.max(0, Math.min(order.length - 1, to))];
      setRoamed(target);
      const el = scroller.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(target)}"] .block-main`);
      el?.focus({ preventScroll: true });
      // the step that has the keyboard is brought into view
      const node = layout.nodes.find((n) => n.step.id === target);
      const sc = scroller.current;
      if (node && sc) {
        const z = zoomNow.current;
        const pos = scrollToCentre({ x: (node.x - L.HEADER) * z, y: node.y * z, w: L.W * z, h: L.H * z }, { left: sc.scrollLeft, top: sc.scrollTop, width: sc.clientWidth, height: sc.clientHeight }, { width: sc.scrollWidth, height: sc.scrollHeight });
        if (pos) sc.scrollTo({ ...pos, behavior: scrollBehavior() });
      }
    } else if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      leaveFit("select");
      onSelect(id);
      onEnter(id);
    }
  };
  return (
    <div className={`flow-wrap ${bare ? "bare" : ""}`} ref={wrapBox}>
      <div className="flow-head">
        {legend && narrow && !bare ? <LegendButton types={usedTypes} /> : legend ? (
          <div className="legend" role="group" aria-label="Kinds of steps">
            {usedTypes.map((t) => (
              <span key={t} className="legend-item"><TypeIcon type={t} size={20} />{STEP_META[t].label}</span>
            ))}
            <span className="legend-item"><svg width="26" height="8" aria-hidden="true"><path d="M0,4 H26" className="edge back" /></svg>Loop back</span>
          </div>
        ) : editable && (<>
          <LegendButton types={usedTypes} />
          <p className="flow-tip" title="Press + on an arrow to insert a step there, + on a block to add one after it. Drag a block to another lane to change who does it. Drag the map by an empty spot to move it; Ctrl or ⌘ + scroll zooms.">
            <span className="kbd">+</span> on an arrow inserts a step · drag a block to another lane · <span className="flow-tip-loop"><svg width="20" height="8" aria-hidden="true"><path d="M0,4 H20" className="edge back" /></svg>loop back</span>
          </p>
        </>)}
        {!bare && <div className="map-tools">
          {legend && <span className="map-pan-hint"><Hand size={14} aria-hidden="true" />Drag to move · <kbd className="key">{zoomKey()}</kbd> + scroll to zoom</span>}
          <div className="zoom" role="group" aria-label="Zoom">
            <button className="btn small ghost" onClick={() => fit()} title="Show the whole flow"><Maximize2 size={14} />Fit</button>
            <button className="icon-btn" onClick={() => step(-1)} aria-label="Zoom out"><Minus size={16} /></button>
            <button className="zoom-val" onClick={() => setZoom(1)} aria-label={`Zoom ${Math.round(zoom * 100)}%, press for 100%`}>{Math.round(zoom * 100)}%</button>
            <button className="icon-btn" onClick={() => step(1)} aria-label="Zoom in"><Plus size={16} /></button>
          </div>
        </div>}
      </div>
      <div className={`flow-viewport ${edges.left ? "fade-left" : ""} ${edges.right ? "fade-right" : ""}`} style={{ "--head": `${HEADW}px` } as React.CSSProperties}>
        {/* the lane names, at the same size at every zoom, beside the drawing and outside its scrolling box */}
        <div className="flow-lanes" style={{ width: HEADW }}>
          <div className="flow-lanes-inner" ref={lanesBox} style={{ height: height * zoom }}>
            {layout.lanes.map((lane, k) => {
              const actor = process.actors[lane.actorIndex];
              const count = process.steps.filter((s) => s.actor === actor.id).length;
              const color = LANE_COLORS[lane.actorIndex % LANE_COLORS.length];
              const fits = laneLabel(lane.h * zoom, HEADW);
              const lines = wrapWords(actor.name, laneChars(HEADW, fits.small, fits.avatar), fits.lines);
              return (
                <div key={actor.id} className={`lane-label ${lane.actorIndex === 0 ? "me" : ""} ${k % 2 ? "even" : ""} ${fits.small ? "small" : ""}`}
                  style={{ top: lane.y * zoom, height: lane.h * zoom, "--lane": color, "--lines": fits.lines } as React.CSSProperties} title={`${actor.name}: ${count} ${count === 1 ? "step" : "steps"}`}>
                  <div className="lane-head">
                    {fits.avatar && <span className="lane-avatar">{lane.actorIndex === 0 ? <User size={16} /> : (actor.name ?? "").trim().charAt(0).toUpperCase()}</span>}
                    <div className="lane-text">
                      <strong aria-label={actor.name}>{lines.map((l, i) => <Fragment key={i}>{i > 0 && " "}<span className="lane-line" aria-hidden="true">{l}</span></Fragment>)}</strong>
                      {fits.count && <span>{count} {count === 1 ? "step" : "steps"}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      <div className={`flow-scroll ${bare ? "" : "pannable"} ${panning ? "panning" : ""}`} ref={scroller}>
        <div className="flow-stage" style={{ width: stageW, height: height * zoom }}>
          <div className="flow-draw" style={{ width: stageW, height: height * zoom }}>
        <div className={`flow-canvas ${drag ? "dragging" : ""}`} style={{ width: Math.ceil(stageW / zoom) + L.HEADER, height, zoom, marginLeft: -L.HEADER, "--z": zoom } as React.CSSProperties} onMouseDown={() => setAdding(null)}>
          {layout.lanes.map((lane) => {
            const actor = process.actors[lane.actorIndex];
            const color = LANE_COLORS[lane.actorIndex % LANE_COLORS.length];
            return (
              <div key={actor.id} className={`lane ${lane.actorIndex === 0 ? "me" : ""} ${dropLane === actor.id ? "drop" : ""}`}
                style={{ top: lane.y, height: lane.h, "--lane": color } as React.CSSProperties}
                onDragOver={(e) => { if (drag) { e.preventDefault(); setDropLane(actor.id); } }}
                onDragLeave={() => setDropLane((d) => (d === actor.id ? null : d))}
                onDrop={(e) => { e.preventDefault(); if (drag) onMoveToLane?.(drag, actor.id); setDrag(null); setDropLane(null); }} />
            );
          })}

          <svg className="flow-edges" width={layout.width} height={layout.height}>
            <defs>
              {["edge", "edge-back", "edge-hot"].map((id) => (
                <marker key={id} id={id} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M1,1 L9,5 L1,9 Z" className={`arrow ${id}`} />
                </marker>
              ))}
            </defs>
            {layout.edges.map((e) => {
              const hot = focus === e.from || focus === e.to || (adding?.afterId === e.from && adding?.beforeId === e.to);
              return (
                <path key={`${e.from}>${e.to}>${e.label ?? ""}`} d={e.d}
                  className={`edge ${e.back ? "back" : ""} ${hot ? "hot" : ""}`}
                  markerEnd={`url(#${hot ? "edge-hot" : e.back ? "edge-back" : "edge"})`} />
              );
            })}
          </svg>

          {layout.edges.filter((e) => e.label).map((e) => (
            <span key={`l${e.from}>${e.to}>${e.label}`} className={`edge-label ${focus === e.from || focus === e.to ? "hot" : ""}`}
              style={{ left: e.lx, top: e.ly, maxWidth: e.lw }} title={e.label}>{e.label}</span>
          ))}

          {editable && layout.edges.map((e) => (
            <button key={`a${e.from}>${e.to}>${e.label ?? ""}`} className="edge-add" style={{ left: e.px, top: e.py }} title="Insert a step here"
              aria-label={`Insert a step between “${titleOf(e.from)}” and “${titleOf(e.to)}”`}
              tabIndex={-1} onMouseDown={(ev) => ev.stopPropagation()} onClick={() => openAdd({ afterId: e.from, beforeId: e.to }, e.px, e.py)}><Plus size={12} strokeWidth={3} /></button>
          ))}

          {layout.nodes.map((n) => {
            const s = n.step;
            const meta = STEP_META[s.type];
            const flags = openCount(feedback, s.id);
            const decision = s.type === "decision";
            return (
              <div key={s.id} data-step={s.id} draggable={editable}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.id); setDrag(s.id); setAdding(null); }}
                onDragEnd={() => { setDrag(null); setDropLane(null); }}
                className={`block ${n.lane === 0 ? "mine" : ""} ${selectedId === s.id ? "selected" : ""} ${done.has(s.id) ? "done" : ""} ${s.type === "decision" ? "decision" : ""} ${drag === s.id ? "dragged" : ""}`}
                style={{ left: n.x, top: n.y, width: L.W, height: L.H, "--c": meta.color } as React.CSSProperties}
                onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
                {/* a decision is a diamond whose corners are where the arrows meet it */}
                {decision && (
                  <svg className="diamond" width={L.W} height={L.H} viewBox={`0 0 ${L.W} ${L.H}`} aria-hidden="true">
                    <polygon className="diamond-ring" points={diamondPoints(L.W, L.H, -3)} />
                    <polygon className="diamond-shape" points={diamondPoints(L.W, L.H, 1)} />
                  </svg>
                )}
                {/* in the guide a chart is a picture: nothing to open, so nothing to tab through */}
                <Main className="block-main" {...(bare ? {} : {
                  onClick: () => { leaveFit("select"); onSelect(s.id); }, tabIndex: tabStop === s.id ? 0 : -1, onKeyDown: (e: React.KeyboardEvent) => roam(e, s.id),
                  "aria-label": `${n.index + 1}. ${s.title || "(no name yet)"}, ${meta.label}${process.actors[n.lane] ? `, by ${process.actors[n.lane].name}` : ""}`,
                })}>
                  {!decision && <TypeIcon type={s.type} size={bare ? 30 : 34} />}
                  <span className="block-text">
                    <span className="block-type">{meta.label}</span>
                    <span className={`block-title ${s.title?.trim() ? "" : "unnamed"}`.trim()}>{s.title?.trim() ? s.title : "(no name yet)"}</span>
                    <span className="block-meta">
                      {s.tool && <span>{toolIcon(s.tool) ? <EntryIcon icon={toolIcon(s.tool)} size={12} /> : <Wrench size={11} />}{toolName(catalog, s.tool)}</span>}
                      {s.duration && <span><Clock size={11} />{s.duration}</span>}
                      {s.subProcessId && !s.tool && <span><Workflow size={11} />opens a sub-process</span>}
                    </span>
                  </span>
                </Main>
                <span className="block-num">{done.has(s.id) ? <Check size={12} strokeWidth={3} /> : n.index + 1}</span>
                {(flags > 0 || (!bare && onReport)) && (
                  <span className="block-corner">
                    {!bare && onReport && (
                      <button type="button" className="block-report" draggable={false} title="Report a problem with this step" tabIndex={tabStop === s.id ? 0 : -1}
                        aria-label={`Report a problem with step ${n.index + 1}: ${s.title}`}
                        onMouseDown={(ev) => ev.stopPropagation()} onDragStart={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
                        onClick={(ev) => { ev.stopPropagation(); onReport(s.id); }}><Flag size={12} strokeWidth={2.5} /></button>
                    )}
                    {flags > 0 && <span className="block-flag" title={`${flags} open feedback`}><Flag size={10} strokeWidth={3} />{flags}</span>}
                  </span>
                )}
                {editable && <button className="block-add" title={s.type === "decision" ? "Add a branch" : "Add a step after this one"}
                  aria-label={s.type === "decision" ? `Add a branch to “${titleOf(s.id)}”` : `Add a step after “${titleOf(s.id)}”`}
                  tabIndex={-1} onMouseDown={(ev) => ev.stopPropagation()} onClick={() => openAdd({ afterId: s.id }, n.x + L.W, n.y + L.H / 2)}><Plus size={14} /></button>}
              </div>
            );
          })}

          {adding && (
            <QuickAdd process={process} at={adding} style={{ left: adding.x, top: adding.y }} onClose={() => setAdding(null)}
              onAdd={(spec) => { onInsert?.({ afterId: adding.afterId, beforeId: adding.beforeId }, spec); setAdding(null); }} />
          )}
        </div>
          </div>
        </div>
      </div>
      </div>

    </div>
  );
}

/** The kinds of steps on the editing map, behind a small button: every block names its kind, so the legend is only there to look up. */
function LegendButton({ types }: { types: StepType[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="legend-box" ref={box}>
      <button className="btn small ghost" aria-expanded={open} onClick={() => setOpen(!open)}>Legend</button>
      {open && (
        <div className="legend legend-pop" role="group" aria-label="Kinds of steps">
          {types.map((t) => <span key={t} className="legend-item"><TypeIcon type={t} size={20} />{STEP_META[t].label}</span>)}
          <span className="legend-item"><svg width="26" height="8" aria-hidden="true"><path d="M0,4 H26" className="edge back" /></svg>Loop back</span>
        </div>
      )}
    </div>
  );
}

/** The height the map can have: its own limit (the reader's map), else the height its column gives it (the editing map). */
function mapHeight(el: HTMLElement): number {
  const max = parseFloat(getComputedStyle(el).maxHeight);
  return Number.isFinite(max) ? max : el.clientHeight;
}

/** Where the room for the map ends: the bottom of the screen, or of the column that scrolls it, inside its padding. */
function roomBelow(el: HTMLElement): number {
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const st = getComputedStyle(p);
    if (/(auto|scroll)/.test(st.overflowY) && p.scrollHeight >= p.clientHeight) {
      bottom = Math.min(bottom, p.getBoundingClientRect().bottom - parseFloat(st.paddingBottom || "0") - parseFloat(st.borderBottomWidth || "0"));
      break;
    }
  }
  return bottom;
}

/** A phone: the lane names get a narrower column. */
function useNarrowScreen() {
  const query = "(max-width: 600px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}
