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

// Roles. Some are limited to one team, platform or practice through the scope of the
// assignment.
const (
	Admin           = "admin"            // everything, including access
	CatalogManager  = "catalog-manager"  // the lists
	ProcessEditor   = "process-editor"   // all processes
	StandardsEditor = "standards-editor" // all standards
	Owner           = "owner"            // reviews, feedback and drafts of what one team owns (scope: a team)
	PlatformOwner   = "platform-owner"   // edits what belongs to one platform (scope: a platform)
	PracticeOwner   = "practice-owner"   // edits what belongs to one practice (scope: a practice)
)

// Roles in the order the Admin panel shows them.
var Roles = []string{Admin, CatalogManager, ProcessEditor, StandardsEditor, Owner, PlatformOwner, PracticeOwner}

// ScopeList names the list the scope of a role comes from ("teams", "platforms" or
// "practices"); "" for a role that takes no scope.
func ScopeList(role string) string {
	switch role {
	case Owner:
		return "teams"
	case PlatformOwner:
		return "platforms"
	case PracticeOwner:
		return "practices"
	}
	return ""
}

// ScopeNoun is the word for what the scope of a role names: "team", "platform", "practice".
func ScopeNoun(role string) string {
	switch role {
	case Owner:
		return "team"
	case PlatformOwner:
		return "platform"
	case PracticeOwner:
		return "practice"
	}
	return ""
}

var (
	// ErrInvalid marks an assignment that makes no sense.
	ErrInvalid = errors.New("invalid")
	// ErrLastAdmin protects against locking everyone out.
	ErrLastAdmin = errors.New("this is the last admin")
	// ErrNotGiven is returned when a role is taken away that the person does not have.
	ErrNotGiven = errors.New("that role was not given")

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
	Admin     bool     `json:"admin"`
	Catalog   bool     `json:"catalog"`   // edit the lists
	Processes bool     `json:"processes"` // edit every process
	Standards bool     `json:"standards"` // edit every standard
	Owns      []string `json:"owns"`      // teams: reviews, feedback and drafts of what they own
	Platforms []string `json:"platforms"` // edit the processes and standards of these platforms
	Practices []string `json:"practices"` // edit the processes and standards of these practices
}

// PermsFrom combines assignments. bootstrap marks an admin named in the server settings.
func PermsFrom(assignments []Assignment, bootstrap bool) Perms {
	p := Perms{Admin: bootstrap, Owns: []string{}, Platforms: []string{}, Practices: []string{}}
	for _, a := range assignments {
		// A role that covers everything gives nothing when it carries a scope: such an
		// assignment can only come from an earlier version (a restored backup, an older server
		// during an update). The Admin panel still lists it, so that it can be removed.
		if a.Scope != "" && ScopeList(a.Role) == "" {
			continue
		}
		switch a.Role {
		case Admin:
			p.Admin = true
		case CatalogManager:
			p.Catalog = true
		case ProcessEditor:
			p.Processes = true
		case StandardsEditor:
			p.Standards = true
		case Owner:
			p.Owns = append(p.Owns, a.Scope)
		case PlatformOwner:
			p.Platforms = append(p.Platforms, a.Scope)
		case PracticeOwner:
			p.Practices = append(p.Practices, a.Scope)
		}
	}
	if p.Admin {
		p.Catalog, p.Processes, p.Standards = true, true, true
	}
	sort.Strings(p.Owns)
	sort.Strings(p.Platforms)
	sort.Strings(p.Practices)
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

// Belongs is what a process or standard belongs to, as its content says: the team that
// maintains it, and the platform and practice it is part of. Any of them may be empty.
type Belongs struct {
	Owner    string // team id
	Platform string // platform id
	Practice string // practice id
}

// CanEdit reports whether the person may change (save, create, delete) a document of this
// kind that belongs to b: editors of the kind, and the owners of its platform or practice.
// For the lists b does not matter.
func (p Perms) CanEdit(kind string, b Belongs) bool {
	switch kind {
	case "process":
		return p.Processes || in(p.Platforms, b.Platform) || in(p.Practices, b.Practice)
	case "standard":
		return p.Standards || in(p.Platforms, b.Platform) || in(p.Practices, b.Practice)
	case "catalog":
		return p.Catalog
	}
	return false
}

// CanManageFeedback: whoever may edit the thing, and the team that owns it. The same people
// confirm its reviews and see it while it is a draft.
func (p Perms) CanManageFeedback(kind string, b Belongs) bool {
	return p.CanEdit(kind, b) || in(p.Owns, b.Owner)
}

// EditsAll reports whether the person edits every document of this kind: admins, process
// editors for processes, standards editors for standards.
func (p Perms) EditsAll(kind string) bool {
	switch kind {
	case "process":
		return p.Processes
	case "standard":
		return p.Standards
	case "catalog":
		return p.Catalog
	}
	return false
}

// Misplaced checks a save by somebody who edits a document only because they own its
// platform or practice: such a person may put it on a platform, or take it off one, only for
// platforms they own - the same for practices, separately. Another platform or practice that
// shares the document keeps it. before is the stored document (nil when it is created).
// The result names the first field ("platform" or "practice") and the id that is not theirs;
// field is "" when the save is fine. People who edit every document of the kind are not limited.
func (p Perms) Misplaced(kind string, before *Belongs, after Belongs) (field, id string) {
	if p.EditsAll(kind) {
		return "", ""
	}
	var was Belongs
	if before != nil {
		was = *before
	}
	check := func(owned []string, old, now string) string {
		if old == now {
			return ""
		}
		if old != "" && !in(owned, old) {
			return old
		}
		if now != "" && !in(owned, now) {
			return now
		}
		return ""
	}
	if id := check(p.Platforms, was.Platform, after.Platform); id != "" {
		return "platform", id
	}
	if id := check(p.Practices, was.Practice, after.Practice); id != "" {
		return "practice", id
	}
	return "", ""
}

// EditsSome reports whether the person may edit some, but not necessarily all, documents of
// this kind: through a platform or a practice.
func (p Perms) EditsSome() bool { return len(p.Platforms)+len(p.Practices) > 0 }

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

// Member is one person in a team, platform or practice: an assignment of a scoped role.
type Member struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	Scope string `json:"scope"`
}

