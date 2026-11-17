package rbac_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/kubek80/process-manager/server/internal/db/dbtest"
	"github.com/kubek80/process-manager/server/internal/rbac"
)

var ctx = context.Background()

type B = rbac.Belongs

func TestPermsFrom(t *testing.T) {
	none := rbac.PermsFrom(nil, false)
	if none.Admin || none.Catalog || none.Processes || none.Standards || none.Owns == nil || none.Platforms == nil || none.Practices == nil || none.EditsSome() {
		t.Fatalf("no roles: %+v", none)
	}
	everything := B{Owner: "x", Platform: "google-cloud", Practice: "security"}
	if none.CanEdit("process", everything) || none.CanEdit("standard", everything) || none.CanEdit("catalog", B{}) || none.CanManageFeedback("process", everything) {
		t.Fatal("no roles must grant nothing")
	}

	admin := rbac.PermsFrom(nil, true) // bootstrap admin
	for _, kind := range []string{"process", "standard", "catalog"} {
		if !admin.CanEdit(kind, B{}) || (kind != "catalog" && !admin.CanManageFeedback(kind, B{Owner: "anything"})) {
			t.Fatalf("admin cannot edit %s", kind)
		}
	}
	if admin.CanEdit("skill", B{}) {
		t.Fatal("unknown kind must be refused")
	}

	p := rbac.PermsFrom([]rbac.Assignment{
		{Role: rbac.Owner, Scope: "cloud-platform-team"}, {Role: rbac.Owner, Scope: "api-platform-team"}, {Role: rbac.CatalogManager},
	}, false)
	if p.Admin || p.Processes || p.Standards || !p.Catalog || strings.Join(p.Owns, ",") != "api-platform-team,cloud-platform-team" || p.EditsSome() {
		t.Fatalf("owner: %+v", p)
	}
	// a team owner manages feedback and reviews of what the team owns, and edits nothing
	if !p.CanManageFeedback("process", B{Owner: "cloud-platform-team"}) || !p.CanManageFeedback("standard", B{Owner: "api-platform-team"}) ||
		p.CanManageFeedback("process", B{Owner: "devex"}) || p.CanManageFeedback("process", B{}) ||
		p.CanEdit("process", B{Owner: "cloud-platform-team"}) || p.CanEdit("standard", B{Owner: "cloud-platform-team"}) {
		t.Fatal("owner rights are wrong")
	}
	// the same id as a platform or practice does not count: a team is not a platform
	if p.CanManageFeedback("process", B{Platform: "cloud-platform-team", Practice: "cloud-platform-team"}) {
		t.Fatal("a team owner must not get rights through a platform of the same id")
	}

	// platform and practice owners edit processes and standards of theirs, and nothing else
	o := rbac.PermsFrom([]rbac.Assignment{
		{Role: rbac.PlatformOwner, Scope: "google-cloud"}, {Role: rbac.PracticeOwner, Scope: "security"}, {Role: rbac.PlatformOwner, Scope: "azure"},
	}, false)
	if strings.Join(o.Platforms, ",") != "azure,google-cloud" || strings.Join(o.Practices, ",") != "security" || !o.EditsSome() || o.Processes || o.Standards {
		t.Fatalf("platform and practice owner: %+v", o)
	}
	for _, kind := range []string{"process", "standard"} {
		for _, b := range []B{{Platform: "google-cloud"}, {Platform: "azure", Owner: "x"}, {Practice: "security"}, {Platform: "github", Practice: "security"}} {
			if !o.CanEdit(kind, b) || !o.CanManageFeedback(kind, b) {
				t.Errorf("%s %+v: must be editable", kind, b)
			}
		}
		for _, b := range []B{{}, {Platform: "github"}, {Practice: "engineering"}, {Owner: "security"}, {Owner: "google-cloud"}} {
			if o.CanEdit(kind, b) || o.CanManageFeedback(kind, b) {
				t.Errorf("%s %+v: must not be editable", kind, b)
			}
		}
	}
	if o.CanEdit("catalog", B{Platform: "google-cloud"}) {
		t.Fatal("platform owners do not manage the lists")
	}

	all := rbac.PermsFrom([]rbac.Assignment{{Role: rbac.StandardsEditor}, {Role: rbac.ProcessEditor}}, false)
	if !all.CanEdit("standard", B{Owner: "any"}) || !all.CanEdit("process", B{}) || all.Catalog || all.Admin {
		t.Fatalf("editors: %+v", all)
	}
	procs := rbac.PermsFrom([]rbac.Assignment{{Role: rbac.ProcessEditor}}, false)
	if procs.CanEdit("standard", B{}) || !procs.CanManageFeedback("process", B{}) {
		t.Fatalf("a process editor edits processes only: %+v", procs)
	}
}

