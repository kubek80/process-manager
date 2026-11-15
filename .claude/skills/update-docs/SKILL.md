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
| The process or catalog format (`schema/*.json`) | Field `description`s in the schema, the modelling rules in `src/lib/prompt.ts`, the “What a process is” table in `README.md`, the Guide, `docs/mcp.md`, and the skills `edit-process` / `manage-catalog` |
| The prompt, the schema, the catalog or the list of processes | Regenerate `docs/llm-prompt.md` with `npm run prompt`. Never edit that file by hand. |
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
