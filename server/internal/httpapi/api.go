// Package httpapi is the HTTP surface of the server: sign-in, content, feedback, the Admin
// panel and the skills registry. Every right is checked here; the browser only hides controls.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/notify"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/schema"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// CSRFHeader must be sent with every request that changes something. Browsers do not let
// other sites set custom headers, so a forged cross-site request cannot carry it.
const (
	CSRFHeader = "X-Requested-With"
	CSRFValue  = "process-manager"
)

const maxBody = 1 << 20 // 1 MB

// requestTimeout bounds the work for one request, so a stuck query cannot hold a connection
// of the pool forever.
const requestTimeout = 30 * time.Second

// contentSecurityPolicy: everything the app needs comes from the app itself. Inline styles are
// allowed because the code editor and the map position things with them.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
	"connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

type Deps struct {
	Cfg      config.Config
	Sessions *auth.Sessions
	SignOuts *auth.SignOuts // nil: signing out only clears the cookie (tests of single handlers)
	OIDC     *auth.OIDC     // nil when PM_AUTH=dev
	// Ready reports whether the server can do its work (the database answers). nil: always.
	Ready    func(context.Context) error
	Docs     *docs.Store
	Schemas  *schema.Set
	Roles    *rbac.Store
	Audit    *audit.Log
	Skills   *skills.Store
	Feedback *feedback.Store
	Notifier notify.Notifier
	Log      *slog.Logger
}

type api struct{ Deps }

type ctxKey struct{}

type session struct {
	auth.User
	rbac.Perms
}

// New builds the handler.
func New(d Deps) http.Handler {
	a := &api{d}
	mux := http.NewServeMux()

	// healthz: the process is alive. readyz: it can also reach the database, so it may get traffic.
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if d.Ready != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := d.Ready(ctx); err != nil {
				a.Log.Error("not ready", "error", err)
				writeError(w, 503, "The database cannot be reached.")
				return
			}
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/me", a.me)
	mux.HandleFunc("POST /auth/logout", a.logout)
	if d.Cfg.Auth == config.AuthDev {
		mux.HandleFunc("POST /auth/dev/login", a.devLogin)
	} else {
		mux.HandleFunc("GET /auth/login", d.OIDC.Login)
		mux.HandleFunc("GET /auth/callback", a.callback)
	}

	user := a.requireUser
	admin := func(h http.HandlerFunc) http.Handler {
		return user(func(w http.ResponseWriter, r *http.Request) {
			if !who(r).Admin {
				writeError(w, 403, "Only admins can do that.")
				return
			}
			h(w, r)
		})
	}

	// content
	mux.Handle("GET /api/processes", user(a.listDocs(docs.Process, "processes")))
	mux.Handle("PUT /api/processes/{id}", user(a.putDoc(docs.Process)))
	mux.Handle("DELETE /api/processes/{id}", user(a.deleteDoc(docs.Process)))
	mux.Handle("GET /api/standards", user(a.listDocs(docs.Standard, "standards")))
	mux.Handle("PUT /api/standards/{id}", user(a.putDoc(docs.Standard)))
	mux.Handle("DELETE /api/standards/{id}", user(a.deleteDoc(docs.Standard)))
	mux.Handle("GET /api/catalog", user(a.getCatalog))
	mux.Handle("PUT /api/catalog", user(a.putDoc(docs.Catalog)))
	mux.Handle("GET /api/history/{kind}/{id}", user(a.history))
	mux.Handle("GET /api/history/{kind}/{id}/{version}", user(a.historyVersion))

	// feedback
	mux.Handle("GET /api/feedback", user(a.listFeedback))
	mux.Handle("POST /api/feedback", user(a.createFeedback))
	mux.Handle("PATCH /api/feedback/{id}", user(a.resolveFeedback))
	mux.Handle("DELETE /api/feedback/{id}", user(a.deleteFeedback))
	mux.Handle("POST /api/feedback/{id}/also-hit", user(a.alsoHit(true)))
	mux.Handle("DELETE /api/feedback/{id}/also-hit", user(a.alsoHit(false)))

	// skills and review agents
	mux.Handle("GET /api/skills", user(a.listSkills))
	mux.Handle("GET /api/skills/{id}", user(a.getSkill))
	mux.Handle("GET /api/skills/{id}/versions/{version}", user(a.getSkillVersion))
	mux.Handle("GET /api/skills/{id}/download", user(a.downloadSkill))
	mux.Handle("PUT /api/skills/{id}/extra", user(a.putSkillExtra))

	// admin panel
	mux.Handle("GET /api/admin/access", admin(a.listAccess))
	mux.Handle("POST /api/admin/access", admin(a.grantAccess))
	mux.Handle("DELETE /api/admin/access", admin(a.revokeAccess))
	mux.Handle("GET /api/admin/audit", admin(a.listAudit))
	mux.Handle("GET /api/admin/system", admin(a.system))

	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) { writeError(w, 404, "no such API endpoint") })
	if d.Cfg.StaticDir != "" {
		mux.Handle("/", a.static())
	}
	return a.guard(mux)
}

