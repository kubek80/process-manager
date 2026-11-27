import { useCallback, useEffect, useRef, useState } from "react";
import type { Assignment, AuditEntry, Catalog, Contacts, DocMeta, DocVersion, Feedback, FeedbackByTarget, Me, Membership, Process, Role, Skill, SkillDetail, Standard, TargetKind } from "../types";
import type { Conflict } from "./draftState";
import type { GroupKind } from "./members";
import { completeCatalog } from "./catalog";
import { completePerms } from "./rights";
import { parseRequestsQuery, requestsQuery, type DocRequest, type NewRequest, type RequestState, type RequestsView } from "./requests";
import type { Period, Statistics } from "./statistics";
import type { AdminUser, KnownPerson, UserRole } from "./users";
import { portalName, type Look } from "./theme";
import { today } from "./dates";

export class ApiError extends Error {
  /** Set when a save was refused because somebody else saved (or deleted) first. */
  conflict?: Conflict;
  constructor(public status: number, message: string) { super(message); }
}

/** Sent to the window when the server no longer knows the session (it expired, or was ended elsewhere). */
export const SIGNED_OUT = "pm:signed-out";

/** One place for every call to the server: JSON in and out, the CSRF header, readable errors. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await request<T>(method, path, body)).data;
}

/** What to say when the portal could not be reached at all; for a change, that nothing was saved. */
export const unreachableMessage = (method: string) =>
  `Could not reach the portal.${method === "GET" ? "" : " Nothing was saved."} Check your connection and try again.`;

/** True when a part of the app itself could not be fetched (the portal was out of reach, or replaced by a newer version). */
export const isLoadFailure = (message: string) =>
  /Unable to preload CSS|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(message);

/**
 * Whom the page acts as: the address `/api/me` gave it (`loadMe`). Sent with every change, so
 * that a page left open while an admin started or stopped viewing the portal as somebody else
 * in another tab is refused (409) instead of acting as the other one.
 */
export const ACTING_AS_HEADER = "X-Acting-As";
let actingAs = "";
/** The headers of every change: JSON, the CSRF header and whom the page acts as. */
export const changeHeaders = (contentType = "application/json"): Record<string, string> => ({
  "Content-Type": contentType, "X-Requested-With": "process-manager", ...(actingAs ? { [ACTING_AS_HEADER]: encodeURIComponent(actingAs) } : {}),
});

async function request<T>(method: string, path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: method === "GET" ? undefined : changeHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, unreachableMessage(method));
  }
  if (res.status === 204) return { data: undefined as T, headers: res.headers };
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // The session ended. The page stays as it is - somebody may be in the middle of an edit -
    // and the app asks to sign in again on top of it.
    if (res.status === 401 && path !== "/api/me") {
      window.dispatchEvent(new Event(SIGNED_OUT));
      throw new ApiError(401, "You are signed out. Sign in again, then repeat what you were doing.");
    }
    const err = new ApiError(res.status, data?.error ?? `The portal could not do that (answer ${res.status}). Try again in a moment.`);
    if (res.status === 409 && data?.conflict) err.conflict = data.conflict as Conflict;
    throw err;
  }
  return { data: data as T, headers: res.headers };
}

/** Who is signed in. `adopt`: the page now acts as them (false: only looking, as the check for a changed view does). */
export async function loadMe(adopt = true): Promise<Me> {
  const me = await call<Me>("GET", "/api/me");
  if (adopt) actingAs = me.authenticated ? me.user?.email ?? "" : "";
  return me.perms ? { ...me, perms: completePerms(me.perms) } : me;
}
export const devLogin = (email: string) => call<void>("POST", "/auth/dev/login", { email });
export const logout = () => call<void>("POST", "/auth/logout");
/** An admin starts (and stops) viewing the portal as somebody else; `/api/me` then answers as that person, with `viewedBy`. */
export const startViewAs = (email: string) => call<{ email: string; name: string; until: string }>("POST", "/api/admin/view-as", { email });
export const stopViewAs = () => call<void>("DELETE", "/api/admin/view-as");
/** Everybody the portal knows by address, for choosing whose view to see (admins only). */
export const loadPeople = async () => (await call<{ people?: KnownPerson[] }>("GET", "/api/admin/people")).people ?? [];

// Content: processes, standards and the lists live in the database. Every save is a new
// version; a save says which version it was made from (`base`) and is refused when somebody
// else saved in the meantime (ApiError.conflict).
export type MetaById = Record<string, DocMeta>;
// `draft`: the revision of the working draft of a never-published document that the save replaces
const saveQuery = (base: number, note = "", draft?: number) => `?base=${base}${note.trim() ? `&note=${encodeURIComponent(note.trim())}` : ""}${draft ? `&draft=${draft}` : ""}`;

/** An older server sends no `createdAt`: the date of the last save stands in for it. */
export function completeMeta(meta: Record<string, Partial<DocMeta>> | undefined): MetaById {
  const out: MetaById = {};
  for (const [id, m] of Object.entries(meta ?? {})) out[id] = { version: 0, updatedAt: "", updatedBy: "", ...m, createdAt: m.createdAt || m.updatedAt || "" };
  return out;
}

/**
 * What the app knows about a document after a save: the server answers with the new version;
 * when the first version was saved stays as it was, and a save that shows it to readers for the
 * first time (`status` other than "draft") is when it was first published.
 */
export function savedMeta(before: DocMeta | undefined, saved: Partial<DocMeta> & { version: number }, doc: { status?: string }): DocMeta {
  const createdAt = saved.createdAt || before?.createdAt || saved.updatedAt || "";
  const publishedAt = saved.publishedAt || before?.publishedAt || (doc.status !== "draft" ? saved.updatedAt || undefined : undefined);
  return { ...before, ...saved, createdAt, ...(publishedAt ? { publishedAt } : {}) } as DocMeta;
}

