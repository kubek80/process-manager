import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const signin: CodeCategory = {
  id: "signin",
  area: "server",
  title: "Signing in",
  summary:
    "Signs people in with Entra ID or Google (or a local picker of built-in users) and guards every request the server answers. " +
    "The server keeps no session table: it sets a signed, HTTP-only cookie for 12 hours and remembers only when each person last signed out (`signed_out`), which ends every copy of their cookie. " +
    "One guard (`guard` in `api.go`) wraps every request: the security headers, the content security policy, a time limit, the request log, the body limit and the `X-Requested-With` header on every change.",
  requirements: [
    "Every request that is not `GET`, `HEAD` or `OPTIONS` needs `X-Requested-With: process-manager`, or it is refused with 403 before any handler runs: a form on another site cannot set that header, so it cannot change anything for a signed-in person.",
    "Every answer carries the content security policy (`script-src 'self'`, no `eval`, `frame-ancestors 'none'`; an icon a stricter one of its own), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`; `Strict-Transport-Security` when `PM_BASE_URL` is https.",
    "The session cookie `pm_session` is HMAC-SHA256 signed with `PM_SESSION_SECRET`, HTTP-only, `SameSite=Lax`, `Secure` when the address is https, and expires after 12 hours; a changed, expired or foreign cookie is no session.",
    "Signing out ends every session of the person on every device (table `signed_out`); only a session that still counts can do it, and a sign-in right after a sign-out still works.",
    "When the database cannot say whether a session was ended, the answer is 503: neither signed in nor signed out.",
    "OpenID Connect uses state, nonce and PKCE (S256), kept in a signed cookie for 10 minutes and used once; the identity token is verified for this client.",
    "An email the provider marks as not verified is ignored; with Entra ID only the sign-in name (`preferred_username`, `upn`) counts. The address must end in one of `PM_ALLOWED_EMAIL_DOMAINS` when set, and Google sign-in needs `PM_GOOGLE_HOSTED_DOMAIN` or allowed domains.",
    "A failed sign-in puts only a plain sentence in the address bar (`?signin_error=`); the provider's answer goes to the log.",
    "`PM_AUTH=dev` lets anybody be any built-in user, so the server refuses to start with it on an address reachable from the network, unless `PM_DEV_AUTH_ON_NETWORK=i-understand`.",
    "With Entra ID or Google the server does not start without `PM_ADMINS`, a random `PM_SESSION_SECRET` of at least 32 characters and an https `PM_BASE_URL`.",
  ],
  charts: [
    {
      caption: "Signing in with Entra ID or Google (`auth.OIDC.Login`, `auth.OIDC.Callback`, `httpapi.callback`). The decision covers the state, the token (signature, audience, nonce), a verified address and the allowed domains.",
      process: flow("code-signin-oidc", "Signing in with OpenID Connect", "From the sign-in button to a session cookie.",
        [["browser", "Browser"], ["server", "Server"], ["idp", "Identity provider"], ["pg", "Postgres"]],
        [
          s("open", "Open /auth/login", "browser", "task", ["start"]),
          s("start", "Set signed state cookie, redirect", "server", "automation", ["login"], "state, nonce, PKCE"),
          s("login", "Sign the person in", "idp", "task", ["back"]),
          s("back", "Redirect to /auth/callback", "idp", "communication", ["valid"], "code and state"),
          s("valid", "Token and address acceptable?", "server", "decision", [["signedout", "Yes"], ["fail", "No"]]),
          s("fail", "Redirect with a plain reason", "server", "communication", [], "?signin_error="),
          s("signedout", "Read the last sign-out", "pg", "task", ["issue"], "signed_out"),
          s("issue", "Set a 12-hour session cookie", "server", "document", [], "dated after it"),
        ]),
    },
    {
      caption: "What happens to every request before a route sees it (`guard` in `api.go`). Only `/api/` and `/auth/` get the 30-second limit and the request log.",
      process: flow("code-signin-guard", "The guard of every request", "Headers, the header against forged requests, and the body limit.",
        [["browser", "Browser"], ["server", "Server"]],
        [
          s("send", "Send a request", "browser", "task", ["headers"]),
          s("headers", "Set the security headers", "server", "automation", ["change"], "CSP, nosniff, DENY"),
          s("change", "Does it change something?", "server", "decision", [["csrf", "POST, PUT, …"], ["route", "GET, HEAD, OPTIONS"]]),
          s("csrf", "X-Requested-With present?", "server", "verify", [["limit", "Yes"], ["r403", "No"]]),
          s("r403", "Answer 403", "server", "communication", []),
          s("limit", "Limit the body to 1 MB", "server", "automation", ["route"]),
          s("route", "Hand it to its route", "server", "automation", []),
        ]),
    },
    {
      caption: "How a route that needs a person finds out who it is (`requireUser`, `signedIn` in `api.go`). Rights are read fresh on every request.",
      process: flow("code-signin-session", "Who is asking?", "From the cookie to the person's rights.",
        [["server", "Server"], ["pg", "Postgres"]],
        [
          s("cookie", "Cookie signed and not expired?", "server", "verify", [["ended", "Yes"], ["r401", "No"]]),
          s("r401", "Answer 401 Please sign in", "server", "communication", []),
          s("ended", "Ended by a later sign-out?", "pg", "decision", [["roles", "No"], ["r401", "Yes"], ["r503", "Cannot tell"]]),
          s("r503", "Answer 503", "server", "communication", []),
          s("roles", "Read the person's roles", "pg", "task", ["handler"], "a reader on failure"),
          s("handler", "Run the handler", "server", "automation", [], "30 s limit"),
        ]),
    },
  ],
  tables: [
    {
      name: "signed_out",
      purpose: "When each person last signed out. A session issued before that moment no longer counts.",
      columns: [
        { name: "email", type: "text", note: "lower case" },
        { name: "at", type: "timestamptz", note: "a millisecond after the later of the server's and the database's clock" },
      ],
      keys: ["primary key (email)"],
      createdIn: "server/internal/db/migrations/003_version_notes_sessions.sql",
      writtenBy: ["server/internal/auth/signout.go"],
      readBy: ["server/internal/httpapi/api.go"],
      rules: [
        "The moment only moves forward (`greatest(signed_out.at, excluded.at)`).",
        "A new session is dated no earlier than this moment (`IssueNotBefore`), so signing in right after signing out works.",
      ],
    },
  ],
  examples: [
    {
      title: "A session cookie",
      caption: "What the browser holds after Sam signs in, and how the server reads it back.",
      stages: [
        {
          label: "The payload",
          where: "server/internal/auth/session.go",
          shape: `{"email": "sam@example.com", "name": "Sam Consumer", "exp": 1795377600, "iat": 1795334400000}`,
          note: "`exp` in seconds (12 hours on), `iat` in milliseconds: when it was issued, compared with `signed_out.at`.",
        },
        {
          label: "The cookie",
          shape: `Set-Cookie: pm_session=eyJlbWFpbCI6InNhbUBleGFtcGxlLmNvbSIs….<HMAC-SHA256, base64url>; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure`,
          note: "Not encrypted, only signed: the browser could read the name and email, but cannot change them. `Secure` only when `PM_BASE_URL` is https.",
        },
        {
          label: "On every request",
          where: "server/internal/httpapi/api.go",
          shape: `select at from signed_out where email = 'sam@example.com'
-- issued 2026-11-22 08:00:00.000 is not before at → the session counts
select email, role, scope, granted_by, granted_at from role_assignments where email = 'sam@example.com' …`,
          note: "No row in `signed_out`: the zero time, the session counts. The rights are read fresh each time.",
        },
      ],
    },
  ],
  start: "server/internal/auth/session.go",
  files: [
    {
      path: "server/internal/auth/session.go",
      role: "Signed, stateless session cookies: issue, read, clear.",
      requirements: [
        { text: "The payload is only base64, so anyone can read it; what makes it trustworthy is this comparison with an HMAC under `PM_SESSION_SECRET` (in constant time). Whoever knows the secret can be anybody, which is why `config.Load` refuses a short or placeholder secret with a real provider. Test: `TestSessionRejectsTamperedExpiredAndForeign`.", at: "if !hmac.Equal(got, mac.Sum(nil)) {" },
        { text: "`HttpOnly` keeps scripts from reading the cookie, `SameSite=Lax` keeps it off cross-site posts (the `X-Requested-With` check is the second guard), `Secure` follows `config.Secure`. The same helper makes the short-lived `pm_signin` cookie of a sign-in.", at: "return &http.Cookie{Name: name, Value: value, Path: \"/\", MaxAge: maxAge, HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteLaxMode}" },
        { text: "Twelve hours is the longest a stolen copy of a cookie works when nobody signs out; there is no server-side session to revoke besides `signed_out`.", at: "return &Sessions{Secret: secret, TTL: 12 * time.Hour, Secure: secure, Now: time.Now}" },
        { text: "`iat` is never earlier than the last sign-out: without this a sign-in in the same millisecond as a sign-out would be ended at once. Test: `TestSigningInRightAfterSigningOutEvenInTheSameMoment`.", at: "if earliest.After(issued) {" },
        { text: "Expiry is checked by the server from `exp` in the signed payload, not left to the browser's `Max-Age`.", at: "if json.Unmarshal(payload, &p) != nil || p.Email == \"\" || s.Now().Unix() >= p.Exp {" },
      ],
      tests: ["server/internal/auth/auth_test.go"],
    },
    {
      path: "server/internal/auth/oidc.go",
      role: "Sign-in with any OpenID Connect provider; Entra ID and Google differ only in issuer and which claim names the person.",
      requirements: [
        { text: "State, nonce and the PKCE verifier live in the signed `pm_signin` cookie for 10 minutes: no server-side store, and a callback from another browser has no cookie and is refused.", at: "http.SetCookie(w, o.sessions.cookie(flowCookie, o.sessions.Sign(payload), 600))" },
        { text: "The cookie is cleared as soon as the callback reads it, so a callback address cannot be replayed.", at: "http.SetCookie(w, o.sessions.cookie(flowCookie, \"\", -1))" },
        { text: "An empty state never matches, so a cookie and an address both without state cannot pass. Test: `TestOIDCRejects`.", at: "if r.URL.Query().Get(\"state\") != f.State || f.State == \"\" {" },
        { text: "The token is verified for this client id (`go-oidc`): a token the provider issued to another application is refused. Test: `TestOIDCRejectsTokenForAnotherClient`.", at: "idToken, err := o.verifier.Verify(ctx, raw)" },
        { text: "Only an explicit `false` (or `\"false\"`) drops the email; a provider that leaves `email_verified` out has its email accepted. Google always sends the claim, and Entra does not use the email at all.", at: "if v := claims.EmailVerified; v == false || v == \"false\" {" },
        { text: "With Entra ID only the sign-in name counts, never the email claim (it can be edited in some tenants); otherwise a person could set their email to an admin's address. Test: `TestOIDCSignInEntraStyle`.", at: "candidates = []string{claims.PreferredUsername, claims.UPN}" },
        { text: "The domain is compared after an `@`, so `evil-example.com` does not pass for `example.com`; the address is kept in lower case, the form `PM_ADMINS` and roles are compared in.", at: "allowed = allowed || strings.HasSuffix(email, \"@\"+strings.ToLower(d))" },
        { text: "A provider that does not answer cannot hold a sign-in or the start for longer than 10 seconds a call.", at: "const providerTimeout = 10 * time.Second" },
      ],
      tests: ["server/internal/auth/auth_test.go", "server/internal/httpapi/api_test.go"],
    },
    {
      path: "server/internal/auth/signout.go",
      role: "Remembers when each person last signed out, so that signing out ends every copy of their session.",
      requirements: [
        { text: "Taking the later of both clocks plus a millisecond ends every session issued so far, also one issued by another instance whose clock runs a little ahead; `greatest(...)` on conflict keeps the moment from moving back.", at: "values ($1, date_trunc('milliseconds', greatest(now(), $2::timestamptz)) + interval '1 millisecond')" },
        { text: "Strictly before: a session issued exactly at the recorded moment (a sign-in right after) counts. Test: `TestSigningOutEndsEveryCopyOfTheSession`.", at: "return issued.Before(at), nil" },
      ],
      tests: ["server/internal/httpapi/hardening_test.go", "server/internal/httpapi/review2_test.go"],
    },
    {
      path: "server/internal/auth/dev.go",
      role: "The built-in users of local development and the roles they get on a local database.",
      requirements: [
        { text: "Seven users, one per kind of rights, so every right can be tried locally; Dana has no stored role and is admin only because `config.Load` names `dana@example.com` in `PM_ADMINS` with `PM_AUTH=dev`.", at: "var DevUsers = []DevUser{" },
        { text: "Given only by `devRoles` in `server/cmd/server/main.go`, with `PM_AUTH=dev`, to a user who has no role at all and only for a scope the lists have. Test: `TestNoDevelopmentRolesWithARealProvider`.", at: "var DevRoles = []DevRole{" },
      ],
      tests: ["server/internal/auth/auth_test.go", "server/cmd/server/main_test.go"],
    },
    {
      path: "server/internal/auth/oidctest/provider.go",
      role: "A small fake OpenID Connect provider for tests: it signs real RS256 identity tokens, so the real verification runs against it.",
      requirements: [
        { text: "Test code only (imported by `_test.go` files): it lets a test add claims and break the nonce to see the server refuse.", at: "BreakNonce bool" },
      ],
      tests: ["server/internal/auth/auth_test.go"],
    },
    {
      path: "server/internal/httpapi/api.go",
      role: "The request guard, the sign-in and sign-out routes, `/api/me`, and how a request finds its person.",
      requirements: [
        { text: "Checked in the guard, before routing, for every method other than `GET`, `HEAD` and `OPTIONS`: a new route cannot forget it. Test: `TestChangesNeedTheCSRFHeader`.", at: "if r.Header.Get(CSRFHeader) != CSRFValue {" },
        { text: "Set on every answer, also errors and the app's files; an icon replaces it with `iconPolicy`. Inline styles are allowed (the map and the code editor position things), inline scripts and `eval` are not, which is why the format checks are generated ahead of time. Test: `TestEveryAnswerCarriesSecurityHeaders`.", at: "h.Set(\"Content-Security-Policy\", contentSecurityPolicy)" },
        { text: "HSTS only when `PM_BASE_URL` is https, so a local http server is never pinned.", at: "if a.Cfg.Secure() {" },
        { text: "A database that cannot say whether the session was ended gives 503, not 401: an outage must not look like being signed out, nor let an ended session through. Test: `TestAnOutageIsNotShownAsSignedOut`.", at: "return session{}, errUnavailable" },
        { text: "The picker's route exists only with `PM_AUTH=dev`; with a real provider `/auth/dev/login` is 404.", at: "mux.HandleFunc(\"POST /auth/dev/login\", a.devLogin)" },
        { text: "Only a built-in user can be chosen, never an address the browser makes up.", at: "u, ok := auth.DevUserByEmail(in.Email)" },
        { text: "Only a session that still counts marks the sign-out, so an ended copy of a cookie cannot throw the person out again and again. Test: `TestAnEndedSessionCannotSignThePersonOutAgain`.", at: "if err == nil && a.SignOuts != nil {" },
        { text: "The built-in users are listed only with `PM_AUTH=dev`; with a real provider `/api/me` gives nothing about other people.", at: "out[\"devUsers\"] = auth.DevUsers" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go", "server/internal/httpapi/review2_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Reads the settings; refuses to start with a sign-in that is not safe.",
      requirements: [
        { text: "The picker lets anyone be anyone, so it may only listen on a loopback address; `PM_DEV_AUTH_ON_NETWORK=i-understand` is for a demo on a private network. Test: `TestDevSignInOnlyOnThisMachine`.", at: "if !loopback(c.Addr) && get(\"PM_DEV_AUTH_ON_NETWORK\", \"\") != \"i-understand\" {" },
        { text: "The fixed development secret is used only with `PM_AUTH=dev`; with a real provider no default exists.", at: "secret = \"dev-only-session-secret-not-for-production\"" },
        { text: "Without a hosted domain or allowed domains every Google account in the world could sign in and read everything.", at: "if c.HostedDomain == \"\" && len(c.EmailDomains) == 0 {" },
        { text: "A placeholder or a secret with fewer than 10 different characters is refused: a copied example secret would let anybody sign cookies.", at: "} else if weakSecret(secret) {" },
        { text: "Kept in lower case, so they match the lower-cased address of a sign-in.", at: "for _, email := range strings.Split(get(\"PM_ADMINS\", \"\"), \",\") {" },
      ],
      tests: ["server/internal/config/config_test.go"],
    },
    {
      path: "server/internal/rbac/rbac.go",
      role: "Where the admins named in the server settings come in.",
      requirements: [
        { text: "An address in `PM_ADMINS` is an admin with no stored role, so it cannot be removed in the portal and there is always a way back in.", at: "func (s *Store) IsBootstrap(email string) bool {" },
      ],
      tests: ["server/internal/rbac/rbac_test.go"],
    },
    {
      path: "server/internal/db/migrations/003_version_notes_sessions.sql",
      role: "Creates `signed_out` (and the note of a version).",
      requirements: [
        { text: "One row per person (primary key `email`): only the latest sign-out matters.", at: "create table signed_out (" },
      ],
    },
  ],
};
