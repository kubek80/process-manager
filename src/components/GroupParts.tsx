import type { ReactNode } from "react";
import { BadgeCheck, BookOpen, ExternalLink, Globe, Hash, Mail, MessageSquare, UserCheck } from "lucide-react";
import type { Contacts, TargetKind } from "../types";
import { ownedBy, teamName, useCatalog } from "../lib/catalog";
import { contactView, groupEntry, OTHER_LABEL, rankText, splitOwnerLine, type ContactItem } from "../lib/groups";
import type { GroupKind, GroupRank } from "../lib/members";
import { href } from "../lib/store";
import "../group.css";

/**
 * The small parts that say something about a team, platform or practice wherever it is named: a
 * link to its page, the mark that says what the person signed in is there, and its contact details.
 */

/** The name of a team, platform or practice as a link to its page; plain text for one the lists do not have. */
export function GroupLink({ kind, id, children, className = "" }: { kind: GroupKind; id: string; children: ReactNode; className?: string }) {
  const { catalog } = useCatalog();
  if (!groupEntry(catalog, kind, id)) return <>{children}</>;
  return <a className={`group-link ${className}`.trim()} href={href({ page: "group", kind, id })}>{children}</a>;
}

/**
 * The category and the team that looks after a process or standard, in `ownedBy`'s words, with
 * the team's name a link to its page.
 */
export function OwnedBy({ kind, doc }: { kind: TargetKind; doc: { category?: string; owner?: string } }) {
  const { catalog } = useCatalog();
  const said = ownedBy(catalog, kind, doc);
  const { before, team } = splitOwnerLine(said, doc.owner ? teamName(catalog, doc.owner) : "");
  if (!team) return <>{said}</>;
  return <>{before}<GroupLink kind="team" id={doc.owner!}>{team}</GroupLink></>;
}

/** What the person signed in is in a group, as one small mark: "You are an owner" / "You are a member". */
export function RankMark({ rank, className = "" }: { rank: GroupRank | undefined; className?: string }) {
  const words = rankText(rank);
  if (!words) return null;
  const Icon = rank === "owner" ? BadgeCheck : UserCheck;
  return <span className={`rank-mark ${rank} ${className}`.trim()}><Icon size={13} aria-hidden="true" />{words}</span>;
}

/** Pages are links whose text is only their address: cut with "…" (the whole link is the tooltip). Emails and names wrap. */
const CUT: ContactItem["key"][] = ["confluence", "page"];

/**
 * The words of a contact link, and its "opens in a new tab" mark kept on the line of the last
 * character, whether the words are cut or wrap.
 */
function LinkText({ item: i }: { item: ContactItem }) {
  if (!i.external) return <span className="contact-text">{i.text}</span>;
  if (CUT.includes(i.key)) return <><span className="contact-text">{i.text}</span><ExternalLink size={12} aria-hidden="true" className="contact-out" /></>;
  return <span className="contact-text">{i.text.slice(0, -1)}<span className="contact-tail">{i.text.slice(-1)}<ExternalLink size={12} aria-hidden="true" className="contact-out" /></span></span>;
}

const ICON: Record<ContactItem["key"], typeof Mail> = { email: Mail, slack: Hash, chat: MessageSquare, confluence: BookOpen, page: Globe };

/**
 * How to reach a team, platform or practice: the request form as the one marked way to ask them
 * for something, then each detail as what it is (a mail link, the channel or space, the pages),
 * the free line last. Nothing for what is empty; `empty` when nothing at all is known.
 */
export function ContactList({ entry, name, empty }: { entry: { contact?: string; contacts?: Contacts } | undefined; name: string; empty: ReactNode }) {
  const v = contactView(entry);
  if (v.none) return <p className="muted contact-none">{empty}</p>;
  return (
    <div className="contact-view">
      {v.form && (
        <div className="contact-form-box">
          <a className="btn primary contact-form" href={v.form} target="_blank" rel="noopener noreferrer" title={v.form} aria-describedby="contact-form-hint">
            Open the request form<ExternalLink size={14} aria-hidden="true" />
          </a>
          <span className="contact-form-hint" id="contact-form-hint">Where people ask them for something</span>
        </div>
      )}
      {v.form && <p className="contact-form-print">Request form: {v.form}</p>}
      {(v.items.length > 0 || v.other) && (
        <dl className="contact-list">
          {v.items.map((i) => {
            const Icon = ICON[i.key];
            return (
              <div key={i.key} className={`contact-row ${CUT.includes(i.key) ? "cut" : "wraps"}`} data-contact={i.key}>
                <dt><Icon size={14} aria-hidden="true" />{i.label}</dt>
                <dd>{i.href
                  ? <a href={i.href} title={i.href.replace(/^mailto:/, "")} className="contact-link" {...(i.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}><LinkText item={i} /></a>
                  : i.text}</dd>
              </div>
            );
          })}
          {v.other && (
            <div className="contact-row" data-contact="other">
              <dt>{OTHER_LABEL}</dt>
              <dd className="contact-other">{v.other}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
