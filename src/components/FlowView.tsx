import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Flag, Hand, Maximize2, Minus, MousePointerClick, Plus, User, Workflow, Wrench } from "lucide-react";
import type { Feedback, Process, StepType } from "../types";
import { diamondPoints, L as L_FULL, L_COMPACT, layoutProcess } from "../lib/layout";
import { LANE_COLORS, STEP_META } from "../lib/stepMeta";
import { toolName, useCatalog } from "../lib/catalog";
import { openCount } from "./Feedback";
import { TypeIcon } from "./ui";

import { QuickAdd, type InsertAt } from "./QuickAdd";
import "../detail.css";

export type { InsertAt };
interface Adding extends InsertAt { x: number; y: number }

/** Where a press on the map does not start moving it: controls, and blocks that can be dragged to another lane. */
const NO_PAN = "button:not(.block-main), a, input, select, textarea, label, .quick-add, [draggable='true']";
/** How far the pointer moves before a press becomes a drag of the map (and no longer a click). */
const PAN_START = 5;

export function FlowView({ process, selectedId, done, feedback, onSelect, onInsert, onMoveToLane, onReport, hint, editable = true, bare }: {
  editable?: boolean; bare?: boolean;
  /** Opens the report form for one step, without opening the step. */
  onReport?: (stepId: string) => void;
  /** Shows the line that says a step can be opened. */
  hint?: boolean;
  process: Process; selectedId: string | null; done: Set<string>; feedback: Feedback[];
  onSelect: (id: string) => void;
  onInsert?: (at: InsertAt, spec: { title: string; type: StepType; actor: string }) => void;
  onMoveToLane?: (stepId: string, actorId: string) => void;
}) {
  const { catalog } = useCatalog();
  const L = bare ? L_COMPACT : L_FULL;
  const layout = useMemo(() => layoutProcess(process, L), [process, L]);
  const [zoom, setZoom] = useState(1);
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
  const fit = () => {
    const w = scroller.current?.clientWidth ?? 0;
    if (w) setZoom(Math.max(bare ? 0.6 : 0.75, Math.min(1, Math.floor((w / layout.width) * 20) / 20)));
  };
  // open zoomed to fit the width (never below 75%, where text stops being readable)
  useLayoutEffect(fit, [process.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const focus = hover ?? selectedId;
  const titleOf = (id: string) => process.steps.find((s) => s.id === id)?.title ?? id;
  const Main = bare ? "div" : "button";
  const usedTypes = [...new Set(process.steps.map((s) => s.type))];
  const POP_W = 340, POP_H = 330;
  const openAdd = (at: InsertAt, x: number, y: number) => setAdding({
    ...at,
    x: Math.max(L.HEADER + 8, Math.min(x - POP_W / 2, layout.width - POP_W - 8)),
    y: Math.max(8, Math.min(y + 14, Math.max(8, layout.height - POP_H))),
  });
  const height = Math.max(layout.height, adding ? adding.y + POP_H + 12 : 0);

  return (
    <div className={`flow-wrap ${bare ? "bare" : ""}`}>
      {!bare && hint && (
        <p className="map-hint"><MousePointerClick size={15} aria-hidden="true" /><span><b>Select a step</b> to see what to do, who does it and with which tool.</span>
          <span className="map-hint-pan"><Hand size={14} aria-hidden="true" />Drag the map to move around.</span></p>
      )}
      <div className={`flow-scroll ${bare ? "" : "pannable"} ${panning ? "panning" : ""}`} ref={scroller}>
        <div className={`flow-canvas ${drag ? "dragging" : ""}`} style={{ width: layout.width, height, zoom }} onMouseDown={() => setAdding(null)}>
          {layout.lanes.map((lane) => {
            const actor = process.actors[lane.actorIndex];
            const count = process.steps.filter((s) => s.actor === actor.id).length;
            const color = LANE_COLORS[lane.actorIndex % LANE_COLORS.length];
            return (
              <div key={actor.id} className={`lane ${lane.actorIndex === 0 ? "me" : ""} ${dropLane === actor.id ? "drop" : ""}`}
                style={{ top: lane.y, height: lane.h, "--lane": color } as React.CSSProperties}
                onDragOver={(e) => { if (drag) { e.preventDefault(); setDropLane(actor.id); } }}
                onDragLeave={() => setDropLane((d) => (d === actor.id ? null : d))}
                onDrop={(e) => { e.preventDefault(); if (drag) onMoveToLane?.(drag, actor.id); setDrag(null); setDropLane(null); }}>
                <div className="lane-head" style={{ width: L.HEADER }}>
                  <span className="lane-avatar">{lane.actorIndex === 0 ? <User size={16} /> : actor.name.slice(0, 1).toUpperCase()}</span>
                  <div className="lane-text">
                    <strong>{actor.name}</strong>
                    <span>{count} {count === 1 ? "step" : "steps"}</span>
                  </div>
                </div>
              </div>
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
                <path key={`${e.from}>${e.to}`} d={e.d}
                  className={`edge ${e.back ? "back" : ""} ${hot ? "hot" : ""}`}
                  markerEnd={`url(#${hot ? "edge-hot" : e.back ? "edge-back" : "edge"})`} />
              );
            })}
          </svg>

          {layout.edges.filter((e) => e.label).map((e) => (
            <span key={`l${e.from}>${e.to}`} className={`edge-label ${focus === e.from || focus === e.to ? "hot" : ""}`}
              style={{ left: e.lx, top: e.ly, maxWidth: e.lw }} title={e.label}>{e.label}</span>
          ))}

          {editable && layout.edges.map((e) => (
            <button key={`a${e.from}>${e.to}`} className="edge-add" style={{ left: e.px, top: e.py }} title="Insert a step here"
              aria-label={`Insert a step between “${titleOf(e.from)}” and “${titleOf(e.to)}”`}
              onMouseDown={(ev) => ev.stopPropagation()} onClick={() => openAdd({ afterId: e.from, beforeId: e.to }, e.px, e.py)}><Plus size={12} strokeWidth={3} /></button>
          ))}

          {layout.nodes.map((n) => {
            const s = n.step;
            const meta = STEP_META[s.type];
            const flags = openCount(feedback, s.id);
            const decision = s.type === "decision";
            return (
              <div key={s.id} draggable={editable}
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
                <Main className="block-main" {...(bare ? {} : { onClick: () => onSelect(s.id) })}>
                  {!decision && <TypeIcon type={s.type} size={bare ? 30 : 34} />}
                  <span className="block-text">
                    <span className="block-type">{meta.label}</span>
                    <span className="block-title">{s.title}</span>
                    <span className="block-meta">
                      {s.tool && <span><Wrench size={11} />{toolName(catalog, s.tool)}</span>}
                      {s.duration && <span><Clock size={11} />{s.duration}</span>}
                      {s.subProcessId && !s.tool && <span><Workflow size={11} />opens a sub-process</span>}
                    </span>
                  </span>
                </Main>
                <span className="block-num">{done.has(s.id) ? <Check size={12} strokeWidth={3} /> : n.index + 1}</span>
                {(flags > 0 || (!bare && onReport)) && (
                  <span className="block-corner">
                    {!bare && onReport && (
                      <button type="button" className="block-report" draggable={false} title="Report a problem with this step"
                        aria-label={`Report a problem with step ${n.index + 1}: ${s.title}`}
                        onMouseDown={(ev) => ev.stopPropagation()} onDragStart={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
                        onClick={(ev) => { ev.stopPropagation(); onReport(s.id); }}><Flag size={12} strokeWidth={2.5} /></button>
                    )}
                    {flags > 0 && <span className="block-flag" title={`${flags} open feedback`}><Flag size={10} strokeWidth={3} />{flags}</span>}
                  </span>
                )}
                {editable && <button className="block-add" title={s.type === "decision" ? "Add a branch" : "Add a step after this one"}
                  aria-label={s.type === "decision" ? `Add a branch to “${s.title}”` : `Add a step after “${s.title}”`}
                  onMouseDown={(ev) => ev.stopPropagation()} onClick={() => openAdd({ afterId: s.id }, n.x + L.W, n.y + L.H / 2)}><Plus size={14} /></button>}
              </div>
            );
          })}

          {adding && (
            <QuickAdd process={process} at={adding} style={{ left: adding.x, top: adding.y }} onClose={() => setAdding(null)}
              onAdd={(spec) => { onInsert?.({ afterId: adding.afterId, beforeId: adding.beforeId }, spec); setAdding(null); }} />
          )}
        </div>
      </div>

      <div className="flow-foot">
        <div className="legend">
          {usedTypes.map((t) => (
            <span key={t} className="legend-item"><TypeIcon type={t} size={20} />{STEP_META[t].label}</span>
          ))}
          <span className="legend-item"><svg width="26" height="8"><path d="M0,4 H26" className="edge back" /></svg>Loop back</span>
        </div>
        {!bare && <div className="zoom">
          <button className="btn small ghost" onClick={fit}><Maximize2 size={14} />Fit</button>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label="Zoom out"><Minus size={16} /></button>
          <button className="zoom-val" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))} aria-label="Zoom in"><Plus size={16} /></button>
        </div>}
      </div>
      {editable && <p className="flow-hint"><b>Edit on the map:</b> press <span className="kbd">+</span> on an arrow to insert a step there · <span className="kbd">+</span> on a block to add one after it · drag a block to another lane to change who does it · click a block for details.</p>}
    </div>
  );
}
