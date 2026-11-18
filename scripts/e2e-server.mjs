/**
 * Starts the server for the end-to-end tests: the real Go binary serving the built app, with
 * development sign-in and a database emptied and refilled from the files of the repository,
 * so every run starts from the same content.
 *
 *   node scripts/e2e-server.mjs <port> <database>
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildServer, db, ensureDatabase, root, run, serverBin } from "./env.mjs";

const [port = "8090", database = "pm_e2e"] = process.argv.slice(2);
if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.error("dist/ is missing: run `npm run build` first.");
  process.exit(1);
}
ensureDatabase();
if (!buildServer()) process.exit(1);

// a clean slate: drop everything the server created, it is rebuilt on start (also the pgvector
// extension when it lived in public: the server creates it again)
const wipe = spawnSync("psql", [db(database).replace("?sslmode=disable", ""), "-q", "-v", "ON_ERROR_STOP=1", "-c", "drop schema public cascade; create schema public;"], { stdio: "inherit" });
if (wipe.status !== 0) {
  console.error("Could not reset the end-to-end database. Is `psql` installed and the database reachable?");
  process.exit(1);
}

const env = {
  ...process.env,
  PM_AUTH: "dev",
  DATABASE_URL: db(database),
  PM_SEED_DIR: root,
  PM_STATIC_DIR: path.join(root, "dist"),
  PM_ADDR: `127.0.0.1:${port}`,
  PM_BASE_URL: `http://127.0.0.1:${port}`,
  // search by meaning with the built-in embedder: the browser tests never call an outside service
  PM_EMBEDDINGS: "builtin",
};
const server = run(serverBin, [], { env });
const stop = () => { server.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
