// Command server runs the Process Manager backend.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/content"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/httpapi"
	"github.com/kubek80/process-manager/server/internal/notify"
)

func main() {
	seed := flag.Bool("seed", false, "add sample feedback when the database is empty (local development)")
	reset := flag.Bool("reset", false, "delete all feedback, then exit (combine with -seed to refill)")
	flag.Parse()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(log, *seed, *reset); err != nil {
		log.Error("stopped", "error", err)
		os.Exit(1)
	}
}

// connect waits for the database, which may still be starting (docker compose).
func connect(ctx context.Context, url string, log *slog.Logger) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("database address: %w", err)
	}
	deadline := time.Now().Add(30 * time.Second)
	for {
		err = pool.Ping(ctx)
		if err == nil {
			return pool, nil
		}
		if time.Now().After(deadline) {
			pool.Close()
			return nil, fmt.Errorf("database not reachable: %w", err)
		}
		log.Info("waiting for the database")
		time.Sleep(time.Second)
	}
}

func run(log *slog.Logger, seed, reset bool) error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return fmt.Errorf("configuration: %w", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := connect(ctx, cfg.DatabaseURL, log)
	if err != nil {
		return err
	}
	defer pool.Close()
	store := &feedback.Store{Pool: pool}
	if err := store.Migrate(ctx); err != nil {
		return fmt.Errorf("database setup: %w", err)
	}
	files := &content.Store{Dir: cfg.ContentDir}

	if reset {
		if err := store.Reset(ctx); err != nil {
			return err
		}
		log.Info("all feedback deleted")
	}
	if seed {
		if err := seedFeedback(ctx, store, files, log); err != nil {
			return err
		}
	}
	if reset {
		return nil
	}

	sessions := auth.NewSessions(cfg.SessionSecret, cfg.Secure())
	deps := httpapi.Deps{Cfg: cfg, Sessions: sessions, Content: files, Feedback: store, Log: log, Notifier: notify.Log{Logger: log}}
	if cfg.Notify == "webhook" {
		deps.Notifier = notify.NewWebhook(cfg.WebhookURL, log)
	}
	if cfg.Auth == config.AuthDev {
		log.Warn("PM_AUTH=dev: anyone who can reach this server can sign in as any built-in user. Never use this outside local development.")
	} else {
		deps.OIDC, err = auth.NewOIDC(ctx, sessions, cfg.Issuer, cfg.ClientID, cfg.ClientSecret, cfg.BaseURL+"/auth/callback", cfg.HostedDomain)
		if err != nil {
			return err
		}
	}

	srv := &http.Server{Addr: cfg.Addr, Handler: httpapi.New(deps), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Info("listening", "addr", cfg.Addr, "auth", cfg.Auth, "content", cfg.ContentDir, "writable", cfg.ContentWritable)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// seedFeedback gives a fresh local database something to look at.
func seedFeedback(ctx context.Context, store *feedback.Store, files *content.Store, log *slog.Logger) error {
	n, err := store.Count(ctx)
	if err != nil || n > 0 {
		return err
	}
	samples := []feedback.New{
		{ProcessID: "request-gcp-project", StepID: "raise-request", Kind: "outdated", Text: "The catalogue item is now called “Cloud project (GCP)”.", AuthorEmail: "sam@example.com", AuthorName: "Sam Consumer"},
		{ProcessID: "onboard-site-to-akamai", Kind: "idea", Text: "A checklist of the DNS records to prepare would save a round trip with the DNS team.", AuthorEmail: "sam@example.com", AuthorName: "Sam Consumer"},
	}
	added := 0
	for _, s := range samples {
		info, ok := files.Info(s.ProcessID)
		if !ok || (s.StepID != "" && info.Steps[s.StepID] == "") {
			continue
		}
		s.StepHash = info.Steps[s.StepID]
		if _, err := store.Create(ctx, s); err != nil {
			return err
		}
		added++
	}
	log.Info("sample feedback added", "items", added)
	return nil
}
