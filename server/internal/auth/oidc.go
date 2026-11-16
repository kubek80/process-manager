package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const flowCookie = "pm_signin"

// OIDC signs users in with any OpenID Connect provider. Entra ID and Google only differ in
// the issuer and in which claim carries the email address.
type OIDC struct {
	sessions *Sessions
	verifier *oidc.IDTokenVerifier
	oauth    oauth2.Config
	opts     OIDCOptions
	client   *http.Client
}

// OIDCOptions describes the provider and who may sign in.
type OIDCOptions struct {
	Issuer, ClientID, ClientSecret string
	RedirectURL                    string // must be registered with the provider
	// HostedDomain limits Google sign-in to one Workspace domain.
	HostedDomain string
	// EmailDomains, when set, limits sign-in to addresses of these domains.
	EmailDomains []string
	// PreferSignInName takes the sign-in name (preferred_username, upn) before the email
	// claim. Entra ID: the sign-in name is set by the tenant, the email claim can be edited.
	PreferSignInName bool
}

// providerTimeout bounds every call to the provider, so that one that does not answer cannot
// hold a start-up or a sign-in forever.
const providerTimeout = 10 * time.Second

// NewOIDC discovers the provider.
func NewOIDC(ctx context.Context, sessions *Sessions, opts OIDCOptions) (*OIDC, error) {
	client := &http.Client{Timeout: providerTimeout}
	// the provider keeps this context for fetching its signing keys later: it carries the
	// client, but no deadline of its own
	provider, err := oidc.NewProvider(oidc.ClientContext(context.WithoutCancel(ctx), client), opts.Issuer)
	if err != nil {
		return nil, fmt.Errorf("discover sign-in provider %s: %w", opts.Issuer, err)
	}
	return &OIDC{
		sessions: sessions,
		verifier: provider.Verifier(&oidc.Config{ClientID: opts.ClientID}),
		opts:     opts,
		client:   client,
		oauth: oauth2.Config{
			ClientID: opts.ClientID, ClientSecret: opts.ClientSecret, RedirectURL: opts.RedirectURL,
			Endpoint: provider.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "profile", "email"},
		},
	}, nil
}

// signInError is what went wrong during a sign-in. Its text goes to the log; only Public is
// shown to the person (a provider's raw answer has no place in an address bar).
type signInError struct {
	Public string
	cause  error
}

func (e *signInError) Error() string {
	if e.cause == nil {
		return e.Public
	}
	return e.Public + ": " + e.cause.Error()
}
func (e *signInError) Unwrap() error { return e.cause }

func refused(public string) error { return &signInError{Public: public} }
func failed(public, what string, cause error) error {
	return &signInError{Public: public, cause: fmt.Errorf("%s: %w", what, cause)}
}

// PublicMessage is the part of a sign-in error that can be shown to the person.
func PublicMessage(err error) string {
	var e *signInError
	if errors.As(err, &e) {
		return e.Public
	}
	return "The sign-in did not work. Try again; if it keeps failing, tell whoever runs this portal."
}

type flowState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
}

func randomString() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Login redirects the browser to the provider.
func (o *OIDC) Login(w http.ResponseWriter, r *http.Request) {
	f := flowState{State: randomString(), Nonce: randomString(), Verifier: oauth2.GenerateVerifier()}
	payload, _ := json.Marshal(f)
	http.SetCookie(w, o.sessions.cookie(flowCookie, o.sessions.Sign(payload), 600))
	opts := []oauth2.AuthCodeOption{oidc.Nonce(f.Nonce), oauth2.S256ChallengeOption(f.Verifier)}
	if o.opts.HostedDomain != "" {
		opts = append(opts, oauth2.SetAuthURLParam("hd", o.opts.HostedDomain))
	}
	http.Redirect(w, r, o.oauth.AuthCodeURL(f.State, opts...), http.StatusFound)
}

// Callback finishes the sign-in and returns the user. It does not set the session.
func (o *OIDC) Callback(w http.ResponseWriter, r *http.Request) (User, error) {
	c, err := r.Cookie(flowCookie)
	if err != nil {
		return User{}, refused("The sign-in was not started in this browser. Start again.")
	}
	http.SetCookie(w, o.sessions.cookie(flowCookie, "", -1))
	payload, ok := o.sessions.Verify(c.Value)
	var f flowState
	if !ok || json.Unmarshal(payload, &f) != nil {
		return User{}, refused("The sign-in state is invalid. Start again.")
	}
	if msg := r.URL.Query().Get("error"); msg != "" {
		return User{}, failed("The sign-in provider did not let you in.", "the sign-in provider refused", errors.New(msg))
	}
	if r.URL.Query().Get("state") != f.State || f.State == "" {
		return User{}, refused("The sign-in state does not match. Start again.")
	}
	ctx := oidc.ClientContext(r.Context(), o.client)
	token, err := o.oauth.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(f.Verifier))
	if err != nil {
		return User{}, failed("The sign-in could not be completed. Try again.", "exchange sign-in code", err)
	}
	raw, _ := token.Extra("id_token").(string)
	if raw == "" {
		return User{}, failed("The sign-in could not be completed. Try again.", "the sign-in provider returned no identity token", errors.New("id_token missing"))
	}
	idToken, err := o.verifier.Verify(ctx, raw)
	if err != nil {
		return User{}, failed("The sign-in could not be completed. Try again.", "verify identity token", err)
	}
	if idToken.Nonce != f.Nonce {
		return User{}, failed("The sign-in could not be completed. Try again.", "identity token nonce does not match", errors.New("nonce"))
	}
	var claims struct {
		Email             string `json:"email"`
		EmailVerified     any    `json:"email_verified"`     // Google: a boolean; some providers send "true"
		PreferredUsername string `json:"preferred_username"` // Entra ID puts the sign-in name here
		UPN               string `json:"upn"`
		Name              string `json:"name"`
		HostedDomain      string `json:"hd"` // Google Workspace domain
	}
	if err := idToken.Claims(&claims); err != nil {
		return User{}, err
	}
	if o.opts.HostedDomain != "" && !strings.EqualFold(claims.HostedDomain, o.opts.HostedDomain) {
		return User{}, refused(fmt.Sprintf("Only accounts of %s may sign in.", o.opts.HostedDomain))
	}
	// an address the provider says it has not verified proves nothing about who this is
	if v := claims.EmailVerified; v == false || v == "false" {
		claims.Email = ""
	}
	candidates := []string{claims.Email, claims.PreferredUsername, claims.UPN}
	if o.opts.PreferSignInName {
		// never the email claim: people can edit it in some tenants and it is not verified
		candidates = []string{claims.PreferredUsername, claims.UPN}
	}
	email := ""
	for _, c := range candidates {
		if email == "" && strings.Contains(c, "@") {
			email = c
		}
	}
	if email == "" {
		return User{}, refused("The sign-in provider did not share a verified email address.")
	}
	email = strings.ToLower(email)
	if len(o.opts.EmailDomains) > 0 {
		allowed := false
		for _, d := range o.opts.EmailDomains {
			allowed = allowed || strings.HasSuffix(email, "@"+strings.ToLower(d))
		}
		if !allowed {
			return User{}, refused(fmt.Sprintf("Only accounts of %s may sign in.", strings.Join(o.opts.EmailDomains, ", ")))
		}
	}
	name := claims.Name
	if name == "" {
		name = email
	}
	return User{Email: email, Name: name}, nil
}
