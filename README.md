# Process Manager

Capture platform processes (request a GCP project, a repository, Apigee or Akamai onboarding, an Azure landing zone…) once, and read them two ways:

- **Map** – a swim-lane flow. One lane per participant, and **the first lane is always you**.
- **Checklist** – a numbered list that says exactly what to do, with your steps expanded and ticks to track progress.

![Map view](docs/map.png)

## Run it locally

You need Node 22, Go 1.26 and Docker.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and pick who to be:

| User | Rights |
| --- | --- |
| Sam Consumer | Follows processes, reports problems |
| Alex Editor | Editor: changes processes and the lists |
| Casey Owner | Member of the Cloud Platform team, which owns “Request a GCP project” |

`npm run dev` starts three things in one terminal: a Postgres container (docker compose, port 54329), the Go server (rebuilt and restarted when a `.go` file changes) and Vite with hot reload. Processes are read from and written to `processes/` in your working copy, so you can commit them. Sample feedback is added to an empty database.

```bash
npm run db:reset
```

empties the feedback tables and adds the samples again. To use a Postgres you already run instead of Docker, set `PM_PG`, for example `PM_PG=postgres://pm:pm@localhost:5432` (it needs the databases listed in `docker/init-databases.sql`).

To try real sign-in locally, set `PM_AUTH=entra` or `google` with the variables in `.env.example` before `npm run dev`, and register `http://localhost:5173/auth/callback` with the provider.

## Architecture

Process descriptions live in this repository. A small Go server adds sign-in (Entra ID or Google), permissions, and feedback stored in Postgres. In a deployment the content is read-only and changes go through the repository; locally the app writes the files directly. Details, API and settings: [`docs/backend.md`](docs/backend.md).

## Tests

```bash
npm run test:all
```

| Command | What it covers |
| --- | --- |
| `npm test` | Frontend logic (Vitest): checker, editing helpers, layout, life-cycle, prompt, and that every file in the repository is valid |
| `npm run test:server` | Go server against a real Postgres: sign-in incl. a fake OpenID Connect provider, permissions, feedback, content files |
| `npm run test:e2e` | Playwright against the real server and database: sign-in, consumer and editor journeys, feedback, lists, AI import, read-only deployment |
| `npm run typecheck`, `npm run validate` | Types; process files and catalog |

The end-to-end tests work on a copy of the content (`.e2e/`), never on your files. CI runs all of this (`.github/workflows/ci.yml`).

## Consumer and Editor

The switch in the top bar changes what the app offers:

- **Consumer** – find a process, read the map, follow the checklist, look up teams and tools, flag what does not work.
- **Editor** – everything above plus creating and changing processes, the JSON tab, the schema check, managing teams, tools and tiers, and closing feedback.

Who is an editor is set in `config/access.json`; the switch only appears for editors. The server enforces the rights, so hiding a button is never the only protection.

## Guide

The app has a built-in **Guide** (top bar) that explains every feature, with flow charts for following a process, creating one with AI, and the feedback loop. The charts are themselves processes, drawn by the same map.

![Guide](docs/guide.png)

## How a process is described

| Concept | Meaning |
| --- | --- |
| **Owner and tiers** | `owner` is a team from the catalog. `tiers` limits the process to some application tiers (e.g. Tier 0 and Tier 1); leave it out and it applies to all. |
| **Languages** | `languages` limits the process to some programming languages (e.g. Go, JavaScript); leave it out when it does not depend on the language. |
| **Life-cycle** | `status` is `draft` (editors only), `active` or `deprecated` (retired, optionally `replacedBy`). `review` sets how often the owner must confirm it is still correct. |
| **Skills and links** | `resources` on a process or a step: self-service skills for AI assistants, repositories, templates, documentation. |
| **Prerequisites** | What must be in place before step 1. Can point to another process that produces it. |
| **Actors** | Who takes part. Each is a lane. `actors[0]` is always `me`. |
| **Steps** | One action by one actor, with a block type, exact instructions, tool, link, duration and outcome. |
| **Block types** | `form`, `code`, `approval`, `review`, `wait`, `communication`, `meeting`, `automation`, `document`, `verify`, `decision`, `subprocess`, `task` – each has its own icon and colour. |
| **Flow** | `next` on every step. Decisions have labelled branches; loops (reject → fix → resubmit) are drawn dashed. |
| **Sub-processes** | A step can set `subProcessId` to delegate to another process (e.g. “Raise a ServiceNow request”). |

