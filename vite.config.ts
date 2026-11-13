import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * Tiny local API: processes live as plain JSON files in ./processes so they can be
 * versioned in git and edited by hand, by the UI, or by an AI coding assistant.
 *
 *   GET    /api/processes        -> { processes: [...], broken: [{ file, error }] }
 *   PUT    /api/processes/:id    -> writes processes/<id>.json
 *   DELETE /api/processes/:id    -> removes processes/<id>.json
 */
function processFilesApi(): Plugin {
  const dir = path.resolve(__dirname, "processes");
  const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith("/api/processes")) return next();
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const id = decodeURIComponent(url.slice("/api/processes".length).replace(/^\//, ""));

      if (req.method === "GET" && !id) {
        const processes: unknown[] = [];
        const broken: { file: string; error: string }[] = [];
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
          try {
            processes.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")));
          } catch (e) {
            broken.push({ file, error: (e as Error).message });
          }
        }
        return send(200, { processes, broken });
      }
      if (!ID.test(id)) return send(400, { error: "Invalid process id" });
      const file = path.join(dir, `${id}.json`);

      if (req.method === "PUT") {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => {
          try {
            const data = JSON.parse(raw);
            fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
            send(200, { ok: true });
          } catch (e) {
            send(400, { error: (e as Error).message });
          }
        });
        return;
      }
      if (req.method === "DELETE") {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return send(200, { ok: true });
      }
      send(405, { error: "Method not allowed" });
    } catch (e) {
      send(500, { error: (e as Error).message });
    }
  };

  return {
    name: "process-files-api",
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  plugins: [react(), processFilesApi()],
  server: { port: 5173, watch: { ignored: ["**/processes/**"] } },
});
