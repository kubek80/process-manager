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

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const flowCookie = "pm_signin"

// OIDC signs users in with any OpenID Connect provider. Entra ID and Google only differ in
// the issuer and in which claim carries the email address.
type OIDC struct {
	sessions     *Sessions
	verifier     *oidc.IDTokenVerifier
	oauth        oauth2.Config
	hostedDomain string
}

// NewOIDC discovers the provider. redirectURL must be registered with the provider.
func NewOIDC(ctx context.Context, sessions *Sessions, issuer, clientID, clientSecret, redirectURL, hostedDomain string) (*OIDC, error) {
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("discover sign-in provider %s: %w", issuer, err)
	}
	return &OIDC{
		sessions:     sessions,
		verifier:     provider.Verifier(&oidc.Config{ClientID: clientID}),
		hostedDomain: hostedDomain,
		oauth: oauth2.Config{
			ClientID: clientID, ClientSecret: clientSecret, RedirectURL: redirectURL,
			Endpoint: provider.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "profile", "email"},
		},
	}, nil
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
	if o.hostedDomain != "" {
		opts = append(opts, oauth2.SetAuthURLParam("hd", o.hostedDomain))
	}
	http.Redirect(w, r, o.oauth.AuthCodeURL(f.State, opts...), http.StatusFound)
}

// Callback finishes the sign-in and returns the user. It does not set the session.
func (o *OIDC) Callback(w http.ResponseWriter, r *http.Request) (User, error) {
	c, err := r.Cookie(flowCookie)
	if err != nil {
		return User{}, errors.New("sign-in was not started in this browser")
	}
	http.SetCookie(w, o.sessions.cookie(flowCookie, "", -1))
	payload, ok := o.sessions.Verify(c.Value)
	var f flowState
	if !ok || json.Unmarshal(payload, &f) != nil {
		return User{}, errors.New("sign-in state is invalid")
	}
	if msg := r.URL.Query().Get("error"); msg != "" {
		return User{}, fmt.Errorf("the sign-in provider refused: %s", msg)
	}
	if r.URL.Query().Get("state") != f.State || f.State == "" {
		return User{}, errors.New("sign-in state does not match")
	}
	token, err := o.oauth.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(f.Verifier))
	if err != nil {
		return User{}, fmt.Errorf("exchange sign-in code: %w", err)
	}
	raw, _ := token.Extra("id_token").(string)
	if raw == "" {
		return User{}, errors.New("the sign-in provider returned no identity token")
	}
	idToken, err := o.verifier.Verify(r.Context(), raw)
	if err != nil {
		return User{}, fmt.Errorf("verify identity token: %w", err)
	}
	if idToken.Nonce != f.Nonce {
		return User{}, errors.New("identity token nonce does not match")
	}
	var claims struct {
		Email             string `json:"email"`
		PreferredUsername string `json:"preferred_username"` // Entra ID puts the sign-in name here
		UPN               string `json:"upn"`
		Name              string `json:"name"`
		HostedDomain      string `json:"hd"` // Google Workspace domain
	}
	if err := idToken.Claims(&claims); err != nil {
		return User{}, err
	}
	if o.hostedDomain != "" && !strings.EqualFold(claims.HostedDomain, o.hostedDomain) {
		return User{}, fmt.Errorf("only accounts of %s may sign in", o.hostedDomain)
	}
	email := claims.Email
	for _, alt := range []string{claims.PreferredUsername, claims.UPN} {
		if email == "" && strings.Contains(alt, "@") {
			email = alt
		}
	}
	if email == "" {
		return User{}, errors.New("the sign-in provider did not share an email address")
	}
	name := claims.Name
	if name == "" {
		name = email
	}
	return User{Email: strings.ToLower(email), Name: name}, nil
}
