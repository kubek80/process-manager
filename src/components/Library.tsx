import { useMemo, useState } from "react";
import { ArrowRight, CircleAlert, Clock, Plus, Search, Sparkles, Users } from "lucide-react";
import type { Process } from "../types";
import { hasErrors, validateProcess } from "../lib/validate";
import { go } from "../lib/store";
import { TypeIcon } from "./ui";

const CAT_COLORS = ["#4f46e5", "#0d9488", "#d97706", "#db2777", "#0284c7", "#7c3aed"];

export function Library({ processes, broken, onNew, onAi }: {
  processes: Process[]; broken: { file: string; error: string }[]; onNew: () => void; onAi: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const ids = useMemo(() => processes.map((p) => p.id), [processes]);
  const cats = useMemo(() => [...new Set(processes.map((p) => p.category ?? "General"))].sort(), [processes]);
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s.subProcessId === id)).length;

  const shown = processes.filter((p) => {
    if (cat && (p.category ?? "General") !== cat) return false;
    const hay = `${p.title} ${p.summary} ${(p.tags ?? []).join(" ")} ${p.category}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  });

  return (
    <div className="page library">
      <section className="hero">
        <div>
          <h1>How do I get…?</h1>
          <p className="lead">Platform processes, step by step. See who does what on the map, then follow your own checklist.</p>
        </div>
        <div className="hero-actions">
          <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
          <button className="btn" onClick={onNew}><Plus size={16} />Blank process</button>
        </div>
      </section>

      <div className="filters">
        <div className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: GCP, repository, Akamai…" /></div>
        <div className="chips">
          <button className={`chip ${cat === null ? "on" : ""}`} onClick={() => setCat(null)}>All<span>{processes.length}</span></button>
          {cats.map((c) => (
            <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
              {c}<span>{processes.filter((p) => (p.category ?? "General") === c).length}</span>
            </button>
          ))}
        </div>
      </div>

      {broken.map((b) => (
        <div key={b.file} className="check bad"><CircleAlert size={16} /><span><code>processes/{b.file}</code> is not valid JSON and was skipped: {b.error}</span></div>
      ))}

      <div className="cards">
        {shown.map((p) => {
          const bad = hasErrors(validateProcess(p, ids));
          const color = CAT_COLORS[cats.indexOf(p.category ?? "General") % CAT_COLORS.length];
          const steps = Array.isArray(p.steps) ? p.steps : [];
          const used = usedBy(p.id);
          return (
            <button key={p.id} className="card" style={{ "--c": color } as React.CSSProperties} onClick={() => go({ page: "process", id: p.id, tab: bad ? "json" : "flow" })}>
              <div className="card-top">
                <span className="card-cat">{p.category ?? "General"}</span>
                {bad && <span className="badge bad"><CircleAlert size={12} />Needs fixing</span>}
                {!bad && used > 0 && <span className="badge">Used by {used} process{used > 1 ? "es" : ""}</span>}
              </div>
              <h3>{p.title}</h3>
              <p>{p.summary}</p>
              {!bad && (
                <div className="card-strip">
                  {steps.slice(0, 11).map((s) => (
                    <span key={s.id} className={s.actor === "me" ? "mine" : ""} title={s.title}><TypeIcon type={s.type} size={22} /></span>
                  ))}
                  {steps.length > 11 && <em>+{steps.length - 11}</em>}
                </div>
              )}
              <div className="card-foot">
                {!bad && <span><Users size={13} />{steps.filter((s) => s.actor === "me").length} of {steps.length} steps are yours</span>}
                {p.estimatedDuration && <span><Clock size={13} />{p.estimatedDuration}</span>}
                <ArrowRight size={16} className="card-go" />
              </div>
            </button>
          );
        })}
        {shown.length === 0 && <p className="muted empty">No process matches. Try another word, or create one.</p>}
      </div>
    </div>
  );
}
