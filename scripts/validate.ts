/** Schema checker for the command line: `npm run validate [file ...]` (defaults to processes/*.json). */
import fs from "node:fs";
import path from "node:path";
import { validateCatalog, validateProcess } from "../src/lib/validate";
import type { Catalog } from "../src/types";

const dir = path.resolve("processes");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f));

const known = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
let errors = 0, warnings = 0;

// the catalog first: tiers, teams and tools that processes pick from
const catalogFile = path.resolve("catalog/catalog.json");
let catalog: Catalog | undefined;
try {
  const raw = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const issues = validateCatalog(raw);
  errors += issues.length;
  console.log(`${issues.length ? "\x1b[31m✗" : "\x1b[32m✓"} catalog/catalog.json\x1b[0m`);
  for (const i of issues) console.log(`    ${i.level.padEnd(7)} ${i.path}: ${i.message}`);
  if (!issues.length) catalog = raw;
} catch (e) {
  console.log(`\x1b[31m✗ catalog/catalog.json\x1b[0m\n    error  ${(e as Error).message}`);
  errors++;
}

for (const file of files) {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`\x1b[31m✗ ${file}\x1b[0m\n    error  not valid JSON: ${(e as Error).message}`);
    errors++;
    continue;
  }
  const issues = validateProcess(data, { processIds: known, catalog });
  const id = (data as { id?: string }).id;
  if (id && path.basename(file) !== `${id}.json` && path.dirname(path.resolve(file)) === dir)
    issues.push({ level: "error", path: "id", message: `file name must be ${id}.json` });
  const e = issues.filter((i) => i.level === "error").length;
  errors += e;
  warnings += issues.length - e;
  console.log(`${e ? "\x1b[31m✗" : issues.length ? "\x1b[33m!" : "\x1b[32m✓"} ${path.relative(".", file)}\x1b[0m`);
  for (const i of issues) console.log(`    ${i.level.padEnd(7)} ${i.path}: ${i.message}`);
}
console.log(`\n${files.length} file(s), ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
