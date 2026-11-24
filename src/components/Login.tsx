import { useState } from "react";
import { Alert } from "./Alert";
import { LogIn } from "lucide-react";
import type { Me } from "../types";
import { devLogin } from "../lib/store";
import { useLook } from "../lib/theme";
import { BrandLogo } from "./Brand";

const LABEL = { entra: "Sign in with Microsoft", google: "Sign in with Google", dev: "" };

/** Shown instead of the app until the visitor is signed in. */
export function Login({ me, onSignedIn }: { me: Me; onSignedIn: () => void }) {
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get("signin_error"));
  const { look, name } = useLook();
  const pick = async (email: string) => {
    try { await devLogin(email); onSignedIn(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <main className="login">
      <div className="login-card">
        <BrandLogo look={look} big />
        <h1 className={name.length > 24 ? "long" : undefined}>{name}</h1>
        <p className="lead">How to get things done on the platform, step by step.</p>
        {error && <Alert tone="problem" title="Sign-in did not work">{error}</Alert>}

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
