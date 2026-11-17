/**
 * Checker for the command line: `npm run validate [folder]`.
 * Checks catalog/catalog.json, processes/*.json and standards/*.json in the folder (default: the
 * repository, i.e. the seed content; pass a folder written by `npm run export` to check live content).
 * Another folder is checked as it is loaded: over the repository's sample content. Its documents
 * may name the sample processes and standards, and without a catalog of its own it uses the
 * repository's lists (`npm run validate demo`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCatalog, validateProcess, validateStandard } from "../src/lib/validate";
import type { Catalog, Issue } from "../src/types";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] ?? ".");
const overSample = root !== repo;
const read = (dir: string, at = root) => (fs.existsSync(path.join(at, dir)) ? fs.readdirSync(path.join(at, dir)).filter((f) => f.endsWith(".json")).sort() : []);
const processFiles = read("processes"), standardFiles = read("standards");
const ids = (files: string[]) => files.map((f) => f.replace(/\.json$/, ""));
const known = (dir: string, files: string[]) => [...new Set([...ids(files), ...(overSample ? ids(read(dir, repo)) : [])])];
let errors = 0, warnings = 0, files = 0;

function report(file: string, issues: Issue[]) {
  files++;
  const e = issues.filter((i) => i.level === "error").length;
  errors += e;
  warnings += issues.length - e;
  console.log(`${e ? "\x1b[31m✗" : issues.length ? "\x1b[33m!" : "\x1b[32m✓"} ${file}\x1b[0m`);
  for (const i of issues) console.log(`    ${i.level.padEnd(7)} ${i.path}: ${i.message}`);
}
function load(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); } catch (e) {
    report(file, [{ level: "error", path: "(file)", message: `not valid JSON: ${(e as Error).message}` }]);
    return undefined;
  }
}

// the lists first: processes and standards pick from them
let catalog: Catalog | undefined;
const ownCatalog = fs.existsSync(path.join(root, "catalog/catalog.json"));
if (ownCatalog || !overSample) {
  const rawCatalog = load("catalog/catalog.json");
  if (rawCatalog !== undefined) {
    const issues = validateCatalog(rawCatalog);
    report("catalog/catalog.json", issues);
    if (!issues.length) catalog = rawCatalog as Catalog;
  }
} else {
  catalog = JSON.parse(fs.readFileSync(path.join(repo, "catalog/catalog.json"), "utf8")) as Catalog;
}
const ctx = { processIds: known("processes", processFiles), standardIds: known("standards", standardFiles), catalog };

for (const [dir, list, check] of [["processes", processFiles, validateProcess], ["standards", standardFiles, validateStandard]] as const) {
  for (const f of list) {
    const data = load(`${dir}/${f}`);
    if (data === undefined) continue;
    const issues = check(data, ctx);
    const id = (data as { id?: string }).id;
    if (id && f !== `${id}.json`) issues.push({ level: "error", path: "id", message: `file name must be ${id}.json` });
    report(`${dir}/${f}`, issues);
  }
}
console.log(`\n${files} file(s), ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
