import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarCheck, Check, CircleCheck, Flag, PencilLine, ShieldCheck, Users, Workflow } from "lucide-react";
import type { DocMeta, FeedbackByTarget, Process, Standard, TargetKind } from "../types";
import { teamName, useCatalog } from "../lib/catalog";
import { STATUS_LABEL } from "../lib/lifecycle";
import { myTeams, responsibilities, type Owned, type Task } from "../lib/responsibilities";
import { useFeedbackActions, usePerms } from "../lib/session";
import { href, type MetaById } from "../lib/store";
import { FEEDBACK_KINDS } from "./Feedback";

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");
const pageOf = (o: Owned, feedback = false) => href(o.kind === "process"
  ? { page: "process", id: o.doc.id, tab: feedback ? "feedback" : "flow" }
  : { page: "standard", id: o.doc.id, tab: feedback ? "feedback" : "doc" });
const noun = (kind: TargetKind) => (kind === "process" ? "process" : "standard");

/** The name of the step or requirement a piece of feedback is about. */
function partOf(o: Owned, itemId?: string): string {
  if (!itemId) return `The whole ${noun(o.kind)}`;
  if (o.kind === "process") {
    const steps = (o.doc as Process).steps ?? [];
    const i = steps.findIndex((s) => s.id === itemId);
    return i < 0 ? "A step that was removed" : `Step ${i + 1}: ${steps[i].title}`;
  }
  const r = ((o.doc as Standard).requirements ?? []).find((x) => x.id === itemId);
  return r ? `${r.id}: ${r.title}` : "A requirement that was removed";
}

/**
 * What the signed-in person answers for: the processes and standards of their teams and units,
 * what needs doing about them now, and how the rest stands.
 */
