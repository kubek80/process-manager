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

## 2. Find the documents it touches

| If you changed… | Update |
| --- | --- |
| Anything a user sees or does (screens, buttons, rights, flows, wording of concepts) | **The in-app Guide**: `src/components/GuidePage.tsx`. This is the main documentation; people read it in the app. |
| A flow that the Guide shows as a chart, or a new flow worth showing | `src/guide/flows.ts` (the charts are ordinary processes drawn by the app's own map) |
| How to run, test or lay out the project; the short feature overview | `README.md` |
| The server: API, settings, rights, database, notifications, deployment | `docs/backend.md`, `.env.example`, and the “Running it” sections of the Guide |
| A format (`schema/*.json`) | Run `npm run validators` first (the app's checks are generated from the schemas). Then: field `description`s in the schema, the server's consistency check (`server/internal/docs/check.go`), the modelling rules in `src/lib/prompt.ts`, the generators in `server/internal/skills`, the Guide, `docs/mcp.md`, and the skills `edit-process` / `edit-standard` / `manage-catalog` |
| A prompt, a schema, or the sample content | Regenerate `docs/llm-prompt.md` and `docs/llm-prompt-standards.md` with `npm run prompt`. Never edit those files by hand. |
| The lists, the search results, the filters or the card (`DocList`, `DocCard`, `Lists.tsx`, `search.ts`) | The Guide section “Finding a process or standard”; the overview in `README.md` |
| Views, bookmarks, upvotes, skill downloads, sharing, requests or statistics | The Guide sections “Bookmarks, upvotes and sharing”, “Asking for what is missing” and “The Admin panel” (Statistics); `docs/backend.md`; the sentence on what a view is in `src/components/StatisticsPage.tsx`; `docs/mcp.md` where it speaks of measuring use by agents |
| Roles or what they allow | The roles table in the Guide (“Signing in and your rights”), its sections “Teams, platforms and practices” and “Asking for what is missing” (who moves a request along), `README.md`, `docs/backend.md`, and the texts in `src/components/AdminPage.tsx` and `src/lib/members.ts` |
| What a generated skill or review agent says | The “Skills and review agents” section of the Guide |
| What agents will get over MCP, or anything it promises | `docs/mcp.md` (it describes a plan: keep it marked as not built) |
| npm scripts, commands, folder names | Every place that names them: `README.md`, the Guide, `docs/backend.md`, `CLAUDE.md`, the skills in `.claude/skills/` |
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
