// Package httpapi is the HTTP surface of the server: sign-in, content files and feedback.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/content"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/notify"
)

// CSRFHeader must be sent with every request that changes something. Browsers do not let
// other sites set custom headers, so a forged cross-site request cannot carry it.
const (
	CSRFHeader = "X-Requested-With"
	CSRFValue  = "process-manager"
)

const maxBody = 1 << 20 // 1 MB

type Deps struct {
	Cfg      config.Config
	Sessions *auth.Sessions
	OIDC     *auth.OIDC // nil when PM_AUTH=dev
	Content  *content.Store
	Feedback *feedback.Store
	Notifier notify.Notifier
	Log      *slog.Logger
}

type api struct{ Deps }

type ctxKey struct{}

type session struct {
	auth.User
	auth.Roles
}

// New builds the handler.
func New(d Deps) http.Handler {
	a := &api{d}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /api/me", a.me)
	mux.HandleFunc("POST /auth/logout", a.logout)
	if d.Cfg.Auth == config.AuthDev {
		mux.HandleFunc("POST /auth/dev/login", a.devLogin)
	} else {
		mux.HandleFunc("GET /auth/login", d.OIDC.Login)
		mux.HandleFunc("GET /auth/callback", a.callback)
	}

	user := a.requireUser
	mux.Handle("GET /api/processes", user(a.listProcesses))
	mux.Handle("PUT /api/processes/{id}", user(a.putProcess))
	mux.Handle("DELETE /api/processes/{id}", user(a.deleteProcess))
	mux.Handle("GET /api/catalog", user(a.getCatalog))
	mux.Handle("PUT /api/catalog", user(a.putCatalog))
	mux.Handle("GET /api/feedback", user(a.listFeedback))
	mux.Handle("POST /api/feedback", user(a.createFeedback))
	mux.Handle("PATCH /api/feedback/{id}", user(a.resolveFeedback))
	mux.Handle("DELETE /api/feedback/{id}", user(a.deleteFeedback))
	mux.Handle("POST /api/feedback/{id}/also-hit", user(a.alsoHit(true)))
	mux.Handle("DELETE /api/feedback/{id}/also-hit", user(a.alsoHit(false)))

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
	switch {
	case errors.Is(err, feedback.ErrNotFound):
		writeError(w, 404, "That feedback no longer exists.")
	case errors.Is(err, content.ErrInvalid):
		writeError(w, 400, strings.TrimPrefix(err.Error(), "invalid: "))
	default:
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, 413, "The request is too large.")
			return
		}
		a.Log.Error("request failed", "method", r.Method, "path", r.URL.Path, "error", err)
		writeError(w, 500, "Something went wrong on the server.")
	}
}

// guard applies to every request: body limit and the CSRF header on changes.
func (a *api) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

func (a *api) current(r *http.Request) (session, bool) {
	u, ok := a.Sessions.Read(r)
	if !ok {
		return session{}, false
	}
	access, err := auth.LoadAccess(a.Cfg.AccessFile)
	if err != nil {
		// a broken access file must not lock people out of reading, but grants nothing
		a.Log.Error("access file unreadable: nobody has editor or team rights", "file", a.Cfg.AccessFile, "error", err)
	}
	return session{User: u, Roles: access.RolesOf(u.Email)}, true
}

func (a *api) requireUser(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s, ok := a.current(r)
		if !ok {
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
		return errors.Join(content.ErrInvalid, errors.New("invalid: the request is not valid JSON"))
	}
	return nil
}

// ---------- sign-in

func (a *api) me(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"provider": a.Cfg.Auth, "contentWritable": a.Cfg.ContentWritable}
	s, ok := a.current(r)
	out["authenticated"] = ok
	if ok {
		out["user"] = s.User
		out["editor"] = s.Editor
		out["teams"] = s.Teams
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
	a.Sessions.Issue(w, u)
	writeJSON(w, 200, u)
}

func (a *api) callback(w http.ResponseWriter, r *http.Request) {
	u, err := a.OIDC.Callback(w, r)
	if err != nil {
		a.Log.Warn("sign-in failed", "error", err)
		http.Redirect(w, r, a.Cfg.BaseURL+"/?signin_error="+url.QueryEscape(err.Error()), http.StatusFound)
		return
	}
	a.Sessions.Issue(w, u)
	a.Log.Info("signed in", "email", u.Email)
	http.Redirect(w, r, a.Cfg.BaseURL+"/", http.StatusFound)
}

