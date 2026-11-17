---
name: manage-catalog
description: Add, rename or remove the teams, practices, platforms, categories, tools, application tiers, environments and programming languages in the sample lists (catalog/catalog.json). Use when asked to add a tool, team, practice, platform, category, tier, environment or language, change a contact, or clean up unused entries in this repository.
---

# Manage the sample lists (teams, practices, platforms, categories, tools, tiers, environments, languages)

All eight lists live in one file: `catalog/catalog.json`, validated by `schema/catalog.schema.json`.

This file is **sample content**: it fills an empty database on its first start. A running installation is changed in the portal (Admin › Lists), or by loading the files with `npm run db:import`.

```json
{
  "tiers": [{ "id": "tier-0", "name": "Tier 0", "description": "…" }],
  "environments": [{ "id": "production", "name": "Production" }],
  "languages": [{ "id": "go", "name": "Go" }],
  "teams": [{ "id": "cloud-platform-team", "name": "Cloud Platform team", "contact": "Slack #cloud-platform", "description": "…" }],
  "practices": [{ "id": "security", "name": "Cyber security", "contact": "Slack #security", "description": "…" }],
  "platforms": [{ "id": "google-cloud", "name": "Google Cloud", "contact": "Slack #cloud-platform" }],
  "categories": [{ "id": "cloud", "name": "Cloud" }],
  "tools": [{ "id": "servicenow", "name": "ServiceNow", "url": "https://…", "description": "…" }]
}
```

- A **team** is a group of people. Any team can own a process or issue a standard; teams have no kind.
- A **practice** (cyber security, engineering…) and a **platform** (Google Cloud, Apigee, GitHub…) are lists of their own. The owners of a platform or practice may change the processes and standards that belong to it. They cannot change a platform or practice of such a document that is not theirs; only editors can.
- A **category** groups processes and standards for readers; it gives no rights.
- Ids are unique within one list only: a team, a practice and a platform may share an id (the sample has team `security` and practice `security`).

Processes in `processes/*.json` and standards in `standards/*.json` reference these entries **by id**:

| Catalog list | Referenced from |
| --- | --- |
| `teams` | process and standard `owner`, actor `teamId` |
| `practices` | `practice` of a process or a standard |
| `platforms` | `platform` of a process or a standard |
| `categories` | `category` of a process or a standard |
| `tools` | step `tool` |
| `tiers` | `tiers` of a process, a standard or a requirement (absent = all tiers) |
| `environments` | `environments` of a process, a standard or a requirement (absent = all environments) |
| `languages` | `languages` of a process, a standard or a requirement (absent = any language) |

## Rules

- `id` is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), unique within its list, derived from the name (`"GCP console"` → `gcp-console`).
- **Never change an existing `id`** without updating every reference in `processes/*.json` and `standards/*.json` in the same change. Changing `name` is always safe.
- Only `id` and `name` are required. Do not invent contacts or URLs; leave optional fields out when unknown. Categories have no `contact`.
- Keep `teams`, `practices`, `tools` and `languages` sorted by name. Keep `tiers` ordered most critical first and `environments` in the order work moves through them.
- Do not add fields that are not in the schema.

## Add an entry

1. Read `catalog/catalog.json` and check the entry does not already exist under another spelling.
2. Append it to the right list and keep the ordering rule above.
3. Run the checker (below).

## Remove or rename an id

1. Find the references: search `processes/` and `standards/` for `"<id>"` in `owner`, `teamId`, `category`, `practice`, `platform`, `tool`, `tiers`, `environments` or `languages`.
2. Removing: only when nothing references it, or after re-pointing the references to another entry the user agreed on.
3. Renaming an id: update the catalog entry and every reference together. In a running database, the roles Owner, Platform owner and Practice owner (the members) use team, platform and practice ids as their scope, and the server refuses to remove an entry that a role still uses; say so in your summary.
4. Run the checker.

## Always finish with the checker

```bash
npm run validate
```

It validates the catalog and every process and standard. An unknown category, practice, platform, tier, environment or language is an error; a team or tool that is not in the catalog is a warning. The task is done only when it reports 0 errors and no new warnings.

After changing the lists, also refresh the shareable prompts, which name them:

```bash
npm run prompt
```
