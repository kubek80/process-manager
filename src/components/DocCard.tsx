import { Fragment } from "react";
import { CircleAlert, MessageSquare, MessageSquarePlus, PencilLine, ShieldCheck, Workflow } from "lucide-react";
import type { DocMeta, Process, Rigour, Standard, TargetKind } from "../types";
import { useCatalog } from "../lib/catalog";
import { cardLines, tiersText } from "../lib/cardLines";
import { statusOf } from "../lib/lifecycle";
import { matchRanges, NO_CATEGORY_LABEL, type Hit } from "../lib/search";
import { href } from "../lib/store";
import { BookmarkButton, UpvoteButton } from "./Engage";
import { useEngagement } from "../lib/engagement";
import { engagementKnown } from "./Lists";
import "../lists.css";

/** The text with the searched words marked; built as elements, never as HTML. */
export function Marked({ text, words }: { text: string; words: string[] }) {
  const ranges = matchRanges(text, words);
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(<Fragment key={`t${i}`}>{text.slice(at, a)}</Fragment>);
    out.push(<mark key={`m${i}`} className="search-mark">{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{out}</>;
}

export const KIND: Record<TargetKind, { word: string; Icon: typeof Workflow }> = {
  process: { word: "Process", Icon: Workflow },
  standard: { word: "Standard", Icon: ShieldCheck },
};
const HIT_WORD: Record<Hit["where"], string> = { step: "Step", requirement: "Requirement", prerequisite: "Before you start", scope: "Scope", summary: "Summary" };
/** Where a result was found, when it was searched for both ways. */
const FOUND_BY: Record<string, string> = { words: "Found by words", meaning: "Found by meaning", "meaning,words": "Found by words and by meaning" };

/** Where a process or standard opens; somebody who may fix a broken one gets its editing screen. */
export const docHref = (kind: TargetKind, id: string, fix = false) =>
  fix ? href({ page: kind === "process" ? "edit-process" : "edit-standard", id })
    : kind === "process" ? href({ page: "process", id, tab: "flow" }) : href({ page: "standard", id, tab: "doc" });

/** Where a place inside a document opens. */
function hitHref(kind: TargetKind, id: string, h: Hit): string {
  if (kind === "process") return href({ page: "process", id, tab: "flow", ...(h.where === "step" && h.item ? { item: h.item } : {}) });
  return href({ page: "standard", id, tab: "doc", ...(h.where === "requirement" && h.item ? { item: h.item } : {}) });
}

export interface DocCardProps {
  kind: TargetKind;
  doc: Process | Standard;
  rigour: Partial<Record<Rigour, number>>;
  rules: number;
  /** Where the searched words were found inside, with links to those places. */
  hits?: Hit[];
  words?: string[];
  openFeedback: number;
  /** The reader may change it: they see whether it needs fixing. */
  mayEdit: boolean;
  /** The reader looks after it (edits it, or owns its team): they see where its review stands. */
  manages?: boolean;
  /** What the server says about it: whether it has unpublished changes (sent only to its editors). */
  meta?: DocMeta;
  /** It has errors (shown only to those who may change it). */
  broken?: boolean;
  usedBy?: number;
  /** The level of the title; 2 on the lists, 3 under a heading of their own (Home). */
  level?: 2 | 3;
  /** Searched both ways: which of them found it. */
  foundBy?: ("words" | "meaning")[];
}

/**
 * One process or standard in a list: what it is, what it says, then one fact per line. The title
 * is the link; it covers the whole card for the mouse, while the links and buttons inside stay
 * separate and reachable with the keyboard (no link inside a link).
 */
export function DocCard({ kind, doc, rigour, rules, hits = [], words = [], openFeedback, mayEdit, manages, meta, broken, usedBy, level = 2, foundBy }: DocCardProps) {
  const { catalog } = useCatalog();
  const known = engagementKnown(useEngagement());
  const status = statusOf(doc);
  const fix = !!broken && mayEdit;
  const lines = cardLines({ kind, doc, catalog, rigour, rules, mayEdit: mayEdit || !!manages, usedBy });
  const changes = !!meta?.draft && status !== "draft";
  const { word, Icon } = KIND[kind];
  const title = typeof doc.title === "string" && doc.title ? doc.title : doc.id;
  const category = doc.category ? catalog.categories.find((c) => c.id === doc.category)?.name ?? doc.category : NO_CATEGORY_LABEL;
  const tiers = tiersText(doc, catalog);
  const H = level === 2 ? "h2" : "h3";
  const feedbackHref = kind === "process" ? href({ page: "process", id: doc.id, tab: "feedback" }) : href({ page: "standard", id: doc.id, tab: "feedback" });
  return (
    <li className={`card ${status === "deprecated" ? "retired" : ""} ${status === "draft" ? "draft" : ""}`.trim()} data-kind={kind} data-id={doc.id}>
      <div className="card-top">
        <span className="card-eyebrow">
          <span className={`kind-tag ${kind}`}><Icon size={13} aria-hidden="true" /><span className="card-kind">{word}</span></span>
          <span className="card-cat">{category}</span>
        </span>
        <span className={`card-tiers ${doc.tiers?.length ? "some" : ""}`} title="Application tiers it applies to">
          <span className="sr-only">Applies to: </span>{tiers}
        </span>
      </div>
      {(status !== "active" || fix || changes) && (
        <div className="card-marks">
          {status === "draft" && <span className="card-mark draft">Draft</span>}
          {status === "deprecated" && <span className="card-mark retired">Retired</span>}
          {changes && <span className="card-mark changes" title={`Saved by ${meta!.draft!.updatedBy}, not yet published`}><PencilLine size={12} aria-hidden="true" />Unpublished changes</span>}
          {fix && <span className="card-mark bad"><CircleAlert size={12} aria-hidden="true" />Needs fixing</span>}
        </div>
      )}
      <H className="card-title"><a className="card-link" href={docHref(kind, doc.id, fix)}><Marked text={title} words={words} /></a></H>
      {doc.summary && <p className="card-summary"><Marked text={doc.summary} words={words} /></p>}
      {lines.length > 0 && (
        <dl className="card-lines">
          {lines.map((l) => (
            <div key={l.key} className={`card-line ${l.warn ? "warn" : ""}`.trim()} data-line={l.key}>
              <dt>{l.name}:</dt><dd>{l.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {foundBy && foundBy.length > 0 && (
        <p className={`card-found-by ${foundBy.length > 1 ? "both" : foundBy[0]}`}>{FOUND_BY[[...foundBy].sort().join(",")]}</p>
      )}
      {hits.length > 0 && (
        <ul className="card-hits" aria-label={`Found in ${title}`}>
          {hits.map((h, i) => (
            <li key={`${h.where}:${h.item ?? i}`}>
              <a href={hitHref(kind, doc.id, h)}>
                <span className="card-hit-where">{HIT_WORD[h.where]}{h.where === "requirement" && h.item ? ` ${h.item}` : ""}</span>
                {h.where !== "scope" && h.where !== "summary" && <span className="card-hit-label"><Marked text={h.label} words={words} /></span>}
              </a>
              {h.snippet && <span className="card-hit-snippet"><Marked text={h.snippet} words={words} /></span>}
            </li>
          ))}
        </ul>
      )}
      {openFeedback > 0 && <p className="card-feedback"><MessageSquare size={14} aria-hidden="true" />{openFeedback} open feedback</p>}
      <div className="card-foot">
        <a className="card-give" href={feedbackHref} aria-label={`Give feedback on ${title}`}><MessageSquarePlus size={14} aria-hidden="true" />Give feedback</a>
        {/* until the upvotes and bookmarks are known, a 0 would look like a fact: kept in place, not shown */}
        <span className={`card-engage ${known ? "" : "pending"}`.trim()}>
          <UpvoteButton kind={kind} id={doc.id} title={title} />
          <BookmarkButton kind={kind} id={doc.id} title={title} />
        </span>
      </div>
    </li>
  );
}
