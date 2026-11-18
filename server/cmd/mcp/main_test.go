package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/docs"
	"github.com/kubek80/process-manager/server/internal/embedding"
	"github.com/kubek80/process-manager/server/internal/mcpserver"
	"github.com/kubek80/process-manager/server/internal/retrieval"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestSettings(t *testing.T) {
	const secret = "Zq8Wn3Lp6Tx1Vr9Kc4Hy7Bm2Gd5Fs0JaQ"
	s, err := loadSettings(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil || s.Addr != "127.0.0.1:8081" || s.Secret != "" || s.Embeddings.On() || s.Notify != "log" {
		t.Fatalf("%+v %v", s, err)
	}
	cases := map[string]struct {
		env  map[string]string
		want string
	}{
		"no database":          {map[string]string{}, "DATABASE_URL is required"},
		"network, no secret":   {map[string]string{"DATABASE_URL": "x", "PM_MCP_ADDR": "0.0.0.0:8081"}, "without PM_MCP_SECRET it only listens on this machine"},
		"all addresses":        {map[string]string{"DATABASE_URL": "x", "PM_MCP_ADDR": ":8081"}, "without PM_MCP_SECRET it only listens on this machine"},
		"short secret":         {map[string]string{"DATABASE_URL": "x", "PM_MCP_SECRET": "abc"}, "at least 32 characters"},
		"placeholder":          {map[string]string{"DATABASE_URL": "x", "PM_MCP_SECRET": "change-me-change-me-change-me-change-me"}, "placeholder"},
		"bad address":          {map[string]string{"DATABASE_URL": "x", "PM_MCP_ADDR": "here"}, "must be a host and port"},
		"embeddings":           {map[string]string{"DATABASE_URL": "x", "PM_EMBEDDINGS": "magic"}, "PM_EMBEDDINGS"},
		"webhook without addr": {map[string]string{"DATABASE_URL": "x", "PM_NOTIFY": "webhook"}, "PM_NOTIFY_WEBHOOK_URL is required"},
	}
	for name, c := range cases {
		if _, err := loadSettings(env(c.env)); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v", name, err)
		}
	}
	s, err = loadSettings(env(map[string]string{"DATABASE_URL": "x", "PM_MCP_ADDR": "0.0.0.0:8081", "PM_MCP_SECRET": secret, "PM_EMBEDDINGS": "builtin"}))
	if err != nil || s.Secret != secret || !s.Embeddings.On() {
		t.Fatalf("%+v %v", s, err)
	}
}

// urlOf is the address of the test database with the schema of pool.
func urlOf(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var schema string
	if err := pool.QueryRow(context.Background(), `select current_setting('search_path')`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(dbtest.URL())
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String()
}

var quiet = slog.New(slog.DiscardHandler)

func TestRefusesADatabaseThePortalHasNotPrepared(t *testing.T) {
	ctx := context.Background()
	empty := dbtest.NewEmptyPool(t)
	err := run(ctx, env(map[string]string{"DATABASE_URL": urlOf(t, empty)}), quiet, nil)
	if err == nil || !strings.Contains(err.Error(), "no portal tables yet") {
		t.Fatalf("%v", err)
	}
	// nothing was created
	var n int
	if err := empty.QueryRow(ctx, `select count(*) from information_schema.tables where table_schema = current_schema()`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("%d tables, %v", n, err)
	}

	older := dbtest.NewPool(t)
	if _, err := older.Exec(ctx, `delete from schema_migrations where version >= $1`, requiredMigration); err != nil {
		t.Fatal(err)
	}
	err = run(ctx, env(map[string]string{"DATABASE_URL": urlOf(t, older)}), quiet, nil)
	if err == nil || !strings.Contains(err.Error(), "older version of the portal") {
		t.Fatalf("%v", err)
	}
}

func TestServesAndStops(t *testing.T) {
	pool := dbtest.NewPool(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan string, 1)
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, env(map[string]string{"DATABASE_URL": urlOf(t, pool), "PM_MCP_ADDR": "127.0.0.1:0", "PM_EMBEDDINGS": "off"}), quiet, func(addr string) { ready <- addr })
	}()
	var addr string
	select {
	case addr = <-ready:
	case err := <-done:
		t.Fatal(err)
	case <-time.After(30 * time.Second):
		t.Fatal("did not start")
	}
	res, err := http.Get("http://" + addr + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || string(body) != "ok\n" {
		t.Fatalf("%d %s", res.StatusCode, body)
	}
	c := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := c.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr + "/mcp", DisableStandaloneSSE: true, MaxRetries: -1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	tools, err := cs.ListTools(ctx, nil)
	if err != nil || len(tools.Tools) != 7 {
		t.Fatalf("%v %v", tools, err)
	}
	// an empty database (the portal has not filled it): nothing is found, nothing breaks
	got, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "search_processes", Arguments: map[string]any{"query": "gcp"}})
	if err != nil || got.IsError {
		t.Fatalf("%+v %v", got, err)
	}
	cs.Close()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("did not stop")
	}
}

func TestSearchesWithThePortalsIndex(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pool := dbtest.NewPool(t)
	store := &docs.Store{Pool: pool}
	if _, problems, err := store.ImportDir(ctx, filepath.Join("..", "..", ".."), "import", nil); err != nil || len(problems) > 0 {
		t.Fatal(err, problems)
	}
	settings := map[string]string{"DATABASE_URL": urlOf(t, pool), "PM_MCP_ADDR": "127.0.0.1:0", "PM_EMBEDDINGS": "builtin"}
	s, err := loadSettings(env(settings))
	if err != nil {
		t.Fatal(err)
	}
	// what the portal server does at start
	e, err := embedding.New(ctx, s.Embeddings.EmbeddingOptions())
	if err != nil {
		t.Fatal(err)
	}
	if err := retrieval.New(pool, store, e, s.Embeddings.ChunkOptions(), quiet).Ensure(ctx); err != nil {
		t.Fatal(err)
	}
	ready := make(chan string, 1)
	done := make(chan error, 1)
	go func() { done <- run(ctx, env(settings), quiet, func(addr string) { ready <- addr }) }()
	var addr string
	select {
	case addr = <-ready:
	case err := <-done:
		t.Fatal(err)
	}
	c := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := c.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: "http://" + addr + "/mcp", DisableStandaloneSSE: true, MaxRetries: -1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	got, err := cs.CallTool(ctx, &mcp.CallToolParams{Name: "search_processes", Arguments: map[string]any{"query": "monthly budget approval"}})
	if err != nil || got.IsError {
		t.Fatalf("%+v %v", got, err)
	}
	var out mcpserver.SearchOutput
	data, _ := json.Marshal(got.StructuredContent)
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	if out.RankedBy != "meaning" || out.Total == 0 || out.Results[0].ID != "request-gcp-project" || len(out.Results[0].Matches) == 0 || out.Results[0].Score <= 0 {
		t.Fatalf("%+v", out)
	}
}
