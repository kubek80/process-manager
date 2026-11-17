import { useMemo, useState } from "react";
import { ArrowRight, CalendarCheck, Flag, Plus, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { Feedback, Process, Standard } from "../types";
import { categoryName, platformName, practiceName, teamName, useCatalog } from "../lib/catalog";
import { appliesTo } from "../lib/edit";
import { useProfile, useRemembered } from "../lib/profile";
import { reviewInfo, statusOf, STATUS_LABEL } from "../lib/lifecycle";
import { useEditor } from "../lib/mode";
import { canCreate, canEdit, usePerms } from "../lib/session";
import { href } from "../lib/store";
import { hasErrors, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { BelongsTags, DimTags, ProfileFilter } from "./Governance";

const CAT_COLORS = ["#be123c", "#0d9488", "#7c3aed", "#d97706", "#0284c7", "#4f46e5"];
const LEVELS = ["must", "should", "may"] as const;
/** The requirements of a standard, also when it was stored without a proper list of them. */
const reqs = (s: Standard) => (Array.isArray(s.requirements) ? s.requirements.filter((r) => r && typeof r === "object") : []);

export function StandardsLibrary({ standards: all, processes, feedback, onNew, onAi }: {
  standards: Standard[]; processes: Process[]; feedback: Record<string, Feedback[]>; onNew: () => void; onAi: () => void;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const editing = useEditor();
  // the buttons to create one: for a standards editor, and for whoever owns a platform or practice
  const editor = editing && canCreate(perms, "standard");
  const mayEdit = (s: Standard) => editing && canEdit(perms, "standard", s);
  // what somebody searched and filtered for is still there when they come back from a standard
  const [q, setQ] = useRemembered("pm:standards:q", "");
  const [unit, setUnit] = useRemembered<string | null>("pm:standards:unit", null);
  const [profile, setProfile] = useProfile();
  // drafts are work in progress: only the people who may change them see them here
  const standards = useMemo(() => all.filter((s) => statusOf(s) !== "draft" || (editing && canEdit(perms, "standard", s))), [all, editing, perms]);
  const categories = useMemo(() => [...new Set(standards.map((s) => s.category ?? ""))].sort(), [standards]);
  const ctx = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds: all.map((s) => s.id), catalog }), [processes, all, catalog]);
  const units = useMemo(() => [...new Set(standards.map((s) => s.owner))].sort((a, b) => teamName(catalog, a).localeCompare(teamName(catalog, b))), [standards, catalog]);
  // a remembered team that no standard has any more filters nothing
  const picked = unit && units.includes(unit) ? unit : null;

  const shown = standards.filter((s) => {
    if (picked && s.owner !== picked) return false;
    if (!appliesTo(s, profile)) return false;
    const hay = `${s.title} ${s.summary} ${(s.tags ?? []).join(" ")} ${teamName(catalog, s.owner)} ${categoryName(catalog, s.category)} ${platformName(catalog, s.platform)} ${practiceName(catalog, s.practice)} ${reqs(s).map((r) => `${r.id} ${r.title}`).join(" ")}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  });

  return (
    <div className="page library">
      <section className="hero">
        <div>
          <h1>What must I meet?</h1>
          <p className="lead">Standards set by cyber security, platforms and practices. Each one is a list of requirements with the reason, how to comply and how it is checked.</p>
        </div>
        {editor && (
          <div className="hero-actions">
            <button className="btn primary" onClick={onAi}><Sparkles size={16} />Create from text with AI</button>
            <button className="btn" onClick={onNew}><Plus size={16} />Blank standard</button>
          </div>
        )}
      </section>

      <div className="filters">
        <div className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: logging, Terraform, SEC-LOG-01…" aria-label="Search standards" /></div>
        <div className="chips" role="group" aria-label="Issued by">
          <button className={`chip ${picked === null ? "on" : ""}`} aria-pressed={picked === null} onClick={() => setUnit(null)}>All<span>{standards.length}</span></button>
          {units.map((u) => (
            <button key={u} className={`chip ${picked === u ? "on" : ""}`} aria-pressed={picked === u} onClick={() => setUnit(u)}>
              {teamName(catalog, u)}<span>{standards.filter((s) => s.owner === u).length}</span>
            </button>
          ))}
        </div>
        <ProfileFilter value={profile} onChange={setProfile} />
      </div>

      <div className="cards">
        {shown.map((s) => {
          const bad = hasErrors(validateStandard(s, ctx));
          const mine = mayEdit(s);
          const review = reviewInfo(s).state;
          const applicable = reqs(s).filter((r) => appliesTo(r, profile));
          return (
            <a key={s.id} className={`card ${statusOf(s) === "deprecated" ? "retired" : ""}`} style={{ "--c": CAT_COLORS[categories.indexOf(s.category ?? "") % CAT_COLORS.length] } as React.CSSProperties}
              href={href({ page: "standard", id: s.id, tab: bad && mine ? "json" : "doc" })}>
              <div className="card-top">
                <span className="card-cat"><ShieldCheck size={13} />{teamName(catalog, s.owner)}</span>
                {s.category && <span className="badge">{categoryName(catalog, s.category)}</span>}
              </div>
              <h3>{s.title}</h3>
              <p>{s.summary}</p>
              <div className="card-tags">
                {statusOf(s) !== "active" && <span className={`tier-tag status-${statusOf(s)}`}>{STATUS_LABEL[statusOf(s)]}</span>}
                <BelongsTags doc={s} compact />
                <DimTags doc={s} compact />
                {openCount(feedback[s.id]) > 0 && <span className="tier-tag flagged"><Flag size={12} />{openCount(feedback[s.id])} open feedback</span>}
                {mine && (review === "overdue" || review === "soon") && <span className={`tier-tag review-${review}`}><CalendarCheck size={12} />{review === "overdue" ? "Review overdue" : "Review due soon"}</span>}
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
            </a>
          );
        })}
        {shown.length === 0 && <p className="muted empty">{standards.length === 0 ? "There are no standards yet." : "No standard matches. Try another word or widen the filter."}</p>}
      </div>
    </div>
  );
}
