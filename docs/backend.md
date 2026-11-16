# Backend

Everything people change in the portal is stored in a database: processes, standards, the lists, roles, feedback and the generated skills. The server signs people in, enforces their rights, keeps every version, and regenerates skills when their source changes.

```mermaid
flowchart LR
  people(["People"]) --> app["Built app (static)"] --> server["Go server"]
  subgraph image["One container"]
    app
    server
  end
  server --> db[("Postgres<br/>content + versions, roles,<br/>feedback, skills, activity")]
  server <-. "sign-in" .-> idp["Entra ID or Google"]
  server -. "notifications" .-> chat["Team channel"]
  seed["Files in git<br/>processes/ standards/ catalog/"] -. "first fill, import, export" .-> server
```

## What the server does

| Area | Behaviour |
| --- | --- |
| Sign-in | OpenID Connect with **Entra ID** or **Google**, chosen by `PM_AUTH`. Locally, `PM_AUTH=dev` shows a user picker instead; the server only starts that way on an address of the local machine. The server sets a signed, HTTP-only session cookie (12 hours); the browser never sees a token. |
| Sign-out | Ends every session of that person, on every device: a copy of the cookie stops working too, and a copy that was ended cannot sign the person out again. If the database cannot say whether a session was ended, the answer is `503`, neither "signed in" nor "signed out". |
| Roles | Identity (name, email) comes from the provider. Roles are stored in the database and managed in the Admin panel. They are read on every request, so a change applies at once. |
| Content | Processes, standards and the lists (one document) are JSON documents in the database. Every save is a new **version** with who saved it, when, and an optional note; a delete is recorded too. Saving an unchanged document creates no version. |
| Saving at the same time | A save says which version it was made from (`?base=`). If that is no longer the current one, nothing is stored and the answer is `409` with who saved in between. `base=0` means "I am creating this" and is refused when the document exists. Changes to one document, including creating it, run one after the other. Without `base` (imports, scripts) there is no such check. |
| Drafts | A document with status `draft` is only sent to the people who may edit it and to the owner role of the team or unit that owns it. For everyone else it does not exist: not in the lists, not in the history, feedback on it is neither listed nor accepted, and deleting it answers "does not exist". Versions that were drafts stay hidden from readers after publication, in the list of versions too. Skills are for everyone, so a skill names a draft it refers to by its id, never by its title; the refusal to remove a list entry names only documents the caller may see and counts the rest. |
| Validation | Every save is checked against `schema/*.schema.json` (the same files the app uses), and then for what a schema cannot express: steps that point to steps that exist, participants that exist, labelled paths out of a decision, no duplicate ids, and tiers, environments and languages that are in the lists (`server/internal/docs/check.go`). These are the rules the app's checker treats as errors; what it only warns about (an owner that is not in the lists yet, a process that is not described yet) is accepted. An entry of the lists that a process, a standard or a role still uses cannot be removed. |
| Skills | After a save or delete, the skills of that process or standard are regenerated from what is stored, and so are the skills of every document that names it. A new version is stored only when the text changed; it records the version of its source. A pointer to the skill of another document is only written when that document is active. Changing the lists regenerates everything, because names appear in the text. Regeneration runs one at a time and does not depend on the browser that saved staying connected. |
| Feedback | About a step of a process or a requirement of a standard. Anyone signed in can report and say "I hit this too". |
| Stale feedback | Each item remembers a fingerprint of the step or requirement it was written about. When that changes or disappears, the item is flagged "may already be fixed". |
| Notifications | New feedback is announced to the owning team or unit (name and contact from the lists); a fix is announced to the reporter. `PM_NOTIFY=log` writes them to the server log, `webhook` posts `{"text": …}` plus the event fields (`type`, `targetKind`, `processId`, `processTitle`, `stepTitle`, …) to a URL (a Slack incoming webhook accepts this as is). The webhook is called in the background, up to three times, and what people typed is escaped so that it cannot become chat markup. A brake keeps one person at about 30 stored items an hour; it is a courtesy limit against a script gone wrong, not a hard quota. |
| Reviews | The team or unit that owns a process or standard is asked to confirm regularly that it is still correct. The owner role can record that without being an editor (`POST …/review`): it is the one change to content that role may make. |
| Activity | Every change to content (with the version and its note), lists, roles and skill guidance is recorded with who and when. For processes, standards and the lists the entry is written in the same transaction as the change; for roles, skill guidance and feedback it is written right after it, and a failure to write it is logged. Closing, reopening or deleting somebody else's feedback is recorded too. |
| Protection | Every change needs the header `X-Requested-With: process-manager` (stops cross-site form posts), bodies are limited to 1 MB, ids are validated, a request gets 30 seconds. Every answer carries a content security policy (only the app's own scripts, no `eval`, no framing), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Strict-Transport-Security` when the address is https. |
| Operation | Requests to `/api` and `/auth` are logged with status and duration (`PM_LOG_FORMAT=json` for one JSON object per line). `/healthz` says the process runs, `/readyz` that it also reaches the database. On SIGTERM the server stops accepting requests and finishes the ones in progress (up to 15 seconds) before it closes the database. |

### Roles

| Role | May | Scope |
| --- | --- | --- |
| *(everyone signed in)* | Read published content and its versions, tick steps, report, "I hit this too", delete own feedback, read and download skills | |
| `owner` | Confirm reviews; mark fixed / reopen / delete feedback; see drafts | Required: one team or unit; applies to what it owns |
| `process-editor` | Create, change and delete processes, including drafts; manage their feedback; edit the guidance of their skills | All processes |
| `standards-editor` | The same for standards | Optional: one unit. Moving a standard to another unit needs the role for both. |
| `catalog-manager` | Change the lists | |
| `admin` | Everything, including roles, the activity log and the system page | |

- `PM_ADMINS` names the bootstrap admins. They are always admin and cannot be removed in the panel.
- Without bootstrap admins, the last admin in the database cannot be removed (409).
- A role limited to a team must name a team that exists in the lists.
- If the roles cannot be read, the request is treated as a consumer's.
- The right to change a stored document is checked in the same transaction as the save, against its stored owner.

## API

All under the same origin as the app. JSON in and out; errors are `{"error": "…"}`.

| Method and path | Purpose | Who |
| --- | --- | --- |
| `GET /api/me` | Who is signed in, their rights (`perms`), the provider | anyone |
| `GET /auth/login`, `GET /auth/callback` | Sign-in with Entra ID or Google | anyone |
| `POST /auth/dev/login` | Local development only: `{"email": "sam@example.com"}` | anyone |
| `POST /auth/logout` | End every session of the person | signed in |
| `GET /api/processes`, `GET /api/standards` | `{"processes": […], "meta": {id: {version, updatedAt, updatedBy}}}` (or `standards`); drafts only for those who may see them | signed in |
| `GET /api/catalog` | The lists; their version is in the header `X-Document-Version` | signed in |
| `PUT /api/processes/{id}?base=&note=`, `DELETE /api/processes/{id}?base=` | Save or delete a process. Answers `{ok, changed, version, updatedAt, updatedBy}`, or `409` with `{"error", "conflict": {exists, version, updatedBy, updatedAt}}` | process editors |
| `PUT /api/standards/{id}?base=&note=`, `DELETE /api/standards/{id}?base=` | The same for a standard | standards editors of its unit |
| `POST /api/processes/{id}/review?base=`, `POST /api/standards/{id}/review?base=` | Record that it was reviewed and is still correct: today's date (the server's) and the caller's name, saved as a version with the note "Reviewed: confirmed as still correct". Nothing else in the document changes. Only for something that is in use; `409` when `base` is not the current version. Answers like a save, plus the `document`. | editors of it, and the owner role of its team or unit |
| `PUT /api/catalog?base=&note=` | Save the lists | lists managers |
| `GET /api/history/{process\|standard\|catalog}/{id}` | Versions: number, who, when, note, deleted | who can see the document; admins for deleted ones |
| `GET /api/history/{kind}/{id}/{version}` | The content of one version | as above; a version that was a draft only for those who may see drafts |
| `GET /api/feedback` | All feedback as `{process: {id: […]}, standard: {id: […]}}`, as the caller sees it (`mine`, `canManage`, `alsoHitByMe`, `stale`) | signed in |
| `POST /api/feedback` | `{"targetKind", "targetId", "itemId"?, "kind", "text"}` | signed in |
| `POST` / `DELETE /api/feedback/{id}/also-hit` | "I hit this too" on / off | signed in, not the author |
| `PATCH /api/feedback/{id}` | `{"resolved": true \| false}` | editors of the target, owners of its team |
| `DELETE /api/feedback/{id}` | Remove an item | as above, and the author |
| `GET /api/skills` | Every skill and review agent with its latest version number | signed in |
| `GET /api/skills/{id}` | Text, versions, extra guidance, `canEdit` | signed in |
| `GET /api/skills/{id}/versions/{n}` | The text of an older version | signed in |
| `GET /api/skills/{id}/download` | The latest text as a file (`SKILL.md` or `<id>.md`) | signed in |
| `PUT /api/skills/{id}/extra` | `{"extra": "…"}`: hand-written guidance, then regenerate | who may edit the source |
| `GET /api/admin/access` | Assignments, bootstrap admins, role names | admins |
| `POST` / `DELETE /api/admin/access` | `{"email", "role", "scope"}`: give or remove a role | admins |
| `GET /api/admin/audit?limit=&before=` | A page of the activity log, newest first: `{"entries", "more"}`. `limit` is 100 by default and at most 499; `before` is the id of the last entry of the page before. | admins |
| `GET /api/admin/system` | Provider, address, counts | admins |
| `GET /healthz`, `GET /readyz` | The process runs; it also reaches the database | anyone |

