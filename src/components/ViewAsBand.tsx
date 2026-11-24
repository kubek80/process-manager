import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import type { Me } from "../types";
import { changeBlocked, mayViewAs, opensChange, readerOf } from "../lib/rights";
import { personLabel } from "../lib/members";
import { useMe } from "../lib/session";
import { loadMe, loadPeople, startViewAs, stopViewAs } from "../lib/store";
import {
  msUntilEnd, NO_ROLES_READER, NO_ROLES_READER_NAME, personChanged, personOption, returnPlace, VIEW_AS_BUTTON, viewAsHint, viewAsName, viewAsProblem, viewingEnds, type KnownPerson,
} from "../lib/users";
import { notify } from "./ui";
import "../viewas.css";

/** Where the place viewing started from is kept: this tab only, a convenience, never a right. */
const RETURN_KEY = "pm:viewAsReturn";
/** Said when a link to the editing screen is pressed (or its address typed) while viewing, with the reason under it. */
export const EDIT_CLOSED = "The editing screen does not open while you view the portal as somebody else.";

const remember = (hash: string) => { try { sessionStorage.setItem(RETURN_KEY, hash); } catch { /* storage off: back to Admin › Access */ } };
const recall = () => { try { const v = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); return v; } catch { return null; } };

/** Opens `hash` with everything loaded afresh: nothing the admin's own view had loaded stays on the page of the other person, or back. */
function reopenAt(hash: string) {
  if (window.location.hash !== hash) window.location.hash = hash;
  window.location.reload();
}


/**
 * The band shown while an admin views the portal as somebody else: on every page, the editing
 * screen and dialogs included, fixed to the bottom of the window so that it cannot be scrolled
 * away (`src/viewas.css`), never printed. It names whose view it is, says that nothing can be
 * changed and when it ends by itself, and has "Stop viewing". The server refuses every change;
 * the band keeps the editing screen closed, since work typed there could not be saved.
 */
