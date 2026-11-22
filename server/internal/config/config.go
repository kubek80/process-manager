// Package config reads the server settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/kubek80/process-manager/server/internal/chunking"
	"github.com/kubek80/process-manager/server/internal/embedding"
)

// Auth providers.
const (
	AuthDev    = "dev"
	AuthEntra  = "entra"
	AuthGoogle = "google"
)

type Config struct {
	Addr        string // listen address: PM_ADDR, else 0.0.0.0:$PORT when PORT is set, else 127.0.0.1:8080
	BaseURL     string // public URL of the app, used for the sign-in redirect
	DatabaseURL string
	SeedDir     string   // folder with processes/, standards/ and catalog/ used to fill an empty database
	SchemaDir   string   // folder with the JSON schemas
	Admins      []string // emails that are always admin, so there is always a way in
	StaticDir   string   // built frontend; empty when the frontend is served separately
	// SourceDir is the folder of the repository checkout (PM_SOURCE_DIR), from which admins may
	// read source files in Admin › Code map. Empty (the default): the portal shows no source.
	SourceDir string

	Auth          string
	SessionSecret []byte
	Issuer        string // OpenID Connect issuer
	ClientID      string
	ClientSecret  string
	HostedDomain  string   // Google only: restrict sign-in to one Workspace domain
	EmailDomains  []string // only people whose email address ends in one of these may sign in; empty: no limit

	LogFormat string // "text" or "json"

	Notify     string // "log" or "webhook"
	WebhookURL string

	Embeddings Embeddings // search by meaning
}

// Embedding providers.
const (
	EmbeddingsOff     = "off"
	EmbeddingsBuiltin = "builtin"
	EmbeddingsVertex  = "vertex"
)

// Embeddings are the settings of search by meaning: which provider turns text into vectors and
// how processes and standards are cut into parts. The portal server and the MCP command read
// the same ones.
type Embeddings struct {
	Provider          string // "off" (default), "builtin" or "vertex"
	Model             string // vertex only
	Dimensions        int
	Project, Location string   // vertex only
	Parts             []string // which parts of a document are searched on their own
	MaxChars          int      // the largest part, in characters
	// MinScore is the lowest score of a match (PM_SEARCH_MIN_SCORE, 0 to 1); -1 when not set:
	// the floor of the provider applies.
	MinScore float64
}

// On reports whether search by meaning is switched on.
func (e Embeddings) On() bool { return e.Provider != EmbeddingsOff && e.Provider != "" }

// EmbeddingOptions is what embedding.New needs.
func (e Embeddings) EmbeddingOptions() embedding.Options {
	return embedding.Options{Provider: e.Provider, Model: e.Model, Dimensions: e.Dimensions, Project: e.Project, Location: e.Location}
}

// ChunkOptions is what chunking needs.
func (e Embeddings) ChunkOptions() chunking.Options {
	return chunking.Options{Parts: e.Parts, MaxChars: e.MaxChars}
}

// Limits of the embedding settings. 2000 is the largest vector pgvector can index.
const (
	minDimensions = embedding.MinDimensions // the smallest vector the providers make
	maxDimensions = 2000                    // the largest vector pgvector can index
	minChunkChars = 200
	maxChunkChars = 20000
)

