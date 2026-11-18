package mcpserver

import (
	"sync"
	"time"
)

// brake allows each caller a number of calls per period. With Vertex AI every search by
// meaning is a paid call to a service outside the company, so one busy agent must not run up
// the bill or slow everyone else down.
type brake struct {
	max    int
	period time.Duration

	mu      sync.Mutex
	windows map[string]*window
}

type window struct {
	start time.Time
	n     int
}

func newBrake(max int, period time.Duration) *brake {
	return &brake{max: max, period: period, windows: map[string]*window{}}
}

// allow counts one call of key at now. When the caller has used up the period it returns
// false and how long until it may call again.
func (b *brake) allow(key string, now time.Time) (bool, time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	w := b.windows[key]
	if w == nil || now.Sub(w.start) >= b.period {
		if len(b.windows) > 10000 { // forget callers whose period is over
			for k, old := range b.windows {
				if now.Sub(old.start) >= b.period {
					delete(b.windows, k)
				}
			}
		}
		w = &window{start: now}
		b.windows[key] = w
	}
	if w.n >= b.max {
		return false, w.start.Add(b.period).Sub(now)
	}
	w.n++
	return true, 0
}
