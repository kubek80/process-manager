import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CalendarCheck, ChartColumn, Flag, KeyRound, List, Palette, Search, Server, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import type { AuditEntry, FeedbackByTarget, Process, Skill, Standard, TargetKind } from "../types";
import { teamName, useCatalog } from "../lib/catalog";
import { reviewOf, statusOf } from "../lib/lifecycle";
import { usePerms } from "../lib/session";
import { go, href, loadAudit, loadSkills, loadSystem, type AdminSection, type MetaById, type SystemInfo } from "../lib/store";
import { KindTag } from "./marks";
import { describeEntry } from "../lib/activity";
import { CatalogPage } from "./CatalogPage";
import { UsersSection } from "./UsersSection";
import { openCount } from "./Feedback";
import { SKILL_KIND, SkillPanel } from "./SkillPanel";
import { StatisticsSection } from "./StatisticsPage";
import { ThemeSection } from "./ThemeSection";
import { LoadError, Loading } from "./ui";

export { ROLES } from "../lib/users";

const SECTIONS: { id: AdminSection; label: string; icon: typeof List; admin?: boolean; hint: string }[] = [
  { id: "access", label: "Access", icon: KeyRound, admin: true, hint: "Who may do what" },
  { id: "lists", label: "Lists", icon: List, hint: "Teams, practices, platforms, categories, tools and more" },
  { id: "skills", label: "Skills", icon: Sparkles, hint: "Generated skills and review agents" },
  { id: "health", label: "Health", icon: CalendarCheck, hint: "Reviews due and open feedback" },
  { id: "activity", label: "Activity", icon: Activity, admin: true, hint: "Who changed what" },
  { id: "statistics", label: "Statistics", icon: ChartColumn, admin: true, hint: "How much each process and standard is used" },
  { id: "theming", label: "Theming", icon: Palette, admin: true, hint: "The name, logo and colours everyone sees" },
  { id: "system", label: "System", icon: Server, admin: true, hint: "How this installation is set up" },
];

