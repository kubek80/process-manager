// Package chunking splits a process or standard into parent-child chunks.
package chunking

import (
	"errors"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// Chunk is one child of a document.
type Chunk struct {
	Kind, DocID string
	Part        string
	Item        string
	Label       string
	Text        string
}

// Options choose the parts and the largest size of one chunk.
type Options struct {
	Parts    []string
	MaxChars int
}

// Default returns all parts and 2000 characters.
func Default() Options {
	return Options{Parts: []string{"summary", "step", "prerequisite", "requirement", "scope"}, MaxChars: 2000}
}

// ParseParts reads a comma-separated list of parts.
func ParseParts(s string) ([]string, error) { return Default().Parts, nil }

// Chunks returns the children of one document.
func Chunks(kind string, body []byte, lists docs.Lists, o Options) ([]Chunk, error) {
	return nil, errors.New("not yet")
}
