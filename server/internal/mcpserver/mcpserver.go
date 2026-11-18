// Package mcpserver gives AI agents the portal's processes, standards and lists over the Model
// Context Protocol (streamable HTTP). It reads the same database as the portal and shows only
// what is published: a draft is, for an agent, something that does not exist.
//
// Until agents sign in through a gateway, two rules stand in for sign-in: without a shared
// secret the server only answers calls from this machine; with one, every call must carry it.
// An agent may say whom it acts for (X-PM-Person) only together with the secret; only then can
// it report a problem, which is stored as feedback of that person.
package mcpserver

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"slices"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/notify"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// Name is how the server introduces itself to agents.
const Name = "process-manager"

// Headers an agent sends.
const (
	HeaderPerson     = "X-PM-Person"      // email of the person the agent acts for
	HeaderPersonName = "X-PM-Person-Name" // optional: their name as feedback shows it
)

// MinSecret is the shortest shared secret accepted.
const MinSecret = 32

// Index is search by meaning, as far as this server needs it. The portal's retrieval index is
// adapted to it in the command; nil or disabled means search by words only.
type Index interface {
	Enabled() bool
	// Search returns published processes and standards, best first, at most limit of them.
	// truncated says that more matched than were returned.
	Search(ctx context.Context, query string, limit int) (found []Found, truncated bool, err error)
}

// Errors an Index returns so that the agent is told why it gets a word match instead.
var (
	// ErrIndexNotReady: the portal server has not built the index with these settings yet.
	ErrIndexNotReady = errors.New("the search index is not built yet")
	// ErrIndexProvider: the embeddings provider could not be reached.
	ErrIndexProvider = errors.New("the embeddings provider could not be reached")
)

// Found is one document the index found, with the parts that matched best first.
type Found struct {
	Kind, ID string
	Score    float64
	Hits     []FoundHit
}

// FoundHit is one part of a document the index found.
type FoundHit struct {
	Part, Item, Label, Snippet string
	Score                      float64
}

// Options are what the server reads from and writes to.
type Options struct {
	Docs     *docs.Store
	Skills   *skills.Store
	Feedback *feedback.Store
	Roles    *rbac.Store
	Index    Index           // nil: search by words only
	Notifier notify.Notifier // nil: notifications are only logged
	Ready    func(context.Context) error
	BaseURL  string // the portal's address, for links; empty: no links
	Secret   string // shared secret; empty: calls from this machine only
	Version  string // the server's version as agents see it
	Log      *slog.Logger
	Now      func() time.Time // what "today" is for the review state; tests
	// EmailDomains, when set, are the only domains whose people an agent may act for: the
	// domains of the portal's sign-in (PM_ALLOWED_EMAIL_DOMAINS, PM_GOOGLE_HOSTED_DOMAIN).
	EmailDomains []string
	// CallTimeout bounds every tool call; 0 means DefaultCallTimeout. It must be shorter than
	// the HTTP server's write timeout, so that every call gets an answer.
	CallTimeout time.Duration
	// MeaningTimeout is how long search by meaning may take before the words take over; 0
	// means DefaultMeaningTimeout.
	MeaningTimeout time.Duration
	// SearchesPerMinute is the brake on searches that use the embeddings provider, per caller;
	// 0 means DefaultSearchesPerMinute.
	SearchesPerMinute int
}

// Defaults of the Options.
const (
	DefaultCallTimeout       = 45 * time.Second
	DefaultMeaningTimeout    = 5 * time.Second
	DefaultSearchesPerMinute = 60
)

// Server answers MCP calls.
type Server struct {
	o        Options
	readOnly *mcp.Server // without report_problem
	acting   *mcp.Server // with report_problem: a person was named together with the secret
	handler  http.Handler
	brake    *brake       // searches that use the embeddings provider, per caller
	notReady atomic.Bool  // "the index is not built yet" was logged once
	sdkLog   *slog.Logger // the SDK's own messages, one level lower
}

// CheckSecret says, in plain words, why a shared secret cannot be used; "" when it can.
func CheckSecret(secret string) string {
	if secret == "" {
		return ""
	}
	if len(secret) < MinSecret {
		return fmt.Sprintf("PM_MCP_SECRET must be at least %d characters", MinSecret)
	}
	if weakSecret(secret) {
		return "PM_MCP_SECRET is a placeholder or too simple: use a long random value, e.g. from `openssl rand -base64 48`"
	}
	for _, r := range secret {
		if r <= ' ' || r == 0x7f || r > '~' {
			return "PM_MCP_SECRET may only contain visible ASCII characters, without spaces"
		}
	}
	return ""
}

