import { useEffect, useState, type MouseEvent } from "react";
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
export const bookmarkLabel = (title: string, on: boolean) => (on ? `Remove bookmark from ${title}` : `Bookmark ${title}`);
/** e.g. "Upvote Request a GCP project (12)" or "Take back your upvote of Request a GCP project (12)". */
export const upvoteLabel = (title: string, on: boolean, count: number) =>
  `${on ? "Take back your upvote of" : "Upvote"} ${title || "this"} (${count})`;

interface Props {
  kind: TargetKind;
  id: string;
  /** The title of the process or standard: part of the button's name. */
  title?: string;
  /** "page" shows a word next to the icon; "card" (default) is a compact icon button. */
  size?: "card" | "page";
  className?: string;
}

export function BookmarkButton({ kind, id, title = "", size = "card", className = "" }: Props) {
  const eng = useEngagement();
  const on = eng.isBookmarked(kind, id);
  const Icon = on ? BookmarkCheck : Bookmark;
  return (
    <button type="button" className={`engage-btn bookmark-btn ${size} ${on ? "on" : ""} ${className}`.trim()} aria-pressed={on}
      aria-label={bookmarkLabel(title || "this", on)} title={on ? "Bookmarked: click to remove" : "Bookmark: find it again under Bookmarks"}
      onClick={(e) => { stop(e); void eng.toggleBookmark(kind, id); }}>
      <Icon size={size === "page" ? 15 : 16} aria-hidden="true" fill={on ? "currentColor" : "none"} />
      {size === "page" && <span>{on ? "Bookmarked" : "Bookmark"}</span>}
    </button>
  );
}

export function UpvoteButton({ kind, id, title = "", size = "card", className = "" }: Props) {
  const eng = useEngagement();
  const on = eng.hasUpvoted(kind, id);
  const count = eng.countsOf(kind, id).upvotes;
  return (
    <button type="button" className={`engage-btn upvote-btn ${size} ${on ? "on" : ""} ${className}`.trim()} aria-pressed={on}
      aria-label={upvoteLabel(title, on, count)} title={on ? "You found this useful: click to take it back" : "Upvote: this is useful"}
      onClick={(e) => { stop(e); void eng.toggleUpvote(kind, id); }}>
      <ThumbsUp size={15} aria-hidden="true" fill={on ? "currentColor" : "none"} />
      <span className="engage-count">{count}</span>{size === "page" && <span className="engage-word">{count === 1 ? "upvote" : "upvotes"}</span>}
    </button>
  );
}

const times = (n: number) => (n === 1 ? "once" : `${n.toLocaleString("en-GB")} times`);
const people = (n: number) => `${n.toLocaleString("en-GB")} ${n === 1 ? "person" : "people"}`;

/** The numbers of a process or standard, in words for everyone; empty parts are left out or said plainly. */
export function engagementLines(c: Counts, open: number, handled: number): string[] {
  const lines: string[] = [];
  lines.push(c.views ? `Viewed ${times(c.views)} by ${people(Math.max(1, c.people))}` : "Not viewed yet");
  lines.push(c.downloads ? `Skill downloaded ${times(c.downloads)}` : "Skill not downloaded yet");
  lines.push(open ? `${open} ${open === 1 ? "piece" : "pieces"} of feedback open` : "No feedback open");
  lines.push(`${handled} ${handled === 1 ? "piece" : "pieces"} of feedback handled`);
  return lines;
}

/**
 * Near the top of a process or standard page: how much it is used, the feedback, and what a
 * reader can do - give feedback, upvote, bookmark, share.
 */
export function DocEngagement({ kind, id, title, summary, open, handled, onFeedback }: {
  kind: TargetKind; id: string; title: string; summary?: string;
  /** Open and handled feedback, from the feedback the page shows. */
  open: number; handled: number;
  onFeedback: () => void;
}) {
  const eng = useEngagement();
  const [sharing, setSharing] = useState(false);
  const c = eng.countsOf(kind, id);
  const [views, downloads, openLine, handledLine] = engagementLines(c, open, handled);
  const signedIn = useMe().authenticated;
  // counted once per page load and person (the server counts once a day); not on every tab or render
  useEffect(() => { if (signedIn) eng.recordView(kind, id); }, [kind, id, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="doc-engage" aria-label="Use and feedback" role="group">
      <ul className="engage-stats">
        <li><Eye size={14} aria-hidden="true" />{views}</li>
        <li><Download size={14} aria-hidden="true" />{downloads}</li>
        <li className={open ? "engage-open has" : "engage-open"}><Flag size={14} aria-hidden="true" />{openLine}</li>
        <li><CircleCheck size={14} aria-hidden="true" />{handledLine}</li>
      </ul>
      <div className="engage-actions">
        <button type="button" className="btn accent-soft give-feedback" onClick={onFeedback}><MessageSquarePlus size={16} />Give feedback</button>
        <UpvoteButton kind={kind} id={id} title={title} size="page" />
        <BookmarkButton kind={kind} id={id} title={title} size="page" />
        <button type="button" className="btn share-btn" onClick={() => setSharing(true)} aria-haspopup="dialog"><Share2 size={16} />Share</button>
      </div>
      {sharing && <ShareDialog info={{ kind, id, title, summary }} onClose={() => setSharing(false)} />}
    </div>
  );
}
