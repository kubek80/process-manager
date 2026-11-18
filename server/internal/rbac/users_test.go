package rbac_test

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

func roleList(list []rbac.Assignment) string {
	out := ""
	for _, a := range list {
		if out != "" {
			out += ","
		}
		out += a.Role
		if a.Scope != "" {
			out += ":" + a.Scope
		}
	}
	return out
}

func TestReplaceGivesExactlyTheRolesSent(t *testing.T) {
	s := &rbac.Store{Pool: dbtest.NewPool(t)}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.Grant(ctx, rbac.Assignment{Email: "boss@example.com", Role: rbac.Admin, GrantedBy: "setup"}))
	must(s.Grant(ctx, rbac.Assignment{Email: "alex@example.com", Role: rbac.ProcessEditor, GrantedBy: "first"}))
	must(s.Grant(ctx, rbac.Assignment{Email: "alex@example.com", Role: rbac.Owner, Scope: "devex", GrantedBy: "first"}))

	ch, err := s.Replace(ctx, "  Alex@Example.com ", []rbac.Role{
		{Role: rbac.Owner, Scope: "devex"}, {Role: rbac.PlatformOwner, Scope: "google-cloud"}, {Role: rbac.CatalogManager}, {Role: rbac.CatalogManager},
	}, "boss@example.com")
	must(err)
	if roleList(ch.Added) != "catalog-manager,platform-owner:google-cloud" || roleList(ch.Removed) != "process-editor" {
		t.Fatalf("change: +%s -%s", roleList(ch.Added), roleList(ch.Removed))
	}
	u, err := s.UserOf(ctx, "alex@example.com")
	must(err)
	if roleList(u.Roles) != "catalog-manager,owner:devex,platform-owner:google-cloud" {
		t.Fatalf("roles: %s", roleList(u.Roles))
	}
	for _, a := range u.Roles {
		want := "boss@example.com"
		if a.Role == rbac.Owner {
			want = "first" // kept as it was
		}
		if a.GrantedBy != want || a.GrantedAt.IsZero() {
			t.Fatalf("%+v", a)
		}
	}
	// the same set again changes nothing
	ch, err = s.Replace(ctx, "alex@example.com", []rbac.Role{{Role: rbac.Owner, Scope: "devex"}, {Role: rbac.PlatformOwner, Scope: "google-cloud"}, {Role: rbac.CatalogManager}}, "x")
	if err != nil || len(ch.Added)+len(ch.Removed) != 0 {
		t.Fatalf("again: %+v %v", ch, err)
	}

	// every role is checked as when it is given alone; nothing is changed when one is wrong
	for _, bad := range [][]rbac.Role{
		{{Role: rbac.CatalogManager}, {Role: rbac.Owner}},
		{{Role: rbac.Admin, Scope: "devex"}},
		{{Role: "superuser"}},
		{{Role: rbac.PracticeOwner, Scope: "Not An Id"}},
	} {
		if _, err := s.Replace(ctx, "alex@example.com", bad, "x"); !errors.Is(err, rbac.ErrInvalid) {
			t.Fatalf("%v: %v", bad, err)
		}
	}
	if _, err := s.Replace(ctx, "not an email", nil, "x"); !errors.Is(err, rbac.ErrInvalid) {
		t.Fatalf("email: %v", err)
	}
	if u, _ := s.UserOf(ctx, "alex@example.com"); len(u.Roles) != 3 {
		t.Fatalf("changed by a refused replacement: %s", roleList(u.Roles))
	}

	// the last admin keeps the role; with another admin it may go, also from oneself
	if _, err := s.Replace(ctx, "boss@example.com", nil, "boss@example.com"); !errors.Is(err, rbac.ErrLastAdmin) {
		t.Fatalf("last admin: %v", err)
	}
	if _, err := s.Replace(ctx, "boss@example.com", []rbac.Role{{Role: rbac.ProcessEditor}}, "boss@example.com"); !errors.Is(err, rbac.ErrLastAdmin) {
		t.Fatalf("last admin: %v", err)
	}
	_, err = s.Replace(ctx, "alex@example.com", []rbac.Role{{Role: rbac.Admin}}, "boss@example.com")
	must(err)
	_, err = s.Replace(ctx, "boss@example.com", nil, "boss@example.com")
	must(err)
	users, err := s.Users(ctx)
	must(err)
	if len(users) != 1 || users[0].Email != "alex@example.com" || roleList(users[0].Roles) != "admin" || users[0].Bootstrap {
		t.Fatalf("users: %+v", users)
	}

	// with an admin in the server settings, the last stored admin may go; the settings' admin is listed
	b := &rbac.Store{Pool: s.Pool, Bootstrap: []string{"Root@Example.com"}}
	_, err = b.Replace(ctx, "alex@example.com", nil, "root@example.com")
	must(err)
	users, err = b.Users(ctx)
	must(err)
	if len(users) != 1 || users[0].Email != "root@example.com" || !users[0].Bootstrap || len(users[0].Roles) != 0 {
		t.Fatalf("users: %+v", users)
	}
}

// Two admins who take the admin role from each other at the same moment cannot both succeed.
func TestTheLastAdminIsKeptUnderConcurrency(t *testing.T) {
	s := &rbac.Store{Pool: dbtest.NewPool(t)}
	for round := 0; round < 5; round++ {
		if _, err := s.Pool.Exec(ctx, `delete from role_assignments`); err != nil {
			t.Fatal(err)
		}
		for _, e := range []string{"a@example.com", "b@example.com"} {
			if err := s.Grant(ctx, rbac.Assignment{Email: e, Role: rbac.Admin, GrantedBy: "x"}); err != nil {
				t.Fatal(err)
			}
		}
		var wg sync.WaitGroup
		errs := make([]error, 2)
		for i, e := range []string{"a@example.com", "b@example.com"} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if i == 0 {
					_, errs[i] = s.Replace(ctx, e, nil, "x")
				} else {
					errs[i] = s.Revoke(ctx, e, rbac.Admin, "")
				}
			}()
		}
		wg.Wait()
		var n int
		if err := s.Pool.QueryRow(ctx, `select count(*) from role_assignments where role = 'admin'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 || (errs[0] == nil) == (errs[1] == nil) {
			t.Fatalf("round %d: %d admins left, errors %v", round, n, errs)
		}
	}
}

// Many replacements of one person's roles at once: each is whole, none is mixed with another.
func TestConcurrentReplacementsOfOnePerson(t *testing.T) {
	s := &rbac.Store{Pool: dbtest.NewPool(t)}
	sets := [][]rbac.Role{
		{{Role: rbac.ProcessEditor}, {Role: rbac.Owner, Scope: "devex"}},
		{{Role: rbac.StandardsEditor}},
		{{Role: rbac.CatalogManager}, {Role: rbac.PlatformOwner, Scope: "azure"}, {Role: rbac.PracticeOwner, Scope: "security"}},
		{},
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Replace(ctx, "pat@example.com", sets[i%len(sets)], fmt.Sprint(i)); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	u, err := s.UserOf(ctx, "pat@example.com")
	if err != nil {
		t.Fatal(err)
	}
	got := roleList(u.Roles)
	for _, set := range sets {
		as := []rbac.Assignment{}
		for _, r := range set {
			as = append(as, rbac.Assignment{Role: r.Role, Scope: r.Scope})
		}
		rbac.SortAssignments(as)
		if roleList(as) == got {
			return
		}
	}
	t.Fatalf("a mix of sets: %s", got)
}
