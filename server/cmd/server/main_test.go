package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/config"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/feedback"
	"github.com/kubek80/process-manager/server/internal/rbac"
	"github.com/kubek80/process-manager/server/internal/skills"
)

var (
	quiet = slog.New(slog.NewTextHandler(io.Discard, nil))
	ctx   = context.Background()
)

const repo = "../.." // the server folder; the sample content is one level further up

func newStores(t *testing.T) stores {
	pool := dbtest.NewPool(t)
	return stores{docs: &docs.Store{Pool: pool}, roles: &rbac.Store{Pool: pool}, skills: &skills.Store{Pool: pool},
		feedback: &feedback.Store{Pool: pool}, audit: &audit.Log{Pool: pool}}
}

func TestPrepareFillsAnEmptyDatabaseOnce(t *testing.T) {
	st := newStores(t)
	cfg := config.Config{Auth: config.AuthDev, SeedDir: filepath.Join(repo, "..")}
	if err := prepare(ctx, cfg, st, quiet); err != nil {
		t.Fatal(err)
	}
	processes, _ := st.docs.List(ctx, docs.Process)
	standards, _ := st.docs.List(ctx, docs.Standard)
	if len(processes) != 7 || len(standards) != 3 {
		t.Fatalf("imported %d processes, %d standards", len(processes), len(standards))
	}
	if roles, _ := st.roles.Count(ctx); roles != 5 {
		t.Fatalf("development roles: %d", roles)
	}
	riley, _ := st.roles.Perms(ctx, "riley@example.com")
	if !riley.CanEditStandard("security") || riley.Processes {
		t.Fatalf("riley: %+v", riley)
	}
	list, _ := st.skills.List(ctx)
	if len(list) != 13 {
		t.Fatalf("skills generated: %d", len(list))
	}
	entries, _ := st.audit.Recent(ctx, 10)
	if len(entries) != 1 || entries[0].Action != "content.import" {
		t.Fatalf("audit: %+v", entries)
	}

	// a second start changes nothing: content edited in the portal is never overwritten by the seed
	st.docs.Delete(ctx, docs.Process, "request-gcp-project", "alex")
	st.roles.Revoke(ctx, "alex@example.com", rbac.CatalogManager, "")
	if err := prepare(ctx, cfg, st, quiet); err != nil {
		t.Fatal(err)
	}
	if processes, _ := st.docs.List(ctx, docs.Process); len(processes) != 6 {
		t.Fatalf("the seed was imported again: %d processes", len(processes))
	}
	if roles, _ := st.roles.Count(ctx); roles != 4 {
		t.Fatalf("roles were re-added: %d", roles)
	}
	if sk, _ := st.skills.Get(ctx, "process-request-gcp-project"); sk.Active {
		t.Fatal("the skill of the deleted process must be withdrawn on start")
	}
}

func TestNoDevelopmentRolesWithARealProvider(t *testing.T) {
	st := newStores(t)
	if err := prepare(ctx, config.Config{Auth: config.AuthEntra, SeedDir: t.TempDir()}, st, quiet); err != nil {
		t.Fatal(err)
	}
	if roles, _ := st.roles.Count(ctx); roles != 0 {
		t.Fatalf("roles: %d", roles)
	}
}

func TestSeedFeedbackOnlyFillsAnEmptyDatabase(t *testing.T) {
	st := newStores(t)
	if err := seedFeedback(ctx, st, quiet); err != nil { // no content yet: nothing to attach samples to
		t.Fatal(err)
	}
	if n, _ := st.feedback.Count(ctx); n != 0 {
		t.Fatalf("seeded %d items without content", n)
	}
	st.docs.ImportDir(ctx, filepath.Join(repo, ".."), "import")
	if err := seedFeedback(ctx, st, quiet); err != nil {
		t.Fatal(err)
	}
	items, _ := st.feedback.List(ctx)
	if len(items) != 3 || items[0].ItemHash == "" || items[2].TargetKind != docs.Standard {
		t.Fatalf("got %+v", items)
	}
	seedFeedback(ctx, st, quiet)
	if n, _ := st.feedback.Count(ctx); n != 3 {
		t.Fatalf("seeding twice left %d items", n)
	}
}

func TestExportThenImportRoundTrip(t *testing.T) {
	st := newStores(t)
	if err := importFiles(ctx, st, filepath.Join(repo, ".."), quiet); err != nil {
		t.Fatal(err)
	}
	out := t.TempDir()
	if err := exportFiles(ctx, st, out, quiet); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"processes/request-gcp-project.json", "standards/secure-logging.json", "catalog/catalog.json",
		".claude/skills/standard-secure-logging/SKILL.md", ".claude/agents/review-secure-logging.md"} {
		if _, err := os.Stat(filepath.Join(out, rel)); err != nil {
			t.Errorf("missing %s", rel)
		}
	}
	fresh := newStores(t)
	if err := importFiles(ctx, fresh, out, quiet); err != nil {
		t.Fatal(err)
	}
	if n, _ := fresh.docs.Count(ctx); n != 11 {
		t.Fatalf("round trip: %d documents", n)
	}
}

func TestRunRefusesBadConfiguration(t *testing.T) {
	t.Setenv("PM_AUTH", "")
	t.Setenv("DATABASE_URL", "")
	err := run(quiet, options{})
	if err == nil || !strings.Contains(err.Error(), "PM_AUTH is required") || !strings.Contains(err.Error(), "DATABASE_URL is required") {
		t.Fatalf("got %v", err)
	}
}

func TestConnectReportsAnUnusableAddress(t *testing.T) {
	if _, err := connect(ctx, "not a url", quiet); err == nil || !strings.Contains(err.Error(), "database address") {
		t.Fatalf("got %v", err)
	}
}

func TestOneOffCommandsExit(t *testing.T) {
	dbtest.NewPool(t) // skips when no database is available
	t.Setenv("PM_AUTH", "dev")
	t.Setenv("DATABASE_URL", dbtest.URL())
	t.Setenv("PM_SEED_DIR", t.TempDir())
	if err := run(quiet, options{reset: true}); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if err := run(quiet, options{exportDir: t.TempDir()}); err != nil {
		t.Fatalf("export: %v", err)
	}
	if err := run(quiet, options{importDir: t.TempDir()}); err != nil {
		t.Fatalf("import: %v", err)
	}
}
