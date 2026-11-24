import type { ReactNode } from "react";
import { Check, ShieldCheck, Workflow, type LucideIcon } from "lucide-react";
import type { Level, PathEntry, PathSymbol, Rigour, TargetKind } from "../types";
import { levelWord, type AnyLevel } from "../lib/search";
import { pathsOf, pathsSentence, pathTitle } from "../lib/paths";
import "../controls.css";
import "../paths.css";

/*
 * The small parts that say the same thing the same way on every page. Their styles are in
 * src/controls.css. Use them instead of a copy:
 *
 * <KindTag kind="process" | "standard" size?="sm" | "md" | "icon" />
 *   "PROCESS" / "STANDARD" with its icon, in the kind colours, round for a process and square for
 *   a standard. Show it where kinds are mixed (search, Home, bookmarks, requests, My
 *   responsibilities) and at the top of a process or standard page; not on every card of a list
 *   that holds one kind only. Classes: `.kind-tag.process|.standard` (`.kind-tag.md` bigger, `.kind-tag.icon` the
 *   icon alone in the same shape, for the rows of a list), the word in `.card-kind`.
 *
 * <LevelMark level="mandatory" | "recommended" | "optional" | "must" | "should" | "may" count?={n} title? />
 *   How binding something is: three bars as a small lead-in icon (3 filled for mandatory / must,
 *   2 for recommended / should, 1 for optional / may) and the word, always visible. A process is
 *   "Mandatory", "Recommended" or "Optional"; a requirement of a standard "Must", "Should" or
 *   "May". With `count` it reads "4 must" (the word in lower case). Strong neutral ink, never the
 *   problem red: a level is a fact, not a problem. Classes: `.level-mark[data-level]`, the bars
 *   `.level-bars` (also `<LevelBars level />` alone, `aria-hidden`).
 *
 * <NoLevelMark words?="Rigour not stated" />
 *   A process that does not say how binding it is: three empty bars and the words, in the quiet
 *   ink (`.level-mark[data-level="none"]`), so that its place on a card or in a row is kept.
 *
 * <Fact icon={LucideIcon | ReactNode} label?="Owner" strong?>text</Fact>
 *   One fact as the cards show it: a small grey icon and the text, on one line (cut with "…" when
 *   there is no room; the whole text is the tooltip). `label` is read out before the text and is
 *   part of the tooltip, so that no "Owner:" has to be printed. `strong` for the facts to compare
 *   first (text colour, semibold). Class: `.fact` (`.fact.strong`), the text in `.fact-text`.
 *
 * <PathMark entry={PathEntry} named? size?="sm" | "md" />
 *   One path (greenfield, brownfield, paved path, or one an organisation added) as its picture on a
 *   small plate: a field with a sprout, existing buildings, a paved road… (`entry.symbol`; none: a
 *   neutral signpost). Each picture has a tint of its own (`--path-*` in src/paths.css) but is told
 *   apart by its shape, so colour is never the only difference. The name is the tooltip and is read
 *   out; with `named` it is also written beside the plate. Classes: `.path-mark[data-symbol]`, the
 *   plate `.path-plate`, the name `.path-name`.
 *
 * <PathMarks ids={doc.paths} catalog={catalog} />
 *   The paths of a process or standard together, as plates in a row (cards, rows, the filter):
 *   nothing when it names none (it applies whatever the path). Read out once as "For: Greenfield,
 *   Paved path". Class: `.path-marks`.
 *
 * <PathRoad ids={doc.paths} paths={catalog.paths} kind="process" />
 *   "Which path is this for": every path of the list as a lane of one road, the lanes of this
 *   document marked (tinted, with a check), the others in outline; when it names none, every
 *   lane is open (no edge, no check) and "Any of them" follows the road. The one larger picture, on the
 *   reader's page and in the editing preview. Classes: `.path-road`, `.path-lane.on|.off`.
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

export function KindTag({ kind, size = "sm", className = "" }: { kind: TargetKind; size?: "sm" | "md" | "icon"; className?: string }) {
  const { word, Icon } = KIND[kind];
  // the icon alone, in the same shape and colours; the word is the tooltip and is read out
  if (size === "icon") return (
    <span className={`kind-tag ${kind} icon ${className}`.trim()} title={word}>
      <Icon size={13} aria-hidden="true" /><span className="card-kind sr-only">{word}</span>
    </span>
  );
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

export function LevelMark({ level, count, className = "", title }: { level: Rigour | Level; count?: number; className?: string; title?: string }) {
  const word = levelWord(level);
  return (
    <span className={`level-mark ${className}`.trim()} data-level={level} data-strength={STRENGTH[level]} title={title}>
      <LevelBars level={level} />
      {count === undefined ? word : `${count} ${word.toLowerCase()}`}
    </span>
  );
}

/** A process that does not say how binding it is: three empty bars and the words, quiet. */
export function NoLevelMark({ words = "Rigour not stated" }: { words?: string }) {
  return (
    <span className="level-mark" data-level="none" data-strength="none">
      <span className="level-bars" data-strength="none" aria-hidden="true"><i /><i /><i /></span>
      {words}
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

// ---------- the paths

/**
 * The pictures of the paths, drawn on a 24 × 24 grid with round 2-unit strokes in the current
 * colour, like the other icons of the app. Each one is its own shape, so that the paths are told
 * apart without their colours: a field with a sprout (greenfield), existing buildings
 * (brownfield), a paved road with its centre line (the paved path), and more for paths an
 * organisation adds. `none` is the neutral mark of an entry without a picture: a signpost.
 */
const DRAWN: Record<PathSymbol | "none", ReactNode> = {
  sprout: <>
    <path d="M2 20.5h20" />
    <path d="M12 20.5v-8.5" />
    <path d="M12 15.5c0-3.4-2.6-6-7-6 0 3.7 2.8 6 7 6z" />
    <path d="M12 12.5c0-4 2.8-7 7.5-7 0 4.3-3.1 7-7.5 7z" />
  </>,
  buildings: <>
    <path d="M2.5 20.5h19" />
    <path d="M4.5 20.5V10.5l4-2.5 4 2.5v10" />
    <path d="M12.5 20.5V4.5h7v16" />
    <path d="M15.5 8h1M15.5 11.5h1M15.5 15h1M7.5 13h2M7.5 16.5h2" />
  </>,
  road: <>
    <path d="M9.6 3.5 4 20.5M14.4 3.5 20 20.5" />
    <path d="M12 4.5v2M12 10v2.5M12 16.5v4" />
  </>,
  trail: <>
    <path d="M7 20.5c0-3.5 9-3 9-7s-7-3.3-7-7" strokeDasharray="2.2 2.6" />
    <path d="M9 6.5V2.5l4 1.5-4 1.5" />
    <circle cx="7" cy="20.5" r=".6" />
  </>,
  // after lucide's "bridge" (ISC licence)
  bridge: <>
    <path d="M6 20V4M18 20V4" />
    <path d="m22 11-4-4A7.5 7.5 0 0 1 6 7l-4 4" />
    <path d="M10 9.7V16M14 9.7V16" />
    <path d="M22 16H2" />
  </>,
  flask: <>
    <path d="M9 3h6" /><path d="M10 3v6.2L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.2V3" />
    <path d="M7.2 15h9.6" />
  </>,
  rocket: <>
    <path d="M12 2.5c3.2 2.2 4.6 5.6 4.3 9.8L14.2 16H9.8l-2.1-3.7C7.4 8.1 8.8 4.7 12 2.5z" />
    <circle cx="12" cy="9" r="1.6" />
    <path d="M7.8 12.4 5 15.6l3.4.6M16.2 12.4l2.8 3.2-3.4.6" />
    <path d="M10.8 19.2 12 21.8l1.2-2.6" />
  </>,
  sunset: <>
    <path d="M2.5 18h19M6 21.5h12" />
    <path d="M7 18a5 5 0 0 1 10 0" />
    <path d="M12 7.5v3M5.3 10.8l1.9 1.6M18.7 10.8l-1.9 1.6" />
  </>,
  none: <>
    <path d="M12 2.5v18M8.5 20.5h7" />
    <path d="M12 5h6l2 2.2-2 2.3h-6" />
    <path d="M12 12H6.2l-2 2.2 2 2.3H12" />
  </>,
};
/** The built-in pictures, in the order Admin › Lists offers them, each with what it suggests. */
export const PATH_SYMBOLS: { symbol: PathSymbol; label: string }[] = [
  { symbol: "sprout", label: "A field with a sprout: something new" },
  { symbol: "buildings", label: "Existing buildings: something that is there already" },
  { symbol: "road", label: "A paved road: the ready-made way" },
  { symbol: "trail", label: "A trail of one’s own" },
  { symbol: "bridge", label: "A bridge: moving across" },
  { symbol: "flask", label: "A flask: an experiment" },
  { symbol: "rocket", label: "A rocket: a fast start" },
  { symbol: "sunset", label: "A sunset: winding down" },
];
const known = (s?: string): PathSymbol | "none" => (s && s in DRAWN && s !== "none" ? (s as PathSymbol) : "none");

/** The picture of a path alone (decoration: its name must be next to it, or in a label). */
export function PathSymbolIcon({ symbol, size = 16 }: { symbol?: string; size?: number }) {
  return (
    <svg className="path-symbol" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{DRAWN[known(symbol)]}</svg>
  );
}

/** One path: its picture on a small plate, the name as the tooltip (read out), or written beside it with `named`. */
export function PathMark({ entry, named, size = "sm", className = "" }: { entry: Pick<PathEntry, "id" | "name" | "symbol" | "description" | "alsoCalled">; named?: boolean; size?: "sm" | "md"; className?: string }) {
  const symbol = known(entry.symbol);
  // "Paved path, also called golden path: the ready-made way…"
  const tip = entry.description ? `${pathTitle(entry)}: ${entry.description}` : pathTitle(entry);
  return (
    <span className={`path-mark ${size} ${named ? "named" : ""} ${className}`.replace(/\s+/g, " ").trim()} data-symbol={symbol} data-path={entry.id} title={tip}>
      <span className="path-plate"><PathSymbolIcon symbol={symbol} size={size === "md" ? 16 : 14} /></span>
      {named ? <span className="path-name">{entry.name}</span> : <span className="sr-only">{entry.name}</span>}
    </span>
  );
}

/** The paths of a process or standard as plates in a row; nothing when it names none. */
export function PathMarks({ ids, catalog, named, className = "" }: { ids?: unknown; catalog: { paths?: PathEntry[] }; named?: boolean; className?: string }) {
  const entries = pathsOf(catalog.paths, ids);
  if (!entries.length) return null;
  const words = entries.map((e) => e.name).join(", ");
  return (
    <span className={`path-marks ${className}`.trim()} title={`For: ${words}`}>
      <span className="sr-only">For: </span>
      {entries.map((e, i) => <PathMark key={e.id} entry={e} named={named} className={i < entries.length - 1 ? "" : "last"} />)}
    </span>
  );
}

/**
 * "Which path is this for": every path of the list as one lane of a road; the lanes this document
 * is for are marked, the others are quiet. One that names none is for every path. Nothing when the
 * list has no paths (and the document names none).
 */
export function PathRoad({ ids, paths, kind, className = "" }: { ids?: unknown; paths?: PathEntry[]; kind: TargetKind; className?: string }) {
  const mine = pathsOf(paths, ids);
  const all = [...(paths ?? [])];
  // a path it names that is no longer in the list still shows, under its id
  for (const e of mine) if (!all.some((x) => x.id === e.id)) all.push(e);
  if (!all.length) return null;
  const any = mine.length === 0;
  const on = (id: string) => any || mine.some((e) => e.id === id);
  return (
    <figure className={`path-road ${any ? "any" : ""} ${className}`.replace(/\s+/g, " ").trim()} data-lanes={all.length}>
      <figcaption className="path-road-title">Which path is this for</figcaption>
      <ul className="path-lanes" aria-label={pathsSentence(kind, mine)}>
        {all.map((e) => (
          <li key={e.id} className={`path-lane ${on(e.id) ? "on" : "off"}`} data-symbol={known(e.symbol)} data-path={e.id}
            title={`${pathTitle(e)}${e.description ? `: ${e.description}` : ""}${any ? "" : on(e.id) ? " (this one)" : " (not this one)"}`}>
            <span className="path-plate"><PathSymbolIcon symbol={e.symbol} size={16} /></span>
            <span className="path-name">{e.name}</span>
            {!any && on(e.id) && <Check size={14} aria-hidden="true" className="path-check" />}
            <span className="sr-only">{any ? "" : on(e.id) ? ": yes" : ": no"}</span>
          </li>
        ))}
      </ul>
      {any && <span className="path-road-any" aria-hidden="true" title={pathsSentence(kind, [])}>Any of them</span>}
    </figure>
  );
}
