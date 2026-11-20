import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Ban, CalendarClock, Check, ChevronUp, CircleCheck, Lightbulb, Plus, RotateCcw, ShieldCheck, Trash2, Undo2, Workflow } from "lucide-react";
import type { Process, Standard, TargetKind } from "../types";
import { platformName, practiceName, useCatalog } from "../lib/catalog";
import {
  ACTION_LABEL, answerChoices, answerOf, filterRequests, REQUEST_FILTERS, requestProblems, similarTitles, STATE_LABEL, stateCounts, TEXT_MAX, TITLE_MAX, toggledVote,
  type DocRequest, type NewRequest, type RequestFilter, type RequestState,
} from "../lib/requests";
import { createRequest, go, href, loadRequests, setRequestState, voteRequest, withdrawRequest } from "../lib/store";
import { usePerms } from "../lib/session";
import { confirmDialog, Field, LoadError, Loading, Modal, notify } from "./ui";
import { KindTag } from "./marks";
import "../requests.css";
import { formatDate } from "../lib/dates";

const NOUN: Record<TargetKind, string> = { process: "process", standard: "standard" };
const day = formatDate;
const docHref = (kind: TargetKind, id: string) => href(kind === "process" ? { page: "process", id, tab: "flow" } : { page: "standard", id, tab: "doc" });
const KindIcon = ({ kind, size = 14 }: { kind: TargetKind; size?: number }) => (kind === "process" ? <Workflow size={size} aria-hidden="true" /> : <ShieldCheck size={size} aria-hidden="true" />);

/**
 * Requests for processes and standards that do not exist yet: anyone asks and votes, whoever
 * could make it plans it, links what answers it, or says why not. Most wanted first.
 */