// Members lists every assignment of the roles that are limited to a team, platform or
// practice, sorted by role, scope and email. It is what everyone may know about who belongs to
// what; who gave a role and when is for admins.
func (s *Store) Members(ctx context.Context) ([]Member, error) {
	rows, err := s.Pool.Query(ctx, `select email, role, scope from role_assignments where role = any($1) order by role collate "C", scope collate "C", email collate "C"`,
		[]string{Owner, PlatformOwner, PracticeOwner})
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.Email, &m.Role, &m.Scope); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Perms returns what the person with this email may do.
func (s *Store) Perms(ctx context.Context, email string) (Perms, error) {
	list, err := s.query(ctx, "where email = $1", norm(email))
	if err != nil {
		return Perms{}, err
	}
	return PermsFrom(list, s.IsBootstrap(email)), nil
}

// Label is the name of a role as the Admin panel shows it.
func Label(role string) string {
	switch role {
	case Admin:
		return "Admin"
	case CatalogManager:
		return "Lists manager"
	case ProcessEditor:
		return "Process editor"
	case StandardsEditor:
		return "Standards editor"
	case Owner:
		return "Owner"
	case PlatformOwner:
		return "Platform owner"
	case PracticeOwner:
		return "Practice owner"
	}
	return role
}

// covers says, for a role that cannot be limited, what it always covers.
var covers = map[string]string{
	Admin:           "An admin always covers everything",
	CatalogManager:  "A lists manager always covers all the lists",
	ProcessEditor:   "A process editor always covers all processes",
	StandardsEditor: "A standards editor always covers all standards",
}

// Check validates an assignment before it is stored. Whether the team, platform or practice
// of a scope exists is for the caller to check against the lists. The messages are for the
// people who manage access.
func Check(a Assignment) error {
	if !emailPattern.MatchString(a.Email) {
		return fmt.Errorf("%w: %q is not an email address.", ErrInvalid, a.Email)
	}
	switch a.Role {
	case Admin, CatalogManager, ProcessEditor, StandardsEditor:
		if a.Scope != "" {
			return fmt.Errorf("%w: %s: it cannot be limited to a team, platform or practice.", ErrInvalid, covers[a.Role])
		}
	case Owner, PlatformOwner, PracticeOwner:
		noun := ScopeNoun(a.Role)
		article := "A"
		if a.Role == Owner {
			article = "An"
		}
		if a.Scope == "" {
			return fmt.Errorf("%w: %s %s needs the %s it is for.", ErrInvalid, article, strings.ToLower(Label(a.Role)), noun)
		}
		if !scopePattern.MatchString(a.Scope) {
			return fmt.Errorf("%w: %q is not the id of a %s.", ErrInvalid, a.Scope, noun)
		}
	default:
		return fmt.Errorf("%w: There is no role %q.", ErrInvalid, a.Role)
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
	tag, err := s.Pool.Exec(ctx, `delete from role_assignments where email = $1 and role = $2 and scope = $3`, email, role, scope)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotGiven
	}
	return err
}

// Count returns the number of assignments.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `select count(*) from role_assignments`).Scan(&n)
	return n, err
}
