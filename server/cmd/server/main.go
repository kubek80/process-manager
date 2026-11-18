// Command server runs the Process Manager backend.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/auth"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/db"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
	"github.com/kubek80/process-manager/server/internal/engagement"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/httpapi"
	"github.com/kubek80/process-manager/server/internal/notify"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/requests"
	"github.com/kubek80/process-manager/server/internal/retrieval"
	"github.com/kubek80/process-manager/server/internal/schema"
	"github.com/kubek80/process-manager/server/internal/skills"
	"github.com/kubek80/process-manager/server/internal/upgrade"
)

// stdout is where -migrate writes its account; tests read it.
var stdout io.Writer = os.Stdout

type options struct {
	seed      bool   // add sample feedback (and in development, sample engagement) when there is none
	reset     bool   // delete all feedback and engagement, then exit
	importDir string // load files into the database, then exit
	exportDir string // write the database to files, then exit
	migrate   bool   // upgrade the tables, convert older content, regenerate the skills, then exit
	reindex   bool   // bring the search index up to date, then exit
}

func main() {
	var o options
	flag.BoolVar(&o.seed, "seed", false, "add sample feedback when the database has none, and with PM_AUTH=dev sample views, upvotes, bookmarks, downloads and requests when there are none (local development)")
	flag.BoolVar(&o.reset, "reset", false, "delete all feedback, views, bookmarks, upvotes, skill downloads and requests, then exit (combine with -seed to refill; local development only)")
	flag.StringVar(&o.importDir, "import", "", "load processes/, standards/ and catalog/ from this folder into the database, then exit")
	flag.BoolVar(&o.migrate, "migrate", false, "upgrade the tables, convert content stored by an earlier version and regenerate the skills, print what was done, then exit")
	flag.BoolVar(&o.reindex, "reindex", false, "bring the index of search by meaning up to date (all of it again when its settings changed), print what was done, then exit")
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
	// views, bookmarks, upvotes, downloads; requests
	engagement *engagement.Store
	requests   *requests.Store
	index      *retrieval.Index                     // search by meaning; switched off when PM_EMBEDDINGS=off
	validate   func(kind string, body []byte) error // the format check for imported files
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
	st := stores{
		docs: &docs.Store{Pool: pool}, roles: &rbac.Store{Pool: pool, Bootstrap: cfg.Admins},
		skills: &skills.Store{Pool: pool}, feedback: &feedback.Store{Pool: pool}, audit: &audit.Log{Pool: pool},
		engagement: &engagement.Store{Pool: pool}, requests: &requests.Store{Pool: pool},
	}
	embedder, err := newEmbedder(ctx, cfg.Embeddings.EmbeddingOptions())
	if err != nil {
		return fmt.Errorf("search by meaning: %w", err)
	}
	st.index = retrieval.New(pool, st.docs, embedder, cfg.Embeddings.ChunkOptions(), log)
	st.index.SetMinScore(cfg.Embeddings.MinScore)
	logSearch(log, cfg.Embeddings, st.index)
	if o.migrate {
		return migrateCommand(ctx, pool, st, log, stdout)
	}
	if _, _, err := upgradeDatabase(ctx, pool, log); err != nil {
		return err
	}
	if o.reindex {
		return reindexCommand(ctx, st, stdout)
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
	// Imported files get the same checks as a save in the portal: the format, and that the
	// parts fit together. The lists are imported first, so tiers and the like are known.
	st.validate = func(kind string, body []byte) error {
		set, err := loadSchemas()
		if err != nil {
			return err
		}
		if err := set.Validate(kind, body); err != nil {
			return err
		}
		lists, err := st.docs.Lists(ctx)
		if err == nil && kind == docs.Catalog {
			err = json.Unmarshal(body, &lists)
		}
		if err != nil {
			return err
		}
		return docs.Check(kind, body, lists)
	}

	// one-off commands
	if o.importDir != "" {
		if err := importFiles(ctx, st, o.importDir, log); err != nil {
			return err
		}
		if err := st.skills.SyncAll(ctx, st.docs); err != nil {
			return err
		}
		return catchUpIndex(ctx, st, log)
	}
	if o.exportDir != "" {
		return exportFiles(ctx, st, o.exportDir, log)
	}
	if o.reset {
		if cfg.Auth != config.AuthDev {
			return errors.New("-reset deletes all feedback, views, bookmarks, upvotes, skill downloads and requests and is only for local development (PM_AUTH=dev)")
		}
		if err := reset(ctx, st); err != nil {
			return err
		}
		log.Info("all feedback, views, bookmarks, upvotes, skill downloads and requests deleted")
	}

	// one instance at a time: several starting together on an empty database would all try to fill it
	if err := db.WithLock(ctx, pool, db.LockPrepare, func() error { return prepare(ctx, cfg, st, log) }); err != nil {
		return err
	}
	if o.seed {
		if err := seed(ctx, cfg, st, log); err != nil {
			return err
		}
	}
	if o.reset {
		return nil
	}
	// only the quick part before serving: the provider may be slow or unreachable
	if err := prepareIndex(ctx, st, log); err != nil {
		return err
	}
	var background sync.WaitGroup
	if st.index.Enabled() {
		// the index is caught up in the background (searches answer "not ready yet" while it is
		// built), then documents whose sync failed are tried again every few minutes
		background.Add(1)
		go func() {
			defer background.Done()
			st.index.LogCatchUp(ctx)
			st.index.RetryEvery(ctx, indexRetry)
		}()
	}

	if _, err := loadSchemas(); err != nil {
		return err
	}
	sessions := auth.NewSessions(cfg.SessionSecret, cfg.Secure())
	deps := httpapi.Deps{Background: &background, Cfg: cfg, Sessions: sessions, SignOuts: &auth.SignOuts{Pool: pool}, Ready: pool.Ping, Docs: st.docs, Schemas: schemas, Roles: st.roles, Audit: st.audit,
		Skills: st.skills, Feedback: st.feedback, Engagement: st.engagement, Requests: st.requests, Log: log, Notifier: notify.Log{Logger: log}, Index: st.index}
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
		background.Wait() // skills that are still being regenerated after a save
		if hook != nil {
			hook.Wait()
		}
	}, "addr", cfg.Addr, "auth", cfg.Auth, "admins", len(cfg.Admins))
}

