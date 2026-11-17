import { useMemo, useRef, useState } from "react";
import type { Feedback, Process, Standard, TargetKind } from "../types";
import { useCatalog } from "../lib/catalog";
import { useEngagement } from "../lib/engagement";
import { reviewInfo } from "../lib/lifecycle";
import { useEditor } from "../lib/mode";
import { pageOf, usePageSize } from "../lib/paging";
import { useProfile, useRemembered } from "../lib/profile";
import { canEdit, usePerms, useVisibleDrafts } from "../lib/session";
import { FILTER_LABEL, search, toggleFilter, wordsOf, type FilterKey, type Filters, type Flag } from "../lib/search";
import { hasErrors, validateProcess, validateStandard } from "../lib/validate";
import { openCount } from "./Feedback";
import { DocCard } from "./DocCard";
import { ChosenFilters, FilterPanel, Pager, profileChosen, ResultsBar, toResults, usePaging, type Chosen, type FlagControl } from "./Lists";

const KEYS: FilterKey[] = ["category", "platform", "practice", "rigour", "owner"];
const NOUN: Record<TargetKind, { one: string; many: string }> = { process: { one: "process", many: "processes" }, standard: { one: "standard", many: "standards" } };
const PLACEHOLDER: Record<TargetKind, string> = { process: "Search: GCP, repository, Akamai…", standard: "Search: logging, Terraform, SEC-LOG-01…" };

/** Whether the owner of a process or standard should confirm it soon (or should have already). */
export const needsReview = (d: Process | Standard) => ["overdue", "soon"].includes(reviewInfo(d).state);

/**
 * The list of all processes, or all standards: the filters on the left, the cards, the pages.
 * What somebody searched and filtered for is still there when they come back from one.
 */
export function DocList({ kind, processes, standards, standardIds, feedback, empty }: {
  kind: TargetKind;
  /** All processes: listed for "process", and what a standard may refer to. */
  processes: Process[];
  /** The standards listed (for "standard"). */
  standards: Standard[];
  /** The ids of all standards, which a process or standard may refer to. */
  standardIds: string[];
  feedback: Record<string, Feedback[]>;
  /** What to say when there is nothing at all yet. */
  empty: string;
}) {
  const { catalog } = useCatalog();
  const perms = usePerms();
  const editing = useEditor();
  const drafts = useVisibleDrafts();
  const eng = useEngagement();
  const [q, setQ] = useRemembered(`pm:${kind === "process" ? "processes" : "standards"}:q`, "");
  const [filters, setFilters] = useRemembered<Filters>(`pm:${kind === "process" ? "processes" : "standards"}:filters`, {});
  const [bookmarked, setBookmarked] = useRemembered(`pm:${kind === "process" ? "processes" : "standards"}:bookmarked`, false);
  const [due, setDue] = useState(false);
  const [profile, setProfile] = useProfile();
  const [size, setSize] = usePageSize();
  const [open, setOpen] = useState(false);
  const results = useRef<HTMLElement>(null);
  const mayEdit = (d: Process | Standard) => editing && canEdit(perms, kind, d);

  const flags: Record<string, Flag> = {
    bookmarked: { on: bookmarked, test: (k, d) => eng.isBookmarked(k, d.id) },
    ...(editing ? { review: { on: due, test: (_k: TargetKind, d: Process | Standard) => mayEdit(d) && needsReview(d) } } : {}),
  };
  const out = search({
    processes: kind === "process" ? processes : [], standards: kind === "standard" ? standards : [],
    catalog, q, filters, drafts, profile, flags,
  });
  const words = useMemo(() => wordsOf(q), [q]);
  const what = JSON.stringify([q, filters, profile, bookmarked, due]);
  const [at, setAt] = usePaging(what);
  const page = pageOf(out.results.length, at, size);
  const goTo = (n: number) => { setAt(n); toResults(results.current); };

  const ids = useMemo(() => ({ processIds: processes.map((p) => p.id), standardIds, catalog }), [processes, standardIds, catalog]);
  const broken = (d: Process | Standard) => hasErrors(kind === "process" ? validateProcess(d, ids) : validateStandard(d, ids));
  const usedBy = (id: string) => processes.filter((p) => Array.isArray(p.steps) && p.steps.some((s) => s && s.subProcessId === id)).length;

  const flagControls: FlagControl[] = [
    { key: "bookmarked", label: "Only my bookmarks", count: out.flags.bookmarked ?? 0, on: bookmarked, onChange: setBookmarked },
  ];
  if (editing && ((out.flags.review ?? 0) > 0 || due)) flagControls.push({ key: "review", label: "Only what needs a review", count: out.flags.review ?? 0, on: due, onChange: setDue });

  const chosen: Chosen[] = [
    ...(q.trim() ? [{ key: "q", name: "Search", value: q.trim(), remove: () => setQ("") }] : []),
    ...(bookmarked ? [{ key: "bookmarked", name: "Bookmarks", value: "only mine", remove: () => setBookmarked(false) }] : []),
    ...(due ? [{ key: "review", name: "Review", value: "due or overdue", remove: () => setDue(false) }] : []),
    ...KEYS.flatMap((k) => out.options[k].filter((o) => o.chosen).map((o) => ({
      key: `${k}:${o.value}`, name: FILTER_LABEL[k], value: o.label, remove: () => setFilters(toggleFilter(filters, k, o.value)),
    }))),
    ...profileChosen(profile, setProfile, catalog),
  ];
  const clear = () => { setQ(""); setFilters({}); setBookmarked(false); setDue(false); setProfile({}); };
  const nothing = kind === "process" ? processes.length === 0 : standards.length === 0;
  const panelId = `${kind}-filters`;

  return (
    <div className="list-layout">
      <div className="list-head">
        <ResultsBar page={page} noun={NOUN[kind]} panelId={panelId} open={open} onOpen={setOpen} chosen={chosen.length} size={size} onSize={setSize} />
        <ChosenFilters chosen={chosen} onClear={clear} />
      </div>
      <FilterPanel id={panelId} open={open} keys={KEYS} options={out.options} onToggle={(k, v) => setFilters(toggleFilter(filters, k, v))}
        text={{ value: q, onChange: setQ, placeholder: PLACEHOLDER[kind], label: kind === "process" ? "Search processes" : "Search standards" }}
        flags={flagControls} profile={profile} onProfile={setProfile} />
      <section className="list-results" aria-label="Results" ref={results} tabIndex={-1}>
        {out.results.length === 0 ? (
          <div className="list-empty">
            <p>{nothing ? empty : `No ${NOUN[kind].one} matches.`}</p>
            {!nothing && chosen.length > 0 && <button type="button" className="btn small" onClick={clear}>Clear all filters</button>}
          </div>
        ) : (
          <ol className="cards">
            {out.results.slice(page.start, page.end).map((r) => {
              const mine = mayEdit(r.doc);
              return (
                <DocCard key={r.doc.id} kind={kind} doc={r.doc} rigour={r.rigour} rules={r.rules} hits={r.hits} words={words}
                  openFeedback={openCount(feedback[r.doc.id] ?? [])} mayEdit={mine} broken={mine && broken(r.doc)}
                  usedBy={kind === "process" ? usedBy(r.doc.id) : undefined} />
              );
            })}
          </ol>
        )}
        <Pager page={page} onPage={goTo} label={`Pages of ${NOUN[kind].many}`} />
      </section>
    </div>
  );
}