There is no machine-to-machine access yet: every call needs a browser session. Repositories get skills by download or through `npm run export`.

## Settings

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Required. |
| `PM_AUTH` | `entra`, `google` or `dev`. Required; there is no default, so a deployment cannot fall back to the dev picker by accident. |
| `PM_ADMINS` | Comma-separated emails of the bootstrap admins. Required with `entra` and `google`. With `dev` it defaults to `dana@example.com`. |
| `PM_BASE_URL` | Public address of the app. Required with `entra` and `google`, and it must start with `https://` (plain http is accepted for localhost). The redirect address to register with the provider is `<PM_BASE_URL>/auth/callback`. |
| `PM_SESSION_SECRET` | At least 32 random characters, e.g. from `openssl rand -base64 48`. Signs the session cookie. A placeholder or an obviously simple value is refused. |
| `PM_OIDC_CLIENT_ID`, `PM_OIDC_CLIENT_SECRET` | The app registration |
| `PM_ENTRA_TENANT` | Entra ID tenant id or domain. Single-tenant only. |
| `PM_GOOGLE_HOSTED_DOMAIN` | Accept only accounts of this Google Workspace domain. With `google`, this or `PM_ALLOWED_EMAIL_DOMAINS` is required: without a limit any Google account could sign in. |
| `PM_ALLOWED_EMAIL_DOMAINS` | Optional, for either provider: comma-separated domains; only addresses that end in one of them may sign in |
| `PM_OIDC_ISSUER` | Optional: override the issuer (sovereign clouds, tests) |
| `PM_SEED_DIR` | Folder with `processes/`, `standards/`, `catalog/` that fills an empty database, and with `schema/`. Default: the working directory. |
| `PM_SCHEMA_DIR` | Folder with the JSON schemas. Default: `<PM_SEED_DIR>/schema`. |
| `PM_STATIC_DIR`, `PM_ADDR` | The built app and the listen address; set by the `Dockerfile` and by `npm run dev` |
| `PM_NOTIFY`, `PM_NOTIFY_WEBHOOK_URL` | `log` (default) or `webhook` |
| `PM_LOG_FORMAT` | `text` (default) or `json` |
| `PM_DEV_AUTH_ON_NETWORK` | `i-understand` lets `PM_AUTH=dev` listen on an address that others can reach. For a demo on a private network only: with the picker anyone can sign in as anyone, including the admin. |

