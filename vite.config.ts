import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The Go server (server/) owns the API and sign-in. In development Vite serves the app and
// forwards those calls; in production the server serves the built app itself.
const server = process.env.PM_SERVER_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  server: {
    port: 5173,
    proxy: { "/api": server, "/auth": server },
    watch: { ignored: ["**/processes/**", "**/catalog/**", "**/server/**"] },
  },
});
