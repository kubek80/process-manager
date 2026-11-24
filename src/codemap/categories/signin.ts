import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const signin: CodeCategory = {
  id: "signin",
  area: "server",
  title: "Signing in",
  summary:
    "Signs people in with Entra ID or Google (or a local picker of built-in users) and guards every request the server answers. " +
    "The server keeps no session table: it sets a signed, HTTP-only cookie for 12 hours and remembers only when each person last signed out (`signed_out`), which ends every copy of their cookie. " +
    "One guard (`guard` in `api.go`) wraps every request: the security headers, the content security policy, a time limit, the request log, the body limit, the `X-Requested-With` header on every change, and the refusal of every change while an admin views the portal as somebody else. " +
    "Viewing as somebody else (`viewas.go`): an admin chooses a person, and that one session of the admin is answered as that person on every route, with nothing that can be changed; the state is a row of `viewing_as` under the session's id, never anything the browser holds.",
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
    "With Entra ID or Google the server does not start without `PM_ADMINS`, a random `PM_SESSION_SECRET` of at least 32 characters and an https `PM_BASE_URL` (http only for localhost).",
    "The person of a request is decided in one place, `signedIn` → `viewedAs`: while an admin views the portal as P, every route gets P's identity and P's rights (an admin route answers 403, a draft P may not see 404, exactly as for P), and the admin is kept only in `session.viewer`. A route never works out the person itself; a change reuses the person `guard` resolved (`requireUser`), so it cannot be judged as one person and done as another.",
    "While viewing, every request but `GET` and `HEAD` is refused in `guard` with 403 \"You are viewing the portal as {name or address}, so nothing can be changed. Stop viewing first.\", on every route, including routes added later; the only exceptions, by exact path and method, are `DELETE /api/admin/view-as` (stop) and `POST /auth/logout`. Starting again while viewing is 409.",
    "Nothing is ever written in the viewed person's name: a view is not sent and would be refused, a skill download is not counted (`mayCount`), the brakes on searching and on reading the code count the admin (`countsFor`), and Activity records only the admin's `viewas.start`, `viewas.stop` and `viewas.end`. The viewed person is not told.",
    "Only an admin starts viewing, judged by their own roles at that moment (not wrapped in `admin()`), never as themselves, never nested or switched without stopping; any valid address may be viewed (one with no roles is exactly a reader; `reader@no-roles.invalid` is the built-in reader with no rights whatever is stored, and no role can be given to that address).",
    "Viewing ends when the admin stops or signs out (all their sessions), when the session ends, after one hour (`auth.ViewAsFor`), and on the first request after the admin stopped being an admin. A change that finds its viewing ended in that very request is refused with 409, never done as the admin.",
    "Every change from the app carries `X-Acting-As` (the address `/api/me` gave the page); a change whose header names somebody else than the request resolves to is refused with 409 \"This page is out of date: …\", so a tab left open while viewing started or stopped in another tab never acts as the other person. Without the header (other clients) nothing is compared.",
    "The MCP server never reads sessions or `viewing_as`: nothing can be reached there \"as\" somebody else.",
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
      process: flow("code-signin-guard", "The guard of every request", "Headers, the header against forged requests, the body limit, and no change while viewing as somebody else.",
        [["browser", "Browser"], ["server", "Server"]],
        [
          s("send", "Send a request", "browser", "task", ["headers"]),
          s("headers", "Set the security headers", "server", "automation", ["change"], "CSP, nosniff, DENY"),
          s("change", "Does it change something?", "server", "decision", [["csrf", "POST, PUT, …"], ["route", "GET, HEAD, OPTIONS"]]),
          s("csrf", "X-Requested-With present?", "server", "verify", [["limit", "Yes"], ["r403", "No"]]),
          s("r403", "Answer 403", "server", "communication", []),
          s("limit", "Limit the body to 1 MB", "server", "automation", ["viewing"]),
          s("viewing", "Viewing as somebody else?", "server", "decision", [["route", "No"], ["r403", "Yes"]], "refuseWhileViewing"),
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
          s("roles", "Read the person's roles", "pg", "task", ["viewing"], "a reader on failure"),
          s("viewing", "Session viewing as somebody?", "pg", "decision", [["handler", "No"], ["asthem", "Yes"]], "viewing_as, viewedAs"),
          s("asthem", "Answer as that person, read only", "server", "automation", ["handler"], "their roles; changes 403"),
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
      readBy: ["server/internal/auth/signout.go", "server/internal/httpapi/api.go"],
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
          shape: `{"email": "sam@example.com", "name": "Sam Consumer", "exp": 1795377600, "iat": 1795334400000, "sid": "q3Vb8x2LkP0aZr7mN4tY_wQe"}`,
          note: "`exp` in seconds (12 hours on), `iat` in milliseconds: when it was issued, compared with `signed_out.at`. `sid`: 18 random bytes naming this one session; what the server keeps for a session (`viewing_as`) is kept under it. A cookie from before `sid` is named `issued:<iat>`.",
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
        { text: "Every new session gets a random id (`sid`, 18 bytes), inside the signed payload: two sessions of one person are told apart, so viewing as somebody else in one browser never touches the admin's other sessions, and a guessed id is useless without the secret.", at: "Iat: issued.UnixMilli(), Sid: newSessionID()})" },
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
        { text: "Seven users, one per kind of rights, so every right can be tried locally; Dana has no stored role and is admin only because `config.Load` makes `dana@example.com` the admin of the server settings when `PM_ADMINS` is empty with `PM_AUTH=dev`.", at: "var DevUsers = []DevUser{" },
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
        { text: "The picker's route exists only with `PM_AUTH=dev`; with a real provider `POST /auth/dev/login` reaches no sign-in (404, or 405 from the app's files where `PM_STATIC_DIR` is set). Test: `TestOIDCSignInSetsASessionWithRolesFromTheDatabase`.", at: "mux.HandleFunc(\"POST /auth/dev/login\", a.devLogin)" },
        { text: "Only a built-in user can be chosen, never an address the browser makes up.", at: "u, ok := auth.DevUserByEmail(in.Email)" },
        { text: "Only a session that still counts marks the sign-out, so an ended copy of a cookie cannot throw the person out again and again. Test: `TestAnEndedSessionCannotSignThePersonOutAgain`.", at: "if err == nil && a.SignOuts != nil {" },
        { text: "The built-in users are listed only with `PM_AUTH=dev`; with a real provider `/api/me` gives nothing about other people.", at: "out[\"devUsers\"] = auth.DevUsers" },
        { text: "The one place where the person of a request is decided: after the cookie, the sign-out and the roles, `viewedAs` turns an admin's session that views somebody into that person's. Deciding it anywhere else would let one route answer as the admin while viewing. Test: `TestViewingAsSomebodySeesExactlyWhatTheySee`.", at: "return a.viewedAs(r.Context(), session{User: u, Perms: perms, id: ses.ID}, err != nil)" },
        { text: "Every request but GET and HEAD goes through `refuseWhileViewing` here, before any route, so a new route cannot forget it. Test: `TestViewingAsSomebodyChangesNothingOnAnyRoute`.", at: "if r, refused = a.refuseWhileViewing(w, r); refused {" },
        { text: "A change uses the person `guard` already resolved: resolving again could find the viewing ended in between and act as the admin. Test: `TestAChangeKeepsThePersonGuardFound`.", at: "if _, ok := r.Context().Value(ctxKey{}).(session); ok {" },
        { text: "`viewedBy` (the admin, and `until`) is added only while viewing; the viewed person's identity and rights are as always.", at: "out[\"viewedBy\"] = s.viewer.info()" },
        { text: "Signing out while viewing signs out the admin (all their sessions, and ends every viewing of theirs), never the person they were looking at. Test: `TestSigningOutWhileViewingSignsOutTheAdminNotThePerson`.", at: "me := s.self()" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go", "server/internal/httpapi/review2_test.go"],
    },
    {
      path: "server/internal/httpapi/viewas.go",
      role: "Viewing the portal as somebody else: who the request is for while viewing, the refusal of every change, starting and stopping, and the list of people an admin can choose from.",
      requirements: [
        { text: "The only changes allowed while viewing, by exact path and method: stopping and signing out. A prefix match would let `DELETE /api/admin/view-as/x` or any future route under it through. Test: `TestViewingAsSomebodyChangesNothingOnAnyRoute`.", at: "return (path == \"/api/admin/view-as\" && method == http.MethodDelete) || (path == \"/auth/logout\" && method == http.MethodPost)" },
        { text: "When the database cannot say whether the session views somebody, a change is refused with 503: nothing is let through on a guess.", at: "// whether the session views as somebody is not known: nothing is let through on a guess" },
        { text: "Every change while viewing is refused with the one sentence (403); starting again is 409. Whatever the route would have done, nothing happens.", at: "writeError(w, 403, viewingRefusal(s))" },
        { text: "A change that finds its viewing ended in this very request (the hour, the admin role gone) was meant as the other person: refused with 409, not done as the admin. Test: `TestAChangeThatEndsTheViewingIsNotDoneAsTheAdmin`.", at: "if s.viewEnded != \"\" {" },
        { text: "`X-Acting-As` names whom the page believes it acts as; a mismatch (or a broken encoding) is 409, so a stale tab never acts as the other person. Without the header nothing is compared. Test: `TestAPageThatActsAsSomebodyElseIsRefused`.", at: "if claimed := r.Header.Get(ActingAsHeader); claimed != \"\" {" },
        { text: "A database error reading the viewing gives 503, never the admin's own rights instead of the person's.", at: "return session{}, errUnavailable // never the admin's own rights instead" },
        { text: "Checked on every request: the admin role gone, the hour passed, or the target the admin themself ends the viewing, once, written to Activity with why. A person who loses their roles is simply a reader from then on. Tests: `TestViewingEndsWhenTheAdminIsNoLongerAnAdmin`, `TestViewingEndsAfterAnHour`, `TestViewingFollowsThePersonWhoLosesTheirRoles`.", at: "case !s.Admin:" },
        { text: "The built-in reader gets no rights whatever is stored for its address. Test: `TestTheReaderWithNoRolesNeverHasRights`.", at: "perms := rbac.PermsFrom(nil, false) // the reader with no roles has none, whatever is stored" },
        { text: "Whose allowance a brake charges: the person who signed in, so an admin's searches and code reading while viewing never use up the viewed person's. Test: `TestTheBrakesChargeTheAdminWhileViewing`.", at: "func (s session) countsFor() string { return s.self().Email }" },
        { text: "Nothing is counted for the person while somebody views as them (a skill download). Test: `TestViewingAsSomebodyCountsNothing`.", at: "func (s session) mayCount() bool { return s.viewer == nil }" },
        { text: "Started by an admin's own roles: the route is `user(…)`, not `admin(…)`, because `who(r)` is already the viewed person while viewing (and guard refuses that case first). Test: `TestOnlyAnAdminStartsViewingAndNeverAsThemselves`.", at: "if !s.Admin {" },
        { text: "Never as oneself, in any case of letters.", at: "if email == strings.ToLower(strings.TrimSpace(s.Email)) {" },
        { text: "At most 254 characters, a valid address without control or invisible characters: nothing else is written to `viewing_as` or Activity. Nothing is stored in the viewed person's name. Test: `TestTheAddressIsCappedAndTheReaderAddressGetsNoRole`.", at: "if len(email) > maxAddress {" },
        { text: "The people an admin can pick from are only those already shown as actors: with a role, in Activity, as the author of feedback or of a request (plus `PM_ADMINS` and, in development, the built-in users). Never somebody known only from a view, a download, a bookmark, an upvote, a vote or a sign-out: nobody is ever shown who read or downloaded what. Test: `TestAdminsListThePeopleThePortalKnows`.", at: "const peopleQuery = `select email, bool_or(has_role) from (" },
      ],
      tests: ["server/internal/httpapi/viewas_test.go"],
    },
    {
      path: "server/internal/auth/viewas.go",
      role: "Keeps, per session of an admin, whose view of the portal the admin is looking at (table `viewing_as`), and for how long.",
      requirements: [
        { text: "One hour, then the viewing ends by itself at the next request.", at: "const ViewAsFor = time.Hour" },
        { text: "One row per admin and session: a second start is `ErrAlreadyViewing` (409), never a switch or a nesting. Test: `TestStartingWhileViewingIsRefusedByTheRouteToo`.", at: "values ($1, $2, $3, $4, $5, $6) on conflict (email, session) do nothing returning" },
        { text: "Stop reports whether something was stopped, so an end is written to Activity once even when two requests end it together.", at: "func (s *ViewAs) Stop(ctx context.Context, admin, session string) (Viewing, bool, error) {" },
        { text: "Signing out ends every viewing of the admin, in every session.", at: "func (s *ViewAs) StopAll(ctx context.Context, admin string) ([]Viewing, error) {" },
      ],
      tests: ["server/internal/auth/viewas_test.go", "server/internal/httpapi/viewas_test.go"],
    },
    {
      path: "server/internal/db/migrations/013_viewing_as.sql",
      role: "Creates `viewing_as`.",
      requirements: [
        { text: "Keyed by the admin and the session: the state of viewing lives on the server, under the session's id, never in the cookie's value or the page.", at: "primary key (email, session)" },
      ],
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
      role: "Where the admins named in the server settings come in, and the reserved address of the reader with no roles.",
      requirements: [
        { text: "An address in `PM_ADMINS` is an admin with no stored role, so it cannot be removed in the portal and there is always a way back in.", at: "func (s *Store) IsBootstrap(email string) bool {" },
        { text: "`reader@no-roles.invalid` stands for the reader with no roles that admins view the portal as; `Check`, which every way of giving a role goes through, refuses it, so a real sign-in under that address (a lax provider) could never carry a role either. Test: `TestTheAddressIsCappedAndTheReaderAddressGetsNoRole`.", at: "if strings.EqualFold(strings.TrimSpace(a.Email), NoRolesReader) {" },
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
