// Package embedding turns texts into vectors for search by meaning.
//
// Two providers sit behind one interface (Embedder), chosen by the setting PM_EMBEDDINGS:
//
//   - "builtin" runs inside the server. Nothing leaves the server. It is deterministic (the same
//     text gives the same vector on every machine) and needs no account, so development, the
//     tests and CI use it. It matches WORDS and word parts, not meaning: see builtin.go.
//   - "vertex" sends texts to Google Vertex AI (model gemini-embedding-001 by default). With it,
//     the text of every published process and standard is sent to Google when the index is
//     built or a document changes, and every search query is sent when someone searches by
//     meaning. Outside() reports this so the server can say so to operators and searchers.
//     Credentials come only from Google's Application Default Credentials. It is off unless
//     an operator switches it on.
//   - "off" (or empty): New returns no embedder and search by meaning is switched off.
//
// Every vector has length 1, so cosine similarity is a plain dot product. Texts are never logged.
package embedding

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strings"
)

// Purpose says whether texts are documents to be found or search queries. Some providers embed
// the two differently; builtin does not.
type Purpose int

// The purposes.
const (
	Document Purpose = iota
	Query
)

// Embedder turns texts into unit-length vectors.
type Embedder interface {
	Name() string    // "builtin" or "vertex:gemini-embedding-001": stored with every chunk
	Dimensions() int // the length of every vector
	Outside() bool   // true when text leaves the server
	// Embed returns one vector per text, in the same order.
	Embed(ctx context.Context, texts []string, p Purpose) ([][]float32, error)
}

// Options choose the provider. They mirror the settings PM_EMBEDDINGS, PM_EMBEDDINGS_MODEL,
// PM_EMBEDDINGS_DIMENSIONS, PM_VERTEX_PROJECT and PM_VERTEX_LOCATION.
type Options struct {
	Provider          string // "off" | "builtin" | "vertex"
	Model             string // vertex only; empty means DefaultModel
	Dimensions        int    // 64-3072; 0 means DefaultDimensions
	Project, Location string // vertex only, both required
	Endpoint          string // tests: the address of a stand-in for Vertex AI
	HTTPClient        *http.Client
}

// Defaults.
const (
	DefaultModel      = "gemini-embedding-001"
	DefaultDimensions = 768
	MinDimensions     = 64
	MaxDimensions     = 3072
)

// New checks the options and returns the embedder; (nil, nil) when the provider is "off" or
// empty. For vertex it also looks up the Google credentials (unless HTTPClient is set), so a
// missing credential stops the server at start rather than at the first search.
func New(ctx context.Context, o Options) (Embedder, error) {
	provider := strings.ToLower(strings.TrimSpace(o.Provider))
	if provider == "" || provider == "off" {
		return nil, nil
	}
	if o.Dimensions == 0 {
		o.Dimensions = DefaultDimensions
	}
	if o.Dimensions < MinDimensions || o.Dimensions > MaxDimensions {
		return nil, fmt.Errorf("embeddings: the vector size (PM_EMBEDDINGS_DIMENSIONS) must be between %d and %d, not %d", MinDimensions, MaxDimensions, o.Dimensions)
	}
	switch provider {
	case "builtin":
		return Builtin(o.Dimensions), nil
	case "vertex":
		return newVertex(ctx, o)
	}
	return nil, fmt.Errorf("embeddings: %q is not a provider; PM_EMBEDDINGS must be off, builtin or vertex", o.Provider)
}

// normalise scales v to length 1 and converts it to float32. A zero vector stays zero.
func normalise(v []float64) []float32 {
	var sum float64
	for _, x := range v {
		sum += float64(x * x) // the conversion stops the compiler from fusing a multiply-add on some processors, which would change the last bit
	}
	out := make([]float32, len(v))
	if sum == 0 {
		return out
	}
	n := math.Sqrt(sum)
	for i, x := range v {
		out[i] = float32(x / n)
	}
	return out
}