// ---------- plumbing

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (a *api) fail(w http.ResponseWriter, r *http.Request, err error) {
	var tooBig *http.MaxBytesError
	switch {
	case errors.Is(err, feedback.ErrNotFound):
		writeError(w, 404, "That feedback no longer exists.")
	case errors.Is(err, docs.ErrNotFound), errors.Is(err, skills.ErrNotFound):
		writeError(w, 404, "That does not exist.")
	case errors.Is(err, docs.ErrInvalid), errors.Is(err, rbac.ErrInvalid):
		writeError(w, 400, strings.TrimPrefix(err.Error(), "invalid: "))
	case errors.Is(err, rbac.ErrNotGiven):
		writeError(w, 404, "That person does not have that role.")
	case errors.Is(err, rbac.ErrLastAdmin):
		writeError(w, 409, "This is the last admin. Make someone else an admin first.")
	case errors.As(err, &tooBig):
		writeError(w, 413, "The request is too large.")
	default:
		a.Log.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
		writeError(w, 500, "Something went wrong on the server.")
	}
}

// statusWriter remembers the status of a response for the request log.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

// guard applies to every request: security headers, a time limit, the request log, the body
// limit and the CSRF header on changes.
func (a *api) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		if a.Cfg.Secure() {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		api := strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/")
		if api {
			ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
			defer cancel()
			r = r.WithContext(ctx)
			sw := &statusWriter{ResponseWriter: w, status: 200}
			w = sw
			start := time.Now()
			defer func() {
				level := slog.LevelInfo
				if sw.status >= 500 {
					level = slog.LevelError
				}
				a.Log.Log(r.Context(), level, "request", "method", r.Method, "path", r.URL.Path, "status", sw.status, "ms", time.Since(start).Milliseconds())
			}()
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			if r.Header.Get(CSRFHeader) != CSRFValue {
				writeError(w, 403, "Missing request header "+CSRFHeader+".")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		}
		next.ServeHTTP(w, r)
	})
}

// errUnavailable: whether the session still counts could not be found out.
var errUnavailable = errors.New("the database cannot be reached")

func (a *api) current(r *http.Request) (session, bool) {
	s, err := a.signedIn(r)
	return s, err == nil
}

// signedIn returns the session of the request. errNoSession: there is none (any more).
// errUnavailable: the database did not say whether it was ended - which is neither "signed in"
// nor "signed out", and must not be shown to the person as either.
func (a *api) signedIn(r *http.Request) (session, error) {
	u, issued, ok := a.Sessions.ReadIssued(r)
	if !ok {
		return session{}, errNoSession
	}
	if a.SignOuts != nil {
		ended, err := a.SignOuts.Ended(r.Context(), u.Email, issued)
		if err != nil {
			// a request the browser gave up on is not a problem of the server
			if !errors.Is(err, context.Canceled) {
				a.Log.Error("sign-outs could not be read", "error", err)
			}
			return session{}, errUnavailable
		}
		if ended {
			return session{}, errNoSession
		}
	}
	perms, err := a.Roles.Perms(r.Context(), u.Email)
	if err != nil {
		// a database problem must not turn into extra rights
		a.Log.Error("roles could not be read: treating the user as a consumer", "error", err)
		perms = rbac.PermsFrom(nil, false)
	}
	return session{User: u, Perms: perms}, nil
}

var errNoSession = errors.New("not signed in")

