/**
 * `npm run mcp` - the MCP server for AI agents, against the development database.
 *
 * It uses the database and settings of `npm run dev` (start that once first: the portal server
 * creates the tables and fills an empty database; this server only reads them, and stores the
 * problems agents report). It listens on 127.0.0.1:8081 unless PM_MCP_ADDR says otherwise.
 * Set PM_MCP_SECRET (32 characters or more) to require a shared secret.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { db, ensureDatabase, run, serverDir } from "./env.mjs";

const mcpBin = path.join(serverDir, ".bin", process.platform === "win32" ? "mcp.exe" : "mcp");

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? db("pm_dev"),
  PM_BASE_URL: process.env.PM_BASE_URL ?? "http://localhost:5173",
  PM_EMBEDDINGS: process.env.PM_EMBEDDINGS ?? "builtin",
  PM_MCP_ADDR: process.env.PM_MCP_ADDR ?? "127.0.0.1:8081",
};

ensureDatabase();
// -trimpath: as for the server, so that virus scanners on Windows leave the binary alone
const built = spawnSync("go", ["build", "-trimpath", "-o", mcpBin, "./cmd/mcp"], { cwd: serverDir, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);

const endpoint = `http://${env.PM_MCP_ADDR}/mcp`;
const config = { mcpServers: { "process-manager": { type: "http", url: endpoint, ...(env.PM_MCP_SECRET ? { headers: { Authorization: "Bearer ${PM_MCP_SECRET}" } } : {}) } } };
console.log(`[mcp] MCP server at ${endpoint} (streamable HTTP)`);
console.log(`[mcp] connect a client, e.g. in .mcp.json: ${JSON.stringify(config)}`);

const child = run(mcpBin, [], { env });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
