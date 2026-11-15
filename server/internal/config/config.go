// Package config reads the server settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// Auth providers.
const (
	AuthDev    = "dev"
	AuthEntra  = "entra"
	AuthGoogle = "google"
)

type Config struct {
	Addr        string // listen address
	BaseURL     string // public URL of the app, used for the sign-in redirect
	DatabaseURL string
	SeedDir     string   // folder with processes/, standards/ and catalog/ used to fill an empty database
	SchemaDir   string   // folder with the JSON schemas
	Admins      []string // emails that are always admin, so there is always a way in
	StaticDir   string   // built frontend; empty when the frontend is served separately

	Auth          string
	SessionSecret []byte
	Issuer        string // OpenID Connect issuer
	ClientID      string
	ClientSecret  string
	HostedDomain  string // Google only: restrict sign-in to one Workspace domain

	Notify     string // "log" or "webhook"
	WebhookURL string
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
		Addr:         get("PM_ADDR", "127.0.0.1:8080"),
		BaseURL:      strings.TrimRight(get("PM_BASE_URL", "http://localhost:5173"), "/"),
		DatabaseURL:  get("DATABASE_URL", ""),
		SeedDir:      get("PM_SEED_DIR", "."),
		StaticDir:    get("PM_STATIC_DIR", ""),
		Auth:         get("PM_AUTH", ""),
		ClientID:     get("PM_OIDC_CLIENT_ID", ""),
		ClientSecret: get("PM_OIDC_CLIENT_SECRET", ""),
		HostedDomain: get("PM_GOOGLE_HOSTED_DOMAIN", ""),
		Notify:       get("PM_NOTIFY", "log"),
		WebhookURL:   get("PM_NOTIFY_WEBHOOK_URL", ""),
	}
	c.SchemaDir = get("PM_SCHEMA_DIR", filepath.Join(c.SeedDir, "schema"))
	for _, email := range strings.Split(get("PM_ADMINS", ""), ",") {
		if email = strings.ToLower(strings.TrimSpace(email)); email != "" {
			c.Admins = append(c.Admins, email)
		}
	}

	var problems []string
	if c.DatabaseURL == "" {
		problems = append(problems, "DATABASE_URL is required")
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
	case AuthEntra:
		tenant := get("PM_ENTRA_TENANT", "")
		if tenant == "" && get("PM_OIDC_ISSUER", "") == "" {
			problems = append(problems, "PM_ENTRA_TENANT is required when PM_AUTH=entra")
		}
		c.Issuer = "https://login.microsoftonline.com/" + tenant + "/v2.0"
	case AuthGoogle:
		c.Issuer = "https://accounts.google.com"
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

	if len(problems) > 0 {
		return c, errors.New(strings.Join(problems, "; "))
	}
	return c, nil
}

// Secure reports whether cookies must be HTTPS-only.
func (c Config) Secure() bool { return strings.HasPrefix(c.BaseURL, "https://") }
