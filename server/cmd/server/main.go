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
	flag.BoolVar(&o.reset, "reset", false, "delete all feedback, then exit (combine with -seed to refill; local development only)")
	flag.StringVar(&o.importDir, "import", "", "load processes/, standards/ and catalog/ from this folder into the database, then exit")
	flag.StringVar(&o.exportDir, "export", "", "write processes, standards, lists and generated skills to this folder, then exit")
	flag.Parse()
	// PM_LOG_FORMAT=json gives one JSON object per line, which log collectors prefer
	var handler slog.Handler = slog.NewTextHandler(os.Stderr, nil)
	if os.Getenv("PM_LOG_FORMAT") == "json" {
		handler = slog.NewJSONHandler(os.Stderr, nil)
	}
	log := slog.New(handler)
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
		select {
		case <-ctx.Done(): // asked to stop while still waiting
			pool.Close()
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

type stores struct {
	docs     *docs.Store
	roles    *rbac.Store
	skills   *skills.Store
	feedback *feedback.Store
	audit    *audit.Log
	validate func(kind string, body []byte) error // the format check for imported files
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

	// the schemas are read when they are first needed: one-off commands that import nothing
	// work without them
	var schemas *schema.Set
	loadSchemas := func() (*schema.Set, error) {
		if schemas != nil {
			return schemas, nil
		}
		set, err := schema.Load(cfg.SchemaDir)
		if err == nil {
			schemas = set
		}
		return set, err
	}
	st.validate = func(kind string, body []byte) error {
		set, err := loadSchemas()
		if err != nil {
			return err
		}
		return set.Validate(kind, body)
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
		if cfg.Auth != config.AuthDev {
			return errors.New("-reset deletes all feedback and is only for local development (PM_AUTH=dev)")
		}
		if err := st.feedback.Reset(ctx); err != nil {
			return err
		}
		log.Info("all feedback deleted")
	}

	// one instance at a time: several starting together on an empty database would all try to fill it
	if err := db.WithLock(ctx, pool, db.LockPrepare, func() error { return prepare(ctx, cfg, st, log) }); err != nil {
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

	if _, err := loadSchemas(); err != nil {
		return err
	}
	sessions := auth.NewSessions(cfg.SessionSecret, cfg.Secure())
	deps := httpapi.Deps{Cfg: cfg, Sessions: sessions, SignOuts: &auth.SignOuts{Pool: pool}, Ready: pool.Ping, Docs: st.docs, Schemas: schemas, Roles: st.roles, Audit: st.audit,
		Skills: st.skills, Feedback: st.feedback, Log: log, Notifier: notify.Log{Logger: log}}
	var hook *notify.Webhook
	if cfg.Notify == "webhook" {
		hook = notify.NewWebhook(cfg.WebhookURL, log)
		deps.Notifier = hook
	}
	if cfg.Auth == config.AuthDev {
		log.Warn("PM_AUTH=dev: anyone who can reach this server can sign in as any built-in user. Never use this outside local development.")
	} else {
		deps.OIDC, err = auth.NewOIDC(ctx, sessions, auth.OIDCOptions{
			Issuer: cfg.Issuer, ClientID: cfg.ClientID, ClientSecret: cfg.ClientSecret, RedirectURL: cfg.BaseURL + "/auth/callback",
			HostedDomain: cfg.HostedDomain, EmailDomains: cfg.EmailDomains, PreferSignInName: cfg.Auth == config.AuthEntra,
		})
		if err != nil {
			return err
		}
	}

	srv := &http.Server{
		Addr: cfg.Addr, Handler: httpapi.New(deps),
		// a client that sends or reads slowly cannot hold a connection open for ever
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 2 * time.Minute,
	}
	return serve(ctx, srv, log, func() {
		if hook != nil {
			hook.Wait()
		}
	}, "addr", cfg.Addr, "auth", cfg.Auth, "admins", len(cfg.Admins))
}

// shutdownGrace is how long requests that are being answered get to finish when the server is
// asked to stop.
const shutdownGrace = 15 * time.Second

// serve runs the server until ctx ends, then stops accepting requests and returns only when
// the ones in progress are answered (or the grace period is over) and drain has finished - so
// that the database is not closed under a save that is still running.
func serve(ctx context.Context, srv *http.Server, log *slog.Logger, drain func(), info ...any) error {
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		<-ctx.Done()
		grace, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()
		if err := srv.Shutdown(grace); err != nil {
			log.Error("some requests were cut off while stopping", "error", err)
		}
		done := make(chan struct{})
		go func() { drain(); close(done) }()
		select {
		case <-done:
		case <-grace.Done():
			log.Error("some notifications were not delivered before stopping")
		}
	}()
	log.Info("listening", info...)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	<-stopped
	log.Info("stopped")
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
	n, problems, err := st.docs.ImportDir(ctx, dir, "import", st.validate)
	if err != nil {
		return err
	}
	for _, p := range problems {
		log.Warn("not imported", "problem", p)
	}
	log.Info("content imported", "from", dir, "changed", n, "skipped", len(problems))
	if n > 0 {
		_ = st.audit.Add(ctx, "import", "Import", "content.import", "sample content", fmt.Sprintf("%d documents added or changed", n))
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
