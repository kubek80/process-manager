import { ArrowUpRight, ConciergeBell, ExternalLink } from "lucide-react";
import "../services.css";
import { useCatalog } from "../lib/catalog";
import { formWords, serviceOf } from "../lib/services";
import { href } from "../lib/store";
import { GroupLink } from "./GroupParts";

/**
 * The service a step requests, as a box in the step (the step's panel, the checklist, print): its
 * name, which leads to its page, the team that performs it and the button that opens its
 * front-door form. One no longer in the lists says so.
 */
export function ServiceBox({ id }: { id: string }) {
  const { catalog } = useCatalog();
  const s = serviceOf(catalog, id);
  if (!s) return <div className="svc-box missing"><ConciergeBell size={16} aria-hidden="true" /><p className="muted small">This step requests a service that is not listed any more (“{id}”).</p></div>;
  const team = catalog.teams.find((t) => t.id === s.team);
  return (
    <div className="svc-box">
      <div className="svc-box-head">
        <ConciergeBell size={16} aria-hidden="true" />
        <div>
          <span className="muted small">Requests the service</span>
          <a className="svc-box-name" href={href({ page: "service", id: s.id })}><strong>{s.name}</strong><ArrowUpRight size={13} aria-hidden="true" /></a>
          <span className="svc-box-team small">Performed by {team ? <GroupLink kind="team" id={team.id}>{team.name}</GroupLink> : s.team}</span>
        </div>
      </div>
      {s.summary && <p className="svc-box-summary small">{s.summary}</p>}
      <a className="btn link-btn svc-request" href={s.form} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />{formWords(s)}</a>
    </div>
  );
}