// LoadEmbeddings reads the settings of search by meaning. getenv is os.Getenv in production.
func LoadEmbeddings(getenv func(string) string) (Embeddings, error) {
	get := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	e := Embeddings{
		Provider: strings.ToLower(get("PM_EMBEDDINGS", EmbeddingsOff)),
		Model:    get("PM_EMBEDDINGS_MODEL", "gemini-embedding-001"),
		Project:  get("PM_VERTEX_PROJECT", ""),
		Location: get("PM_VERTEX_LOCATION", ""),
	}
	var problems []string
	switch e.Provider {
	case EmbeddingsOff, EmbeddingsBuiltin:
	case EmbeddingsVertex:
		if e.Project == "" || e.Location == "" {
			problems = append(problems, "PM_VERTEX_PROJECT and PM_VERTEX_LOCATION are required when PM_EMBEDDINGS=vertex: the Google Cloud project and region (e.g. europe-west4) that run the embedding model")
		}
	default:
		problems = append(problems, fmt.Sprintf("PM_EMBEDDINGS=%q is not supported: use off, builtin or vertex", e.Provider))
	}
	dims := get("PM_EMBEDDINGS_DIMENSIONS", "768")
	n, err := strconv.Atoi(dims)
	if err != nil || n < minDimensions || n > maxDimensions {
		problems = append(problems, fmt.Sprintf("PM_EMBEDDINGS_DIMENSIONS=%q must be a whole number from %d to %d (768 is recommended)", dims, minDimensions, maxDimensions))
	}
	e.Dimensions = n
	e.Parts = chunking.Default().Parts
	if raw := get("PM_CHUNK_PARTS", ""); raw != "" {
		parts, err := chunking.ParseParts(raw)
		if err != nil {
			problems = append(problems, fmt.Sprintf("PM_CHUNK_PARTS: %v", err))
		}
		e.Parts = parts
	}
	chars := get("PM_CHUNK_MAX_CHARS", "2000")
	n, err = strconv.Atoi(chars)
	if err != nil || n < minChunkChars || n > maxChunkChars {
		problems = append(problems, fmt.Sprintf("PM_CHUNK_MAX_CHARS=%q must be a whole number from %d to %d", chars, minChunkChars, maxChunkChars))
	}
	e.MaxChars = n
	e.MinScore = -1
	if raw := get("PM_SEARCH_MIN_SCORE", ""); raw != "" {
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil || f < 0 || f > 1 {
			problems = append(problems, fmt.Sprintf("PM_SEARCH_MIN_SCORE=%q must be a number from 0 to 1, e.g. 0.6: the lowest score a part needs to count as a match", raw))
		} else {
			e.MinScore = f
		}
	}
	if len(problems) > 0 {
		return e, errors.New(strings.Join(problems, "; "))
	}
	return e, nil
}

