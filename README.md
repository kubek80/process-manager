# Process Manager

A portal for two questions:

- **“How do I get…?”** A **process** (request a GCP project, a repository, an Akamai onboarding…) shown as a swim-lane map, where the first lane is always you, and as a checklist with the exact actions.
- **“What must I meet?”** A **standard** (the rules of cyber security, a platform or a practice): requirements with the reason, how to comply, and how each is checked.

The home page is one search over both, by words or, where it is switched on, by meaning (Words, Meaning or Both), with what was recently updated and what is most viewed. The search results and the lists of processes and of standards share one layout: tabs for processes and standards, filters on the left (category, platform, practice, how binding, path, owner, bookmarks, reviews due, and “My application”: tier, path, environment, language), cards or rows, a choice of order, and pages; the address holds the search and filters, so a list can be shared. People bookmark, upvote and share what they use, and ask for what is missing.

Everyone reads the same pages. Whoever may change a process or standard gets **Edit**, which opens a separate editing screen: an outline where steps are added by typing their names and moved by dragging (the flow follows, and the screen says what that did to a decision's answers, with Undo), the fields of what is selected right next to it, and after them the map or the requirements as readers will see them. Changes are saved as a draft that readers, skills, search and agents do not see until somebody publishes them. The members of a platform or practice write such drafts; its owners publish them.

A process or standard can say which **path** it is made for: Greenfield (something new), Brownfield (something that exists) or the Paved path (the golden path: the ready-made way), each with a picture of its own on cards, rows and a small road on its page; most name none and apply whatever the path.

Every team, platform and practice has a page of its own: what it is, how to reach it (group email, Slack, Google Chat, Confluence, their page, a request form), its owners and members, and what belongs to it.

The default look is the company designer's palette (Ocean, Sky, Snow, Midnight, Sun, Earth, Grain, Land, Berry) in Roboto, with a fixed type scale. An admin changes the portal's name, logo, colours (brand, second colour, ink, processes and standards, main and other buttons, success, warning, information and problem, highlight, quiet surface) and font in **Admin › Theming**, with a live preview in light and dark; the colours are kept readable, the process maps follow them, and the app warns in plain words when one would be mistaken for another. An admin can also **view the portal as another person**, to check what they see and what they are responsible for, without being able to change anything.

From both, the portal generates **skills for AI coding assistants** and, for standards, **pull request review agents**, and keeps them up to date as the content changes. AI agents can also ask the portal directly through its **MCP server**.

![Home](docs/home.png)

![Search results with filters](docs/search.png)

![The same results as rows](docs/search-rows.png)

![The list of processes](docs/processes.png)

![Map view](docs/map.png)

![The editing screen](docs/editing.png)

![Publishing a change](docs/publish.png)

![A process that is for one path, with all paths of the list as lanes](docs/path.png)

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
| Casey Owner | Owner of the Cloud Platform team: confirms reviews, closes feedback on what it maintains |
| Riley Security | Practice owner of Cyber security: changes what belongs to it; Owner of the Cyber Security team |
| Jordan Platform | Reader who is Platform owner of Google Cloud, Practice owner of Engineering and Owner of the Cloud Platform team |
| Morgan Member | Platform member of Google Cloud and Practice member of Engineering: writes drafts there, which an owner publishes |
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

React + Vite frontend; Go server; Postgres. Everything people change lives in the database: processes, standards, the lists, roles, feedback, requests and the generated skills, and the views, bookmarks, upvotes and skill downloads. Every save is a numbered version with a note; changes to something published wait beside it as one shared working draft until they are published, and so do unfinished changes to a draft, so Save draft always works; a save made from an outdated version (or draft) is refused, so two people never overwrite each other. The files in this repository are the code, the formats (`schema/`) and sample content for a first start. A database filled by an earlier version is converted by the server at its first start. Search by meaning cuts every published process and standard into parts and keeps a vector per part in Postgres with pgvector; the provider is built in (word-based, for trying it and for tests) or Google's Vertex AI, and off by default. The index follows saves in the background. Details, API and settings: [`docs/backend.md`](docs/backend.md).

## What is in it

| | |
| --- | --- |
| **Search and lists** | Home (`#/`) searches processes and standards together, shows your bookmarks, what was recently updated and what is most viewed, and lets you browse by platform, practice, team (each opens its page) and category. Results (`#/search?…`), the process list (`#/processes?…`) and the standards list (`#/standards?…`) share filters on the left, cards or rows, sorting (best match or name, newest, recently updated) and pages of 12, 24 or 48; the address holds the words, filters, order and page, so it can be shared. Where search by meaning is on, the results have a choice **Words**, **Meaning**, **Both**, and a word search that finds nothing shows the closest by meaning |
| **Processes** | Map (with zoom: the buttons or Ctrl + scroll; Fit shows the whole flow until a step is selected; the selected step is brought to the middle; the steps are one Tab stop with arrow keys) and checklist, both under one compact “Before you start” panel, sub-processes, prerequisites, block types; a phone opens on the checklist; printing gives the checklist with every step and a line saying which version was printed |
| **Editing** | A separate editing screen (`#/p/<id>/edit`, `#/s/<id>/edit`): the outline (add by typing names, drag or Alt+arrows to move, or, by choice, a narrow rail), the fields of what is selected next to it (with arrows and Alt + Page Up / Down to the step or requirement before or after), what readers will see after them (the map or the requirements, changeable in place), what is to fix and suggestions (choosing one puts the cursor in the field), and Save draft / Publish; a fault in showing the screen keeps the changes and offers Undo and Save draft. Save draft always works: changes to something published stay unpublished changes, and unfinished changes to a draft stay beside it, seen only by whoever may write drafts of it; a member of the platform or practice saves drafts and is told who publishes them; problems are shown on their own field as instructions; moving or deleting a step says what that did to the flow; retire, unpublish and delete are explicit |
| **Standards** | Requirements with level (must / should / may), reason, how to comply, examples, how it is checked, and what a reviewer looks for; printing gives every requirement |
| **Teams, platforms and practices** | Teams & tools (`#/catalog/<list>/<id>`) lists them, your own first, marked “You are an owner” / “You are a member”; each has a page (`#/team/<id>`, `#/platform/<id>`, `#/practice/<id>`) with its description, how to reach it, its owners and members and what belongs to it; its owners edit the details and add or remove the members there; the names in the head of a process or standard lead to these pages |
| **What it belongs to** | An owning team, and optionally a category, a platform and a practice; a process also has a rigour, how binding it is (mandatory, recommended, optional), a standard follows from its requirements' levels |
| **Where it applies** | Application tiers, environments and programming languages, on a process, a standard or a single requirement; the Tier, Environment and Language filters (“My application” on a standard) hide the rest |
| **Architecture patterns** | A list an organisation fills itself (API-first, Microservices, Event-driven…, each with other names such as “EDA”); a process or standard is tagged with the ones it is about. A fact in the head of its page, the Architecture pattern filter on the lists and the search, found by its names; a tag hides nothing and is not part of My application |
| **Tribes and domains** | Optional groups of teams: a team may be part of a tribe, a tribe of a domain. Teams & tools shows the teams under their domain and tribe, a team's page says where it belongs, and a tribe and a domain have pages of their own (`#/tribe/…`, `#/domain/…`) with their teams and what those teams own. No rights come from them |
| **Paths** | A list: Greenfield, Brownfield, Paved path (also called the golden path), and any an organisation adds, each with a picture and other names; a process or standard names one only when it is meant only for that kind of work. Plates on cards and rows, “Which path is this for” on its page, the Path filter (“made for”) and My application's Path (“applies to”); searching “golden path” finds the paved path |
| **Life-cycle** | Draft (never published, hidden from readers), active, retired; periodic reviews by the owner, the first counted from first publication; due, overdue, “today” and the date a review or save records follow the reader's own day |
| **Versions** | Every publish is a version with who, when and a note; what changed between versions in plain words; restore; undo while editing; a warning before unsaved changes are left; a decision when somebody else saved the draft or published first |
| **Feedback** | On a step (straight from the map) or a requirement, or “Give feedback” on the whole; “I hit this too”, closed by the owner, flagged when the text changed since; open and handled shown on every page |
| **Bookmarks, upvotes, sharing** | Bookmarks per person, kept on the server; one upvote per person; views and skill downloads (each once per person per day) shown on every process and standard; Share copies the link (or the link and title), opens an e-mail, or uses the device's own share sheet where the browser has one |
| **Requests** | `#/requests`: ask for a missing process or standard, vote; open, planned, done (linked to the published process or standard that answers it) or declined with a reason; withdrawn by the requester while open, removed by an admin |
| **My responsibilities** | For owners: reviews to do, feedback waiting, what others saved that waits for them to publish (“Review and publish”), their own unfinished work, and everything of their teams, platforms and practices, on one page with a count in the top bar; for members: their drafts and what waits for an owner |
| **Skills** | Generated per process and per standard, versioned automatically, with optional hand-written guidance |
| **Admin panel** | People and their roles (all of a person's roles in one dialog), viewing the portal as any person (read only, for an hour, recorded in Activity), the twelve lists in three groups (teams, tribes, domains, practices and platforms with how to reach them, their owners and members; categories, tools and languages with icons, architecture patterns; tiers, paths with their pictures, environments; what is to fix in them in plain words, each leading to its field), the skills registry, health, activity, statistics (`#/admin/statistics`: use per process and standard and per platform, practice and team, per period, as CSV), theming (`#/admin/theming`), and the code map (`#/admin/code`, for developers who review or maintain the portal: its code in categories with what each part and file must do, flow charts, the tables, and the files themselves with those requirements as comments where the portal runs beside its source) |
| **Look of the portal** | The designer's palette by default; admins set the name, logo, brand, second colour and ink, the colours of processes and standards, of main and other buttons, of the four states, the highlight and the quiet surface, the font (Roboto by default, or Inter, both shipped with the portal), and light or dark for new visitors; text comes in three sizes and three weights, backgrounds in the tints of the brand and second colour; readable variants and plain warnings are worked out by the app, and saving with warnings asks once; everyone sees the new look on their next page; not part of export and import |
| **MCP server** | AI agents search and read the published processes and standards, the steps of one participant, the skills and the lists, and report problems for a person; a separate program on the same database, reachable from its own machine or with a shared secret. [`docs/mcp.md`](docs/mcp.md) |
| **AI authoring** | A self-contained prompt for any chat assistant turns text into a process or a standard; the checker validates what comes back |

![A standard](docs/standard.png)

![Versions of a process](docs/versions.png)

![My responsibilities](docs/responsibilities.png)

![Waiting for an owner to publish](docs/waiting.png)

![Requests for what is missing](docs/requests.png)

![Sharing a process](docs/share.png)

The in-app **Guide** (top bar) is the main documentation and describes all of this, with flow charts drawn by the app's own map: each can be dragged, zoomed and enlarged, as can the charts of the code map.

![Guide](docs/guide.png)

## Roles

Everyone who signs in (Entra ID or Google) can read, tick and give feedback. Roles are given in **Admin › Access** and stored in the database:

| Role | Adds |
| --- | --- |
| Owner (of one team) | Confirm reviews and close feedback on what the team maintains; change the team's description and how to reach it; a page of their own, **My responsibilities**, shows what is waiting |
| Platform owner (of one platform) | Edit, publish and delete the processes and standards that belong to the platform and create new ones, publish what its members wrote, and everything an Owner does for them; move along the requests that name the platform; add and remove its members; change its description and how to reach it |
| Practice owner (of one practice) | The same for one practice |
| Platform member (of one platform) | Create drafts there and save changes to what belongs to the platform as drafts, for an owner to publish; never publishes, retires or deletes, confirms no reviews and answers no feedback |
| Practice member (of one practice) | The same for one practice |
| Process editor | Create, edit and publish every process; move requests for processes along |
| Standards editor | Create, edit and publish every standard; move requests for standards along |
| Lists manager | Teams, tribes, domains, practices, platforms, categories, tools, architecture patterns, tiers, paths, environments, languages, and the icons of tools and languages |
| Admin | Everything, including roles and the statistics; viewing the portal as another person, read only |

There is no separate editor mode: the buttons people see follow their rights, and the server checks the same rights on every change. Publishing something for the first time needs an owner of every platform and practice it names, or an editor. A platform or practice owner or member may set or change the platform of a process or standard only from one of their own platforms to another (or to or from none): a platform that is not theirs stays as it is, and only its owners and members or an editor can change it. The same goes, separately, for the practice. They may change everything else, the owning team included; editors are not limited this way.

The owners of a team, platform or practice are the people with Owner, Platform owner or Practice owner for it; the members of a platform or practice those with Platform member or Practice member. Admins give these roles on the entry in **Admin › Lists** or person by person in **Admin › Access**, which also sets or removes all of a person's roles at once; an owner of a platform or practice adds and removes its members on its page; everyone can see them under **Teams & tools** and on the page. One person can be in a team, a platform and a practice at once. The rules in detail: the Guide and [`docs/backend.md`](docs/backend.md).

The first admins are named in the server setting `PM_ADMINS`.

![Admin panel](docs/admin.png)

![The roles of one person](docs/roles.png)

![An admin viewing the portal as another person: the band, and what would change something greyed](docs/view-as.png)

![Admin › Lists: the paths, with their pictures and other names](docs/paths-list.png)

![Processes narrowed down by an architecture pattern](docs/patterns.png)

![Teams & tools: teams grouped under their domain and tribe](docs/tribes.png)

![The page of a tribe: its domain, its teams and what they look after](docs/tribe.png)

![Admin › Theming with its preview](docs/theming.png)

![An alert on a page: review overdue, with what to do](docs/alert.png)

![A platform and its members](docs/platforms.png)

![The page of a platform](docs/group.png)

![Tools with their icons](docs/tools.png)

![Statistics](docs/statistics.png)

![Admin › Code map](docs/code-map.png)

![A file in the code map, with its requirements as comments](docs/code-map-file.png)

## Tests

```bash
npm run test:all
```

| Command | What it covers |
| --- | --- |
| `npm test` | Frontend logic (Vitest): both checkers, editing helpers, undo and the rules for saving, the editing screen's states and calls, comparing versions, sorting, zoom, icons, the roles dialog, layout, life-cycle, search (by words, by meaning, both), pages and cards, sharing, requests, statistics, the look of the portal, prompts, rights (who drafts, who publishes), owners and members, the pages of teams, platforms and practices, that every sample file and the demo set are valid, and that the code map matches the code (every path exists, every comment's line is there, every source file is in a category) |
| `npm run test:server` | Go server against a real Postgres: sign-in incl. a fake OpenID Connect provider, roles and people, the members and details of teams, platforms and practices, content with versions and concurrent saves, working drafts and publishing, icons, skill generators, feedback, views, bookmarks, upvotes, requests, statistics, the look of the portal, admin, the source files of the code map and what it refuses, start-up and shutdown, chunking, embeddings (Vertex AI only against a local stand-in), the search index, the MCP server |
| `npm run test:e2e` | Playwright against the real server and database: reader and editor journeys for processes and standards, the editing screen, drafts and publishing, versions and two people editing at once, feedback, the Admin panel, skills, AI import, the list filters, cards and pages, the map, views, upvotes, bookmarks and sharing, requests, statistics, theming, the search switch (Words, Meaning, Both) |
| `npm run typecheck`, `npm run validate` | Types; the sample files (or an exported folder) against the schemas and rules |

The end-to-end tests use their own database, emptied at the start of every run. CI runs all of this (`.github/workflows/ci.yml`).

## Formats and command line

- `schema/process.schema.json`, `schema/standard.schema.json`, `schema/catalog.schema.json` define the formats (JSON Schema 2020-12). The app, the server and the command line all use them.
- `npm run validators` regenerates `src/lib/validators.generated.js`, the checks the app runs, after a schema changed (the app does not build them in the browser, so that its security policy can forbid `eval`). A unit test fails when this was forgotten.
- `npm run validate [folder]` checks files against the schemas and the rules a schema cannot express. A folder other than the repository is checked as it is loaded, over the sample content: `npm run validate demo`.
- `npm run reviews [folder]` lists processes and standards whose review is overdue or due within 30 days, grouped by owner, and exits non-zero when something is overdue. It counts in UTC days, as the MCP server does (the app counts in the reader's own day). Run it on an exported folder for live content.
- `npm run prompt` regenerates `docs/llm-prompt.md` and `docs/llm-prompt-standards.md`, the prompts for chat assistants as shareable files.

## For agents

![Skills registry](docs/skills.png)

An assistant gets this knowledge in two ways: generated skills put in the repository it works in, or live through the MCP server (`server/cmd/mcp`, `npm run mcp`): its tools, settings, guard and what is still planned (sign-in through a gateway, counting use by agents) are in [`docs/mcp.md`](docs/mcp.md).

Working on this repository with an AI coding assistant: `CLAUDE.md` and the skills in `.claude/skills/` (`edit-process`, `edit-standard`, `manage-catalog`, `update-docs`) describe how. Documentation is updated as the last step of every change.

## Layout

```
src/                  frontend (components, lib with checker / layout / prompts, guide, codemap: the code map of Admin › Code map)
server/               Go backend
schema/               formats + the examples used in the prompts
processes/ standards/ catalog/   sample content that fills an empty database (icons in catalog/icons/)
e2e/                  end-to-end tests
scripts/              dev, mcp, test, validate, validators, prompt, reviews
deploy/cloudrun/      deploying on Google Cloud Run behind Identity-Aware Proxy (steps in its README.md)
docs/                 backend.md, mcp.md, generated prompts, screenshots
```

> The sample processes and standards are illustrative placeholders (links point to `example.com`). Replace them with your real ones in the portal.