The format is defined by [`schema/process.schema.json`](schema/process.schema.json) (JSON Schema 2020-12).

## Teams, tools and tiers

Processes pick their owner, participants, tools, tiers and languages from shared lists in `catalog/catalog.json` (schema: `schema/catalog.schema.json`). Manage them on the **Teams, tools & tiers** page (Editor mode): pick a list, select an entry, edit it on the right, and see which processes use it. In Consumer mode the same page is a read-only directory. A tool can also be added on the spot from the tool picker of a step. An entry that is still used by a process cannot be removed.

## Life-cycle and reviews

New processes start as **Draft** and are hidden from consumers until an editor sets them to **Active**. An active process has a review interval (3–24 months). When it is due, editors see a badge and a banner; **Mark as reviewed** records the date and restarts the interval. A retired process stays for reference and can point to its replacement.

```bash
npm run reviews
```

Lists what is overdue or due within 30 days, grouped by owner team with its contact, and exits non-zero when something is overdue, so a scheduled job can remind the owners.

## For agents (MCP, planned)

The same catalog is meant to be consumed by AI agents through an MCP server. It is not implemented yet; the planned contract and how an agent can read the files today are in [`docs/mcp.md`](docs/mcp.md). The longer-term goal, an agent that follows a process for you, is described in the in-app Guide.

## Feedback

Anyone signed in can flag a step (or the whole process) that does not work: *This step doesn’t work* in the step panel, the flag icon in the checklist, or *Report a problem*. Pick a kind, write a sentence, send; your name comes from your sign-in. Others can add *I hit this too*, which tells the owner what to fix first. Open feedback shows as a red flag on the map and on the library card.

The owner team is notified. Its members, and editors, can mark an item as fixed, which tells the reporter. If the step was changed after the feedback was written, the item says it may already be fixed. Feedback is stored in the database, not in the repository.

## Editing

Switch to **Editor** first.

- **In the checklist** – hover between two steps and press *Insert a step here*; the same small form appears in place.
- **On the map** – press **+** on an arrow to insert a step exactly there, or **+** on a block to add one after it (on a decision: a new branch). A small form on the map asks what happens, who does it and what kind of step it is. Drag a block to another lane to change who does it.
- **In the side panel** – click a block → *Edit step* for instructions, tool, link and what comes next. *Details* edits the name, owner, tiers, participants and prerequisites. Changes stay in a draft until you press **Save changes**.
- **JSON tab** – a code editor for the raw JSON: syntax colours, line numbers, folding, find, and format. Syntax errors and checker findings are marked on the line they belong to; click a finding in the side list to jump to it.
- **With AI, any chat assistant** – *Create from text with AI* / *Change with AI*:
  1. paste the description (or the change you want),
  2. copy the generated prompt into Gemini / Copilot / ChatGPT / Claude,
  3. paste the answer back. The checker validates it and, if something is wrong, gives you a *fix request* to send to the same chat.
- **With an AI coding assistant** – edit files in `processes/` directly and run the checker. Two Claude Code skills in `.claude/skills/` describe how: `edit-process` (create or change a process) and `manage-catalog` (add or change teams, tools and tiers).

The prompt is also available as a file for sharing: [`docs/llm-prompt.md`](docs/llm-prompt.md) (regenerate with `npm run prompt`). Append the process description at the bottom.

## Schema checker

```bash
npm run validate
```

Checks `catalog/catalog.json` and every file in `processes/` (or the files you pass as arguments) against the JSON schema **and** the rules a schema cannot express: unknown actors, step ids, teams, tools or tiers, duplicate ids, decisions without labelled branches, missing sub-processes, unreachable steps, processes that never end. Exits non-zero on errors, so it can run in CI. The same checker runs inside the app.

## Layout

```
processes/            one JSON file per process (the data)
catalog/catalog.json  teams, tools, application tiers and languages
config/access.json    who is an editor, who belongs to which team
server/               Go backend: sign-in, permissions, feedback
e2e/                  end-to-end tests
schema/               JSON schemas + the example used in the LLM prompt
.claude/skills/       instructions for AI coding assistants
src/lib/validate.ts   schema + semantic checker (shared by app and CLI)
src/lib/prompt.ts     prompt builder for browser LLMs
src/lib/layout.ts     swim-lane layout and edge routing
src/components/       map, checklist, step editor, AI dialog, catalog, guide
src/guide/flows.ts    the flow charts shown in the guide
scripts/              validate + prompt CLI
```

> The six sample processes are illustrative placeholders (links point to `example.com`). Replace them with your real ones.
