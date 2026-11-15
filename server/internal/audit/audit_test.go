package audit_test

import (
	"context"
	"testing"

	"github.com/kubek80/process-manager/server/internal/audit"
	"github.com/kubek80/process-manager/server/internal/db/dbtest"
)

func TestAddAndRecent(t *testing.T) {
	ctx := context.Background()
	l := &audit.Log{Pool: dbtest.NewPool(t)}
	for _, target := range []string{"first", "second", "third"} {
		if err := l.Add(ctx, "dana@example.com", "Dana Admin", "process.save", target, "version 2"); err != nil {
			t.Fatal(err)
		}
	}
	got, err := l.Recent(ctx, 2)
	if err != nil || len(got) != 2 || got[0].Target != "third" || got[1].Target != "second" || got[0].Name != "Dana Admin" || got[0].Detail != "version 2" || got[0].At.IsZero() {
		t.Fatalf("got %+v %v", got, err)
	}
	if all, _ := l.Recent(ctx, 0); len(all) != 3 {
		t.Fatalf("default limit: %d", len(all))
	}
	if all, _ := l.Recent(ctx, 100000); len(all) != 3 {
		t.Fatalf("capped limit: %d", len(all))
	}
}
