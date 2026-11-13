/**
 * Lists the processes whose periodic review is overdue or due within 30 days, grouped by owner team.
 * `npm run reviews` - exits 1 when something is overdue, so a scheduled job can notify the owners.
 */
import fs from "node:fs";
import path from "node:path";
import { reviewInfo } from "../src/lib/lifecycle";
import type { Catalog, Process } from "../src/types";

const dir = path.resolve("processes");
const catalog: Catalog = JSON.parse(fs.readFileSync("catalog/catalog.json", "utf8"));
const byOwner = new Map<string, string[]>();
let overdue = 0;

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const p: Process = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const r = reviewInfo(p);
  if (r.state !== "overdue" && r.state !== "soon") continue;
  if (r.state === "overdue") overdue++;
  const team = catalog.teams.find((t) => t.id === p.owner);
  const owner = team ? `${team.name}${team.contact ? ` (${team.contact})` : ""}` : "No owner";
  byOwner.set(owner, [...(byOwner.get(owner) ?? []), `  ${r.state === "overdue" ? "\x1b[31moverdue\x1b[0m" : "\x1b[33mdue soon\x1b[0m"}  ${p.title} [${p.id}] - ${r.label.toLowerCase()}`]);
}
if (!byOwner.size) console.log("All reviews are up to date.");
for (const [owner, lines] of byOwner) console.log(`${owner}\n${lines.join("\n")}\n`);
process.exit(overdue ? 1 : 0);
