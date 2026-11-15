// Package oidctest is a tiny fake OpenID Connect provider for tests. It signs real RS256
// identity tokens, so the production verification code runs unchanged against it.
package oidctest

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"
)

// Provider behaves like Entra ID or Google from the point of view of the server.
type Provider struct {
	Server   *httptest.Server
	ClientID string
	// Claims are added to the next identity token (email, name, hd, preferred_username...).
	Claims map[string]any
	// BreakNonce makes the provider return a token with the wrong nonce.
	BreakNonce bool

	key   *rsa.PrivateKey
	mu    sync.Mutex
	codes map[string]string // code -> nonce
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// New starts the fake provider; it is closed when the test ends.
func New(t testing.TB, clientID string) *Provider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	p := &Provider{ClientID: clientID, Claims: map[string]any{}, key: key, codes: map[string]string{}}
	mux := http.NewServeMux()
	p.Server = httptest.NewServer(mux)
	t.Cleanup(p.Server.Close)
	issuer := p.Server.URL

	writeJSON := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{
			"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token",
			"jwks_uri": issuer + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"keys": []map[string]any{{
			"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "test",
			"n": b64(key.N.Bytes()), "e": b64(big.NewInt(int64(key.E)).Bytes()),
		}}})
	})
	// The "user" approves immediately: send the browser back with a code.
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		code := b64([]byte(time.Now().Format(time.RFC3339Nano)))
		p.mu.Lock()
		p.codes[code] = q.Get("nonce")
		p.mu.Unlock()
		back, _ := url.Parse(q.Get("redirect_uri"))
		v := back.Query()
		v.Set("code", code)
		v.Set("state", q.Get("state"))
		back.RawQuery = v.Encode()
		http.Redirect(w, r, back.String(), http.StatusFound)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		p.mu.Lock()
		nonce, ok := p.codes[r.Form.Get("code")]
		delete(p.codes, r.Form.Get("code"))
		p.mu.Unlock()
		if !ok {
			http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
			return
		}
		if p.BreakNonce {
			nonce = "wrong"
		}
		writeJSON(w, map[string]any{"access_token": "at", "token_type": "Bearer", "expires_in": 3600, "id_token": p.token(issuer, nonce)})
	})
	return p
}

func (p *Provider) token(issuer, nonce string) string {
	claims := map[string]any{
		"iss": issuer, "aud": p.ClientID, "sub": "user-1", "nonce": nonce,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	}
	for k, v := range p.Claims {
		claims[k] = v
	}
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT", "kid": "test"})
	body, _ := json.Marshal(claims)
	signing := b64(header) + "." + b64(body)
	sum := sha256.Sum256([]byte(signing))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, p.key, crypto.SHA256, sum[:])
	return signing + "." + b64(sig)
}
