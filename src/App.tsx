import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Eye, LayoutGrid, LogOut, Moon, Pencil, Settings2, ShieldCheck, Sun, Users } from "lucide-react";
import type { Catalog, Feedback, FeedbackByTarget, Me, Process, Standard } from "./types";
import {
  createFeedback, deleteFeedback, go, href, loadCatalog, loadFeedback, loadMe, loadProcesses, loadStandards, logout, pageTitle, putCatalog, putProcess, putStandard,
  removeProcess, removeStandard, setAlsoHit, setResolved, useRoute,
} from "./lib/store";
import { CatalogContext, EMPTY_CATALOG } from "./lib/catalog";
import { canEditSomething, canOpenAdmin, canEditStandard, FeedbackContext, MeContext, roleLabel, usePerms, type FeedbackActions } from "./lib/session";
import { ModeContext, type Mode } from "./lib/mode";
import { blankProcess, blankStandard, tidy, tidyStandard, today } from "./lib/edit";
import { CatalogPage } from "./components/CatalogPage";
import { Library } from "./components/Library";
import { Login } from "./components/Login";
import { ProcessPage, processAiSpec } from "./components/ProcessPage";
import { StandardPage, standardAiSpec } from "./components/StandardPage";
import { StandardsLibrary } from "./components/StandardsLibrary";
import { unitsOf } from "./components/Governance";
import { ErrorBoundary, LoadError, Loading, Notices, notify, useLayer } from "./components/ui";

// loaded when first opened: most visits never need them
const AdminPage = lazy(() => import("./components/AdminPage").then((m) => ({ default: m.AdminPage })));
const GuidePage = lazy(() => import("./components/GuidePage").then((m) => ({ default: m.GuidePage })));
const AiDialog = lazy(() => import("./components/AiDialog").then((m) => ({ default: m.AiDialog }))) as typeof import("./components/AiDialog").AiDialog;

function useTheme() {
  const [dark, setDark] = useState(() => {
    try { const s = localStorage.getItem("pm:theme"); if (s) return s === "dark"; } catch { /* ignore */ }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("pm:theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

/** Signed out: the sign-in screen. Signed in: the app. */
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTheme();
  const refresh = useCallback(() => { setError(null); loadMe().then(setMe).catch((e) => setError(e.message)); }, []);
  useEffect(refresh, [refresh]);
  useEffect(() => { if (!me?.authenticated) document.title = "Process Manager"; }, [me]);

  let body;
  if (error) body = <main className="login"><div className="login-card"><h1>Process Manager</h1><LoadError what="The portal could not be opened." error={error} onRetry={refresh} /></div></main>;
  else if (!me) body = null;
  else if (!me.authenticated) body = <Login me={me} onSignedIn={refresh} />;
  else body = <MeContext.Provider value={me}><Shell key={me.user!.email} me={me} onSignedOut={refresh} /></MeContext.Provider>;
  return <>{body}<Notices /></>;
}

function UserMenu({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const perms = usePerms();
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
          <span className="user-role">{roleLabel(perms)}</span>
          <button className="btn small" onClick={async () => { await logout().catch(() => {}); onSignedOut(); }}>
            <LogOut size={14} />{me.provider === "dev" ? "Switch user" : "Sign out"}
          </button>
        </AccountPop>
      )}
    </div>
  );
}

function AccountPop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { focus: false });
  return <div ref={ref} id="account-pop" className="user-pop" role="group" aria-label="Your account">{children}</div>;
}

