// Package schema checks documents against the JSON schemas in schema/*.json. The same files
// drive the checker in the browser, so both sides agree on what a valid document is.
package schema

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"

	"github.com/kubek80/process-manager/server/internal/docs"
)

// Set holds the compiled schemas.
type Set struct{ byKind map[string]*jsonschema.Schema }

var english = message.NewPrinter(language.English)

var files = map[string]string{docs.Process: "process.schema.json", docs.Standard: "standard.schema.json", docs.Catalog: "catalog.schema.json"}

// Load compiles the schemas found in dir.
func Load(dir string) (*Set, error) {
	set := &Set{byKind: map[string]*jsonschema.Schema{}}
	for kind, name := range files {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, fmt.Errorf("schema for %s: %w", kind, err)
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		c := jsonschema.NewCompiler()
		url := "file:///" + name
		if err := c.AddResource(url, doc); err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		compiled, err := c.Compile(url)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		set.byKind[kind] = compiled
	}
	return set, nil
}

// Validate checks the shape of a document. The error wraps docs.ErrInvalid and names up to
// three problems; the browser shows the full, friendlier list before it ever sends a save.
func (s *Set) Validate(kind string, body []byte) error {
	compiled, ok := s.byKind[kind]
	if !ok {
		return fmt.Errorf("%w: unknown kind %q", docs.ErrInvalid, kind)
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("%w: not valid JSON: %v", docs.ErrInvalid, err)
	}
	err = compiled.Validate(value)
	if err == nil {
		return nil
	}
	var ve *jsonschema.ValidationError
	if !errors.As(err, &ve) {
		return fmt.Errorf("%w: %v", docs.ErrInvalid, err)
	}
	var problems []string
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			where := "/" + strings.Join(e.InstanceLocation, "/")
			problems = append(problems, where+": "+e.ErrorKind.LocalizedString(english))
			return
		}
		for _, c := range e.Causes {
			walk(c)
		}
	}
	walk(ve)
	more := ""
	if len(problems) > 3 {
		more = fmt.Sprintf(" (and %d more)", len(problems)-3)
		problems = problems[:3]
	}
	return fmt.Errorf("%w: does not match the format: %s%s", docs.ErrInvalid, strings.Join(problems, "; "), more)
}
