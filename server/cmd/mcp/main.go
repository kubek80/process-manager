// Command mcp gives AI agents the portal's processes, standards and lists over the Model
// Context Protocol (streamable HTTP, POST /mcp). It reads the portal's database with the
// portal's settings and changes nothing in it but feedback: it never creates or upgrades tables
// and refuses to start on a database the portal server has not prepared.
//
// Settings (environment variables):
//
//	DATABASE_URL           the portal's database (required)
//	PM_MCP_ADDR            where to listen; default 127.0.0.1:8081
//	PM_MCP_SECRET          a shared secret of at least 32 characters; every call must then carry
//	                       "Authorization: Bearer <secret>". Without it only this machine may connect.
//	PM_BASE_URL            the portal's address, for links in answers and notifications
//	PM_NOTIFY, PM_NOTIFY_WEBHOOK_URL   how owners hear about reported problems (as the portal)
//	PM_EMBEDDINGS and the other settings of search by meaning (as the portal)
//	PM_LOG_FORMAT          text or json
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/mcpserver"
	"github.com/kubek80/process-manager/server/internal/notify"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/retrieval"
	"github.com/kubek80/process-manager/server/internal/skills"
)

// version is what agents see as the server's version.
const version = "1.0.0"

func main() {
	var handler slog.Handler = slog.NewTextHandler(os.Stderr, nil)
	if os.Getenv("PM_LOG_FORMAT") == "json" {
		handler = slog.NewJSONHandler(os.Stderr, nil)
	}
	log := slog.New(handler)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Getenv, log, nil); err != nil {
		log.Error("stopped", "error", err)
		os.Exit(1)
	}
}

// settings are what this command reads from the environment.
type settings struct {
	DatabaseURL string
	// EmailDomains are the domains of the portal's sign-in: only their people can be acted for.
	EmailDomains []string
	Addr         string
	Secret       string
	BaseURL      string
	Notify       string
	WebhookURL   string
	Embeddings   config.Embeddings
}

func loadSettings(getenv func(string) string) (settings, error) {
	get := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	s := settings{
		DatabaseURL: get("DATABASE_URL", ""),
		Addr:        get("PM_MCP_ADDR", "127.0.0.1:8081"),
		Secret:      get("PM_MCP_SECRET", ""),
		BaseURL:     strings.TrimRight(get("PM_BASE_URL", "http://localhost:5173"), "/"),
		Notify:      get("PM_NOTIFY", "log"),
		WebhookURL:  get("PM_NOTIFY_WEBHOOK_URL", ""),
	}
	// the same settings the portal's sign-in reads (config.Load): PM_ALLOWED_EMAIL_DOMAINS, and
	// for Google sign-in the Workspace domain
	for _, d := range strings.Split(get("PM_ALLOWED_EMAIL_DOMAINS", "")+","+get("PM_GOOGLE_HOSTED_DOMAIN", ""), ",") {
		if d = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(d), "@")); d != "" && !slices.Contains(s.EmailDomains, d) {
			s.EmailDomains = append(s.EmailDomains, d)
		}
	}
	var problems []string
	if s.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required: the database of the portal")
	}
	if _, _, err := net.SplitHostPort(s.Addr); err != nil {
		problems = append(problems, fmt.Sprintf("PM_MCP_ADDR=%q must be a host and port, e.g. 127.0.0.1:8081", s.Addr))
	} else if problem := mcpserver.CheckListen(s.Addr, s.Secret); problem != "" {
		problems = append(problems, problem)
	}
	switch s.Notify {
	case "log":
	case "webhook":
		if s.WebhookURL == "" {
			problems = append(problems, "PM_NOTIFY_WEBHOOK_URL is required when PM_NOTIFY=webhook")
		}
	default:
		problems = append(problems, fmt.Sprintf("PM_NOTIFY=%q is not supported: use log or webhook", s.Notify))
	}
	emb, err := config.LoadEmbeddings(getenv)
	if err != nil {
		problems = append(problems, err.Error())
	}
	s.Embeddings = emb
	if len(problems) > 0 {
		return s, errors.New(strings.Join(problems, "; "))
	}
	return s, nil
}

// checkDatabase makes sure the portal server has prepared the database: this command neither
// creates nor upgrades tables.
func checkDatabase(ctx context.Context, pool *pgxpool.Pool) error {
	if err := db.Current(ctx, pool); err != nil {
		if errors.Is(err, db.ErrBehind) {
			return fmt.Errorf("the database is not ready for this version of the portal (%w)", err)
		}
		return fmt.Errorf("the database cannot be read: %w", err)
	}
	return nil
}

