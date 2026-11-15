/**
 * `npm run dev` - everything needed for local development, in one terminal:
 *   1. the Postgres container (docker compose), unless PM_PG points elsewhere
 *   2. the Go server, rebuilt and restarted when a .go file changes
 *   3. Vite, serving the app with hot reload and forwarding /api and /auth to the server
 *
 * `npm run db:reset` (this script with --reset) empties the feedback tables and adds the samples again.
 */
import fs from "node:fs";
import { buildServer, db, ensureDatabase, root, run, runAndWait, serverBin, serverDir } from "./env.mjs";

const env = {
  ...process.env,
  PM_AUTH: process.env.PM_AUTH ?? "dev",
  DATABASE_URL: process.env.DATABASE_URL ?? db("pm_dev"),
  PM_CONTENT_DIR: root,
  PM_CONTENT_WRITABLE: process.env.PM_CONTENT_WRITABLE ?? "true",
  PM_ADDR: "127.0.0.1:8080",
  PM_BASE_URL: "http://localhost:5173",
};

ensureDatabase();
if (!buildServer()) process.exit(1);

if (process.argv.includes("--reset")) {
  process.exit(runAndWait(serverBin, ["-reset", "-seed"], { env }));
}

let server = null;
let stopping = false;
const startServer = () => {
  server = run(serverBin, ["-seed"], { env });
  server.on("exit", (code) => { if (!stopping && code) console.error(`[dev] server stopped (exit ${code}). Fix the problem and save a .go file to restart.`); });
};
startServer();

// rebuild and restart on Go changes
let timer = null;
fs.watch(serverDir, { recursive: true }, (_event, file) => {
  if (!file || !/\.(go|sql)$/.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[dev] ${file} changed: rebuilding the server`);
    if (!buildServer()) return; // keep the old one running until the code compiles
    server?.once("exit", startServer);
    server?.kill() || startServer();
  }, 250);
});

const vite = run("npx", ["vite"], { cwd: root, env: process.env });

const stop = () => { stopping = true; server?.kill(); vite.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", stop);
