import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, ConciergeBell, ExternalLink, PencilLine, Search } from "lucide-react";
import type { Process } from "../types";
import { useCatalog } from "../lib/catalog";
import { partOf } from "../lib/groups";
import { canManageLists } from "../lib/rights";
import { usePerms } from "../lib/session";
import { findServices, formWords, serviceOf, serviceTeams, serviceUses } from "../lib/services";
import { go, href, type ServicesView } from "../lib/store";
import { GroupLink, PartOf } from "./GroupParts";
import { RichText } from "./RichText";
import { itemWords } from "../lib/diff";
import "../group.css";
import "../services.css";

/** The quiet mark of a service: a word and a picture of its own, never the colours of processes or standards. */
export function ServiceMark() {
  return <span className="group-kind service-kind"><ConciergeBell size={14} aria-hidden="true" />Service</span>;
}

/**
 * The place Services: every service, found by its name, summary, team or description, and by the
 * team that performs it; each with the team as a link and the button that opens its front-door
 * form. The search and the team chosen are in the address.
 */
export function ServicesPage({ q, team }: ServicesView) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const [text, setText] = useState(q ?? "");
  // the address wins when it changes (Back, a link); typing changes the address in place
  useEffect(() => { setText(q ?? ""); }, [q]);
  const set = (next: ServicesView) => go({ page: "services", ...next }, { replace: true });
  const all = catalog.services ?? [];
  const teams = serviceTeams(catalog);
  const shown = findServices(catalog, text, team);
  const manager = canManageLists(perms);
  return (
    <div className="page services-page">
      <div className="head-row">
        <div className="head-text">
          <h1>Services</h1>
          <p className="lead">What teams do for others on request. Read what you get and what to prepare, then request it through its front-door form.</p>
        </div>
      </div>
      {all.length === 0 ? (
        <div className="svc-empty">
          <p>No services are listed yet.</p>
          {manager && <p className="muted">Add the first one in <a href={href({ page: "admin", section: "lists", place: "services" })}>Admin › Services</a>: its name, the team that performs it and its front-door form.</p>}
        </div>
      ) : (
        <>
          <div className="svc-bar">
            <div className="search"><Search size={15} aria-hidden="true" />
              <input value={text} onChange={(e) => { setText(e.target.value); set({ q: e.target.value, team }); }} placeholder="Search services: DNS, firewall, test…" aria-label="Search services" />
            </div>
            {/* a choice of team once more than one team performs services */}
            {teams.length > 1 && (
              <select aria-label="Performed by" value={team ?? ""} onChange={(e) => set({ q: text, team: e.target.value || undefined })}>
                <option value="">Any team</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.count})</option>)}
              </select>
            )}
          </div>
          <p className="svc-count muted" role="status">{shown.length === all.length ? `${all.length} service${all.length === 1 ? "" : "s"}` : `${shown.length} of ${all.length} services`}</p>
          {shown.length === 0
            ? <p className="muted svc-none">No service matches. Try fewer words{team ? ", or any team" : ""}.</p>
            : (
              <ul className="svc-list">
                {shown.map((s) => (
                  <li key={s.id} className="svc-card" data-id={s.id}>
                    <div className="svc-card-text">
                      <h2><a href={href({ page: "service", id: s.id })}>{s.name}</a></h2>
                      {s.summary && <p className="svc-summary">{s.summary}</p>}
                      <p className="svc-team">Performed by <GroupLink kind="team" id={s.team}>{catalog.teams.find((t) => t.id === s.team)?.name ?? s.team}</GroupLink></p>
                    </div>
                    <a className="btn svc-request" href={s.form} target="_blank" rel="noopener noreferrer">{formWords(s)}<ExternalLink size={14} aria-hidden="true" /></a>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}
    </div>
  );
}

/**
 * The page of one service: what it is, the team that performs it, the one main button that opens
 * its front-door form, its description and the processes whose steps request it.
 */
export function ServicePage({ id, processes }: { id: string; processes: Process[] }) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const s = serviceOf(catalog, id)!;
  const team = catalog.teams.find((t) => t.id === s.team);
  const uses = serviceUses(processes, id);
  return (
    <div className="page group-page service-page">
      <a className="back" href={href({ page: "services" })}><ArrowLeft size={16} aria-hidden="true" />Services</a>
      <header className="group-head">
        <div className="group-kicker"><ServiceMark /></div>
        <div className="group-title-row">
          <h1>{s.name}</h1>
          {canManageLists(perms) && <a className="btn" href={href({ page: "admin", section: "lists", place: "services", list: "services", id })}><PencilLine size={15} aria-hidden="true" />Edit in Admin › Services</a>}
        </div>
        {s.summary?.trim() ? <p className="lead group-lead">{s.summary}</p> : null}
        <div className="svc-facts">
          <p className="svc-team">Performed by {team ? <GroupLink kind="team" id={team.id}>{team.name}</GroupLink> : s.team}
            {team && partOf(catalog, team).length > 0 && <span className="svc-team-part"> · <PartOf pieces={partOf(catalog, team)} /></span>}</p>
          <a className="btn primary svc-request" href={s.form} target="_blank" rel="noopener noreferrer">{formWords(s)}<ExternalLink size={15} aria-hidden="true" /></a>
        </div>
      </header>

      <div className="svc-body">
        <section className="svc-description" aria-labelledby="svc-about">
          <h2 id="svc-about" className="group-h">About this service</h2>
          {s.description?.trim() ? <RichText html={s.description} /> : <p className="muted">No description yet.</p>}
        </section>
        <section className="svc-used" aria-labelledby="svc-used">
          <h2 id="svc-used" className="group-h">Used in</h2>
          {uses.length === 0
            ? <p className="muted">No process requests this service yet.</p>
            : (
              <ul className="svc-uses">
                {uses.map((u) => (
                  <li key={u.process.id}>
                    <a href={href({ page: "process", id: u.process.id, tab: "flow" })}><strong>{u.process.title}</strong>{u.retired && <em className="svc-retired"> (retired)</em>}</a>
                    <ul>
                      {u.steps.map((st) => (
                        <li key={st.id}><a href={href({ page: "process", id: u.process.id, tab: "flow", item: st.id })}>{itemWords({ what: `Step ${st.number}`, label: st.title })}<ArrowUpRight size={13} aria-hidden="true" /></a></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </div>
  );
}
