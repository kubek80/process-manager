import { useMemo, useState } from "react";
import { ArrowUpRight, Boxes, CalendarCheck, Check, CircleCheck, Compass, Flag, PencilLine, Users } from "lucide-react";
import type { DocMeta, FeedbackByTarget, Process, Standard, TargetKind } from "../types";
import { groupName, useCatalog } from "../lib/catalog";
import { STATUS_LABEL } from "../lib/lifecycle";
import { changedBy, groupKey, myGroups, responsibilities, type Group, type Owned, type Task } from "../lib/responsibilities";
import { useFeedbackActions, useMe, usePerms } from "../lib/session";
import { href, type MetaById } from "../lib/store";
import { FEEDBACK_KINDS } from "./Feedback";
import { KindTag } from "./marks";
import "../mine.css";

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");
const pageOf = (o: Owned, feedback = false) => href(o.kind === "process"
  ? { page: "process", id: o.doc.id, tab: feedback ? "feedback" : "flow" }
  : { page: "standard", id: o.doc.id, tab: feedback ? "feedback" : "doc" });
const editPage = (o: Owned) => href(o.kind === "process" ? { page: "edit-process", id: o.doc.id } : { page: "edit-standard", id: o.doc.id });
const noun = (kind: TargetKind) => (kind === "process" ? "process" : "standard");
const GROUP_ICON = { team: Users, platform: Boxes, practice: Compass };
const GROUP_TITLE = { team: "Team", platform: "Platform", practice: "Practice" };

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
 * What the signed-in person answers for: what their teams maintain and what belongs to their
 * platforms and practices, what needs doing about it now, and how the rest stands.
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
  const groups = useMemo(() => myGroups(perms), [perms]);
  const [group, setGroup] = useState<string | null>(null); // a groupKey; null: all of mine
  const [busy, setBusy] = useState<string | null>(null);
  const only = group && groups.some((g) => groupKey(g) === group) ? group : null;
  const nameOf = (g: Group) => groupName(catalog, g.kind, g.id);
  const via = (o: Owned) => o.groups.map(nameOf).join(", ");
  const { owned, tasks } = useMemo(() => responsibilities(perms, only, processes, standards, feedback, undefined, meta), [perms, only, processes, standards, feedback, meta]);

  const of = (...kinds: Task["kind"][]) => tasks.filter((t) => kinds.includes(t.kind));
  const overdue = of("review-overdue"), soon = of("review-soon"), open = of("feedback"), other = of("draft", "no-rhythm");
  // published, with changes saved beside it that readers do not see yet (only sent to whoever may edit it)
  const workingDraft = (o: Owned) => (o.status === "draft" ? undefined : meta[o.kind][o.doc.id]?.draft);
  const changed = owned.filter((o) => workingDraft(o));
  const review = async (o: Owned) => {
    setBusy(o.kind + o.doc.id);
    try { await onReviewed(o.kind, o.doc.id); } finally { setBusy(null); }
  };
  const Icon = ({ o }: { o: Owned }) => <KindTag kind={o.kind} />;
  // names the page knows, by email: the signed-in person, whoever gave feedback, whoever saved unpublished changes
  const me = useMe();
  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const list of [...Object.values(feedback.process), ...Object.values(feedback.standard)]) for (const f of list) if (f.author.email && f.author.name) out[f.author.email.toLowerCase()] = f.author.name;
    for (const k of ["process", "standard"] as const) for (const m of Object.values(meta[k])) if (m.draft?.updatedByName) out[m.draft.updatedBy.toLowerCase()] = m.draft.updatedByName;
    if (me.user) out[me.user.email.toLowerCase()] = me.user.name;
    return out;
  }, [feedback, meta, me.user]);

  if (groups.length === 0) {
    return (
      <div className="page mine">
        <h1>My responsibilities</h1>
        <p className="lead">Nothing is assigned to you. A process or standard becomes yours in one of these ways, each given by an admin:</p>
        <ul className="mine-ways">
          <li><Users size={15} /><span>You are <b>Owner</b> of the team that maintains it: you confirm its reviews and answer its feedback.</span></li>
          <li><Boxes size={15} /><span>You are <b>Platform owner</b> of the platform it belongs to: you may also change it.</span></li>
          <li><Compass size={15} /><span>You are <b>Practice owner</b> of the practice it belongs to: you may also change it.</span></li>
        </ul>
        <p className="muted">Who belongs to which team, platform and practice is shown under <a href={href({ page: "catalog" })}>Teams &amp; tools</a>.</p>
      </div>
    );
  }

  return (
    <div className="page mine">
      <header className="mine-head">
        <h1>My responsibilities</h1>
        <p className="lead">The processes and standards of {groups.length === 1 ? <b>{nameOf(groups[0])}</b> : "your teams, platforms and practices"}: what needs you now, and how everything else stands.</p>
        {groups.length > 1 && (
          <div className="seg mine-groups" role="group" aria-label="Show what belongs to">
            <button className={`seg-item ${only === null ? "on" : ""}`} aria-pressed={only === null} onClick={() => setGroup(null)}>All of mine</button>
            {groups.map((g) => {
              const Icon = GROUP_ICON[g.kind];
              return <button key={groupKey(g)} className={`seg-item ${only === groupKey(g) ? "on" : ""}`} aria-pressed={only === groupKey(g)} title={GROUP_TITLE[g.kind]} onClick={() => setGroup(groupKey(g))}><Icon size={13} aria-label={GROUP_TITLE[g.kind]} />{nameOf(g)}</button>;
            })}
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
                <span className="person"><a href={pageOf(o)}><strong>{o.doc.title}</strong></a><em>{via(o)}{o.doc.review?.lastReviewedAt ? ` · last reviewed ${o.doc.review.lastReviewedAt}${o.doc.review.reviewedBy ? ` by ${o.doc.review.reviewedBy}` : ""}` : o.review.first ? " · not reviewed since it was first published" : " · not reviewed yet"}</em></span>
                <span className={`tier-tag review-${o.review.state}`}>{o.review.label}</span>
                <a className="btn small" href={pageOf(o)}>Read it<ArrowUpRight size={13} /></a>
                <button className="btn small" disabled={busy === o.kind + o.doc.id} onClick={() => review(o)} title={`Records today and your name as the review of this ${noun(o.kind)}`}><Check size={14} />Still correct</button>
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
                {f.canManage && <button className="btn small" onClick={() => actions.resolve(f, true)}><Check size={14} />Mark as fixed</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {other.length + changed.length > 0 && (
        <section className="admin-card" aria-labelledby="mine-other">
          <h2 id="mine-other"><PencilLine size={16} />Unfinished <span>{other.length + changed.length}</span></h2>
          <ul className="mine-list">
            {changed.map((o) => {
              const d = workingDraft(o)!;
              return (
                <li key={"changes" + o.kind + o.doc.id} className="mine-changes">
                  <Icon o={o} />
                  <span className="person"><a href={pageOf(o)}><strong>{o.doc.title}</strong></a>
                    <em>Changed by {d.updatedByName || changedBy(d.updatedBy, names)} on <span className="nowrap">{day(d.updatedAt)}</span>. Readers still see version {meta[o.kind][o.doc.id]?.version}.</em></span>
                  <span className="tier-tag unpublished">Unpublished changes</span>
                  <a className="btn small" href={editPage(o)}>Continue editing<ArrowUpRight size={13} /></a>
                </li>
              );
            })}
            {other.map(({ kind, item: o }) => (
              <li key={kind + o.kind + o.doc.id}>
                <Icon o={o} />
                <span className="person"><a href={pageOf(o)}><strong>{o.doc.title}</strong></a>
                  <em>{kind === "draft" ? "A draft: readers do not see it until it is published." : "In use, but nobody is asked to review it: no review rhythm is set under About when editing it."}</em></span>
                <span className={`tier-tag ${kind === "draft" ? "status-draft" : "review-soon"}`}>{kind === "draft" ? "Draft" : "No review rhythm"}</span>
                <a className="btn small" href={pageOf(o)}>Open<ArrowUpRight size={13} /></a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="admin-card" aria-labelledby="mine-all">
        <h2 id="mine-all">Everything that is yours <span>{owned.length}</span></h2>
        {owned.length === 0 && <p className="muted">Nothing belongs to {(only ? groups.filter((g) => groupKey(g) === only) : groups).map(nameOf).join(", ")} yet.</p>}
        {owned.length > 0 && (
          <div className="mine-table-wrap">
            <table className="mine-table">
              <thead><tr><th>Name</th><th>Yours through</th><th>Status</th><th>Review</th><th>Open feedback</th><th>Last change</th></tr></thead>
              <tbody>
                {owned.map((o) => {
                  const m: DocMeta | undefined = meta[o.kind][o.doc.id];
                  return (
                    <tr key={o.kind + o.doc.id}>
                      <td><span className="mine-name"><Icon o={o} /><a href={pageOf(o)}>{o.doc.title}</a></span></td>
                      <td>{via(o)}</td>
                      <td>{o.status === "active" ? "In use" : <span className={`tier-tag status-${o.status}`}>{STATUS_LABEL[o.status]}</span>}{workingDraft(o) && <> <span className="tier-tag unpublished" title={`Changed by ${workingDraft(o)!.updatedByName || changedBy(workingDraft(o)!.updatedBy, names)} on ${day(workingDraft(o)!.updatedAt)}`}>Unpublished changes</span></>}</td>
                      <td className="nowrap">{o.review.state === "ok" ? o.review.label : o.review.state === "none" ? <span className="muted">—</span> : <span className={`tier-tag review-${o.review.state}`}>{o.review.label}</span>}</td>
                      <td>{o.open.length ? <a href={pageOf(o, true)} className="tier-tag flagged">{o.open.length} open</a> : <span className="muted">none</span>}</td>
                      <td className="mine-when">{m ? <><span className="nowrap">Version {m.version} · {day(m.updatedAt)}</span><br /><span className="muted" title={m.updatedBy}>{changedBy(m.updatedBy, names)}</span></> : <span className="muted">—</span>}</td>
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
