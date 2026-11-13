# Process Manager

Capture platform processes (request a GCP project, a repository, Apigee or Akamai onboarding, an Azure landing zone…) once, and read them two ways:

- **Map** – a swim-lane flow. One lane per participant, and **the first lane is always you**.
- **Checklist** – a numbered list that says exactly what to do, with your steps expanded and ticks to track progress.

![Map view](docs/map.png)

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Nothing leaves your machine: processes are plain JSON files in `processes/`, written by the app through a small local API in `vite.config.ts`. Commit them to git like any other file.

## How a process is described

| Concept | Meaning |
| --- | --- |
| **Prerequisites** | What must be in place before step 1. Can point to another process that produces it. |
| **Actors** | Who takes part. Each is a lane. `actors[0]` is always `me`. |
| **Steps** | One action by one actor, with a block type, exact instructions, tool, link, duration and outcome. |
| **Block types** | `form`, `code`, `approval`, `review`, `wait`, `communication`, `meeting`, `automation`, `document`, `verify`, `decision`, `subprocess`, `task` – each has its own icon and colour. |
| **Flow** | `next` on every step. Decisions have labelled branches; loops (reject → fix → resubmit) are drawn dashed. |
| **Sub-processes** | A step can set `subProcessId` to delegate to another process (e.g. “Raise a ServiceNow request”). |

The format is defined by [`schema/process.schema.json`](schema/process.schema.json) (JSON Schema 2020-12).

## Editing

- **In the app** – click a block → *Edit step*; hover a block and press **+** to add a step after it; *Details* edits the name, participants and prerequisites. Changes stay in a draft until you press **Save changes**.
- **JSON tab** – edit the raw JSON with live checking.
- **With AI, any chat assistant** – *Create from text with AI* / *Change with AI*:
  1. paste the description (or the change you want),
  2. copy the generated prompt into Gemini / Copilot / ChatGPT / Claude,
  3. paste the answer back. The checker validates it and, if something is wrong, gives you a *fix request* to send to the same chat.
- **With an AI coding assistant** – edit files in `processes/` directly and run the checker.

The prompt is also available as a file for sharing: [`docs/llm-prompt.md`](docs/llm-prompt.md) (regenerate with `npm run prompt`). Append the process description at the bottom.

## Schema checker

```bash
npm run validate
```

Checks every file in `processes/` (or the files you pass as arguments) against the JSON schema **and** the rules a schema cannot express: unknown actors or step ids, duplicate ids, decisions without labelled branches, missing sub-processes, unreachable steps, processes that never end. Exits non-zero on errors, so it can run in CI. The same checker runs inside the app.

## Layout

```
processes/            one JSON file per process (the data)
schema/               JSON schema + the example used in the LLM prompt
src/lib/validate.ts   schema + semantic checker (shared by app and CLI)
src/lib/prompt.ts     prompt builder for browser LLMs
src/lib/layout.ts     swim-lane layout and edge routing
src/components/       map, checklist, step editor, AI dialog
scripts/              validate + prompt CLI
```

> The six sample processes are illustrative placeholders (links point to `example.com`). Replace them with your real ones.