export async function loadProcesses(): Promise<{ docs: Process[]; meta: MetaById }> {
  const r = await call<{ processes: Process[]; meta?: MetaById }>("GET", "/api/processes");
  return { docs: r.processes, meta: completeMeta(r.meta) };
}
export const putProcess = (p: Process, base: number, note?: string) => call<DocMeta>("PUT", `/api/processes/${p.id}${saveQuery(base, note)}`, p);
export const removeProcess = (id: string, base: number) => call<void>("DELETE", `/api/processes/${id}?base=${base}`);
export async function loadStandards(): Promise<{ docs: Standard[]; meta: MetaById }> {
  const r = await call<{ standards: Standard[]; meta?: MetaById }>("GET", "/api/standards");
  return { docs: r.standards, meta: completeMeta(r.meta) };
}
export const putStandard = (s: Standard, base: number, note?: string) => call<DocMeta>("PUT", `/api/standards/${s.id}${saveQuery(base, note)}`, s);
export const removeStandard = (id: string, base: number) => call<void>("DELETE", `/api/standards/${id}?base=${base}`);
/**
 * Saves a never-published process or standard that has a working draft as the document itself,
 * in place of the working draft of revision `draft`: the draft is removed in the same step. Refused
 * (409, a draft conflict) when the draft is gone or has another revision.
 */
export const putDocReplacingDraft = <T extends Process | Standard>(kind: TargetKind, doc: T, base: number, note: string, draft: number) =>
  call<DocMeta>("PUT", `${docsPath(kind, doc.id)}${saveQuery(base, note, draft)}`, doc);

