import type { Catalog, Issue, Level, Process, Standard, Status, StepType, TargetKind } from "../types";
import { compare, describeChange, fieldName, type Change } from "./diff";
import { EXAMPLE } from "./edit";

/**
 * The editing screen, as plain functions: which kind of draft a document has, what its state is
 * called, which call "Save draft" and "Publish" make, what the outline lists and where the
 * checker's problems belong. The screens in components/Edit*.tsx wire these to React.
 *
 * Two kinds of "not published":
 * - a document that was never published (`status: "draft"`): saving it is an ordinary save,
 *   publishing it is an ordinary save with `status: "active"`;
 * - unpublished changes to a published document: a working draft kept beside it, saved with
 *   `PUT …/draft` and published with `POST …/publish`. Readers keep the published version.
 */
export type DraftKind = "unpublished" | "working";

/** Which kind of draft a document is edited in: by its stored status. */
export const draftKindOf = (status: Status | undefined): DraftKind => (status === "draft" ? "unpublished" : "working");

/** The calls behind "Save draft" and "Publish". */
export type SaveCall = "save-version" | "save-working-draft" | "recreate-as-draft";
export type PublishCall = "save-version-as-active" | "publish-working-draft";
/**
 * `gone`: the document was deleted by somebody else while it was open. Bringing it back is the
 * ordinary save that creates something new, as a draft readers do not see until it is published.
 */
export const saveCallOf = (kind: DraftKind, gone = false): SaveCall =>
  (gone ? "recreate-as-draft" : kind === "unpublished" ? "save-version" : "save-working-draft");
export const publishCallOf = (kind: DraftKind): PublishCall => (kind === "unpublished" ? "save-version-as-active" : "publish-working-draft");

export type StateKey = "draft" | "published" | "changes" | "retired";
export interface EditState {
  key: StateKey;
  /** The word in the pill. */
  pill: string;
  /** The one sentence next to it. */
  sentence: string;
}

/**
 * What the editing bar says about the document: never published, published, with unpublished
 * changes (saved as a working draft, or only on this screen so far), or retired.
 */
export function editState(o: { status: Status | undefined; version: number; working: boolean; dirty: boolean }): EditState {
  if (o.status === "draft") return { key: "draft", pill: "Draft", sentence: "Readers do not see this yet" };
  const v = o.version ? `version ${o.version}` : "the published version";
  if (o.working || o.dirty) {
    return { key: "changes", pill: "Unpublished changes", sentence: `Readers still see ${v}${o.status === "deprecated" ? ", marked as retired" : ""}` };
  }
  if (o.status === "deprecated") return { key: "retired", pill: "Retired", sentence: `Readers see ${v}, marked as retired` };
  return { key: "published", pill: "Published", sentence: o.version ? `Version ${o.version}` : "Readers see this" };
}

/**
 * Why a published document cannot be retired, unpublished or brought back into use right now,
 * or "" when it can. The server refuses these while a working draft exists.
 */
export function statusChangeBlocked(o: { working: boolean; dirty: boolean }): string {
  if (o.working) return "Publish or discard the unpublished changes first.";
  if (o.dirty) return "Save or discard your changes first.";
  return "";
}

// ---------- the outline

export type ProcessSection = "about" | "before" | "people" | "steps" | "links" | "standards";
export type StandardSection = "about" | "scope" | "requirements" | "background";
export type Section = ProcessSection | StandardSection;

/** What is selected on the editing screen: a section of the outline, or one step or requirement. */
export type Selection = { section: Section; item?: string };

export const PROCESS_SECTIONS: { id: ProcessSection; label: string }[] = [
  { id: "about", label: "About" },
  { id: "before", label: "Before you start" },
  { id: "people", label: "Who takes part" },
  { id: "steps", label: "Steps" },
  { id: "links", label: "Links and resources" },
  { id: "standards", label: "Standards it helps to meet" },
];
export const STANDARD_SECTIONS: { id: StandardSection; label: string }[] = [
  { id: "about", label: "About" },
  { id: "scope", label: "Scope and exceptions" },
  { id: "requirements", label: "Requirements" },
  { id: "background", label: "Background" },
];