// indexRetry is how often documents that could not be indexed are tried again.
const indexRetry = 5 * time.Minute

// newEmbedder makes the embeddings provider; tests replace it.
var newEmbedder = embedding.New

// prepareIndex is what a start does about the search index before it serves: with search by
// meaning on, only the quick work in the database (the extension, the tables); with it off, an
// index left from earlier is marked as not in use, since nobody keeps it up to date any more.
func prepareIndex(ctx context.Context, st stores, log *slog.Logger) error {
	if !st.index.Enabled() {
		was, err := st.index.MarkUnused(ctx)
		if err != nil {
			return fmt.Errorf("search by meaning: %w", err)
		}
		if was {
			log.Warn("search by meaning is off, so the search index left from earlier is no longer kept up to date: it is marked as not in use and nothing searches it (an MCP server answers by words only). Switched on again, it is caught up first")
		}
		return nil
	}
	if err := st.index.Ensure(ctx); err != nil {
		return fmt.Errorf("search by meaning: %w", err)
	}
	return nil
}

// logSearch says at start whether search by meaning is on, and whether text leaves the company.
func logSearch(log *slog.Logger, e config.Embeddings, ix *retrieval.Index) {
	switch {
	case !ix.Enabled():
		log.Info("search by meaning is off (PM_EMBEDDINGS=off): people search by words only")
	case ix.Outside():
		log.Warn("search by meaning is on with Vertex AI: the text of published processes and standards and every search query is sent to Google Cloud",
			"project", e.Project, "location", e.Location, "model", e.Model, "dimensions", e.Dimensions)
	default:
		log.Info("search by meaning is on with the built-in embedder: nothing leaves this server", "dimensions", e.Dimensions)
	}
	if ix.Enabled() {
		source := "the provider's default"
		if e.MinScore >= 0 {
			source = "PM_SEARCH_MIN_SCORE"
		}
		log.Info("search by meaning: parts scoring below the floor are not matches", "floor", ix.Floor(), "from", source)
	}
}

// catchUpIndex makes the search index usable and brings it up to date with everything stored:
// after an import, a conversion of older content, or saves made while the provider could not be
// reached. Parts that did not change are not embedded again. Only a database problem (or a
// missing pgvector) stops the server; when the provider cannot be reached the documents are
// tried again later.
func catchUpIndex(ctx context.Context, st stores, log *slog.Logger) error {
	if !st.index.Enabled() {
		return nil
	}
	if err := st.index.Ensure(ctx); err != nil {
		return fmt.Errorf("search by meaning: %w", err)
	}
	r, err := st.index.CatchUp(ctx)
	switch {
	case errors.Is(err, retrieval.ErrProvider), errors.Is(err, retrieval.ErrOtherSettings):
		log.Warn("search by meaning: the embeddings provider cannot be reached; searches use what is indexed, and what is missing is tried again in a few minutes", "error", err)
	case err != nil:
		return fmt.Errorf("search by meaning: %w", err)
	case r.Embedded > 0 || r.Removed > 0:
		log.Info("search index brought up to date", "result", r.String())
	}
	return nil
}

