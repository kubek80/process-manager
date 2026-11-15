---
name: manage-catalog
description: Add, rename or remove the teams and units, tools, application tiers, environments and programming languages in the sample lists (catalog/catalog.json). Use when asked to add a tool, team, unit, tier, environment or language, change a team's contact, or clean up unused entries in this repository.
---

# Manage the sample lists (teams, tools, tiers, environments, languages)

All five lists live in one file: `catalog/catalog.json`, validated by `schema/catalog.schema.json`.

This file is **sample content**: it fills an empty database on its first start. A running installation is changed in the portal (Admin › Lists), or by loading the files with `npm run db:import`.

```json
{
  "tiers": [{ "id": "tier-0", "name": "Tier 0", "description": "…" }],
  "environments": [{ "id": "production", "name": "Production" }],
  "languages": [{ "id": "go", "name": "Go" }],
  "teams": [{ "id": "cloud-platform-team", "name": "Cloud Platform team", "kind": "platform", "contact": "Slack #cloud-platform", "description": "…" }],
  "tools": [{ "id": "servicenow", "name": "ServiceNow", "url": "https://…", "description": "…" }]
}
```

A team's `kind` is `team` (default), `security`, `platform` or `practice`. Only the last three are **units** and can own a standard.

Processes in `processes/*.json` and standards in `standards/*.json` reference these entries **by id**:

| Catalog list | Referenced from |
| --- | --- |
| `teams` | process `owner`, actor `teamId`, standard `owner` (units only) |
| `tools` | step `tool` |
| `tiers` | `tiers` of a process, a standard or a requirement (absent = all tiers) |
| `environments` | `environments` of a process, a standard or a requirement (absent = all environments) |
| `languages` | `languages` of a process, a standard or a requirement (absent = any language) |

## Rules

- `id` is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), unique within its list, derived from the name (`"GCP console"` → `gcp-console`).
- **Never change an existing `id`** without updating every reference in `processes/*.json` in the same change. Changing `name` is always safe.
- Only `id` and `name` are required. Do not invent contacts or URLs; leave optional fields out when unknown.
- Keep `teams`, `tools` and `languages` sorted by name. Keep `tiers` ordered most critical first and `environments` in the order work moves through them.
- Do not add fields that are not in the schema.

## Add an entry

1. Read `catalog/catalog.json` and check the entry does not already exist under another spelling.
2. Append it to the right list and keep the ordering rule above.
3. Run the checker (below).

## Remove or rename an id

1. Find the references: search `processes/` and `standards/` for `"<id>"` in `owner`, `teamId`, `tool`, `tiers`, `environments` or `languages`.
2. Removing: only when nothing references it, or after re-pointing the references to another entry the user agreed on.
3. Renaming an id: update the catalog entry and every reference together. Role assignments in a running database also use team ids as their scope; say so in your summary.
4. Run the checker.

## Always finish with the checker

```bash
npm run validate
```

It validates the catalog and every process, and warns about processes that point to a team or tool that is not in the catalog (unknown tiers, environments and languages are errors). The task is done only when it reports 0 errors and no new warnings.

After changing the lists, also refresh the shareable prompts, which name them:

```bash
npm run prompt
```
