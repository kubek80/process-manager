package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestLoadDev(t *testing.T) {
	c, err := Load(env(map[string]string{"PM_AUTH": "dev", "DATABASE_URL": "postgres://x", "PM_CONTENT_DIR": "/data", "PM_CONTENT_WRITABLE": "true"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != "127.0.0.1:8080" || !c.ContentWritable || c.AccessFile != "/data/config/access.json" || len(c.SessionSecret) == 0 || c.Notify != "log" {
		t.Fatalf("unexpected config: %+v", c)
	}
	if c.Secure() {
		t.Fatal("http base URL must not be secure")
	}
}

func TestLoadProviders(t *testing.T) {
	secret := strings.Repeat("s", 32)
	base := map[string]string{"DATABASE_URL": "postgres://x", "PM_OIDC_CLIENT_ID": "id", "PM_OIDC_CLIENT_SECRET": "sec", "PM_SESSION_SECRET": secret, "PM_BASE_URL": "https://pm.example.com/"}
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

	c, err = Load(env(with(map[string]string{"PM_AUTH": "google", "PM_GOOGLE_HOSTED_DOMAIN": "example.com"})))
	if err != nil || c.Issuer != "https://accounts.google.com" || c.HostedDomain != "example.com" {
		t.Fatalf("google: %v %+v", err, c)
	}

	c, err = Load(env(with(map[string]string{"PM_AUTH": "google", "PM_OIDC_ISSUER": "http://fake"})))
	if err != nil || c.Issuer != "http://fake" {
		t.Fatalf("issuer override: %v %q", err, c.Issuer)
	}
}

func TestLoadRejects(t *testing.T) {
	cases := map[string]map[string]string{
		"PM_AUTH is required":            {"DATABASE_URL": "x"},
		"DATABASE_URL is required":       {"PM_AUTH": "dev"},
		"not supported":                  {"PM_AUTH": "ldap", "DATABASE_URL": "x"},
		"PM_ENTRA_TENANT is required":    {"PM_AUTH": "entra", "DATABASE_URL": "x", "PM_OIDC_CLIENT_ID": "a", "PM_OIDC_CLIENT_SECRET": "b", "PM_SESSION_SECRET": strings.Repeat("s", 32)},
		"PM_OIDC_CLIENT_ID":              {"PM_AUTH": "google", "DATABASE_URL": "x", "PM_SESSION_SECRET": strings.Repeat("s", 32)},
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
