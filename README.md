# Process Manager

A portal for two questions:

- **“How do I get…?”** A **process** (request a GCP project, a repository, an Akamai onboarding…) shown as a swim-lane map, where the first lane is always you, and as a checklist with the exact actions.
- **“What must I meet?”** A **standard** (the rules of cyber security, a platform or a practice): requirements with the reason, how to comply, and how each is checked.

The home page is one search over both, by words or, where it is switched on, by meaning (Words, Meaning or Both). The search results and the lists of processes and of standards share one layout: filters on the left (category, platform, practice, rigour, owner, bookmarks, “My application”), cards with one fact per line, and pages. People bookmark, upvote and share what they use, and ask for what is missing.

From both, the portal generates **skills for AI coding assistants** and, for standards, **pull request review agents**, and keeps them up to date as the content changes. AI agents can also ask the portal directly through its **MCP server**.

![Home](docs/home.png)

![Search results with filters](docs/search.png)

![The list of processes](docs/processes.png)

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
| Sam Consumer | Reads, follows, reports problems |
| Alex Editor | Edits processes and manages the lists |
| Casey Owner | Member (Owner) of the Cloud Platform team: confirms reviews, closes feedback on what it maintains |
| Riley Security | Practice owner of Cyber security: changes what belongs to it; member of the Cyber Security team |
| Jordan Platform | Reader who is Platform owner of Google Cloud, Practice owner of Engineering and member of the Cloud Platform team |
| Dana Admin | Everything, including who has which role |

`npm run dev` starts three things in one terminal: a Postgres container (docker compose, port 54329), the Go server (rebuilt and restarted when a `.go` file changes) and Vite with hot reload. An empty database is filled from the sample content in `processes/`, `standards/` and `catalog/`, and with twelve weeks of made-up use (views, upvotes, bookmarks, skill downloads, requests) so that the numbers and Admin › Statistics show something; the end-to-end tests run without it. Search by meaning is on with the built-in provider (nothing leaves your machine); `PM_EMBEDDINGS=off npm run dev` turns it off.

| Command | Does |
| --- | --- |
| `npm run db:reset` | Empties the feedback, views, bookmarks, upvotes, skill downloads and requests, and adds all the samples again |
| `npm run db:import` | Loads the files of the repository over what is in the database |
| `npm run db:demo` | Loads a larger demo set (`demo/`: 15 more processes and 9 more standards, more teams, platforms and practices) the same way, to try search, filters and My responsibilities. Its lists replace the stored ones; `db:import` afterwards puts back the smaller sample lists |
| `npm run db:migrate` | Upgrades the database and its content to this version, says what it did and exits |
| `npm run export -- <folder>` | Writes the content and the generated skills to files |
| `npm run mcp` | Starts the MCP server for AI agents on `127.0.0.1:8081`, against the database of `npm run dev` (start that once first) |

To use a Postgres you already run instead of Docker, set `PM_PG`, for example `PM_PG=postgres://pm:pm@localhost:5432` (it needs the databases listed in `docker/init-databases.sql`, with the pgvector extension for search by meaning). To try real sign-in locally, set `PM_AUTH=entra` or `google` with the variables in `.env.example`, and register `http://localhost:5173/auth/callback` with the provider.

## How it is built

React + Vite frontend; Go server; Postgres. Everything people change lives in the database: processes, standards, the lists, roles, feedback, requests and the generated skills, and the views, bookmarks, upvotes and skill downloads. Every save is a numbered version with a note; a save made from an outdated version is refused, so two people never overwrite each other. The files in this repository are the code, the formats (`schema/`) and sample content for a first start. A database filled by an earlier version is converted by the server at its first start. Search by meaning cuts every published process and standard into parts and keeps a vector per part in Postgres with pgvector; the provider is built in or Google's Vertex AI, and off by default. Details, API and settings: [`docs/backend.md`](docs/backend.md).

## What is in it

| | |
| --- | --- |
| **Search and lists** | Home (`#/`) searches processes and standards together and shows your bookmarks. Results (`#/search?…`), the process list (`#/processes`) and the standards list (`#/standards`) share filters on the left, cards and pages of 12, 24 or 48; the search address holds the words, filters and page, so it can be shared. Where search by meaning is on, the results have a switch **Search by**: Words, Meaning, Both |
| **Processes** | Map and checklist, sub-processes, prerequisites, block types, editing on the map and in the checklist |
| **Standards** | Requirements with level (must / should / may), reason, how to comply, examples, how it is checked, and what a reviewer looks for |
| **What it belongs to** | An owning team, and optionally a category, a platform and a practice; a process also has a rigour, how binding it is (mandatory, recommended, optional), a standard follows from its requirements' levels |
| **Where it applies** | Application tiers, environments and programming languages, on a process, a standard or a single requirement; “My application” hides the rest |
| **Life-cycle** | Draft (hidden from readers), active, retired; periodic reviews by the owner |
| **Versions** | Every save is a version with who, when and a note; what changed between versions in plain words; restore; undo while editing; a warning before unsaved changes are left; a decision when somebody else saved first |
| **Feedback** | On a step (straight from the map) or a requirement, or “Give feedback” on the whole; “I hit this too”, closed by the owner, flagged when the text changed since; open and handled shown on every page |
| **Bookmarks, upvotes, sharing** | Bookmarks per person, kept on the server; one upvote per person; views and skill downloads (each once per person per day) shown on every process and standard; Share copies a link or a message for Slack or Google Chat, or opens an e-mail |
| **Requests** | `#/requests`: ask for a missing process or standard, vote; open, planned, done (linked to the published process or standard that answers it) or declined with a reason; withdrawn by the requester while open, removed by an admin |
| **My responsibilities** | For owners: reviews to do, feedback waiting, drafts, and everything of their teams, platforms and practices, on one page with a count in the top bar |
| **Skills** | Generated per process and per standard, versioned automatically, with optional hand-written guidance |
| **Admin panel** | Roles, the lists (teams, practices and platforms with their members, categories, tools, tiers, environments, languages), the skills registry, health, activity, statistics (`#/admin/statistics`: use per process and standard and per platform, practice and team, per period, as CSV) |
| **MCP server** | AI agents search and read the published processes and standards, the steps of one participant, the skills and the lists, and report problems for a person; a separate program on the same database, reachable from its own machine or with a shared secret. [`docs/mcp.md`](docs/mcp.md) |
| **AI authoring** | A self-contained prompt for any chat assistant turns text into a process or a standard; the checker validates what comes back |