/** The first part of a checker path: "steps[2].next[0].to" -> ["steps", 2]. */
function head(path: string): [string, number | undefined] {
  const m = path.match(/^([A-Za-z$]+)(?:\[(\d+)\])?/);
  return m ? [m[1], m[2] === undefined ? undefined : Number(m[2])] : ["", undefined];
}

/** Where a problem the checker found belongs in the outline of a process. */
export function processIssueTarget(p: Pick<Process, "steps">, path: string): Selection {
  const [key, i] = head(path);
  switch (key) {
    case "steps": {
      const step = i !== undefined && Array.isArray(p.steps) ? p.steps[i] : undefined;
      return step?.id ? { section: "steps", item: step.id } : { section: "steps" };
    }
    case "prerequisites": return { section: "before" };
    case "actors": return { section: "people" };
    case "resources": return { section: "links" };
    case "standards": return { section: "standards" };
    // the name, summary, owner, lists, review rhythm and anything about the whole document
    default: return { section: "about" };
  }
}

/** Where a problem the checker found belongs in the outline of a standard. */
export function standardIssueTarget(s: Pick<Standard, "requirements">, path: string): Selection {
  const [key, i] = head(path);
  switch (key) {
    case "requirements": {
      const r = i !== undefined && Array.isArray(s.requirements) ? s.requirements[i] : undefined;
      return r?.id ? { section: "requirements", item: r.id } : { section: "requirements" };
    }
    // a standard's scope, exceptions and where it applies are changed together, under "Scope and exceptions"
    case "scope": case "exceptionProcessId": case "tiers": case "languages": case "environments": case "tags": return { section: "scope" };
    case "resources": return { section: "background" };
    default: return { section: "about" };
  }
}

export const issueTarget = (kind: TargetKind, doc: Process | Standard, path: string): Selection =>
  kind === "process" ? processIssueTarget(doc as Process, path) : standardIssueTarget(doc as Standard, path);

/** How many errors and warnings belong to each section and each item: "about", "steps", "steps/<id>". */
/** `examples`: how many of the errors are example texts still to be replaced (see exampleIssues). */
export interface IssueCount { errors: number; warnings: number; examples: number }
export function issuesByPlace(kind: TargetKind, doc: Process | Standard, issues: Issue[]): Map<string, IssueCount> {
  const out = new Map<string, IssueCount>();
  const add = (key: string, issue: Issue) => {
    const c = out.get(key) ?? { errors: 0, warnings: 0, examples: 0 };
    if (issue.level === "error") c.errors++; else c.warnings++;
    if (issue.level === "error" && isExampleIssue(issue)) c.examples++;
    out.set(key, c);
  };
  for (const issue of issues) {
    const t = issueTarget(kind, doc, issue.path);
    add(t.section, issue);
    if (t.item) add(`${t.section}/${t.item}`, issue);
  }
  return out;
}

/** The problems that belong to what is selected. A section shows its own and those of its items. */
export function issuesFor(kind: TargetKind, doc: Process | Standard, issues: Issue[], sel: Selection): Issue[] {
  return issues.filter((i) => {
    const t = issueTarget(kind, doc, i.path);
    return t.section === sel.section && (sel.item === undefined ? true : t.item === sel.item);
  });
}

export interface OutlineEntry {
  /** "about", "steps", or "steps/<id>" for an item. */
  key: string;
  section: Section;
  item?: string;
  label: string;
  /** For an item: "1", "2" for steps, the requirement id for requirements. */
  number?: string;
  /** How many things a section holds, where that helps (steps, lanes, links). */
  count?: number;
  depth: 0 | 1;
  /** A step: its kind, who does it, and the position of that participant (the colour of its lane). */
  type?: StepType;
  who?: string;
  lane?: number;
  /** A requirement: its level. */
  level?: Level;
}

/** Where the outline's choice (open or collapsed) is remembered, per person, in this browser. */
export const outlineKey = (email?: string) => `pm:outline:${email ?? ""}`;
/**
 * Whether the outline shows as a narrow rail (numbers and kind icons only): only when the person
 * chose it ("rail", remembered); open, with the names, at every desktop width otherwise. (Below
 * 1280 pixels the outline slides over the screen and is never a rail.)
 */
export function outlineCollapsed(stored: string | null | undefined): boolean {
  return stored === "rail";
}

