import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

/**
 * Tiny local API: everything lives as plain JSON files so it can be versioned in git
 * and edited by hand, by the UI, or by an AI coding assistant.
 *
 *   GET        /api/processes      -> { processes: [...], broken: [{ file, error }] }
 *   PUT/DELETE /api/processes/:id  -> processes/<id>.json
 *   GET/PUT    /api/catalog        -> catalog/catalog.json (tiers, teams, tools)
 *   GET        /api/feedback       -> { [processId]: Feedback[] }
 *   PUT        /api/feedback/:id   -> feedback/<processId>.json
 */
function processFilesApi(): Plugin {
  const root = __dirname;
  const dir = path.resolve(root, "processes");
  const feedbackDir = path.resolve(root, "feedback");
  const catalogFile = path.resolve(root, "catalog/catalog.json");
  const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
  const readJson = (file: string, fallback: unknown) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
  const writeJson = (file: string, data: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0];
    const m = url.match(/^\/api\/(processes|feedback|catalog)(?:\/([^/]*))?$/);
    if (!m) return next();
    const [, kind, rawId] = m;
    const id = decodeURIComponent(rawId ?? "");
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    const body = (then: (data: unknown) => void) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        try { then(JSON.parse(raw)); send(200, { ok: true }); } catch (e) { send(400, { error: (e as Error).message }); }
      });
    };
    try {
      if (kind === "catalog") {
        if (req.method === "GET") return send(200, readJson(catalogFile, { tiers: [], languages: [], teams: [], tools: [] }));
        if (req.method === "PUT") return body((data) => writeJson(catalogFile, data));
        return send(405, { error: "Method not allowed" });
      }

      if (req.method === "GET" && !id) {
        if (kind === "feedback") {
          const all: Record<string, unknown> = {};
          if (fs.existsSync(feedbackDir))
            for (const file of fs.readdirSync(feedbackDir).filter((f) => f.endsWith(".json")))
              try { all[file.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(feedbackDir, file), "utf8")); } catch { /* skip broken file */ }
          return send(200, all);
        }
        fs.mkdirSync(dir, { recursive: true });
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
      if (!ID.test(id)) return send(400, { error: "Invalid id" });
      const file = path.join(kind === "feedback" ? feedbackDir : dir, `${id}.json`);

      if (req.method === "PUT") {
        return body((data) => {
          // an empty feedback list means: no file
          if (kind === "feedback" && Array.isArray(data) && data.length === 0) { if (fs.existsSync(file)) fs.unlinkSync(file); }
          else writeJson(file, data);
        });
      }
      if (req.method === "DELETE") {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        const fb = path.join(feedbackDir, `${id}.json`);
        if (kind === "processes" && fs.existsSync(fb)) fs.unlinkSync(fb);
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
  server: { port: 5173, watch: { ignored: ["**/processes/**", "**/feedback/**", "**/catalog/**"] } },
});
