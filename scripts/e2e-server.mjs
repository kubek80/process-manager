/**
 * Starts one server for the end-to-end tests: the real Go binary serving the built app, with
 * development sign-in, an emptied database and a private copy of the content files, so the
 * tests can edit processes without touching the repository.
 *
 *   node scripts/e2e-server.mjs <port> <writable|readonly> <database>
 */
import fs from "node:fs";
import path from "node:path";
import { buildServer, db, ensureDatabase, root, run, runAndWait, serverBin } from "./env.mjs";

const [port = "8090", mode = "writable", database = "pm_e2e"] = process.argv.slice(2);
const contentDir = path.join(root, ".e2e", `content-${port}`);

fs.rmSync(contentDir, { recursive: true, force: true });
for (const dir of ["processes", "catalog", "config"]) fs.cpSync(path.join(root, dir), path.join(contentDir, dir), { recursive: true });
if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.error("dist/ is missing: run `npm run build` first.");
  process.exit(1);
}

ensureDatabase();
if (!buildServer()) process.exit(1);

const env = {
  ...process.env,
  PM_AUTH: "dev",
  DATABASE_URL: db(database),
  PM_CONTENT_DIR: contentDir,
  PM_CONTENT_WRITABLE: mode === "writable" ? "true" : "false",
  PM_STATIC_DIR: path.join(root, "dist"),
  PM_ADDR: `127.0.0.1:${port}`,
  PM_BASE_URL: `http://127.0.0.1:${port}`,
};
if (runAndWait(serverBin, ["-reset"], { env }) !== 0) process.exit(1);

const server = run(serverBin, [], { env });
const stop = () => { server.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
