/** Writes the prompts for chat assistants to docs/, so they can be shared without running the app. */
import fs from "node:fs";
import path from "node:path";
import { createPrompt, createStandardPrompt } from "../src/lib/prompt";

const titles = (dir: string) => fs.readdirSync(path.resolve(dir)).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  return { id: d.id as string, title: d.title as string };
});
const processes = titles("processes"), standards = titles("standards");
const catalog = JSON.parse(fs.readFileSync("catalog/catalog.json", "utf8"));
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/llm-prompt.md", createPrompt("", processes, catalog, standards));
fs.writeFileSync("docs/llm-prompt-standards.md", createStandardPrompt("", catalog, processes));
console.log("Wrote docs/llm-prompt.md and docs/llm-prompt-standards.md");
