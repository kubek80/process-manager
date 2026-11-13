import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Maximize2, Minus, Plus, User, Workflow, Wrench } from "lucide-react";
import type { Process } from "../types";
import { L, layoutProcess } from "../lib/layout";
import { LANE_COLORS, STEP_META } from "../lib/stepMeta";
import { TypeIcon } from "./ui";

export function FlowView({ process, selectedId, done, onSelect, onAddAfter }: {
  process: Process; selectedId: string | null; done: Set<string>;
  onSelect: (id: string) => void; onAddAfter: (id: string) => void;
}) {
  const layout = useMemo(() => layoutProcess(process), [process]);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const fit = () => {
    const w = scroller.current?.clientWidth ?? 0;
    if (w) setZoom(Math.max(0.75, Math.min(1, Math.floor((w / layout.width) * 20) / 20)));
  };
  // open zoomed to fit the width (never below 75%, where text stops being readable)
  useLayoutEffect(fit, [process.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selectedId;
  const usedTypes = [...new Set(process.steps.map((s) => s.type))];

  return (
    <div className="flow-wrap">
      <div className="flow-scroll" ref={scroller}>
        <div className="flow-canvas" style={{ width: layout.width, height: layout.height, zoom }}>
          {layout.lanes.map((lane) => {
            const actor = process.actors[lane.actorIndex];
            const count = process.steps.filter((s) => s.actor === actor.id).length;
            const color = LANE_COLORS[lane.actorIndex % LANE_COLORS.length];
            return (
              <div key={actor.id} className={`lane ${lane.actorIndex === 0 ? "me" : ""}`}
                style={{ top: lane.y, height: lane.h, "--lane": color } as React.CSSProperties}>
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
              const hot = focus === e.from || focus === e.to;
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

          {layout.nodes.map((n) => {
            const s = n.step;
            const meta = STEP_META[s.type];
            return (
              <div key={s.id}
                className={`block ${n.lane === 0 ? "mine" : ""} ${selectedId === s.id ? "selected" : ""} ${done.has(s.id) ? "done" : ""} ${s.type === "decision" ? "decision" : ""}`}
                style={{ left: n.x, top: n.y, width: L.W, height: L.H, "--c": meta.color } as React.CSSProperties}
                onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
                <button className="block-main" onClick={() => onSelect(s.id)}>
                  <TypeIcon type={s.type} size={34} />
                  <span className="block-text">
                    <span className="block-type">{meta.label}</span>
                    <span className="block-title">{s.title}</span>
                    <span className="block-meta">
                      {s.tool && <span><Wrench size={11} />{s.tool}</span>}
                      {s.duration && <span><Clock size={11} />{s.duration}</span>}
                      {s.subProcessId && !s.tool && <span><Workflow size={11} />opens a sub-process</span>}
                    </span>
                  </span>
                </button>
                <span className="block-num">{done.has(s.id) ? <Check size={12} strokeWidth={3} /> : n.index + 1}</span>
                <button className="block-add" title="Add a step after this one" onClick={() => onAddAfter(s.id)}><Plus size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flow-foot">
        <div className="legend">
          {usedTypes.map((t) => (
            <span key={t} className="legend-item"><TypeIcon type={t} size={20} />{STEP_META[t].label}</span>
          ))}
          <span className="legend-item"><svg width="26" height="8"><path d="M0,4 H26" className="edge back" /></svg>Loop back</span>
        </div>
        <div className="zoom">
          <button className="btn small ghost" onClick={fit}><Maximize2 size={14} />Fit</button>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} aria-label="Zoom out"><Minus size={16} /></button>
          <button className="zoom-val" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="icon-btn" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))} aria-label="Zoom in"><Plus size={16} /></button>
        </div>
      </div>
    </div>
  );
}
