// Package content reads (and, in local development, writes) the process and catalog files.
// The files are the source of truth; in production they come from the repository.
package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var idPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ErrInvalid marks input the caller must fix.
var ErrInvalid = errors.New("invalid")

// ValidID reports whether id is safe to use as a file name.
func ValidID(id string) bool { return len(id) <= 80 && idPattern.MatchString(id) }

type Store struct{ Dir string }

type Broken struct {
	File  string `json:"file"`
	Error string `json:"error"`
}

func (s *Store) processDir() string  { return filepath.Join(s.Dir, "processes") }
func (s *Store) catalogFile() string { return filepath.Join(s.Dir, "catalog", "catalog.json") }

// Processes returns every process file as raw JSON, plus the files that are not valid JSON.
func (s *Store) Processes() ([]json.RawMessage, []Broken, error) {
	list, broken := []json.RawMessage{}, []Broken{}
	entries, err := os.ReadDir(s.processDir())
	if errors.Is(err, fs.ErrNotExist) {
		return list, broken, nil
	}
	if err != nil {
		return nil, nil, err
	}
	names := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(s.processDir(), name))
		if err == nil && !json.Valid(data) {
			err = errors.New("not valid JSON")
		}
		if err != nil {
			broken = append(broken, Broken{File: name, Error: err.Error()})
			continue
		}
		list = append(list, json.RawMessage(data))
	}
	return list, broken, nil
}

// Catalog returns the teams, tools, tiers and languages.
func (s *Store) Catalog() (json.RawMessage, error) {
	data, err := os.ReadFile(s.catalogFile())
	if errors.Is(err, fs.ErrNotExist) {
		return json.RawMessage(`{"tiers":[],"languages":[],"teams":[],"tools":[]}`), nil
	}
	if err != nil {
		return nil, err
	}
	if !json.Valid(data) {
		return nil, errors.New("catalog/catalog.json is not valid JSON")
	}
	return data, nil
}

// pretty re-indents JSON without changing the order of the keys.
func pretty(body []byte) ([]byte, error) {
	var buf bytes.Buffer
	if err := json.Indent(&buf, bytes.TrimSpace(body), "", "  "); err != nil {
		return nil, fmt.Errorf("%w: not valid JSON: %v", ErrInvalid, err)
	}
	buf.WriteByte('\n')
	return buf.Bytes(), nil
}

func writeFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// PutProcess writes processes/<id>.json. The body must be an object whose "id" equals id.
func (s *Store) PutProcess(id string, body []byte) error {
	if !ValidID(id) {
		return fmt.Errorf("%w: process id %q", ErrInvalid, id)
	}
	var head struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &head); err != nil {
		return fmt.Errorf("%w: not a JSON object: %v", ErrInvalid, err)
	}
	if head.ID != id {
		return fmt.Errorf("%w: the id in the file (%q) must match the address (%q)", ErrInvalid, head.ID, id)
	}
	data, err := pretty(body)
	if err != nil {
		return err
	}
	return writeFile(filepath.Join(s.processDir(), id+".json"), data)
}

// DeleteProcess removes processes/<id>.json. Removing a missing file is not an error.
func (s *Store) DeleteProcess(id string) error {
	if !ValidID(id) {
		return fmt.Errorf("%w: process id %q", ErrInvalid, id)
	}
	err := os.Remove(filepath.Join(s.processDir(), id+".json"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

// PutCatalog replaces catalog/catalog.json.
func (s *Store) PutCatalog(body []byte) error {
	var shape map[string]json.RawMessage
	if err := json.Unmarshal(body, &shape); err != nil {
		return fmt.Errorf("%w: not a JSON object: %v", ErrInvalid, err)
	}
	data, err := pretty(body)
	if err != nil {
		return err
	}
	return writeFile(s.catalogFile(), data)
}

// Info is what the feedback logic needs to know about a process.
type Info struct {
	ID     string
	Title  string
	Owner  string            // team id
	Steps  map[string]string // step id -> fingerprint of the step's content
	Titles map[string]string // step id -> title
}

// Info reads one process. ok is false when it does not exist or cannot be parsed.
func (s *Store) Info(id string) (Info, bool) {
	if !ValidID(id) {
		return Info{}, false
	}
	data, err := os.ReadFile(filepath.Join(s.processDir(), id+".json"))
	if err != nil {
		return Info{}, false
	}
	var p struct {
		ID    string            `json:"id"`
		Title string            `json:"title"`
		Owner string            `json:"owner"`
		Steps []json.RawMessage `json:"steps"`
	}
	if json.Unmarshal(data, &p) != nil {
		return Info{}, false
	}
	info := Info{ID: p.ID, Title: p.Title, Owner: p.Owner, Steps: map[string]string{}, Titles: map[string]string{}}
	for _, raw := range p.Steps {
		var step map[string]any
		if json.Unmarshal(raw, &step) != nil {
			continue
		}
		sid, _ := step["id"].(string)
		if sid == "" {
			continue
		}
		info.Steps[sid] = fingerprint(step)
		info.Titles[sid], _ = step["title"].(string)
	}
	return info, true
}

// fingerprint changes whenever anything in the step changes. encoding/json sorts map keys,
// so formatting and key order do not affect it.
func fingerprint(step map[string]any) string {
	canonical, _ := json.Marshal(step)
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:8])
}

// Team is a catalog team.
type Team struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Contact string `json:"contact"`
}

// Team looks a team up in the catalog.
func (s *Store) Team(id string) (Team, bool) {
	raw, err := s.Catalog()
	if err != nil || id == "" {
		return Team{}, false
	}
	var c struct {
		Teams []Team `json:"teams"`
	}
	if json.Unmarshal(raw, &c) != nil {
		return Team{}, false
	}
	for _, t := range c.Teams {
		if t.ID == id {
			return t, true
		}
	}
	return Team{}, false
}
