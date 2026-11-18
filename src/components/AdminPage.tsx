import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CalendarCheck, ChartColumn, Flag, KeyRound, List, Plus, Search, Server, ShieldCheck, Sparkles, Trash2, Workflow } from "lucide-react";
import type { Assignment, AuditEntry, FeedbackByTarget, Process, Role, Skill, Standard } from "../types";
import { groupName, teamName, useCatalog } from "../lib/catalog";
import { groupKindOf } from "../lib/members";
import { reviewInfo, statusOf } from "../lib/lifecycle";
import { usePerms } from "../lib/session";
import { go, grantAccess, href, loadAccess, loadAudit, loadSkills, loadSystem, revokeAccess, type Access, type AdminSection, type SystemInfo } from "../lib/store";
import { CatalogPage } from "./CatalogPage";
import { openCount } from "./Feedback";
import { SKILL_KIND, SkillPanel } from "./SkillPanel";
import { StatisticsSection } from "./StatisticsPage";
import { confirmDialog, Field, LoadError, Loading, notify } from "./ui";

/** The roles, what they allow in plain words, and for the three that are limited to a group: which list it is picked from. */
export const ROLES: Record<Role, { label: string; can: string; scope: "none" | "required"; scopeLabel?: string; always?: string }> = {
  admin: { label: "Admin", can: "Everything, including who has access", scope: "none" },
  "catalog-manager": { label: "Lists manager", can: "Teams, practices, platforms, categories, tools, tiers, environments, languages", scope: "none" },
  "process-editor": { label: "Process editor", can: "Create and change every process; close its feedback", scope: "none" },
  "standards-editor": { label: "Standards editor", can: "Create and change every standard; close its feedback", scope: "none" },
  "platform-owner": { label: "Platform owner", can: "Create and change the processes and standards that belong to a platform; confirm their reviews and close their feedback", scope: "required", scopeLabel: "For the platform", always: "Always for one platform" },
  "practice-owner": { label: "Practice owner", can: "Create and change the processes and standards that belong to a practice; confirm their reviews and close their feedback", scope: "required", scopeLabel: "For the practice", always: "Always for one practice" },
  owner: { label: "Owner", can: "Confirm reviews and close feedback on what a team maintains; see its drafts", scope: "required", scopeLabel: "For the team", always: "Always for one team" },
};

/** The name of what a role is limited to: a team, a platform or a practice. */
const scopeName = (catalog: ReturnType<typeof useCatalog>["catalog"], role: Role, scope: string) => groupName(catalog, groupKindOf(role) ?? "team", scope);

const SECTIONS: { id: AdminSection; label: string; icon: typeof List; admin?: boolean; hint: string }[] = [
  { id: "access", label: "Access", icon: KeyRound, admin: true, hint: "Who may do what" },
  { id: "lists", label: "Lists", icon: List, hint: "Teams, practices, platforms, categories, tools and more" },
  { id: "skills", label: "Skills", icon: Sparkles, hint: "Generated skills and review agents" },
  { id: "health", label: "Health", icon: CalendarCheck, hint: "Reviews due and open feedback" },
  { id: "activity", label: "Activity", icon: Activity, admin: true, hint: "Who changed what" },
  { id: "statistics", label: "Statistics", icon: ChartColumn, admin: true, hint: "How much each process and standard is used" },
  { id: "system", label: "System", icon: Server, admin: true, hint: "How this installation is set up" },
];

