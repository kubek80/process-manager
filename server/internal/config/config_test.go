package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadDev(t *testing.T) {
	c, err := Load(env(map[string]string{"PM_AUTH": "dev", "DATABASE_URL": "postgres://x", "PM_SEED_DIR": "/data"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != "127.0.0.1:8080" || c.SeedDir != "/data" || c.SchemaDir != "/data/schema" || len(c.SessionSecret) == 0 || c.Notify != "log" ||
		len(c.Admins) != 1 || c.Admins[0] != "dana@example.com" {
		t.Fatalf("unexpected config: %+v", c)
	}
	if c.Secure() {
		t.Fatal("http base URL must not be secure")
	}
}

func TestLoadProviders(t *testing.T) {
	secret := "kJ8v2Qx7Lm4Zp9Wn3Rt6Yb1Hc5Fd0GsAeUi"
	base := map[string]string{"DATABASE_URL": "postgres://x", "PM_OIDC_CLIENT_ID": "id", "PM_OIDC_CLIENT_SECRET": "sec", "PM_SESSION_SECRET": secret, "PM_BASE_URL": "https://pm.example.com/", "PM_ADMINS": " Root@Example.com , second@example.com,"}
	with := func(extra map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}

	c, err := Load(env(with(map[string]string{"PM_AUTH": "entra", "PM_ENTRA_TENANT": "contoso"})))
	if err != nil || c.Issuer != "https://login.microsoftonline.com/contoso/v2.0" {
		t.Fatalf("entra: %v %q", err, c.Issuer)
	}
	if !c.Secure() || c.BaseURL != "https://pm.example.com" {
		t.Fatalf("base url: %q", c.BaseURL)
	}
	if len(c.Admins) != 2 || c.Admins[0] != "root@example.com" || c.Admins[1] != "second@example.com" {
		t.Fatalf("admins: %v", c.Admins)
	}

	c, err = Load(env(with(map[string]string{"PM_AUTH": "google", "PM_GOOGLE_HOSTED_DOMAIN": "example.com"})))
	if err != nil || c.Issuer != "https://accounts.google.com" || c.HostedDomain != "example.com" {
		t.Fatalf("google: %v %+v", err, c)
	}

	c, err = Load(env(with(map[string]string{"PM_AUTH": "google", "PM_OIDC_ISSUER": "http://fake", "PM_ALLOWED_EMAIL_DOMAINS": " Example.com, @example.org ,"})))
	if err != nil || c.Issuer != "http://fake" || len(c.EmailDomains) != 2 || c.EmailDomains[0] != "example.com" || c.EmailDomains[1] != "example.org" {
		t.Fatalf("issuer override and email domains: %v %+v", err, c)
	}

	// local trial of a real provider
	c, err = Load(env(with(map[string]string{"PM_AUTH": "entra", "PM_ENTRA_TENANT": "contoso", "PM_BASE_URL": "http://localhost:5173"})))
	if err != nil || c.Secure() {
		t.Fatalf("http on localhost: %v", err)
	}
}

func TestDevSignInOnlyOnThisMachine(t *testing.T) {
	base := map[string]string{"PM_AUTH": "dev", "DATABASE_URL": "postgres://x"}
	for addr, ok := range map[string]bool{"127.0.0.1:8080": true, "localhost:9000": true, "[::1]:8080": true, "0.0.0.0:8080": false, ":8080": false, "10.1.2.3:80": false} {
		base["PM_ADDR"] = addr
		_, err := Load(env(base))
		if ok != (err == nil) {
			t.Errorf("%s: %v", addr, err)
		}
		if err != nil && !strings.Contains(err.Error(), "only runs on this machine") {
			t.Errorf("%s: unhelpful message: %v", addr, err)
		}
	}
	base["PM_DEV_AUTH_ON_NETWORK"] = "i-understand"
	if _, err := Load(env(base)); err != nil {
		t.Errorf("with the explicit switch: %v", err)
	}
}

func TestLoadRejects(t *testing.T) {
	const good = "kJ8v2Qx7Lm4Zp9Wn3Rt6Yb1Hc5Fd0GsAeUi"
	cases := map[string]map[string]string{
		"PM_AUTH is required":            {"DATABASE_URL": "x"},
		"DATABASE_URL is required":       {"PM_AUTH": "dev"},
		"not supported":                  {"PM_AUTH": "ldap", "DATABASE_URL": "x"},
		"PM_ENTRA_TENANT is required":    {"PM_AUTH": "entra", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": good},
		"PM_ADMINS is required":          {"PM_AUTH": "google", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": good},
		"PM_OIDC_CLIENT_ID":              {"PM_AUTH": "google", "DATABASE_URL": "x", "PM_SESSION_SECRET": good},
		"any Google account could sign":  {"PM_AUTH": "google", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": good, "PM_ADMINS": "a@b.c", "PM_BASE_URL": "https://pm.example.com"},
		"placeholder or too simple":      {"PM_AUTH": "entra", "PM_ENTRA_TENANT": "t", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": "change-me-to-32-or-more-random-characters", "PM_ADMINS": "a@b.c", "PM_BASE_URL": "https://pm.example.com"},
		"too simple":                     {"PM_AUTH": "entra", "PM_ENTRA_TENANT": "t", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": strings.Repeat("s", 40), "PM_ADMINS": "a@b.c", "PM_BASE_URL": "https://pm.example.com"},
		"PM_BASE_URL is required":        {"PM_AUTH": "entra", "PM_ENTRA_TENANT": "t", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": good, "PM_ADMINS": "a@b.c"},
		"must start with https://":       {"PM_AUTH": "entra", "PM_ENTRA_TENANT": "t", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": good, "PM_ADMINS": "a@b.c", "PM_BASE_URL": "http://pm.example.com"},
		`PM_LOG_FORMAT="xml" is not sup`: {"PM_AUTH": "dev", "DATABASE_URL": "x", "PM_LOG_FORMAT": "xml"},
		"at least 32 characters":         {"PM_AUTH": "google", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": "short"},
		"PM_NOTIFY_WEBHOOK_URL":          {"PM_AUTH": "dev", "DATABASE_URL": "x", "PM_NOTIFY": "webhook"},
		`PM_NOTIFY="pigeon" is not supp`: {"PM_AUTH": "dev", "DATABASE_URL": "x", "PM_NOTIFY": "pigeon"},
	}
	for want, vars := range cases {
		if _, err := Load(env(vars)); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("want error containing %q, got %v", want, err)
		}
	}
}

func TestEmbeddingSettings(t *testing.T) {
	base := map[string]string{"PM_AUTH": "dev", "DATABASE_URL": "postgres://x"}
	with := func(extra map[string]string) func(string) string {
		m := map[string]string{}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range extra {
			m[k] = v
		}
		return env(m)
	}
	c, err := Load(with(nil))
	if err != nil || c.Embeddings.On() || c.Embeddings.Provider != "off" || c.Embeddings.Dimensions != 768 || c.Embeddings.MaxChars != 2000 || len(c.Embeddings.Parts) == 0 {
		t.Fatalf("default: %v %+v", err, c.Embeddings)
	}
	c, err = Load(with(map[string]string{"PM_EMBEDDINGS": "builtin", "PM_EMBEDDINGS_DIMENSIONS": "256", "PM_CHUNK_MAX_CHARS": "1000"}))
	if err != nil || !c.Embeddings.On() || c.Embeddings.Dimensions != 256 || c.Embeddings.ChunkOptions().MaxChars != 1000 {
		t.Fatalf("builtin: %v %+v", err, c.Embeddings)
	}
	o := c.Embeddings.EmbeddingOptions()
	if o.Provider != "builtin" || o.Dimensions != 256 {
		t.Fatalf("options: %+v", o)
	}
	c, err = Load(with(map[string]string{"PM_EMBEDDINGS": "vertex", "PM_VERTEX_PROJECT": "p", "PM_VERTEX_LOCATION": "europe-west4"}))
	if err != nil || c.Embeddings.Model != "gemini-embedding-001" || c.Embeddings.Project != "p" {
		t.Fatalf("vertex: %v %+v", err, c.Embeddings)
	}
	for _, tc := range []struct {
		env  map[string]string
		want string
	}{
		{map[string]string{"PM_EMBEDDINGS": "vertex"}, "PM_VERTEX_PROJECT and PM_VERTEX_LOCATION are required"},
		{map[string]string{"PM_EMBEDDINGS": "openai"}, `PM_EMBEDDINGS="openai" is not supported`},
		{map[string]string{"PM_EMBEDDINGS": "builtin", "PM_EMBEDDINGS_DIMENSIONS": "4000"}, "must be a whole number from 8 to 2000"},
		{map[string]string{"PM_EMBEDDINGS": "builtin", "PM_EMBEDDINGS_DIMENSIONS": "many"}, "must be a whole number from 8 to 2000"},
		{map[string]string{"PM_EMBEDDINGS": "builtin", "PM_CHUNK_MAX_CHARS": "10"}, "PM_CHUNK_MAX_CHARS"},
	} {
		_, err := Load(with(tc.env))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%v: %v, want %q", tc.env, err, tc.want)
		}
	}
}
