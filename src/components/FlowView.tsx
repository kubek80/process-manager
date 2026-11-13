import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Flag, Maximize2, Minus, Plus, User, Workflow, Wrench } from "lucide-react";
import type { Feedback, Process, StepType } from "../types";
import { L as L_FULL, L_COMPACT, layoutProcess } from "../lib/layout";
import { LANE_COLORS, STEP_META } from "../lib/stepMeta";
import { toolName, useCatalog } from "../lib/catalog";
import { openCount } from "./Feedback";
import { TypeIcon } from "./ui";

import { QuickAdd, type InsertAt } from "./QuickAdd";

export type { InsertAt };
interface Adding extends InsertAt { x: number; y: number }

export function FlowView({ process, selectedId, done, feedback, onSelect, onInsert, onMoveToLane, editable = true, bare }: {
  editable?: boolean; bare?: boolean;
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
  const fit = () => {
    const w = scroller.current?.clientWidth ?? 0;
    if (w) setZoom(Math.max(bare ? 0.6 : 0.75, Math.min(1, Math.floor((w / layout.width) * 20) / 20)));
  };
  // open zoomed to fit the width (never below 75%, where text stops being readable)
  useLayoutEffect(fit, [process.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const focus = hover ?? selectedId;
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
      <div className="flow-scroll" ref={scroller}>
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
              style={{ left: e.lx, top: e.ly }}>{e.label}</span>
          ))}

          {editable && layout.edges.map((e) => (
            <button key={`a${e.from}>${e.to}`} className="edge-add" style={{ left: e.px, top: e.py }} title="Insert a step here"
              onMouseDown={(ev) => ev.stopPropagation()} onClick={() => openAdd({ afterId: e.from, beforeId: e.to }, e.px, e.py)}><Plus size={12} strokeWidth={3} /></button>
          ))}

          {layout.nodes.map((n) => {
            const s = n.step;
            const meta = STEP_META[s.type];
            const flags = openCount(feedback, s.id);
            return (
              <div key={s.id} draggable={editable}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.id); setDrag(s.id); setAdding(null); }}
                onDragEnd={() => { setDrag(null); setDropLane(null); }}
                className={`block ${n.lane === 0 ? "mine" : ""} ${selectedId === s.id ? "selected" : ""} ${done.has(s.id) ? "done" : ""} ${s.type === "decision" ? "decision" : ""} ${drag === s.id ? "dragged" : ""}`}
                style={{ left: n.x, top: n.y, width: L.W, height: L.H, "--c": meta.color } as React.CSSProperties}
                onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
                <button className="block-main" onClick={() => onSelect(s.id)}>
                  <TypeIcon type={s.type} size={bare ? 30 : 34} />
                  <span className="block-text">
                    <span className="block-type">{meta.label}</span>
                    <span className="block-title">{s.title}</span>
                    <span className="block-meta">
                      {s.tool && <span><Wrench size={11} />{toolName(catalog, s.tool)}</span>}
                      {s.duration && <span><Clock size={11} />{s.duration}</span>}
                      {s.subProcessId && !s.tool && <span><Workflow size={11} />opens a sub-process</span>}
                    </span>
                  </span>
                </button>
                <span className="block-num">{done.has(s.id) ? <Check size={12} strokeWidth={3} /> : n.index + 1}</span>
                {flags > 0 && <span className="block-flag" title={`${flags} open feedback`}><Flag size={10} strokeWidth={3} />{flags}</span>}
                {editable && <button className="block-add" title={s.type === "decision" ? "Add a branch" : "Add a step after this one"}
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
