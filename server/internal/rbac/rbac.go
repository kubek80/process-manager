// Package rbac decides who may do what. Identity comes from the sign-in provider; roles are
// assigned in the Admin panel and stored in the database.
package rbac

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Roles. Some can be limited to one team or unit through the scope of the assignment.
const (
	Admin           = "admin"            // everything, including access
	CatalogManager  = "catalog-manager"  // the lists
	ProcessEditor   = "process-editor"   // all processes
	StandardsEditor = "standards-editor" // standards of one unit (scope) or of all (no scope)
	Owner           = "owner"            // closes feedback on what one team or unit owns (scope required)
)

// Roles in the order the Admin panel shows them.
var Roles = []string{Admin, CatalogManager, ProcessEditor, StandardsEditor, Owner}

var (
	// ErrInvalid marks an assignment that makes no sense.
	ErrInvalid = errors.New("invalid")
	// ErrLastAdmin protects against locking everyone out.
	ErrLastAdmin = errors.New("this is the last admin")

	emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	scopePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
)

// Assignment gives one person one role.
type Assignment struct {
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Scope     string    `json:"scope"`
	GrantedBy string    `json:"grantedBy"`
	GrantedAt time.Time `json:"grantedAt"`
}

// Perms is what one person may do, worked out from their assignments.
type Perms struct {
	Admin         bool     `json:"admin"`
	Catalog       bool     `json:"catalog"`       // edit the lists
	Processes     bool     `json:"processes"`     // edit every process
	Standards     bool     `json:"standards"`     // edit every standard
	StandardUnits []string `json:"standardUnits"` // edit the standards of these units
	Owns          []string `json:"owns"`          // close feedback on what these teams or units own
}

// PermsFrom combines assignments. bootstrap marks an admin named in the server settings.
func PermsFrom(assignments []Assignment, bootstrap bool) Perms {
	p := Perms{Admin: bootstrap, StandardUnits: []string{}, Owns: []string{}}
	for _, a := range assignments {
		switch a.Role {
		case Admin:
			p.Admin = true
		case CatalogManager:
			p.Catalog = true
		case ProcessEditor:
			p.Processes = true
		case StandardsEditor:
			if a.Scope == "" {
				p.Standards = true
			} else {
				p.StandardUnits = append(p.StandardUnits, a.Scope)
			}
		case Owner:
			p.Owns = append(p.Owns, a.Scope)
		}
	}
	if p.Admin {
		p.Catalog, p.Processes, p.Standards = true, true, true
	}
	sort.Strings(p.StandardUnits)
	sort.Strings(p.Owns)
	return p
}

func in(list []string, v string) bool {
	if v == "" {
		return false
	}
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// CanEditStandard: every standard, or those of the unit that owns this one.
func (p Perms) CanEditStandard(unit string) bool { return p.Standards || in(p.StandardUnits, unit) }

// CanEdit reports whether the person may change a document of this kind owned by owner.
func (p Perms) CanEdit(kind, owner string) bool {
	switch kind {
	case "process":
		return p.Processes
	case "standard":
		return p.CanEditStandard(owner)
	case "catalog":
		return p.Catalog
	}
	return false
}

// CanManageFeedback: whoever may edit the thing, and the team or unit that owns it.
func (p Perms) CanManageFeedback(kind, owner string) bool {
	return p.CanEdit(kind, owner) || in(p.Owns, owner)
}

// AnyStandards reports whether the person can edit at least some standards.
func (p Perms) AnyStandards() bool { return p.Standards || len(p.StandardUnits) > 0 }

// Store keeps the assignments.
type Store struct {
	Pool *pgxpool.Pool
	// Bootstrap admins come from the server settings and cannot be removed in the portal,
	// so there is always a way back in.
	Bootstrap []string
}

func norm(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// IsBootstrap reports whether the email is an admin named in the server settings.
func (s *Store) IsBootstrap(email string) bool {
	for _, b := range s.Bootstrap {
		if norm(b) == norm(email) {
			return true
		}
	}
	return false
}

func (s *Store) query(ctx context.Context, where string, args ...any) ([]Assignment, error) {
	rows, err := s.Pool.Query(ctx, `select email, role, scope, granted_by, granted_at from role_assignments `+where+` order by email, role, scope`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Assignment{}
	for rows.Next() {
		var a Assignment
		if err := rows.Scan(&a.Email, &a.Role, &a.Scope, &a.GrantedBy, &a.GrantedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// All lists every assignment.
func (s *Store) All(ctx context.Context) ([]Assignment, error) { return s.query(ctx, "") }

// Perms returns what the person with this email may do.
func (s *Store) Perms(ctx context.Context, email string) (Perms, error) {
	list, err := s.query(ctx, "where email = $1", norm(email))
	if err != nil {
		return Perms{}, err
	}
	return PermsFrom(list, s.IsBootstrap(email)), nil
}

// Check validates an assignment before it is stored.
func Check(a Assignment) error {
	if !emailPattern.MatchString(a.Email) {
		return fmt.Errorf("%w: %q is not an email address", ErrInvalid, a.Email)
	}
	switch a.Role {
	case Admin, CatalogManager, ProcessEditor:
		if a.Scope != "" {
			return fmt.Errorf("%w: the role %s cannot be limited to a team", ErrInvalid, a.Role)
		}
	case StandardsEditor:
		if a.Scope != "" && !scopePattern.MatchString(a.Scope) {
			return fmt.Errorf("%w: %q is not a unit id", ErrInvalid, a.Scope)
		}
	case Owner:
		if !scopePattern.MatchString(a.Scope) {
			return fmt.Errorf("%w: an owner needs the team or unit they own things for", ErrInvalid)
		}
	default:
		return fmt.Errorf("%w: unknown role %q", ErrInvalid, a.Role)
	}
	return nil
}

// Grant stores an assignment. Granting the same thing twice changes nothing.
func (s *Store) Grant(ctx context.Context, a Assignment) error {
	a.Email = norm(a.Email)
	if err := Check(a); err != nil {
		return err
	}
	_, err := s.Pool.Exec(ctx, `insert into role_assignments (email, role, scope, granted_by) values ($1, $2, $3, $4) on conflict do nothing`,
		a.Email, a.Role, a.Scope, a.GrantedBy)
	return err
}

// Revoke removes an assignment. The last admin cannot be removed unless the server settings
// name a bootstrap admin.
func (s *Store) Revoke(ctx context.Context, email, role, scope string) error {
	email = norm(email)
	if role == Admin && len(s.Bootstrap) == 0 {
		var others int
		if err := s.Pool.QueryRow(ctx, `select count(*) from role_assignments where role = 'admin' and email <> $1`, email).Scan(&others); err != nil {
			return err
		}
		if others == 0 {
			return ErrLastAdmin
		}
	}
	_, err := s.Pool.Exec(ctx, `delete from role_assignments where email = $1 and role = $2 and scope = $3`, email, role, scope)
	return err
}

// Count returns the number of assignments.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from role_assignments`).Scan(&n)
	return n, err
}
