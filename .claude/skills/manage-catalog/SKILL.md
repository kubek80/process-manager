---
name: manage-catalog
description: Add, rename or remove the teams, practices, platforms, categories, tools, application tiers, environments and programming languages in the sample lists (catalog/catalog.json), and their descriptions and contact details (group email, Slack, Google Chat, Confluence, page, request form). Use when asked to add a tool, team, practice, platform, category, tier, environment or language, change a contact, or clean up unused entries in this repository.
---

# Manage the sample lists (teams, practices, platforms, categories, tools, tiers, environments, languages)

All eight lists live in one file: `catalog/catalog.json`, validated by `schema/catalog.schema.json`.

This file is **sample content**: it fills an empty database on its first start. `demo/catalog/catalog.json` is the list of the larger demo set (`npm run db:demo`): it replaces the stored lists when loaded, so it must hold every entry of `catalog/catalog.json` unchanged plus the entries the demo documents use. Change both files together. A running installation is changed in the portal (Admin › Lists), or by loading the files with `npm run db:import`.

```json
{
  "tiers": [{ "id": "tier-0", "name": "Tier 0", "description": "…" }],
  "environments": [{ "id": "production", "name": "Production" }],
  "languages": [{ "id": "go", "name": "Go", "icon": "<64 hex>" }],
  "teams": [{ "id": "cloud-platform-team", "name": "Cloud Platform team", "contacts": { "email": "cloud-platform@example.com", "slack": "#cloud-platform", "slackUrl": "https://example.slack.com/archives/C0CLOUDPLAT" }, "description": "…" }],
  "practices": [{ "id": "security", "name": "Cyber security", "contacts": { "email": "security@example.com", "slack": "#security", "form": "https://forms.example.com/security/ask" }, "description": "…" }],
  "platforms": [{ "id": "azure", "name": "Azure", "contact": "Slack #azure-platform" }],
  "categories": [{ "id": "cloud", "name": "Cloud" }],
  "tools": [{ "id": "servicenow", "name": "ServiceNow", "url": "https://…", "description": "…", "icon": "<64 hex>" }]
}
```

- A **team** is a group of people. Any team can own a process or issue a standard; teams have no kind.
- A **practice** (cyber security, engineering…) and a **platform** (Google Cloud, Apigee, GitHub…) are lists of their own. The owners of a platform or practice may change and publish the processes and standards that belong to it; its members write drafts of them for an owner to publish. Neither can change a platform or practice of such a document that is not theirs; only editors can.
- **How to reach a team, practice or platform**: `contacts` (`$defs/contacts` in the schema), each way on its own, all optional: `email` (group email), `slack` (channel name, e.g. `#cloud-platform`), `slackUrl`, `chat` (Google Chat space name), `chatUrl`, `confluence`, `page` (their own page or site), `form` (where people ask them for something). Links start with `http://` or `https://` (no other scheme, no spaces, at most 300 characters); `slack` and `chat` 1-80 characters, `email` up to 120. Leave out an empty field, and leave `contacts` out altogether when nothing is known: an empty object is refused. The older free line `contact` (up to 120) is still valid and shown as "Other ways to reach them"; do not repeat a detail of `contacts` in it. The `description` may have up to 600 characters. These details appear on the group's page, in the generated skills, in feedback notifications and for agents.
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

## Icons of tools and languages

A tool or a language may name a square icon: `"icon"` is the SHA-256 of the image file (64 characters `0-9a-f`), and the file lies in `catalog/icons/<id>.<png|jpg|webp|svg>`. The demo set has its own folder, `demo/catalog/icons/`, with a copy of every sample icon plus its own, since loading it replaces the lists. In a running installation icons are uploaded in Admin › Lists ("Choose image…"); the server stores and serves them by the same id.

To add one by hand:

1. Use a square PNG, JPEG, WebP or SVG of at most 64 KB; a bitmap at most 512 × 512 and not animated. An SVG must be a plain drawing (`server/internal/icons/svg.go` is the allow-list):
   - only the elements `svg`, `g`, `defs`, `title`, `desc`, `style`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `mask`;
   - no `<use>`, `<symbol>`, `<pattern>`, `<marker>`, `<textPath>`, filters, images, links, scripts, event handlers, `foreignObject`, animation, DOCTYPE or editor metadata (Inkscape / Illustrator namespaces: export as "plain SVG" and strip them);
   - no `href` or `xlink:href` on any element; `url(#id)` only to an id in the same file; no `data:` or `javascript:` values, no `@import` in styles;
   - square by its `viewBox` (or `width`/`height`), numbers above 0 and at most 100000; at most 2000 elements and 32 levels deep.
2. Compute its id and name the file by it: `sha256sum logo.svg` → `cp logo.svg catalog/icons/<id>.svg` (`.jpg` for JPEG).
3. Set `"icon": "<id>"` on the entry in `catalog/catalog.json`, and the same in `demo/catalog/catalog.json` with a copy of the file in `demo/catalog/icons/`.
4. Changing the image changes its id: rename the file and update `"icon"`; remove a file nothing names any more.

`npm run validate` checks only the form of the id. The server checks the files when it imports them: a file whose name does not match its content, that fails the checks, or that is a link rather than an ordinary file, is skipped with a warning, and the entry is shown without an icon. The Go test `server/cmd/server/icons_test.go` imports the sample icons, so run `npm run test:server` after adding one.

## Rules

- `id` is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`), unique within its list, derived from the name (`"GCP console"` → `gcp-console`).
- **Never change an existing `id`** without updating every reference in `processes/*.json` and `standards/*.json` in the same change. Changing `name` is always safe.
- Only `id` and `name` are required. Do not invent contact details or URLs for real content; leave optional fields out when unknown. Sample and demo entries may carry made-up details only on `example.com` addresses (as the sample does). Categories, tools, tiers, environments and languages have no `contacts`; categories no `contact` either.
- Keep `teams`, `practices`, `tools` and `languages` sorted by name. Keep `tiers` ordered most critical first and `environments` in the order work moves through them.
- Do not add fields that are not in the schema. Only tools and languages have `icon`.

## Add an entry

1. Read `catalog/catalog.json` and check the entry does not already exist under another spelling.
2. Append it to the right list and keep the ordering rule above.
3. Run the checker (below).

## Remove or rename an id

1. Find the references: search `processes/` and `standards/` for `"<id>"` in `owner`, `teamId`, `category`, `practice`, `platform`, `tool`, `tiers`, `environments` or `languages`.
2. Removing: only when nothing references it, or after re-pointing the references to another entry the user agreed on.
3. Renaming an id: update the catalog entry and every reference together. In a running database, the roles Owner, Platform owner, Practice owner, Platform member and Practice member (the owners and members) use team, platform and practice ids as their scope, and the server refuses to remove an entry that a role still uses; say so in your summary.
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
