import { ArrowLeft, Network, PencilLine, UsersRound } from "lucide-react";
import type { FeedbackByTarget, Process, Standard, Team, Tribe } from "../types";
import { useCatalog } from "../lib/catalog";
import { CLUSTER_LIST, CLUSTER_WORD, clusterContents, clusterEmpty, clusterEntry, clusterFilter, domainOf, summaryLine, type ClusterKind } from "../lib/groups";
import { canManageLists } from "../lib/rights";
import { usePerms } from "../lib/session";
import type { MetaByKind } from "../lib/sorting";
import { href } from "../lib/store";
import { GroupDocs } from "./GroupPage";
import { GroupLink } from "./GroupParts";
import "../group.css";

const ICON: Record<ClusterKind, typeof Network> = { tribe: UsersRound, domain: Network };

/** A team as a row of the page: its name, which leads to its page, and the line Teams & tools says under it. */
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
 * lists gets "Edit in Admin › Lists".
 */
export function ClusterPage({ kind, id, processes, standards, feedback, meta }: {
  kind: ClusterKind; id: string; processes: Process[]; standards: Standard[]; feedback?: FeedbackByTarget; meta?: MetaByKind;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const entry = clusterEntry(catalog, kind, id)!;
  const Icon = ICON[kind];
  const contents = clusterContents(catalog, kind, id);
  const domain = kind === "tribe" ? domainOf(catalog, entry as Tribe) : undefined;
  const empty = clusterEmpty(kind, contents);
  return (
    <div className="page group-page cluster-page" data-group={kind}>
      <a className="back" href={href({ page: "catalog", list: CLUSTER_LIST[kind], id })}><ArrowLeft size={16} aria-hidden="true" />Teams &amp; tools</a>
      <header className="group-head">
        <div className="group-kicker">
          <span className="group-kind"><Icon size={14} aria-hidden="true" />{CLUSTER_WORD[kind]}</span>
        </div>
        <div className="group-title-row">
          <h1>{entry.name}</h1>
          {canManageLists(perms) && <a className="btn" href={href({ page: "admin", section: "lists", list: CLUSTER_LIST[kind], id })}><PencilLine size={15} aria-hidden="true" />Edit in Admin › Lists</a>}
        </div>
        {domain && <p className="group-part">Part of the domain <a href={href({ page: "domain", id: domain.id })}>{domain.name}</a></p>}
        {entry.description?.trim()
          ? <p className="lead group-lead">{entry.description}</p>
          : <p className="muted group-lead">No description yet.</p>}
      </header>

      <div className="group-body">
        <section className="group-reach cluster-members" aria-labelledby="cluster-members">
          <h2 id="cluster-members" className="group-h">{kind === "tribe" ? "Teams in this tribe" : "Tribes in this domain"}</h2>
          {kind === "tribe"
            ? (contents.teams.length ? <ul className="cluster-teams">{contents.teams.map((t) => <TeamRow key={t.id} team={t} />)}</ul> : <p className="muted cluster-empty">{empty}</p>)
            : contents.tribes.length
              ? contents.tribes.map(({ tribe, teams }) => (
                <div key={tribe.id} className="cluster-tribe">
                  <h3><a href={href({ page: "tribe", id: tribe.id })}>{tribe.name}</a></h3>
                  {teams.length ? <ul className="cluster-teams">{teams.map((t) => <TeamRow key={t.id} team={t} />)}</ul> : <p className="muted cluster-empty">No team is part of this tribe yet.</p>}
                </div>
              ))
              : <p className="muted cluster-empty">{empty}</p>}
        </section>

        <GroupDocs filters={clusterFilter(contents.teams)} heading={kind === "tribe" ? "What its teams look after" : "What the teams of its tribes look after"}
          empty={contents.teams.length ? "Its teams do not look after any process or standard yet." : empty}
          processes={processes} standards={standards} feedback={feedback} meta={meta} />
      </div>
    </div>
  );
}