// issue signs somebody in. The session is dated after their last sign-out, so that signing in
// again right after signing out works.
func (a *api) issue(w http.ResponseWriter, r *http.Request, u auth.User) error {
	var earliest time.Time
	if a.SignOuts != nil {
		at, err := a.SignOuts.At(r.Context(), u.Email)
		if err != nil {
			return err
		}
		earliest = at
	}
	a.Sessions.IssueNotBefore(w, u, earliest)
	return nil
}

func (a *api) requireUser(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s, err := a.signedIn(r)
		if errors.Is(err, errUnavailable) {
			writeError(w, 503, "The server cannot reach its database right now. Try again in a moment.")
			return
		}
		if err != nil {
			writeError(w, 401, "Please sign in.")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, s)))
	})
}

func who(r *http.Request) session { return r.Context().Value(ctxKey{}).(session) }

func readJSON(r *http.Request, v any) error {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, v); err != nil {
		return fmt.Errorf("%w: the request is not valid JSON", docs.ErrInvalid)
	}
	return nil
}

// record writes to the audit trail. A failure is logged, never shown: the change itself worked.
func (a *api) record(r *http.Request, action, target, detail string) {
	s := who(r)
	if err := a.Audit.Add(r.Context(), s.Email, s.Name, action, target, detail); err != nil {
		a.Log.Error("audit entry not written", "action", action, "target", target, "error", err)
	}
}

// ---------- sign-in

func (a *api) me(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"provider": a.Cfg.Auth}
	s, err := a.signedIn(r)
	if errors.Is(err, errUnavailable) {
		writeError(w, 503, "The server cannot reach its database right now. Try again in a moment.")
		return
	}
	ok := err == nil
	out["authenticated"] = ok
	if ok {
		out["user"] = s.User
		out["perms"] = s.Perms
	}
	if a.Cfg.Auth == config.AuthDev {
		out["devUsers"] = auth.DevUsers
	}
	writeJSON(w, 200, out)
}

func (a *api) devLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	u, ok := auth.DevUserByEmail(in.Email)
	if !ok {
		writeError(w, 400, "Unknown development user.")
		return
	}
	if err := a.issue(w, r, u); err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, u)
}

func (a *api) callback(w http.ResponseWriter, r *http.Request) {
	u, err := a.OIDC.Callback(w, r)
	if err != nil {
		// the log gets the whole story, the address bar only what the person can act on
		a.Log.Warn("sign-in failed", "error", err)
		http.Redirect(w, r, a.Cfg.BaseURL+"/?signin_error="+url.QueryEscape(auth.PublicMessage(err)), http.StatusFound)
		return
	}
	if err := a.issue(w, r, u); err != nil {
		a.Log.Error("sign-in failed", "error", err)
		http.Redirect(w, r, a.Cfg.BaseURL+"/?signin_error="+url.QueryEscape("The sign-in could not be completed. Try again in a moment."), http.StatusFound)
		return
	}
	a.Log.Info("signed in", "email", u.Email)
	http.Redirect(w, r, a.Cfg.BaseURL+"/", http.StatusFound)
}

// logout ends every session of the person, not just the cookie of this browser: a copy of
// the cookie stops working too.
func (a *api) logout(w http.ResponseWriter, r *http.Request) {
	// Only a session that still counts can end the others: a copy that was ended already
	// must not be able to throw the person out again and again.
	s, err := a.signedIn(r)
	a.Sessions.Clear(w) // this browser is signed out whatever happens next
	if err == nil && a.SignOuts != nil {
		if _, err := a.SignOuts.Mark(r.Context(), s.Email, a.Sessions.Now()); err != nil {
			a.fail(w, r, err)
			return
		}
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---------- built frontend

func (a *api) static() http.Handler {
	files := http.FileServer(http.Dir(a.Cfg.StaticDir))
	index := filepath.Join(a.Cfg.StaticDir, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, 405, "Method not allowed.")
			return
		}
		clean := filepath.Join(a.Cfg.StaticDir, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(clean); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		// A missing file is a missing file. Answering with the app page instead would hand a
		// browser that still runs an older version HTML where it expects a script.
		if strings.HasPrefix(r.URL.Path, "/assets/") || filepath.Ext(r.URL.Path) != "" {
			http.NotFound(w, r)
			return
		}
		// the app routes on the hash, so every other path is the app itself
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, index)
	})
}
