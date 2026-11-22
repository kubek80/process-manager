import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const signin: CodeCategory = {
  id: "signin",
  area: "server",
  title: "Signing in",
  summary:
    "People sign in with OpenID Connect (Entra ID or Google, `PM_AUTH`), or locally with a picker of built-in users (`PM_AUTH=dev`). " +
    "The server keeps no session table: it sets a signed, HTTP-only cookie for 12 hours and remembers only when each person last signed out, which ends every copy of their cookie. " +
    "One guard wraps every request: the security headers, the content security policy, a time limit, the request log, the body limit and the `X-Requested-With` header on every change.",
  requirements: [
    "Every request that is not GET, HEAD or OPTIONS needs `X-Requested-With: process-manager`, or it is refused with 403 before any handler runs.",
    "Every answer carries the content security policy (`script-src 'self'`, no `eval`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: same-origin`; `Strict-Transport-Security` when `PM_BASE_URL` is https.",
    "The session cookie is HMAC-SHA256 signed, HTTP-only, SameSite=Lax, Secure when the address is https, and expires after 12 hours; a changed, expired or foreign cookie is no session.",
    "Signing out ends every session of the person on every device (table `signed_out`); only a session that still counts can do it, and a sign-in right after a sign-out still works.",
    "When the database cannot say whether a session was ended, the answer is 503: neither signed in nor signed out.",
    "OpenID Connect uses state, nonce and PKCE (S256), kept in a signed cookie for 10 minutes; the identity token is verified for this client.",
    "An email the provider marks as not verified is ignored; with Entra ID only the sign-in name (`preferred_username`, `upn`) counts. The address must be in `PM_ALLOWED_EMAIL_DOMAINS` when set, and Google sign-in needs a hosted domain or allowed domains.",
    "A failed sign-in puts only a plain sentence in the address bar (`?signin_error=`); the provider's answer goes to the log.",
    "`PM_AUTH=dev` lets anybody be any built-in user, so the server refuses to start with it on an address reachable from the network, unless `PM_DEV_AUTH_ON_NETWORK=i-understand`.",
    "With Entra ID or Google the server does not start without `PM_ADMINS`, a random `PM_SESSION_SECRET` of at least 32 characters and an https `PM_BASE_URL`.",
  ],
  charts: [
    {
      caption: "Signing in with Entra ID or Google (`auth.OIDC.Login`, `Callback`, `httpapi.callback`).",
      process: flow("code-signin-oidc", "Signing in with OpenID Connect", "From the sign-in button to a session cookie.",
        [["browser", "Browser"], ["server", "Server"], ["idp", "Identity provider"], ["pg", "Postgres"]],
        [
          s("open", "Open /auth/login", "browser", "task", ["start"]),
          s("start", "Set signed state cookie, redirect", "server", "automation", ["login"], "state, nonce, PKCE"),
          s("login", "Sign the person in", "idp", "approval", ["back"]),
          s("back", "Return to /auth/callback", "browser", "task", ["valid"], "code and state"),
          s("valid", "State, code and token valid?", "server", "decision", [["who", "Yes"], ["fail", "No"]], "nonce, audience"),
          s("who", "Verified address, allowed domain?", "server", "decision", [["signedout", "Yes"], ["fail", "No"]]),
          s("fail", "Redirect with a plain reason", "server", "communication", [], "?signin_error="),
          s("signedout", "Read the last sign-out", "pg", "automation", ["issue"], "signed_out"),
          s("issue", "Set a 12-hour session cookie", "server", "automation", ["home"], "issued after it"),
          s("home", "Open the app", "browser", "task", []),
        ]),
    },
    {
      caption: "What happens to every request before a handler sees it (`guard`), and how a route that needs a person finds out who it is (`requireUser`, `signedIn`).",
      process: flow("code-signin-guard", "Every request", "The guard, the session and the rights, in order.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Send a request", "browser", "task", ["headers"]),
          s("headers", "Set the security headers", "server", "automation", ["change"], "CSP, nosniff, DENY"),
          s("change", "Does it change something?", "server", "decision", [["csrf", "POST, PUT, …"], ["route", "GET, HEAD, OPTIONS"]]),
          s("csrf", "X-Requested-With present?", "server", "decision", [["route", "Yes: body ≤ 1 MB"], ["r403", "No"]]),
          s("r403", "Answer 403", "server", "communication", []),
          s("route", "Cookie signed and not expired?", "server", "decision", [["ended", "Yes"], ["r401", "No"]]),
          s("r401", "Answer 401 Please sign in", "server", "communication", []),
          s("ended", "Ended by a later sign-out?", "pg", "decision", [["roles", "No"], ["r401", "Yes"], ["r503", "Cannot tell"]]),
          s("r503", "Answer 503", "server", "communication", []),
          s("roles", "Read the person's roles", "pg", "automation", ["handler"], "a reader on failure"),
          s("handler", "Run the handler", "server", "code", [], "30 s limit"),
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
          note: "exp in seconds (12 hours on), iat in milliseconds: when it was issued, compared with signed_out.at.",
        },
        {
          label: "The cookie",
          shape: `Set-Cookie: pm_session=eyJlbWFpbCI6InNhbUBleGFtcGxlLmNvbSIs….<HMAC-SHA256, base64url>; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure`,
          note: "Not encrypted, only signed: the browser could read the name and email, but cannot change them. Secure only when PM_BASE_URL is https.",
        },
        {
          label: "On every request",
          where: "server/internal/httpapi/api.go",
          shape: `select at from signed_out where email = 'sam@example.com'
-- issued 2026-11-22 08:00:00.000 is not before at → the session counts
select email, role, scope, granted_by, granted_at from role_assignments where email = 'sam@example.com' …`,
          note: "No row in signed_out: the zero time, the session counts. The rights are read fresh each time.",
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
        { text: "A value is accepted only with a matching HMAC-SHA256 over its payload, compared in constant time.", at: "func (s *Sessions) Verify(value string) ([]byte, bool) {" },
        { text: "Cookies are HTTP-only, SameSite=Lax, on the whole site, and Secure when the portal runs on https.", at: "return &http.Cookie{Name: name, Value: value, Path: \"/\", MaxAge: maxAge, HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteLaxMode}" },
        { text: "A session lasts 12 hours.", at: "return &Sessions{Secret: secret, TTL: 12 * time.Hour, Secure: secure, Now: time.Now}" },
        { text: "A session issued right after a sign-out is dated after it, so it counts.", at: "func (s *Sessions) IssueNotBefore(w http.ResponseWriter, u User, earliest time.Time) {" },
        { text: "A cookie without an email, or past its expiry, is no session.", at: "if json.Unmarshal(payload, &p) != nil || p.Email == \"\" || s.Now().Unix() >= p.Exp {" },
      ],
      tests: ["server/internal/auth/auth_test.go"],
    },
    {
      path: "server/internal/auth/oidc.go",
      role: "Sign-in with any OpenID Connect provider; Entra ID and Google differ only in issuer and which claim names the person.",
      requirements: [
        { text: "Login keeps state, nonce and the PKCE verifier in a signed cookie for 10 minutes and sends the S256 challenge.", at: "func (o *OIDC) Login(w http.ResponseWriter, r *http.Request) {" },
        { text: "The callback refuses a missing or changed state, a token that does not verify for this client, and a wrong nonce.", at: "if idToken.Nonce != f.Nonce {" },
        { text: "An email the provider says is not verified proves nothing and is dropped.", at: "if v := claims.EmailVerified; v == false || v == \"false\" {" },
        { text: "With Entra ID only the sign-in name counts, never the email claim (it can be edited in some tenants).", at: "candidates = []string{claims.PreferredUsername, claims.UPN}" },
        { text: "The hosted domain (Google) and the allowed email domains are checked; the address is kept in lower case.", at: "allowed = allowed || strings.HasSuffix(email, \"@\"+strings.ToLower(d))" },
        { text: "Only a plain sentence of a failure is shown to the person; the cause goes to the log.", at: "func PublicMessage(err error) string {" },
        { text: "Every call to the provider has a 10-second limit, so a provider that does not answer cannot hold a sign-in or a start.", at: "const providerTimeout = 10 * time.Second" },
      ],
      tests: ["server/internal/auth/auth_test.go", "server/internal/httpapi/api_test.go"],
    },
    {
      path: "server/internal/auth/signout.go",
      role: "Remembers when each person last signed out, so that signing out ends every copy of their session.",
      requirements: [
        { text: "The recorded moment is a millisecond after both clocks, so every session issued so far ends, also one from another instance.", at: "values ($1, date_trunc('milliseconds', greatest(now(), $2::timestamptz)) + interval '1 millisecond')" },
        { text: "A session counts only when it was issued at or after the recorded moment.", at: "func (s *SignOuts) Ended(ctx context.Context, email string, issued time.Time) (bool, error) {" },
      ],
      tests: ["server/internal/httpapi/hardening_test.go", "server/internal/httpapi/review2_test.go"],
    },
    {
      path: "server/internal/auth/dev.go",
      role: "The built-in users of local development and the roles they get on a local database.",
      requirements: [
        { text: "Seven built-in users, each with a different set of rights; Dana is admin through the server settings, not a stored role.", at: "var DevUsers = []DevUser{" },
        { text: "A built-in user gets these roles only when they have no role at all, so changes made in the portal stay.", at: "var DevRoles = []DevRole{" },
      ],
      tests: ["server/internal/auth/auth_test.go", "server/cmd/server/main_test.go"],
    },
    {
      path: "server/internal/auth/oidctest/provider.go",
      role: "A small fake OpenID Connect provider for tests: it signs real RS256 identity tokens, so the real verification runs against it.",
      requirements: [
        { text: "Test code only: lets a test add claims and break the nonce to see the server refuse.", at: "BreakNonce bool" },
      ],
      tests: ["server/internal/auth/auth_test.go"],
    },
    {
      path: "server/internal/httpapi/api.go",
      role: "The request guard, the sign-in and sign-out routes, /api/me, and how a request finds its person.",
      requirements: [
        { text: "One guard for every request: security headers, the 30-second limit and request log for /api/ and /auth/, the X-Requested-With check and the 1 MB body limit on changes.", at: "func (a *api) guard(next http.Handler) http.Handler {" },
        { text: "Everything the app needs comes from the app itself; inline styles are allowed, inline scripts and eval are not.", at: "const contentSecurityPolicy = " },
        { text: "The header that every change must carry: other sites cannot set it on a forged request.", at: "CSRFHeader = \"X-Requested-With\"" },
        { text: "A session counts only when its cookie verifies and no later sign-out ended it; when that cannot be read, the answer is 503, never signed in or out.", at: "func (a *api) signedIn(r *http.Request) (session, error) {" },
        { text: "The development picker accepts only a built-in user, and exists only with PM_AUTH=dev.", at: "func (a *api) devLogin(w http.ResponseWriter, r *http.Request) {" },
        { text: "Signing out clears this browser's cookie always, and ends the other sessions only for a session that still counts.", at: "func (a *api) logout(w http.ResponseWriter, r *http.Request) {" },
        { text: "/api/me tells anyone whether they are signed in, with their rights; the built-in users only in development.", at: "func (a *api) me(w http.ResponseWriter, r *http.Request) {" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go", "server/internal/httpapi/review2_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Reads the settings; refuses to start with a sign-in that is not safe.",
      requirements: [
        { text: "PM_AUTH=dev only on a loopback address, unless PM_DEV_AUTH_ON_NETWORK=i-understand; a development session secret and dana@example.com as admin when none are set.", at: "if !loopback(c.Addr) && get(\"PM_DEV_AUTH_ON_NETWORK\", \"\") != \"i-understand\" {" },
        { text: "Google sign-in needs PM_GOOGLE_HOSTED_DOMAIN or PM_ALLOWED_EMAIL_DOMAINS, otherwise any Google account could sign in.", at: "if c.HostedDomain == \"\" && len(c.EmailDomains) == 0 {" },
        { text: "With a real provider: client id and secret, a session secret of at least 32 characters that is not a placeholder, an https PM_BASE_URL, and at least one PM_ADMINS.", at: "problems = append(problems, \"PM_SESSION_SECRET must be at least 32 characters\")" },
        { text: "PM_ADMINS are kept in lower case; they are admins whatever the database says.", at: "for _, email := range strings.Split(get(\"PM_ADMINS\", \"\"), \",\") {" },
        { text: "Cookies are Secure exactly when the base address is https.", at: "func (c Config) Secure() bool { return strings.HasPrefix(c.BaseURL, \"https://\") }" },
      ],
      tests: ["server/internal/config/config_test.go"],
    },
    {
      path: "server/internal/rbac/rbac.go",
      role: "Where the admins named in the server settings come in.",
      requirements: [
        { text: "An address in PM_ADMINS is an admin, compared in lower case, with no stored role needed.", at: "func (s *Store) IsBootstrap(email string) bool {" },
      ],
      tests: ["server/internal/rbac/rbac_test.go"],
    },
    {
      path: "server/internal/db/migrations/003_version_notes_sessions.sql",
      role: "Creates signed_out (and the note of a version).",
      requirements: [
        { text: "One row per person: the moment of their last sign-out.", at: "create table signed_out (" },
      ],
    },
  ],
};