func TestCheck(t *testing.T) {
	ok := []rbac.Assignment{
		{Email: "a@b.co", Role: rbac.Admin}, {Email: "a@b.co", Role: rbac.StandardsEditor},
		{Email: "a@b.co", Role: rbac.Owner, Scope: "cloud-platform-team"},
		{Email: "a@b.co", Role: rbac.PlatformOwner, Scope: "google-cloud"},
		{Email: "a@b.co", Role: rbac.PracticeOwner, Scope: "security"},
	}
	for _, a := range ok {
		if err := rbac.Check(a); err != nil {
			t.Errorf("%+v: %v", a, err)
		}
	}
	bad := map[string]rbac.Assignment{
		"not an email":                       {Email: "nobody", Role: rbac.Admin},
		"process-editor cannot be limited":   {Email: "a@b.co", Role: rbac.ProcessEditor, Scope: "x"},
		"standards-editor cannot be limited": {Email: "a@b.co", Role: rbac.StandardsEditor, Scope: "security"},
		"owner needs the team":               {Email: "a@b.co", Role: rbac.Owner},
		"platform-owner needs the platform":  {Email: "a@b.co", Role: rbac.PlatformOwner},
		"practice-owner needs the practice":  {Email: "a@b.co", Role: rbac.PracticeOwner},
		`"Bad Scope" is not a platform id`:   {Email: "a@b.co", Role: rbac.PlatformOwner, Scope: "Bad Scope"},
		"unknown role":                       {Email: "a@b.co", Role: "god"},
	}
	for want, a := range bad {
		if err := rbac.Check(a); !errors.Is(err, rbac.ErrInvalid) || !strings.Contains(err.Error(), want) {
			t.Errorf("want %q, got %v", want, err)
		}
	}
	if rbac.ScopeList(rbac.Owner) != "teams" || rbac.ScopeList(rbac.PlatformOwner) != "platforms" || rbac.ScopeList(rbac.PracticeOwner) != "practices" || rbac.ScopeList(rbac.StandardsEditor) != "" {
		t.Fatal("scope lists")
	}
}

