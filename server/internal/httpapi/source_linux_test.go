package httpapi

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// exchange swaps two names in one step (renameat2 with RENAME_EXCHANGE), as somebody who can
// write to the checkout would to slip a link in between the checks and the opening.
func exchange(a, b string) error {
	pa, err := syscall.BytePtrFromString(a)
	if err != nil {
		return err
	}
	pb, err := syscall.BytePtrFromString(b)
	if err != nil {
		return err
	}
	// the number of renameat2, which the syscall package does not name
	nr, ok := map[string]uintptr{"amd64": 316, "arm64": 276}[runtime.GOARCH]
	if !ok {
		return syscall.ENOSYS
	}
	const atFDCWD, renameExchange = -100, 2
	cwd := atFDCWD
	_, _, errno := syscall.Syscall6(nr, uintptr(cwd), uintptr(unsafe.Pointer(pa)), uintptr(cwd), uintptr(unsafe.Pointer(pb)), renameExchange, 0)
	if errno != 0 {
		return errno
	}
	return nil
}

func TestSourceFIFOIsRefusedAtOnce(t *testing.T) {
	root, _ := sourceCheckout(t)
	dir, err := filepath.EvalSymlinks(root)
	must(t, err)
	// fifo.go is tracked; in the working checkout it is now a FIFO that nobody writes to
	must(t, os.Remove(filepath.Join(dir, "fifo.go")))
	if err := syscall.Mkfifo(filepath.Join(dir, "fifo.go"), 0o644); err != nil {
		t.Skipf("a FIFO cannot be made here: %v", err)
	}
	e := setup(t, func(d *Deps) { d.Cfg.SourceDir = root })
	admin := e.as(dana)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.srv.URL+sourceQuery("fifo.go"), nil)
	res, err := admin.http.Do(req)
	if err != nil {
		// let the server's reader go, so that the test server can be closed
		if w, err := os.OpenFile(filepath.Join(dir, "fifo.go"), os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
			w.Close()
		}
		t.Fatalf("the request did not come back: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != 404 || !strings.Contains(string(body), sourceRefusedMessage) {
		t.Fatalf("%d %s", res.StatusCode, body)
	}
}

// swapping runs exchange(a, b) again and again until the test ends.
func swapping(t *testing.T, a, b string) {
	t.Helper()
	if err := exchange(a, b); err != nil {
		t.Skipf("names cannot be exchanged here: %v", err)
	}
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				_ = exchange(a, b)
			}
		}
	}()
	t.Cleanup(func() { close(stop); wg.Wait() })
}

func TestSourceSwapsNeverLeadToAnotherFile(t *testing.T) {
	root, _ := sourceCheckout(t)
	dir, err := filepath.EvalSymlinks(root)
	must(t, err)
	e := setup(t, func(d *Deps) { d.Cfg.SourceDir = root })
	admin := e.as(dana)
	// the last part of the path changes between the tracked file and a link to .env; a folder in
	// the middle changes between the tracked folder and a link to a folder outside the checkout
	swapping(t, filepath.Join(dir, "swap.go"), filepath.Join(dir, "swap-env"))
	swapping(t, filepath.Join(dir, "race"), filepath.Join(dir, "race-out"))
	read := map[string]int{}
	for i := 0; i < 400; i++ {
		for _, p := range []string{"swap.go", "race/t.go"} {
			status, raw, _ := admin.raw("GET", sourceQuery(p), nil, false)
			if strings.Contains(string(raw), "do-not-show") {
				t.Fatalf("%s gave away another file: %s", p, raw)
			}
			if status == 200 {
				read[p]++
			}
		}
	}
	t.Logf("read while swapping: %v of 400 each", read)
}
