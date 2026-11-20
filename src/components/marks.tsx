import type { ReactNode } from "react";
import { ShieldCheck, Workflow, type LucideIcon } from "lucide-react";
import type { Level, Rigour, TargetKind } from "../types";
import { levelWord, type AnyLevel } from "../lib/search";
import "../controls.css";

/*
 * The small parts that say the same thing the same way on every page. Their styles are in
 * src/controls.css. Use them instead of a copy:
 *
 * <KindTag kind="process" | "standard" size?="sm" | "md" />
 *   "PROCESS" / "STANDARD" with its icon, in the kind colours, round for a process and square for
 *   a standard. Show it where kinds are mixed (search, Home, bookmarks, requests, My
 *   responsibilities) and at the top of a process or standard page; not on every card of a list
 *   that holds one kind only. Classes: `.kind-tag.process|.standard` (`.kind-tag.md` bigger), the
 *   word in `.card-kind`.
 *
 * <LevelMark level="mandatory" | "recommended" | "optional" | "must" | "should" | "may" count?={n} />
 *   How binding something is: three bars as a small lead-in icon (3 filled for mandatory / must,
 *   2 for recommended / should, 1 for optional / may) and the word, always visible. A process is
 *   "Mandatory", "Recommended" or "Optional"; a requirement of a standard "Must", "Should" or
 *   "May". With `count` it reads "4 must" (the word in lower case). Strong neutral ink, never the
 *   problem red: a level is a fact, not a problem. Classes: `.level-mark[data-level]`, the bars
 *   `.level-bars` (also `<LevelBars level />` alone, `aria-hidden`).
 *
 * <Fact icon={LucideIcon | ReactNode} label?="Owner" strong?>text</Fact>
 *   One fact as the cards show it: a small grey icon and the text, on one line (cut with "…" when
 *   there is no room; the whole text is the tooltip). `label` is read out before the text and is
 *   part of the tooltip, so that no "Owner:" has to be printed. `strong` for the facts to compare
 *   first (text colour, semibold). Class: `.fact` (`.fact.strong`), the text in `.fact-text`.
 *
 * Classes without a component (src/controls.css):
 *   `.tabs` > `button.tab` (`.on` + `aria-selected` / `aria-checked`), with an optional count in
 *   `.tab-count`: underline tabs that switch views. A tab may hold a `KindTag`-like mark first.
 *   (The older pill tabs of styles.css, `.tabs` > `button` without `.tab`, keep their look.)
 *   `.seg` > `button.seg-item` (`.on` + `aria-checked` or `aria-pressed`): ONE segmented control to
 *   pick among a few options; the chosen one in the brand colour. An icon inside is fine.
 */

const KIND: Record<TargetKind, { word: string; Icon: LucideIcon }> = {
  process: { word: "Process", Icon: Workflow },
  standard: { word: "Standard", Icon: ShieldCheck },
};
export const kindWord = (kind: TargetKind) => KIND[kind].word;
export const KindIcon = ({ kind, size = 13 }: { kind: TargetKind; size?: number }) => {
  const { Icon } = KIND[kind];
  return <Icon size={size} aria-hidden="true" />;
};

export function KindTag({ kind, size = "sm", className = "" }: { kind: TargetKind; size?: "sm" | "md"; className?: string }) {
  const { word, Icon } = KIND[kind];
  return (
    <span className={`kind-tag ${kind} ${size === "md" ? "md" : ""} ${className}`.replace(/\s+/g, " ").trim()}>
      <Icon size={size === "md" ? 14 : 13} aria-hidden="true" /><span className="card-kind">{word}</span>
    </span>
  );
}

const BARS: Record<AnyLevel, number> = { mandatory: 3, recommended: 2, optional: 1, must: 3, should: 2, may: 1 };
const STRENGTH: Record<AnyLevel, "strong" | "mid" | "light"> = { mandatory: "strong", must: "strong", recommended: "mid", should: "mid", optional: "light", may: "light" };

/** The three bars alone (decoration: the word must be next to it). */
export function LevelBars({ level }: { level: AnyLevel }) {
  return (
    <span className="level-bars" data-strength={STRENGTH[level]} aria-hidden="true">
      {[0, 1, 2].map((i) => <i key={i} className={i < BARS[level] ? "on" : ""} />)}
    </span>
  );
}

export function LevelMark({ level, count, className = "" }: { level: Rigour | Level; count?: number; className?: string }) {
  const word = levelWord(level);
  return (
    <span className={`level-mark ${className}`.trim()} data-level={level} data-strength={STRENGTH[level]}>
      <LevelBars level={level} />
      {count === undefined ? word : `${count} ${word.toLowerCase()}`}
    </span>
  );
}

export function Fact({ icon, label, strong, children, className = "", title }: {
  icon?: LucideIcon | ReactNode; label?: string; strong?: boolean; children: ReactNode; className?: string;
  /** The tooltip; by default the label and the text when the text is plain. */
  title?: string;
}) {
  // a lucide icon is a component (a function or a forwardRef object); anything else is drawn as it is
  const isComponent = typeof icon === "function" || (typeof icon === "object" && icon !== null && "render" in (icon as object));
  const Icon = isComponent ? (icon as LucideIcon) : null;
  const node = isComponent ? null : (icon as ReactNode);
  const tip = title ?? (typeof children === "string" ? (label ? `${label}: ${children}` : children) : label);
  return (
    <span className={`fact ${strong ? "strong" : ""} ${className}`.replace(/\s+/g, " ").trim()} title={tip}>
      {Icon ? <Icon size={14} aria-hidden="true" className="fact-icon" /> : node ?? null}
      <span className="fact-text">{label && <span className="sr-only">{label}: </span>}{children}</span>
    </span>
  );
}