// weakSecret catches example values and text that is obviously not random.
func weakSecret(secret string) bool {
	lower := strings.ToLower(secret)
	for _, hint := range []string{"change-me", "changeme", "replace-me", "your-secret", "example", "placeholder", "secret-here", "xxxxxxxx"} {
		if strings.Contains(lower, hint) {
			return true
		}
	}
	distinct := map[rune]bool{}
	for _, r := range secret {
		distinct[r] = true
	}
	return len(distinct) < 10
}

// CheckListen says why the server may not listen on addr with this secret; "" when it may.
// Without a secret only this machine may reach it.
func CheckListen(addr, secret string) string {
	if problem := CheckSecret(secret); problem != "" {
		return problem
	}
	if secret == "" && !Loopback(addr) {
		return fmt.Sprintf("PM_MCP_ADDR=%s can be reached from other machines, and nobody signs in to this server: without PM_MCP_SECRET it only listens on this machine (e.g. 127.0.0.1:8081). Set PM_MCP_SECRET to a long random value to listen there", addr)
	}
	return ""
}

// Loopback reports whether a host or host:port only reaches this machine.
func Loopback(addr string) bool {
	host := addr
	if h, _, err := net.SplitHostPort(addr); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// New builds the server. The secret must have passed CheckSecret.
func New(o Options) (*Server, error) {
	if problem := CheckSecret(o.Secret); problem != "" {
		return nil, fmt.Errorf("%s", problem)
	}
	if o.Log == nil {
		o.Log = slog.New(slog.DiscardHandler)
	}
	if o.Notifier == nil {
		o.Notifier = notify.Log{Logger: o.Log}
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Version == "" {
		o.Version = "1"
	}
	if o.CallTimeout <= 0 {
		o.CallTimeout = DefaultCallTimeout
	}
	if o.MeaningTimeout <= 0 {
		o.MeaningTimeout = DefaultMeaningTimeout
	}
	if o.SearchesPerMinute <= 0 {
		o.SearchesPerMinute = DefaultSearchesPerMinute
	}
	for i, d := range o.EmailDomains {
		o.EmailDomains[i] = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(d), "@"))
	}
	o.BaseURL = strings.TrimRight(o.BaseURL, "/")
	s := &Server{o: o, brake: newBrake(o.SearchesPerMinute, time.Minute), sdkLog: slog.New(quieter{o.Log.Handler()})}
	cache := mcp.NewSchemaCache()
	s.readOnly = s.newMCP(false, cache)
	s.acting = s.newMCP(true, cache)
	mcpHandler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		if s.person(r.Header).Email != "" {
			return s.acting
		}
		return s.readOnly
	}, &mcp.StreamableHTTPOptions{
		// Every request stands on its own: whom an agent acts for is read from each request, and
		// nothing is kept between calls.
		Stateless:           true,
		Logger:              s.sdkLog,
		MaxRequestBodyBytes: 1 << 20,
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.healthz)
	mux.Handle("/mcp", s.guard(mcpHandler))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "Not found. The MCP endpoint is /mcp.", http.StatusNotFound)
	})
	s.handler = mux
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.handler.ServeHTTP(w, r) }

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.o.Ready != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := s.o.Ready(ctx); err != nil {
			http.Error(w, "The database cannot be reached.", http.StatusServiceUnavailable)
			return
		}
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok\n"))
}

