// Shared by the dev and test scripts: where the databases are and how to run things.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const serverDir = path.join(root, "server");
export const serverBin = path.join(serverDir, ".bin", process.platform === "win32" ? "server.exe" : "server");

/**
 * PM_PG points at a Postgres server (without a database name). The default is the one from
 * docker-compose.yml; set it to use another, e.g. PM_PG=postgres://pm:pm@localhost:5432
 */
export const usesCompose = !process.env.PM_PG;
const base = (process.env.PM_PG ?? "postgres://pm:pm@localhost:54329").replace(/\/$/, "");
export const db = (name) => `${base}/${name}?sslmode=disable`;

/** Start the compose database unless another server was configured. */
export function ensureDatabase() {
  if (!usesCompose) return;
  const r = spawnSync("docker", ["compose", "up", "-d", "--wait", "db"], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("\nCould not start the database. Start Docker and try again,\nor point PM_PG at a Postgres you already have, e.g. PM_PG=postgres://pm:pm@localhost:5432\n");
    process.exit(1);
  }
}

export function buildServer() {
  // -trimpath: without it, Windows Defender's heuristics have flagged the binary as malware and deleted it
  const r = spawnSync("go", ["build", "-trimpath", "-o", serverBin, "./cmd/server"], { cwd: serverDir, stdio: "inherit" });
  return r.status === 0;
}

export function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: "inherit", ...opts });
}

export function runAndWait(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  return r.status ?? 1;
}