// reindexCommand is -reindex: it brings the search index up to date and writes a short account.
func reindexCommand(ctx context.Context, st stores, out io.Writer) error {
	if !st.index.Enabled() {
		return errors.New("search by meaning is switched off (PM_EMBEDDINGS=off): there is no index to rebuild. Set PM_EMBEDDINGS to builtin or vertex")
	}
	if err := st.index.Ensure(ctx); err != nil {
		return fmt.Errorf("search by meaning: %w", err)
	}
	r, err := st.index.CatchUp(ctx)
	if err != nil && !errors.Is(err, retrieval.ErrProvider) {
		return fmt.Errorf("search by meaning: %w", err)
	}
	fmt.Fprintln(out, "Search index ("+st.index.Provider()+")")
	fmt.Fprintln(out, "  "+r.String())
	if err != nil {
		return fmt.Errorf("the search index is not complete: %w", err)
	}
	fmt.Fprintln(out, "Done.")
	return nil
}

// upgradeDatabase creates or upgrades the tables and then converts content stored by an
// earlier version, both under the lock of the migrations: the one way the database is upgraded,
// on every start and by -migrate. It says which table migrations it applied and what the
// conversion did.
func upgradeDatabase(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) ([]string, upgrade.Report, error) {
	var report upgrade.Report
	convert := func(ctx context.Context) error {
		var err error
		report, err = upgrade.Convert(ctx, pool, log)
		return err
	}
	applied, err := db.Upgrade(ctx, pool, convert)
	if err != nil {
		return applied, report, fmt.Errorf("database setup: %w", err)
	}
	if len(applied) > 0 {
		log.Info("tables upgraded", "migrations", strings.Join(applied, ", "))
	}
	return applied, report, nil
}

// migrateCommand is -migrate: it upgrades the database as a start does, brings the skills up to
// date and writes a short account of it to out. Unlike a start it neither fills an empty
// database nor gives development roles, and it starts no web server.
func migrateCommand(ctx context.Context, pool *pgxpool.Pool, st stores, log *slog.Logger, out io.Writer) error {
	applied, report, err := upgradeDatabase(ctx, pool, log)
	if err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}
	before, err := st.skills.List(ctx)
	if err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}
	if err := st.skills.SyncAll(ctx, st.docs); err != nil {
		return fmt.Errorf("migration failed: the tables and content are up to date, but the skills could not be regenerated: %w", err)
	}
	after, err := st.skills.List(ctx)
	if err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}
	was := map[string]skills.Skill{}
	for _, sk := range before {
		was[sk.ID] = sk
	}
	regenerated, withdrawn := 0, 0
	for _, sk := range after {
		old, had := was[sk.ID]
		if sk.Version != old.Version || (sk.Active && had && !old.Active) {
			regenerated++
		}
		if !sk.Active && had && old.Active {
			withdrawn++
		}
	}

	searchLine, searchChanged := "", false
	if st.index.Enabled() {
		if err := st.index.Ensure(ctx); err != nil {
			return fmt.Errorf("migration failed: the tables, content and skills are up to date, but the search index could not be set up: %w", err)
		}
		r, err := st.index.CatchUp(ctx)
		switch {
		case errors.Is(err, retrieval.ErrProvider) || errors.Is(err, retrieval.ErrOtherSettings):
			// like a start: the rest of the migration worked; the index is caught up later
			log.Warn("search by meaning: the search index could not be brought up to date; it is caught up when the server runs", "error", err)
			searchLine = "not brought up to date: " + plainCause(err) + "; the server catches it up later"
		case err != nil:
			return fmt.Errorf("migration failed: the tables, content and skills are up to date, but the search index could not be brought up to date (%s): %w", r.String(), err)
		default:
			searchChanged = r.Embedded > 0 || r.Removed > 0
			searchLine = "already up to date"
			if searchChanged {
				searchLine = r.String()
			}
		}
	}

	tables := "already up to date"
	if len(applied) > 0 {
		tables = fmt.Sprintf("%d applied: %s", len(applied), strings.Join(applied, ", "))
	}
	skillsLine := fmt.Sprintf("%d regenerated", regenerated)
	if withdrawn > 0 {
		skillsLine += fmt.Sprintf(", %d withdrawn", withdrawn)
	}
	if regenerated == 0 && withdrawn == 0 {
		skillsLine = "already up to date"
	}
	fmt.Fprintln(out, "Database migration")
	fmt.Fprintln(out, "  Tables:  "+tables)
	fmt.Fprintln(out, "  Content: "+report.String())
	fmt.Fprintln(out, "  Skills:  "+skillsLine)
	if searchLine != "" {
		fmt.Fprintln(out, "  Search:  "+searchLine)
	}
	if len(applied) == 0 && !report.Converted && regenerated == 0 && withdrawn == 0 && !searchChanged {
		fmt.Fprintln(out, "Nothing to do: the database was already up to date.")
	} else {
		fmt.Fprintln(out, "Done.")
	}
	return nil
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
// users without roles get theirs, and the generated skills are brought up to date.
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
		if err := devRoles(ctx, st, log); err != nil {
			return err
		}
	}
	return st.skills.SyncAll(ctx, st.docs)
}