function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const route = useRoute();
  const perms = usePerms();
  const [dark, setDark] = useTheme();
  const [processes, setProcesses] = useState<Process[] | null>(null);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<null | "process" | "standard">(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [feedback, setFeedback] = useState<FeedbackByTarget>({ process: {}, standard: {} });
  const [wanted, setWanted] = useState<Mode>(() => {
    try { return localStorage.getItem("pm:mode") === "editor" ? "editor" : "consumer"; } catch { return "consumer"; }
  });
  // the Editor view exists only for people who can edit something
  const mode: Mode = canEditSomething(perms) ? wanted : "consumer";
  const switchMode = (m: Mode) => { setWanted(m); try { localStorage.setItem("pm:mode", m); } catch { /* ignore */ } };

  const load = useCallback(() => {
    setError(null);
    Promise.all([loadProcesses(), loadStandards(), loadCatalog(), loadFeedback()])
      .then(([p, s, c, f]) => { setCatalog(c); setFeedback(f); setStandards(s); setProcesses(p); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(load, [load]);

  // the caller decides what a failed save means for it, so the error is passed on
  const saveCatalog = useCallback(async (c: Catalog) => {
    try { await putCatalog(c); setCatalog(c); } catch (e) { notify.error("The lists could not be saved.", e); throw e; }
  }, []);
  const catalogApi = useMemo(() => ({ catalog, save: saveCatalog }), [catalog, saveCatalog]);

  // feedback is saved the moment it is given - it is not part of a draft
  const actions = useMemo<FeedbackActions>(() => {
    const change = (item: Feedback, fn: (list: Feedback[]) => Feedback[]) =>
      setFeedback((all) => ({ ...all, [item.targetKind]: { ...all[item.targetKind], [item.targetId]: fn(all[item.targetKind][item.targetId] ?? []) } }));
    const put = (item: Feedback) => change(item, (list) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]));
    return {
      add: (spec) => createFeedback(spec).then((item) => { put(item); return true; }, (e) => { notify.error("Your feedback could not be sent.", e); return false; }),
      alsoHit: (item, on) => { setAlsoHit(item.id, on).then(put, (e) => notify.error("That could not be recorded.", e)); },
      resolve: (item, resolved) => { setResolved(item.id, resolved).then(put, (e) => notify.error("The feedback could not be changed.", e)); },
      remove: (item) => { deleteFeedback(item.id).then(() => change(item, (list) => list.filter((x) => x.id !== item.id)), (e) => notify.error("The feedback could not be deleted.", e)); },
    };
  }, []);

  // editing a step or requirement can make feedback on it "may already be fixed"
  const refreshFeedback = () => { loadFeedback().then(setFeedback).catch(() => {}); };
  const byId = <T extends { id: string }>(list: T[], doc: T) => [...list.filter((x) => x.id !== doc.id), doc].sort((a, b) => a.id.localeCompare(b.id));

  const saveProcess = async (p: Process) => {
    try { await putProcess(p); setProcesses((list) => list && byId(list, p)); refreshFeedback(); } catch (e) { notify.error("The process could not be saved.", e); throw e; }
  };
  const createProcess = async (p: Process) => {
    await saveProcess(tidy({ ...p, $schema: "../schema/process.schema.json", updatedAt: today() }));
    setAi(null);
    go({ page: "process", id: p.id, tab: "flow" });
  };
  const deleteProcess = async (id: string) => {
    try { await removeProcess(id); setProcesses((list) => list && list.filter((x) => x.id !== id)); go({ page: "library" }); } catch (e) { notify.error("The process could not be deleted.", e); }
  };
  const saveStandard = async (s: Standard) => {
    try { await putStandard(s); setStandards((list) => byId(list, s)); refreshFeedback(); } catch (e) { notify.error("The standard could not be saved.", e); throw e; }
  };
  const createStandard = async (s: Standard) => {
    await saveStandard(tidyStandard({ ...s, $schema: "../schema/standard.schema.json", updatedAt: today() }));
    setAi(null);
    go({ page: "standard", id: s.id, tab: "doc" });
  };
  const deleteStandard = async (id: string) => {
    try { await removeStandard(id); setStandards((list) => list.filter((x) => x.id !== id)); go({ page: "standards" }); } catch (e) { notify.error("The standard could not be deleted.", e); }
  };
  // a new standard belongs to a unit the person may edit for
  const myUnit = unitsOf(catalog).find((u) => canEditStandard(perms, u.id))?.id ?? "";
  const newStandard = () => {
    if (!myUnit) {
      notify.error("A standard needs a unit that issues it.", unitsOf(catalog).length
        ? "You may not edit for any of the units in the list. Ask an admin for the Standards editor role for your unit."
        : "The list of teams and units has no unit yet. Ask someone who manages the lists to add one (Admin, Lists) with the kind Cyber security, Platform owner or Practice.");
      return;
    }
    createStandard(blankStandard(standards.map((s) => s.id), myUnit)).catch(() => {});
  };

  const all = processes ?? [];
  const process = route.page === "process" ? all.find((p) => p.id === route.id) : undefined;
  const standard = route.page === "standard" ? standards.find((s) => s.id === route.id) : undefined;
  const on = (...pages: string[]) => (pages.includes(route.page) ? "on" : "");
  const current = (...pages: string[]) => (pages.includes(route.page) ? "page" as const : undefined);

  const title = pageTitle(route, { process: process?.title, standard: standard?.title, loading: !processes });
  useEffect(() => { document.title = title; }, [title]);

  return (
    <ModeContext.Provider value={mode}>
    <CatalogContext.Provider value={catalogApi}>
    <FeedbackContext.Provider value={actions}>
      <header className="topbar">
        <a className="brand" href="#/" aria-label="Process Manager">
          <span className="logo"><svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true"><path d="M5 9h9v5H5zM18 18h9v5h-9z" fill="currentColor" /><path d="M14 11.5h6.5V18" stroke="currentColor" strokeWidth="2.2" fill="none" /></svg></span>
          <span className="brand-name">Process Manager</span>
        </a>
        <nav className="nav" aria-label="Main">
          <a className={`nav-link ${on("library", "process")}`} aria-current={current("library", "process")} href={href({ page: "library" })} aria-label="Processes" title="Processes"><LayoutGrid size={15} /><span>Processes</span></a>
          <a className={`nav-link ${on("standards", "standard")}`} aria-current={current("standards", "standard")} href={href({ page: "standards" })} aria-label="Standards" title="Standards"><ShieldCheck size={15} /><span>Standards</span></a>
          <a className={`nav-link ${on("catalog")}`} aria-current={current("catalog")} href={href({ page: "catalog" })} aria-label="Teams & tools" title="Teams & tools"><Users size={15} /><span>Teams &amp; tools</span></a>
          <a className={`nav-link ${on("guide")}`} aria-current={current("guide")} href={href({ page: "guide" })} aria-label="Guide" title="Guide"><BookOpen size={15} /><span>Guide</span></a>
          {canOpenAdmin(perms) && <a className={`nav-link ${on("admin")}`} aria-current={current("admin")} href={href({ page: "admin", section: perms.admin ? "access" : "lists" })} aria-label="Admin" title="Admin"><Settings2 size={15} /><span>Admin</span></a>}
        </nav>
        <span className="spacer" />
        {canEditSomething(perms) && (
          <div className="mode-switch" role="group" aria-label="Mode">
            <button className={mode === "consumer" ? "on" : ""} aria-pressed={mode === "consumer"} aria-label="Consumer" onClick={() => switchMode("consumer")} title="Consumer: read, follow and give feedback"><Eye size={14} /><span>Consumer</span></button>
            <button className={mode === "editor" ? "on editor" : ""} aria-pressed={mode === "editor"} aria-label="Editor" onClick={() => switchMode("editor")} title="Editor: change what you have the right to change"><Pencil size={14} /><span>Editor</span></button>
          </div>
        )}
        <button className="icon-btn" onClick={() => setDark(!dark)} aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <UserMenu me={me} onSignedOut={onSignedOut} />
      </header>

      {error && <div className="page"><LoadError what="The content could not be loaded." error={error} onRetry={load} /></div>}
      {!processes && !error && <Loading page />}
      <ErrorBoundary resetKey={href(route)}>
      <Suspense fallback={<Loading page />}>
      {processes && route.page === "library" && (
        <Library processes={all} standardIds={standards.map((s) => s.id)} feedback={feedback.process} onAi={() => setAi("process")}
          onNew={() => { createProcess(blankProcess(all.map((p) => p.id))).catch(() => {}); }} />
      )}
      {processes && route.page === "standards" && (
        <StandardsLibrary standards={standards} processes={all} feedback={feedback.standard} onAi={() => setAi("standard")} onNew={newStandard} />
      )}
      {processes && route.page === "catalog" && <CatalogPage processes={all} standards={standards} editable={false} />}
      {processes && route.page === "guide" && <GuidePage />}
      {processes && route.page === "admin" && (canOpenAdmin(perms)
        ? <AdminPage section={route.section} processes={all} standards={standards} feedback={feedback} />
        : <div className="page"><h1>Admin</h1><p className="muted">You do not have access to the Admin panel. An admin can give it to you.</p></div>)}
      {processes && route.page === "process" && (process
        ? <ProcessPage key={process.id} process={process} all={all} standards={standards} tab={route.tab} onSave={saveProcess} onDelete={() => deleteProcess(process.id)}
          feedback={feedback.process[process.id] ?? []} />
        : <div className="page"><h1>Process not found</h1><p className="muted">There is no process “{route.id}”.</p><a className="btn" href="#/">Back to all processes</a></div>)}
      {processes && route.page === "standard" && (standard
        ? <StandardPage key={standard.id} standard={standard} all={standards} processes={all} tab={route.tab} onSave={saveStandard} onDelete={() => deleteStandard(standard.id)}
          feedback={feedback.standard[standard.id] ?? []} />
        : <div className="page"><h1>Standard not found</h1><p className="muted">There is no standard “{route.id}”.</p><a className="btn" href="#/standards">Back to all standards</a></div>)}
      </Suspense>
      </ErrorBoundary>
      <Suspense fallback={null}>
        {ai === "process" && <AiDialog spec={processAiSpec(undefined, all, standards, catalog)} onClose={() => setAi(null)} onImport={(p) => { createProcess(p).catch(() => {}); }} />}
        {ai === "standard" && <AiDialog spec={standardAiSpec(undefined, standards, all, catalog)} onClose={() => setAi(null)} onImport={(s) => { createStandard(s).catch(() => {}); }} />}
      </Suspense>
    </FeedbackContext.Provider>
    </CatalogContext.Provider>
    </ModeContext.Provider>
  );
}
