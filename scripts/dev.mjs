/**
 * `npm run dev` - everything needed for local development, in one terminal:
 *   1. the Postgres container (docker compose), unless PM_PG points elsewhere
 *   2. the Go server, rebuilt and restarted when a .go file changes
 *   3. Vite, serving the app with hot reload and forwarding /api and /auth to the server
 *
 * `npm run db:reset` (this script with --reset) empties the feedback, views, bookmarks, upvotes, skill downloads and requests, and adds all the samples again.
 * `npm run db:import` loads the files of the repository over what is in the database;
 * `npm run db:demo` (--import demo) loads the larger demo set in demo/ the same way.
 * `npm run db:migrate` upgrades the database and its content to this version, then exits.
 * `npm run export -- <folder>` writes the content and the generated skills to files.
 */
import fs from "node:fs";
import path from "node:path";
import { buildServer, db, ensureDatabase, root, run, runAndWait, serverBin, serverDir } from "./env.mjs";

const env = {
  ...process.env,
  PM_AUTH: process.env.PM_AUTH ?? "dev",
  DATABASE_URL: process.env.DATABASE_URL ?? db("pm_dev"),
  PM_SEED_DIR: root, // processes/, standards/, catalog/ fill an empty database; schema/ is read from here too
  PM_ADDR: "127.0.0.1:8080",
  PM_BASE_URL: "http://localhost:5173",
  // search by meaning with the built-in embedder: nothing leaves this machine
  PM_EMBEDDINGS: process.env.PM_EMBEDDINGS ?? "builtin",
};

ensureDatabase();
if (!buildServer()) process.exit(1);

if (process.argv.includes("--reset")) process.exit(runAndWait(serverBin, ["-reset", "-seed"], { env }));
const importAt = process.argv.indexOf("--import");
if (importAt > 0) {
  const from = process.argv[importAt + 1];
  const dir = from && !from.startsWith("--") ? path.resolve(root, from) : root;
  process.exit(runAndWait(serverBin, ["-import", dir], { env }));
}
if (process.argv.includes("--migrate")) process.exit(runAndWait(serverBin, ["-migrate"], { env }));
const exportAt = process.argv.indexOf("--export");
if (exportAt > 0) {
  const dir = path.resolve(process.argv[exportAt + 1] ?? "export");
  process.exit(runAndWait(serverBin, ["-export", dir], { env }));
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

// Vite's own script under this Node: "npx" is npx.cmd on Windows, which spawn cannot start without a shell
const vite = run(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js")], { cwd: root, env: process.env });

const stop = () => { stopping = true; server?.kill(); vite.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", stop);
