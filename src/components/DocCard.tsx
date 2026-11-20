import { Fragment } from "react";
import { CircleAlert, Clock3, Code2, Compass, CornerDownRight, Layers, ListChecks, MessageSquare, MessageSquarePlus, PencilLine, Server, UserCheck, Users } from "lucide-react";
import type { DocMeta, Process, Rigour, Standard, TargetKind } from "../types";
import { useCatalog } from "../lib/catalog";
import { cardGroups, cardLines, reviewMarkText, reviewOverdue, rigourParts, shortFact, tiersShort, type CardLine } from "../lib/cardLines";
import { statusOf } from "../lib/lifecycle";
import { author } from "../lib/editing";
import { matchRanges, NO_CATEGORY_LABEL, RIGOUR_LEVEL, type Hit } from "../lib/search";
import { href } from "../lib/store";
import type { ListView } from "../lib/paging";
import { BookmarkButton, UpvoteButton } from "./Engage";
import { EntryIcon } from "./EntryIcon";
import { useEngagement } from "../lib/engagement";
import { engagementKnown } from "./Lists";
import { Fact, KindIcon, KindTag, kindWord, LevelMark } from "./marks";
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

/** The word and icon of each kind (the tag itself is `KindTag` in marks.tsx). */
export const KIND: Record<TargetKind, { word: string; Icon: (p: { size?: number }) => React.ReactElement }> = {
  process: { word: kindWord("process"), Icon: ({ size }) => <KindIcon kind="process" size={size} /> },
  standard: { word: kindWord("standard"), Icon: ({ size }) => <KindIcon kind="standard" size={size} /> },
};
const HIT_WORD: Record<Hit["where"], string> = { step: "Step", requirement: "Requirement", prerequisite: "Before you start", scope: "Scope", summary: "Summary" };
/** Where a result was found, when it was searched for both ways: the heading of the place where it was found. */
const FOUND_BY: Record<string, string> = { words: "Found by words", meaning: "Found by meaning", "meaning,words": "Found by words and by meaning" };
/** How many places inside a card shows; the rest are counted ("2 more places"). */
const SHOWN_HITS = 2;

/** The icon of each fact on the card; the name of the fact is its tooltip and is read out. */
const FACT_ICON: Record<string, typeof Users> = {
  owner: Users, platform: Layers, practice: Compass, environments: Server, languages: Code2,
  lead: Clock3, steps: UserCheck, rules: ListChecks, usedBy: CornerDownRight,
};

/** Where a process or standard opens; somebody who may fix a broken one gets its editing screen. */
export const docHref = (kind: TargetKind, id: string, fix = false) =>
  fix ? href({ page: kind === "process" ? "edit-process" : "edit-standard", id })
    : kind === "process" ? href({ page: "process", id, tab: "flow" }) : href({ page: "standard", id, tab: "doc" });

/** Where a place inside a document opens. */
function hitHref(kind: TargetKind, id: string, h: Hit): string {
  if (kind === "process") return href({ page: "process", id, tab: "flow", ...(h.where === "step" && h.item ? { item: h.item } : {}) });
  return href({ page: "standard", id, tab: "doc", ...(h.where === "requirement" && h.item ? { item: h.item } : {}) });
}

/** The places worth showing: one that says only "Summary" or "Scope", with nothing of its text, tells nothing. */
export const placesOf = (hits: Hit[]) => hits.filter((h) => (h.where !== "summary" && h.where !== "scope") || h.snippet);

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
  /** The kind tag: where kinds are mixed (search, Home); a list of one kind leaves it out. */
  showKind?: boolean;
  /** A card, or one row (for scanning many). */
  view?: ListView;
}

/** How binding it is, in its own words: "Mandatory" for a process, "4 must · 1 should" for a standard. */
function Levels({ kind, rigour }: { kind: TargetKind; rigour: Partial<Record<Rigour, number>> }) {
  const parts = rigourParts(rigour);
  if (kind === "process") return <>{parts.map((p) => <LevelMark key={p.rigour} level={p.rigour} />)}</>;
  return <>{parts.map((p, i) => <Fragment key={p.rigour}>{i > 0 && <span className="level-sep" aria-hidden="true"> · </span>}<LevelMark level={RIGOUR_LEVEL[p.rigour]} count={p.n} /></Fragment>)}</>;
}

/**
 * One process or standard in a list. As a card: the kind (where kinds are mixed), the category and
 * the tiers; the title and two lines of summary; one line of facts to compare (how binding, how long,
 * how much is yours) and one of who looks after it; after a search, up to two places inside where it
 * was found; what needs attention (marks: draft, retired, review, unpublished changes, needs fixing)
 * just above a compact foot. As a row: one line of the same,
 * for scanning many. The title is the link; it covers the whole card for the mouse, while the links
 * and buttons inside stay separate and reachable with the keyboard.
 */