// connect waits a little for a database that is still starting.
func connect(ctx context.Context, url string, log *slog.Logger) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("database address: %w", err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		if err = pool.Ping(ctx); err == nil {
			return pool, nil
		}
		if time.Now().After(deadline) {
			pool.Close()
			return nil, fmt.Errorf("database not reachable: %w", err)
		}
		log.Info("waiting for the database")
		select {
		case <-ctx.Done():
			pool.Close()
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// meaning adapts the portal's search index to what the MCP server needs.
type meaning struct{ ix *retrieval.Index }

func (m meaning) Enabled() bool { return m.ix.Enabled() }

func (m meaning) Search(ctx context.Context, query string, limit int) ([]mcpserver.Found, bool, error) {
	page, err := m.ix.SearchPage(ctx, query, limit)
	results := page.Results
	switch {
	case errors.Is(err, retrieval.ErrNotSetUp):
		return nil, false, fmt.Errorf("%w: %v", mcpserver.ErrIndexNotReady, err)
	case errors.Is(err, retrieval.ErrProvider):
		return nil, false, fmt.Errorf("%w: %v", mcpserver.ErrIndexProvider, err)
	case err != nil:
		return nil, false, err
	}
	truncated := page.Truncated
	out := make([]mcpserver.Found, 0, len(results))
	for _, r := range results {
		if r.Status != "active" { // the search tools return active documents only (the server checks again)
			continue
		}
		f := mcpserver.Found{Kind: r.Kind, ID: r.ID, Score: r.Score}
		for _, h := range r.Hits {
			f.Hits = append(f.Hits, mcpserver.FoundHit{Part: h.Part, Item: h.Item, Label: h.Label, Snippet: h.Snippet, Score: h.Score})
		}
		out = append(out, f)
	}
	return out, truncated, nil
}

// shutdownGrace is how long calls being answered get to finish when asked to stop.
const shutdownGrace = 10 * time.Second

// run serves until ctx ends. listening, when given, is told the address once the server listens.
func run(ctx context.Context, getenv func(string) string, log *slog.Logger, listening func(addr string)) error {
	s, err := loadSettings(getenv)
	if err != nil {
		return fmt.Errorf("configuration: %w", err)
	}
	pool, err := connect(ctx, s.DatabaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := checkDatabase(ctx, pool); err != nil {
		return err
	}

	store := &docs.Store{Pool: pool}
	var index *retrieval.Index
	if s.Embeddings.On() {
		e, err := embedding.New(ctx, s.Embeddings.EmbeddingOptions())
		if err != nil {
			return fmt.Errorf("search by meaning: %w", err)
		}
		index = retrieval.New(pool, store, e, s.Embeddings.ChunkOptions(), log)
		index.SetMinScore(s.Embeddings.MinScore) // -1: the provider's own floor
		// the portal server builds the index; this command only reads it (never Ensure or CatchUp)
		if err := index.Ready(ctx); err != nil {
			reason := strings.TrimPrefix(err.Error(), retrieval.ErrNotSetUp.Error()+": ")
			log.Warn("search by meaning is not ready, so agents search by words until the portal server has the index ready: " + reason)
		}
	}
	var notifier notify.Notifier = notify.Log{Logger: log}
	var hook *notify.Webhook
	if s.Notify == "webhook" {
		hook = notify.NewWebhook(s.WebhookURL, log)
		notifier = hook
	}
	srv, err := mcpserver.New(mcpserver.Options{
		Docs: store, Skills: &skills.Store{Pool: pool}, Feedback: &feedback.Store{Pool: pool}, Roles: &rbac.Store{Pool: pool},
		Index: meaning{index}, Notifier: notifier, Ready: pool.Ping, BaseURL: s.BaseURL, Secret: s.Secret, Version: version, Log: log,
		EmailDomains: s.EmailDomains, CallTimeout: mcpserver.DefaultCallTimeout,
	})
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", s.Addr)
	if err != nil {
		return err
	}
	httpSrv := &http.Server{
		Handler: srv,
		// a client that sends or reads slowly cannot hold a connection open for ever
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: mcpserver.DefaultCallTimeout + 15*time.Second, IdleTimeout: 2 * time.Minute,
	}
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		<-ctx.Done()
		grace, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()
		if err := httpSrv.Shutdown(grace); err != nil {
			log.Error("some calls were cut off while stopping", "error", err)
		}
		if hook != nil {
			hook.Wait()
		}
	}()

	addr := ln.Addr().String()
	secret := "not required: only this machine can connect"
	if s.Secret != "" {
		secret = "required: every call must carry it; agents may name the person they act for and report problems"
	}
	search, outside := "off: agents search by words", "no"
	if index.Enabled() {
		search = "on (" + index.Provider() + ")"
		if index.Outside() {
			outside = "yes: every search query of an agent is sent to the embeddings provider (" + index.Provider() + ")"
		}
	}
	log.Info("MCP server listening", "address", "http://"+addr+"/mcp", "shared secret", secret, "search by meaning", search, "text leaves the company", outside)
	if index.Outside() {
		log.Warn("search queries of agents leave the company: they are sent to " + index.Provider() + " to be turned into vectors")
	}
	if listening != nil {
		listening(addr)
	}
	if err := httpSrv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-stopped
	log.Info("stopped")
	return nil
}