function SkillsSection() {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | Skill["kind"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => { setError(""); loadSkills().then(setSkills, (e) => setError(e.message)); }, []);
  useEffect(reload, [reload]);
  const shown = (skills ?? []).filter((s) => (kind === "all" || s.kind === kind) && `${s.title} ${s.id}`.toLowerCase().includes(q.toLowerCase()));
  const current = shown.find((s) => s.id === open) ?? shown[0];

  return (
    <div className="admin-section">
      <p className="lead small">A skill tells an AI coding assistant how to do the work; a review agent tells it what to check in a pull request. Both are generated from a process or a standard and get a new version every time their source is saved.</p>
      {error && <LoadError what="The skills could not be loaded." error={error} onRetry={reload} />}
      {!skills && !error && <Loading />}
      {skills && <div className="cat-split skills-split">
        <section className="cat-list">
          <div className="cat-list-bar">
            <div className="search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills" aria-label="Search skills" /></div>
          </div>
          <div className="seg skill-kinds" role="group" aria-label="Kind">
            {(["all", "skill", "review-agent"] as const).map((k) => (
              <button key={k} className={`seg-item ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "All" : SKILL_KIND[k].label + "s"}<span className="seg-n">{(skills ?? []).filter((s) => k === "all" || s.kind === k).length}</span>
              </button>
            ))}
          </div>
          <ul>
            {shown.map((s) => {
              const K = SKILL_KIND[s.kind];
              return (
                <li key={s.id}>
                  <button className={`cat-item ${current?.id === s.id ? "on" : ""} ${s.active ? "" : "withdrawn"}`} onClick={() => setOpen(s.id)}>
                    <span className={`skill-icon small ${s.kind}`}><K.icon size={15} /></span>
                    <span className="cat-item-text"><strong>{s.title}</strong><em>{s.active ? `from the ${s.sourceKind} · ${s.updatedAt.slice(0, 10)}` : "withdrawn"}</em></span>
                    <span className="cat-uses" title="Version">v{s.version}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="cat-empty">{skills.length ? "No skill matches." : "No skills yet."}</li>}
          </ul>
        </section>
        <section className="cat-detail">
          {current ? <>
            <SkillPanel key={current.id} id={current.id} onChanged={reload} />
            <a className="btn small ghost source-link" href={href(current.sourceKind === "process" ? { page: "process", id: current.sourceId, tab: "flow" } : { page: "standard", id: current.sourceId, tab: "doc" })}>
              {current.sourceKind === "process" ? <Workflow size={14} /> : <ShieldCheck size={14} />}Open the {current.sourceKind} it comes from
            </a>
          </> : <p className="muted cat-empty">{skills.length ? "No skill matches your search." : "Nothing generated yet. Skills appear when a process or standard is active."}</p>}
        </section>
      </div>}
    </div>
  );
}

function HealthSection({ processes, standards, feedback, meta }: { processes: Process[]; standards: Standard[]; feedback: FeedbackByTarget; meta?: Partial<Record<TargetKind, MetaById>> }) {
  const { catalog } = useCatalog();
  const rows = [
    ...processes.map((p) => ({ kind: "process" as const, doc: p, open: openCount(feedback.process[p.id]) })),
    ...standards.map((s) => ({ kind: "standard" as const, doc: s, open: openCount(feedback.standard[s.id]) })),
  ].map((r) => ({ ...r, review: reviewOf(r.doc, meta?.[r.kind]?.[r.doc.id]), status: statusOf(r.doc) }));
  const due = rows.filter((r) => r.review.state === "overdue" || r.review.state === "soon").sort((a, b) => (a.review.days ?? -9999) - (b.review.days ?? -9999));
  const flagged = rows.filter((r) => r.open > 0).sort((a, b) => b.open - a.open);
  const drafts = rows.filter((r) => r.status === "draft");
  const unowned = rows.filter((r) => r.status === "active" && (!r.doc.owner || !r.doc.review));
  const link = (r: (typeof rows)[number]) => () => go(r.kind === "process" ? { page: "process", id: r.doc.id, tab: "flow" } : { page: "standard", id: r.doc.id, tab: "doc" });
  const Row = ({ r, right }: { r: (typeof rows)[number]; right: React.ReactNode }) => (
    <li><button onClick={link(r)}>
      <KindTag kind={r.kind} />
      <span className="person"><strong>{r.doc.title}</strong><em>{r.doc.owner ? teamName(catalog, r.doc.owner) : "No owner"}</em></span>{right}
    </button></li>
  );
  return (
    <div className="admin-section">
      <div className="stat-row">
        <div className={`stat ${due.some((r) => r.review.state === "overdue") ? "bad" : due.length ? "warn" : "good"}`}><strong>{due.length}</strong><span>reviews due</span></div>
        <div className={`stat ${flagged.length ? "warn" : "good"}`}><strong>{flagged.reduce((n, r) => n + r.open, 0)}</strong><span>open feedback</span></div>
        <div className="stat"><strong>{drafts.length}</strong><span>drafts not yet published</span></div>
        <div className={`stat ${unowned.length ? "warn" : "good"}`}><strong>{unowned.length}</strong><span>active without owner or review</span></div>
      </div>
      <section className="admin-card">
        <h2><CalendarCheck size={16} />Reviews due <span>{due.length}</span></h2>
        {due.length === 0 && <p className="muted">Every review is up to date.</p>}
        <ul className="health">{due.map((r) => <Row key={r.kind + r.doc.id} r={r} right={<span className={`tier-tag review-${r.review.state}`}>{r.review.label}</span>} />)}</ul>
      </section>
      <section className="admin-card">
        <h2><Flag size={16} />Open feedback <span>{flagged.length}</span></h2>
        {flagged.length === 0 && <p className="muted">Nothing is waiting.</p>}
        <ul className="health">{flagged.map((r) => <Row key={r.kind + r.doc.id} r={r} right={<span className="tier-tag flagged">{r.open} open</span>} />)}</ul>
      </section>
      {(drafts.length > 0 || unowned.length > 0) && (
        <section className="admin-card">
          <h2>Needs attention <span>{drafts.length + unowned.length}</span></h2>
          <ul className="health">
            {drafts.map((r) => <Row key={"d" + r.kind + r.doc.id} r={r} right={<span className="tier-tag status-draft">Draft</span>} />)}
            {unowned.map((r) => <Row key={"u" + r.kind + r.doc.id} r={r} right={<span className="tier-tag review-soon">{!r.doc.owner ? "No owner" : "No review rhythm"}</span>} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function ActivitySection({ processes, standards }: { processes: Process[]; standards: Standard[] }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  // the newest hundred first; "Show older" walks back through everything that was ever recorded
  const load = useCallback((before = 0) => {
    setError("");
    loadAudit(100, before).then((page) => {
      setEntries((shown) => (before && shown ? [...shown, ...page.entries] : page.entries));
      setMore(page.more);
    }, (e) => setError(e.message));
  }, []);
  useEffect(() => load(), [load]);
  const titles = useMemo(() => ({
    process: Object.fromEntries(processes.map((p) => [p.id, p.title])), standard: Object.fromEntries(standards.map((x) => [x.id, x.title])),
  }), [processes, standards]);
  return (
    <div className="admin-section">
      <p className="lead small">Every change to content, lists, roles and skills, newest first.</p>
      {error && <LoadError what="The activity could not be loaded." error={error} onRetry={() => load(entries?.length ? entries[entries.length - 1].id : 0)} />}
      {!entries && !error && <Loading />}
      {entries && <section className="admin-card">
        <ul className="activity">
          {entries.map((e) => {
            const d = describeEntry(e, titles);
            const t = d.target;
            return (
              <li key={e.id}>
                <time dateTime={e.at}>{e.at.slice(0, 16).replace("T", " ")}</time>
                <span>{d.person ? <b title={e.email}>{d.who}</b> : <span className="activity-portal">{d.who}</span>} {d.words}
                  {t && <> {t.code ? <code>{t.text}</code> : <span className={t.quoted ? "activity-doc" : ""} title={t.hint}>{t.text}</span>}</>}
                  {d.detail && <em> · {d.detail}</em>}</span>
              </li>
            );
          })}
          {entries.length === 0 && <li className="muted">Nothing has been changed yet.</li>}
        </ul>
        {more && <button className="btn small" onClick={() => load(entries[entries.length - 1].id)}>Show older</button>}
      </section>}
    </div>
  );
}

function SystemSection() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { setError(""); loadSystem().then(setInfo, (e) => setError(e.message)); }, []);
  useEffect(load, [load]);
  if (error) return <LoadError what="The set-up of this installation could not be loaded." error={error} onRetry={load} />;
  if (!info) return <Loading />;
  const provider = { dev: "Local development (user picker)", entra: "Microsoft Entra ID", google: "Google" }[info.provider] ?? info.provider;
  return (
    <div className="admin-section">
      <div className="stat-row">
        <div className="stat"><strong>{info.processes}</strong><span>processes</span></div>
        <div className="stat"><strong>{info.standards}</strong><span>standards</span></div>
        <div className="stat"><strong>{info.skills}</strong><span>skills and review agents</span></div>
        <div className="stat"><strong>{info.assignments}</strong><span>roles given</span></div>
      </div>
      <section className="admin-card">
        <h2>How this installation is set up</h2>
        <table className="guide-table"><tbody>
          <tr><td>Sign-in</td><td>{provider}</td></tr>
          <tr><td>Address</td><td><code>{info.baseUrl}</code></td></tr>
          <tr><td>Notifications</td><td>{info.notify === "webhook" ? "Sent to a chat webhook" : "Written to the server log only"}</td></tr>
          <tr><td>Content</td><td>Stored in the database. Every save is a version with a note, and can be restored. <code>server -export</code> writes a copy to files.</td></tr>
        </tbody></table>
        <p className="muted small">These are server settings and are changed where the server is deployed, not here. See <code>docs/backend.md</code>.</p>
      </section>
    </div>
  );
}

export function AdminPage({ section, processes, standards, feedback, meta }: {
  section: AdminSection; processes: Process[]; standards: Standard[]; feedback: FeedbackByTarget;
  /** When each was first published (`meta[id].publishedAt`): where the first review is counted from. */
  meta?: Partial<Record<TargetKind, MetaById>>;
}) {
  const perms = usePerms();
  const allowed = SECTIONS.filter((s) => (s.admin ? perms.admin : s.id === "lists" ? perms.catalog : true));
  const current = allowed.find((s) => s.id === section) ?? allowed[0];
  // on a phone the sections are one row that scrolls sideways: the current one is brought into it
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const box = nav.current, on = box?.querySelector<HTMLElement>("a.on");
    if (!box || !on || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = Math.max(0, on.offsetLeft - box.offsetLeft - (box.clientWidth - on.offsetWidth) / 2);
  }, [current.id]);
  return (
    <div className="page admin">
      <aside ref={nav} className="admin-nav" aria-label="Admin">
        <p className="admin-nav-title">Admin</p>
        {allowed.map((s) => (
          <a key={s.id} className={current.id === s.id ? "on" : ""} aria-current={current.id === s.id ? "page" : undefined} href={href({ page: "admin", section: s.id })} title={s.hint}><s.icon size={16} />{s.label}</a>
        ))}
      </aside>
      <main className="admin-main">
        <header className="admin-head"><h1>{current.label}</h1><p className="lead">{current.hint}</p></header>
        {current.id === "access" && <UsersSection />}
        {current.id === "lists" && <CatalogPage processes={processes} standards={standards} editable />}
        {current.id === "skills" && <SkillsSection />}
        {current.id === "health" && <HealthSection processes={processes} standards={standards} feedback={feedback} meta={meta} />}
        {current.id === "activity" && <ActivitySection processes={processes} standards={standards} />}
        {current.id === "statistics" && <StatisticsSection />}
        {current.id === "theming" && <ThemeSection processes={processes} standards={standards} />}
        {current.id === "system" && <SystemSection />}
      </main>
    </div>
  );
}