/** What the outline of a process lists, in order: its sections, and every step under "Steps". */
export function processOutline(p: Process): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const counts: Partial<Record<ProcessSection, number>> = {
    before: p.prerequisites?.length ?? 0, people: p.actors?.length ?? 0, steps: p.steps?.length ?? 0,
    links: p.resources?.length ?? 0, standards: p.standards?.length ?? 0,
  };
  for (const s of PROCESS_SECTIONS) {
    out.push({ key: s.id, section: s.id, label: s.label, count: counts[s.id], depth: 0 });
    if (s.id === "steps") (p.steps ?? []).forEach((step, i) => {
      const lane = (p.actors ?? []).findIndex((a) => a.id === step.actor);
      out.push({
        key: `steps/${step.id}`, section: "steps", item: step.id, label: step.title || "(no name yet)", number: String(i + 1), depth: 1,
        type: step.type, who: lane >= 0 ? p.actors[lane].name : step.actor, lane: lane >= 0 ? lane : undefined,
      });
    });
  }
  return out;
}

/** What the outline of a standard lists: its sections, and every requirement under "Requirements". */
export function standardOutline(s: Standard): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const counts: Partial<Record<StandardSection, number>> = { requirements: s.requirements?.length ?? 0, background: s.resources?.length ?? 0 };
  for (const sec of STANDARD_SECTIONS) {
    out.push({ key: sec.id, section: sec.id, label: sec.label, count: counts[sec.id], depth: 0 });
    if (sec.id === "requirements") (s.requirements ?? []).forEach((r) => out.push({ key: `requirements/${r.id}`, section: "requirements", item: r.id, label: r.title || "(no name yet)", number: r.id, depth: 1, level: r.level }));
  }
  return out;
}

/**
 * Where a dragged item lands, as the item it is put before (`null`: at the end), or `undefined`
 * when it stays where it is. `to` is the gap it is dropped into: 0 before the first item,
 * `ids.length` after the last.
 */
export function dropBefore(ids: string[], id: string, to: number): string | null | undefined {
  const from = ids.indexOf(id);
  if (from < 0 || to < 0 || to > ids.length || to === from || to === from + 1) return undefined;
  return to === ids.length ? null : ids[to];
}

/** The outline key of a selection. */
export const selectionKey = (sel: Selection) => (sel.item ? `${sel.section}/${sel.item}` : sel.section);

/**
 * The checker's summary on the editing bar, in two words only: "to fix" (stops publishing; calm
 * amber while it is only example text still to replace, red otherwise) and "suggestions" (never
 * stop anything). "Nothing to fix" when there is neither.
 */
export function checkerSummary(issues: Issue[]): { level: "bad" | "warn" | "hint" | "good"; text: string } {
  const errors = issues.filter((i) => i.level === "error");
  const hints = issues.length - errors.length;
  if (errors.length) return { level: errors.every((i) => isExampleIssue(i)) ? "warn" : "bad", text: `${errors.length} to fix` };
  if (hints) return { level: "hint", text: `${hints} suggestion${hints > 1 ? "s" : ""}` };
  return { level: "good", text: "Nothing to fix" };
}

/**
 * Suggestions about a step or requirement that is new on this screen wait until the person has
 * left it once: while it is being written, "say what to do" is not news. `isNew` says whether an
 * item was added on this screen and not left yet; problems that stop publishing always show.
 */
export function withoutEarlySuggestions(kind: TargetKind, doc: Process | Standard, issues: Issue[], isNew: (item: string) => boolean): Issue[] {
  return issues.filter((i) => {
    if (i.level !== "warning") return true;
    const t = issueTarget(kind, doc, i.path);
    return !t.item || !isNew(t.item);
  });
}

/**
 * A problem in words: the field it is about, then what is wrong with it, e.g. "Who does it must
 * be one of: me, boss". The place (which step) is shown by where the problem is listed.
 */