![A standard](docs/standard.png)

![Versions of a process](docs/versions.png)

![My responsibilities](docs/responsibilities.png)

![Requests for what is missing](docs/requests.png)

The in-app **Guide** (top bar) is the main documentation and describes all of this, with flow charts drawn by the app's own map.

![Guide](docs/guide.png)

## Roles

Everyone who signs in (Entra ID or Google) can read, tick and give feedback. Roles are given in **Admin › Access** and stored in the database:

| Role | Adds |
| --- | --- |
| Owner (of one team) | Confirm reviews and close feedback on what the team maintains; a page of their own, **My responsibilities**, shows what is waiting |
| Platform owner (of one platform) | Create, change and delete the processes and standards that belong to the platform, and everything an Owner does for them; move along the requests that name the platform |
| Practice owner (of one practice) | The same for one practice |

A platform or practice owner may set or change the platform of a process or standard only from one of their own platforms to another (or to or from none): a platform that is not theirs stays as it is, and only its owners or an editor can change it. The same goes, separately, for the practice. They may change everything else, the owning team included; editors are not limited this way.
| Process editor | Create and change every process; move requests for processes along |
| Standards editor | Create and change every standard; move requests for standards along |
| Lists manager | Teams, practices, platforms, categories, tools, tiers, environments, languages |
| Admin | Everything, including roles and the statistics |

The members of a team, platform or practice are the people with Owner, Platform owner or Practice owner for it. Admins add them on the entry in **Admin › Lists** or person by person in **Admin › Access**; everyone can see them under **Teams & tools**. One person can be in a team, a platform and a practice at once. The rules in detail: the Guide and [`docs/backend.md`](docs/backend.md).

The first admins are named in the server setting `PM_ADMINS`.

![Admin panel](docs/admin.png)

![A platform and its members](docs/platforms.png)

![Statistics](docs/statistics.png)

## Tests

```bash
npm run test:all
```

| Command | What it covers |
| --- | --- |
| `npm test` | Frontend logic (Vitest): both checkers, editing helpers, undo and the rules for saving, comparing versions, layout, life-cycle, search (by words, by meaning, both), pages and cards, sharing, requests, statistics, prompts, rights and members, and that every sample file and the demo set are valid |
| `npm run test:server` | Go server against a real Postgres: sign-in incl. a fake OpenID Connect provider, roles, content with versions and concurrent saves, skill generators, feedback, views, bookmarks, upvotes, requests, statistics, admin, start-up and shutdown, chunking, embeddings (Vertex AI only against a local stand-in), the search index, the MCP server |
| `npm run test:e2e` | Playwright against the real server and database: consumer and editor journeys for processes and standards, versions and two people editing at once, feedback, the Admin panel, skills, AI import, the list filters, cards and pages, the map, views, upvotes, bookmarks and sharing, requests, statistics |
| `npm run typecheck`, `npm run validate` | Types; the sample files (or an exported folder) against the schemas and rules |

The end-to-end tests use their own database, emptied at the start of every run. CI runs all of this (`.github/workflows/ci.yml`).

## Formats and command line

- `schema/process.schema.json`, `schema/standard.schema.json`, `schema/catalog.schema.json` define the formats (JSON Schema 2020-12). The app, the server and the command line all use them.
- `npm run validators` regenerates `src/lib/validators.generated.js`, the checks the app runs, after a schema changed (the app does not build them in the browser, so that its security policy can forbid `eval`). A unit test fails when this was forgotten.
- `npm run validate [folder]` checks files against the schemas and the rules a schema cannot express. A folder other than the repository is checked as it is loaded, over the sample content: `npm run validate demo`.
- `npm run reviews [folder]` lists processes and standards whose review is overdue or due within 30 days, grouped by owner, and exits non-zero when something is overdue. Run it on an exported folder for live content.
- `npm run prompt` regenerates `docs/llm-prompt.md` and `docs/llm-prompt-standards.md`, the prompts for chat assistants as shareable files.

## For agents

![Skills registry](docs/skills.png)

An assistant gets this knowledge in two ways: generated skills put in the repository it works in, or live through the MCP server (`server/cmd/mcp`, `npm run mcp`): its tools, settings, guard and what is still planned (sign-in through a gateway, counting use by agents) are in [`docs/mcp.md`](docs/mcp.md).

Working on this repository with an AI coding assistant: `CLAUDE.md` and the skills in `.claude/skills/` (`edit-process`, `edit-standard`, `manage-catalog`, `update-docs`) describe how. Documentation is updated as the last step of every change.

## Layout

```
src/                  frontend (components, lib with checker / layout / prompts, guide)
server/               Go backend
schema/               formats + the examples used in the prompts
processes/ standards/ catalog/   sample content that fills an empty database
e2e/                  end-to-end tests
scripts/              dev, mcp, test, validate, validators, prompt, reviews
docs/                 backend.md, mcp.md, generated prompts, screenshots
```

> The sample processes and standards are illustrative placeholders (links point to `example.com`). Replace them with your real ones in the portal.
