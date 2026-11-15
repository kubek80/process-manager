package auth

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kubek80/process-manager/server/internal/auth/oidctest"
)

func TestSessionRoundTrip(t *testing.T) {
	s := NewSessions([]byte("secret"), false)
	rec := httptest.NewRecorder()
	s.Issue(rec, User{Email: "sam@example.com", Name: "Sam"})
	req := httptest.NewRequest("GET", "/", nil)
	for _, c := range rec.Result().Cookies() {
		if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
			t.Fatalf("cookie flags: %+v", c)
		}
		req.AddCookie(c)
	}
	u, ok := s.Read(req)
	if !ok || u.Email != "sam@example.com" || u.Name != "Sam" {
		t.Fatalf("got %+v %v", u, ok)
	}
}

func TestSessionRejectsTamperedExpiredAndForeign(t *testing.T) {
	s := NewSessions([]byte("secret"), true)
	now := time.Now()
	s.Now = func() time.Time { return now }
	rec := httptest.NewRecorder()
	s.Issue(rec, User{Email: "sam@example.com", Name: "Sam"})
	cookie := rec.Result().Cookies()[0]
	if !cookie.Secure {
		t.Fatal("secure sessions must set the Secure flag")
	}
	read := func(sess *Sessions, value string) bool {
		req := httptest.NewRequest("GET", "/", nil)
		req.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
		_, ok := sess.Read(req)
		return ok
	}
	if !read(s, cookie.Value) {
		t.Fatal("valid session rejected")
	}
	if read(s, "x"+cookie.Value) || read(s, cookie.Value+"x") || read(s, "garbage") || read(s, "") {
		t.Fatal("tampered session accepted")
	}
	if read(NewSessions([]byte("other"), true), cookie.Value) {
		t.Fatal("session signed with another secret accepted")
	}
	now = now.Add(13 * time.Hour)
	if read(s, cookie.Value) {
		t.Fatal("expired session accepted")
	}
	if _, ok := s.Read(httptest.NewRequest("GET", "/", nil)); ok {
		t.Fatal("request without a cookie accepted")
	}
	rec = httptest.NewRecorder()
	s.Clear(rec)
	if c := rec.Result().Cookies()[0]; c.MaxAge >= 0 {
		t.Fatalf("clear must expire the cookie: %+v", c)
	}
}

func TestDevUsers(t *testing.T) {
	if u, ok := DevUserByEmail("alex@example.com"); !ok || u.Name != "Alex Editor" {
		t.Fatalf("got %+v %v", u, ok)
	}
	if _, ok := DevUserByEmail("mallory@example.com"); ok {
		t.Fatal("unknown dev user accepted")
	}
	// every role belongs to a built-in user
	for _, r := range DevRoles {
		if _, ok := DevUserByEmail(r.Email); !ok {
			t.Errorf("role for unknown dev user %s", r.Email)
		}
	}
}

// signIn runs the whole browser flow against the fake provider and returns the outcome.
func signIn(t *testing.T, p *oidctest.Provider, hostedDomain string, tamper func(*http.Request)) (User, error) {
	t.Helper()
	sessions := NewSessions([]byte("secret"), false)
	var o *OIDC
	var got User
	var gotErr error
	mux := http.NewServeMux()
	app := httptest.NewServer(mux)
	t.Cleanup(app.Close)
	mux.HandleFunc("/auth/login", func(w http.ResponseWriter, r *http.Request) { o.Login(w, r) })
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		if tamper != nil {
			tamper(r)
		}
		got, gotErr = o.Callback(w, r)
	})
	var err error
	o, err = NewOIDC(context.Background(), sessions, p.Server.URL, p.ClientID, "client-secret", app.URL+"/auth/callback", hostedDomain)
	if err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	res, err := (&http.Client{Jar: jar}).Get(app.URL + "/auth/login")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return got, gotErr
}

