/** `npm run test:server` - Go tests against the local test database. Extra arguments go to `go test`. */
import { db, ensureDatabase, runAndWait, serverDir } from "./env.mjs";

ensureDatabase();
const args = process.argv.slice(2);
process.exit(runAndWait("go", ["test", ...(args.length ? args : ["./..."])], {
  cwd: serverDir,
  env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? db("pm_test") },
}));
