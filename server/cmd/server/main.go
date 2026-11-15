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

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/httpapi"
	"github.com/kubek80/process-manager/server/internal/notify"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/schema"
	"github.com/kubek80/process-manager/server/internal/skills"
)

type options struct {
	seed      bool   // add sample feedback when there is none
	reset     bool   // delete all feedback, then exit
	importDir string // load files into the database, then exit
	exportDir string // write the database to files, then exit
}

func main() {
	var o options
	flag.BoolVar(&o.seed, "seed", false, "add sample feedback when the database has none (local development)")
	flag.BoolVar(&o.reset, "reset", false, "delete all feedback, then exit (combine with -seed to refill)")
	flag.StringVar(&o.importDir, "import", "", "load processes/, standards/ and catalog/ from this folder into the database, then exit")
	flag.StringVar(&o.exportDir, "export", "", "write processes, standards, lists and generated skills to this folder, then exit")
	flag.Parse()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(log, o); err != nil {
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

type stores struct {
	docs     *docs.Store
	roles    *rbac.Store
	skills   *skills.Store
	feedback *feedback.Store
	audit    *audit.Log
}

func run(log *slog.Logger, o options) error {
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
	if err := db.Migrate(ctx, pool); err != nil {
		return fmt.Errorf("database setup: %w", err)
	}
	st := stores{
		docs: &docs.Store{Pool: pool}, roles: &rbac.Store{Pool: pool, Bootstrap: cfg.Admins},
		skills: &skills.Store{Pool: pool}, feedback: &feedback.Store{Pool: pool}, audit: &audit.Log{Pool: pool},
	}

	// one-off commands
	if o.importDir != "" {
		if err := importFiles(ctx, st, o.importDir, log); err != nil {
			return err
		}
		return st.skills.SyncAll(ctx, st.docs)
	}
	if o.exportDir != "" {
		return exportFiles(ctx, st, o.exportDir, log)
	}
	if o.reset {
		if err := st.feedback.Reset(ctx); err != nil {
			return err
		}
		log.Info("all feedback deleted")
	}

	if err := prepare(ctx, cfg, st, log); err != nil {
		return err
	}
	if o.seed {
		if err := seedFeedback(ctx, st, log); err != nil {
			return err
		}
	}
	if o.reset {
		return nil
	}

	schemas, err := schema.Load(cfg.SchemaDir)
	if err != nil {
		return err
	}
	sessions := auth.NewSessions(cfg.SessionSecret, cfg.Secure())
	deps := httpapi.Deps{Cfg: cfg, Sessions: sessions, Docs: st.docs, Schemas: schemas, Roles: st.roles, Audit: st.audit,
		Skills: st.skills, Feedback: st.feedback, Log: log, Notifier: notify.Log{Logger: log}}
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
	log.Info("listening", "addr", cfg.Addr, "auth", cfg.Auth, "admins", len(cfg.Admins))
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// prepare makes a database usable: an empty one is filled from the seed folder, development
// users get their roles, and the generated skills are brought up to date.
func prepare(ctx context.Context, cfg config.Config, st stores, log *slog.Logger) error {
	n, err := st.docs.Count(ctx)
	if err != nil {
		return err
	}
	if n == 0 {
		if err := importFiles(ctx, st, cfg.SeedDir, log); err != nil {
			return err
		}
	}
	if cfg.Auth == config.AuthDev {
		if count, err := st.roles.Count(ctx); err != nil {
			return err
		} else if count == 0 {
			for _, r := range auth.DevRoles {
				if err := st.roles.Grant(ctx, rbac.Assignment{Email: r.Email, Role: r.Role, Scope: r.Scope, GrantedBy: "development setup"}); err != nil {
					return err
				}
			}
			log.Info("development roles added", "roles", len(auth.DevRoles))
		}
	}
	return st.skills.SyncAll(ctx, st.docs)
}

func importFiles(ctx context.Context, st stores, dir string, log *slog.Logger) error {
	n, problems, err := st.docs.ImportDir(ctx, dir, "import")
	if err != nil {
		return err
	}
	for _, p := range problems {
		log.Warn("not imported", "problem", p)
	}
	log.Info("content imported", "from", dir, "changed", n, "skipped", len(problems))
	if n > 0 {
		_ = st.audit.Add(ctx, "import", "Import", "content.import", dir, fmt.Sprintf("%d documents added or changed", n))
	}
	return nil
}

func exportFiles(ctx context.Context, st stores, dir string, log *slog.Logger) error {
	n, err := st.docs.ExportDir(ctx, dir)
	if err != nil {
		return err
	}
	if err := st.skills.SyncAll(ctx, st.docs); err != nil {
		return err
	}
	k, err := st.skills.ExportDir(ctx, dir)
	if err != nil {
		return err
	}
	log.Info("exported", "to", dir, "documents", n, "skills", k)
	return nil
}

// seedFeedback gives a fresh local database something to look at.
func seedFeedback(ctx context.Context, st stores, log *slog.Logger) error {
	n, err := st.feedback.Count(ctx)
	if err != nil || n > 0 {
		return err
	}
	samples := []feedback.New{
		{TargetKind: docs.Process, TargetID: "request-gcp-project", ItemID: "raise-request", Kind: "outdated", Text: "The catalogue item is now called “Cloud project (GCP)”.", AuthorEmail: "sam@example.com", AuthorName: "Sam Consumer"},
		{TargetKind: docs.Process, TargetID: "onboard-site-to-akamai", Kind: "idea", Text: "A checklist of the DNS records to prepare would save a round trip with the DNS team.", AuthorEmail: "sam@example.com", AuthorName: "Sam Consumer"},
		{TargetKind: docs.Standard, TargetID: "secure-logging", ItemID: "SEC-LOG-05", Kind: "unclear", Text: "Does this apply to one-off migration scripts too?", AuthorEmail: "sam@example.com", AuthorName: "Sam Consumer"},
	}
	added := 0
	for _, s := range samples {
		d, err := st.docs.Get(ctx, s.TargetKind, s.TargetID)
		if err != nil {
			continue
		}
		t, ok := docs.TargetOf(d)
		if !ok || (s.ItemID != "" && t.Items[s.ItemID] == "") {
			continue
		}
		s.ItemHash = t.Items[s.ItemID]
		if _, err := st.feedback.Create(ctx, s); err != nil {
			return err
		}
		added++
	}
	log.Info("sample feedback added", "items", added)
	return nil
}
