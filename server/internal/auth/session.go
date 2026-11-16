// Package auth handles sign-in (OpenID Connect or the local dev picker), sessions and roles.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// User is the identity taken from the sign-in provider.
type User struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

const sessionCookie = "pm_session"

// Sessions issues and reads signed, stateless session cookies.
type Sessions struct {
	Secret []byte
	TTL    time.Duration
	Secure bool             // HTTPS-only cookies
	Now    func() time.Time // injectable for tests
}

func NewSessions(secret []byte, secure bool) *Sessions {
	return &Sessions{Secret: secret, TTL: 12 * time.Hour, Secure: secure, Now: time.Now}
}

type sessionPayload struct {
	User
	Exp int64 `json:"exp"`
	Iat int64 `json:"iat"` // issued at, in milliseconds
}

// Sign returns payload plus an HMAC, safe to put in a cookie.
func (s *Sessions) Sign(payload []byte) string {
	mac := hmac.New(sha256.New, s.Secret)
	mac.Write(payload)
	enc := base64.RawURLEncoding
	return enc.EncodeToString(payload) + "." + enc.EncodeToString(mac.Sum(nil))
}

// Verify checks a value produced by Sign and returns the payload.
func (s *Sessions) Verify(value string) ([]byte, bool) {
	body, sig, ok := strings.Cut(value, ".")
	if !ok {
		return nil, false
	}
	enc := base64.RawURLEncoding
	payload, err1 := enc.DecodeString(body)
	got, err2 := enc.DecodeString(sig)
	if err1 != nil || err2 != nil {
		return nil, false
	}
	mac := hmac.New(sha256.New, s.Secret)
	mac.Write(payload)
	if !hmac.Equal(got, mac.Sum(nil)) {
		return nil, false
	}
	return payload, true
}

func (s *Sessions) cookie(name, value string, maxAge int) *http.Cookie {
	return &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteLaxMode}
}

// Issue signs the user in.
func (s *Sessions) Issue(w http.ResponseWriter, u User) {
	now := s.Now()
	payload, _ := json.Marshal(sessionPayload{User: u, Exp: now.Add(s.TTL).Unix(), Iat: now.UnixMilli()})
	http.SetCookie(w, s.cookie(sessionCookie, s.Sign(payload), int(s.TTL.Seconds())))
}

// Clear signs the user out.
func (s *Sessions) Clear(w http.ResponseWriter) {
	http.SetCookie(w, s.cookie(sessionCookie, "", -1))
}

// Read returns the signed-in user, if the request carries a valid, unexpired session.
func (s *Sessions) Read(r *http.Request) (User, bool) {
	u, _, ok := s.ReadIssued(r)
	return u, ok
}

// ReadIssued is Read plus the moment the session was issued, which is what SignOuts compares.
func (s *Sessions) ReadIssued(r *http.Request) (User, time.Time, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return User{}, time.Time{}, false
	}
	payload, ok := s.Verify(c.Value)
	if !ok {
		return User{}, time.Time{}, false
	}
	var p sessionPayload
	if json.Unmarshal(payload, &p) != nil || p.Email == "" || s.Now().Unix() >= p.Exp {
		return User{}, time.Time{}, false
	}
	return p.User, time.UnixMilli(p.Iat), true
}
