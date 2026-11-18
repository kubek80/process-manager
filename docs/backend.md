# Backend

Everything people change in the portal is stored in a database: processes, standards, the lists, roles, feedback, requests and the generated skills, and how processes and standards are used (views, bookmarks, upvotes, skill downloads). The server signs people in, enforces their rights, keeps every version, and regenerates skills when their source changes.

```mermaid
flowchart LR
  people(["People"]) --> app["Built app (static)"] --> server["Go server"]
  subgraph image["One container"]
    app
    server
  end
  server --> db[("Postgres<br/>content + versions, roles,<br/>feedback, skills, activity,<br/>views, votes, requests")]
  server <-. "sign-in" .-> idp["Entra ID or Google"]
  server -. "notifications" .-> chat["Team channel"]
  server -. "search by meaning (only with PM_EMBEDDINGS=vertex)" .-> vertex["Vertex AI embeddings"]
  seed["Files in git<br/>processes/ standards/ catalog/"] -. "first fill, import, export" .-> server
```

## What the server does

| Area | Behaviour |
| --- | --- |
| Sign-in | OpenID Connect with **Entra ID** or **Google**, chosen by `PM_AUTH`. Locally, `PM_AUTH=dev` shows a user picker instead; the server only starts that way on an address of the local machine. The server sets a signed, HTTP-only session cookie (12 hours); the browser never sees a token. |
| Sign-out | Ends every session of that person, on every device: a copy of the cookie stops working too, and a copy that was ended cannot sign the person out again. If the database cannot say whether a session was ended, the answer is `503`, neither "signed in" nor "signed out"; a sign-out during such an outage clears the cookie of that browser and says that the other sessions could not be ended. |
| Roles | Identity (name, email) comes from the provider. Roles are stored in the database and managed in the Admin panel. They are read on every request, so a change applies at once. |
| Content | Processes, standards and the lists (one document) are JSON documents in the database. Every save is a new **version** with who saved it, when, and an optional note; a delete is recorded too. Saving an unchanged document creates no version. |
| Saving at the same time | A save says which version it was made from (`?base=`). If that is no longer the current one, nothing is stored and the answer is `409` with who saved in between. `base=0` means "I am creating this" and is refused when the document exists. Changes to one document, including creating it, run one after the other. Without `base` (imports, scripts) there is no such check. |
| Drafts | A document with status `draft` is only sent to the people who may edit it and to the owner role of the team that owns it. For everyone else it does not exist: not in the lists, not in the history, feedback on it is neither listed nor accepted, and deleting it answers "does not exist". Versions that were drafts stay hidden from readers after publication, in the list of versions too. Skills are for everyone, so a skill names a draft it refers to by its id, never by its title; the refusal to remove a list entry names only documents the caller may see and counts the rest. |
| Validation | Every save is checked against `schema/*.schema.json` (the same files the app uses), and then for what a schema cannot express: steps that point to steps that exist, participants that exist, labelled paths out of a decision, no duplicate ids (also within each list), tiers, environments, languages, and the category, practice and platform of a process or standard, that are in the lists, and a review date that is a real day (`server/internal/docs/check.go`). These are the rules the app's checker treats as errors; what it only warns about (an owner that is not in the lists yet, a process that is not described yet) is accepted. An entry of the lists that a process, a standard or a role still uses cannot be removed: a category, practice or platform that something belongs to, a team that owns something or takes part in a step, and a team, platform or practice that a role is limited to. A list that is missing from the lists counts as empty. |
| Skills | After a save or delete, the skills of that process or standard are regenerated from what is stored, and so are the skills of every document that names it. A new version is stored only when the text changed; it records the version of its source. A pointer to the skill of another document is only written when that document is active. A skill names the owning team and, when they are set, the category, practice and platform (by name) and, for a process, its rigour in plain words. Changing the lists regenerates everything, because names appear in the text. Regeneration runs one at a time and does not depend on the browser that saved staying connected; the answer to the save waits for it for up to 20 seconds, after which it finishes on its own. |
| Feedback | About a step of a process or a requirement of a standard. Anyone signed in can report and say "I hit this too". The text is checked like the text of a request (line breaks allowed): "The text contains control characters. Remove them and try again.", "The text contains characters that change the reading direction. Remove them and try again.", "The text has no visible characters." |
| Stale feedback | Each item remembers a fingerprint of the step or requirement it was written about. When that changes or disappears, the item is flagged "may already be fixed". |
| Search by meaning | Off unless `PM_EMBEDDINGS` is set. Published processes and standards are cut into parts, each part is turned into a vector, and `GET /api/search` finds the parts closest in meaning to a question and returns their documents. See [Search by meaning](#search-by-meaning). |
| Notifications | New feedback is announced to the owning team (name and contact from the lists); a fix is announced to the reporter. `PM_NOTIFY=log` writes them to the server log, `webhook` posts `{"text": …}` plus the event fields (`type`, `targetKind`, `processId`, `processTitle`, `stepTitle`, …) to a URL (a Slack incoming webhook accepts this as is). The webhook is called in the background, up to three times, and what people typed is escaped so that it cannot become chat markup. A brake keeps one person at about 30 stored items an hour; it is a courtesy limit against a script gone wrong, not a hard quota. |
| Views | Opening a process or standard counts a view (`POST /api/views/…`), at most once per person, document and day (the server's date in UTC). The server stores who viewed what on which day only to count views and different people ("people"); nobody is ever shown who viewed something. The all-time views, people and downloads of each document are kept in `document_counts`, updated in the transaction that records a view or download, so reading them does not depend on how many were ever recorded. A failure to count is logged and the page is answered with the numbers as they are. |
| Bookmarks and upvotes | Anyone signed in can bookmark a process or standard (kept per person on the server, so it follows them to another device) and upvote it ("this is useful"): one vote per person, which can be taken back. |
| Skill downloads | A download of a skill or review agent from the portal counts for the process or standard it comes from, at most once per person, skill and day (like views): downloading the same file fifty times in a day is one download. Who downloaded is stored for that alone and never shown. `-export` has no person and counts one per skill it writes on every run, so an export that is scheduled adds one per skill per run. Only the download of the latest text counts: reading an older version in the app is not a download. Downloads stored before the person was kept have no person and count as they were. Nothing is counted for a skill whose document no longer exists. A failure to count is logged and never stops the download. |
| Counts and drafts | Counts, bookmarks and upvotes are only given for what the caller may see: a draft somebody cannot see answers `404` and is left out of every count and list. Which documents are drafts, and what they belong to, is read from columns the database keeps of every body (`status`, `owner`, `platform`, `practice`), so no body is read for it. Admins see everything in the statistics, drafts included, marked by their status. |
| Deleting a document | Its feedback, bookmarks, upvotes and kept numbers are deleted with it. Its views and downloads stay, so that the totals and the trend of a past period do not change, but they are marked as belonging to a deleted document (their id becomes `<id>@deleted-<n>`): they count for no document, and something new created under the same id starts from nothing. A done request it answered stays done, loses the link and says that its answer was removed (`linkedGone`). |
| Requests | Anyone signed in can ask for a process or standard that does not exist yet: a title (5-120 characters), what is needed and why (10-1000), and optionally the platform and practice it would belong to (they must be in the lists). Surrounding white space is trimmed before the length is measured; control characters (a line break is fine in the description and the note), characters that change the reading direction and text without a visible character are refused. Everyone sees all requests and can vote for them, one vote per person (the requester too). A request is `open`, `planned`, `done` (linked to a published process or standard of the same kind that answers it) or `declined` (with a reason); it can be set back to open. A brake keeps one person at 10 requests an hour: the count and the new request are stored in one step per person, so requests sent at the same time cannot slip past, and requests withdrawn or removed in the hour still count. Creating, changing the state and deleting are written to the activity log in plain words, e.g. "“Naming of cloud resources”: Done, answered by the standard “Naming”". |
| Statistics | For admins: per process and standard, the views, people, skill downloads, upvotes and handled feedback of a period, with the upvotes and open feedback as of now; totals, with the part that belongs to deleted documents; the same grouped by platform, practice and owning team; views, people and downloads per week; and the same rows as a CSV file. See [Statistics](#statistics). |
| Reviews | The team that owns a process or standard is asked to confirm regularly that it is still correct. The owner role of that team can record that without being an editor (`POST …/review`): it is the one change to content that role may make. Whoever may edit it can record it too. |
| Activity | Every change to content (with the version and its note), lists, roles and skill guidance is recorded with who and when, and so is every request made, changed in state or deleted. For processes, standards and the lists the entry is written in the same transaction as the change; for roles, skill guidance, feedback and requests it is written right after it, and a failure to write it is logged. Views, bookmarks, upvotes and votes are not recorded. Closing, reopening or deleting somebody else's feedback is recorded too. |
| Protection | Every change needs the header `X-Requested-With: process-manager` (stops cross-site form posts), bodies are limited to 1 MB, ids are validated, a request gets 30 seconds. Every answer carries a content security policy (only the app's own scripts, no `eval`, no framing), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Strict-Transport-Security` when the address is https. |
| Operation | Requests to `/api` and `/auth` are logged with status and duration (`PM_LOG_FORMAT=json` for one JSON object per line). `/healthz` says the process runs, `/readyz` that it also reaches the database. On SIGTERM the server stops accepting requests and finishes the ones in progress (up to 15 seconds) before it closes the database. |

### Roles

| Role | May | Scope |
| --- | --- | --- |
| *(everyone signed in)* | Read published content and its versions, see who belongs to which team, platform and practice, tick steps, report, "I hit this too", delete own feedback, read and download skills, bookmark and upvote, request a process or standard, vote for requests, withdraw own requests while they are open | |
| `owner` | Confirm reviews; mark fixed / reopen / delete feedback; see drafts | Required: one team; applies to what that team owns |
| `platform-owner` | Create, change and delete the processes and standards that belong to the platform, including drafts; confirm their reviews; manage their feedback; edit the guidance of their skills | Required: one platform; applies to what names it as its platform |
| `practice-owner` | The same for what belongs to the practice | Required: one practice; applies to what names it as its practice |
| `process-editor` | Create, change and delete every process, including drafts; manage their feedback; edit the guidance of their skills | All processes |
| `standards-editor` | The same for every standard | All standards; it cannot be limited |
| `catalog-manager` | Change the lists | |
| `admin` | Everything, including roles, the activity log, the system page and the statistics; removing any request | |

A process or standard belongs to a team (`owner`), and may belong to a platform (`platform`) and a practice (`practice`), as its content says.

- **May edit** (save, create, delete, restore an older version): admins; process editors for a process; standards editors for a standard; the owners of its platform; the owners of its practice.
- **May confirm reviews, manage feedback and see drafts:** whoever may edit it, and the `owner` role of its team. A team's owners do not edit.
- A save needs the right for the stored version and for the new content, checked in the same transaction as the save. So an owner of one platform cannot take over a document of another platform, and cannot move one of theirs to a platform or practice they do not own, or to none. Creating needs the right for the new content: a platform owner can create what belongs to their platform.
- **Shared documents:** somebody who may edit a document only as an owner of its platform or practice may put it on a platform, or take it off one, only when they own that platform: both the one it had and the one it gets. The same holds, separately, for the practice. An owner of only the practice of a document that is also on a platform therefore cannot change, add or remove its platform, and the reverse; when creating, every platform and practice set must be theirs. Everything else, the owning team included, they may change. Admins, process editors (for processes) and standards editors (for standards) are not limited. This is checked under the same lock as the save, so it holds for putting an older version back and for creating something under the id of a deleted document too. The refusal is `403` "Only an owner of the platform “Azure”, or a process editor, can put this process on that platform or take it off it." (for a practice: "… can put this standard in that practice or take it out of it.", with "a standards editor" for a standard).
- A role that covers everything (`admin`, `catalog-manager`, `process-editor`, `standards-editor`) gives nothing when it carries a scope; only an earlier version could store one. The Admin panel lists it so that it can be removed.
- `PM_ADMINS` names the bootstrap admins. They are always admin and cannot be removed in the panel.
- Without bootstrap admins, the last admin in the database cannot be removed (409).
- The scope of `owner` must be a team in the lists, of `platform-owner` a platform, of `practice-owner` a practice. A team, a platform and a practice may share an id; each role looks in its own list.
- The members of a team, platform or practice are the people with `owner`, `platform-owner` or `practice-owner` limited to it. There is no separate membership: the Members sections in Admin › Lists give and take these roles through `/api/admin/access`, and everyone signed in can read them through `/api/members`. Membership is not read from Entra or Google groups. One person can be in a team, a platform and a practice at the same time.
- A team, platform or practice that a role is still limited to cannot be removed from the lists; the roles have to be taken away first.
- If the roles cannot be read, the request is treated as a consumer's.
- **Requests:** the state of a request is changed by whoever could create what it asks for: admins; process editors for a process request; standards editors for a standard request; the owners of the platform and of the practice it names. A team's owners do not. The requester may withdraw (delete) their own request while it is open; an admin may delete any request. Marking one done needs a published process or standard of the same kind: one that every reader can see. A draft is refused ("Only a published process can answer a request. Publish it first."); a retired one is accepted, because it is still there to read. If the answering document becomes a draft again later, people who cannot see it get `linkedId` `""` and `linkedGone` `false`, and nothing else of it. If it is deleted, the request stays done with `linkedId` `""` and `linkedGone` `true` for everyone, and a document created later under the same id does not become the answer.
- A platform or practice that a request names can still be removed from the lists: a request is a wish, not part of the structure. The request keeps the id, and the app shows the id where it would show the name. Nobody is then its platform or practice owner; admins and the editors of the kind still manage it.

## API

All under the same origin as the app. JSON in and out; errors are `{"error": "…"}`.

| Method and path | Purpose | Who |
| --- | --- | --- |
| `GET /api/me` | Who is signed in, their rights, the provider. `perms` is `{admin, catalog, processes, standards, owns, platforms, practices}`: the last three are lists of team, platform and practice ids (empty lists, never null). `search` is `{"meaning": true\|false, "outside": true\|false}`: whether search by meaning is switched on, and whether the text of a search is sent to an outside service (Vertex AI) | anyone |
| `GET /auth/login`, `GET /auth/callback` | Sign-in with Entra ID or Google | anyone |
| `POST /auth/dev/login` | Local development only: `{"email": "sam@example.com"}` | anyone |
| `POST /auth/logout` | End every session of the person | signed in |
| `GET /api/processes`, `GET /api/standards` | `{"processes": […], "meta": {id: {version, updatedAt, updatedBy}}}` (or `standards`); drafts only for those who may see them | signed in |
| `GET /api/catalog` | The lists (tiers, environments, languages, teams, practices, platforms, categories, tools); their version is in the header `X-Document-Version` | signed in |
| `GET /api/search?q=&limit=` | Search by meaning: `{"results": [{"kind", "id", "score", "hits": [{"part", "item", "label", "snippet", "score"}]}]}`, best first, at most `limit` documents (1-100, default 50; anything else `400`). Only published documents (active and retired), never a draft, also not for those who may see it. `score` is 0 to 1, higher is closer; a document's score is that of its best part; up to 3 hits each, best first. `part` is `summary`, `step`, `prerequisite`, `requirement` or `scope`; `item` the step or requirement id (`""` for summary and scope, the position `"0"`, `"1"`… for a prerequisite). An empty `q` gives `{"results": []}`; one longer than 1000 characters `400`. `404` "Search by meaning is not switched on." when it is off; `429` "You have searched very often in the last minute. Wait a moment, then try again." after 60 searches of one person in a minute; `502` "Search by meaning is not available right now. Try again in a moment, or search by words." when the provider cannot be reached; `503` "Search by meaning is not ready yet. …" when the index has not been built. The page applies its filters, counts and paging itself. | signed in |
| `GET /api/members` | `{"members": [{"email", "role", "scope"}]}`: every assignment of `owner`, `platform-owner` and `practice-owner`, sorted by role, scope and email | signed in |
| `PUT /api/processes/{id}?base=&note=`, `DELETE /api/processes/{id}?base=` | Save or delete a process. Answers `{ok, changed, version, updatedAt, updatedBy}`, or `409` with `{"error", "conflict": {exists, version, updatedBy, updatedAt}}`. A save that is not allowed is `403`: "You can only save a process that belongs to a platform or practice you own." for a platform or practice owner whose new content is not theirs, otherwise "Only process editors and the owners of its platform or practice can change this process." | process editors, owners of its platform or practice |
| `PUT /api/standards/{id}?base=&note=`, `DELETE /api/standards/{id}?base=` | The same for a standard | standards editors, owners of its platform or practice |
| `POST /api/processes/{id}/review?base=`, `POST /api/standards/{id}/review?base=` | Record that it was reviewed and is still correct: today's date (the server's) and the caller's name, saved as a version with the note "Reviewed: confirmed as still correct". Nothing else in the document changes. Only for something that is in use; `409` when `base` is not the current version. Answers like a save, plus the `document`. | editors of it, and the owner role of its team |
| `PUT /api/catalog?base=&note=` | Save the lists | lists managers |
| `GET /api/history/{process\|standard\|catalog}/{id}` | Versions: number, who, when, note, deleted. Versions older than the most recent deletion of the id belong to the deleted document: they are listed only for admins and the editors of every document of the kind (process editors, standards editors), not for whoever created something new under the id. | who can see the document; admins for deleted ones |
| `GET /api/history/{kind}/{id}/{version}` | The content of one version | as above; a version that was a draft only for those who may see drafts; one from before the most recent deletion only for admins and the editors of the kind |
| `GET /api/feedback` | All feedback as `{process: {id: […]}, standard: {id: […]}}`, as the caller sees it (`mine`, `canManage`, `alsoHitByMe`, `stale`) | signed in |
| `POST /api/feedback` | `{"targetKind", "targetId", "itemId"?, "kind", "text"}` | signed in |
| `POST` / `DELETE /api/feedback/{id}/also-hit` | "I hit this too" on / off | signed in, not the author |
| `PATCH /api/feedback/{id}` | `{"resolved": true \| false}` | editors of the target, owners of its team |
| `DELETE /api/feedback/{id}` | Remove an item | as above, and the author |
| `GET /api/engagement` | `{"counts": {"process": {id: {views, people, downloads, upvotes, handled}}, "standard": {…}}, "mine": {"bookmarks": [{kind, id, at}], "upvotes": [{kind, id}]}}`. Counts are all-time, only for what the caller may see; a document with nothing yet is left out (read it as zeros). `handled` is feedback marked as fixed. Bookmarks are newest first. | signed in |
| `POST /api/views/{process\|standard}/{id}` | Count a view, once per person, document and day; answers `{"views": n, "people": n}`, the all-time numbers of the document afterwards. `404` "That does not exist." when the caller may not see it. A failure to store the view is logged and answered with the numbers as they are. | signed in |
| `PUT` / `DELETE /api/bookmarks/{kind}/{id}` | Bookmark or drop: `204`. Putting one needs a document the caller may see (`404` otherwise); dropping always answers `204`. | signed in |
| `PUT` / `DELETE /api/upvotes/{kind}/{id}` | Upvote or take back: `{"upvotes": n}` for the document. Upvoting needs a document the caller may see (`404` otherwise); taking back always works, and answers `204` without the number when the caller cannot see the document (any more) | signed in |
| `GET /api/requests` | `{"requests": [Request]}`, newest first. A Request is `{id, kind, title, description, platform, practice, requestedBy: {name, email}, createdAt, state, stateNote, stateBy, stateAt, linkedId, linkedGone, votes, votedByMe, mine, canManage}`; `platform`, `practice`, `stateNote`, `stateBy` (a name), `stateAt` (RFC 3339) and `linkedId` are `""` when not set; `linkedGone` is `true` when the document that answered a done request was deleted | signed in |
| `POST /api/requests` | `{"kind", "title", "description", "platform"?, "practice"?}` → `201` Request. Refusals are `400`: "Say whether a process or a standard is requested.", "Give the request a title of 5 to 120 characters.", "Describe what is needed and why in 10 to 1000 characters.", "The title contains characters that cannot be stored.", "The title contains control characters. Remove them and try again.", "The title contains characters that change the reading direction. Remove them and try again.", "The title has no visible characters." (the same with "The description"), "There is no platform “x” in the lists." (or practice); `429` "You have made a lot of requests in the last hour. Please try again later." | signed in |
| `PUT` / `DELETE /api/requests/{id}/vote` | Vote or take it back: `{"votes": n}` | signed in |
| `PUT /api/requests/{id}/state` | `{"state", "note"?, "linkedId"?}` → Request. `linkedId` is kept only for `done`. Refusals: `403` "Only admins, process editors and the owners of the platform or practice it names can change the state of this request." ("standards editors" for a standard); `400` "The state must be open, planned, done or declined.", "Say why the request is declined.", "Choose the process that answers this request.", "There is no process “x”.", "Only a published process can answer a request. Publish it first.", "Keep the note under 1000 characters.", and the checks of the text with "The note" | admins, editors of the kind, owners of its platform or practice |
| `DELETE /api/requests/{id}` | `204`. `403` "You can only withdraw your own request."; `409` "This request is no longer open, so it cannot be withdrawn." An unknown request is `404` "That request does not exist." | the requester while it is open; admins |
| `GET /api/skills` | Every skill and review agent with its latest version number | signed in |
| `GET /api/skills/{id}` | Text, versions, extra guidance, `canEdit` | signed in |
| `GET /api/skills/{id}/versions/{n}` | The text of an older version | signed in |
| `GET /api/skills/{id}/download` | The latest text as a file (`SKILL.md` or `<id>.md`); counts one download, at most once per person, skill and day | signed in |
| `PUT /api/skills/{id}/extra` | `{"extra": "…"}`: hand-written guidance, then regenerate | who may edit the source |
| `GET /api/admin/access` | Assignments, bootstrap admins, role names | admins |
| `POST` / `DELETE /api/admin/access` | `{"email", "role", "scope"}`: give or remove a role. The activity log uses the names of the Admin panel, e.g. "Practice owner for the practice Engineering". Refusals are `400` in plain words, e.g. "A standards editor always covers all standards: it cannot be limited to a team, platform or practice.", "A platform owner needs the platform it is for.", "There is no platform “x” in the lists." | admins |
| `GET /api/admin/audit?limit=&before=` | A page of the activity log, newest first: `{"entries", "more"}`. `limit` is 100 by default and at most 499; `before` is the id of the last entry of the page before. | admins |
| `GET /api/admin/system` | Provider, address, counts | admins |
| `GET /api/admin/statistics?period=7\|30\|90\|365\|all` | The statistics of a period (default `30`); `400` "Choose a period of 7, 30, 90 or 365 days, or all." See [Statistics](#statistics). | admins |
| `GET /api/admin/statistics.csv?period=…` | The same rows as a CSV file | admins |
| `GET /healthz`, `GET /readyz` | The process runs; it also reaches the database | anyone |

Every call needs a browser session. Agents read through the separate MCP server (`server/cmd/mcp`, see `docs/mcp.md`); repositories get skills by download or through `npm run export`.

## Statistics

Periods are counted in days by the server's clock in UTC. `period=7` is today and the six days before it: `from` is the first day, `to` is today, and everything from the start of `from` (00:00 UTC) until now counts. `all` starts on the first day anything was recorded (a view, download, upvote, feedback or request), or today when nothing was.

```
{ "period": "30", "from": "2026-10-19", "to": "2026-11-17",
  "totals": {"views", "people", "downloads", "upvotes", "feedbackOpened", "feedbackHandled", "requests"},
  "rows":   [{"kind", "id", "title", "status", "owner", "platform", "practice", "category",
              "views", "people", "downloads", "upvotes", "upvotesTotal", "feedbackOpen", "feedbackHandled"}],
  "groups": {"platform": [{"id", "name", "documents", "views", "people", "downloads", "upvotes", "feedbackHandled"}],
             "practice": […], "team": […]},
  "trend":  [{"week": "2026-10-13", "views", "people", "downloads"}] }
```

- **rows:** one per process and standard that exists, drafts included (`status` is `active`, `draft` or `deprecated`), most viewed first. `owner`, `platform`, `practice` and `category` are ids. `views`, `people`, `downloads`, `upvotes` (given in the period) and `feedbackHandled` (marked as fixed in the period) are within the period; `upvotesTotal` and `feedbackOpen` are as of now.
- **totals:** everything recorded in the period, including the views and downloads of documents deleted since; `deletedViews` and `deletedDownloads` are that part, so the rows add up to `views - deletedViews` and `downloads - deletedDownloads`. `people` is different people who viewed anything; `feedbackOpened` is feedback written in the period, `feedbackHandled` marked as fixed in it (feedback is deleted with its document, so it is not in the totals afterwards); `requests` is requests made in it, including withdrawn ones only while they exist.
- **groups:** every platform, practice and team in the lists, plus any id a document names that is no longer in them (its name is then the id), most viewed first; when documents have no platform, practice or owning team, one more entry `{"id": "", "name": "None"}` holds them, last. A document counts in the group of its platform, of its practice and of its owning team; `people` is different people per group.
- **trend:** every week of the period, quiet ones included, oldest first; a week starts on Monday. `days` (1-7) is how many days of the week fall in the period: the first and last week can be partial, and only their days within the period count.
- **CSV:** `statistics-last-30-days-2026-11-17.csv` (`statistics-all-time-<date>.csv` for all), one line per row above, with a header line: Type, Title, Id, Status, Owning team, Platform, Practice, Category, Views, People, Skill downloads, Upvotes in the period, Upvotes in total, Open feedback, Feedback handled in the period. The status is in the words of the app (Active, Draft, Retired); teams, platforms, practices and categories are given by name (the id when it is not in the lists). The file is UTF-8 with a byte order mark and CRLF line ends, quoted where needed. A text that starts with a tab, carriage return or line feed, or whose first character after spaces is `=`, `+`, `-` or `@`, gets an apostrophe in front, so that a spreadsheet does not read it as a formula.
- **Cost:** the views of a period are reduced to one row per document and person and then grouped in the database; the weekly trend is counted at the same time on a second connection. With 3.6 million recorded views (worst case: hardly any repeat), a year or all time takes about 3 seconds, 30 days about 1.2 seconds, 7 days about half a second.

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
| `PM_EMBEDDINGS` | Search by meaning: `off` (default: the app works as without it), `builtin` (no network, the same vectors every time; used by `npm run dev`, the tests and CI) or `vertex` (Vertex AI: document text and questions are sent to Google Cloud). Needs pgvector, see [Search by meaning](#search-by-meaning). |
| `PM_EMBEDDINGS_MODEL` | With `vertex`: the model. Default `gemini-embedding-001`. |
| `PM_EMBEDDINGS_DIMENSIONS` | The size of a vector, 8 to 2000 (the largest pgvector can index). Default 768. |
| `PM_VERTEX_PROJECT`, `PM_VERTEX_LOCATION` | With `vertex`, required: the Google Cloud project and region that run the model. The server signs in to Google with Application Default Credentials (workload identity on Google Cloud, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a key file); no key is ever stored in the repository. |
| `PM_CHUNK_PARTS` | Which parts of a document are searched on their own, comma-separated: `summary`, `step`, `prerequisite`, `requirement`, `scope`. Default: all. |
| `PM_CHUNK_MAX_CHARS` | The longest part, in characters (200 to 20000); longer text is cut. Default 2000. |
| `PM_DEV_AUTH_ON_NETWORK` | `i-understand` lets `PM_AUTH=dev` listen on an address that others can reach. For a demo on a private network only: with the picker anyone can sign in as anyone, including the admin. |

Who somebody is: with Entra ID only the sign-in name (`preferred_username`, then `upn`) is used, never the `email` claim, because the sign-in name is set by the tenant and the email can be edited. With Google the `email` claim is used, and refused when Google says the address is not verified. Emails are compared case-insensitively. Calls to the provider are given 10 seconds. When a sign-in fails, the person sees a short reason; the provider's own answer goes to the server log only.

## Database

Postgres 16. The server creates and upgrades its tables on start (`server/internal/db/migrations/`), and then converts content stored by an earlier version (`server/internal/upgrade`), under the same lock; starting several instances at once is safe, also on a database that is still empty: one of them does the work, the others wait and then find it done. The start logs which table migrations it applied ("tables upgraded").

The same step can be run by hand with `server -migrate` (`npm run db:migrate`): it upgrades the tables, converts older content and brings the skills up to date, prints what it did and exits, without starting the web server, without filling an empty database from `PM_SEED_DIR` and without giving development roles. It takes the same lock as a start, so it is safe while a server is running and when several are started at once; the one that comes second finds the work done. Run it before rolling out a new version, so that the instances start on a database that is already upgraded and the outcome can be read in one place, or on a copy of the database to see what a conversion will do. Take a backup first: the conversion rewrites documents (as new versions) and adjusts their older versions in place; every earlier version is kept. The account looks like this, and a second run says "Nothing to do":

```
Database migration
  Tables:  already up to date
  Content: 2 documents moved to the new lists (3 older versions adjusted); added 1 practices, 1 platforms, 2 categories; 1 roles converted, 1 removed; the lists were updated
  Skills:  2 regenerated
Done.
```

With search by meaning switched on, the account has one more line, `Search:`, with what was embedded and removed (or "already up to date"), and `-migrate` builds the index when it is new or its settings changed.

`Tables` names the migration files applied in this run, `Content` says what the conversion did or "nothing to convert: the content already fits this version", and `Skills` how many skills got a new version (and how many were withdrawn). The details of a conversion (each role converted, each category made) go to the log. A failure exits with a non-zero code and the reason, e.g. `migration failed: database setup: …`.

| Table | Holds |
| --- | --- |
| `documents` | The current version of every process, standard and the lists. The body is `json` (not `jsonb`), so the order of the keys is kept. |
| `document_versions` | Every version with who saved it, when and the note; a null body records a deletion |
| `signed_out` | When each person last signed out: sessions issued before that moment no longer count |
| `role_assignments` | Email, role, scope, who gave it and when |
| `audit_log` | The activity log |
| `skills`, `skill_versions` | The registry and every generated version, with the version of the source it came from |
| `feedback`, `feedback_also_hit` | Feedback and who else hit the same problem |
| `document_views` | One row per person, document and day (UTC): only to count views and people. Kept when the document is deleted, with its id marked `<id>@deleted-<n>` |
| `document_counts` | All-time views, people and downloads per process and standard, updated with every view or download that counts; filled from the recorded rows when the table was made; deleted with the document |
| `bookmarks`, `upvotes` | One row per person and document, with when; deleted with the document |
| `skill_downloads` | One row per download that counts or exported skill: the skill, its process or standard, `download` or `export`, when and the day, and for a download the person (only to count once a day; `""` for exports and for downloads stored before the person was kept). Kept and marked like views when the document is deleted |
| `requests`, `request_votes` | Requests with their state, and one vote per person; votes go with their request. Platform, practice and the answering document are ids without a reference, so a request outlives what it names; `linked_gone` records that the answering document was deleted |
| `requests_removed` | Who made a request that was withdrawn or removed, and when it was made: the brake counts it for that hour. Rows older than a day are dropped |
| `search_settings`, `search_chunks`, `search_pending` | The index of search by meaning, only when it is switched on; not made by the migrations, see [Search by meaning](#search-by-meaning) |
| `documents` columns `status`, `owner`, `platform`, `practice` | Kept by the database from the body of each document, with an index of drafts: who may see what is decided without reading bodies |

Emails are stored in lower case. A person's sessions ending (sign-out, expiry) changes nothing in these tables.

## Starting, importing, exporting

- **Converting an earlier database:** content stored before practices, platforms and categories existed is converted once, in one transaction, and a database that needs nothing is left as it is:
  - a team of kind `platform` is also added to the platforms, one of kind `practice` or `security` to the practices (same id, name, contact, description); every team loses its kind and stays a team;
  - when the lists have no categories yet, every category text of a published process or standard becomes a category, its id made from the text ("Source control" → `source-control`), and the document names that id. The same text, trimmed and whatever its case, is one category; a different text that gives the same id gets the next free one (`cloud-2`; a text without Latin letters or digits gives `category`, `category-2`, …). An empty text gives no category. A text that only drafts or deleted documents use is not published as an entry: those documents lose the field. Names, contacts and descriptions are cut to the limits of the format. All of this is logged;
  - a process or standard owned by such a platform or practice team gets `platform` or `practice` set to that id, unless it already has one;
  - a `standards-editor` limited to a unit becomes `platform-owner` or `practice-owner` of it, after the kind the unit had; one limited to anything else loses the role, and the server log and the activity log say so;
  - the stored older versions of processes and standards get the same changes in place, without new versions (the category text becomes its id or goes; the platform or practice of the former unit is added), so that putting one back neither fails on its category nor takes the document off its platform. Deletion markers stay as they are;
  - the lists get practices, platforms and categories, empty if need be.

  Changed documents are saved as new versions by `system` with the note "Moved to the new lists"; the activity log gets one entry for the conversion (documents, older versions, entries added, roles converted and removed) and one per role, e.g. "Standards editor for Cyber Security became Practice owner for the practice Cyber Security". A document the save refuses (a body that does not match its row) is skipped with a warning and does not stop the start. A document that already names a category, platform or practice that is not in the lists is left as it is, with a warning on every start. The skills are regenerated right after, like on every start.
- **First start:** when `documents` is empty, the server imports `PM_SEED_DIR`. It never does so again, so content changed in the portal is not overwritten by a new deployment.
- **Development users:** with `PM_AUTH=dev`, a built-in user who has no role at all gets theirs on start (`server/internal/auth/dev.go`): a new local database gets all of them, an older one the users added since; a role whose team, platform or practice is not in the lists is skipped. Dana is admin through `PM_ADMINS`.

| User | Roles |
| --- | --- |
| sam@example.com | none: a reader |
| alex@example.com | `process-editor`, `catalog-manager` |
| casey@example.com | `owner` of team `cloud-platform-team` |
| riley@example.com | `practice-owner` of `security`, `owner` of team `security` |
| jordan@example.com | `platform-owner` of `google-cloud`, `practice-owner` of `engineering`, `owner` of team `cloud-platform-team`: one person in a team, a practice and a platform |
| dana@example.com | admin |

- **Samples (`-seed`, used by `npm run dev`):** adds three feedback items when there is no feedback. With `PM_AUTH=dev`, and only when there are no views, bookmarks, upvotes, downloads and requests at all, it also adds twelve weeks of believable use (`server/cmd/server/seed.go`): views of every published process and standard by the built-in users and 30 made-up colleagues (`colleague-01@example.com` …), more on working days and a little more each week; upvotes and bookmarks of the built-in users and upvotes of colleagues; a few downloads of each skill by the same people; five requests in every state, with votes (the one that is done points to `onboard-site-to-akamai`, or stays planned when that process is not there). The numbers are random but the same for the same content. It never adds to what is there. The end-to-end tests start the server without `-seed`, so they see none of this.
- **Every start:** the skills are brought in line with the content, and with search by meaning on, the search index too (only what changed is embedded).

| Command | Does |
| --- | --- |
| `server -import <folder>` (`npm run db:import`) | Loads the files over what is stored: each changed file becomes a new version. Files get the same checks as a save in the portal (the format, and that the parts fit together); those that fail are reported and skipped. Nothing is deleted. |
| `server -export <folder>` (`npm run export -- <folder>`) | Writes content to `processes/`, `standards/`, `catalog/` and the active skills to `.claude/`. Files of deleted documents and of withdrawn skills are removed (a skill file only if it carries the footer of a generated file). Use it as a backup or to commit. |
| `server -migrate` (`npm run db:migrate`) | Upgrades the tables, converts content stored by an earlier version and regenerates the skills, prints what it did (or "Nothing to do") and exits. Fills nothing, gives no development roles, starts no web server; see [Database](#database). |
| `server -reindex` | Brings the index of search by meaning up to date with everything stored and prints `Search index (builtin)` and a line like `110 documents, 12 parts embedded, 340 unchanged, 3 removed`, then exits. Parts that did not change are not embedded again; when the settings of the index changed, it is built anew. Refuses when `PM_EMBEDDINGS=off`. Safe while servers run. |
| `npm run db:demo` | Loads the demo data set in `demo/` over what is stored (`server -import demo`): more processes, standards and list entries for trying the app; the lists are replaced by the demo lists, nothing is deleted. Running `db:import` afterwards puts the smaller sample lists back, which leaves the demo documents naming entries that are no longer listed; run `db:demo` again to repair that. |
| `server -reset [-seed]` (`npm run db:reset`) | Deletes all feedback, views, bookmarks, upvotes, skill downloads and requests (with their votes); `-seed` adds the samples again, all of them. Only with `PM_AUTH=dev`. |

## Search by meaning

Switched on with `PM_EMBEDDINGS=builtin` or `vertex`; off by default. Code: `server/internal/chunking` (the parts), `server/internal/embedding` (the providers), `server/internal/retrieval` (the index and the search).

**What is stored.** Every published process and standard (active or retired) is cut into parts: its summary, each step, each prerequisite, each requirement and, for a standard, its scope (`PM_CHUNK_PARTS`). Each part's text starts with the kind and title of its document, so it can stand on its own, and is turned into one vector. `search_chunks` holds one row per part: the kind and id of the document, the part, the step or requirement id, the label a person reads ("Step 3: Approve the budget"), a short snippet of the text, a fingerprint of the text, the document's status and the vector, with an HNSW index for cosine distance. `search_settings` records the provider and model, the size of the vectors and the parts settings the index was built with; `search_pending` the documents whose last update failed. A draft or deleted document has no rows. Nothing else is stored: no question, and nobody's searches.

**When it is updated.** After every save, publish, retire, restore and delete in the portal, together with the skills: the document is cut again, the fingerprints are compared, only new or changed parts are embedded (in one call), parts that are gone are removed, all in one transaction. A change of the lists goes through every document (their names appear in the text). At every start, after `-import` and by `-migrate` and `-reindex` everything is caught up the same way. When the provider, the model, the size or the parts settings change, the whole index is dropped and built again at the next start. When embedding fails (the provider cannot be reached), the save still succeeds, the earlier parts stay searchable, the server logs "search by meaning: the search index could not be brought up to date after a change …" and marks the document in `search_pending`; the server tries the marked documents again every 5 minutes, and every start does too. Several servers may start at once: building the tables and a rebuild each run under a database lock.

**Searching.** The question is embedded (the vectors of recent questions are kept for 5 minutes, at most 500 of them, so the same question does not call the provider again), the nearest parts are read, and they are grouped by document: a document's score is its best part's, with up to 3 parts each. A search checks the current state of every document it returns, so a document that just became a draft or was deleted is never returned, not even before its parts are removed. Parts below a floor of similarity are not matches at all: even unrelated texts are a little similar. For `builtin` the floor is 0.20, measured on the sample and demo content (`MEASURE_FLOOR=1 go test -run MeasureFloor -v ./internal/retrieval/`): the best part for a sensible question scores 0.30 to 0.77, for questions that have nothing to do with the content ("chocolate cake recipe") mostly 0.06 to 0.17. For `vertex` it is 0.60, a starting point that has not been measured on real content (the tests never call Google). One person may search 60 times a minute (`429` after that; in memory, per server).

**The pgvector extension.** The index needs pgvector 0.5 or later in the database; the plain migrations do not, so a database without it works as long as search by meaning is off. At start the server looks for the extension in any schema. When it is missing, the server tries `create extension if not exists vector with schema public`; when it is not allowed to, it stops with a message that names the statement a database administrator has to run (`CREATE EXTENSION IF NOT EXISTS vector;`). Where: in `docker-compose.yml` and CI the image `pgvector/pgvector:pg16` has it, and `docker/init-databases.sql` creates it in `pm_dev`, `pm_test` and `pm_e2e`; on Cloud SQL for PostgreSQL and Azure Database for PostgreSQL an administrator enables it once per database (on Azure, allow `vector` in the server parameter `azure.extensions` first). The tables refer to the extension by its schema, wherever it lives.

**What leaves the company.** With `builtin`, nothing: the vectors are computed in the server. With `vertex`, the text of every published process and standard (when it is indexed, and again when it changes) and every question somebody searches for are sent to Vertex AI in the configured Google Cloud project and region. The server says so in its log at every start, and the search page tells people (`/api/me` → `search.outside`). It is off unless an operator sets `PM_EMBEDDINGS=vertex`.

## Deploying

`Dockerfile` builds one image with the server, the built app, the schemas and the sample content. It needs a Postgres database (with pgvector when search by meaning is on) and the settings above; see `.env.example`. After the first start, changes are made in the portal and are live at once.

Not built yet: sign-in of agents with their own tokens (the MCP server in `docs/mcp.md` accepts one shared secret), mapping Entra or Google groups to roles, ending the sessions of one person from the Admin panel (their own sign-out does it; removing them at the provider takes effect when their session expires, after at most 12 hours), and per-person run tracking.

## Code map

```
server/cmd/server              start-up, seeding, flags (-migrate, -reindex, -import, -export, -seed, -reset)
server/internal/config         settings from the environment
server/internal/db             migrations, the start-up lock; dbtest gives tests a real database
server/internal/upgrade        converts content stored by an earlier version, at start and by -migrate
server/internal/auth           sessions, sign-outs, OpenID Connect, dev users
server/internal/auth/oidctest  fake provider that signs real tokens, for tests
server/internal/rbac           roles and what they allow
server/internal/docs           documents with versions, the consistency check, import and export
server/internal/schema         JSON schema validation of saves
server/internal/skills         generators for skills and review agents; the registry
server/internal/feedback       feedback store
server/internal/engagement     views, bookmarks, upvotes, skill downloads; the counts and statistics
server/internal/requests       requests and their votes
server/internal/audit          activity log
server/internal/notify         log and webhook notifiers
server/internal/chunking       cuts a process or standard into the parts search by meaning compares
server/internal/embedding      turns text into vectors: built-in or Vertex AI
server/internal/retrieval      the search index in pgvector: keeping it up to date, searching it
server/internal/httpapi        routes, permissions, views, statistics, the CSV file, search
```
