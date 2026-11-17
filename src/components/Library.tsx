import { useMemo, useState } from "react";
import { ArrowRight, CalendarCheck, CircleAlert, Clock, Flag, Sparkles as SkillIcon, Plus, Search, Sparkles, Users } from "lucide-react";
import type { Feedback, Process } from "../types";
import { categoryName, platformName, practiceName, teamName, useCatalog } from "../lib/catalog";
import { openCount } from "./Feedback";
import { useEditor } from "../lib/mode";
import { canCreate, canEdit, usePerms } from "../lib/session";
import { appliesTo } from "../lib/edit";
import { useProfile, useRemembered } from "../lib/profile";
import { BelongsTags, DimTags, ProfileFilter } from "./Governance";
import { reviewInfo, statusOf, STATUS_LABEL } from "../lib/lifecycle";
import { hasErrors, validateProcess } from "../lib/validate";
import { href } from "../lib/store";
import { TypeIcon } from "./ui";

const CAT_COLORS = ["#4f46e5", "#0d9488", "#d97706", "#db2777", "#0284c7", "#7c3aed"];
/** Where a process without a category is listed. */
export const NO_CATEGORY = "Other";

export function Library({ processes: allProcesses, standardIds, onNew, onAi, feedback }: {
  processes: Process[]; standardIds: string[]; feedback: Record<string, Feedback[]>; onNew: () => void; onAi: () => void;
}) {
  // what somebody searched and filtered for is still there when they come back from a process
  const [q, setQ] = useRemembered("pm:processes:q", "");
  const [cat, setCat] = useRemembered<string | null>("pm:processes:category", null);
  const [profile, setProfile] = useProfile();
  const [dueOnly, setDueOnly] = useState(false);
  const { catalog } = useCatalog();
  const perms = usePerms();
  const editing = useEditor();
  // the buttons to create one: for a process editor, and for whoever owns a platform or practice
  const editor = editing && canCreate(perms, "process");
  // what this person may change: every process for a process editor, else what belongs to their platforms and practices
  const mayEdit = (p: Process) => editing && canEdit(perms, "process", p);
  // drafts are work in progress: only the people who may change them see them here
  const processes = useMemo(() => allProcesses.filter((p) => statusOf(p) !== "draft" || (editing && canEdit(perms, "process", p))), [allProcesses, editing, perms]);
  const needsReview = (p: Process) => ["overdue", "soon"].includes(reviewInfo(p).state);
  const dueCount = processes.filter((p) => mayEdit(p) && needsReview(p)).length;
  const ids = useMemo(() => allProcesses.map((p) => p.id), [allProcesses]);
  // categories by id, in the order of their names; "" is the place for a process without one
  const catKey = (p: Process) => p.category ?? "";
  const catLabel = (key: string) => (key ? categoryName(catalog, key) : NO_CATEGORY);
  const cats = useMemo(() => [...new Set(processes.map(catKey))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : catLabel(a).localeCompare(catLabel(b)))), [processes, catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  // a remembered category that no process has any more (or a name remembered before categories had ids) filters nothing
  const picked = cat !== null && cats.includes(cat) ? cat : null;
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s.subProcessId === id)).length;

  const shown = processes.filter((p) => {
    if (picked !== null && catKey(p) !== picked) return false;
    if (!appliesTo(p, profile)) return false;
    if (dueOnly && !(mayEdit(p) && needsReview(p))) return false;
    const hay = `${p.title} ${p.summary} ${(p.tags ?? []).join(" ")} ${catLabel(catKey(p))} ${platformName(catalog, p.platform)} ${practiceName(catalog, p.practice)} ${teamName(catalog, p.owner)}`.toLowerCase();
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
        <div className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: GCP, repository, Akamai…" aria-label="Search processes" /></div>
        <div className="chips" role="group" aria-label="Category">
          <button className={`chip ${picked === null ? "on" : ""}`} aria-pressed={picked === null} onClick={() => setCat(null)}>All<span>{processes.length}</span></button>
          {cats.map((c) => (
            <button key={c || "-"} className={`chip ${picked === c ? "on" : ""}`} aria-pressed={picked === c} onClick={() => setCat(c)}>
              {catLabel(c)}<span>{processes.filter((p) => catKey(p) === c).length}</span>
            </button>
          ))}
        </div>
        <ProfileFilter value={profile} onChange={setProfile} />
      </div>
      {editing && dueCount > 0 && (
        <button className={`review-strip ${dueOnly ? "on" : ""}`} aria-pressed={dueOnly} onClick={() => setDueOnly(!dueOnly)}>
          <CalendarCheck size={16} /><span><b>{dueCount} process{dueCount > 1 ? "es need" : " needs"} a review</b> by {dueCount > 1 ? "their owners" : "its owner"}.</span>
          <em>{dueOnly ? "Show all" : "Show only these"}</em>
        </button>
      )}

      <div className="cards">
        {shown.map((p) => {
          const bad = hasErrors(validateProcess(p, { processIds: ids, standardIds, catalog }));
          const mine = mayEdit(p);
          const color = CAT_COLORS[cats.indexOf(catKey(p)) % CAT_COLORS.length];
          const steps = Array.isArray(p.steps) ? p.steps : [];
          const used = usedBy(p.id);
          return (
            <a key={p.id} className={`card ${statusOf(p) === "deprecated" ? "retired" : ""}`} style={{ "--c": color } as React.CSSProperties} href={href({ page: "process", id: p.id, tab: bad && mine ? "json" : "flow" })}>
              <div className="card-top">
                <span className="card-cat">{catLabel(catKey(p))}</span>
                {bad && mine && <span className="badge bad"><CircleAlert size={12} />Needs fixing</span>}
                {!bad && used > 0 && <span className="badge">Used by {used} process{used > 1 ? "es" : ""}</span>}
              </div>
              <h3>{p.title}</h3>
              <p>{p.summary}</p>
              <div className="card-tags">
                {statusOf(p) !== "active" && <span className={`tier-tag status-${statusOf(p)}`}>{STATUS_LABEL[statusOf(p)]}</span>}
                <BelongsTags doc={p} compact />
                <DimTags doc={p} compact />
                {p.resources?.some((r) => r.kind === "skill") && <span className="tier-tag skill"><SkillIcon size={12} />Self-service skill</span>}
                {mine && needsReview(p) && <span className={`tier-tag review-${reviewInfo(p).state}`}><CalendarCheck size={12} />{reviewInfo(p).state === "overdue" ? "Review overdue" : "Review due soon"}</span>}
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
            </a>
          );
        })}
        {shown.length === 0 && <p className="muted empty">{processes.length === 0
          ? (editor ? "There are no processes yet. Create the first one with the buttons above." : "There are no processes yet.")
          : editor ? "No process matches. Try another word or widen the filter, or create a new one with the buttons above." : "No process matches. Try another word or widen the filter."}</p>}
      </div>
    </div>
  );
}