function AccessSection() {
  const { catalog } = useCatalog();
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("process-editor");
  const [scope, setScope] = useState("");
  const [refused, setRefused] = useState(""); // why the last "Give role" did not work
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setError(""); loadAccess().then(setAccess, (e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const spec = ROLES[role];
  // the email is only cleared when the role was given: after a refusal it stays to be corrected
  const grant = () => {
    if (busy) return;
    setBusy(true); setRefused("");
    grantAccess({ email: email.trim(), role, scope: spec.scope === "none" ? "" : scope })
      .then((a) => { setAccess(a); setEmail(""); notify.info(`${email.trim()} is now ${spec.label}.`); }, (e) => setRefused(e.message))
      .finally(() => setBusy(false));
  };
  const revoke = async (a: Assignment) => {
    const label = ROLES[a.role]?.label ?? a.role;
    const yes = await confirmDialog({
      title: "Remove this role?",
      body: <>{a.email} will no longer be {label}{a.scope ? ` for ${scopeName(catalog, a.role, a.scope)}` : ""}. You can give the role again at any time.</>,
      confirmLabel: "Remove role", danger: true,
    });
    if (!yes) return;
    revokeAccess({ email: a.email, role: a.role, scope: a.scope }).then(setAccess, (e) => notify.error("The role could not be removed.", e));
  };
  // one row per person, with all their roles
  const people = useMemo(() => {
    const by = new Map<string, Assignment[]>();
    for (const a of access?.assignments ?? []) by.set(a.email, [...(by.get(a.email) ?? []), a]);
    return [...by.entries()];
  }, [access]);
  const ready = /\S+@\S+\.\S+/.test(email) && (spec.scope !== "required" || scope !== "");

  return (
    <div className="admin-section">
      <p className="lead small">People sign in with their company account. What they may do is decided here. Everyone who can sign in can read, tick steps and give feedback. The members of one team, platform or practice are easier to manage on it, under <a href="#/admin/lists">Lists</a>.</p>
      {error && <LoadError what="The list of people with roles could not be loaded." error={error} onRetry={load} />}

      <section className="admin-card">
        <h2>Give someone a role</h2>
        <div className="grant">
          <Field label="Email"><input type="email" value={email} placeholder="name@company.com" aria-invalid={!!refused} onChange={(e) => { setEmail(e.target.value); setRefused(""); }} onKeyDown={(e) => e.key === "Enter" && ready && grant()} /></Field>
          <Field label="Role">
            <select value={role} onChange={(e) => { setRole(e.target.value as Role); setScope(""); }}>
              {(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
            </select>
          </Field>
          {spec.scope !== "none" && (
            <Field label={spec.scopeLabel!}>
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">Choose…</option>
                {(role === "platform-owner" ? catalog.platforms : role === "practice-owner" ? catalog.practices : catalog.teams).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          )}
          <button className="btn primary" disabled={!ready || busy} onClick={grant}><Plus size={16} />Give role</button>
        </div>
        {refused && <LoadError what="The role was not given." error={refused} />}
        <p className="muted small">{spec.label}: {spec.can}.</p>
      </section>

      <section className="admin-card">
        <h2>People with roles <span>{people.length + (access?.bootstrapAdmins.length ?? 0)}</span></h2>
        {!access && !error && <Loading />}
        <ul className="people">
          {(access?.bootstrapAdmins ?? []).map((e) => (
            <li key={`b-${e}`}>
              <span className="avatar">{e.slice(0, 1).toUpperCase()}</span>
              <span className="person"><strong>{e}</strong><em>Named in the server settings, so there is always a way in. Cannot be removed here.</em></span>
              <span className="role-chip fixed">Admin</span>
            </li>
          ))}
          {people.map(([person, list]) => (
            <li key={person}>
              <span className="avatar">{person.slice(0, 1).toUpperCase()}</span>
              <span className="person"><strong>{person}</strong><em>since {list[0].grantedAt.slice(0, 10)}, by {list[0].grantedBy}</em></span>
              <span className="role-chips">
                {list.map((a) => (
                  <span key={a.role + a.scope} className="role-chip">
                    {ROLES[a.role]?.label ?? a.role}{a.scope && <em>{scopeName(catalog, a.role, a.scope)}</em>}
                    <button aria-label={`Remove ${ROLES[a.role]?.label ?? a.role} from ${person}`} onClick={() => revoke(a)}><Trash2 size={12} /></button>
                  </span>
                ))}
              </span>
            </li>
          ))}
          {access && people.length === 0 && access.bootstrapAdmins.length === 0 && <li className="muted">Nobody has a role yet.</li>}
        </ul>
      </section>

      <section className="admin-card">
        <h2>What each role can do</h2>
        <table className="guide-table"><tbody>
          {(Object.keys(ROLES) as Role[]).map((r) => <tr key={r}><td><b>{ROLES[r].label}</b></td><td>{ROLES[r].can}{ROLES[r].always && `. ${ROLES[r].always}`}</td></tr>)}
        </tbody></table>
      </section>
    </div>
  );
}

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
          <div className="chips skill-kinds" role="group" aria-label="Kind">
            {(["all", "skill", "review-agent"] as const).map((k) => (
              <button key={k} className={`chip ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "All" : SKILL_KIND[k].label + "s"}<span>{(skills ?? []).filter((s) => k === "all" || s.kind === k).length}</span>
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

function HealthSection({ processes, standards, feedback }: { processes: Process[]; standards: Standard[]; feedback: FeedbackByTarget }) {
  const { catalog } = useCatalog();
  const rows = [
    ...processes.map((p) => ({ kind: "process" as const, doc: p, open: openCount(feedback.process[p.id]) })),
    ...standards.map((s) => ({ kind: "standard" as const, doc: s, open: openCount(feedback.standard[s.id]) })),
  ].map((r) => ({ ...r, review: reviewInfo(r.doc), status: statusOf(r.doc) }));
  const due = rows.filter((r) => r.review.state === "overdue" || r.review.state === "soon").sort((a, b) => (a.review.days ?? -9999) - (b.review.days ?? -9999));
  const flagged = rows.filter((r) => r.open > 0).sort((a, b) => b.open - a.open);
  const drafts = rows.filter((r) => r.status === "draft");
  const unowned = rows.filter((r) => r.status === "active" && (!r.doc.owner || !r.doc.review));
  const link = (r: (typeof rows)[number]) => () => go(r.kind === "process" ? { page: "process", id: r.doc.id, tab: "flow" } : { page: "standard", id: r.doc.id, tab: "doc" });
  const Row = ({ r, right }: { r: (typeof rows)[number]; right: React.ReactNode }) => (
    <li><button onClick={link(r)}>
      {r.kind === "process" ? <Workflow size={15} /> : <ShieldCheck size={15} />}
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

const ACTION: Record<string, string> = {
  "process.save": "saved the process", "process.delete": "deleted the process", "standard.save": "saved the standard", "standard.delete": "deleted the standard",
  "lists.save": "changed the lists", "access.grant": "gave a role to", "access.revoke": "removed a role from", "skill.guidance": "changed the extra guidance of",
  "content.import": "imported", "process.review": "confirmed the review of the process", "standard.review": "confirmed the review of the standard", "feedback.fixed": "marked feedback as fixed on the", "feedback.reopen": "reopened feedback on the",
  "feedback.delete": "deleted feedback on the",
  "content.convert": "brought stored content up to date for this version:",
  "request.create": "asked for something new:", "request.state": "changed the state of", "request.delete": "removed",
};

function ActivitySection() {
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
  return (
    <div className="admin-section">
      <p className="lead small">Every change to content, lists, roles and skills, newest first.</p>
      {error && <LoadError what="The activity could not be loaded." error={error} onRetry={() => load(entries?.length ? entries[entries.length - 1].id : 0)} />}
      {!entries && !error && <Loading />}
      {entries && <section className="admin-card">
        <ul className="activity">
          {entries.map((e) => (
            <li key={e.id}>
              <time>{e.at.slice(0, 16).replace("T", " ")}</time>
              <span><b>{e.name}</b> {ACTION[e.action] ?? e.action} <code>{e.target}</code>{e.detail && <em> · {e.detail}</em>}</span>
            </li>
          ))}
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

export function AdminPage({ section, processes, standards, feedback }: {
  section: AdminSection; processes: Process[]; standards: Standard[]; feedback: FeedbackByTarget;
}) {
  const perms = usePerms();
  const allowed = SECTIONS.filter((s) => (s.admin ? perms.admin : s.id === "lists" ? perms.catalog : true));
  const current = allowed.find((s) => s.id === section) ?? allowed[0];
  return (
    <div className="page admin">
      <aside className="admin-nav">
        <h1>Admin</h1>
        {allowed.map((s) => (
          <a key={s.id} className={current.id === s.id ? "on" : ""} href={href({ page: "admin", section: s.id })} title={s.hint}><s.icon size={16} />{s.label}</a>
        ))}
      </aside>
      <main className="admin-main">
        <header><h2>{current.label}</h2><p className="muted">{current.hint}</p></header>
        {current.id === "access" && <AccessSection />}
        {current.id === "lists" && <CatalogPage processes={processes} standards={standards} editable />}
        {current.id === "skills" && <SkillsSection />}
        {current.id === "health" && <HealthSection processes={processes} standards={standards} feedback={feedback} />}
        {current.id === "activity" && <ActivitySection />}
        {current.id === "statistics" && <StatisticsSection />}
        {current.id === "system" && <SystemSection />}
      </main>
    </div>
  );
}
