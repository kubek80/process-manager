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

func TestPermsFrom(t *testing.T) {
	none := rbac.PermsFrom(nil, false)
	if none.Admin || none.Catalog || none.Processes || none.Standards || none.StandardUnits == nil || none.Owns == nil || none.AnyStandards() {
		t.Fatalf("no roles: %+v", none)
	}
	if none.CanEdit("process", "x") || none.CanEdit("standard", "security") || none.CanEdit("catalog", "") || none.CanManageFeedback("process", "x") {
		t.Fatal("no roles must grant nothing")
	}

	admin := rbac.PermsFrom(nil, true) // bootstrap admin
	for _, kind := range []string{"process", "standard", "catalog"} {
		if !admin.CanEdit(kind, "anything") || (kind != "catalog" && !admin.CanManageFeedback(kind, "anything")) {
			t.Fatalf("admin cannot edit %s", kind)
		}
	}
	if admin.CanEdit("skill", "") {
		t.Fatal("unknown kind must be refused")
	}

	p := rbac.PermsFrom([]rbac.Assignment{
		{Role: rbac.StandardsEditor, Scope: "security"}, {Role: rbac.Owner, Scope: "cloud-platform-team"},
		{Role: rbac.Owner, Scope: "api-platform-team"}, {Role: rbac.CatalogManager},
	}, false)
	if p.Admin || p.Processes || p.Standards || !p.Catalog || strings.Join(p.Owns, ",") != "api-platform-team,cloud-platform-team" {
		t.Fatalf("scoped: %+v", p)
	}
	if !p.CanEditStandard("security") || p.CanEditStandard("engineering-practice") || p.CanEditStandard("") || !p.AnyStandards() {
		t.Fatal("standards editor must be limited to its unit")
	}
	if !p.CanManageFeedback("standard", "security") || !p.CanManageFeedback("process", "cloud-platform-team") ||
		p.CanManageFeedback("process", "devex") || p.CanManageFeedback("process", "") || p.CanEdit("process", "cloud-platform-team") {
		t.Fatal("feedback rights are wrong")
	}
	all := rbac.PermsFrom([]rbac.Assignment{{Role: rbac.StandardsEditor}, {Role: rbac.ProcessEditor}}, false)
	if !all.CanEditStandard("any-unit") || !all.CanEdit("process", "") || all.Catalog || all.Admin {
		t.Fatalf("unscoped editors: %+v", all)
	}
}

func TestCheck(t *testing.T) {
	ok := []rbac.Assignment{
		{Email: "a@b.co", Role: rbac.Admin}, {Email: "a@b.co", Role: rbac.StandardsEditor}, {Email: "a@b.co", Role: rbac.StandardsEditor, Scope: "security"},
		{Email: "a@b.co", Role: rbac.Owner, Scope: "cloud-platform-team"},
	}
	for _, a := range ok {
		if err := rbac.Check(a); err != nil {
			t.Errorf("%+v: %v", a, err)
		}
	}
	bad := map[string]rbac.Assignment{
		"not an email":     {Email: "nobody", Role: rbac.Admin},
		"cannot be limite": {Email: "a@b.co", Role: rbac.ProcessEditor, Scope: "x"},
		"not a unit id":    {Email: "a@b.co", Role: rbac.StandardsEditor, Scope: "Bad Scope"},
		"owner needs":      {Email: "a@b.co", Role: rbac.Owner},
		"unknown role":     {Email: "a@b.co", Role: "god"},
	}
	for want, a := range bad {
		if err := rbac.Check(a); !errors.Is(err, rbac.ErrInvalid) || !strings.Contains(err.Error(), want) {
			t.Errorf("want %q, got %v", want, err)
		}
	}
}

func TestStoreGrantRevokeAndPerms(t *testing.T) {
	s := &rbac.Store{Pool: dbtest.NewPool(t), Bootstrap: []string{"Root@Example.com"}}
	if err := s.Grant(ctx, rbac.Assignment{Email: " Riley@Example.com ", Role: rbac.StandardsEditor, Scope: "security", GrantedBy: "root@example.com"}); err != nil {
		t.Fatal(err)
	}
	s.Grant(ctx, rbac.Assignment{Email: "riley@example.com", Role: rbac.StandardsEditor, Scope: "security", GrantedBy: "someone-else"}) // twice
	s.Grant(ctx, rbac.Assignment{Email: "riley@example.com", Role: rbac.Owner, Scope: "security", GrantedBy: "root@example.com"})
	if err := s.Grant(ctx, rbac.Assignment{Email: "x", Role: rbac.Admin}); !errors.Is(err, rbac.ErrInvalid) {
		t.Fatalf("invalid grant: %v", err)
	}
	all, err := s.All(ctx)
	if err != nil || len(all) != 2 || all[0].Email != "riley@example.com" || all[1].GrantedBy != "root@example.com" || all[0].GrantedAt.IsZero() {
		t.Fatalf("all: %+v %v", all, err)
	}
	if n, _ := s.Count(ctx); n != 2 {
		t.Fatalf("count %d", n)
	}
	p, err := s.Perms(ctx, "RILEY@example.com")
	if err != nil || !p.CanEditStandard("security") || p.Admin || len(p.Owns) != 1 {
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
	if len(p.Owns) != 0 || !p.CanEditStandard("security") {
		t.Fatalf("after revoke: %+v", p)
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
