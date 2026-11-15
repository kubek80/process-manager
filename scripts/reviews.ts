/**
 * Lists the processes and standards whose periodic review is overdue or due within 30 days, grouped by owner team.
 * `npm run reviews` - exits 1 when something is overdue, so a scheduled job can notify the owners.
 */
import fs from "node:fs";
import path from "node:path";
import { reviewInfo } from "../src/lib/lifecycle";
import type { Catalog, Governed } from "../src/types";

// default: the seed content of the repository; pass a folder written by `npm run export` for live content
const root = path.resolve(process.argv[2] ?? ".");
const catalog: Catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog/catalog.json"), "utf8"));
const byOwner = new Map<string, string[]>();
let overdue = 0;

for (const folder of ["processes", "standards"]) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const p: Governed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const r = reviewInfo(p);
    if (r.state !== "overdue" && r.state !== "soon") continue;
    if (r.state === "overdue") overdue++;
    const team = catalog.teams.find((t) => t.id === p.owner);
    const owner = team ? `${team.name}${team.contact ? ` (${team.contact})` : ""}` : "No owner";
    const what = folder === "processes" ? "process" : "standard";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), `  ${r.state === "overdue" ? "\x1b[31moverdue\x1b[0m" : "\x1b[33mdue soon\x1b[0m"}  ${what}: ${p.title} [${p.id}] - ${r.label.toLowerCase()}`]);
  }
}
if (!byOwner.size) console.log("All reviews are up to date.");
for (const [owner, lines] of byOwner) console.log(`${owner}\n${lines.join("\n")}\n`);
process.exit(overdue ? 1 : 0);
