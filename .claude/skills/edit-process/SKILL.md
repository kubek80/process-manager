---
name: edit-process
description: Create or change a process description in processes/*.json (steps, lanes, prerequisites, owner, tiers, sub-processes) or turn free text into a process. Use when asked to add, update, restructure or review a process in this repository.
---

# Create or edit a process

Each process is one file: `processes/<id>.json`, validated by `schema/process.schema.json`. The file name must equal the `id`.

## Before writing

1. Read `schema/process.schema.json` (the format) and `schema/example.process.json` (a correct small example).
2. Read `catalog/catalog.json`: `owner`, actor `teamId`, step `tool` and `tiers` may only use ids from it. If a needed team or tool is missing, add it with the `manage-catalog` skill first.
3. List `processes/` so you can reuse existing processes as sub-processes or prerequisites.

The full modelling rules (how to split steps, choose block types, model decisions and loops) are in `src/lib/prompt.ts` and, rendered, in `docs/llm-prompt.md`. Follow them. The essentials:

- `actors[0]` is always `{ "id": "me", "name": "You" }` - the person following the process.
- One step = one action by one actor. Steps done by `me` need concrete `instructions` (one action per item).
- `type` is one of: form, code, approval, review, wait, communication, meeting, automation, document, verify, decision, subprocess, task.
- A `decision` has two or more labelled `next` entries. Model reject → fix → resubmit as a loop back to the approval.
- A step with `"next": []` ends the process; at least one must.
- `tiers` absent means the process applies to all application tiers.
- Do not invent links, durations or names that the source does not give. Leave optional fields out.
- When changing an existing process, keep its `id` and the ids of unaffected steps, and set `updatedAt` to today.

## Check your work

```bash
npm run validate
```

The task is done only when this reports 0 errors. Fix warnings too unless they are intended (for example a sub-process that will be written later).

Open feedback from users is in `feedback/<process-id>.json` (`stepId`, `kind`, `text`, `resolved`). When a change fixes a reported problem, set `"resolved": true` on that entry.
