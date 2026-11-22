---
name: update-docs
description: Bring the documentation in line with the code. Use at the END of EVERY task that changes code, configuration, schemas, scripts, the API or how the app behaves - before the final summary and before committing - even when nobody asked for documentation. Also use when asked to document a feature or to check that the docs are current.
---

# Update the documentation

A task that changes the code is not finished until the documentation says the same thing as the code. Do this as the last step, in the same commit as the change.

## 1. See what changed

```bash
git status --short && git diff --stat
```

For each change ask: would someone who uses, edits, runs or deploys the app now be told something wrong, or not be told something they need?

Then check the code map (Admin › Code map, `src/codemap/categories/*.ts`): for every file you touched, read what the categories that list it say about it (`grep -rn "path/of/the/file" src/codemap/categories`): its role, its requirements and their anchors (`at`), the tables, charts and examples that name it. Change every sentence that is no longer true, keep each anchor on the line that enforces the rule, and place every new source file in the category (or categories) it belongs to, with a role and what it must do. `npx vitest run src/codemap` fails on a missing path, an anchor that is no longer in its file, or a source file in no category; a wrong sentence it cannot catch.

## 2. Find the documents it touches

| If you changed… | Update |
| --- | --- |
| Anything a user sees or does (screens, buttons, rights, flows, wording of concepts) | **The in-app Guide**: `src/components/GuidePage.tsx`. This is the main documentation; people read it in the app. |
| A flow that the Guide shows as a chart, or a new flow worth showing | `src/guide/flows.ts` (the charts are ordinary processes drawn by the app's own map) |
| How to run, test or lay out the project; the short feature overview | `README.md` |
| The server: API, settings, rights, database, notifications, deployment | `docs/backend.md`, `.env.example`, and the “Running it” sections of the Guide (and `docs/mcp.md` when the MCP server shares the setting) |
| A setting, the port, `/healthz`, the image or the app's build output that the Cloud Run files name | `deploy/cloudrun/` (`service.yaml`, `fill-service.sh`, `upload-app.sh`, `README.md`); the paragraph on it under “Deploying” in `docs/backend.md` |
| A format (`schema/*.json`) | Run `npm run validators` first (the app's checks are generated from the schemas). Then: field `description`s in the schema, the server's consistency check (`server/internal/docs/check.go`), the modelling rules in `src/lib/prompt.ts`, the generators in `server/internal/skills`, the Guide, `docs/mcp.md`, and the skills `edit-process` / `edit-standard` / `manage-catalog` |
| A prompt, a schema, or the sample content | Regenerate `docs/llm-prompt.md` and `docs/llm-prompt-standards.md` with `npm run prompt`. Never edit those files by hand. |
| The lists, the search results, Home, the filters, the order or the card (`DocList`, `DocCard`, `Lists.tsx`, `HomePage`, `search.ts`, `sorting.ts`) | The Guide section “Finding a process or standard”; the overview in `README.md` |
| Views, bookmarks, upvotes, skill downloads, sharing, requests or statistics | The Guide sections “Bookmarks, upvotes and sharing”, “Asking for what is missing” and “The Admin panel” (Statistics); `docs/backend.md`; the sentence on what a view is in `src/components/StatisticsPage.tsx`; `docs/mcp.md` where it speaks of measuring use by agents |
| The editing screen, drafts, unpublished changes, publishing, retiring or deleting (`EditFrame`, `EditSession`, `Edit*Page`, `src/lib/editing.ts`, the working drafts in the server) | The Guide sections “The editing screen”, “Drafts and publishing”, “Editing a process”, “Editing a standard”, “Versions, undo and working together” and “Life-cycle and reviews”, and their charts (`changeFlow`, `versionFlow`); “Working drafts” in `docs/backend.md`; the conventions in `CLAUDE.md` |
| Icons of the lists (`server/internal/icons`, `IconField`, `EntryIcon`, `StepTool.tsx`, `catalog/icons/`) | The Guide sections “The lists” (Icons, where they show) and “Reading a process” (the step panel); “Icons” in `docs/backend.md`; the skill `manage-catalog` |
| Admin › Access, people and their roles, the activity log (`UsersSection`, `src/lib/users.ts`, `/api/admin/users`, `src/lib/activity.ts`) | The Guide section “The Admin panel” (Access and the protections, Activity); “People and their roles” in `docs/backend.md`; `README.md` (Roles) |
| Roles or what they allow | The roles table in the Guide (“Signing in and your rights”), its sections “Teams, platforms and practices” and “Asking for what is missing” (who moves a request along), `README.md`, `docs/backend.md`, and the texts in `src/lib/users.ts` (what each role can do, in Admin › Access) and `src/lib/members.ts` |
| The page of a team, platform or practice, Teams & tools, contact details or members (`GroupPage`, `src/lib/groups.ts`, `ContactFields`, `TeamMembers`, `/api/groups/…`) | The Guide sections “The page of a team, platform or practice”, “Teams, platforms and practices” and “The lists”; “Teams, platforms and practices” and the API in `docs/backend.md`; `docs/mcp.md` where agents get contacts or members; the skill `manage-catalog` |
| What a generated skill or review agent says | The “Skills and review agents” section of the Guide |
| The MCP server: its tools, what they return, its settings or guard (`server/cmd/mcp`, `server/internal/mcpserver`) | `docs/mcp.md`; the Guide section “For agents: the MCP server”; the overview in `README.md`. Sign-in through a gateway and counting use by agents are planned: keep them marked as not built |
| Search by meaning: the parts a document is cut into, the providers, the index, its settings, `/api/search`, or the switch on the search page (`server/internal/chunking`, `embedding`, `retrieval`, `src/lib/meaning.ts`) | The Guide sections “Finding a process or standard” (for readers) and “How it is built”, “Running it locally”, “Deploying” (for operators); `docs/backend.md` (Search by meaning, Settings, API); `.env.example`; `docs/mcp.md` where its search tools depend on it. Whatever changes what leaves the company must be said in all of them |
| npm scripts, commands, folder names | Every place that names them: `README.md`, the Guide, `docs/backend.md`, `CLAUDE.md`, the skills in `.claude/skills/` |
| The look of the portal: Admin › Theming, the tokens, the name or logo in the top bar (`src/lib/theme.ts`, `ThemeSection`, `Brand.tsx`, `src/theme.css`, `server/internal/theme`, `/api/theme`) | The Guide section “The look of the portal” and its chart (`themeFlow`), “The Admin panel”; “Look of the portal” and the API in `docs/backend.md`; the theming convention in `CLAUDE.md` |
| The shared parts (`src/components/marks.tsx`, `src/controls.css`) or the words for levels, kinds and review marks | The Guide sections “Finding a process or standard” (Levels in words, the card), “Reading a process” and “Reading a standard”; the vocabulary in `CLAUDE.md` |
| When a review is due, the first review (`reviewInfo`, `reviewOf`, `needsReview` in `src/lib/lifecycle.ts`, `meta[id].publishedAt`, the MCP server's `reviewOf`) | The Guide sections “Life-cycle and reviews” and “Your responsibilities”; “Reviews” and the API in `docs/backend.md`; the review state in `docs/mcp.md`; `CLAUDE.md` |
| Any source file: added, moved, removed, or a rule it enforces | The code map, `src/codemap/categories/*.ts` (see step 1); a change to how the code map works, or to `GET /api/admin/source` / `PM_SOURCE_DIR`: the Guide section “The code map”, “Source files for the code map” and Settings in `docs/backend.md`, the code map convention in `CLAUDE.md` |
| A screen shown in a screenshot (`docs/*.png`) so that the picture is now misleading | Retake it, or say in your summary that it is out of date |

Search for the old name or behaviour before you finish, so no second copy is left behind:

```bash
grep -rn "old-name" README.md docs src/components/GuidePage.tsx .claude CLAUDE.md
```

## 3. Rules for what you write

- **Describe what exists.** Anything not built is labelled as planned, in the sentence itself. Never document an intention as a feature.
- **The Guide is for people who use the app**, including business analysts: plain words, what they can do and where, no code terms unless the section is under “Running it”. Lead with what the reader can do.
- **One home per fact.** Details live in the Guide (using it) or `docs/backend.md` (operating it). `README.md` stays short and points to them.
- **A new Guide section** needs an entry in `GROUPS` at the top of `GuidePage.tsx`, or it will not appear in the menu. Add its id to the list in the guide test in `e2e/consumer.spec.ts`.
- **A new flow chart** is exported from `src/guide/flows.ts` and kept to seven columns or fewer so it fits without scrolling. It is validated automatically by the unit tests.
- **Remove what is no longer true.** Deleting a stale sentence is an update.
- Do not add change logs, dates or “recently added” notes to the documents; git has the history.

## 4. Check

```bash
npm run typecheck && npm test
```

```bash
npm run prompt
```

If you changed the Guide, also run its browser test (needs the database, see `README.md`):

```bash
npm run test:e2e -- -g "guide"
```

## 5. Say what you did

In your final summary, state which documents you updated. If the change needed no documentation, say so and why (for example: “internal refactor, no behaviour or command changed”). Do not skip this line.