export function MinePage({ processes, standards, feedback, meta, onReviewed }: {
  processes: Process[]; standards: Standard[]; feedback: FeedbackByTarget;
  meta: Record<TargetKind, MetaById>;
  /** Records that this is still correct. Resolves to false when it could not be done (a notice says why). */
  onReviewed: (kind: TargetKind, id: string) => Promise<boolean>;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const actions = useFeedbackActions();
  const teams = useMemo(() => myTeams(perms), [perms]);
  const [team, setTeam] = useState<string | null>(null); // null: all of mine
  const [busy, setBusy] = useState<string | null>(null);
  const shown = team && teams.includes(team) ? [team] : teams;
  const { owned, tasks } = useMemo(() => responsibilities(shown, processes, standards, feedback), [shown, processes, standards, feedback]);

  const of = (...kinds: Task["kind"][]) => tasks.filter((t) => kinds.includes(t.kind));
  const overdue = of("review-overdue"), soon = of("review-soon"), open = of("feedback"), other = of("draft", "no-rhythm");
  const review = async (o: Owned) => {
    setBusy(o.kind + o.doc.id);
    try { await onReviewed(o.kind, o.doc.id); } finally { setBusy(null); }
  };
  const Icon = ({ o }: { o: Owned }) => (o.kind === "process" ? <Workflow size={15} aria-label="Process" /> : <ShieldCheck size={15} aria-label="Standard" />);

  if (teams.length === 0) {
    return (
      <div className="page mine">
        <h1>My responsibilities</h1>
        <p className="lead">Nothing is assigned to you. A process or standard becomes yours when an admin makes you <b>Owner</b> for the team or unit that owns it, or <b>Standards editor</b> for a unit.</p>
      </div>
    );
  }

  return (
    <div className="page mine">
      <header className="mine-head">
        <h1>My responsibilities</h1>
        <p className="lead">The processes and standards of {teams.length === 1 ? <b>{teamName(catalog, teams[0])}</b> : "your teams and units"}: what needs you now, and how everything else stands.</p>
        {teams.length > 1 && (
          <div className="chips" role="group" aria-label="Show what belongs to">
            <button className={`chip ${team === null ? "on" : ""}`} aria-pressed={team === null} onClick={() => setTeam(null)}>All of mine</button>
            {teams.map((t) => <button key={t} className={`chip ${team === t ? "on" : ""}`} aria-pressed={team === t} onClick={() => setTeam(t)}><Users size={13} />{teamName(catalog, t)}</button>)}
          </div>
        )}
      </header>

      <div className="stat-row">
        <div className={`stat ${overdue.length ? "bad" : soon.length ? "warn" : "good"}`}><strong>{overdue.length + soon.length}</strong><span>{overdue.length ? `reviews due, ${overdue.length} overdue` : "reviews due"}</span></div>
        <div className={`stat ${open.length ? "warn" : "good"}`}><strong>{open.length}</strong><span>open feedback</span></div>
        <div className="stat"><strong>{owned.filter((o) => o.status === "draft").length}</strong><span>drafts not yet published</span></div>
        <div className="stat"><strong>{owned.length}</strong><span>{owned.length === 1 ? "process or standard is yours" : "processes and standards are yours"}</span></div>
      </div>

      {tasks.length === 0 && owned.length > 0 && (
        <div className="check good banner"><CircleCheck size={16} /><span><b>Nothing needs you right now.</b> Every review is up to date and no feedback is waiting.</span></div>
      )}

      {(overdue.length > 0 || soon.length > 0) && (
        <section className="admin-card" aria-labelledby="mine-reviews">
          <h2 id="mine-reviews"><CalendarCheck size={16} />Reviews to do <span>{overdue.length + soon.length}</span></h2>
          <p className="muted small">Read it through. If something changed, correct it (or ask an editor to); then confirm that it is still correct.</p>
          <ul className="mine-list">
            {[...overdue, ...soon].map(({ item: o }) => (
              <li key={o.kind + o.doc.id}>
                <Icon o={o} />
                <span className="person"><a href={pageOf(o)}><strong>{o.doc.title}</strong></a><em>{teamName(catalog, o.team)}{o.doc.review?.lastReviewedAt ? ` · last reviewed ${o.doc.review.lastReviewedAt}${o.doc.review.reviewedBy ? ` by ${o.doc.review.reviewedBy}` : ""}` : " · never reviewed"}</em></span>
                <span className={`tier-tag review-${o.review.state}`}>{o.review.label}</span>
                <a className="btn small" href={pageOf(o)}>Read it<ArrowUpRight size={13} /></a>
                <button className="btn small primary" disabled={busy === o.kind + o.doc.id} onClick={() => review(o)} title={`Records today and your name as the review of this ${noun(o.kind)}`}><Check size={14} />Still correct</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {open.length > 0 && (
        <section className="admin-card" aria-labelledby="mine-feedback">
          <h2 id="mine-feedback"><Flag size={16} />Feedback waiting for you <span>{open.length}</span></h2>
          <p className="muted small">The oldest first. Fix what is wrong, then mark it as fixed: the person who reported it is told.</p>
          <ul className="mine-list feedback">
            {open.map(({ item: o, feedback: f }) => f && (
              <li key={f.id}>
                <Icon o={o} />
                <span className="person">
                  <a href={pageOf(o, true)}><strong>{o.doc.title}</strong></a>
                  <em>{partOf(o, f.itemId)}</em>
                  <span className="mine-quote"><span className="tier-tag">{FEEDBACK_KINDS[f.kind]?.label ?? f.kind}</span> “{f.text}”</span>
                  <em>{f.author.name} · {day(f.createdAt)}{f.alsoHit > 0 ? ` · ${f.alsoHit} more hit this too` : ""}</em>
                </span>
                {f.stale && <span className="tier-tag review-soon" title="The step or requirement was changed after this was written">May already be fixed</span>}
                <a className="btn small" href={pageOf(o, true)}>Open<ArrowUpRight size={13} /></a>
                {f.canManage && <button className="btn small primary" onClick={() => actions.resolve(f, true)}><Check size={14} />Mark as fixed</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {other.length > 0 && (
        <section className="admin-card" aria-labelledby="mine-other">
          <h2 id="mine-other"><PencilLine size={16} />Unfinished <span>{other.length}</span></h2>
          <ul className="mine-list">
            {other.map(({ kind, item: o }) => (
              <li key={kind + o.kind + o.doc.id}>
                <Icon o={o} />
                <span className="person"><a href={pageOf(o)}><strong>{o.doc.title}</strong></a>
                  <em>{kind === "draft" ? "A draft: readers do not see it until its status is set to Active." : "In use, but nobody is asked to review it: no review rhythm is set in Details."}</em></span>
                <span className={`tier-tag ${kind === "draft" ? "status-draft" : "review-soon"}`}>{kind === "draft" ? "Draft" : "No review rhythm"}</span>
                <a className="btn small" href={pageOf(o)}>Open<ArrowUpRight size={13} /></a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="admin-card" aria-labelledby="mine-all">
        <h2 id="mine-all">Everything that is yours <span>{owned.length}</span></h2>
        {owned.length === 0 && <p className="muted">{teams.map((t) => teamName(catalog, t)).join(", ")} {teams.length === 1 ? "does" : "do"} not own a process or standard yet.</p>}
        {owned.length > 0 && (
          <div className="mine-table-wrap">
            <table className="mine-table">
              <thead><tr><th>Name</th><th>Owned by</th><th>Status</th><th>Review</th><th>Open feedback</th><th>Last change</th></tr></thead>
              <tbody>
                {owned.map((o) => {
                  const m: DocMeta | undefined = meta[o.kind][o.doc.id];
                  return (
                    <tr key={o.kind + o.doc.id}>
                      <td><a href={pageOf(o)}><Icon o={o} />{o.doc.title}</a></td>
                      <td>{teamName(catalog, o.team)}</td>
                      <td>{o.status === "active" ? "In use" : <span className={`tier-tag status-${o.status}`}>{STATUS_LABEL[o.status]}</span>}</td>
                      <td>{o.review.state === "ok" ? o.review.label : o.review.state === "none" ? <span className="muted">—</span> : <span className={`tier-tag review-${o.review.state}`}>{o.review.label}</span>}</td>
                      <td>{o.open.length ? <a href={pageOf(o, true)} className="tier-tag flagged">{o.open.length} open</a> : <span className="muted">none</span>}</td>
                      <td>{m ? <>Version {m.version} · {day(m.updatedAt)}<br /><span className="muted">{m.updatedBy}</span></> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
