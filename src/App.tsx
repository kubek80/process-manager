import { createPortal } from "react-dom";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ClipboardCheck, LayoutGrid, LogOut, Menu, Moon, Search, Settings2, ShieldCheck, Sun, Users, X } from "lucide-react";
import { Lightbulb } from "lucide-react";
import type { Catalog, DocMeta, Feedback, FeedbackByTarget, Me, Process, Standard, TargetKind } from "./types";
import {
  ApiError, confirmReview, createFeedback, deleteFeedback, go, href, loadCatalog, loadFeedback, loadMe, loadProcesses, loadStandards, logout, pageTitle, putCatalog, putProcess, putStandard,
  removeProcess, removeStandard, savedMeta, setAlsoHit, setResolved, SIGNED_OUT, forgetUnsaved, hasUnsaved, unsavedSaver, unsavedWork, useRoute, type MetaById,
} from "./lib/store";
import { CatalogContext, EMPTY_CATALOG, useCatalog } from "./lib/catalog";
import { EngagementProvider } from "./lib/engagement";
import { canOpenAdmin, FeedbackContext, MeContext, usePerms, type FeedbackActions } from "./lib/session";
import { belongsRefused, canDraft, draftAudience, editsAll, newDocPlaces } from "./lib/rights";
import { blankProcess, blankStandard, slugify, tidy, tidyStandard, today, uniqueId, type BelongsTo } from "./lib/edit";
import { CatalogPage } from "./components/CatalogPage";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { ProcessPage, processAiSpec } from "./components/ProcessPage";
import { StandardPage, standardAiSpec } from "./components/StandardPage";
import { StandardsLibrary } from "./components/StandardsLibrary";
import { MinePage } from "./components/MinePage";
import { accountRoles, minePlace } from "./lib/responsibilities";
import { platformName, practiceName } from "./lib/catalog";
import { groupEntry } from "./lib/groups";
import type { GroupKind } from "./lib/members";
import { chooseDialog, confirmDialog, ErrorBoundary, Field, LoadError, Loading, Modal, Notices, notify, useLayer } from "./components/ui";
import { BrandLogo } from "./components/Brand";
import { chooseDark, refreshLook, startLook, useLook } from "./lib/theme";
import "./theme.css";

// the last look (Admin › Theming) and light or dark, before anything is drawn: no flash of the default look
startLook();

// loaded when first opened: most visits never need them
const AdminPage = lazy(() => import("./components/AdminPage").then((m) => ({ default: m.AdminPage })));
const GuidePage = lazy(() => import("./components/GuidePage").then((m) => ({ default: m.GuidePage })));
const HomePage = lazy(() => import("./components/HomePage").then((m) => ({ default: m.HomePage })));
const SearchPage = lazy(() => import("./components/SearchPage").then((m) => ({ default: m.SearchPage })));
const GroupPage = lazy(() => import("./components/GroupPage").then((m) => ({ default: m.GroupPage })));
const RequestsPage = lazy(() => import("./components/RequestsPage").then((m) => ({ default: m.RequestsPage })));
const EditProcessPage = lazy(() => import("./components/EditProcessPage").then((m) => ({ default: m.EditProcessPage })));
const EditStandardPage = lazy(() => import("./components/EditStandardPage").then((m) => ({ default: m.EditStandardPage })));
const AiDialog = lazy(() => import("./components/AiDialog").then((m) => ({ default: m.AiDialog }))) as typeof import("./components/AiDialog").AiDialog;

/**
 * A page for something that is not there (deleted, or never existed). The lists in memory may be
 * older than the address - somebody may have created it since - so the server is asked once first.
 */
