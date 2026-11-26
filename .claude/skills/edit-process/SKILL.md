---
name: edit-process
description: Create or change a sample process in processes/*.json (steps, lanes, prerequisites, owner, category, platform, practice, rigour, where it applies, sub-processes) or turn free text into a process. Use when asked to add, update, restructure or review a process in this repository.
---

# Create or edit a sample process

Each process is one file: `processes/<id>.json`, validated by `schema/process.schema.json`. The file name must equal the `id`.

These files are **sample content**: they fill an empty database on its first start. The tests count them, so a process added only to have more to try goes into `demo/processes/` instead (the larger demo set, loaded with `npm run db:demo`; check it with `npm run validate demo`, and `src/lib/__tests__/demo.test.ts` checks its spread). A running installation is changed in the portal (Edit on the page opens the editing screen; changes reach readers when they are published), or by loading the files with `npm run db:import`.

## Before writing

1. Read `schema/process.schema.json` (the format) and `schema/example.process.json` (a correct small example).
2. Read `catalog/catalog.json`: `owner` and actor `teamId` (from `teams`), `category` (from `categories`), `practice` (from `practices`), `platform` (from `platforms`), step `tool`, `tiers`, `paths`, `patterns`, `environments` and `languages` may only use ids from it. If a needed entry is missing, add it with the `manage-catalog` skill first.
3. List `processes/` so you can reuse existing processes as sub-processes or prerequisites, and `standards/` for the `standards` a process helps to meet.

The full modelling rules (how to split steps, choose block types, model decisions and loops) are in `src/lib/prompt.ts` and, rendered, in `docs/llm-prompt.md`. Follow them. The essentials:

- `actors[0]` is always `{ "id": "me", "name": "You" }` - the person following the process.
- One step = one action by one actor. Steps done by `me` need concrete `instructions` (one action per item).
- `type` is one of: form, code, approval, review, wait, communication, meeting, automation, document, verify, decision, subprocess, task.
- A `decision` has two or more labelled `next` entries. Model reject → fix → resubmit as a loop back to the approval.
- A step with `"next": []` ends the process; at least one must.
- `owner` is the team that maintains the process (reviews, feedback). `category` is an id, not free text. `platform` and `practice` say what it belongs to: the owners of that platform or practice may change and publish it and its members write drafts of it, so set them only when the source says so. Someone who works only as a platform or practice owner or member can set or change a document's platform only from one of their platforms to another (or to or from none); a platform that is not theirs stays as it is. The same goes, separately, for the practice. `rigour` is `mandatory` (the only allowed way), `recommended` (the expected way) or `optional`; leave it out when the source does not say.
- `tiers` absent means the process applies to all application tiers. `environments` absent means all environments. `languages` absent means it does not depend on the programming language.
- `paths` (`greenfield`, `brownfield`, `paved-path`, …): Name `paths` ONLY when the document is meant only for that kind of work: a process that sets up something new (greenfield), changes or moves something that exists (brownfield), or is itself the ready-made, supported way (paved path, also called the golden path). A rule or process that everyone follows names none: absent means it applies whatever the path, which is the usual case. Readers whose application is on another path no longer see a document that names paths, and its skill says "Meant for the paths: …", so a wrong path hides a rule from people it applies to. In the sample only processes that set something up or are the self-service way name one (e.g. `request-gcp-project`: `["paved-path"]`).
- `patterns` (`api-first`, `event-driven`, `microservices`, …, from the `patterns` list, the architecture patterns): a **tag**, not a limit. Name a pattern only when the process is truly about systems built that way (onboarding an API to the gateway is about `api-first`; putting a site behind the CDN about `static-site-cdn`); a process everyone follows whatever they build names none, which is the usual case. A pattern hides nothing from anybody: readers filter by it, the skill says "Architecture patterns: …" and agents get the patterns with the document. Document level only; no duplicates.
- Life-cycle: a new process gets `"status": "draft"` and `"review": { "intervalMonths": 6 }`. Do not change `status` or `review.lastReviewedAt` unless asked; confirming a review is the owner's decision.
- `resources` (on the process or on a step) hold links that help to do the work. Use `"kind": "skill"` for instructions an AI assistant can run in self-service, e.g. a skill that updates the IaC repository.
- Do not invent links, durations or names that the source does not give. Leave optional fields out.
- When changing an existing process, keep its `id` and the ids of unaffected steps, and set `updatedAt` to today (your own calendar day, as the app stamps it).

## Check your work

```bash
npm run validate
```

The task is done only when this reports 0 errors. Fix warnings too unless they are intended (for example a sub-process that will be written later).

To see which processes are due for review, run `npm run reviews`.

Feedback from users is stored in the database, not in this repository; the owner marks it as fixed in the app.

A skill is generated from every active process (`server/internal/skills`). If you change a sample process, run `npm run test:server`: the generator tests read the sample files.

If you changed code as well as content, run the tests: `npm run test:all` (see the README).
