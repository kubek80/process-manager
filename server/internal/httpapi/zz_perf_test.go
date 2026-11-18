package httpapi

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestZZPerf(t *testing.T) {
	if os.Getenv("PERF") == "" {
		t.Skip()
	}
	e := setup(t, nil)
	pool := e.deps.Docs.Pool
	start := time.Now()
	_, err := pool.Exec(bg, `insert into documents (kind, id, version, body, updated_by)
		select d.kind, d.id || '-' || n, 1, d.body, 'perf' from documents d, generate_series(1, 30) n where d.kind in ('process','standard')`)
	must(t, err)
	_, err = pool.Exec(bg, `insert into document_views (kind, id, day, email)
		select x.kind, x.id, current_date - (i % 365), 'p' || (i % 20000) || '@example.com'
		from generate_series(1, 3600000) i
		join (select kind, id, row_number() over (order by kind, id) - 1 as r, count(*) over () as c from documents where kind <> 'catalog') x on x.r = i % x.c
		on conflict do nothing`)
	must(t, err)
	_, err = pool.Exec(bg, `insert into document_counts (kind, id, views, people) select kind, id, count(*), count(distinct email) from document_views group by kind, id`)
	must(t, err)
	_, err = pool.Exec(bg, `analyze`)
	must(t, err)
	var n int
	pool.QueryRow(bg, `select count(*) from document_views`).Scan(&n)
	t.Logf("generated %d views in %v", n, time.Since(start))
	c := e.as(sam)
	d := e.as(dana)
	for i := 0; i < 3; i++ {
		s := time.Now()
		st, _, _ := c.raw("GET", "/api/engagement", nil, false)
		t.Logf("engagement: %d %v", st, time.Since(s))
	}
	for _, p := range []string{"7", "30", "365", "all", "7", "30", "365", "all"} {
		s := time.Now()
		st, _, _ := d.raw("GET", "/api/admin/statistics?period="+p, nil, false)
		t.Logf("statistics %s: %d %v", p, st, time.Since(s))
	}
	s := time.Now()
	st, _, _ := c.raw("POST", "/api/views/process/"+gcp, nil, true)
	t.Logf("view: %d %v", st, time.Since(s))
	if os.Getenv("PERF_PLAN") != "" {
		for _, q := range strings.Split(os.Getenv("PERF_PLAN"), ";;") {
			t.Log("----- " + q[:min(60, len(q))])
			rows, _ := pool.Query(bg, "explain analyze "+q)
			for rows.Next() {
				var l string
				rows.Scan(&l)
				t.Log(l)
			}
			rows.Close()
		}
	}
}