export function ViewAsBand({ me }: { me: Me }) {
  const label = personLabel({ email: me.user?.email ?? "", name: me.user?.name });
  const blocked = changeBlocked(me);
  const ends = viewingEnds(me.viewedBy?.until);
  const [busy, setBusy] = useState(false);
  const band = useRef<HTMLDivElement>(null);

  // the page knows it, for the styles (room for the band, the editing screen's height)
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("viewing-as");
    const set = () => root.style.setProperty("--viewas-h", `${Math.ceil(band.current?.getBoundingClientRect().height ?? 0)}px`);
    set();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(set);
    if (band.current) watch?.observe(band.current);
    return () => { watch?.disconnect(); root.classList.remove("viewing-as"); root.style.removeProperty("--viewas-h"); };
  }, []);

  // the editing screen stays closed: its links say why instead, and an address typed in goes to the reader's page
  useLayoutEffect(() => {
    const away = () => {
      if (!opensChange(window.location.hash)) return;
      window.location.replace(readerOf(window.location.hash));
      notify.error(EDIT_CLOSED, blocked);
    };
    const click = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!link || !opensChange(link.getAttribute("href") ?? "")) return;
      e.preventDefault();
      e.stopPropagation();
      notify.error(EDIT_CLOSED, blocked);
    };
    away();
    window.addEventListener("hashchange", away);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("hashchange", away); document.removeEventListener("click", click, true); };
  }, [blocked]);

  // when it ends by itself, the page opens afresh as the admin (the server has ended it by then)
  useEffect(() => {
    const ms = msUntilEnd(me.viewedBy?.until);
    if (ms === null) return;
    const t = window.setTimeout(() => window.location.reload(), Math.min(ms, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [me.viewedBy?.until]);

  const stop = () => {
    setBusy(true);
    stopViewAs().then(() => reopenAt(returnPlace(recall())), (e) => { setBusy(false); notify.error("Viewing could not be stopped.", e); });
  };

  return (
    <div ref={band} className="viewas-band" role="region" aria-label="Viewing the portal as somebody else">
      <Eye size={18} aria-hidden="true" className="viewas-icon" />
      <p className="viewas-text">
        <span>Viewing the portal as <strong className="viewas-who" title={me.user?.email}>{label}</strong></span>
        <span className="viewas-rule">Nothing can be changed</span>
        {ends && <span className="viewas-ends">Ends by itself at {ends}</span>}
      </p>
      <button className="btn small viewas-stop" disabled={busy} onClick={stop}><X size={15} aria-hidden="true" />Stop viewing</button>
    </div>
  );
}

/**
 * "View as" for one person, where an admin finds people (Admin › Access, the owners and members
 * of a group). Shown only to whom `mayViewAs` allows; the portal then opens afresh as that
 * person, on Home, and "Stop viewing" returns to where it started.
 */
/** Starts viewing as `email` and opens the portal afresh as that person, on Home; `done` runs when it was refused. */
function beginViewing(email: string, label: string, done: () => void) {
  const from = window.location.hash || "#/";
  startViewAs(email).then(() => { remember(from); reopenAt("#/"); }, (e) => { done(); notify.error(`You cannot view the portal as ${label}.`, e); });
}

export function ViewAsButton({ email, name, className = "btn small" }: { email: string; name?: string; className?: string }) {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!mayViewAs(me, email)) return null;
  const label = personLabel({ email, name });
  const start = () => { setBusy(true); beginViewing(email, label, () => setBusy(false)); };
  return (
    <button className={`${className} viewas-start`} disabled={busy} onClick={start} aria-label={viewAsName(label)} title={viewAsHint(label)}>
      <Eye size={14} aria-hidden="true" />{VIEW_AS_BUTTON}
    </button>
  );
}

/**
 * Admin › Access: view the portal as anybody, not only the people with roles. The address field
 * suggests everybody the portal knows (`GET /api/admin/people`) and takes any address, which is
 * then a signed-in person without roles; "A reader with no roles" needs no address at all.
 */
export function ViewAsPicker() {
  const me = useMe();
  const [typed, setTyped] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<KnownPerson[]>([]);
  const allowed = mayViewAs(me, NO_ROLES_READER);
  useEffect(() => { if (allowed) loadPeople().then(setPeople, () => { /* typing an address still works */ }); }, [allowed]);
  if (!allowed) return null;
  const problem = viewAsProblem(typed, me.user?.email ?? "");
  const start = (email: string, label: string) => { setBusy(true); beginViewing(email, label, () => setBusy(false)); };
  const go = () => {
    setTried(true);
    if (problem || busy) return;
    const email = typed.trim().toLowerCase();
    start(email, personLabel({ email, name: people.find((p) => p.email === email)?.name }));
  };
  return (
    <section className="admin-card viewas-picker" aria-labelledby="viewas-picker-title">
      <h2 id="viewas-picker-title"><Eye size={17} aria-hidden="true" />See the portal as somebody else</h2>
      <p className="muted small">See exactly what a person sees: what they can read, their responsibilities, their bookmarks and requests, and which buttons they get. Choose anybody, also somebody without a role or an address the portal has not seen yet. You cannot change anything while you do, and it ends after an hour.</p>
      <form className="viewas-pick" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input type="email" list="viewas-people" value={typed} placeholder="Email address, e.g. name@company.com" aria-label="Email of the person whose view you want to see"
          aria-invalid={tried && !!problem} aria-describedby={tried && problem ? "viewas-pick-problem" : undefined}
          onChange={(e) => { setTyped(e.target.value); setTried(false); }} />
        <datalist id="viewas-people">
          {people.filter((p) => p.email !== me.user?.email.toLowerCase()).map((p) => <option key={p.email} value={p.email}>{personOption(p)}</option>)}
        </datalist>
        <button className="btn" disabled={busy}><Eye size={15} aria-hidden="true" />{VIEW_AS_BUTTON}</button>
        <button type="button" className="btn ghost viewas-reader" disabled={busy} onClick={() => start(NO_ROLES_READER, NO_ROLES_READER_NAME)}
          title="Somebody who can sign in but has no role at all: what every colleague sees.">View as {NO_ROLES_READER_NAME.toLowerCase()}</button>
      </form>
      {tried && problem && <p id="viewas-pick-problem" className="viewas-problem small" role="alert">{problem}</p>}
    </section>
  );
}

/**
 * For every signed-in page: when the window comes back into view, asks the server who this tab
 * is now; when viewing as somebody started or stopped in another tab (or another person signed
 * in), the page opens afresh, so it never shows one person while acting as another.
 */
export function ViewingWatch({ me }: { me: Me }) {
  useEffect(() => {
    let asking = false;
    const check = () => {
      if (asking || document.visibilityState === "hidden") return;
      asking = true;
      loadMe(false).then((now) => { if (personChanged(me, now)) window.location.reload(); }, () => { /* asked again next time */ }).finally(() => { asking = false; });
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [me]);
  return null;
}
