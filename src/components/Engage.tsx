import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useMe } from "../lib/session";
import { Bookmark, BookmarkCheck, CircleCheck, Download, Eye, Flag, MessageSquarePlus, Share2, ThumbsUp } from "lucide-react";
import type { TargetKind } from "../types";
import { useEngagement, type Counts } from "../lib/engagement";
import { ShareDialog } from "./ShareDialog";
import "../detail.css";

// Small buttons for bookmarks and upvotes, the same on a card and on a page. On a card they sit
// inside (or on top of) a link: a click must not open the card.
const stop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

/** The name a screen reader announces and a test can find, e.g. "Bookmark Request a GCP project". */
export const bookmarkLabel = (title: string, on: boolean | undefined) => (on ? `Remove bookmark from ${title}` : `Bookmark ${title}`);
/**
 * e.g. "Upvote Request a GCP project (12)" or "Take back your upvote of Request a GCP project (12)";
 * without the number while it is not known.
 */
export const upvoteLabel = (title: string, on: boolean | undefined, count?: number) =>
  `${on ? "Take back your upvote of" : "Upvote"} ${title || "this"}${count === undefined ? "" : ` (${count})`}`;

interface Props {
  kind: TargetKind;
  id: string;
  /** The title of the process or standard: part of the button's name. */
  title?: string;
  /** "page" shows a word next to the icon; "card" (default) is a compact icon button. */
  size?: "card" | "page";
  className?: string;
}

// While it is not known whether something is bookmarked or upvoted (the numbers are still loading,
// or could not be loaded) the buttons show no state and no number; a click still works, and adds.
const unknownHint = (failed: boolean) => (failed ? "Your bookmarks and upvotes could not be loaded right now." : "Loading…");

export function BookmarkButton({ kind, id, title = "", size = "card", className = "" }: Props) {
  const eng = useEngagement();
  const on = eng.bookmarkState(kind, id);
  const Icon = on ? BookmarkCheck : Bookmark;
  return (
    <button type="button" className={`engage-btn bookmark-btn engage-${size} ${on ? "on" : ""} ${on === undefined ? "unknown" : ""} ${className}`.replace(/\s+/g, " ").trim()}
      aria-pressed={on} aria-label={bookmarkLabel(title || "this", on)}
      title={on === undefined ? `${unknownHint(eng.failed)} Click to bookmark.` : on ? "Bookmarked: click to remove" : "Bookmark: find it again under Bookmarks"}
      onClick={(e) => { stop(e); void eng.toggleBookmark(kind, id); }}>
      <Icon size={15} aria-hidden="true" fill={on ? "currentColor" : "none"} />
      {size === "page" && <span className="engage-label">{on ? "Bookmarked" : "Bookmark"}</span>}
    </button>
  );
}

