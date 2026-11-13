import { useMemo, useState } from "react";
import { ArrowRight, CalendarCheck, CircleAlert, Clock, Code2, Flag, Layers, Sparkles as SkillIcon, Plus, Search, Sparkles, Users } from "lucide-react";
import type { Feedback, Process } from "../types";
import { teamName, tierLabel, useCatalog } from "../lib/catalog";
import { openCount } from "./Feedback";
import { useEditor } from "../lib/mode";
import { reviewInfo, statusOf, STATUS_LABEL } from "../lib/lifecycle";
import { languageLabel } from "../lib/catalog";
import { hasErrors, validateProcess } from "../lib/validate";
import { go } from "../lib/store";
import { TypeIcon } from "./ui";

const CAT_COLORS = ["#4f46e5", "#0d9488", "#d97706", "#db2777", "#0284c7", "#7c3aed"];

export function Library({ processes: allProcesses, broken, onNew, onAi, feedback }: {
  processes: Process[]; feedback: Record<string, Feedback[]>; broken: { file: string; error: string }[]; onNew: () => void; onAi: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [tier, setTier] = useState<string | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const [dueOnly, setDueOnly] = useState(false);
  const { catalog } = useCatalog();
  const editor = useEditor();
  // drafts are work in progress: only editors see them
  const processes = useMemo(() => allProcesses.filter((p) => editor || statusOf(p) !== "draft"), [allProcesses, editor]);
  const needsReview = (p: Process) => ["overdue", "soon"].includes(reviewInfo(p).state);
  const dueCount = processes.filter(needsReview).length;
  const ids = useMemo(() => allProcesses.map((p) => p.id), [allProcesses]);
  const cats = useMemo(() => [...new Set(processes.map((p) => p.category ?? "General"))].sort(), [processes]);
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s.subProcessId === id)).length;

  const shown = processes.filter((p) => {
    if (cat && (p.category ?? "General") !== cat) return false;
    if (tier && p.tiers?.length && !p.tiers.includes(tier)) return false;
    if (lang && p.languages?.length && !p.languages.includes(lang)) return false;
    if (dueOnly && editor && !needsReview(p)) return false;
    const hay = `${p.title} ${p.summary} ${(p.tags ?? []).join(" ")} ${p.category} ${teamName(catalog, p.owner)}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  });

  return (
    <div className="page library">
      <section className="hero">
        <div>
          <h1>How do I get…?</h1>
          <p className="lead">Platform processes, step by step. See who does what on the map, then follow your own checklist.</p>
        </div>
        {editor && (
          <div className="hero-actions">
            <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
            <button className="btn" onClick={onNew}><Plus size={16} />Blank process</button>
          </div>
        )}
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
        {catalog.tiers.length > 0 && (
          <label className="tier-filter"><Layers size={15} />My application is
            <select value={tier ?? ""} onChange={(e) => setTier(e.target.value || null)}>
              <option value="">any tier</option>
              {catalog.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        {catalog.languages.length > 0 && (
          <label className="tier-filter lang"><Code2 size={15} />written in
            <select value={lang ?? ""} onChange={(e) => setLang(e.target.value || null)}>
              <option value="">any language</option>
              {catalog.languages.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {editor && dueCount > 0 && (
        <button className={`review-strip ${dueOnly ? "on" : ""}`} onClick={() => setDueOnly(!dueOnly)}>
          <CalendarCheck size={16} /><span><b>{dueCount} process{dueCount > 1 ? "es need" : " needs"} a review</b> by {dueCount > 1 ? "their owners" : "its owner"}.</span>
          <em>{dueOnly ? "Show all" : "Show only these"}</em>
        </button>
      )}

      {broken.map((b) => (
        <div key={b.file} className="check bad"><CircleAlert size={16} /><span><code>processes/{b.file}</code> is not valid JSON and was skipped: {b.error}</span></div>
      ))}

      <div className="cards">
        {shown.map((p) => {
          const bad = hasErrors(validateProcess(p, { processIds: ids, catalog }));
          const color = CAT_COLORS[cats.indexOf(p.category ?? "General") % CAT_COLORS.length];
          const steps = Array.isArray(p.steps) ? p.steps : [];
          const used = usedBy(p.id);
          return (
            <button key={p.id} className={`card ${statusOf(p) === "deprecated" ? "retired" : ""}`} style={{ "--c": color } as React.CSSProperties} onClick={() => go({ page: "process", id: p.id, tab: bad && editor ? "json" : "flow" })}>
              <div className="card-top">
                <span className="card-cat">{p.category ?? "General"}</span>
                {bad && editor && <span className="badge bad"><CircleAlert size={12} />Needs fixing</span>}
                {!bad && used > 0 && <span className="badge">Used by {used} process{used > 1 ? "es" : ""}</span>}
              </div>
              <h3>{p.title}</h3>
              <p>{p.summary}</p>
              <div className="card-tags">
                {statusOf(p) !== "active" && <span className={`tier-tag status-${statusOf(p)}`}>{STATUS_LABEL[statusOf(p)]}</span>}
                <span className={`tier-tag ${p.tiers?.length ? "some" : ""}`}><Layers size={12} />{tierLabel(catalog, p.tiers)}</span>
                {!!p.languages?.length && <span className="tier-tag some"><Code2 size={12} />{languageLabel(catalog, p.languages)}</span>}
                {p.resources?.some((r) => r.kind === "skill") && <span className="tier-tag skill"><SkillIcon size={12} />Self-service skill</span>}
                {editor && needsReview(p) && <span className={`tier-tag review-${reviewInfo(p).state}`}><CalendarCheck size={12} />{reviewInfo(p).state === "overdue" ? "Review overdue" : "Review due soon"}</span>}
                {p.owner && <span className="tier-tag">{teamName(catalog, p.owner)}</span>}
                {openCount(feedback[p.id] ?? []) > 0 && <span className="tier-tag flagged"><Flag size={12} />{openCount(feedback[p.id])} open feedback</span>}
              </div>
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