// guard applies the two rules that stand in for sign-in, and checks whom the agent acts for.
func (s *Server) guard(next http.Handler) http.Handler {
	want := sha256.Sum256([]byte(s.o.Secret))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if s.o.Secret == "" {
			// the listener is on this machine already; a call from elsewhere (a proxy in front)
			// is still refused
			if !Loopback(r.RemoteAddr) {
				http.Error(w, "This server only answers calls from this machine.", http.StatusForbidden)
				return
			}
			// without the secret nobody can say whom the agent acts for
			r.Header.Del(HeaderPerson)
			r.Header.Del(HeaderPersonName)
			next.ServeHTTP(w, s.withCaller(r))
			return
		}
		// the scheme is case-insensitive (RFC 9110): "Bearer", "bearer" and "BEARER" alike
		scheme, token, _ := strings.Cut(strings.TrimSpace(r.Header.Get("Authorization")), " ")
		ok := strings.EqualFold(scheme, "Bearer")
		got := sha256.Sum256([]byte(strings.TrimSpace(token)))
		// both sides are hashed first, so the comparison takes as long whatever was sent
		if subtle.ConstantTimeCompare(got[:], want[:]) != 1 || !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="process-manager"`)
			http.Error(w, "A valid shared secret is required: send it as “Authorization: Bearer <secret>”.", http.StatusUnauthorized)
			return
		}
		if r.Header.Get(HeaderPerson) != "" || r.Header.Get(HeaderPersonName) != "" {
			if problem := s.checkPerson(r.Header); problem != "" {
				http.Error(w, problem, http.StatusBadRequest)
				return
			}
		}
		next.ServeHTTP(w, s.withCaller(r))
	})
}

// headerCaller carries the address of the caller from the guard to the tools (the SDK hands
// the tools the request's headers, not the request). What a client sends under that name is
// replaced.
const headerCaller = "X-Pm-Internal-Caller"

func (s *Server) withCaller(r *http.Request) *http.Request {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	r.Header.Set(headerCaller, host)
	return r
}

// actor is the person an agent acts for.
type actor struct{ Email, Name string }

// maxPersonName is the longest name of a person that is used; a longer one gives way to the
// part of the email before the @.
const maxPersonName = 60

// checkPerson says why the person an agent names cannot be accepted; "" when they can. The name
// never refuses a call: one that cannot be used gives way to the part of the email before the @.
func (s *Server) checkPerson(h http.Header) string {
	email := strings.TrimSpace(h.Get(HeaderPerson))
	if email == "" {
		return HeaderPerson + " is missing: " + HeaderPersonName + " only goes with it."
	}
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email || a.Name != "" || len(email) > 254 || !strings.Contains(email[strings.LastIndex(email, "@")+1:], ".") {
		return HeaderPerson + " must be the email address of the person the agent acts for, e.g. sam@example.com."
	}
	if len(s.o.EmailDomains) > 0 {
		domain := strings.ToLower(email[strings.LastIndex(email, "@")+1:])
		if !slices.Contains(s.o.EmailDomains, domain) {
			return HeaderPerson + " must be an address of " + strings.Join(s.o.EmailDomains, ", ") + ": only people who can sign in to the portal can be acted for."
		}
	}
	return ""
}

// person is whom the request acts for: only with the secret configured (the guard has checked
// that it was presented and the headers are valid). The zero actor otherwise.
func (s *Server) person(h http.Header) actor {
	if s.o.Secret == "" || h == nil || s.checkPerson(h) != "" {
		return actor{}
	}
	email := strings.ToLower(strings.TrimSpace(h.Get(HeaderPerson)))
	return actor{Email: email, Name: personName(h.Get(HeaderPersonName), email)}
}

// personName is the name as the agent gave it when it can be stored and shown as it is (one
// line, no control or direction characters, at most maxPersonName characters); otherwise the
// part of the email before the @.
func personName(name, email string) string {
	clean, problem := docs.CheckText(name, "The name", false)
	if problem != "" || clean == "" || utf8.RuneCountInString(clean) > maxPersonName {
		return email[:strings.LastIndex(email, "@")]
	}
	return clean
}

// quieter passes the SDK's messages on one level lower: a line per connection at INFO would
// drown what matters. Warnings stay warnings.
type quieter struct{ h slog.Handler }

func (q quieter) Enabled(ctx context.Context, l slog.Level) bool {
	return q.h.Enabled(ctx, lower(l))
}
func (q quieter) Handle(ctx context.Context, r slog.Record) error {
	r.Level = lower(r.Level)
	return q.h.Handle(ctx, r)
}
func (q quieter) WithAttrs(a []slog.Attr) slog.Handler { return quieter{q.h.WithAttrs(a)} }
func (q quieter) WithGroup(n string) slog.Handler      { return quieter{q.h.WithGroup(n)} }

func lower(l slog.Level) slog.Level {
	if l < slog.LevelWarn {
		return slog.LevelDebug
	}
	return l
}

// instructions is what every agent is told when it connects: the rules from docs/mcp.md.
const instructions = `Process Manager holds the company's processes (how to get something done, e.g. request a GCP project) and standards (rules that code and infrastructure must meet). Rules:
- Find with search_processes / search_standards, then read with get_process / get_standard / get_my_steps. Ids come from search results.
- actors[0] of a process is always "me": the person you act for. Only do steps of "me" that are not approvals (agentMayDo: true). Approvals and steps of other actors are not yours: wait for them and tell the person.
- A step with subProcess is described by another process: read it with get_process.
- A process with rigour "mandatory" is the only allowed way to get its result: do not look for another.
- A requirement of level "must" cannot be waived by you. If it cannot be met, stop and tell the person; exceptions go through the standard's exceptionProcess.
- A requirement or document with tiers, environments or languages applies only there; empty means everywhere. Pass tier/environment/language to get only what applies.
- status "deprecated" (retired: true) means do not follow it; use replacedBy when given. Drafts are never returned.
- review.overdue: true means the owner has not confirmed it is still correct. It is still valid; warn the person.
- Every answer names the version of the document; cite it.
- report_problem (only offered when you act for a named person) files feedback for the owning team, as the person would in the portal.`

func (s *Server) newMCP(acting bool, cache *mcp.SchemaCache) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: Name, Title: "Process Manager", Version: s.o.Version}, &mcp.ServerOptions{
		Instructions: instructions,
		Logger:       s.sdkLog,
		SchemaCache:  cache,
	})
	s.addTools(srv)
	if acting {
		s.addReport(srv)
	}
	return srv
}
