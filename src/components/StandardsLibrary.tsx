import { useMemo, useState } from "react";
import { ArrowRight, CalendarCheck, Flag, Plus, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { Feedback, Process, Standard } from "../types";
import { teamName, UNIT_KINDS, useCatalog } from "../lib/catalog";
import { appliesTo, type Profile } from "../lib/edit";
import { reviewInfo, statusOf, STATUS_LABEL } from "../lib/lifecycle";
import { useEditor } from "../lib/mode";
import { canEditAnyStandard, usePerms } from "../lib/session";
import { go } from "../lib/store";
import { hasErrors, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { DimTags, ProfileFilter } from "./Governance";

const UNIT_COLORS: Record<string, string> = { security: "#be123c", platform: "#0d9488", practice: "#7c3aed", team: "#475569" };
const LEVELS = ["must", "should", "may"] as const;

export function StandardsLibrary({ standards: all, processes, feedback, onNew, onAi }: {
  standards: Standard[]; processes: Process[]; feedback: Record<string, Feedback[]>; onNew: () => void; onAi: () => void;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const editor = useEditor() && canEditAnyStandard(perms);
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>({});
  // drafts are work in progress: only editors see them
  const standards = useMemo(() => all.filter((s) => editor || statusOf(s) !== "draft"), [all, editor]);
  const ctx = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: all.map((s) => s.id), catalog }), [processes, all, catalog]);
  const units = useMemo(() => [...new Set(standards.map((s) => s.owner))].sort((a, b) => teamName(catalog, a).localeCompare(teamName(catalog, b))), [standards, catalog]);

  const shown = standards.filter((s) => {
    if (unit && s.owner !== unit) return false;
    if (!appliesTo(s, profile)) return false;
    const hay = `${s.title} ${s.summary} ${(s.tags ?? []).join(" ")} ${teamName(catalog, s.owner)} ${s.requirements.map((r) => `${r.id} ${r.title}`).join(" ")}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  });

  return (
    <div className="page library">
      <section className="hero">
        <div>
          <h1>What must I meet?</h1>
          <p className="lead">Standards set by cyber security, platform owners and practices. Each one is a list of requirements with the reason, how to comply and how it is checked.</p>
        </div>
        {editor && (
          <div className="hero-actions">
            <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
            <button className="btn" onClick={onNew}><Plus size={16} />Blank standard</button>
          </div>
        )}
      </section>

      <div className="filters">
        <div className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: logging, Terraform, SEC-LOG-01…" /></div>
        <div className="chips">
          <button className={`chip ${unit === null ? "on" : ""}`} onClick={() => setUnit(null)}>All<span>{standards.length}</span></button>
          {units.map((u) => (
            <button key={u} className={`chip ${unit === u ? "on" : ""}`} onClick={() => setUnit(u)}>
              {teamName(catalog, u)}<span>{standards.filter((s) => s.owner === u).length}</span>
            </button>
          ))}
        </div>
        <ProfileFilter value={profile} onChange={setProfile} />
      </div>

      <div className="cards">
        {shown.map((s) => {
          const kind = catalog.teams.find((t) => t.id === s.owner)?.kind ?? "team";
          const bad = hasErrors(validateStandard(s, ctx));
          const review = reviewInfo(s).state;
          const applicable = s.requirements.filter((r) => appliesTo(r, profile));
          return (
            <button key={s.id} className={`card ${statusOf(s) === "deprecated" ? "retired" : ""}`} style={{ "--c": UNIT_COLORS[kind] } as React.CSSProperties}
              onClick={() => go({ page: "standard", id: s.id, tab: bad && editor ? "json" : "doc" })}>
              <div className="card-top">
                <span className="card-cat"><ShieldCheck size={13} />{teamName(catalog, s.owner)}</span>
                <span className="badge">{UNIT_KINDS[kind]}</span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.summary}</p>
              <div className="card-tags">
                {statusOf(s) !== "active" && <span className={`tier-tag status-${statusOf(s)}`}>{STATUS_LABEL[statusOf(s)]}</span>}
                <DimTags doc={s} compact />
                {openCount(feedback[s.id]) > 0 && <span className="tier-tag flagged"><Flag size={12} />{openCount(feedback[s.id])} open feedback</span>}
                {editor && (review === "overdue" || review === "soon") && <span className={`tier-tag review-${review}`}><CalendarCheck size={12} />{review === "overdue" ? "Review overdue" : "Review due soon"}</span>}
              </div>
              <div className="card-foot">
                <span className="levels">
                  {LEVELS.map((l) => {
                    const n = applicable.filter((r) => r.level === l).length;
                    return n > 0 && <span key={l} className={`level ${l}`}>{n} {l}</span>;
                  })}
                </span>
                <ArrowRight size={16} className="card-go" />
              </div>
            </button>
          );
        })}
        {shown.length === 0 && <p className="muted empty">No standard matches. Try another word or widen the filter.</p>}
      </div>
    </div>
  );
}
