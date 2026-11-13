/** Writes the browser-LLM prompt to docs/llm-prompt.md so it can be shared without running the app. */
import fs from "node:fs";
import path from "node:path";
import { createPrompt } from "../src/lib/prompt";

const dir = path.resolve("processes");
const known = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
  const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  return { id: p.id as string, title: p.title as string };
});
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/llm-prompt.md", createPrompt("", known));
console.log("Wrote docs/llm-prompt.md");
