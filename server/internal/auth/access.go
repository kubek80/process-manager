package auth

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"sort"
	"strings"
)

// Access says who may do what. Identity comes from the sign-in provider; roles come from this
// file, so they work the same with Entra, Google and the dev picker.
type Access struct {
	Editors []string            `json:"editors"`
	Teams   map[string][]string `json:"teams"` // team id -> member emails
}

// Roles are the permissions of one user.
type Roles struct {
	Editor bool     `json:"editor"`
	Teams  []string `json:"teams"`
}

// LoadAccess reads the access file. A missing file means: nobody has extra rights.
func LoadAccess(path string) (Access, error) {
	var a Access
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return a, nil
	}
	if err != nil {
		return a, err
	}
	err = json.Unmarshal(data, &a)
	return a, err
}

func has(list []string, email string) bool {
	for _, e := range list {
		if strings.EqualFold(strings.TrimSpace(e), email) {
			return true
		}
	}
	return false
}

// RolesOf returns the roles of the user with this email.
func (a Access) RolesOf(email string) Roles {
	r := Roles{Editor: has(a.Editors, email), Teams: []string{}}
	for team, members := range a.Teams {
		if has(members, email) {
			r.Teams = append(r.Teams, team)
		}
	}
	sort.Strings(r.Teams)
	return r
}

// MemberOf reports whether the user belongs to the team.
func (r Roles) MemberOf(team string) bool {
	if team == "" {
		return false
	}
	for _, t := range r.Teams {
		if t == team {
			return true
		}
	}
	return false
}
