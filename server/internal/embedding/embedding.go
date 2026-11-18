// Package embedding turns texts into vectors.
package embedding

import (
	"context"
	"net/http"
)

// Purpose says whether texts are documents or search queries.
type Purpose int

// Purposes.
const (
	Document Purpose = iota
	Query
)

// Embedder turns texts into unit-length vectors.
type Embedder interface {
	Name() string
	Dimensions() int
	Outside() bool
	Embed(ctx context.Context, texts []string, p Purpose) ([][]float32, error)
}

// Options choose the provider.
type Options struct {
	Provider          string
	Model             string
	Dimensions        int
	Project, Location string
	Endpoint          string
	HTTPClient        *http.Client
}

// New returns the embedder, or nil when switched off.
func New(ctx context.Context, o Options) (Embedder, error) { return nil, nil }