export function DocCard(props: DocCardProps) {
  const { kind, doc, rigour, rules, hits = [], words = [], openFeedback, mayEdit, manages, meta, broken, usedBy, level = 2, foundBy, showKind = true, view = "cards" } = props;
  const { catalog } = useCatalog();
  const known = engagementKnown(useEngagement());
  const status = statusOf(doc);
  const fix = !!broken && mayEdit;
  const groups = cardGroups(cardLines({ kind, doc, catalog, rigour, rules, mayEdit: mayEdit || !!manages, usedBy, dates: meta }));
  const changes = !!meta?.draft && status !== "draft";
  const title = typeof doc.title === "string" && doc.title ? doc.title : doc.id;
  const category = doc.category ? catalog.categories.find((c) => c.id === doc.category)?.name ?? doc.category : NO_CATEGORY_LABEL;
  const tiers = tiersShort(doc, catalog);
  const H = level === 2 ? "h2" : "h3";
  const feedbackHref = kind === "process" ? href({ page: "process", id: doc.id, tab: "feedback" }) : href({ page: "standard", id: doc.id, tab: "feedback" });
  const by = foundBy && foundBy.length > 0 ? [...foundBy].sort() : [];
  const places = placesOf(hits);
  const shown = places.slice(0, SHOWN_HITS);
  const more = places.length - shown.length;
  // standards: the number of requirements before how binding they are
  const key = kind === "standard" ? [...groups.key].sort((a, b) => Number(b.key === "rules") - Number(a.key === "rules")) : groups.key;

  const marks = (status !== "active" || fix || changes || groups.attention.length > 0) && (
    <div className="card-marks">
      {status === "draft" && <span className="card-mark draft">Draft</span>}
      {status === "deprecated" && <span className="card-mark retired">Retired</span>}
      {changes && <span className="card-mark changes" title={`Saved by ${author(meta!.draft).name}, not yet published`}><PencilLine size={12} aria-hidden="true" />Unpublished changes</span>}
      {fix && <span className="card-mark bad"><CircleAlert size={12} aria-hidden="true" />Needs fixing</span>}
      {groups.attention.map((l) => (
        <span key={l.key} className={`card-mark ${l.key === "review" && reviewOverdue(l.value) ? "bad" : "warn"}`} data-line={l.key}>
          <span className="sr-only">{l.name}: </span>{l.key === "review" ? reviewMarkText(l.value) : l.value}
        </span>
      ))}
    </div>
  );
  const engage = (
    <span className={`card-engage ${known ? "" : "pending"}`.trim()}>
      <UpvoteButton kind={kind} id={doc.id} title={title} />
      <BookmarkButton kind={kind} id={doc.id} title={title} />
    </span>
  );

  if (view === "rows") {
    const best = places[0];
    const owner = groups.who.find((l) => l.key === "owner");
    return (
      <li className={`card row ${status === "deprecated" ? "retired" : ""} ${status === "draft" ? "draft" : ""}`.trim()} data-kind={kind} data-id={doc.id}>
        {showKind && <KindTag kind={kind} />}
        <div className="row-main">
          <H className="card-title"><a className="card-link" href={docHref(kind, doc.id, fix)}><Marked text={title} words={words} /></a></H>
          {best ? (
            <a className="row-hit" href={hitHref(kind, doc.id, best)}>
              <span className="card-hit-where">{HIT_WORD[best.where]}</span>{" "}
              {best.where !== "scope" && best.where !== "summary" ? <Marked text={best.label} words={words} /> : <Marked text={best.snippet ?? ""} words={words} />}
            </a>
          ) : <span className="row-cat">{category}</span>}
        </div>
        {marks}
        <span className="row-level"><Levels kind={kind} rigour={rigour} /></span>
        <span className="row-owner">{owner && <Fact icon={Users} label="Owner">{owner.value}</Fact>}</span>
        {engage}
      </li>
    );
  }

  return (
    <li className={`card ${status === "deprecated" ? "retired" : ""} ${status === "draft" ? "draft" : ""}`.trim()} data-kind={kind} data-id={doc.id}>
      <div className="card-top">
        <span className="card-eyebrow">
          {showKind && <KindTag kind={kind} />}
          <span className="card-cat" title={category}>{category}</span>
        </span>
        {/* one line: a long list of tiers is counted ("3 tiers"), the full list is the tooltip and is read out */}
        <span className="card-tiers" title={`Applies to ${tiers.full}`}>
          {tiers.short === tiers.full
            ? <><span className="sr-only">Applies to: </span>{tiers.full}</>
            : <><span className="sr-only">Applies to: {tiers.full}</span><span aria-hidden="true">{tiers.short}</span></>}
        </span>
      </div>
      {/* the title and the summary are one part, so that the titles of a row of cards start at the same height */}
      <div className="card-head">
        <H className="card-title"><a className="card-link" href={docHref(kind, doc.id, fix)}><Marked text={title} words={words} /></a></H>
        {doc.summary && <p className="card-summary"><Marked text={doc.summary} words={words} /></p>}
      </div>
      {(key.length > 0 || groups.who.length > 0) && (
        <div className="card-facts">
          {key.length > 0 && (
            <dl className="card-lines card-key">
              {key.map((l) => <FactLine key={l.key} line={l} kind={kind} rigour={rigour} strong />)}
            </dl>
          )}
          {groups.who.length > 0 && (
            <dl className="card-lines card-who">
              {groups.who.map((l) => <FactLine key={l.key} line={l} kind={kind} rigour={rigour} />)}
            </dl>
          )}
        </div>
      )}
      {(shown.length > 0 || by.length > 0) && (
        <div className="card-found">
          {by.length > 0 && <p className={`card-found-by ${by.length > 1 ? "both" : by[0]}`}>{FOUND_BY[by.join(",")]}</p>}
          {shown.length > 0 && (
            <ul className="card-hits" aria-label={`Found in ${title}`}>
              {shown.map((h, i) => (
                <li key={`${h.where}:${h.item ?? i}`}>
                  <a href={hitHref(kind, doc.id, h)}>
                    <span className="card-hit-where">{HIT_WORD[h.where]}</span>{" "}
                    {h.where !== "scope" && h.where !== "summary" && <span className="card-hit-label"><Marked text={h.label} words={words} /></span>}
                    {/* the requirement's code, quietly after its name: people quote it and search by it */}
                    {h.where === "requirement" && h.item && <>{" "}<span className="card-hit-code"><Marked text={h.item} words={words} /></span></>}
                  </a>
                  {h.snippet && <span className="card-hit-snippet"> <Marked text={h.snippet} words={words} /></span>}
                </li>
              ))}
            </ul>
          )}
          {more > 0 && <a className="card-hits-more" href={docHref(kind, doc.id)}>{more === 1 ? "1 more place" : `${more} more places`}</a>}
        </div>
      )}
      {/* what needs attention, in a fixed place just above the foot: a mark never pushes a title down,
          so the titles of a row of cards stay level whether a card has no, one or two marks */}
      {marks}
      <div className="card-foot">
        {openFeedback > 0
          ? <a className="card-feedback" href={feedbackHref}><MessageSquare size={14} aria-hidden="true" />{openFeedback} open feedback</a>
          : <span />}
        <a className="card-give" href={feedbackHref} aria-label={`Give feedback on ${title}`} title="Give feedback"><MessageSquarePlus size={15} aria-hidden="true" /></a>
        {/* until the upvotes and bookmarks are known, a 0 would look like a fact: kept in place, not shown */}
        {engage}
      </div>
    </li>
  );
}

