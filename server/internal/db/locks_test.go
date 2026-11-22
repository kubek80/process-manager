package db_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// lockNumber finds the advisory lock numbers in the server's sources: constants named lock…,
// numbers written into pg_advisory_…lock(…) and the seeds of hashtextextended(…, seed).
var lockNumber = regexp.MustCompile(`(?i)\block\w*\s*=\s*(\d{4,})\b|pg_(?:try_)?advisory_(?:xact_)?lock(?:_shared)?\(\s*(\d+)\s*\)|hashtextextended\([^,()]+,\s*(\d+)\s*\)`)

// Advisory lock numbers are shared by the whole database: two packages that take the same one
// block each other for no reason. Every number may be used by one package only.
func TestAdvisoryLockNumbersAreNotShared(t *testing.T) {
	root := filepath.Join("..", "..") // server/
	users := map[string]map[string]bool{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range lockNumber.FindAllStringSubmatch(string(src), -1) {
			n := m[1] + m[2] + m[3]
			if users[n] == nil {
				users[n] = map[string]bool{}
			}
			rel, _ := filepath.Rel(root, filepath.Dir(path))
			users[n][rel] = true
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// the search still finds the locks it is meant to find
	for _, known := range []string{"7461001", "7461010", "7461011", "7461", "7466"} {
		if users[known] == nil {
			t.Errorf("lock %s not found: the pattern no longer matches how locks are written", known)
		}
	}
	for n, pkgs := range users {
		if len(pkgs) > 1 {
			list := make([]string, 0, len(pkgs))
			for p := range pkgs {
				list = append(list, p)
			}
			sort.Strings(list)
			t.Errorf("advisory lock %s is used by more than one package: %s", n, strings.Join(list, ", "))
		}
	}
}