function NotFound({ noun, recheck }: { noun: "process" | "standard" | GroupKind; recheck?: () => Promise<unknown> }) {
  const [checked, setChecked] = useState(!recheck);
  useEffect(() => { if (recheck) void recheck().catch(() => {}).finally(() => setChecked(true)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!checked) return <Loading page />;
  const doc = noun === "process" || noun === "standard";
  return (
    <div className="page not-found"><h1>{noun.slice(0, 1).toUpperCase()}{noun.slice(1)} not found</h1>
      <p className="muted">This {noun} does not exist (any more). It may have been {doc ? "renamed or deleted" : "removed from the lists"}.</p>
      {doc
        ? <a className="btn" href={href({ page: noun === "process" ? "library" : "standards" })}>Back to all {noun === "process" ? "processes" : "standards"}</a>
        : <a className="btn" href={href({ page: "catalog" })}>Back to Teams &amp; tools</a>}</div>
  );
}

/** Signed out: the sign-in screen. Signed in: the app. */
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  // a new visitor (no look kept from an earlier visit) sees nothing until the look is known, so
  // that the first thing drawn already has the portal's name, logo and colours
  const { name, known } = useLook();
  const refresh = useCallback(() => { setError(null); loadMe().then(setMe).catch((e) => setError(e.message)); }, []);
  useEffect(refresh, [refresh]);
  // the look as it is now: also before signing in, for the sign-in page
  useEffect(() => { void refreshLook(); }, []);
  useEffect(() => { if (!me?.authenticated) document.title = name; }, [me, name]);

  let body;
  if (error) body = <main className="login"><div className="login-card"><h1>{name}</h1><LoadError what="The portal could not be opened." error={error} onRetry={refresh} /></div></main>;
  else if (!me || !known) body = null;
  else if (!me.authenticated) body = <Login me={me} onSignedIn={refresh} />;
  else body = <MeContext.Provider value={me}><EngagementProvider key={me.user!.email}><Shell key={me.user!.email} me={me} onSignedOut={refresh} /></EngagementProvider></MeContext.Provider>;
  return <>{body}<Notices /></>;
}

function UserMenu({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const perms = usePerms();
  const { catalog } = useCatalog();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // closes on a click or a focus move anywhere else, and on Escape (see AccountPop)
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("focusin", away);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("focusin", away); };
  }, [open]);
  return (
    <div className="user-menu" ref={box}>
      <button ref={button} className="user-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="account-pop" aria-label="Your account" title={me.user!.name}>
        <span className="avatar">{me.user!.name.slice(0, 1).toUpperCase()}</span><span className="user-name">{me.user!.name}</span>
      </button>
      {open && (
        <AccountPop onClose={() => { setOpen(false); button.current?.focus(); }}>
          <strong>{me.user!.name}</strong>
          <span className="muted">{me.user!.email}</span>
          <ul className="account-roles" aria-label="Your roles">{accountRoles(perms, { team: catalog.teams, platform: catalog.platforms, practice: catalog.practices }).map((r) => <li key={r}>{r}</li>)}</ul>
          <button className="btn small" onClick={async () => {
            if (!await mayLeave(unsavedWork(), unsavedSaver())) return;
            await logout().catch(() => {});
            onSignedOut();
          }}>
            <LogOut size={14} />{me.provider === "dev" ? "Switch user" : "Sign out"}
          </button>
        </AccountPop>
      )}
    </div>
  );
}

/** A main place of the portal: in the top bar, and in the menu on small screens. */
interface Place { key: string; pages: string[]; href: string; label: string; title: string; icon: typeof Search; count?: number; name?: string }

function PlaceLink({ place: p, on, current, onGo }: { place: Place; on: string; current?: "page"; onGo?: () => void }) {
  const Icon = p.icon;
  return (
    <a className={`nav-link ${on}`} aria-current={current} href={p.href} aria-label={p.name ?? p.label} title={p.title} onClick={onGo}>
      <Icon size={onGo ? 18 : 15} aria-hidden="true" /><span>{p.label}</span>{!!p.count && <b className="nav-count">{p.count}</b>}
    </a>
  );
}

/**
 * On small screens the main places are behind one labelled button: a sheet under the top bar
 * lists them with their names, the current one marked. It closes on a choice, Escape, or a press
 * outside it.
 */
function MenuButton({ places, on, current }: { places: Place[]; on: (...pages: string[]) => string; current: (...pages: string[]) => "page" | undefined }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const here = places.find((p) => on(...p.pages));
  const waiting = places.reduce((n, p) => n + (p.count ?? 0), 0);
  // going somewhere else (also with the browser's Back) closes it
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);
  return (
    <div className="menu-box">
      <button ref={button} className="menu-btn" aria-expanded={open} aria-controls="main-menu" onClick={() => setOpen(!open)}
        aria-label={waiting ? `Menu, ${waiting} waiting` : "Menu"} title="All places of the portal">
        {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}<span className="menu-word">Menu</span>
        {/* the count belongs to the menu (what waits inside it), not to the place the person is at */}
        {waiting > 0 && <b className="nav-count" aria-hidden="true">{waiting}</b>}
        {here && <span className="menu-here" aria-hidden="true">{here.label}</span>}
      </button>
      {open && <MenuSheet onClose={() => setOpen(false)} returnFocus={() => button.current}>
        {places.map((p) => <PlaceLink key={p.key} place={p} on={on(...p.pages)} current={current(...p.pages)} onGo={() => setOpen(false)} />)}
      </MenuSheet>}
    </div>
  );
}

