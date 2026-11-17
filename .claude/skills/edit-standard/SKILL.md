---
name: edit-standard
description: Create or change a sample standard in standards/*.json (requirements, levels, review hints, owner, category, platform, practice, where it applies) or turn a policy text into a standard. Use when asked to add, update or review a standard in this repository.
---

# Create or edit a sample standard

Each standard is one file: `standards/<id>.json`, validated by `schema/standard.schema.json`. The file name must equal the `id`.

These files are **sample content**: they fill an empty database on its first start. A running installation is changed in the portal (Standards, Editor mode), or by loading the files with `npm run db:import`.

## Before writing

1. Read `schema/standard.schema.json` (the format) and `schema/example.standard.json` (a correct small example).
2. Read `catalog/catalog.json`. `owner` is the team that issues the standard (any team in `teams`). `category`, `practice` and `platform` are ids from `categories`, `practices` and `platforms`; the owners of that platform or practice may change the standard, so set them only when the source says what it belongs to. Someone who edits only as a platform or practice owner can set or change a document's platform only from one of their platforms to another (or to or from none); a platform that is not theirs stays as it is. The same goes, separately, for the practice. `tiers`, `languages` and `environments` may only use ids from it. If a needed entry is missing, add it with the `manage-catalog` skill first.
3. List `processes/` so you can link `exceptionProcessId` and a requirement's `processId`.

The full modelling rules are in `src/lib/prompt.ts` (`standardBasePrompt`) and, rendered, in `docs/llm-prompt-standards.md`. The essentials:

- One requirement = one rule that can be checked on its own.
- `id` is upper case with dashes (`SEC-LOG-01`), unique, and **never reused or renumbered**: people, skills and review findings cite it.
- `level`: `must` (mandatory), `should` (expected), `may` (optional). Do not invent a stricter level than the source gives. A standard has no `rigour` field: in search it counts as mandatory, recommended or optional for each level its requirements have.
- `statement` is the rule, testable, one or two sentences. Reasons go in `rationale`, actions in `guidance`.
- `verification.method`: `automated`, `review` or `manual`.
- `review.lookFor` lists concrete signs of a violation that can be seen in a pull request. It feeds the generated review agent; a requirement without it is not checked by the agent. Leave `review` out for rules that cannot be seen in a change.
- `tiers`, `languages`, `environments` on a requirement only narrow it compared with the standard.
- A new standard gets `"status": "draft"` and `"review": { "intervalMonths": 12 }`.

## Check your work

```bash
npm run validate
```

The task is done only when this reports 0 errors and 0 warnings for the file. Then, because skills and review agents are generated from standards, run the generator tests, which read the sample files:

```bash
npm run test:server
```