export function issueText(issue: Issue): string {
  // a whole sentence already ("Say exactly what the reader does in this step.")
  if (/^[A-Z]/.test(issue.message)) return issue.message;
  const missing = issue.message.match(/^is missing the required field "(\w+)"$/);
  if (missing) return REQUIRED[missing[1]] ?? `Fill in ${fieldName(missing[1]).toLowerCase()}.`;
  const keys = issue.path.match(/[A-Za-z$]+/g) ?? [];
  // the last named part of the path, unless that is the list a step or requirement sits in
  const key = keys.length > 1 || !["steps", "requirements"].includes(keys[0] ?? "") ? keys[keys.length - 1] : undefined;
  if (!key || issue.path === "(root)") return `${issue.message[0]?.toUpperCase() ?? ""}${issue.message.slice(1)}`;
  const words = key === "title" ? "name" : key === "to" ? "goes to" : key === "next" ? "what comes next" : key === "lookFor" ? "signs of a violation" : fieldName(key);
  return `${words[0].toUpperCase()}${words.slice(1)} ${issue.message}`;
}

/** A field that must be there, by what the editing screen calls it. */
const REQUIRED: Record<string, string> = {
  title: "Write the name.", summary: "Write the summary.", statement: "Write the rule.", owner: "Choose the team that issues it.",
  actor: "Choose who does it.", type: "Choose the kind of step.", level: "Choose the level.", verification: "Say how it is checked.",
  name: "Write the name.", id: "Give it an id.", steps: "Add a step.", requirements: "Add a requirement.", actors: "Add who takes part.",
};

// ---------- example texts

const EXAMPLE_MESSAGE = "is still the example: write your own before publishing.";
/** Whether a problem is an example text left in (it waits for publishing, not for saving). */
export const isExampleIssue = (i: Issue) => i.message === EXAMPLE_MESSAGE;

/**
 * The example texts a blank process or standard starts with, as problems to fix before
 * publishing (not before saving a draft). The texts are the ones `blankProcess`, `blankStandard`,
 * `addStepAfter` and `addRequirement` put in (EXAMPLE in lib/edit).
 */
export function exampleIssues(kind: TargetKind, doc: Process | Standard): Issue[] {
  const out: Issue[] = [];
  const is = (v: unknown, ...texts: string[]) => typeof v === "string" && texts.includes(v.trim());
  const flag = (path: string) => out.push({ level: "error", path, message: EXAMPLE_MESSAGE });
  if (is(doc.summary, EXAMPLE.processSummary, EXAMPLE.standardSummary)) flag("summary");
  if (kind === "process") {
    const steps = Array.isArray((doc as Process).steps) ? (doc as Process).steps : [];
    steps.forEach((st, i) => {
      if (is(st?.title, EXAMPLE.firstStep, EXAMPLE.newStep)) flag(`steps[${i}].title`);
      (Array.isArray(st?.instructions) ? st.instructions : []).forEach((ins, j) => { if (is(ins, EXAMPLE.instruction)) flag(`steps[${i}].instructions[${j}]`); });
    });
  } else {
    const reqs = Array.isArray((doc as Standard).requirements) ? (doc as Standard).requirements : [];
    reqs.forEach((r, i) => {
      if (is(r?.title, EXAMPLE.firstRequirement, EXAMPLE.newRequirement)) flag(`requirements[${i}].title`);
      if (is(r?.statement, EXAMPLE.statement)) flag(`requirements[${i}].statement`);
      if (is(r?.rationale, EXAMPLE.rationale)) flag(`requirements[${i}].rationale`);
    });
  }
  return out;
}

// ---------- what publishing changes

/** The review dates: the server keeps those of the published version, so they are never a change of the draft. */
export function withoutReviewDates<T extends Process | Standard>(doc: T): T {
  if (!doc || typeof doc !== "object" || !doc.review || typeof doc.review !== "object") return doc;
  const { lastReviewedAt: _a, reviewedBy: _b, ...review } = doc.review; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...doc, review };
}

/** A value short enough to show before and after: a line of text, a number, nothing. */
const shortValue = (v: unknown): v is string | number | undefined | null =>
  v === undefined || v === null || typeof v === "number" || (typeof v === "string" && v.length <= 70 && !v.includes("\n"));
const quoted = (v: unknown) => (v === undefined || v === null || v === "" ? "nothing" : `“${v}”`);
const keyFor = (label: string, ...objects: unknown[]) => {
  const keys = new Set(objects.flatMap((o) => (o && typeof o === "object" ? Object.keys(o) : [])));
  return [...keys].find((k) => fieldName(k) === label);
};
const words = (key: string) => (key === "title" ? "name" : fieldName(key));
const cap = (t: string) => `${t[0]?.toUpperCase() ?? ""}${t.slice(1)}`;