// Load builds the configuration. getenv is os.Getenv in production.
func Load(getenv func(string) string) (Config, error) {
	get := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	c := Config{
		Addr:         get("PM_ADDR", ""),
		BaseURL:      strings.TrimRight(get("PM_BASE_URL", "http://localhost:5173"), "/"),
		DatabaseURL:  get("DATABASE_URL", ""),
		SeedDir:      get("PM_SEED_DIR", "."),
		StaticDir:    get("PM_STATIC_DIR", ""),
		SourceDir:    get("PM_SOURCE_DIR", ""),
		Auth:         get("PM_AUTH", ""),
		ClientID:     get("PM_OIDC_CLIENT_ID", ""),
		ClientSecret: get("PM_OIDC_CLIENT_SECRET", ""),
		HostedDomain: get("PM_GOOGLE_HOSTED_DOMAIN", ""),
		LogFormat:    get("PM_LOG_FORMAT", "text"),
		Notify:       get("PM_NOTIFY", "log"),
		WebhookURL:   get("PM_NOTIFY_WEBHOOK_URL", ""),
	}
	c.SchemaDir = get("PM_SCHEMA_DIR", filepath.Join(c.SeedDir, "schema"))
	for _, email := range strings.Split(get("PM_ADMINS", ""), ",") {
		if email = strings.ToLower(strings.TrimSpace(email)); email != "" {
			c.Admins = append(c.Admins, email)
		}
	}

	for _, d := range strings.Split(get("PM_ALLOWED_EMAIL_DOMAINS", ""), ",") {
		if d = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(d), "@")); d != "" {
			c.EmailDomains = append(c.EmailDomains, d)
		}
	}

	var problems []string
	addrFrom := "PM_ADDR=" + c.Addr + " is reachable from the network" // said when the address is refused
	if c.Addr == "" {
		// Cloud Run (and similar platforms) say in PORT which port to listen on
		c.Addr = "127.0.0.1:8080"
		if port := get("PORT", ""); port != "" {
			if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {
				problems = append(problems, fmt.Sprintf("PORT=%q is not a port number: it must be a whole number from 1 to 65535, the port the server listens on. Or set PM_ADDR, e.g. 0.0.0.0:8080", port))
			} else {
				c.Addr = net.JoinHostPort("0.0.0.0", port)
				addrFrom = "PORT=" + port + " is set, so it would listen on " + c.Addr + ", which is reachable from the network"
			}
		}
	}
	if c.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
	}
	if c.SourceDir != "" {
		// an absolute path only: a relative one would depend on where the server was started
		if !filepath.IsAbs(c.SourceDir) {
			problems = append(problems, fmt.Sprintf("PM_SOURCE_DIR=%q must be an absolute path: the folder of the repository checkout, e.g. /home/me/process-manager. Leave it empty to show no source code", c.SourceDir))
		} else {
			c.SourceDir = filepath.Clean(c.SourceDir)
		}
	}
	if c.LogFormat != "text" && c.LogFormat != "json" {
		problems = append(problems, fmt.Sprintf("PM_LOG_FORMAT=%q is not supported: use text or json", c.LogFormat))
	}

	secret := get("PM_SESSION_SECRET", "")
	switch c.Auth {
	case AuthDev:
		// Local development only: anyone can sign in as any built-in user.
		if secret == "" {
			secret = "dev-only-session-secret-not-for-production"
		}
		if len(c.Admins) == 0 {
			c.Admins = []string{"dana@example.com"} // the built-in admin of the dev user picker
		}
		// The picker lets anyone be anyone, so it only listens on this machine. The switch is
		// for a demo on a private network, never for a real installation.
		if !loopback(c.Addr) && get("PM_DEV_AUTH_ON_NETWORK", "") != "i-understand" {
			problems = append(problems, fmt.Sprintf("PM_AUTH=dev lets anyone sign in as anyone, so it only runs on this machine: %s. Use entra or google, or listen on 127.0.0.1", addrFrom))
		}
	case AuthEntra:
		tenant := get("PM_ENTRA_TENANT", "")
		if tenant == "" && get("PM_OIDC_ISSUER", "") == "" {
			problems = append(problems, "PM_ENTRA_TENANT is required when PM_AUTH=entra")
		}
		c.Issuer = "https://login.microsoftonline.com/" + tenant + "/v2.0"
	case AuthGoogle:
		c.Issuer = "https://accounts.google.com"
		// Without a limit every Google account in the world could sign in and read everything.
		if c.HostedDomain == "" && len(c.EmailDomains) == 0 {
			problems = append(problems, "PM_GOOGLE_HOSTED_DOMAIN (your Workspace domain) or PM_ALLOWED_EMAIL_DOMAINS is required when PM_AUTH=google, otherwise any Google account could sign in")
		}
	case "":
		problems = append(problems, "PM_AUTH is required: dev, entra or google")
	default:
		problems = append(problems, fmt.Sprintf("PM_AUTH=%q is not supported: use dev, entra or google", c.Auth))
	}
	if c.Auth == AuthEntra || c.Auth == AuthGoogle {
		c.Issuer = get("PM_OIDC_ISSUER", c.Issuer) // override for tests and sovereign clouds
		if c.ClientID == "" || c.ClientSecret == "" {
			problems = append(problems, "PM_OIDC_CLIENT_ID and PM_OIDC_CLIENT_SECRET are required")
		}
		if len(secret) < 32 {
			problems = append(problems, "PM_SESSION_SECRET must be at least 32 characters")
		} else if weakSecret(secret) {
			problems = append(problems, "PM_SESSION_SECRET is a placeholder or too simple: use a long random value, e.g. from `openssl rand -base64 48`")
		}
		if get("PM_BASE_URL", "") == "" {
			problems = append(problems, "PM_BASE_URL is required: the public address of the app, e.g. https://processes.example.com")
		} else if u, err := url.Parse(c.BaseURL); err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && !(u.Scheme == "http" && loopback(u.Host))) {
			problems = append(problems, "PM_BASE_URL must start with https:// (http:// is only accepted for localhost)")
		} else {
			// one spelling everywhere: cookies, redirects and the security headers all follow from it
			c.BaseURL = u.Scheme + "://" + strings.ToLower(u.Host) + strings.TrimRight(u.EscapedPath(), "/")
		}
		if len(c.Admins) == 0 {
			problems = append(problems, "PM_ADMINS is required: the email of at least one person who can open the Admin panel and give others access")
		}
	}
	c.SessionSecret = []byte(secret)

	switch c.Notify {
	case "log":
	case "webhook":
		if c.WebhookURL == "" {
			problems = append(problems, "PM_NOTIFY_WEBHOOK_URL is required when PM_NOTIFY=webhook")
		}
	default:
		problems = append(problems, fmt.Sprintf("PM_NOTIFY=%q is not supported: use log or webhook", c.Notify))
	}

	emb, err := LoadEmbeddings(getenv)
	if err != nil {
		problems = append(problems, err.Error())
	}
	c.Embeddings = emb

	if len(problems) > 0 {
		return c, errors.New(strings.Join(problems, "; "))
	}
	return c, nil
}

// loopback reports whether a host or host:port only reaches this machine.
func loopback(addr string) bool {
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

// weakSecret catches the placeholder of the example file and values that are obviously not
// random. It is a safety net against a copied example, not a measure of strength.
func weakSecret(secret string) bool {
	lower := strings.ToLower(secret)
	for _, hint := range []string{"change-me", "changeme", "replace-me", "your-secret", "example", "placeholder"} {
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

// Secure reports whether cookies must be HTTPS-only.
func (c Config) Secure() bool { return strings.HasPrefix(c.BaseURL, "https://") }