export function RequestsPage({ state, kind, processes, standards }: {
  state?: RequestFilter; kind?: TargetKind; processes: Process[]; standards: Standard[];
}) {
  const filter: RequestFilter = state ?? "open";
  const [requests, setRequests] = useState<DocRequest[] | null>(null);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  const [changing, setChanging] = useState<{ request: DocRequest; to: RequestState } | null>(null);
  const voting = useRef(new Set<number>()); // one vote on its way per request

  const load = useCallback(() => { setError(""); loadRequests().then(setRequests, (e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  const put = (r: DocRequest) => setRequests((list) => list && (list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [r, ...list]));
  const view = (s: RequestFilter, k?: TargetKind) => go({ page: "requests", ...(s !== "open" ? { state: s } : {}), ...(k ? { kind: k } : {}) }, { replace: true });

  // shown at once; put back as it was when the server refuses
  const vote = async (r: DocRequest) => {
    if (voting.current.has(r.id)) return;
    voting.current.add(r.id);
    const on = !r.votedByMe;
    put(toggledVote(r));
    try {
      const votes = await voteRequest(r.id, on);
      setRequests((list) => list && list.map((x) => (x.id === r.id ? { ...x, votes, votedByMe: on } : x)));
    } catch (e) {
      setRequests((list) => list && list.map((x) => (x.id === r.id ? { ...x, votes: r.votes, votedByMe: r.votedByMe } : x)));
      notify.error(on ? "Your vote could not be recorded." : "Your vote could not be taken back.", e);
    } finally { voting.current.delete(r.id); }
  };

  const withdraw = async (r: DocRequest) => {
    const yes = await confirmDialog({
      title: "Withdraw your request?", body: <>“{r.title}” is removed for everyone, with its votes. You can ask again later.</>,
      confirmLabel: "Withdraw request", danger: true,
    });
    if (!yes) return;
    try {
      await withdrawRequest(r.id);
      setRequests((list) => list && list.filter((x) => x.id !== r.id));
      notify.info("Your request was withdrawn.");
    } catch (e) { notify.error("The request could not be withdrawn.", e); }
  };

  // admins only, in any state: gone for good, with its votes
  const remove = async (r: DocRequest) => {
    const yes = await confirmDialog({
      title: "Remove this request?", body: <>“{r.title}” is removed for everyone, together with its {r.votes} {r.votes === 1 ? "vote" : "votes"}. This cannot be undone.</>,
      confirmLabel: "Remove request", danger: true,
    });
    if (!yes) return;
    try {
      await withdrawRequest(r.id);
      setRequests((list) => list && list.filter((x) => x.id !== r.id));
      notify.info("The request was removed.");
    } catch (e) { notify.error("The request could not be removed.", e); }
  };

  const reopen = async (r: DocRequest) => {
    try { put(await setRequestState(r.id, { state: "open" })); notify.info(`“${r.title}” is open again.`); } catch (e) { notify.error("The request could not be changed.", e); }
  };

  const counts = useMemo(() => stateCounts(requests ?? [], kind), [requests, kind]);
  const shown = useMemo(() => filterRequests(requests ?? [], filter, kind), [requests, filter, kind]);

  return (
    <div className="page requests">
      <header className="req-hero">
        <div>
          <h1>Requests</h1>
          <p className="lead">Missing a process or standard? Ask for it, and vote for what others asked for: the most wanted come first. Whoever looks after that kind of content plans it, makes it, or says why not.</p>
        </div>
        <button className="btn primary" onClick={() => setAsking(true)}><Plus size={16} />Ask for a process or standard</button>
      </header>

      <div className="req-filters">
        <div className="seg" role="group" aria-label="State">
          {REQUEST_FILTERS.map((s) => (
            <button key={s} className={`seg-item ${filter === s ? "on" : ""}`} aria-pressed={filter === s} onClick={() => view(s, kind)}>
              {STATE_LABEL[s]}{requests && <span className="seg-n">{counts[s]}</span>}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Kind">
          {([undefined, "process", "standard"] as const).map((k) => (
            <button key={k ?? "all"} className={`seg-item ${kind === k ? "on" : ""}`} aria-pressed={kind === k} onClick={() => view(filter, k)}>
              {k && <KindIcon kind={k} />}{k === undefined ? "Processes and standards" : k === "process" ? "Processes" : "Standards"}
            </button>
          ))}
        </div>
      </div>

      {error && <LoadError what="The requests could not be loaded." error={error} onRetry={load} />}
      {!requests && !error && <Loading />}
      {requests && shown.length === 0 && (
        <div className="req-empty">
          <Lightbulb size={22} aria-hidden="true" />
          {requests.length === 0
            ? <p><b>Nothing has been asked for yet.</b> Missing a process or a standard? Be the first to ask: others can vote for it.</p>
            : <p><b>No {filter === "all" ? "" : `${STATE_LABEL[filter].toLowerCase()} `}requests{kind ? ` for ${kind === "process" ? "processes" : "standards"}` : ""}.</b> {filter === "open" ? "Missing something? Ask for it." : "Choose another state above to see the others."}</p>}
          <button className="btn" onClick={() => setAsking(true)}><Plus size={15} />Ask for a process or standard</button>
        </div>
      )}
      {requests && shown.length > 0 && (
        <ul className="req-list" aria-label="Requests">
          {shown.map((r) => (
            <RequestItem key={r.id} r={r} showState={filter === "all"} processes={processes} standards={standards}
              onVote={() => vote(r)} onWithdraw={() => withdraw(r)} onRemove={() => remove(r)} onReopen={() => reopen(r)} onChange={(to) => setChanging({ request: r, to })} />
          ))}
        </ul>
      )}

      {asking && (
        <AskDialog processes={processes} standards={standards} requests={requests ?? []} onVote={vote} onClose={() => setAsking(false)}
          onSent={(r) => {
            put(r); setAsking(false);
            if (filter !== "open" && filter !== "all") view("open", kind && kind !== r.kind ? undefined : kind);
            notify.info("Your request was sent. Others can now vote for it.");
          }} />
      )}
      {changing && (
        <StateDialog request={changing.request} to={changing.to} processes={processes} standards={standards}
          onClose={() => setChanging(null)} onDone={(r) => { put(r); setChanging(null); }} />
      )}
    </div>
  );
}

function RequestItem({ r, showState, processes, standards, onVote, onWithdraw, onRemove, onReopen, onChange }: {
  /** Under "All" each request says its state; under one state's tab that would only repeat the tab. */
  showState: boolean;
  r: DocRequest; processes: Process[]; standards: Standard[];
  onVote: () => void; onWithdraw: () => void; onRemove: () => void; onReopen: () => void; onChange: (to: RequestState) => void;
}) {
  const { catalog } = useCatalog();
  // the server says who may move a request along (whoever could create what is asked for)
  const admin = usePerms().admin;
  const manage = r.canManage;
  const withdrawable = r.mine && r.state === "open";
  const removable = admin && !withdrawable;
  const answer = r.state === "done" ? answerOf(r, r.kind === "process" ? processes : standards) : null;
  const titleId = `req-${r.id}-title`;
  return (
    <li className={`req-item state-${r.state}`} aria-labelledby={titleId}>
      <button className={`req-vote ${r.votedByMe ? "on" : ""}`} aria-pressed={r.votedByMe}
        aria-label={`Vote for ${r.title}, ${r.votes} ${r.votes === 1 ? "vote" : "votes"}`}
        title={r.votedByMe ? "You voted for this. Press again to take your vote back." : "Vote: I need this too"} onClick={onVote}>
        <ChevronUp size={18} aria-hidden="true" /><b className="req-votes">{r.votes}</b>
      </button>
      <div className="req-body">
        <div className="req-tags">
          <KindTag kind={r.kind} />
          {showState && <span className={`tier-tag req-state state-${r.state}`}>{STATE_LABEL[r.state]}</span>}
          {r.mine && <span className="tier-tag req-mine">Yours</span>}
        </div>
        <h3 id={titleId} className="req-title">{r.title}</h3>
        <p className="req-text">{r.description}</p>
        <p className="req-meta muted">
          Asked by {r.requestedBy?.name || r.requestedBy?.email || "somebody"} on {day(r.createdAt)}
          {r.platform && <> · Platform: {platformName(catalog, r.platform)}</>}
          {r.practice && <> · Practice: {practiceName(catalog, r.practice)}</>}
        </p>
        {r.state === "planned" && (
          <p className="req-outcome planned"><CalendarClock size={15} aria-hidden="true" /><span><b>Planned</b>{r.stateBy && <> by {r.stateBy}</>}{r.stateAt && <> on {day(r.stateAt)}</>}{r.stateNote && <>: {r.stateNote}</>}</span></p>
        )}
        {r.state === "done" && (
          <p className="req-outcome done"><CircleCheck size={15} aria-hidden="true" /><span><b>Done:</b>{" "}
            {answer?.kind === "doc" && <a className="req-answer" href={docHref(r.kind, answer.id)}><KindIcon kind={r.kind} />{answer.title}<ArrowUpRight size={13} aria-hidden="true" /></a>}
            {answer?.kind === "gone" && <span className="req-gone">the {NOUN[r.kind]} that answered it has been removed since.</span>}
            {answer?.kind === "unknown" && <span className="req-gone">answered by “{answer.id}”, which is not available to you (it may have been removed).</span>}
            {answer?.kind === "none" && "made"}
            {r.stateNote && <> · {r.stateNote}</>}{r.stateBy && <span className="muted"> · {r.stateBy}{r.stateAt && `, ${day(r.stateAt)}`}</span>}</span></p>
        )}
        {r.state === "declined" && (
          <p className="req-outcome declined"><Ban size={15} aria-hidden="true" /><span><b>Declined</b>{r.stateBy && <> by {r.stateBy}</>}{r.stateAt && <> on {day(r.stateAt)}</>}: {r.stateNote || "no reason given"}</span></p>
        )}
        {(manage || withdrawable || removable) && (
          <div className="req-actions">
            {manage && r.state === "open" && <button className="btn small" onClick={() => onChange("planned")}><CalendarClock size={14} />{ACTION_LABEL.planned}</button>}
            {manage && (r.state === "open" || r.state === "planned") && <>
              <button className="btn small" onClick={() => onChange("done")}><Check size={14} />{ACTION_LABEL.done}</button>
              <button className="btn small" onClick={() => onChange("declined")}><Ban size={14} />{ACTION_LABEL.declined}</button>
            </>}
            {manage && r.state !== "open" && <button className="btn small ghost" onClick={onReopen}><RotateCcw size={14} />{ACTION_LABEL.open}</button>}
            {withdrawable && <button className="btn small ghost danger" onClick={onWithdraw}><Undo2 size={14} />{ACTION_LABEL.withdraw}</button>}
            {removable && <button className="btn small ghost danger" onClick={onRemove} title="Admins only: removes the request for good, with its votes"><Trash2 size={14} />{ACTION_LABEL.remove}</button>}
          </div>
        )}
      </div>
    </li>
  );
}

/** Asking for something new, after a look at what exists and what others already asked for. */
function AskDialog({ processes, standards, requests, onVote, onSent, onClose }: {
  processes: Process[]; standards: Standard[]; requests: DocRequest[];
  onVote: (r: DocRequest) => void; onSent: (r: DocRequest) => void; onClose: () => void;
}) {
  const { catalog } = useCatalog();
  const [draft, setDraft] = useState<NewRequest>({ kind: "process", title: "", description: "", platform: "", practice: "" });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const set = (p: Partial<NewRequest>) => { setDraft((d) => ({ ...d, ...p })); setRefused(""); };
  const problems = requestProblems(draft);
  const ok = !problems.title && !problems.description;

  // what exists already, and what is asked for and not yet answered
  const { docs: similarDocs, asked: similarAsked } = useMemo(() => {
    if (draft.title.trim().length < 3) return { docs: [], asked: [] };
    const docs = [
      ...processes.map((d) => ({ kind: "process" as const, id: d.id, title: d.title })),
      ...standards.map((d) => ({ kind: "standard" as const, id: d.id, title: d.title })),
    ];
    const asked = requests.filter((r) => r.state === "open" || r.state === "planned");
    return { docs: similarTitles(draft.title, docs, 4).map((s) => s.item), asked: similarTitles(draft.title, asked, 4).map((s) => s.item) };
  }, [draft.title, processes, standards, requests]);

  const send = async () => {
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    try {
      onSent(await createRequest({
        kind: draft.kind, title: draft.title.trim(), description: draft.description.trim(),
        ...(draft.platform ? { platform: draft.platform } : {}), ...(draft.practice ? { practice: draft.practice } : {}),
      }));
    } catch (e) { setRefused(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <Modal wide title="Ask for a process or standard" subtitle="Say what is missing and why. Everyone can see your request and vote for it." onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (tried && !ok)} onClick={send}>Send request</button></>}>
      <form className="form req-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="field">
          <span className="field-label" id="req-kind-label">What is missing</span>
          <div className="chips" role="group" aria-labelledby="req-kind-label">
            {(["process", "standard"] as const).map((k) => (
              <button type="button" key={k} className={`chip ${draft.kind === k ? "on" : ""}`} aria-pressed={draft.kind === k} onClick={() => set({ kind: k })}>
                <KindIcon kind={k} />{k === "process" ? "A process: how to get something done" : "A standard: a rule to follow"}
              </button>
            ))}
          </div>
        </div>
        <Field label="Name" hint={draft.kind === "process" ? "for example: Request a Kafka topic" : "for example: Retention of log data"}>
          <input data-autofocus value={draft.title} maxLength={TITLE_MAX} aria-invalid={tried && !!problems.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        {tried && problems.title && <p className="field-error">{problems.title}</p>}

        <div className="req-similar" aria-live="polite">
          {(similarDocs.length > 0 || similarAsked.length > 0) && <>
            <p><b>Is it one of these?</b> Then open it, or vote for the request instead of asking twice.</p>
            <ul>
              {similarDocs.map((d) => (
                <li key={`d-${d.kind}-${d.id}`}>
                  <KindIcon kind={d.kind} />
                  <a href={docHref(d.kind, d.id)} target="_blank" rel="noreferrer">{d.title}</a>
                  <span className="muted">{d.kind === "process" ? "Process" : "Standard"} · exists</span>
                </li>
              ))}
              {similarAsked.map((r) => (
                <li key={`r-${r.id}`}>
                  <KindIcon kind={r.kind} />
                  <span className="req-similar-title">{r.title}</span>
                  <span className="muted">Asked for · {STATE_LABEL[r.state].toLowerCase()} · {r.votes} {r.votes === 1 ? "vote" : "votes"}</span>
                  <button type="button" className={`btn small ${r.votedByMe ? "accent-soft" : ""}`} aria-pressed={r.votedByMe} aria-label={`Vote for ${r.title}`} onClick={() => onVote(r)}>
                    <ChevronUp size={14} />{r.votedByMe ? "Voted" : "Vote for it"}
                  </button>
                </li>
              ))}
            </ul>
          </>}
        </div>

        <Field label="What is needed and why" hint={`${draft.description.trim().length} / ${TEXT_MAX}`}>
          <textarea rows={5} value={draft.description} maxLength={TEXT_MAX} aria-invalid={tried && !!problems.description}
            placeholder={draft.kind === "process" ? "What do you want to get done, and what goes wrong without a process today?" : "What should be the rule, and what risk or confusion does it prevent?"}
            onChange={(e) => set({ description: e.target.value })} />
        </Field>
        {tried && problems.description && <p className="field-error">{problems.description}</p>}
        <div className="req-belongs">
          <Field label="Platform" hint="optional">
            <select value={draft.platform} onChange={(e) => set({ platform: e.target.value })}>
              <option value="">None or not sure</option>
              {catalog.platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Practice" hint="optional">
            <select value={draft.practice} onChange={(e) => set({ practice: e.target.value })}>
              <option value="">None or not sure</option>
              {catalog.practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        {refused && <LoadError what="The request was not sent." error={refused} />}
      </form>
    </Modal>
  );
}

/** Moving a request on: planned (with an optional note), done (with what answers it) or declined (with the reason). */
function StateDialog({ request, to, processes, standards, onClose, onDone }: {
  request: DocRequest; to: RequestState; processes: Process[]; standards: Standard[];
  onClose: () => void; onDone: (r: DocRequest) => void;
}) {
  // only what is published can answer it: the server refuses a draft
  const docs = useMemo(() => answerChoices<Process | Standard>(request.kind === "process" ? processes : standards), [request.kind, processes, standards]);
  const [note, setNote] = useState(to === "planned" ? request.stateNote : "");
  const [linked, setLinked] = useState(() => (docs.some((d) => d.id === request.linkedId) ? request.linkedId : similarTitles(request.title, docs, 1)[0]?.item.id || ""));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const ok = to === "declined" ? note.trim().length > 0 : to === "done" ? !!linked : true;
  const noun = NOUN[request.kind];
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true); setRefused("");
    try {
      onDone(await setRequestState(request.id, { state: to, ...(note.trim() ? { note: note.trim() } : {}), ...(to === "done" ? { linkedId: linked } : {}) }));
      notify.info(to === "done" ? "Marked as done. Everyone sees what answers it." : to === "planned" ? "Marked as planned." : "Declined. Everyone sees the reason.");
    } catch (e) { setRefused(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const label = ACTION_LABEL[to];
  return (
    <Modal title={label} subtitle={`“${request.title}”`} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className={`btn primary ${to === "declined" ? "danger" : ""}`} disabled={!ok || busy} onClick={save}>{label}</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {to === "done" && (
          <Field label={`The ${noun} that answers it`}>
            <select data-autofocus value={linked} onChange={(e) => setLinked(e.target.value)}>
              <option value="">Choose…</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </Field>
        )}
        {to === "done" && <p className="muted small">{docs.length ? `Only published ${noun === "process" ? "processes" : "standards"} are offered: a draft cannot answer a request until it is published.` : `There is no published ${noun} yet. Create and publish it first, then come back and mark this request as done.`}</p>}
        <Field label={to === "declined" ? "Why not" : "Note"} hint={to === "declined" ? "required: the person who asked and everyone who voted read it" : "optional, for example when to expect it"}>
          <textarea data-autofocus={to !== "done" ? "" : undefined} rows={3} value={note} maxLength={TEXT_MAX} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {refused && <LoadError what={to === "done" ? "The request was not marked as done." : "The request was not changed."} error={refused} />}
      </form>
    </Modal>
  );
}