/**
 * A value as a reader knows it: a participant, team, tool, category, platform, practice, tier,
 * environment or language by its name instead of its id ("me" is "You"), a list of them joined
 * ("Tier 0, Tier 1"). Anything else as it is; an id not found in its list as it is.
 */
export function valueByName(key: string, v: unknown, catalog?: Catalog, actors: { id: string; name: string }[] = []): unknown {
  const LISTS: Record<string, keyof Catalog> = {
    owner: "teams", teamId: "teams", tool: "tools", category: "categories", practice: "practices", platform: "platforms",
    tiers: "tiers", environments: "environments", languages: "languages",
  };
  const name = (id: unknown): unknown => {
    if (typeof id !== "string" || !id) return id;
    if (key === "actor") return actors.find((a) => a.id === id)?.name ?? (id === "me" ? "You" : id);
    const list = LISTS[key] ? (catalog?.[LISTS[key]] as { id: string; name: string }[] | undefined) : undefined;
    return list?.find((x) => x.id === id)?.name ?? id;
  };
  if (key !== "actor" && !LISTS[key]) return v;
  if (Array.isArray(v)) return v.length ? v.map(name).join(", ") : undefined;
  return name(v);
}

/**
 * What readers will see differently once the draft is published, in lines of plain words: a
 * short field as before and after ("Name: “A” → “B”"), a long one by what and where it is
 * ("Step “Approve the budget” changed: instructions"). Compared with the version readers see
 * now; the review dates are left out.
 */
export function publishLines(kind: TargetKind, published: Process | Standard, draft: Process | Standard, catalog?: Catalog): string[] {
  const before = withoutReviewDates(published) as unknown as Record<string, unknown>;
  const after = withoutReviewDates(draft) as unknown as Record<string, unknown>;
  const items = (o: Record<string, unknown>) => (Array.isArray(o[kind === "process" ? "steps" : "requirements"]) ? o[kind === "process" ? "steps" : "requirements"] as Record<string, unknown>[] : []);
  // values that are ids are shown by their names: a participant, a team, a tool, a tier…
  const actors = (o: Record<string, unknown>) => (Array.isArray(o.actors) ? o.actors as { id: string; name: string }[] : []);
  const shown = (key: string, v: unknown, o: Record<string, unknown>, other: Record<string, unknown>) => valueByName(key, v, catalog, [...actors(o), ...actors(other)]);
  return compare(kind, before, after, catalog).map((c) => {
    if (c.what === "Details" && c.from === undefined && c.to === undefined) {
      const key = keyFor(c.label, before, after);
      const was = key ? shown(key, before[key], before, after) : undefined, now = key ? shown(key, after[key], after, before) : undefined;
      if (key && shortValue(was) && shortValue(now)) return `${cap(words(key))}: ${quoted(was)} → ${quoted(now)}`;
      // a long text that became short is shown as it is now
      if (key && typeof now === "string" && shortValue(now)) return `${cap(words(key))} changed, now ${quoted(now)}`;
      return describeChange(c);
    }
    if (c.kind === "changed" && c.what !== "Details" && c.details?.length) {
      const now = items(after).find((x) => (kind === "process" ? x.title : `${x.id} ${x.title}`) === c.label);
      const was = now ? items(before).find((x) => x.id === now.id) : undefined;
      const parts = c.details.map((d) => {
        const key = keyFor(d, was, now);
        const a = key && was ? shown(key, was[key], before, after) : undefined, b = key && now ? shown(key, now[key], after, before) : undefined;
        if (key && was && now && shortValue(a) && shortValue(b)) return `${words(key)} ${quoted(a)} → ${quoted(b)}`;
        return key ? words(key) : d;
      });
      return `${c.what} “${c.label}” changed: ${parts.join(", ")}`;
    }
    return describeChange(c);
  });
}

/**
 * Said when the draft was started from an older version than readers see now - somebody really
 * published since (a review alone moves the draft along on the server). "" when it was not.
 */
export function baseBehindSentence(base: number, version: number): string {
  if (!base || version <= base) return "";
  return `Version ${version} was published after these changes were started from version ${base}. Publishing will show what changed in it and ask whether to publish yours over it.`;
}