// devRoles gives each built-in development user who has no role at all the roles of
// auth.DevRoles: a new local database gets all of them, an older one the users added since.
// A role for a team, platform or practice that this database does not have is left out, so
// that content which differs from the samples gets no role that points at nothing.
func devRoles(ctx context.Context, st stores, log *slog.Logger) error {
	all, err := st.roles.All(ctx)
	if err != nil {
		return err
	}
	lists, err := st.docs.Lists(ctx)
	if err != nil {
		return err
	}
	known := func(role, scope string) bool {
		list := lists.Teams
		switch role {
		case rbac.PlatformOwner:
			list = lists.Platforms
		case rbac.PracticeOwner:
			list = lists.Practices
		}
		for _, n := range list {
			if n.ID == scope {
				return true
			}
		}
		return scope == ""
	}
	has := map[string]bool{}
	for _, a := range all {
		has[a.Email] = true
	}
	added := 0
	for _, r := range auth.DevRoles {
		if has[r.Email] || !known(r.Role, r.Scope) {
			continue
		}
		if err := st.roles.Grant(ctx, rbac.Assignment{Email: r.Email, Role: r.Role, Scope: r.Scope, GrantedBy: "development setup"}); err != nil {
			return err
		}
		added++
	}
	if added > 0 {
		log.Info("development roles added", "roles", added)
	}
	return nil
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
	// every skill written counts as one download of the process or standard it comes from: an
	// export has no person, so each run counts again
	var counted error
	k, err := st.skills.ExportDir(ctx, dir, func(sk skills.Skill) {
		if st.engagement == nil || counted != nil {
			return
		}
		_, err := st.engagement.CountDownload(ctx, sk.ID, sk.SourceKind, sk.SourceID, "", engagement.ViaExport, time.Now())
		if !errors.Is(err, engagement.ErrNoDocument) {
			counted = err
		}
	})
	if err != nil {
		return err
	}
	if counted != nil {
		log.Warn("the export was not counted as downloads", "error", counted)
	}
	log.Info("exported", "to", dir, "documents", n, "skills", k)
	return nil
}

// reset deletes what -seed adds samples of: feedback, views, bookmarks, upvotes, skill
// downloads and requests, so that -reset -seed gives the samples back completely.
func reset(ctx context.Context, st stores) error {
	if err := st.feedback.Reset(ctx); err != nil {
		return err
	}
	if err := st.engagement.Reset(ctx); err != nil {
		return err
	}
	return st.requests.Reset(ctx)
}

// seed adds the samples that make a local database worth looking at: feedback, and with
// development sign-in also views, bookmarks, upvotes, downloads and requests. Each only fills
// what is empty.
func seed(ctx context.Context, cfg config.Config, st stores, log *slog.Logger) error {
	if err := seedFeedback(ctx, st, log); err != nil {
		return err
	}
	if cfg.Auth != config.AuthDev {
		return nil
	}
	return seedEngagement(ctx, st, log, time.Now())
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

// plainCause says in a few words why the search index could not be brought up to date.
func plainCause(err error) string {
	if errors.Is(err, retrieval.ErrOtherSettings) {
		return "the index belongs to other settings of search by meaning"
	}
	return "the embeddings provider cannot be reached"
}
