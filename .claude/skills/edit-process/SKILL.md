---
name: edit-process
description: Create or change a sample process in processes/*.json (steps, lanes, prerequisites, owner, category, platform, practice, rigour, where it applies, sub-processes) or turn free text into a process. Use when asked to add, update, restructure or review a process in this repository.
---

# Create or edit a sample process

Each process is one file: `processes/<id>.json`, validated by `schema/process.schema.json`. The file name must equal the `id`.

These files are **sample content**: they fill an empty database on its first start. A running installation is changed in the portal (Editor mode), or by loading the files with `npm run db:import`.

## Before writing

1. Read `schema/process.schema.json` (the format) and `schema/example.process.json` (a correct small example).
2. Read `catalog/catalog.json`: `owner` and actor `teamId` (from `teams`), `category` (from `categories`), `practice` (from `practices`), `platform` (from `platforms`), step `tool`, `tiers`, `environments` and `languages` may only use ids from it. If a needed entry is missing, add it with the `manage-catalog` skill first.
3. List `processes/` so you can reuse existing processes as sub-processes or prerequisites, and `standards/` for the `standards` a process helps to meet.

The full modelling rules (how to split steps, choose block types, model decisions and loops) are in `src/lib/prompt.ts` and, rendered, in `docs/llm-prompt.md`. Follow them. The essentials:

- `actors[0]` is always `{ "id": "me", "name": "You" }` - the person following the process.
- One step = one action by one actor. Steps done by `me` need concrete `instructions` (one action per item).
- `type` is one of: form, code, approval, review, wait, communication, meeting, automation, document, verify, decision, subprocess, task.
- A `decision` has two or more labelled `next` entries. Model reject → fix → resubmit as a loop back to the approval.
- A step with `"next": []` ends the process; at least one must.
- `owner` is the team that maintains the process (reviews, feedback). `category` is an id, not free text. `platform` and `practice` say what it belongs to: the owners of that platform or practice may change it, so set them only when the source says so. Someone who edits only as a platform or practice owner can set or change a document's platform only from one of their platforms to another (or to or from none); a platform that is not theirs stays as it is. The same goes, separately, for the practice. `rigour` is `mandatory` (the only allowed way), `recommended` (the expected way) or `optional`; leave it out when the source does not say.
- `tiers` absent means the process applies to all application tiers. `environments` absent means all environments. `languages` absent means it does not depend on the programming language.
- Life-cycle: a new process gets `"status": "draft"` and `"review": { "intervalMonths": 6 }`. Do not change `status` or `review.lastReviewedAt` unless asked; confirming a review is the owner's decision.
- `resources` (on the process or on a step) hold links that help to do the work. Use `"kind": "skill"` for instructions an AI assistant can run in self-service, e.g. a skill that updates the IaC repository.
- Do not invent links, durations or names that the source does not give. Leave optional fields out.
- When changing an existing process, keep its `id` and the ids of unaffected steps, and set `updatedAt` to today.

## Check your work

```bash
npm run validate
```

The task is done only when this reports 0 errors. Fix warnings too unless they are intended (for example a sub-process that will be written later).

To see which processes are due for review, run `npm run reviews`.

Feedback from users is stored in the database, not in this repository; the owner marks it as fixed in the app.

A skill is generated from every active process (`server/internal/skills`). If you change a sample process, run `npm run test:server`: the generator tests read the sample files.

If you changed code as well as content, run the tests: `npm run test:all` (see the README).