/**
 * Who saved something, for a sentence: "You" when it was the person themselves (in another
 * window), else their name, else their email, else "Somebody else".
 */
export function author(by: { updatedBy?: string; updatedByName?: string } | undefined, myEmail?: string): { you: boolean; name: string } {
  const you = !!by?.updatedBy && !!myEmail && by.updatedBy.toLowerCase() === myEmail.toLowerCase();
  return { you, name: you ? "You" : by?.updatedByName || by?.updatedBy || "Somebody else" };
}

/**
 * Who saved a version, for the versions list: the person's name where the portal knows it (else
 * their email), and a plain word for a version that no person saved.
 */
export function savedByText(v: { savedBy: string; savedByName?: string }): string {
  if (v.savedBy === "import") return "Imported";
  if (v.savedBy === "system") return "Updated by the portal";
  return v.savedByName || v.savedBy || "Somebody";
}

/**
 * The reader's page line about unpublished changes (shown only to who may edit): the person who
 * made them reads "You have unpublished changes (saved 02:09)"; other editors are told whose
 * they are. `when` is the time in words for others ("today at 02:09"), `clock` the short one.
 */
export function unpublishedLine(draft: { updatedAt: string; updatedBy: string; updatedByName?: string }, myEmail: string | undefined, now = new Date()): string {
  const who = author(draft, myEmail);
  const d = new Date(draft.updatedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const known = !Number.isNaN(d.getTime());
  const day = known ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = known ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
  if (who.you) return `You have unpublished changes${known ? ` (saved ${day === today ? time : `${day} ${time}`})` : ""}. Readers see the published version.`;
  const name = draft.updatedByName || draft.updatedBy || "an editor";
  return `There are unpublished changes by ${name}${known ? ` from ${day === today ? "today" : `${day}`} at ${time}` : ""}. Readers see the published version.`;
}

/**
 * The `base` a save of the working draft sends. Creating it (rev 0) - also again after somebody
 * published or discarded it meanwhile - creates it on the version the changes were made from, so
 * that publishing meets any version published since instead of silently going over it. A save
 * after "Continue from theirs" moves the draft onto their version. Otherwise none: the draft
 * keeps its base.
 */
export function draftSaveBase(rev: number, startedFrom: number, continueFrom: number | null): number | undefined {
  if (rev === 0) return startedFrom || undefined;
  return continueFrom ?? undefined;
}

/** "14:02" when it was today, "on 2026-11-17" otherwise: when something was saved, for the editing bar. */
export function clock(iso?: string, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return day(d) === day(now) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `on ${day(d)}`;
}

/**
 * What Undo or Redo did, said as what is true now: "Step “Approve” is back." after undoing its
 * delete, "Step “Approve” is deleted again." after redoing it. `change`: the main difference from
 * what was on screen to what is on screen now (compare(kind, before, now)); `kind` of it "added"
 * means it came back. Without one, a plain "Undone." / "Done again.".
 */
export function steppedMessage(dir: "undo" | "redo", change?: Change): string {
  if (!change) return dir === "undo" ? "Undone." : "Done again.";
  const Label = cap(change.label);
  if (change.what === "Details") {
    if (change.from !== undefined || change.to !== undefined) return change.to ? `${Label} is “${change.to}” again.` : `${Label} is empty again.`;
    return dir === "undo" ? `${Label} is as it was.` : `${Label} is changed again.`;
  }
  const thing = `${change.what} “${change.label}”`;
  if (change.kind === "added") return dir === "undo" ? `${thing} is back.` : `${thing} is added again.`;
  if (change.kind === "removed") return dir === "undo" ? `${thing} is removed again.` : `${thing} is deleted again.`;
  const parts = change.details?.length ? `: ${change.details.join(", ")}` : "";
  return dir === "undo" ? `${thing} is as it was${parts}.` : `${thing} is changed again${parts}.`;
}

/**
 * The delete button of a step or requirement ignores presses for a moment after the selection
 * changed: after a delete the next item is selected under the same pointer, and a second click
 * (or Enter) must not delete it as well. True when a press may delete.
 */
export const DELETE_PAUSE = 700;
export function deleteReady(selectedAt: number, now: number, pause = DELETE_PAUSE): boolean {
  return now - selectedAt >= pause;
}