function MenuSheet({ onClose, returnFocus, children }: { onClose: () => void; returnFocus: () => HTMLElement | null; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayer(ref, onClose, { modal: true, returnFocus });
  // outside the top bar: its blur would make it the frame of anything fixed inside it
  return createPortal(
    <>
      <div className="menu-shade" onClick={onClose} aria-hidden="true" />
      <nav ref={ref} id="main-menu" className="menu-sheet" aria-label="Main">{children}</nav>
    </>,
    document.body,
  );
}

/**
 * Asks before unsaved edits are left behind. `what` is null when there are none. Where the
 * editing screen can save them (`save`, its own Save draft), that is the main answer; when the
 * save is refused the person stays, and the editor says why.
 */
const mayLeave = async (what: string | null, save?: (() => Promise<boolean>) | null) => {
  if (!what) return true;
  const question = {
    title: "Leave without saving?", body: `Your changes to ${what} have not been saved. If you leave now they are lost.`,
    confirmLabel: "Leave without saving", cancelLabel: "Stay", danger: true,
  };
  if (!save) return confirmDialog(question);
  const choice = await chooseDialog({
    ...question, title: "Save your changes before you leave?", preferredLabel: "Save draft and leave",
    body: `Your changes to ${what} are not saved yet. Save them as a draft, or leave and lose them.`,
  });
  if (choice === "preferred") return save().catch(() => false);
  return choice === "confirm";
};

/**
 * "Skip to the page", the first stop of the keyboard: past the top bar to the page's main
 * content. On the editing screen that is its own main region (what readers will see), inside
 * the page's region; elsewhere the page's region itself.
 */
function skipToPage() {
  const region = document.getElementById("main");
  const target = region?.querySelector<HTMLElement>("main") ?? region;
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

/** How long the content on screen may be old before coming back to the tab fetches it again. */
const REFRESH_AFTER_MS = 20_000;

function AccountPop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { focus: false });
  return <div ref={ref} id="account-pop" className="user-pop" role="group" aria-label="Your account">{children}</div>;
}

/** Why a save or delete was refused, in a sentence. */
function whyNot(e: unknown, noun: string): string {
  const c = (e as ApiError)?.conflict;
  if (c && !c.exists) return `Somebody else deleted this ${noun} in the meantime.`;
  if (c) return `${c.updatedBy ?? "Somebody else"} changed this ${noun} in the meantime. Look at the current version first.`;
  return e instanceof Error ? e.message : String(e);
}

/** Why something new could not be created. */
function whyNotCreated(e: unknown, noun: string): string {
  if ((e as ApiError)?.conflict) return `A ${noun} with this address was created by somebody else a moment ago. Choose another name.`;
  return e instanceof Error ? e.message : String(e);
}

/** What the person chose when creating something: what it belongs to and, for a standard, the team that issues it. */
interface NewChoice { belongs: BelongsTo; owner?: string }
/** Where a new process or standard starts when it is made from the page of a platform, practice or team. */
export interface NewPreset { platform?: string; practice?: string; owner?: string }

/**
 * A new process or standard starts with its name: the name gives it its address, which never
 * changes. Somebody who may only change what belongs to their platforms and practices also says
 * which of these it belongs to - otherwise it would not be theirs to save. A standard also needs
 * the team that issues it. `from` is something made with AI: its name is suggested.
 */