Who somebody is: with Entra ID only the sign-in name (`preferred_username`, then `upn`) is used, never the `email` claim, because the sign-in name is set by the tenant and the email can be edited. With Google the `email` claim is used, and refused when Google says the address is not verified. Emails are compared case-insensitively. Calls to the provider are given 10 seconds. When a sign-in fails, the person sees a short reason; the provider's own answer goes to the server log only.

## Database

Postgres 16. The server creates and upgrades its tables on start (`server/internal/db/migrations/`); starting several instances at once is safe, also on a database that is still empty: one of them does the work, the others wait.

| Table | Holds |
| --- | --- |
| `documents` | The current version of every process, standard and the lists. The body is `json` (not `jsonb`), so the order of the keys is kept. |
| `document_versions` | Every version with who saved it, when and the note; a null body records a deletion |
| `signed_out` | When each person last signed out: sessions issued before that moment no longer count |
| `role_assignments` | Email, role, scope, who gave it and when |
| `audit_log` | The activity log |
| `skills`, `skill_versions` | The registry and every generated version, with the version of the source it came from |
| `feedback`, `feedback_also_hit` | Feedback and who else hit the same problem |

## Starting, importing, exporting

- **First start:** when `documents` is empty, the server imports `PM_SEED_DIR`. It never does so again, so content changed in the portal is not overwritten by a new deployment.
- **Development roles:** with `PM_AUTH=dev` and no roles stored, the built-in users get theirs (`server/internal/auth/dev.go`).
- **Every start:** the skills are brought in line with the content.

