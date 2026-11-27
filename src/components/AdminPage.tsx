import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CalendarCheck, ChartColumn, CodeXml, Flag, KeyRound, List, Palette, Search, Server, ShieldCheck, Sparkles, Users, Workflow, Wrench } from "lucide-react";
import type { AuditEntry, FeedbackByTarget, Process, Skill, Standard, TargetKind } from "../types";
import { teamName, useCatalog } from "../lib/catalog";
import { reviewOf, statusOf } from "../lib/lifecycle";
import { usePerms } from "../lib/session";
import { go, href, loadAudit, loadMembers, loadSkills, loadUsers, loadSystem, placeOfView, type AdminSection, type CatalogList, type ListPlace, type MetaById, type SystemInfo } from "../lib/store";
import { KindTag } from "./marks";
import { describeEntry, detailParts, type Names } from "../lib/activity";
import { reviewsDue } from "../lib/responsibilities";
import { CatalogPage, PLACE_HEAD } from "./CatalogPage";
import { UsersSection } from "./UsersSection";
import { openCount } from "./Feedback";
import { SKILL_KIND, SkillPanel } from "./SkillPanel";
import { StatisticsSection } from "./StatisticsPage";
import { ThemeSection } from "./ThemeSection";
import { LoadError, Loading, useScrollFade } from "./ui";
import { formatDate, formatDateTime } from "../lib/dates";

export { ROLES } from "../lib/users";

// the code map and its categories are loaded only when the section is opened
const CodeMapPage = lazy(() => import("./CodeMapPage").then((m) => ({ default: m.CodeMapPage })));