function NameDialog({ noun, from, preset, onCreate, onClose }: {
  noun: "process" | "standard"; from?: Process | Standard;
  /** Made from the page of a platform, practice or team: placed there already. */
  preset?: NewPreset;
  onCreate: (title: string, choice: NewChoice) => Promise<void>; onClose: () => void;
}) {
  const perms = usePerms();
  const { catalog } = useCatalog();
  const [title, setTitle] = useState(from?.title ?? "");
  const [busy, setBusy] = useState(false);
  // the platforms and practices this person owns, for somebody who may not change everything
  const yours = newDocPlaces(perms, noun).map((x) => ({
    value: `${x.kind}:${x.id}`, publishes: x.publishes,
    label: `${x.kind === "platform" ? "Platform" : "Practice"}: ${x.kind === "platform" ? platformName(catalog, x.id) : practiceName(catalog, x.id)}`,
  }));
  const presetPlace = preset?.platform ? `platform:${preset.platform}` : preset?.practice ? `practice:${preset.practice}` : "";
  const [belongs, setBelongs] = useState(yours.find((o) => o.value === presetPlace)?.value ?? yours[0]?.value ?? "");
  const chosen = yours.find((o) => o.value === belongs);
  const teams = catalog.teams;
  const [owner, setOwner] = useState(() => {
    const given = from && "requirements" in from ? from.owner : undefined;
    return teams.find((t) => t.id === (preset?.owner ?? given))?.id ?? teams.find((t) => perms.owns.includes(t.id))?.id ?? teams[0]?.id ?? "";
  });
  const ok = slugify(title).length >= 3 && (!yours.length || !!belongs) && (noun === "process" || !!owner);
  const create = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const [kind, id] = belongs.split(":");
    // an editor of the kind picks nothing: what the page it was made from names, if anything
    const placed: BelongsTo = preset?.platform ? { platform: preset.platform } : preset?.practice ? { practice: preset.practice } : {};
    const choice: NewChoice = {
      belongs: !yours.length ? placed : kind === "platform" ? { platform: id } : { practice: id },
      ...(noun === "standard" ? { owner } : preset?.owner ? { owner: preset.owner } : {}),
    };
    try { await onCreate(title.trim(), choice); } catch { setBusy(false); }
  };
  return (
    <Modal title={`New ${noun}`} subtitle={`It starts as a draft: until it is published, only ${draftAudience(noun)} see it. You can change everything later, except its link.`} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok || busy} onClick={create}>Create {noun}</button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <Field label={`Name of the ${noun}`} hint={slugify(title).length >= 3 ? `Address: …/${from?.id ?? slugify(title)}` : noun === "process" ? "For example: Request a database" : "For example: Secure logging"}>
          <input autoFocus value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {yours.length > 0 && (
          <Field label="It belongs to" hint={chosen && !chosen.publishes ? "An owner of the platform or practice publishes it." : "one of your platforms and practices"}>
            <select value={belongs} onChange={(e) => setBelongs(e.target.value)}>
              {yours.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {!yours.length && (preset?.platform || preset?.practice) && (
          <p className="muted small">It belongs to the {preset.platform ? `platform “${platformName(catalog, preset.platform)}”` : `practice “${practiceName(catalog, preset.practice)}”`}. You can change that later.</p>
        )}
        {noun === "process" && preset?.owner && <p className="muted small">Owned by {catalog.teams.find((t) => t.id === preset.owner)?.name ?? preset.owner}. You can change that later.</p>}
        {noun === "standard" && (
          <Field label="Issued by" hint="the team that reviews it and answers feedback">
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}

/**
 * The session ended (it expired, or it was ended from another device) while the page was open.
 * The page stays as it is, with any unsaved edits; signing in again in another tab brings the
 * session back for this one too.
 */
function SignedOutDialog({ me, onBack, onOther }: { me: Me; onBack: () => void; onOther: () => void }) {
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState("");
  const check = async () => {
    setChecking(true); setHint("");
    try {
      const now = await loadMe();
      if (!now.authenticated) setHint("You are not signed in yet. Use the button on the left first.");
      else if (now.user?.email !== me.user?.email) onOther(); // somebody else now: start afresh as them
      else onBack();
    } catch (e) { setHint(e instanceof Error ? e.message : String(e)); } finally { setChecking(false); }
  };
  return (
    <Modal title="You are signed out" subtitle="Nothing on this page is lost. Sign in again, then carry on where you were." closable={false} onClose={() => { /* stays until signed in */ }}
      footer={<>
        <a className="btn" href={me.provider === "dev" ? "/" : "/auth/login"} target="_blank" rel="noreferrer">Sign in again (opens a new tab)</a>
        <span className="spacer" />
        <button className="btn primary" disabled={checking} onClick={check}>I have signed in</button>
      </>}>
      <p>Your session has ended. This happens after some hours, or when you sign out on another device.</p>
      <p className="muted">Sign in in the new tab, come back here and press “I have signed in”. If you were saving something, press Save again afterwards.</p>
      {hint && <div className="check bad">{hint}</div>}
    </Modal>
  );
}

function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const route = useRoute(mayLeave);
  const perms = usePerms();
  const { look, name, dark } = useLook();
  const [processes, setProcesses] = useState<Process[] | null>(null);
  const [standards, setStandards] = useState<Standard[]>([]);
  // the version of every process and standard, and of the lists: a save says which one it started from
  const [processMeta, setProcessMeta] = useState<MetaById>({});
  const [standardMeta, setStandardMeta] = useState<MetaById>({});
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [naming, setNaming] = useState<null | "process" | "standard">(null);
  // made from the page of a platform, practice or team: where it starts
  const [preset, setPreset] = useState<NewPreset | undefined>(undefined);
  // something made with AI that is not yet the person's to save: they first say what it belongs to
  const [pending, setPending] = useState<Process | Standard | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<null | "process" | "standard">(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [feedback, setFeedback] = useState<FeedbackByTarget>({ process: {}, standard: {} });

  const loadedAt = useRef(0);
  const writes = useRef(0); // counts our own saves, creations and deletions
  const fetchAll = useCallback(async () => {
    const started = writes.current;
    const [p, s, c, f] = await Promise.all([loadProcesses(), loadStandards(), loadCatalog(), loadFeedback()]);
    // An answer that was on its way while we saved something describes the world before that
    // save: showing it would put old content back on screen. The next refresh is right again.
    if (writes.current !== started) return { p, s, c };
    loadedAt.current = Date.now();
    setCatalog(c.catalog); setCatalogVersion(c.version); setFeedback(f);
    // Something that somebody else deleted while this person has unsaved edits in it stays on
    // screen: their next save is refused and they decide whether to bring it back.
    const keep = <T extends { id: string }>(kind: string, now: T[], before: T[]) =>
      [...now, ...before.filter((x) => hasUnsaved(`${kind}/${x.id}`) && !now.some((y) => y.id === x.id))].sort((a, b) => a.id.localeCompare(b.id));
    setStandards((before) => keep("standard", s.docs, before)); setStandardMeta(s.meta);
    setProcesses((before) => keep("process", p.docs, before ?? [])); setProcessMeta(p.meta);
    return { p, s, c };
  }, []);
  const load = useCallback(() => {
    setError(null);
    fetchAll().catch((e) => setError(String(e.message ?? e)));
  }, [fetchAll]);
  useEffect(load, [load]);

  // Other people save too. Coming back to the tab fetches what they changed, so nobody edits
  // (or follows) something that is hours old. A page with unsaved edits keeps them and is told
  // that there is a newer version.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== "visible" || Date.now() - loadedAt.current < REFRESH_AFTER_MS) return;
      loadedAt.current = Date.now();
      fetchAll().catch(() => { /* the next action will say what is wrong */ });
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, [fetchAll]);

  // the session ended while the page was open: ask to sign in again, on top of whatever is being edited
  useEffect(() => {
    const on = () => setSignedOut(true);
    window.addEventListener(SIGNED_OUT, on);
    return () => window.removeEventListener(SIGNED_OUT, on);
  }, []);

  // the caller decides what a failed save means for it, so the error is passed on
  const saveCatalog = useCallback(async (c: Catalog, base?: number, note?: string) => {
    writes.current++;
    const meta = await putCatalog(c, base ?? catalogVersion, note);
    writes.current++;
    setCatalog(c); setCatalogVersion(meta.version);
    return meta.version;
  }, [catalogVersion]);
  const reloadCatalog = useCallback(async () => {
    const c = await loadCatalog();
    setCatalog(c.catalog); setCatalogVersion(c.version);
    return { saved: c.catalog, version: c.version };
  }, []);
  const catalogApi = useMemo(() => ({ catalog, version: catalogVersion, save: saveCatalog, reload: reloadCatalog }), [catalog, catalogVersion, saveCatalog, reloadCatalog]);

  // feedback is saved the moment it is given - it is not part of a draft
  const actions = useMemo<FeedbackActions>(() => {
    const change = (item: Feedback, fn: (list: Feedback[]) => Feedback[]) =>
      setFeedback((all) => ({ ...all, [item.targetKind]: { ...all[item.targetKind], [item.targetId]: fn(all[item.targetKind][item.targetId] ?? []) } }));
    const put = (item: Feedback) => change(item, (list) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]));
    // Each action counts as a write, before and after: a refresh that was on its way meanwhile
    // describes the feedback as it was, and would bring a fixed item back as open.
    const wrote = <T,>(p: Promise<T>): Promise<T> => { writes.current++; return p.finally(() => { writes.current++; }); };
    return {
      add: (spec) => wrote(createFeedback(spec)).then((item) => { put(item); return true; }, (e) => { notify.error("Your feedback could not be sent.", e); return false; }),
      alsoHit: (item, on) => { wrote(setAlsoHit(item.id, on)).then(put, (e) => notify.error("That could not be recorded.", e)); },
      resolve: function resolve(item, resolved) {
        wrote(setResolved(item.id, resolved)).then((saved) => {
          put(saved);
          // marking as fixed acts at once: Undo opens it again
          if (resolved) notify.info(`Marked as fixed. ${item.author.name || "The person who reported it"} is told.`, { label: "Undo", run: () => resolve(saved, false) });
          else notify.info("The feedback is open again.");
        }, (e) => notify.error("The feedback could not be changed.", e));
      },
      remove: (item) => { wrote(deleteFeedback(item.id)).then(() => { change(item, (list) => list.filter((x) => x.id !== item.id)); notify.info("The feedback was deleted."); }, (e) => notify.error("The feedback could not be deleted.", e)); },
    };
  }, []);

  // editing a step or requirement can make feedback on it "may already be fixed"
  const refreshFeedback = () => { loadFeedback().then(setFeedback).catch(() => {}); };
  const byId = <T extends { id: string }>(list: T[], doc: T) => [...list.filter((x) => x.id !== doc.id), doc].sort((a, b) => a.id.localeCompare(b.id));

  // a save answers with the new version; what it does not say (when the first version was saved,
  // when it was first published, unpublished changes) stays as it was, or follows from the save
  const setMeta = (set: typeof setProcessMeta, id: string, meta: Partial<DocMeta> & { version: number }, doc: Process | Standard) =>
    set((all) => ({ ...all, [id]: savedMeta(all[id], meta, doc) }));

  // unpublished changes were saved, published or discarded on the editing screen
  const setDraftMeta = (set: typeof setProcessMeta, id: string, draft: DocMeta["draft"] | null) =>
    set((all) => (all[id] ? { ...all, [id]: { ...all[id], draft: draft ?? undefined } } : all));

  // Saving: on top of the version the edits started from. The page that saves shows what went
  // wrong, including "somebody else saved first"; the new version is returned to it.
  const saveProcess = async (p: Process, base: number, note?: string) => {
    writes.current++; // before and after: a refresh that overlaps the save on either side is dropped
    const meta = await putProcess(p, base, note);
    writes.current++;
    setProcesses((list) => list && byId(list, p)); setMeta(setProcessMeta, p.id, meta, p); refreshFeedback();
    return meta.version;
  };
  const saveStandard = async (s: Standard, base: number, note?: string) => {
    writes.current++;
    const meta = await putStandard(s, base, note);
    writes.current++;
    setStandards((list) => byId(list, s)); setMeta(setStandardMeta, s.id, meta, s); refreshFeedback();
    return meta.version;
  };
  // "Still correct": the review is recorded by the server, with today's date and the person's
  // name, on top of the version they are looking at.
  const reviewed = async (kind: TargetKind, id: string, base: number): Promise<boolean> => {
    try {
      writes.current++;
      const r = await confirmReview<Process | Standard>(kind, id, base);
      writes.current++;
      const meta = { version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy };
      if (kind === "process") { setProcesses((list) => list && byId(list, r.document as Process)); setMeta(setProcessMeta, id, meta, r.document as Process); }
      else { setStandards((list) => byId(list, r.document as Standard)); setMeta(setStandardMeta, id, meta, r.document as Standard); }
      notify.info(r.document?.title ? `“${r.document.title}” is recorded as reviewed today.` : "Recorded as reviewed today.");
      return true;
    } catch (e) {
      notify.error("The review could not be recorded.", whyNot(e, kind));
      if ((e as ApiError).conflict) load(); // show what changed, so that it can be read before confirming
      return false;
    }
  };

  // what the server has now, for a page that wants to continue from somebody else's version
  const reloadProcess = async (id: string) => {
    const { p } = await fetchAll();
    const doc = p.docs.find((x) => x.id === id);
    return doc ? { saved: doc, version: p.meta[id]?.version ?? 0 } : null;
  };
  const reloadStandard = async (id: string) => {
    const { s } = await fetchAll();
    const doc = s.docs.find((x) => x.id === id);
    return doc ? { saved: doc, version: s.meta[id]?.version ?? 0 } : null;
  };

  // Something new always starts as a draft with an id of its own: it is never published by
  // accident and never lands on top of something that exists.
  const createProcess = async (p: Process) => {
    // somebody who may only change what belongs to their platforms and practices first says which
    if (!canDraft(perms, "process", p) || belongsRefused(perms, "process", undefined, p).length) { setPending(p); setAi(null); setNaming("process"); return; }
    const id = uniqueId(p.id, all.map((x) => x.id));
    const doc = tidy({ ...p, id, status: "draft", $schema: "../schema/process.schema.json", updatedAt: today() });
    try { await saveProcess(doc, 0, "Created"); } catch (e) { notify.error("The process could not be created.", whyNotCreated(e, "process")); if ((e as ApiError).conflict) load(); throw e; }
    setAi(null); setNaming(null); setPending(null); setPreset(undefined);
    go({ page: "edit-process", id });
  };
  const createStandard = async (s: Standard) => {
    if (!canDraft(perms, "standard", s) || belongsRefused(perms, "standard", undefined, s).length) { setPending(s); setAi(null); setNaming("standard"); return; }
    const id = uniqueId(s.id, standards.map((x) => x.id));
    const doc = tidyStandard({ ...s, id, status: "draft", $schema: "../schema/standard.schema.json", updatedAt: today() });
    try { await saveStandard(doc, 0, "Created"); } catch (e) { notify.error("The standard could not be created.", whyNotCreated(e, "standard")); if ((e as ApiError).conflict) load(); throw e; }
    setAi(null); setNaming(null); setPending(null); setPreset(undefined);
    go({ page: "edit-standard", id });
  };
  // Deleting: the version the person is looking at. If somebody changed it since, it is not
  // deleted - nobody removes a version they have not seen.
  const deleteProcess = async (id: string, base: number) => {
    try {
      writes.current++;
      await removeProcess(id, base);
      writes.current++;
      forgetUnsaved(`process/${id}`); // its unsaved edits went with it: nothing to ask about
      setProcesses((list) => list && list.filter((x) => x.id !== id)); go({ page: "library" });
    } catch (e) { notify.error("The process could not be deleted.", whyNot(e, "process")); if ((e as ApiError).conflict) load(); }
  };
  const deleteStandard = async (id: string, base: number) => {
    try {
      writes.current++;
      await removeStandard(id, base);
      writes.current++;
      forgetUnsaved(`standard/${id}`);
      setStandards((list) => list.filter((x) => x.id !== id)); go({ page: "standards" });
    } catch (e) { notify.error("The standard could not be deleted.", whyNot(e, "standard")); if ((e as ApiError).conflict) load(); }
  };
  // a new standard is issued by a team: there has to be one
  const newStandard = () => {
    if (!catalog.teams.length) {
      notify.error("A standard needs a team that issues it.", "The list of teams is empty. Ask someone who manages the lists to add one (Admin, Lists).");
      return;
    }
    setNaming("standard");
  };
  // what the name dialog creates: something blank, or what was made with AI, with what the person chose
  const createNamed = (noun: "process" | "standard", title: string, choice: NewChoice) => {
    // somebody who sets only their own platform or practice: what AI suggested is replaced by what they chose
    const own = editsAll(perms, noun) ? {} : { platform: undefined, practice: undefined };
    if (noun === "process") {
      const from = pending && !("requirements" in pending) ? pending : null;
      const owner = choice.owner ? { owner: choice.owner } : {};
      return createProcess(from ? { ...from, title, ...own, ...choice.belongs, ...owner } : { ...blankProcess(all.map((p) => p.id), title, choice.belongs), ...owner });
    }
    const from = pending && "requirements" in pending ? pending : null;
    const owner = choice.owner ?? from?.owner ?? "";
    return createStandard(from ? { ...from, title, owner, ...own, ...choice.belongs } : blankStandard(standards.map((s) => s.id), owner, title, choice.belongs));
  };

  const all = processes ?? [];
  // after publishing: what readers now see, and the versions, come from the server
  const refreshAll = async () => { await fetchAll(); };
  // what needs the signed-in person as an owner: shown as a count next to "My responsibilities"
  // (reviews overdue, feedback, and what others saved that waits for the person to publish)
  const minePl = useMemo(() => minePlace(perms, all, standards, feedback, { process: processMeta, standard: standardMeta }, me.user?.email),
    [perms, all, standards, feedback, processMeta, standardMeta, me.user?.email]);
  const mine = minePl.shown ? [true] : [], waiting = minePl.count;
  const process = route.page === "process" || route.page === "edit-process" ? all.find((p) => p.id === route.id) : undefined;
  const standard = route.page === "standard" || route.page === "edit-standard" ? standards.find((s) => s.id === route.id) : undefined;
  // the editing screen is a screen of its own: its editing bar takes the place of the top bar
  // (somebody who may not change it gets the ordinary page, with the top bar, saying so)
  const editing = (route.page === "edit-process" && !!process && canDraft(perms, "process", process))
    || (route.page === "edit-standard" && !!standard && canDraft(perms, "standard", standard));
  const on = (...pages: string[]) => (pages.includes(route.page) ? "on" : "");
  const current = (...pages: string[]) => (pages.includes(route.page) ? "page" as const : undefined);

  // the main places, in the top bar and, on small screens, in the menu
  const places: Place[] = [
    { key: "home", pages: ["home", "search"], href: href({ page: "home" }), label: "Home", title: "Home: search processes and standards", icon: Search },
    { key: "library", pages: ["library", "process"], href: href({ page: "library" }), label: "Processes", title: "Processes", icon: LayoutGrid },
    { key: "standards", pages: ["standards", "standard"], href: href({ page: "standards" }), label: "Standards", title: "Standards", icon: ShieldCheck },
    { key: "requests", pages: ["requests"], href: href({ page: "requests" }), label: "Requests", title: "Requests: ask for a process or standard that is missing, vote for what others asked for", icon: Lightbulb },
    ...(mine.length > 0 ? [{ key: "mine", pages: ["mine"], href: href({ page: "mine" }), label: "My responsibilities", title: minePl.title, icon: ClipboardCheck, count: waiting,
      name: waiting ? `My responsibilities, ${waiting} waiting` : "My responsibilities" }] : []),
    { key: "catalog", pages: ["catalog", "group"], href: href({ page: "catalog" }), label: "Teams & tools", title: "Teams & tools", icon: Users },
    { key: "guide", pages: ["guide"], href: href({ page: "guide" }), label: "Guide", title: "Guide", icon: BookOpen },
    ...(canOpenAdmin(perms) ? [{ key: "admin", pages: ["admin"], href: href({ page: "admin", section: perms.admin ? "access" : "lists" }), label: "Admin", title: "Admin", icon: Settings2 }] : []),
  ];

  const group = route.page === "group" ? groupEntry(catalog, route.kind, route.id) : undefined;
  const title = pageTitle(route, { process: process?.title, standard: standard?.title, group: group?.name, loading: !processes }, name);
  useEffect(() => { document.title = title; }, [title]);

  // the page itself is the main region; the editing screen has a main region of its own inside
  const Main = editing ? "div" : "main";
  return (
    <CatalogContext.Provider value={catalogApi}>
    <FeedbackContext.Provider value={actions}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); skipToPage(); }}>Skip to the page</a>
      {!editing && <header className="topbar">
        <a className="brand" href="#/" aria-label={name} title={name}>
          <BrandLogo look={look} />
          <span className="brand-name">{name}</span>
        </a>
        <nav className="nav" aria-label="Main">
          {places.map((p) => <PlaceLink key={p.key} place={p} on={on(...p.pages)} current={current(...p.pages)} />)}
        </nav>
        <MenuButton places={places} on={on} current={current} />
        <span className="spacer" />
        <button className="icon-btn" onClick={() => chooseDark(!dark)} aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <UserMenu me={me} onSignedOut={onSignedOut} />
      </header>}

      <Main id="main" className="main-region" tabIndex={-1}>
      {error && <div className="page"><LoadError what="The content could not be loaded." error={error} onRetry={load} /></div>}
      {!processes && !error && <Loading page />}
      <ErrorBoundary resetKey={href(route)}>
      <Suspense fallback={<Loading page />}>
      {processes && route.page === "home" && <HomePage processes={all} standards={standards} feedback={feedback} meta={{ process: processMeta, standard: standardMeta }} />}
      {processes && route.page === "search" && <SearchPage route={route} processes={all} standards={standards} feedback={feedback} meta={{ process: processMeta, standard: standardMeta }} />}
      {processes && route.page === "library" && (
        <Library processes={all} standardIds={standards.map((s) => s.id)} feedback={feedback.process} meta={processMeta} onAi={() => setAi("process")}
          onNew={() => setNaming("process")} />
      )}
      {processes && route.page === "standards" && (
        <StandardsLibrary standards={standards} processes={all} feedback={feedback.standard} meta={standardMeta} onAi={() => setAi("standard")} onNew={newStandard} />
      )}
      {processes && route.page === "catalog" && <CatalogPage processes={all} standards={standards} editable={false} list={route.list} id={route.id} />}
      {processes && route.page === "group" && (group
        ? <GroupPage key={`${route.kind}/${route.id}`} kind={route.kind} id={route.id} processes={all} standards={standards} feedback={feedback} meta={{ process: processMeta, standard: standardMeta }}
          onNew={(noun, place) => { setPending(null); setPreset(place); if (noun === "standard") newStandard(); else setNaming("process"); }} />
        : <NotFound key={`g/${route.kind}/${route.id}`} noun={route.kind} recheck={refreshAll} />)}
      {processes && route.page === "requests" && <RequestsPage state={route.state} kind={route.kind} processes={all} standards={standards} />}
      {processes && route.page === "mine" && (
        <MinePage processes={all} standards={standards} feedback={feedback} meta={{ process: processMeta, standard: standardMeta }}
          onReviewed={(kind, id) => reviewed(kind, id, (kind === "process" ? processMeta : standardMeta)[id]?.version ?? 0)} />
      )}
      {processes && route.page === "guide" && <GuidePage />}
      {processes && route.page === "admin" && (canOpenAdmin(perms)
        ? <AdminPage section={route.section} processes={all} standards={standards} feedback={feedback} meta={{ process: processMeta, standard: standardMeta }} />
        : <div className="page not-found"><h1>Admin</h1><p className="muted">You do not have access to the Admin panel. An admin can give it to you.</p></div>)}
      {processes && route.page === "process" && (process
        ? <ProcessPage key={process.id} process={process} meta={processMeta[process.id]} all={all} standards={standards} tab={route.tab} item={route.item}
          onReviewed={(base) => reviewed("process", process.id, base)} feedback={feedback.process[process.id] ?? []} />
        : <NotFound key={`p/${route.id}`} noun="process" recheck={refreshAll} />)}
      {processes && route.page === "standard" && (standard
        ? <StandardPage key={standard.id} standard={standard} meta={standardMeta[standard.id]} all={standards} processes={all} tab={route.tab} item={route.item}
          onReviewed={(base) => reviewed("standard", standard.id, base)} feedback={feedback.standard[standard.id] ?? []} />
        : <NotFound key={`s/${route.id}`} noun="standard" recheck={refreshAll} />)}
      {processes && route.page === "edit-process" && (process
        ? <EditProcessPage key={process.id} process={process} meta={processMeta[process.id]} all={all} standards={standards} item={route.item}
          feedback={feedback.process[process.id] ?? []} onSave={saveProcess} onReload={() => reloadProcess(process.id)} onRefresh={refreshAll}
          onDelete={(base) => deleteProcess(process.id, base)} onDraftMeta={(d) => setDraftMeta(setProcessMeta, process.id, d)} />
        : <NotFound key={`p/${route.id}`} noun="process" recheck={refreshAll} />)}
      {processes && route.page === "edit-standard" && (standard
        ? <EditStandardPage key={standard.id} standard={standard} meta={standardMeta[standard.id]} all={standards} processes={all} item={route.item}
          feedback={feedback.standard[standard.id] ?? []} onSave={saveStandard} onReload={() => reloadStandard(standard.id)} onRefresh={refreshAll}
          onDelete={(base) => deleteStandard(standard.id, base)} onDraftMeta={(d) => setDraftMeta(setStandardMeta, standard.id, d)} />
        : <NotFound key={`s/${route.id}`} noun="standard" recheck={refreshAll} />)}
      </Suspense>
      </ErrorBoundary>
      </Main>
      <Suspense fallback={null}>
        {ai === "process" && <AiDialog spec={processAiSpec(undefined, all, standards, catalog)} onClose={() => setAi(null)} onImport={(p) => { createProcess(p).catch(() => {}); }} />}
        {ai === "standard" && <AiDialog spec={standardAiSpec(undefined, standards, all, catalog)} onClose={() => setAi(null)} onImport={(s) => { createStandard(s).catch(() => {}); }} />}
      </Suspense>
      {naming && <NameDialog noun={naming} from={pending ?? undefined} preset={preset} onClose={() => { setNaming(null); setPending(null); setPreset(undefined); }}
        onCreate={(title, choice) => createNamed(naming, title, choice)} />}
      {signedOut && <SignedOutDialog me={me} onBack={() => setSignedOut(false)} onOther={onSignedOut} />}
    </FeedbackContext.Provider>
    </CatalogContext.Provider>
  );
}