/**
 * One fact of the card in its definition list: the name is read out before the value (and is the
 * tooltip); what shows is the icon (or, for the level, its bars) and the value.
 */
function FactLine({ line: l, kind, rigour, strong }: { line: CardLine; kind: TargetKind; rigour: Partial<Record<Rigour, number>>; strong?: boolean }) {
  if (l.key === "rigour") {
    return (
      <div className="card-line rigour" data-line="rigour" title={`${kind === "standard" ? "Requirements" : "Rigour"}: ${l.value}`}>
        <dt className="sr-only">{l.name}:</dt>
        <dd><Levels kind={kind} rigour={rigour} /></dd>
      </div>
    );
  }
  const items = l.items?.some((x) => x.icon) ? l.items : undefined;
  return (
    <div className={`card-line ${l.warn ? "warn" : ""}`.trim()} data-line={l.key}>
      <dt className="sr-only">{l.name}:</dt>
      <dd>
        {items ? (
          <span className="fact" title={`${l.name}: ${l.value}`}>
            {items.map((x, i) => (
              <span key={i} className="card-entry"><EntryIcon icon={x.icon} size={14} fallback={<Code2 size={14} aria-hidden="true" className="fact-icon" />} />{x.name}{i < items.length - 1 && ","}</span>
            ))}
          </span>
        ) : <Fact icon={FACT_ICON[l.key]} strong={strong} title={`${l.name}: ${l.value}`}>{shortFact(l, kind)}</Fact>}
      </dd>
    </div>
  );
}
