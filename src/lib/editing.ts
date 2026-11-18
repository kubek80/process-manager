import type { Issue, Process, Standard, Status, TargetKind } from "../types";

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
export type SaveCall = "save-version" | "save-working-draft";
export type PublishCall = "save-version-as-active" | "publish-working-draft";
export const saveCallOf = (kind: DraftKind): SaveCall => (kind === "unpublished" ? "save-version" : "save-working-draft");
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
    case "scope": case "exceptionProcessId": return { section: "scope" };
    case "resources": return { section: "background" };
    default: return { section: "about" };
  }
}

export const issueTarget = (kind: TargetKind, doc: Process | Standard, path: string): Selection =>
  kind === "process" ? processIssueTarget(doc as Process, path) : standardIssueTarget(doc as Standard, path);

/** How many errors and warnings belong to each section and each item: "about", "steps", "steps/<id>". */
export interface IssueCount { errors: number; warnings: number }
export function issuesByPlace(kind: TargetKind, doc: Process | Standard, issues: Issue[]): Map<string, IssueCount> {
  const out = new Map<string, IssueCount>();
  const add = (key: string, level: Issue["level"]) => {
    const c = out.get(key) ?? { errors: 0, warnings: 0 };
    if (level === "error") c.errors++; else c.warnings++;
    out.set(key, c);
  };
  for (const issue of issues) {
    const t = issueTarget(kind, doc, issue.path);
    add(t.section, issue.level);
    if (t.item) add(`${t.section}/${t.item}`, issue.level);
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
    if (s.id === "steps") (p.steps ?? []).forEach((step, i) => out.push({ key: `steps/${step.id}`, section: "steps", item: step.id, label: step.title || "(no name yet)", number: String(i + 1), depth: 1 }));
  }
  return out;
}

/** What the outline of a standard lists: its sections, and every requirement under "Requirements". */
export function standardOutline(s: Standard): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const counts: Partial<Record<StandardSection, number>> = { requirements: s.requirements?.length ?? 0, background: s.resources?.length ?? 0 };
  for (const sec of STANDARD_SECTIONS) {
    out.push({ key: sec.id, section: sec.id, label: sec.label, count: counts[sec.id], depth: 0 });
    if (sec.id === "requirements") (s.requirements ?? []).forEach((r) => out.push({ key: `requirements/${r.id}`, section: "requirements", item: r.id, label: r.title || "(no name yet)", number: r.id, depth: 1 }));
  }
  return out;
}

/** The outline key of a selection. */
export const selectionKey = (sel: Selection) => (sel.item ? `${sel.section}/${sel.item}` : sel.section);

/** "3 problems", "No problems", "2 hints": the checker's summary on the editing bar. */
export function checkerSummary(issues: Issue[]): { level: "bad" | "warn" | "good"; text: string } {
  const errors = issues.filter((i) => i.level === "error").length;
  const hints = issues.length - errors;
  if (errors) return { level: "bad", text: `${errors} problem${errors > 1 ? "s" : ""}` };
  if (hints) return { level: "warn", text: `${hints} hint${hints > 1 ? "s" : ""}` };
  return { level: "good", text: "No problems" };
}
