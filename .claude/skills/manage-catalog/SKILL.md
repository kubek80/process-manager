---
name: manage-catalog
description: Add, rename or remove the teams, tools and application tiers that processes pick from (catalog/catalog.json). Use when asked to add a tool or team, change a team's contact, add a tier, or clean up unused entries.
---

# Manage the catalog (teams, tools, tiers)

All three lists live in one file: `catalog/catalog.json`, validated by `schema/catalog.schema.json`.

```json
{
  "tiers": [{ "id": "tier-0", "name": "Tier 0", "description": "…" }],
  "teams": [{ "id": "cloud-platform-team", "name": "Cloud Platform team", "contact": "Slack #cloud-platform", "description": "…" }],
  "tools": [{ "id": "servicenow", "name": "ServiceNow", "url": "https://…", "description": "…" }]
}
```

Processes in `processes/*.json` reference these entries **by id**:

| Catalog list | Referenced from |
| --- | --- |
| `teams` | process `owner`, actor `teamId` |
| `tools` | step `tool` |
| `tiers` | process `tiers` (absent = applies to all tiers) |

## Rules

- `id` is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), unique within its list, derived from the name (`"GCP console"` → `gcp-console`).
- **Never change an existing `id`** without updating every reference in `processes/*.json` in the same change. Changing `name` is always safe.
- Only `id` and `name` are required. Do not invent contacts or URLs; leave optional fields out when unknown.
- Keep `teams` and `tools` sorted by name. Keep `tiers` ordered most critical first.
- Do not add fields that are not in the schema.

## Add an entry

1. Read `catalog/catalog.json` and check the entry does not already exist under another spelling.
2. Append it to the right list and keep the ordering rule above.
3. Run the checker (below).

## Remove or rename an id

1. Find the references: search `processes/` for `"<id>"` in `owner`, `teamId`, `tool` or `tiers`.
2. Removing: only when nothing references it, or after re-pointing the references to another entry the user agreed on.
3. Renaming an id: update the catalog entry and every reference together.
4. Run the checker.

## Always finish with the checker

```bash
npm run validate
```

It validates the catalog and every process, and warns about processes that point to a team or tool that is not in the catalog (unknown tiers are errors). The task is done only when it reports 0 errors and no new warnings.

After changing the catalog, also refresh the shareable LLM prompt, which lists the teams, tools and tiers:

```bash
npm run prompt
```