const SECTIONS: { id: AdminSection; label: string; icon: typeof List; admin?: boolean; hint: string }[] = [
  { id: "access", label: "Access", icon: KeyRound, admin: true, hint: "Who may do what" },
  // the lists: two entries, Teams and Tools (`PLACE_HEAD`), on one page with one draft
  { id: "lists", label: "Lists", icon: List, hint: "" },
  { id: "skills", label: "Skills", icon: Sparkles, hint: "Generated skills and review agents" },
  { id: "health", label: "Health", icon: CalendarCheck, hint: "Reviews due and open feedback" },
  { id: "activity", label: "Activity", icon: Activity, admin: true, hint: "Who changed what" },
  { id: "statistics", label: "Statistics", icon: ChartColumn, admin: true, hint: "How much each process and standard is used" },
  { id: "theming", label: "Theming", icon: Palette, admin: true, hint: "The name, logo and colours everyone sees" },
  { id: "system", label: "System", icon: Server, admin: true, hint: "How this installation is set up" },
  { id: "code", label: "Code map", icon: CodeXml, admin: true, hint: "How the portal is built, for whoever reviews its code" },
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
                    <span className="cat-item-text"><strong>{s.title}</strong><em>{s.active ? `from the ${s.sourceKind} · ${formatDate(s.updatedAt)}` : "withdrawn"}</em></span>
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
  const tile = reviewsDue(due.filter((r) => r.review.state === "overdue").length, due.filter((r) => r.review.state === "soon").length);
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
        <div className={`stat ${tile.tone}`}><strong>{tile.count}</strong><span>{tile.label}</span>{tile.split && <span className="stat-split">{tile.split}</span>}</div>
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

function ActivitySection({ processes, standards, feedback }: { processes: Process[]; standards: Standard[]; feedback: FeedbackByTarget }) {
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
  // the names the page knows, by address: the people with roles, whoever appears in the log, whoever gave feedback
  const [people, setPeople] = useState<{ email: string; name?: string }[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all([loadUsers().catch(() => []), loadMembers().catch(() => [])]).then(([u, m]) => { if (live) setPeople([...u, ...m]); });
    return () => { live = false; };
  }, []);
  const names = useMemo<Names>(() => {
    const out: Names = {};
    for (const p of people) if (p.name) out[p.email.toLowerCase()] = p.name;
    for (const list of [...Object.values(feedback.process), ...Object.values(feedback.standard)]) for (const f of list) if (f.author.email && f.author.name) out[f.author.email.toLowerCase()] = f.author.name;
    for (const e of entries ?? []) if (e.email && e.name && e.email.includes("@")) out[e.email.toLowerCase()] = e.name;
    return out;
  }, [feedback, entries, people]);
  return (
    <div className="admin-section">
      <p className="lead small">Every change to content, lists, roles, members, skills and the look, newest first.</p>
      {error && <LoadError what="The activity could not be loaded." error={error} onRetry={() => load(entries?.length ? entries[entries.length - 1].id : 0)} />}
      {!entries && !error && <Loading />}
      {entries && <section className="admin-card">
        <ul className="activity">
          {entries.map((e) => {
            const d = describeEntry(e, titles, names);
            const t = d.target;
            return (
              <li key={e.id}>
                <time dateTime={e.at}>{formatDateTime(e.at)}</time>
                <span>{d.person ? <b title={e.email}>{d.who}</b> : <span className="activity-portal">{d.who}</span>} {d.words}
                  {t && <> {t.code ? <code>{t.text}</code> : <span className={t.quoted ? "activity-doc" : ""} title={t.hint}>{t.text}</span>}</>}
                  {d.after && <> {d.after}</>}
                  {d.detail && <em> · {detailParts(d.detail, names).map((p, i) => p.colour
                    ? <span key={i} className="activity-colour"><span className="activity-swatch" style={{ background: p.colour }} aria-hidden="true" />{p.text}</span>
                    : p.person ? <span key={i} title={p.person}>{p.text}</span> : p.text)}</em>}</span>
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
          <tr><td>Address</td><td><a href={info.baseUrl}>{info.baseUrl}</a></td></tr>
          <tr><td>Notifications</td><td>{info.notify === "webhook" ? "Sent to a chat channel" : "Not sent to a chat: only noted in the portal’s own log"}</td></tr>
          <tr><td>Content</td><td>Kept by the portal. Every save is a version with a note, and can be restored. A copy can be written to files by whoever runs the portal.</td></tr>
        </tbody></table>
        <p className="muted small">These are set where the portal is installed, not here. Ask whoever runs the portal to change them.</p>
        <details className="system-tech">
          <summary>For the people who run the portal</summary>
          <ul className="small">
            <li>Sign-in: <code>PM_AUTH</code> ({info.provider}); address: <code>PM_BASE_URL</code>; notifications: <code>PM_NOTIFY</code>; admins named at installation: <code>PM_ADMINS</code>.</li>
            <li>A copy of the content and the skills as files: <code>server -export &lt;folder&gt;</code>.</li>
            <li>Every setting is described in <code>docs/backend.md</code> in the portal's source.</li>
          </ul>
        </details>
      </section>
    </div>
  );
}

export function AdminPage({ section, place, list, id, processes, standards, feedback, meta }: {
  section: AdminSection;
  /** The lists' two entries, Teams and Tools, at a list and an entry (`#/admin/teams/pillars/compute`). */
  place?: ListPlace; list?: CatalogList; id?: string;
  processes: Process[]; standards: Standard[]; feedback: FeedbackByTarget;
  /** When each was first published (`meta[id].publishedAt`): where the first review is counted from. */
  meta?: Partial<Record<TargetKind, MetaById>>;
}) {
  const perms = usePerms();
  const allowed = SECTIONS.filter((s) => (s.admin ? perms.admin : s.id === "lists" ? perms.catalog : true));
  const current = allowed.find((s) => s.id === section) ?? allowed[0];
  // which of the lists' two entries the address is at (the page itself moves it, going to a problem of the other)
  const listPlace = placeOfView({ place, list });
  // on a phone the sections are one row that scrolls sideways: the current one is brought into it
  const nav = useRef<HTMLElement>(null);
  useScrollFade(nav); // the cut edge fades: there is more to either side
  useEffect(() => {
    const box = nav.current, on = box?.querySelector<HTMLElement>("a.on");
    if (!box || !on || box.scrollWidth <= box.clientWidth) return;
    box.scrollLeft = Math.max(0, on.offsetLeft - box.offsetLeft - (box.clientWidth - on.offsetWidth) / 2);
  }, [current.id]);
  return (
    <div className={`page admin ${current.id === "code" ? "cm-admin" : ""}`}>
      <aside ref={nav} className="admin-nav" aria-label="Admin">
        <p className="admin-nav-title">Admin</p>
        {allowed.flatMap((s) => (s.id === "lists"
          ? (["teams", "tools"] as const).map((p) => {
            const on = current.id === "lists" && listPlace === p;
            const Icon = p === "teams" ? Users : Wrench;
            return <a key={p} className={on ? "on" : ""} aria-current={on ? "page" : undefined} href={href({ page: "admin", section: "lists", place: p })} title={PLACE_HEAD[p].lead}><Icon size={16} />{PLACE_HEAD[p].title}</a>;
          })
          : [<a key={s.id} className={current.id === s.id ? "on" : ""} aria-current={current.id === s.id ? "page" : undefined} href={href({ page: "admin", section: s.id })} title={s.hint}><s.icon size={16} />{s.label}</a>]))}
      </aside>
      <div className="admin-main">
        {/* the code map has a heading of its own: the category or the file that is open */}
        {current.id !== "code" && <header className="admin-head">{current.id === "lists"
          ? <><h1>{PLACE_HEAD[listPlace].title}</h1><p className="lead">{PLACE_HEAD[listPlace].lead}</p></>
          : <><h1>{current.label}</h1><p className="lead">{current.hint}</p></>}</header>}
        {current.id === "access" && <UsersSection />}
        {current.id === "lists" && <CatalogPage processes={processes} standards={standards} editable place={place} list={list} id={id} />}
        {current.id === "skills" && <SkillsSection />}
        {current.id === "health" && <HealthSection processes={processes} standards={standards} feedback={feedback} meta={meta} />}
        {current.id === "activity" && <ActivitySection processes={processes} standards={standards} feedback={feedback} />}
        {current.id === "statistics" && <StatisticsSection />}
        {current.id === "theming" && <ThemeSection processes={processes} standards={standards} />}
        {current.id === "system" && <SystemSection />}
        {current.id === "code" && <Suspense fallback={<Loading />}><CodeMapPage label={current.label} hint={current.hint} /></Suspense>}
      </div>
    </div>
  );
}