// The working draft: one shared draft beside a process or standard, seen only by its editors -
// the unpublished changes to a published one, or what cannot be saved as a never-published one
// yet (something still to fix). Readers, skills and search never see it. `revision` counts the
// saves of the draft; a save says which one it was made from.
/** `updatedByName`: the person's name when the server knew it; `updatedBy` is their email. */
export interface WorkingDraft<T> { doc: T; base: number; revision: number; updatedBy: string; updatedByName?: string; updatedAt: string }
/** The stored document as a save of its working draft found it: somebody may have retired, unpublished or saved it meanwhile. */
export interface DocHead { version: number; status: "draft" | "active" | "deprecated"; updatedAt: string; updatedBy: string; updatedByName?: string }
export interface DraftSaved { revision: number; base: number; updatedBy: string; updatedByName?: string; updatedAt: string; document?: DocHead }
const docsPath = (kind: TargetKind, id: string) => `/api/${kind === "process" ? "processes" : "standards"}/${encodeURIComponent(id)}`;
/** The working draft, or null when there is none. */
export async function loadWorkingDraft<T>(kind: TargetKind, id: string): Promise<WorkingDraft<T> | null> {
  // no draft: 204 without a body (an older server answered 404)
  try { return (await call<WorkingDraft<T> | undefined>("GET", `${docsPath(kind, id)}/draft`)) ?? null; } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
/**
 * Saves the working draft on top of revision `rev` (0: creates it). `base`: the published version
 * the changes were made from - with rev 0 the draft is created on it (so that publishing meets
 * any version published since), with a revision it moves the draft onto that version. `known`: the
 * version of the document the screen knows - only used to say who deleted it, should it be gone.
 */
export const putWorkingDraft = <T>(kind: TargetKind, id: string, doc: T, rev: number, base?: number, known?: number) =>
  call<DraftSaved>("PUT", `${docsPath(kind, id)}/draft?rev=${rev}${base ? `&base=${base}` : ""}${known ? `&known=${known}` : ""}`, doc);
export const deleteWorkingDraft = (kind: TargetKind, id: string, rev: number) => call<void>("DELETE", `${docsPath(kind, id)}/draft?rev=${rev}`);
/** Publishes the working draft as the next version. `over`: publish it over a version somebody else published since. */
export const publishWorkingDraft = (kind: TargetKind, id: string, rev: number, note = "", over?: number) =>
  call<{ version: number }>("POST", `${docsPath(kind, id)}/publish?rev=${rev}${note.trim() ? `&note=${encodeURIComponent(note.trim())}` : ""}${over ? `&over=${over}` : ""}`);

/**
 * Records that a process or standard was reviewed and is still correct: today and the person's
 * name, as a version of its own. For the team that owns it and for whoever may edit it. `day` is
 * the person's own today (not the UTC day); the server takes it while it is today somewhere on
 * Earth, and its own (UTC) day otherwise (a computer whose clock is wrong).
 */
export const confirmReview = <T extends Process | Standard>(kind: TargetKind, id: string, base: number, day = today()) =>
  call<DocMeta & { document: T }>("POST", `/api/${kind === "process" ? "processes" : "standards"}/${id}/review?base=${base}&day=${day}`);

export async function loadCatalog(): Promise<{ catalog: Catalog; version: number }> {
  const { data: c, headers } = await request<Partial<Catalog>>("GET", "/api/catalog");
  return {
    catalog: completeCatalog(c),
    version: Number(headers.get("X-Document-Version") ?? 0) || 0,
  };
}
export const putCatalog = (c: Catalog, base: number, note?: string) => call<DocMeta>("PUT", `/api/catalog${saveQuery(base, note)}`, c);

export const loadHistory = async (kind: TargetKind | "catalog", id: string) => (await call<{ versions: DocVersion[] }>("GET", `/api/history/${kind}/${id}`)).versions;
export const loadVersion = <T>(kind: TargetKind | "catalog", id: string, version: number) => call<T>("GET", `/api/history/${kind}/${id}/${version}`);

export async function loadFeedback(): Promise<FeedbackByTarget> {
  const f = await call<Partial<FeedbackByTarget>>("GET", "/api/feedback");
  return { process: f.process ?? {}, standard: f.standard ?? {} };
}
export const createFeedback = (f: { targetKind: TargetKind; targetId: string; itemId?: string; kind: string; text: string }) => call<Feedback>("POST", "/api/feedback", f);
export const setAlsoHit = (id: string, on: boolean) => call<Feedback>(on ? "POST" : "DELETE", `/api/feedback/${id}/also-hit`);
export const setResolved = (id: string, resolved: boolean) => call<Feedback>("PATCH", `/api/feedback/${id}`, { resolved });
export const deleteFeedback = (id: string) => call<void>("DELETE", `/api/feedback/${id}`);

// views, bookmarks and upvotes: counted on the server; who viewed what is never shown
export interface EngagementCounts { views: number; people: number; downloads: number; upvotes: number; handled: number }
export interface EngagementData {
  counts: Record<TargetKind, Record<string, Partial<EngagementCounts>>>;
  mine: { bookmarks: { kind: TargetKind; id: string; at: string }[]; upvotes: { kind: TargetKind; id: string }[] };
}
export async function loadEngagement(): Promise<EngagementData> {
  const r = await call<Partial<EngagementData> | null>("GET", "/api/engagement");
  return {
    counts: { process: r?.counts?.process ?? {}, standard: r?.counts?.standard ?? {} },
    mine: { bookmarks: r?.mine?.bookmarks ?? [], upvotes: r?.mine?.upvotes ?? [] },
  };
}
/** Records a view; the answer is the document's numbers after it (an older server answers with nothing). */
export const recordViewOn = (kind: TargetKind, id: string) => call<{ views?: number; people?: number } | undefined>("POST", `/api/views/${kind}/${encodeURIComponent(id)}`);
export const setBookmark = (kind: TargetKind, id: string, on: boolean) => call<void>(on ? "PUT" : "DELETE", `/api/bookmarks/${kind}/${encodeURIComponent(id)}`);
export const setUpvote = (kind: TargetKind, id: string, on: boolean) => call<{ upvotes: number }>(on ? "PUT" : "DELETE", `/api/upvotes/${kind}/${encodeURIComponent(id)}`);

// skills and review agents generated from processes and standards
export const loadSkills = async () => (await call<{ skills: Skill[] }>("GET", "/api/skills")).skills;
export const loadSkill = (id: string) => call<SkillDetail>("GET", `/api/skills/${id}`);
export const loadSkillVersion = async (id: string, version: number) => (await call<{ content: string }>("GET", `/api/skills/${id}/versions/${version}`)).content;
export const putSkillExtra = (id: string, extra: string) => call<SkillDetail>("PUT", `/api/skills/${id}/extra`, { extra });

/** Who belongs to which team, platform and practice. Everyone who is signed in may read it. */
export const loadMembers = async () => (await call<{ members?: Membership[] }>("GET", "/api/members")).members ?? [];

// a team, platform or practice changed from its own page
const groupPath = (kind: GroupKind, id: string) => `/api/groups/${kind === "team" ? "teams" : kind === "platform" ? "platforms" : "practices"}/${encodeURIComponent(id)}`;
/** What `PUT …/details` takes: a field left out is not changed, "" removes it. */
export interface GroupDetails { description?: string; contact?: string; contacts?: Contacts | null }
/** Changes the description and the contact details of one group; the answer is the lists as stored. */
export const putGroupDetails = (kind: GroupKind, id: string, d: GroupDetails) =>
  call<{ catalog: Catalog; version: number }>("PUT", `${groupPath(kind, id)}/details`, d);
/** The people of a platform or practice after adding or removing a member; `note` says when nothing changed. */
export interface GroupPeople { members?: Membership[]; note?: string }
export const addGroupMember = (kind: "platform" | "practice", id: string, email: string) =>
  call<GroupPeople>("POST", `${groupPath(kind, id)}/members`, { email });
export const removeGroupMember = (kind: "platform" | "practice", id: string, email: string) =>
  call<GroupPeople>("DELETE", `${groupPath(kind, id)}/members?email=${encodeURIComponent(email)}`);

// admin panel
export interface Access { assignments: Assignment[]; bootstrapAdmins: string[]; roles: Role[] }
export const loadAccess = () => call<Access>("GET", "/api/admin/access");
export const grantAccess = (a: { email: string; role: Role; scope: string }) => call<Access>("POST", "/api/admin/access", a);
export const revokeAccess = (a: { email: string; role: Role; scope: string }) => call<Access>("DELETE", "/api/admin/access", a);
// People and all their roles at once (Admin > Access).
export const loadUsers = async () => (await call<{ users?: AdminUser[] }>("GET", "/api/admin/users")).users ?? [];
export const saveUserRoles = (email: string, roles: UserRole[]) => call<AdminUser>("PUT", `/api/admin/users/${encodeURIComponent(email)}`, { roles });
export const deleteUser = (email: string) => call<void>("DELETE", `/api/admin/users/${encodeURIComponent(email)}`);
/** A page of the activity log, newest first. `before` is the id of the last entry already shown. */
export const loadAudit = (limit = 100, before = 0) => call<{ entries: AuditEntry[]; more: boolean }>("GET", `/api/admin/audit?limit=${limit}${before ? `&before=${before}` : ""}`);
/** `source`: whether this installation can show its own source files (Admin › Code map); it runs beside its source code (`PM_SOURCE_DIR`). */
export interface SystemInfo { provider: string; baseUrl: string; notify: string; processes: number; standards: number; skills: number; assignments: number; openFeedback: number; source?: boolean }
export const loadSystem = () => call<SystemInfo>("GET", "/api/admin/system");
/** One source file of the portal, for Admin › Code map; admins only, and only where the portal runs beside its source (else 404). */
export interface SourceFile { path: string; text: string; bytes: number }
export const loadSource = (path: string) => call<SourceFile>("GET", `/api/admin/source?path=${encodeURIComponent(path)}`);

// The look of the portal (Admin › Theming). Everyone reads it through lib/theme.ts; admins read who
// changed it last and save it on top of the revision their changes were made from.
export interface SavedLook { look: Look; revision: number; updatedAt?: string; updatedBy?: string; updatedByName?: string }
export const loadAdminLook = () => call<SavedLook>("GET", "/api/admin/theme");
export const saveLook = (look: Look, rev: number) => call<SavedLook>("PUT", `/api/admin/theme?rev=${rev}`, look);

// requests for a process or standard that does not exist yet
export const loadRequests = async () => (await call<{ requests?: DocRequest[] }>("GET", "/api/requests")).requests ?? [];
export const createRequest = (r: NewRequest) => call<DocRequest>("POST", "/api/requests", r);
/** Votes for a request (or takes the vote back); the new number of votes. */
export const voteRequest = async (id: number, on: boolean) => (await call<{ votes: number }>(on ? "PUT" : "DELETE", `/api/requests/${id}/vote`)).votes;
export const setRequestState = (id: number, s: { state: RequestState; note?: string; linkedId?: string }) => call<DocRequest>("PUT", `/api/requests/${id}/state`, s);
export const withdrawRequest = (id: number) => call<void>("DELETE", `/api/requests/${id}`);
/** One place inside a document that search by meaning found, best first. */
export interface MeaningHit { part: string; item: string; label: string; snippet: string; score: number }
/** One document search by meaning found, with up to three places inside it. */
export interface MeaningResult { kind: TargetKind; id: string; score: number; hits: MeaningHit[] }
/**
 * Search by meaning on the server: published processes and standards, best first, and whether
 * more matched than were sent (`truncated`). Refused with 404 when it is switched off, 429 when
 * one person searches very often, 502 when the service that compares the texts cannot be
 * reached, 503 while it is not ready yet. A server that takes at most 100 is asked again for 100.
 */
export async function searchByMeaning(q: string, limit = 500): Promise<{ results: MeaningResult[]; truncated: boolean }> {
  const ask = (n: number) => call<{ results?: MeaningResult[]; truncated?: boolean } | null>("GET", `/api/search?q=${encodeURIComponent(q)}&limit=${n}`);
  let r: { results?: MeaningResult[]; truncated?: boolean } | null;
  try { r = await ask(limit); } catch (e) {
    if (!(e instanceof ApiError && e.status === 400 && limit > 100)) throw e;
    r = await ask(100);
  }
  return { results: Array.isArray(r?.results) ? r!.results : [], truncated: r?.truncated === true };
}

/** Use of processes and standards over a period, for admins. */
export const loadStatistics = (period: Period) => call<Statistics>("GET", `/api/admin/statistics?period=${period}`);

/** Personal "done" ticks, kept in the browser only - they are not part of the process definition. */
export function useProgress(processId: string) {
  const key = `pm:progress:${processId}`;
  const read = () => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]")); } catch { return new Set<string>(); }
  };
  const [done, setDone] = useState<Set<string>>(read);
  useEffect(() => setDone(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const persist = (s: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* private mode */ } };
  const toggle = useCallback((id: string) => setDone((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(next);
    return next;
  }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => { const e = new Set<string>(); persist(e); setDone(e); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { done, toggle, reset };
}

/** "json": an older address of the text of a document; it now opens the editing screen. */
export type Tab = "flow" | "list" | "feedback" | "skills" | "json";
export type StandardTab = "doc" | "feedback" | "skills" | "json";
export type AdminSection = "access" | "lists" | "skills" | "health" | "activity" | "statistics" | "theming" | "system" | "code";
/**
 * Where Admin › Code map is: `category` is the category open (`#/admin/code/tables`), `file` a
 * file of it (`#/admin/code/tables/file/server/internal/db/db.go`), `q` the search of the
 * overview (`#/admin/code?q=vector`), `at` the place on a category's or a file's page it opens at
 * (`#/admin/code/tables?at=table-documents`, `…/file/…/store.go?at=req-2`; see `anchorOf` in
 * `src/lib/codemap.ts`). An unknown category or file is kept: the page says it is not there.
 */
export interface CodeView { category?: string; file?: string; q?: string; at?: string }
/** What the list of services shows: the words searched for and the team chosen (`#/services?q=dns&team=dns-team`). */
export interface ServicesView { q?: string; team?: string }
/** `item` is the step or the requirement that is open, so that a link can point at one. */
export type Route =
  | { page: "home" } | ({ page: "search" } & SearchState)
  | ({ page: "library" } & ListState) | ({ page: "standards" } & ListState) | ({ page: "catalog" } & CatalogView) | { page: "guide" } | { page: "mine" }
  | ({ page: "requests" } & RequestsView)
  | ({ page: "admin"; section: AdminSection } & CodeView & CatalogView)
  | { page: "process"; id: string; tab: Tab; item?: string }
  | { page: "standard"; id: string; tab: StandardTab; item?: string }
  /** The editing screen; `item` is the step or requirement that is selected. */
  | { page: "edit-process"; id: string; item?: string }
  | { page: "edit-standard"; id: string; item?: string }
  /** The page of a team, a platform or a practice. */
  | { page: "group"; kind: GroupKind; id: string }
  /** The page of a tribe (a group of teams) or a domain (a group of tribes). */
  | { page: "pillar" | "tribe" | "domain"; id: string }
  /** The list of services, and the page of one. */
  | ({ page: "services" } & ServicesView)
  | { page: "service"; id: string };

/** The lists, as the address names them. */
export const CATALOG_LISTS = ["teams", "pillars", "tribes", "domains", "practices", "platforms", "categories", "tools", "patterns", "tiers", "paths", "environments", "languages", "services"] as const;
export type CatalogList = (typeof CATALOG_LISTS)[number];
/** Which list of Teams or Tools is open and which entry is chosen: `#/teams/platforms/google-cloud`. */
export interface CatalogView { place?: ListPlace; list?: CatalogList; id?: string }
/**
 * The lists are three places, in the top bar and in Admin: Teams (who: the teams and their groups,
 * practices, platforms), Tools (what things are built with and where rules apply) and Services
 * (what teams do for others on request: one list, with a place and a page of its own for readers,
 * `#/services`, `#/service/:id`). Each list is in one of them; each place opens on its first list.
 */
export type ListPlace = "teams" | "tools" | "services";
export const PLACE_LISTS: Record<ListPlace, readonly CatalogList[]> = {
  teams: ["teams", "pillars", "tribes", "domains", "practices", "platforms"],
  tools: ["tools", "categories", "patterns", "tiers", "paths", "environments", "languages"],
  services: ["services"],
};
/** The place a list is in. */
export const placeOfList = (list: CatalogList): ListPlace => (list === "services" ? "services" : PLACE_LISTS.tools.includes(list) ? "tools" : "teams");
/** What each place of the lists is called, in the top bar and in Admin's side menu. */
export const PLACE_WORD: Record<ListPlace, string> = { teams: "Teams", tools: "Tools", services: "Services" };
/** The place a view of the lists is in: its list's, else the one it names, else Teams. */
export const placeOfView = (v: CatalogView): ListPlace => (v.list ? placeOfList(v.list) : v.place ?? "teams");
/** `#/teams`, `#/tools/paths`, `#/teams/teams/dns-team`: the place, then the list unless it is the place's first and no entry is named. */
function listsPath(base: string, v: CatalogView): string {
  const place = placeOfView(v);
  // the services are one list: Admin's address names the entry right after the place
  // (`#/admin/services/dns-record-change`); readers have the place and a page of their own
  if (place === "services") return base === "#/" ? (v.id ? `#/service/${v.id}` : "#/services") : `${base}services${v.id ? `/${v.id}` : ""}`;
  const list = v.list && (v.id || v.list !== PLACE_LISTS[place][0]) ? `/${v.list}${v.id ? `/${v.id}` : ""}` : "";
  return `${base}${place}${list}`;
}
/** A reader's address of the lists: the services have a place and a page of their own. */
function readerLists(v: CatalogView): Route {
  if (v.place !== "services") return { page: "catalog", ...v };
  return v.id ? { page: "service", id: v.id } : { page: "services" };
}
/** The search and the team chosen on the list of services, from its address. */
function parseServicesQuery(query: string): ServicesView {
  const v: ServicesView = {};
  for (const part of query.split("&")) {
    if (part.startsWith("q=")) { const q = decode(part.slice(2)); if (q.trim()) v.q = q; }
    if (part.startsWith("team=")) { const t = decodePart(part.slice(5)).trim(); if (/^[a-z0-9-]+$/.test(t)) v.team = t; }
  }
  return v;
}
/** A place of the lists read from an address: `teams` or `tools`, then a list and an entry; anything not known is left out. */
function parseLists(place: ListPlace | undefined, list: string | undefined, id: string | undefined): CatalogView {
  const known = (CATALOG_LISTS as readonly string[]).includes(list ?? "") ? (list as CatalogList) : undefined;
  if (!known) return place ? { place } : {};
  return { place: placeOfList(known), list: known, ...(id ? { id } : {}) };
}

/**
 * What the results page shows: the words searched for and the filters. Several values of one
 * filter mean "any of these"; different filters all apply. Empty ones are left out.
 */
export interface SearchState {
  q?: string;
  type?: TargetKind[];
  rigour?: import("../types").Rigour[];
  category?: string[];
  practice?: string[];
  platform?: string[];
  /** The team that maintains it. */
  owner?: string[];
  /** The paths it is for (greenfield, paved path…); "-" for what names none. */
  path?: string[];
  /** The architecture patterns it is tagged with (a tag: what is not tagged has no value). */
  pattern?: string[];
  /** The page of the results shown, from 1 (1 is left out of the address). */
  pageNo?: number;
  /** How many results a page shows: 12, 24 or 48; left out, the person's own choice. */
  size?: number;
  /** Search by meaning, or both ways; left out, by words. */
  mode?: "meaning" | "both";
  /** The order: newest first (date added), recently updated first; left out, the best match (or by name). */
  sort?: "newest" | "updated";
}
/** What the list of processes or of standards carries in its address: the search, the filters, the page, the order. */
export type ListState = Omit<SearchState, "type" | "mode">;
/** Only what a list keeps of a search address. */
const listOf = (r: SearchState): ListState => { const { type: _t, mode: _m, ...rest } = r; void _t; void _m; return rest; };
const SEARCH_LISTS = ["type", "rigour", "category", "practice", "platform", "owner", "path", "pattern"] as const;
const SEARCH_SIZES = [12, 24, 48];
const SEARCH_ALLOWED: Partial<Record<(typeof SEARCH_LISTS)[number], string[]>> = { type: ["process", "standard"], rigour: ["mandatory", "recommended", "optional"] };
/**
 * A value from the address in plain text. A broken escape (a typed "100%") is kept as it was
 * typed instead of losing the whole value; the escapes around it are still read.
 */
export function decode(s: string): string {
  const text = s.replace(/\+/g, " ");
  try { return decodeURIComponent(text); } catch {
    return text.replace(/(%[0-9A-Fa-f]{2})+/g, (run) => { try { return decodeURIComponent(run); } catch { return run; } });
  }
}
/** `#/search?q=…&platform=azure,github`: unknown or empty parts are ignored. */
function parseSearch(query: string): Route {
  const r: { page: "search" } & SearchState = { page: "search" };
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq), raw = part.slice(eq + 1);
    if (key === "q") { const q = decode(raw); if (q.trim()) r.q = q; continue; }
    if (key === "page") { if (/^[1-9]\d{0,5}$/.test(raw)) r.pageNo = Number(raw); continue; }
    if (key === "size") { if (SEARCH_SIZES.includes(Number(raw)) && /^\d+$/.test(raw)) r.size = Number(raw); continue; }
    if (key === "mode") { if (raw === "meaning" || raw === "both") r.mode = raw; continue; }
    if (key === "sort") { if (raw === "newest" || raw === "updated") r.sort = raw; continue; }
    if (!(SEARCH_LISTS as readonly string[]).includes(key)) continue;
    const k = key as (typeof SEARCH_LISTS)[number];
    const values = [...new Set(raw.split(",").map((v) => decode(v).trim()).filter((v) => v && (!SEARCH_ALLOWED[k] || SEARCH_ALLOWED[k]!.includes(v))))];
    if (values.length) r[k] = values as never; // checked against the allowed values above
  }
  return r;
}
function searchHref(r: SearchState, path = "#/search"): string {
  const parts: string[] = [];
  if (r.q?.trim()) parts.push(`q=${encodeURIComponent(r.q)}`);
  for (const k of SEARCH_LISTS) if (r[k]?.length) parts.push(`${k}=${(r[k] as string[]).map(encodeURIComponent).join(",")}`);
  if (r.pageNo && Number.isInteger(r.pageNo) && r.pageNo > 1) parts.push(`page=${r.pageNo}`);
  if (r.size && SEARCH_SIZES.includes(r.size)) parts.push(`size=${r.size}`);
  if (r.mode === "meaning" || r.mode === "both") parts.push(`mode=${r.mode}`);
  if (r.sort === "newest" || r.sort === "updated") parts.push(`sort=${r.sort}`);
  return `${path}${parts.length ? `?${parts.join("&")}` : ""}`;
}

/** A part of a path in the address, decoded; a broken escape is kept as it was written. */
const decodePart = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
function parseCode(category: string | undefined, file: string | undefined, query: string | undefined): CodeView {
  const v: CodeView = {};
  const c = category ? decodePart(category).trim() : "";
  if (c) {
    v.category = c;
    const f = (file ?? "").split("/").filter(Boolean).map(decodePart).join("/");
    if (f) v.file = f;
  }
  for (const part of (query ?? "").split("&")) {
    if (part.startsWith("q=") && !v.category) { const q = decode(part.slice(2)); if (q.trim()) v.q = q; }
    if (part.startsWith("at=") && v.category) { const at = decodePart(part.slice(3)).trim(); if (at) v.at = at; }
  }
  return v;
}
/** The address of a place in Admin › Code map: each part of a file's path is encoded on its own, the slashes stay. */
function codeHref(v: CodeView): string {
  if (!v.category) return `#/admin/code${v.q?.trim() ? `?q=${encodeURIComponent(v.q)}` : ""}`;
  const file = v.file ? `/file/${v.file.split("/").filter(Boolean).map(encodeURIComponent).join("/")}` : "";
  return `#/admin/code/${encodeURIComponent(v.category)}${file}${v.at?.trim() ? `?at=${encodeURIComponent(v.at.trim())}` : ""}`;
}

const parse = (h: string = location.hash): Route => {
  const search = h.match(/^#\/search(?:\?(.*))?$/);
  if (search) return parseSearch(search[1] ?? "");
  const list = h.match(/^#\/(processes|standards)(?:\?(.*))?$/);
  if (list) {
    const { page: _p, ...state } = parseSearch(list[2] ?? "") as { page: "search" } & SearchState;
    void _p;
    return { page: list[1] === "processes" ? "library" : "standards", ...listOf(state) };
  }
  if (h.startsWith("#/processes")) return { page: "library" };
  // Teams and Tools; the older one place "Teams & tools" (#/catalog…) leads to the same list and entry
  const place = h.match(/^#\/(teams|tools)(?:\/([a-z]+)(?:\/([a-z0-9-]+))?)?\/?$/);
  if (place) return readerLists(parseLists(place[1] as ListPlace, place[2], place[3]));
  const cat = h.match(/^#\/catalog(?:\/([a-z]+)(?:\/([a-z0-9-]+))?)?\/?$/);
  if (cat) return readerLists(parseLists("teams", cat[1], cat[2]));
  const services = h.match(/^#\/services(?:\?(.*))?$/);
  if (services) return { page: "services", ...parseServicesQuery(services[1] ?? "") };
  const service = h.match(/^#\/service\/([a-z0-9-]+)\/?$/);
  if (service) return { page: "service", id: service[1] };
  if (h.startsWith("#/catalog")) return { page: "catalog", place: "teams" };
  if (h.startsWith("#/guide")) return { page: "guide" };
  if (h.startsWith("#/mine")) return { page: "mine" };
  if (h.startsWith("#/standards")) return { page: "standards" };
  const cluster = h.match(/^#\/(pillar|tribe|domain)\/([a-z0-9-]+)\/?$/);
  if (cluster) return { page: cluster[1] as "pillar" | "tribe" | "domain", id: cluster[2] };
  const group = h.match(/^#\/(team|platform|practice)\/([a-z0-9-]+)\/?$/);
  if (group) return { page: "group", kind: group[1] as GroupKind, id: group[2] };
  const requests = h.match(/^#\/requests(?:\?(.*))?$/);
  if (requests) return { page: "requests", ...parseRequestsQuery(requests[1] ?? "") };
  const code = h.match(/^#\/admin\/code(?:\/([^/?#]+)(?:\/file(?:\/([^?#]*))?)?)?\/?(?:\?(.*))?$/);
  if (code) return { page: "admin", section: "code", ...parseCode(code[1], code[2], code[3]) };
  // Admin's two entries of the lists, Teams and Tools, at a list and an entry ("Edit in Admin ›
  // Teams" on a pillar's page); the older #/admin/lists… opens the right one of the two
  // Admin › Services: one list, so the entry comes right after the place; `services/<id>` (the
  // way the other places write it) is read as the same and corrected
  const adminServices = h.match(/^#\/admin\/services(?:\/([a-z0-9-]+))?(?:\/([a-z0-9-]+))?\/?$/);
  if (adminServices) {
    const id = adminServices[2] ? (adminServices[1] === "services" ? adminServices[2] : undefined) : adminServices[1];
    // without an entry it names only the place: Admin goes back to the service last shown there
    return { page: "admin", section: "lists", place: "services", ...(id ? { list: "services", id } : {}) };
  }
  const adminLists = h.match(/^#\/admin\/(teams|tools|lists)(?:\/([a-z]+)(?:\/([a-z0-9-]+))?)?\/?$/);
  if (adminLists) return { page: "admin", section: "lists", ...parseLists(adminLists[1] === "tools" ? "tools" : "teams", adminLists[2], adminLists[3]) };
  const admin = h.match(/^#\/admin(?:\/(access|lists|skills|health|activity|statistics|theming|system|code))?/);
  if (admin) return { page: "admin", section: (admin[1] as AdminSection) ?? "access" };
  const es = h.match(/^#\/s\/([a-z0-9-]+)\/(?:edit(?:\/([A-Z][A-Z0-9-]*))?|json)/);
  if (es) return { page: "edit-standard", id: es[1], ...(es[2] ? { item: es[2] } : {}) };
  const ep = h.match(/^#\/p\/([a-z0-9-]+)\/(?:edit(?:\/([a-z0-9-]+))?|json)/);
  if (ep) return { page: "edit-process", id: ep[1], ...(ep[2] ? { item: ep[2] } : {}) };
  const s = h.match(/^#\/s\/([a-z0-9-]+)(?:\/(doc|feedback|skills)(?:\/([A-Z][A-Z0-9-]*))?)?/);
  if (s) return { page: "standard", id: s[1], tab: (s[2] as StandardTab) ?? "doc", ...(s[3] ? { item: s[3] } : {}) };
  const m = h.match(/^#\/p\/([a-z0-9-]+)(?:\/(flow|list|feedback|skills)(?:\/([a-z0-9-]+))?)?/);
  return m ? { page: "process", id: m[1], tab: (m[2] as Tab) ?? "flow", ...(m[3] ? { item: m[3] } : {}) } : { page: "home" };
};
/** The route an address stands for; exported for tests. */
export const parseRoute = (hash: string): Route => parse(hash);

// ---------- unsaved work
// A page that has unsaved edits says so here. Leaving it then asks first: moving on inside the
// app (a link, Back, signing out) and closing or reloading the tab.

const unsaved = new Map<string, string>(); // what is being edited -> what to call it
/**
 * The places a route keeps open: leaving all places where something is edited is what loses
 * the edits. A process or standard is edited only on its editing screen (with its JSON); the
 * reader's page edits nothing.
 */
const placesOf = (r: Route): string[] => {
  if (r.page === "edit-process" || r.page === "edit-standard") {
    const doc = `${r.page === "edit-process" ? "process" : "standard"}/${r.id}`;
    return [doc, `${doc}#json`];
  }
  if (r.page === "admin" && r.section === "theming") return ["theme"];
  return r.page === "admin" && r.section === "lists" ? ["catalog"] : [];
};

const beforeUnload = (e: BeforeUnloadEvent) => { if (unsaved.size) e.preventDefault(); };
let listening = false;

/** Marks something as having unsaved edits until the returned function is called. */
export function guardLeaving(key: string, what: string): () => void {
  unsaved.set(key, what);
  if (!listening && typeof window !== "undefined") { window.addEventListener("beforeunload", beforeUnload); listening = true; }
  return () => { if (unsaved.get(key) === what) unsaved.delete(key); };
}
/** Forgets the unsaved edits of something that is gone, e.g. after it was deleted. */
export function forgetUnsaved(key: string) {
  for (const k of [...unsaved.keys()]) if (k === key || k.startsWith(`${key}#`)) unsaved.delete(k);
}
/** Whether this thing has unsaved edits. */
export const hasUnsaved = (key: string) => unsaved.has(key);
/** What would be lost by going to `to` (or by leaving the app when `to` is missing), if anything. */
export function unsavedWork(to?: Route): string | null {
  const staying = to ? placesOf(to) : [];
  for (const [key, what] of unsaved) if (!staying.includes(key)) return what;
  return null;
}

// Where the edits can be saved from the question itself: the editing screen offers its own
// "Save draft" (never a second way to save). Resolves to true once saved.
type Saver = () => Promise<boolean>;
const savers = new Map<string, Saver>();
/** Offers `save` for the unsaved edits under `key` while the returned function is not called. */
export function offerSaving(key: string, save: Saver): () => void {
  savers.set(key, save);
  return () => { if (savers.get(key) === save) savers.delete(key); };
}
/**
 * How the edits lost by going to `to` (or by leaving the app) can be saved first: only when
 * everything that would be lost can be (text with problems in the JSON cannot); null otherwise.
 */
export function unsavedSaver(to?: Route): Saver | null {
  const staying = to ? placesOf(to) : [];
  const lost = [...unsaved.keys()].filter((k) => !staying.includes(k));
  if (!lost.length || !lost.every((k) => savers.has(k))) return null;
  const all = lost.map((k) => savers.get(k)!);
  return async () => { for (const save of all) if (!(await save())) return false; return true; };
}

/** Asked before a move that would lose unsaved edits; `save` when they can be saved first. True: go. */
export type LeaveQuestion = (what: string, save?: Saver | null) => Promise<boolean>;
// Set by the app (useRoute).
let confirmLeave: LeaveQuestion | undefined;
// An address the person agreed to move to although edits are lost.
let agreed: string | null = null;

/** Goes to `hash`, after asking when unsaved edits would be lost. */
async function moveTo(hash: string, replace = false) {
  const lost = unsavedWork(parse(hash));
  if (lost && confirmLeave && !(await confirmLeave(lost, unsavedSaver(parse(hash))))) return;
  if (lost) agreed = hash;
  if (!replace) { location.hash = hash; return; }
  // the same place in the browser's history, under another address
  history.replaceState(history.state, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

type Mark = { pm?: number } | null;

/**
 * The current route. `ask` is asked before a move that would lose unsaved edits. Links and
 * buttons of the app are stopped before anything happens. The Back and Forward buttons and a
 * typed address have already moved when the app hears of them: the browser is then sent back
 * to where it was while asking, and on "leave" the same move is made again - so the history
 * stays as it was either way.
 */
export function useRoute(ask?: LeaveQuestion): Route {
  const [route, setRoute] = useState<Route>(() => parse());
  confirmLeave = ask;
  useEffect(() => {
    // every entry of the history gets a running number, so that a move can be told from its opposite
    let position = (history.state as Mark)?.pm ?? 0;
    if ((history.state as Mark)?.pm === undefined) history.replaceState({ pm: position }, "");
    let undoing = 0; // moves of our own that put the browser back: not news
    // where the browser itself says we are in its history, where it can tell (most browsers do)
    const at = (): number | undefined => (window as { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
    let index = at();
    let shown = location.hash; // the address of what is on screen
    const on = async () => {
      if (undoing > 0) { undoing--; return; }
      const target = location.hash;
      const mark = (history.state as Mark)?.pm;
      const fresh = mark === undefined; // an entry the browser just added (a typed address, a link)
      const lost = target === agreed ? null : unsavedWork(parse(target));
      agreed = null;
      if (!lost || !confirmLeave) {
        if (fresh) { position += 1; history.replaceState({ pm: position }, ""); } else position = mark;
        index = at();
        shown = target;
        setRoute(parse(target));
        return;
      }
      // The move that undoes what the browser just did: from its own count where it has one,
      // else from our numbers. An entry without a number may be a new one or one from before
      // the app was loaded; without the browser's count there is no telling which, and then
      // the address is put back in place instead of guessing a direction.
      const now = at();
      const back = now !== undefined && index !== undefined ? index - now : fresh ? 0 : position - mark;
      if (back === 0) {
        history.replaceState(history.state, "", shown || "#/");
        if (await confirmLeave(lost, unsavedSaver(parse(target)))) { agreed = target; location.hash = target; }
        return;
      }
      undoing++;
      history.go(back);
      if (await confirmLeave(lost, unsavedSaver(parse(target)))) {
        agreed = target;
        history.go(-back);
      }
    };
    // a link inside the app: ask before following it, so that "Stay" leaves no trace
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href^='#/']") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || !unsavedWork(parse(a.hash))) return;
      e.preventDefault();
      void moveTo(a.hash);
    };
    window.addEventListener("hashchange", on);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("hashchange", on); document.removeEventListener("click", click, true); };
  }, []);
  return route;
}

export const href = (r: Route): string => {
  switch (r.page) {
    case "home": return "#/";
    case "search": return searchHref(r);
    case "library": return searchHref(listOf(r), "#/processes");
    case "standards": return searchHref(listOf(r), "#/standards");
    case "catalog": return listsPath("#/", r);
    case "guide": return "#/guide";
    case "mine": return "#/mine";
    case "requests": return `#/requests${requestsQuery(r)}`;
    case "admin": return r.section === "code" ? codeHref(r) : r.section === "lists" ? listsPath("#/admin/", r) : `#/admin/${r.section}`;
    case "standard": return r.tab === "json" ? `#/s/${r.id}/edit` : `#/s/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
    case "process": return r.tab === "json" ? `#/p/${r.id}/edit` : `#/p/${r.id}/${r.tab}${r.item ? `/${r.item}` : ""}`;
    case "edit-process": return `#/p/${r.id}/edit${r.item ? `/${r.item}` : ""}`;
    case "edit-standard": return `#/s/${r.id}/edit${r.item ? `/${r.item}` : ""}`;
    case "group": return `#/${r.kind}/${r.id}`;
    case "pillar": case "tribe": case "domain": return `#/${r.page}/${r.id}`;
    case "services": {
      const q = [r.q?.trim() ? `q=${encodeURIComponent(r.q)}` : "", r.team ? `team=${encodeURIComponent(r.team)}` : ""].filter(Boolean).join("&");
      return `#/services${q ? `?${q}` : ""}`;
    }
    case "service": return `#/service/${r.id}`;
  }
};
/**
 * Goes to a page of the app. With unsaved edits that would be lost, it asks first. With
 * `replace` the address changes without a new entry in the browser's history: for what is not
 * a step forward, such as a step that got another id.
 */
/**
 * The right address of a page of the lists when the one typed or followed is not it: a list asked
 * of the wrong place (`#/teams/tools`, `#/tools/teams/dns-team`, `#/admin/tools/pillars/x`), an
 * unknown list (`#/admin/teams/bogus`: the place, which opens on its first list) and the older
 * addresses (`#/catalog…`, `#/admin/lists…`). Null when the address is already right or not one of
 * the lists, so that replacing it once never leads to another replacement.
 */
export function correctedListsAddress(hash: string): string | null {
  const r = parse(hash);
  // a service asked of Teams or Tools (`#/teams/services/x`) is the page of that service
  const asList = (r.page === "service" || r.page === "services") && /^#\/(teams|tools|catalog)(\/|$)/.test(hash);
  if (r.page !== "catalog" && !(r.page === "admin" && r.section === "lists") && !asList) return null;
  const right = href(r);
  return right === hash ? null : right;
}
export const go = (r: Route, opts: { replace?: boolean } = {}) => { void moveTo(href(r), opts.replace); };

/** What the browser tab says for a page: the thing being read first, the portal's name (Admin › Theming) last. */
export function pageTitle(r: Route, names: { process?: string; standard?: string; group?: string; service?: string; loading?: boolean } = {}, app = portalName()): string {
  const APP = app;
  const of = (name: string | undefined, missing: string) => name ?? (names.loading ? "" : missing);
  let here: string;
  switch (r.page) {
    case "home": here = ""; break;
    case "search": here = r.q?.trim() ? `“${r.q.trim()}” · Search` : "Search"; break;
    case "library": here = "Patterns"; break;
    case "standards": here = "Standards"; break;
    case "catalog": here = PLACE_WORD[placeOfView(r)]; break;
    case "services": here = "Services"; break;
    case "service": here = of(names.service, "Service not found"); break;
    case "guide": here = "Guide"; break;
    case "mine": here = "My responsibilities"; break;
    case "requests": here = "Requests"; break;
    case "admin": here = r.section === "lists" ? `${PLACE_WORD[placeOfView(r)]} · Admin`
      : r.section !== "code" ? `${r.section.slice(0, 1).toUpperCase()}${r.section.slice(1)} · Admin`
      : `${r.file ? `${r.file.split("/").pop()} · ` : ""}Code map · Admin`; break;
    case "process": here = of(names.process, "Process not found"); break;
    case "standard": here = of(names.standard, "Standard not found"); break;
    case "edit-process": here = names.process ? `Editing ${names.process}` : of(undefined, "Process not found"); break;
    case "edit-standard": here = names.standard ? `Editing ${names.standard}` : of(undefined, "Standard not found"); break;
    case "group": here = of(names.group, `${r.kind === "team" ? "Team" : r.kind === "platform" ? "Platform" : "Practice"} not found`); break;
    case "pillar": case "tribe": case "domain": here = of(names.group, `${r.page === "pillar" ? "Pillar" : r.page === "tribe" ? "Tribe" : "Domain"} not found`); break;
  }
  return here ? `${here} · ${APP}` : APP;
}

/** Where an uploaded icon (of a tool or a language) is served. */
export const iconUrl = (id: string) => `/api/icons/${encodeURIComponent(id)}`;
/** Uploads an icon (the image's bytes as they are); the answer's `id` is what a tool or language names. */
export async function uploadIcon(file: Blob): Promise<{ id: string; contentType: string; width: number; height: number }> {
  let res: Response;
  try {
    res = await fetch("/api/icons", { method: "POST", headers: changeHeaders(file.type || "application/octet-stream"), body: file });
  } catch {
    throw new ApiError(0, unreachableMessage("POST"));
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) { window.dispatchEvent(new Event(SIGNED_OUT)); throw new ApiError(401, "You are signed out. Sign in again, then repeat what you were doing."); }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `The portal could not do that (answer ${res.status}). Try again in a moment.`);
  return data;
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