func (a *api) logout(w http.ResponseWriter, _ *http.Request) {
	a.Sessions.Clear(w)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---------- content files

func (a *api) listProcesses(w http.ResponseWriter, r *http.Request) {
	list, broken, err := a.Content.Processes()
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]any{"processes": list, "broken": broken})
}

func (a *api) getCatalog(w http.ResponseWriter, r *http.Request) {
	cat, err := a.Content.Catalog()
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, cat)
}

// mayWrite answers for content changes. Content lives in the repository; the app may only
// write it where that is switched on (local development), and only for editors.
func (a *api) mayWrite(w http.ResponseWriter, r *http.Request) bool {
	if !a.Cfg.ContentWritable {
		writeError(w, 403, "Processes are read-only here. Change them through the repository.")
		return false
	}
	if !who(r).Editor {
		writeError(w, 403, "Only editors can change processes and lists.")
		return false
	}
	return true
}

func (a *api) putProcess(w http.ResponseWriter, r *http.Request) {
	if !a.mayWrite(w, r) {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err == nil {
		err = a.Content.PutProcess(r.PathValue("id"), body)
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *api) deleteProcess(w http.ResponseWriter, r *http.Request) {
	if !a.mayWrite(w, r) {
		return
	}
	id := r.PathValue("id")
	err := a.Content.DeleteProcess(id)
	if err == nil {
		err = a.Feedback.DeleteByProcess(r.Context(), id)
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (a *api) putCatalog(w http.ResponseWriter, r *http.Request) {
	if !a.mayWrite(w, r) {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err == nil {
		err = a.Content.PutCatalog(body)
	}
	if err != nil {
		a.fail(w, r, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---------- feedback

type author struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// itemView is a feedback item as one particular user sees it.
type itemView struct {
	ID          string     `json:"id"`
	ProcessID   string     `json:"processId"`
	StepID      string     `json:"stepId,omitempty"`
	Kind        string     `json:"kind"`
	Text        string     `json:"text"`
	Author      author     `json:"author"`
	CreatedAt   time.Time  `json:"createdAt"`
	Resolved    bool       `json:"resolved"`
	ResolvedAt  *time.Time `json:"resolvedAt,omitempty"`
	ResolvedBy  string     `json:"resolvedBy,omitempty"`
	AlsoHit     int        `json:"alsoHit"`
	AlsoHitByMe bool       `json:"alsoHitByMe"`
	Stale       bool       `json:"stale"`     // the step changed or disappeared since this was written
	Mine        bool       `json:"mine"`      // written by the current user
	CanManage   bool       `json:"canManage"` // the current user may mark it fixed or delete it
}

// viewer turns stored items into views, reading each process file at most once.
type viewer struct {
	a     *api
	s     session
	infos map[string]*content.Info
}

func (a *api) viewer(s session) *viewer {
	return &viewer{a: a, s: s, infos: map[string]*content.Info{}}
}

func (v *viewer) info(processID string) *content.Info {
	if cached, ok := v.infos[processID]; ok {
		return cached
	}
	var out *content.Info
	if info, ok := v.a.Content.Info(processID); ok {
		out = &info
	}
	v.infos[processID] = out
	return out
}

// canManage: editors everywhere, and members of the team that owns the process.
func (v *viewer) canManage(processID string) bool {
	if v.s.Editor {
		return true
	}
	info := v.info(processID)
	return info != nil && v.s.MemberOf(info.Owner)
}

func (v *viewer) view(it feedback.Item) itemView {
	out := itemView{
		ID: it.ID, ProcessID: it.ProcessID, StepID: it.StepID, Kind: it.Kind, Text: it.Text,
		Author: author{it.AuthorName, it.AuthorEmail}, CreatedAt: it.CreatedAt,
		Resolved: it.ResolvedAt != nil, ResolvedAt: it.ResolvedAt, ResolvedBy: it.ResolvedBy,
		AlsoHit: len(it.AlsoHit), Mine: strings.EqualFold(it.AuthorEmail, v.s.Email), CanManage: v.canManage(it.ProcessID),
	}
	for _, e := range it.AlsoHit {
		if strings.EqualFold(e, v.s.Email) {
			out.AlsoHitByMe = true
		}
	}
	if it.StepID != "" && it.StepHash != "" && it.ResolvedAt == nil {
		info := v.info(it.ProcessID)
		out.Stale = info == nil || info.Steps[it.StepID] != it.StepHash
	}
	return out
}

func (a *api) listFeedback(w http.ResponseWriter, r *http.Request) {
	items, err := a.Feedback.List(r.Context())
	if err != nil {
		a.fail(w, r, err)
		return
	}
	v := a.viewer(who(r))
	out := map[string][]itemView{}
	for _, it := range items {
		out[it.ProcessID] = append(out[it.ProcessID], v.view(it))
	}
	writeJSON(w, 200, out)
}

func (a *api) createFeedback(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ProcessID string `json:"processId"`
		StepID    string `json:"stepId"`
		Kind      string `json:"kind"`
		Text      string `json:"text"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	s := who(r)
	v := a.viewer(s)
	info := v.info(in.ProcessID)
	switch {
	case info == nil:
		writeError(w, 400, "That process does not exist.")
		return
	case in.StepID != "" && info.Steps[in.StepID] == "":
		writeError(w, 400, "That step does not exist in this process.")
		return
	case !feedback.ValidKind(in.Kind):
		writeError(w, 400, "Choose what kind of feedback this is: "+strings.Join(feedback.Kinds, ", ")+".")
		return
	case utf8.RuneCountInString(in.Text) < 3:
		writeError(w, 400, "Say in a sentence what happened.")
		return
	case utf8.RuneCountInString(in.Text) > 2000:
		writeError(w, 400, "Keep the feedback under 2000 characters.")
		return
	}
	item, err := a.Feedback.Create(r.Context(), feedback.New{
		ProcessID: in.ProcessID, StepID: in.StepID, Kind: in.Kind, Text: in.Text,
		AuthorEmail: s.Email, AuthorName: s.Name, StepHash: info.Steps[in.StepID],
	})
	if err != nil {
		a.fail(w, r, err)
		return
	}
	e := a.event("feedback.created", item, info, s.Name)
	e.To = "the process owner"
	if team, ok := a.Content.Team(info.Owner); ok {
		e.To, e.Contact = team.Name, team.Contact
	}
	a.Notifier.Notify(r.Context(), e)
	writeJSON(w, 201, v.view(item))
}

func (a *api) event(kind string, it feedback.Item, info *content.Info, actor string) notify.Event {
	e := notify.Event{Type: kind, ProcessID: it.ProcessID, Kind: it.Kind, Text: it.Text, Author: it.AuthorName, Actor: actor,
		URL: a.Cfg.BaseURL + "/#/p/" + it.ProcessID + "/feedback"}
	if info != nil {
		e.ProcessTitle = info.Title
		e.StepTitle = info.Titles[it.StepID]
	}
	return e
}

func (a *api) alsoHit(on bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s := who(r)
		it, err := a.Feedback.Get(r.Context(), r.PathValue("id"))
		if err == nil && strings.EqualFold(it.AuthorEmail, s.Email) {
			writeError(w, 400, "You reported this yourself.")
			return
		}
		if err == nil {
			it, err = a.Feedback.SetAlsoHit(r.Context(), it.ID, s.Email, on)
		}
		if err != nil {
			a.fail(w, r, err)
			return
		}
		writeJSON(w, 200, a.viewer(s).view(it))
	}
}

func (a *api) resolveFeedback(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Resolved *bool `json:"resolved"`
	}
	if err := readJSON(r, &in); err != nil {
		a.fail(w, r, err)
		return
	}
	if in.Resolved == nil {
		writeError(w, 400, `Send {"resolved": true} or {"resolved": false}.`)
		return
	}
	s := who(r)
	v := a.viewer(s)
	it, err := a.Feedback.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if !v.canManage(it.ProcessID) {
		writeError(w, 403, "Only editors and the team that owns this process can do that.")
		return
	}
	wasOpen := it.ResolvedAt == nil
	it, err = a.Feedback.SetResolved(r.Context(), it.ID, *in.Resolved, s.Name)
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if *in.Resolved && wasOpen && !strings.EqualFold(it.AuthorEmail, s.Email) {
		e := a.event("feedback.resolved", it, v.info(it.ProcessID), s.Name)
		e.To = it.AuthorEmail
		a.Notifier.Notify(r.Context(), e)
	}
	writeJSON(w, 200, v.view(it))
}

func (a *api) deleteFeedback(w http.ResponseWriter, r *http.Request) {
	s := who(r)
	it, err := a.Feedback.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		a.fail(w, r, err)
		return
	}
	if !strings.EqualFold(it.AuthorEmail, s.Email) && !a.viewer(s).canManage(it.ProcessID) {
		writeError(w, 403, "You can only delete your own feedback.")
		return
	}
	if err := a.Feedback.Delete(r.Context(), it.ID); err != nil {
		a.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
		// the app routes on the hash, so every other path is the app itself
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, index)
	})
}
