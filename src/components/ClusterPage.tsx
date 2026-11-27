import { ArrowLeft, Columns3, Network, PencilLine, UsersRound } from "lucide-react";
import type { FeedbackByTarget, Process, Standard, Team } from "../types";
import { useCatalog } from "../lib/catalog";
import { CLUSTER_LIST, CLUSTER_WORD, clusterContents, clusterEmpty, clusterEntry, clusterFilter, placeOf, summaryLine, type ClusterKind } from "../lib/groups";
import { canManageLists } from "../lib/rights";
import { usePerms } from "../lib/session";
import type { MetaByKind } from "../lib/sorting";
import { href } from "../lib/store";
import { GroupDocs } from "./GroupPage";
import { GroupLink, PartOf } from "./GroupParts";
import "../group.css";

const ICON: Record<ClusterKind, typeof Network> = { pillar: Columns3, tribe: UsersRound, domain: Network };
/** What the side list of each page is called, and what its teams look after. */
const MEMBERS: Record<ClusterKind, string> = { pillar: "Teams in this pillar", tribe: "Pillars in this tribe", domain: "Tribes in this domain" };
const OWN: Record<ClusterKind, string> = { pillar: "What its teams look after", tribe: "What the teams of its pillars look after", domain: "What the teams of its tribes look after" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A team as a row of the page: its name, which leads to its page, and the line the list of teams says under it. */
function TeamRow({ team }: { team: Team }) {
  return (
    <li className="cluster-team">
      <GroupLink kind="team" id={team.id}>{team.name}</GroupLink>
      <span className="cluster-team-line">{summaryLine(team)}</span>
    </li>
  );
}

/**
 * The page of a tribe (a group of teams) or a domain (a group of tribes): a sibling of the page of
 * a team, platform or practice, with its head, its body and what belongs to it (`GroupDocs`: what
 * its teams own, the same search and cards). A tribe or domain has no owners, members, contact
 * details or rights, so the parts of the team's page for those are not here; whoever manages the
 * lists gets "Edit in Admin › Teams".
 */
export function ClusterPage({ kind, id, processes, standards, feedback, meta }: {
  kind: ClusterKind; id: string; processes: Process[]; standards: Standard[]; feedback?: FeedbackByTarget; meta?: MetaByKind;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const entry = clusterEntry(catalog, kind, id)!;
  const Icon = ICON[kind];
  const contents = clusterContents(catalog, kind, id);
  const place = placeOf(catalog, kind, entry as { tribe?: string; domain?: string });
  const empty = clusterEmpty(kind, contents);
  return (
    <div className="page group-page cluster-page" data-group={kind}>
      <a className="back" href={href({ page: "catalog", list: CLUSTER_LIST[kind], id })}><ArrowLeft size={16} aria-hidden="true" />Teams</a>
      <header className="group-head">
        <div className="group-kicker">
          <span className="group-kind"><Icon size={14} aria-hidden="true" />{CLUSTER_WORD[kind]}</span>
        </div>
        <div className="group-title-row">
          <h1>{entry.name}</h1>
          {canManageLists(perms) && <a className="btn" href={href({ page: "admin", section: "lists", list: CLUSTER_LIST[kind], id })}><PencilLine size={15} aria-hidden="true" />Edit in Admin › Teams</a>}
        </div>
        {place.length > 0 && <p className="group-part"><PartOf pieces={place} /></p>}
        {entry.description?.trim()
          ? <p className="lead group-lead">{entry.description}</p>
          : <p className="muted group-lead">No description yet.</p>}
      </header>

      <div className="group-body">
        <section className="group-reach cluster-members" aria-labelledby="cluster-members">
          <h2 id="cluster-members" className="group-h">{MEMBERS[kind]}</h2>
          {/* a pillar: its teams; a tribe: its pillars with their teams; a domain: its tribes with their
              pillars and how many teams each has (the teams are on the pillar's page, one click away) */}
          {kind === "pillar" && (contents.teams.length ? <ul className="cluster-teams">{contents.teams.map((t) => <TeamRow key={t.id} team={t} />)}</ul> : <p className="muted cluster-empty">{empty}</p>)}
          {kind === "tribe" && (contents.pillars.length
            ? contents.pillars.map(({ pillar, teams }) => (
              <div key={pillar.id} className="cluster-tribe">
                <h3><a href={href({ page: "pillar", id: pillar.id })}>{pillar.name}</a></h3>
                {teams.length ? <ul className="cluster-teams">{teams.map((t) => <TeamRow key={t.id} team={t} />)}</ul> : <p className="muted cluster-empty">No team is part of this pillar yet.</p>}
              </div>
            ))
            : <p className="muted cluster-empty">{empty}</p>)}
          {kind === "domain" && (contents.tribes.length
            ? contents.tribes.map(({ tribe, pillars }) => (
              <div key={tribe.id} className="cluster-tribe">
                <h3><a href={href({ page: "tribe", id: tribe.id })}>{tribe.name}</a></h3>
                {pillars.length
                  ? <ul className="cluster-teams">{pillars.map(({ pillar, teams }) => (
                    <li key={pillar.id} className="cluster-team">
                      <a className="group-link" href={href({ page: "pillar", id: pillar.id })}>{pillar.name}</a>
                      <span className="cluster-team-line">{teams.length ? plural(teams.length, "team", "teams") : "No team yet"}</span>
                    </li>
                  ))}</ul>
                  : <p className="muted cluster-empty">No pillar is part of this tribe yet.</p>}
              </div>
            ))
            : <p className="muted cluster-empty">{empty}</p>)}
        </section>

        <GroupDocs filters={clusterFilter(contents.teams)} heading={OWN[kind]}
          empty={contents.teams.length ? "Its teams do not look after any process or standard yet." : empty}
          processes={processes} standards={standards} feedback={feedback} meta={meta} />
      </div>
    </div>
  );
}