func TestOIDCSignInGoogleStyle(t *testing.T) {
	p := oidctest.New(t, "client-1")
	p.Claims = map[string]any{"email": "Kim@Example.com", "name": "Kim Lee", "hd": "example.com"}
	u, err := signIn(t, p, "example.com", nil)
	if err != nil || u.Email != "kim@example.com" || u.Name != "Kim Lee" {
		t.Fatalf("got %+v, %v", u, err)
	}
}

func TestOIDCSignInEntraStyle(t *testing.T) {
	// Entra ID often sends no "email" claim: the sign-in name is in preferred_username.
	p := oidctest.New(t, "client-1")
	p.Claims = map[string]any{"preferred_username": "kim@contoso.com", "name": "Kim Lee"}
	u, err := signIn(t, p, "", nil)
	if err != nil || u.Email != "kim@contoso.com" {
		t.Fatalf("got %+v, %v", u, err)
	}
	p.Claims = map[string]any{"upn": "kim@contoso.com"}
	u, err = signIn(t, p, "", nil)
	if err != nil || u.Email != "kim@contoso.com" || u.Name != "kim@contoso.com" {
		t.Fatalf("upn fallback: %+v, %v", u, err)
	}
}

func TestOIDCRejects(t *testing.T) {
	cases := []struct {
		name, want, hd string
		claims         map[string]any
		breakNonce     bool
		tamper         func(*http.Request)
	}{
		{name: "other workspace domain", want: "only accounts of example.com", hd: "example.com", claims: map[string]any{"email": "x@evil.com", "hd": "evil.com"}},
		{name: "no email", want: "did not share an email", claims: map[string]any{"name": "Nobody"}},
		{name: "wrong nonce", want: "nonce does not match", claims: map[string]any{"email": "a@b.c"}, breakNonce: true},
		{name: "wrong state", want: "state does not match", claims: map[string]any{"email": "a@b.c"}, tamper: func(r *http.Request) {
			q := r.URL.Query()
			q.Set("state", "forged")
			r.URL.RawQuery = q.Encode()
		}},
		{name: "bad code", want: "exchange sign-in code", claims: map[string]any{"email": "a@b.c"}, tamper: func(r *http.Request) {
			q := r.URL.Query()
			q.Set("code", "nope")
			r.URL.RawQuery = q.Encode()
		}},
		{name: "provider error", want: "refused: access_denied", claims: map[string]any{"email": "a@b.c"}, tamper: func(r *http.Request) {
			q := r.URL.Query()
			q.Set("error", "access_denied")
			r.URL.RawQuery = q.Encode()
		}},
		{name: "no flow cookie", want: "not started in this browser", claims: map[string]any{"email": "a@b.c"}, tamper: func(r *http.Request) { r.Header.Del("Cookie") }},
		{name: "forged flow cookie", want: "state is invalid", claims: map[string]any{"email": "a@b.c"}, tamper: func(r *http.Request) {
			r.Header.Set("Cookie", flowCookie+"=forged.value")
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := oidctest.New(t, "client-1")
			p.Claims, p.BreakNonce = c.claims, c.breakNonce
			_, err := signIn(t, p, c.hd, c.tamper)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want error containing %q, got %v", c.want, err)
			}
		})
	}
}

func TestOIDCRejectsTokenForAnotherClient(t *testing.T) {
	p := oidctest.New(t, "client-1")
	p.Claims = map[string]any{"email": "a@b.c", "aud": "someone-else"}
	if _, err := signIn(t, p, "", nil); err == nil || !strings.Contains(err.Error(), "verify identity token") {
		t.Fatalf("got %v", err)
	}
}

func TestOIDCDiscoveryFailure(t *testing.T) {
	dead := httptest.NewServer(http.NotFoundHandler())
	defer dead.Close()
	if _, err := NewOIDC(context.Background(), NewSessions([]byte("s"), false), dead.URL, "id", "sec", "http://x/cb", ""); err == nil {
		t.Fatal("expected discovery to fail")
	}
}