export function UpvoteButton({ kind, id, title = "", size = "card", className = "" }: Props) {
  const eng = useEngagement();
  const on = eng.upvoteState(kind, id);
  const count = eng.upvotesOf(kind, id);
  return (
    <button type="button" className={`engage-btn upvote-btn engage-${size} ${on ? "on" : ""} ${on === undefined ? "unknown" : ""} ${className}`.replace(/\s+/g, " ").trim()}
      aria-pressed={on} aria-label={upvoteLabel(title, on, count)}
      title={on === undefined ? `${unknownHint(eng.failed)} Click to upvote.` : on ? "You found this useful: click to take it back" : "Upvote: this is useful"}
      onClick={(e) => { stop(e); void eng.toggleUpvote(kind, id); }}>
      <ThumbsUp size={15} aria-hidden="true" fill={on ? "currentColor" : "none"} />
      {count !== undefined && <span className="engage-count">{count}</span>}
      {size === "page" && <>{count !== undefined && " "}<span className="engage-word engage-label">{count === undefined ? "Upvote" : count === 1 ? "upvote" : "upvotes"}</span></>}
    </button>
  );
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export type EngagementLine = { key: "views" | "downloads" | "open" | "handled"; text: string };

/**
 * The numbers of a process or standard, in words for everyone, as short as they can be: what is
 * zero and says nothing ("not downloaded yet", "0 handled") is left out; only the views are always
 * there. `handled` is left out while it is not known.
 */
export function engagementLines(c: Counts, open: number, handled?: number): EngagementLine[] {
  const lines: EngagementLine[] = [];
  lines.push({ key: "views", text: c.views ? `${count(c.views, "view", "views")} by ${count(Math.max(1, c.people), "person", "people")}` : "No views yet" });
  if (c.downloads) lines.push({ key: "downloads", text: count(c.downloads, "skill download", "skill downloads") });
  if (open) lines.push({ key: "open", text: `${count(open, "piece", "pieces")} of feedback open` });
  if (handled) lines.push({ key: "handled", text: `${count(handled, "piece", "pieces")} of feedback handled` });
  return lines;
}

/**
 * Near the top of a process or standard page, in one quiet line: how much it is used and the
 * feedback; and, unless the page shows them on its tab row, what a reader can do (`DocActions`).
 *
 * "Handled" is the server's count (feedback marked as fixed that still exists), the same number
 * the cards and the statistics show. `resolvedHere` is what the feedback on this page says; when it
 * changes (marked as fixed, reopened, deleted) the numbers are fetched again, so they cannot drift.
 */
export function DocEngagement({ kind, id, title, summary, open, resolvedHere, onFeedback, actions = true }: {
  kind: TargetKind; id: string; title: string; summary?: string;
  /** Open feedback, from the feedback the page shows. */
  open: number;
  /** Feedback marked as fixed, from the feedback the page shows. */
  resolvedHere: number;
  onFeedback: () => void;
  /** false: the buttons are shown elsewhere (on the tab row, `DocActions`), only the numbers here. */
  actions?: boolean;
}) {
  const eng = useEngagement();
  const c = eng.countsOf(kind, id);
  const signedIn = useMe().authenticated;
  // counted once per page load and person (the server counts once a day); not on every tab or render
  useEffect(() => { if (signedIn) eng.recordView(kind, id); }, [kind, id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } eng.reload(); }, [resolvedHere]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = engagementLines(c, open, eng.known ? c.handled : undefined);
  const icon = { views: Eye, downloads: Download, open: Flag, handled: CircleCheck };
  return (
    <div className="doc-engage" aria-label="Use and feedback" role="group">
      <ul className="engage-stats" aria-busy={!eng.ready}>
        {lines.filter((l) => eng.known || l.key === "open").map((l) => {
          const Icon = icon[l.key];
          return <li key={l.key} className={`engage-${l.key} ${l.key === "open" ? "has" : ""}`.trim()}><Icon size={14} aria-hidden="true" />{l.text}</li>;
        })}
        {!eng.known && <li className="engage-unknown">{eng.failed ? "The numbers are not available right now." : <span aria-label="Loading the numbers">–</span>}</li>}
      </ul>
      {actions && <DocActions kind={kind} id={id} title={title} summary={summary} onFeedback={onFeedback} />}
    </div>
  );
}

/** What a reader can do with a process or standard: give feedback, upvote, bookmark, share. */
export function DocActions({ kind, id, title, summary, onFeedback }: {
  kind: TargetKind; id: string; title: string; summary?: string; onFeedback: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  return (
    <div className="engage-actions">
      <button type="button" className="btn small give-feedback" onClick={onFeedback}><MessageSquarePlus size={15} />Give feedback</button>
      <UpvoteButton kind={kind} id={id} title={title} size="page" />
      <BookmarkButton kind={kind} id={id} title={title} size="page" />
      <button type="button" className="btn small share-btn" onClick={() => setSharing(true)} aria-haspopup="dialog"><Share2 size={15} /><span className="engage-label">Share</span></button>
      {sharing && <ShareDialog info={{ kind, id, title, summary }} onClose={() => setSharing(false)} />}
    </div>
  );
}
