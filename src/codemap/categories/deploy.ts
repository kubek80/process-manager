import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

export const deploy: CodeCategory = {
  id: "deploy",
  area: "around",
  title: "Running and deploying",
  summary:
    "One Go server answers the API and serves the built app, with Postgres beside it; every setting is an environment variable read at start. `npm run dev` runs it locally with Vite in front; the `Dockerfile` makes one image (server, MCP server, built app, formats, sample content); `deploy/cloudrun/` runs that image on Cloud Run behind IAP, with the app's files in a private bucket.",
  requirements: [
    "Settings come only from environment variables, read once by `config.Load`; every wrong or missing setting is listed in one message and the server does not start.",
    "`PM_AUTH=dev` (anyone may sign in as anyone) listens only on a loopback address, unless `PM_DEV_AUTH_ON_NETWORK=i-understand`.",
    "With `entra` or `google`, the server refuses to start without the OAuth client, `PM_ADMINS`, a `PM_SESSION_SECRET` of 32 or more characters that is not a placeholder, and a `PM_BASE_URL` on https (http only for localhost); `google` also needs a domain limit.",
    "Without `PM_ADDR` the server listens on `0.0.0.0:$PORT` when `PORT` is set (Cloud Run), otherwise on `127.0.0.1:8080`; the image sets `PM_ADDR=0.0.0.0:8080`.",
    "The server listens only after it has reached the database (waiting up to 30 seconds), upgraded the tables and filled an empty database (no documents at all) from `PM_SEED_DIR`, each under a lock; `/healthz` answering means it has started, `/readyz` also checks the database.",
    "Search by meaning never delays the start: the index is caught up in the background after the server listens.",
    "Asked to stop (SIGTERM, Ctrl+C), the server gives requests in progress 15 seconds and waits for skills being regenerated and notifications being sent.",
    "`PM_SOURCE_DIR` is set only by `npm run dev` and the browser tests; the image and `service.yaml` do not set it and the image holds no source, so a deployment shows no source code.",
    "`PM_SOURCE_DIR` must be an absolute path to the top of a git checkout owned by the server's user (git refuses a checkout of another owner); otherwise one warning at start says why and the portal shows no source.",
    "The app's files: a file that exists is served (under `/assets/` cached for a year), a missing file under `/assets/` or with an extension is 404, every other path is `index.html` (`no-cache`); without the files the server answers 503 with a plain page.",
  ],
  charts: [
    {
      caption: "What the server does from the moment it is started until it answers (`run` in `server/cmd/server/main.go`). One-off commands (`-import`, `-export`, `-migrate`, `-reindex`) leave this path before listening and exit. With search by meaning on, the index's tables are made before listening; the catching up comes after.",
      process: flow("code-deploy-start", "Start the server", "The start-up order, from settings to listening.",
        [["server", "Server"], ["pg", "Postgres"], ["provider", "Embedding provider"]],
        [
          s("valid", "Every setting valid?", "server", "decision", [["connect", "Yes"], ["refuse", "No"]], "config.Load"),
          s("refuse", "Stop and list every problem", "server", "communication", []),
          s("connect", "Wait for the database", "pg", "wait", ["upgrade"], "up to 30 s"),
          s("upgrade", "Upgrade tables, convert content", "pg", "automation", ["prepare"], "under a lock"),
          s("prepare", "Fill an empty database, regenerate skills", "pg", "automation", ["warn"], "LockPrepare"),
          s("warn", "Warn about missing app files or source", "server", "communication", ["listen"], "StaticProblem, SourceProblem"),
          s("listen", "Listen and answer /healthz", "server", "automation", ["catchup"]),
          s("catchup", "Catch up the search index", "provider", "automation", [], "in the background"),
        ]),
    },
    {
      caption: "What `npm run dev` starts (`scripts/dev.mjs`): the database, the Go server on 8080 and Vite on 5173, which forwards `/api` and `/auth` to the server. Open `localhost:5173`.",
      process: flow("code-deploy-dev", "Run the portal locally", "`npm run dev`, in one terminal.",
        [["dev", "Developer"], ["script", "dev.mjs"], ["pg", "Postgres"], ["server", "Server"], ["vite", "Vite"]],
        [
          s("run", "Run npm run dev", "dev", "task", ["pg"]),
          s("pg", "PM_PG set?", "script", "decision", [["compose", "No"], ["build", "Yes"]]),
          s("compose", "Start the database container", "pg", "automation", ["build"], "docker compose, 54329"),
          s("build", "Build the Go server", "script", "automation", ["serve"], "server/.bin/server"),
          s("serve", "Start the server with -seed", "server", "automation", ["vite"], "127.0.0.1:8080"),
          s("vite", "Serve the app with hot reload", "vite", "automation", ["change"], "5173, proxies /api /auth"),
          s("change", "Save a .go or .sql file", "dev", "task", ["rebuild"]),
          s("rebuild", "Rebuild and restart the server", "script", "automation", [], "old one runs until it compiles"),
        ]),
    },
    {
      caption: "A release on Cloud Run (`deploy/cloudrun/README.md`): back up the database first (the new server upgrades the tables when it starts); the image and the app's files come from the same commit; the app is uploaded right after the service is replaced, its page last.",
      process: flow("code-deploy-release", "Release a new version on Cloud Run", "From a commit to people using it, behind IAP.",
        [["admin", "Admin"], ["registry", "Artifact Registry"], ["run", "Cloud Run"], ["bucket", "Bucket"], ["iap", "IAP"]],
        [
          s("image", "Build and push the image", "registry", "automation", ["fill"], "tag: the commit"),
          s("fill", "Write a filled copy of service.yaml", "admin", "document", ["replace"], "fill-service.sh, outside the repo"),
          s("replace", "Replace the service", "run", "automation", ["probe"], "services replace"),
          s("probe", "Answer the start-up check", "run", "verify", ["upload"], "/healthz, up to 24 tries"),
          s("upload", "Upload assets, then index.html", "bucket", "automation", ["gate"], "upload-app.sh"),
          s("gate", "Member of the group?", "iap", "decision", [["signin", "Yes"], ["blocked", "No"]]),
          s("blocked", "Keep the person out", "iap", "task", []),
          s("signin", "Sign in to the portal with Google", "run", "task", [], "its own sign-in"),
        ]),
    },
  ],
  examples: [
    {
      title: "One setting from the service file to the sign-in",
      caption: "How the portal's address travels from a placeholder in `service.yaml` to the address Google sends people back to after signing in.",
      stages: [
        {
          label: "A placeholder in the service file",
          where: "deploy/cloudrun/service.yaml",
          shape: "- name: PM_BASE_URL\n  value: PORTAL_URL",
          note: "The file in the repository is never filled in place.",
        },
        {
          label: "Filled outside the repository",
          where: "deploy/cloudrun/fill-service.sh",
          shape: "PORTAL_URL=https://pm-123456789.europe-west4.run.app/\ndeploy/cloudrun/fill-service.sh > /tmp/service.filled.yaml\n\n- name: PM_BASE_URL\n  value: https://pm-123456789.europe-west4.run.app",
          note: "A trailing slash is dropped; a value that is not https, or a placeholder left over, is refused.",
        },
        {
          label: "Read and checked at start",
          where: "server/internal/config/config.go",
          shape: "c.BaseURL = u.Scheme + \"://\" + strings.ToLower(u.Host) + strings.TrimRight(u.EscapedPath(), \"/\")\n// \"https://pm-123456789.europe-west4.run.app\"",
          note: "With `entra` or `google` it must be https (http only for localhost); one spelling for cookies, redirects and headers.",
        },
        {
          label: "The sign-in comes back here",
          where: "server/cmd/server/main.go",
          shape: "RedirectURL: cfg.BaseURL + \"/auth/callback\"\n// https://pm-123456789.europe-west4.run.app/auth/callback",
          note: "Must be the OAuth client's redirect address exactly.",
        },
      ],
    },
  ],
  start: "server/cmd/server/main.go",
  files: [
    {
      path: "server/cmd/server/main.go",
      role: "The server's start: settings, database, upgrades, filling an empty database, the index, listening, stopping.",
      requirements: [
        { text: "A configuration problem ends the start here with exit status 1, before any connection to the database: nothing half-configured ever answers a request.", at: 'return fmt.Errorf("configuration: %w", err)' },
        { text: "Waits up to 30 seconds for a database that is still starting (docker compose, a database restart); after that the start fails with the reason instead of serving errors.", at: "if time.Now().After(deadline) {" },
        { text: "Several instances may start at once (`maxScale` 3 on Cloud Run): the lock makes the others wait and then find the database filled, so the sample is imported once.", at: "if err := db.WithLock(ctx, pool, db.LockPrepare, func() error { return prepare(ctx, cfg, st, log) }); err != nil {" },
        { text: "The index is caught up only after the server listens, in a goroutine: a slow or unreachable provider never delays the start (`hang_test.go` shows the server answering while the provider hangs).", at: "st.index.LogCatchUp(ctx)" },
        { text: "When `PM_SOURCE_DIR` is set but no source can be shown (not a folder, not the top of a git checkout, git missing, or git refusing a checkout of another owner), one warning says why; the server starts all the same.", at: 'if problem := httpapi.SourceProblem(cfg.SourceDir); problem != "" {' },
        { text: "Stopping waits for the skills still being regenerated after a save before the database is closed, within the same 15 seconds as the requests in progress.", at: "background.Wait() // skills that are still being regenerated after a save" },
      ],
      tests: ["server/cmd/server/main_test.go", "server/cmd/server/hang_test.go", "server/cmd/server/migrate_test.go", "server/cmd/server/seed_test.go"],
    },
    {
      path: "server/internal/config/config.go",
      role: "Every setting of the server, read from environment variables and checked once.",
      requirements: [
        { text: "Every problem is collected and returned in one message joined by `; `, so all settings are fixed in one round instead of one per restart.", at: 'return c, errors.New(strings.Join(problems, "; "))' },
        { text: "The refusal also covers `PORT`: on Cloud Run `PORT` alone would make the server listen on `0.0.0.0`, so `PM_AUTH=dev` there refuses to start (`config_test.go`).", at: 'if !loopback(c.Addr) && get("PM_DEV_AUTH_ON_NETWORK", "") != "i-understand" {' },
        { text: "`PORT` must be exactly a port number (`08080` or `+8080` is refused) and is used only when `PM_ADDR` is not set.", at: "if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 || strconv.Itoa(n) != port {" },
        { text: "A session secret with fewer than 10 different characters, or containing `change-me`, `example`, `placeholder` and the like, is refused: a value copied from `.env.example` never signs real sessions.", at: "return len(distinct) < 10" },
        { text: "`PM_SOURCE_DIR` must be absolute; whether it is a git checkout is checked when a file is asked for (`source.go`) and warned about at start, not here.", at: "if !filepath.IsAbs(c.SourceDir) {" },
      ],
      tests: ["server/internal/config/config_test.go"],
    },
    {
      path: "Dockerfile",
      role: "One image: the portal server and the MCP server, the built app, the formats and the sample content.",
      requirements: [
        { text: "The image cannot be built from sample files that fail the check, so a first start never fills a database with content the server would refuse.", at: "RUN npm run validate && npm run build" },
        { text: "Both programs are static binaries (`CGO_ENABLED=0`) built with `-trimpath`, so they run on distroless without a C library.", at: 'RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \\' },
        { text: "The image runs as a non-root user on distroless, with no shell, no git and no source code: Admin › Code map can never show files there.", at: "FROM gcr.io/distroless/static-debian12:nonroot" },
        { text: "It listens on `0.0.0.0:8080` and serves the app from `/app/dist`; the sample in `/app/seed` fills only an empty database.", at: "ENV PM_ADDR=0.0.0.0:8080 \\" },
      ],
    },
    {
      path: "scripts/dev.mjs",
      role: "`npm run dev` and the database commands (`db:reset`, `db:import`, `db:demo`, `db:migrate`, `export`).",
      requirements: [
        { text: "Runs the server on `127.0.0.1:8080` with development sign-in, the database `pm_dev` and the `builtin` embedder, unless `PM_AUTH`, `DATABASE_URL` or `PM_EMBEDDINGS` say otherwise.", at: 'PM_AUTH: process.env.PM_AUTH ?? "dev",' },
        { text: "The checkout must be the top of a git checkout owned by the user running `npm run dev`: Admin › Code map shows only tracked files, and nothing at all otherwise.", at: "PM_SOURCE_DIR: root," },
        { text: "Starts the server with `-seed`: an empty database also gets made-up use (feedback, views, bookmarks, upvotes, downloads, requests).", at: 'server = run(serverBin, ["-seed"], { env });' },
        { text: "Only `.go` and `.sql` changes rebuild the server (a migration is a `.sql` file); a failed build leaves the running server in place, so the app keeps working while the code does not compile.", at: "if (!buildServer()) return; // keep the old one running until the code compiles" },
      ],
    },
    {
      path: "scripts/env.mjs",
      role: "Where the local databases are, starting the compose database, building the server binary.",
      requirements: [
        { text: "The compose database is on port 54329, beside any Postgres on 5432; `PM_PG` replaces the server address for every script at once.", at: 'const base = (process.env.PM_PG ?? "postgres://pm:pm@localhost:54329").replace(/\\/$/, "");' },
      ],
    },
    {
      path: "docker-compose.yml",
      role: "The local database: Postgres 16 with pgvector, on `127.0.0.1:54329` only.",
      requirements: [
        { text: "Bound to `127.0.0.1`: the password `pm` is acceptable only because nobody else can reach the database.", at: '- "127.0.0.1:54329:5432"' },
        { text: "The test databases and the `vector` extension are created on the volume's first start only (`docker compose down -v` starts again).", at: "- ./docker/init-databases.sql:/docker-entrypoint-initdb.d/init-databases.sql:ro" },
      ],
    },
    {
      path: "docker/init-databases.sql",
      role: "Run once when the local database volume is created: the databases `pm_test` and `pm_e2e` and the `vector` extension in all three.",
      requirements: [
        { text: "The extension is created in all three databases, so neither the server nor parallel Go tests need to create it.", at: "create extension if not exists vector;" },
      ],
    },
    {
      path: "vite.config.ts",
      role: "Vite in development: serves the app on 5173 and forwards the server's paths.",
      requirements: [
        { text: "Only `/api` and `/auth` are forwarded, to `PM_SERVER_URL` or `127.0.0.1:8080`: the app and the API share one address, as the session cookie and the content security policy need.", at: 'proxy: { "/api": server, "/auth": server },' },
      ],
    },
    {
      path: "index.html",
      role: "The one page of the app; Vite turns it into `dist/index.html` with the built scripts.",
      requirements: [
        { text: "No inline script: the only script is the app's module, as the content security policy (`script-src 'self'`) requires.", at: '<script type="module" src="/src/main.tsx"></script>' },
      ],
    },
    {
      path: "package.json",
      role: "The commands to run, build and test the portal, and its dependencies.",
      requirements: [
        { text: "The build checks the types before Vite builds `dist/`: Vite alone would build code with type errors.", at: '"build": "tsc --noEmit && vite build",' },
        { text: "Every database command goes through `scripts/dev.mjs`, with the same settings as `npm run dev`.", at: '"db:migrate": "node scripts/dev.mjs --migrate",' },
      ],
    },
    {
      path: "server/internal/httpapi/api.go",
      role: "Here for what a deployment depends on: `/healthz`, `/readyz` and serving the built app.",
      requirements: [
        { text: "`/readyz` answers 503 when the database does not answer within 2 seconds; the start-up check in `service.yaml` uses `/healthz`, which a running server always answers.", at: 'writeError(w, 503, "The database cannot be reached.")' },
        { text: "Paths with an extension are files: a missing one is 404, so a request for a script never gets the HTML page while an upload is in progress (`TestServesTheBuiltApp`).", at: 'if strings.HasPrefix(r.URL.Path, "/assets/") || filepath.Ext(r.URL.Path) != "" {' },
        { text: "Without the app's files the server answers 503 with a plain page and warns at start; it serves them as soon as they arrive, without a restart.", at: "func StaticProblem(dir string) string {" },
      ],
      tests: ["server/internal/httpapi/api_test.go", "server/internal/httpapi/hardening_test.go"],
    },
    {
      path: "deploy/cloudrun/README.md",
      role: "The steps of a Cloud Run installation behind IAP, releasing, rolling back, and what was not tested.",
      requirements: [
        { text: "Two separate checks: IAP lets only a Google group through; the portal still signs people in with Google and reads nothing IAP sends.", at: "## Two sign-ins, two separate checks" },
        { text: "The image and the app's files must come from the same commit; back up the database before each release.", at: "## Releasing a new version" },
        { text: "Nothing here has been run against a real project: read \"Not tested\" first.", at: "## Not tested" },
      ],
    },
    {
      path: "deploy/cloudrun/service.yaml",
      role: "The Cloud Run service with placeholders: image, settings, secrets, the bucket mounted read-only, the start-up check.",
      requirements: [
        { text: "Secrets come from Secret Manager by name, never as values in the file, so the filled copy holds nothing secret.", at: "name: pm-session-secret" },
        { text: "With `minScale: \"1\"` and `cpu-throttling: \"false\"` the work a save starts after answering (skills, index, notifications) keeps its CPU; otherwise Cloud Run could take it away mid-way.", at: 'autoscaling.knative.dev/minScale: "1"' },
        { text: "The app's files are a private bucket mounted read-only at `/srv/www` (`PM_STATIC_DIR`).", at: "mountPath: /srv/www" },
        { text: "Up to 24 tries 10 seconds apart give a start about 4 minutes for the migrations; the server listens only after them, so a passing check means the tables are upgraded.", at: "failureThreshold: 24" },
      ],
    },
    {
      path: "deploy/cloudrun/fill-service.sh",
      role: "Fills in the placeholders of `service.yaml` from shell variables and writes the copy to stdout.",
      requirements: [
        { text: "Refuses an empty variable, a value with `|`, `&`, `\\` or `\"`, a `PORTAL_URL` that is not https, and a result with a placeholder left in it.", at: 'echo "Placeholders are left in the result: set the variables to your own values." >&2' },
      ],
    },
    {
      path: "deploy/cloudrun/upload-app.sh",
      role: "Builds the app and uploads it to the bucket: assets first, other files next, `index.html` last.",
      requirements: [
        { text: "`index.html` is uploaded last: until then browsers get the old page, whose assets are still there; after it, the new page finds every new asset.", at: 'gcloud storage cp dist/index.html "gs://$bucket/index.html"' },
        { text: "Files of earlier versions are not deleted, because open pages still need them; the cleanup command printed at the end uses this build's `dist/assets` as the list to keep.", at: "# Files of earlier versions under assets/ are NOT deleted: people who still have the previous" },
      ],
    },
  ],
};
