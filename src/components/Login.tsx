import { useState } from "react";
import { CircleAlert, LogIn } from "lucide-react";
import type { Me } from "../types";
import { devLogin } from "../lib/store";

const LABEL = { entra: "Sign in with Microsoft", google: "Sign in with Google", dev: "" };

/** Shown instead of the app until the visitor is signed in. */
export function Login({ me, onSignedIn }: { me: Me; onSignedIn: () => void }) {
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get("signin_error"));
  const pick = async (email: string) => {
    try { await devLogin(email); onSignedIn(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <main className="login">
      <div className="login-card">
        <span className="logo big"><svg viewBox="0 0 32 32" width="26" height="26"><path d="M5 9h9v5H5zM18 18h9v5h-9z" fill="currentColor" /><path d="M14 11.5h6.5V18" stroke="currentColor" strokeWidth="2.2" fill="none" /></svg></span>
        <h1>Process Manager</h1>
        <p className="lead">How to get things done on the platform, step by step.</p>
        {error && <div className="check bad"><CircleAlert size={16} /><span>Sign-in did not work: {error}</span></div>}

        {me.provider === "dev" ? (
          <>
            <p className="login-dev"><b>Local development.</b> Pick who to be. Each one has different rights.</p>
            <ul className="login-users">
              {(me.devUsers ?? []).map((u) => (
                <li key={u.email}>
                  <button onClick={() => pick(u.email)}>
                    <span className="avatar">{u.name.slice(0, 1)}</span>
                    <span><strong>{u.name}</strong><em>{u.about}</em></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <a className="btn primary login-btn" href="/auth/login"><LogIn size={16} />{LABEL[me.provider]}</a>
        )}
      </div>
    </main>
  );
}