| Command | Does |
| --- | --- |
| `server -import <folder>` (`npm run db:import`) | Loads the files over what is stored: each changed file becomes a new version. Files get the same checks as a save in the portal (the format, and that the parts fit together); those that fail are reported and skipped. Nothing is deleted. |
| `server -export <folder>` (`npm run export -- <folder>`) | Writes content to `processes/`, `standards/`, `catalog/` and the active skills to `.claude/`. Files of deleted documents and of withdrawn skills are removed (a skill file only if it carries the footer of a generated file). Use it as a backup or to commit. |
| `server -reset [-seed]` (`npm run db:reset`) | Deletes all feedback; `-seed` adds the samples again. Only with `PM_AUTH=dev`. |

## Deploying

`Dockerfile` builds one image with the server, the built app, the schemas and the sample content. It needs a Postgres database and the settings above; see `.env.example`. After the first start, changes are made in the portal and are live at once.

Not built yet: machine access for repositories and agents (API tokens, the MCP server in `docs/mcp.md`), mapping Entra or Google groups to roles, ending the sessions of one person from the Admin panel (their own sign-out does it; removing them at the provider takes effect when their session expires, after at most 12 hours), and per-person run tracking.

## Code map

```
server/cmd/server              start-up, seeding, flags (-import, -export, -seed, -reset)
server/internal/config         settings from the environment
server/internal/db             migrations, the start-up lock; dbtest gives tests a real database
server/internal/auth           sessions, sign-outs, OpenID Connect, dev users
server/internal/auth/oidctest  fake provider that signs real tokens, for tests
server/internal/rbac           roles and what they allow
server/internal/docs           documents with versions, the consistency check, import and export
server/internal/schema         JSON schema validation of saves
server/internal/skills         generators for skills and review agents; the registry
server/internal/feedback       feedback store
server/internal/audit          activity log
server/internal/notify         log and webhook notifiers
server/internal/httpapi        routes, permissions, views
```