func TestStoreGrantRevokeAndPerms(t *testing.T) {
	s := &rbac.Store{Pool: dbtest.NewPool(t), Bootstrap: []string{"Root@Example.com"}}
	if err := s.Grant(ctx, rbac.Assignment{Email: " Riley@Example.com ", Role: rbac.PracticeOwner, Scope: "security", GrantedBy: "root@example.com"}); err != nil {
		t.Fatal(err)
	}
	s.Grant(ctx, rbac.Assignment{Email: "riley@example.com", Role: rbac.PracticeOwner, Scope: "security", GrantedBy: "someone-else"}) // twice
	s.Grant(ctx, rbac.Assignment{Email: "riley@example.com", Role: rbac.Owner, Scope: "security", GrantedBy: "root@example.com"})
	if err := s.Grant(ctx, rbac.Assignment{Email: "x", Role: rbac.Admin}); !errors.Is(err, rbac.ErrInvalid) {
		t.Fatalf("invalid grant: %v", err)
	}
	all, err := s.All(ctx)
	if err != nil || len(all) != 2 || all[0].Email != "riley@example.com" || all[0].GrantedBy != "root@example.com" || all[1].GrantedBy != "root@example.com" || all[0].GrantedAt.IsZero() {
		t.Fatalf("all: %+v %v", all, err)
	}
	if n, _ := s.Count(ctx); n != 2 {
		t.Fatalf("count %d", n)
	}
	p, err := s.Perms(ctx, "RILEY@example.com")
	if err != nil || !p.CanEdit("standard", B{Practice: "security"}) || p.Admin || len(p.Owns) != 1 {
		t.Fatalf("riley: %+v %v", p, err)
	}
	root, _ := s.Perms(ctx, "root@example.com")
	if !root.Admin || !s.IsBootstrap("ROOT@example.com") || s.IsBootstrap("riley@example.com") {
		t.Fatalf("bootstrap admin: %+v", root)
	}
	if err := s.Revoke(ctx, "Riley@example.com", rbac.Owner, "security"); err != nil {
		t.Fatal(err)
	}
	p, _ = s.Perms(ctx, "riley@example.com")
	if len(p.Owns) != 0 || !p.CanEdit("process", B{Practice: "security"}) {
		t.Fatalf("after revoke: %+v", p)
	}
}

func TestMembersAreTheScopedRolesInOrder(t *testing.T) {
	s := &rbac.Store{Pool: dbtest.NewPool(t)}
	for _, a := range []rbac.Assignment{
		{Email: "zoe@example.com", Role: rbac.PracticeOwner, Scope: "security"},
		{Email: "amy@example.com", Role: rbac.PracticeOwner, Scope: "security"},
		{Email: "amy@example.com", Role: rbac.PlatformOwner, Scope: "google-cloud"},
		{Email: "bob@example.com", Role: rbac.Owner, Scope: "security"},
		{Email: "bob@example.com", Role: rbac.Owner, Scope: "cloud-platform-team"},
		{Email: "bob@example.com", Role: rbac.Admin},
		{Email: "cat@example.com", Role: rbac.ProcessEditor},
	} {
		a.GrantedBy = "root@example.com"
		if err := s.Grant(ctx, a); err != nil {
			t.Fatal(err)
		}
	}
	members, err := s.Members(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, m := range members {
		got = append(got, m.Role+"/"+m.Scope+"/"+m.Email)
	}
	want := "owner/cloud-platform-team/bob@example.com,owner/security/bob@example.com,platform-owner/google-cloud/amy@example.com," +
		"practice-owner/security/amy@example.com,practice-owner/security/zoe@example.com"
	if strings.Join(got, ",") != want {
		t.Fatalf("members: %v", got)
	}
	empty, err := (&rbac.Store{Pool: dbtest.NewPool(t)}).Members(ctx)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("no members must be an empty list: %v %v", empty, err)
	}
}

func TestTheLastAdminCannotBeRemoved(t *testing.T) {
	s := &rbac.Store{Pool: dbtest.NewPool(t)} // no bootstrap admin
	s.Grant(ctx, rbac.Assignment{Email: "a@example.com", Role: rbac.Admin, GrantedBy: "setup"})
	if err := s.Revoke(ctx, "a@example.com", rbac.Admin, ""); !errors.Is(err, rbac.ErrLastAdmin) {
		t.Fatalf("want ErrLastAdmin, got %v", err)
	}
	s.Grant(ctx, rbac.Assignment{Email: "b@example.com", Role: rbac.Admin, GrantedBy: "a@example.com"})
	if err := s.Revoke(ctx, "a@example.com", rbac.Admin, ""); err != nil {
		t.Fatalf("with a second admin: %v", err)
	}
	// with a bootstrap admin in the settings, the portal's last admin may go
	s.Bootstrap = []string{"root@example.com"}
	if err := s.Revoke(ctx, "b@example.com", rbac.Admin, ""); err != nil {
		t.Fatalf("with a bootstrap admin: %v", err)
	}
}
