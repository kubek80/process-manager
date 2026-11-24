import { flow, s } from "../chart";
import type { CodeCategory } from "../types";

// The database as it is after every migration: what each table holds, who writes it, and how
// the tables hang together. Read with server/internal/db/migrations/*.sql and the Go stores.

const M = "server/internal/db/migrations/";

export const tables: CodeCategory = {
  id: "tables",
  area: "data",
  title: "The tables",
  summary:
    "Postgres holds every process, standard and list with all their versions, the drafts, roles, the activity log, skills, use and the search index. " +
    "Thirteen migration files create and change the tables on every start, forward only; the three tables of the search index are created by the index itself (`retrieval.Index.Ensure`), so the migrations never need pgvector. " +
    "A process or standard is known everywhere by `(kind, id)`: only `working_drafts` refers to `documents` with a foreign key; everything else that counts or follows a document keeps the id as text and is removed, marked or left behind on purpose when the document is deleted.",
  requirements: [
    "Every file in `server/internal/db/migrations` runs once, in the order of its number, in a transaction of its own together with its row in `schema_migrations`; a start applies the missing ones under the advisory lock 7461001, so several servers starting at once (also on an empty database) do the work once.",
    "Migrations only go forward: there are no down files and nothing in `db.go` undoes one. Undoing a migration is manual work from a backup.",
    "The body of `documents`, `document_versions` and `working_drafts` is `json`, not `jsonb`, so the order of the keys the author wrote is kept; it is stored re-indented by `docs.Pretty`.",
    "A deletion is a row of `document_versions` with a null body; the version numbers of a document continue after it (`max(version) + 1`), so a version number is never used twice.",
    "Only `working_drafts` refers to `documents` with a foreign key (on delete cascade). `feedback`, `bookmarks`, `upvotes`, `document_views`, `document_counts`, `skill_downloads`, `requests` and `search_chunks` keep `(kind, id)` as plain text: the document's delete removes or marks their rows in the same transaction, or (the index) the next sync removes them; `skills` keeps `(source_kind, source_id)` and is set inactive by the regeneration that follows the commit.",
    "A view, a counted download, a new bookmark or upvote and a feedback item are written only while their document exists: the writing transaction reads its `documents` row `for share` (engagement held, feedback create), so a delete either comes first or waits and takes the new row along.",
    "Concurrent writers are kept apart by advisory locks. Session locks through `db.WithLock`: 7461001 migrations, 7461002 filling an empty database, 7461003 regenerating skills, 7461010 the index's `Ensure`. Transaction lock 7461011 on taking roles away (`rbac.lockRoles`). Transaction locks on `hashtextextended(text, space)`: space 7461 a document's save (`'<kind>/<id>'`), 7462 its skills, 7463 a view of one person, 7464 a person's requests, 7465 a person's feedback, 7466 the document's parts in the index.",
    "The migrations never mention pgvector: `search_settings`, `search_chunks` and `search_pending` are made by `retrieval.Index.Ensure`, only with `PM_EMBEDDINGS` on, and every use of the vector type there is qualified with the extension's schema.",
    "A program that does not upgrade the database (the MCP server) checks with `db.Current` that the newest number in `schema_migrations` is at least the newest migration file it was built with, and refuses to start otherwise; it never migrates.",
    "Content stored by an earlier version is converted after the migrations, under the same lock (`upgrade.Convert`), and a second run finds nothing to do.",
  ],
  charts: [
    {
      process: flow(
        "code-tables-save-rows",
        "How the tables hang together: a save",
        "Which tables one save of a process or standard writes, in the order it happens.",
        [["browser", "Browser"], ["server", "Server"], ["pg", "Postgres"]],
        [
          s("send", "Save a process with base=N", "browser", "task", ["check"], "PUT /api/processes/{id}"),
          s("check", "Lock it, check the stored version", "server", "verify", ["fromDraft"], "docs.SaveIn"),
          s("fromDraft", "Published from a working draft?", "server", "decision", [["dropDraft", "Yes"], ["store", "No"]]),
          s("dropDraft", "Delete the working draft", "pg", "document", ["store"], "working_drafts"),
          s("store", "Store the version and its entry", "pg", "document", ["index"], "documents, document_versions, audit_log"),
          s("index", "Index its parts in the background", "server", "automation", ["skills"], "search_chunks, search_pending"),
          s("skills", "Regenerate its skills", "server", "automation", [], "skills, skill_versions"),
        ],
      ),
      caption:
        "Everything up to \"Store the version\" is one transaction of `docs.SaveIn`. After the commit `syncSkills` starts the index's sync in the background, then regenerates the skills (the answer waits for them at most 20 seconds, `syncWait`); the parts of the search index never hold up the answer. A draft or a deleted document gets no parts: its rows in `search_chunks` are removed.",
    },
    {
      process: flow(
        "code-tables-delete",
        "How the tables hang together: a delete",
        "What happens to every table that names a document when it is deleted.",
        [["server", "Server"], ["pg", "Postgres"]],
        [
          s("delete", "Delete a process", "server", "task", ["row"], "DELETE /api/processes/{id}"),
          s("row", "Remove the row and its working draft", "pg", "document", ["version"], "documents → working_drafts (cascade)"),
          s("version", "Record the deletion", "pg", "document", ["drop"], "document_versions (null body)"),
          s("drop", "Delete what belongs to it", "pg", "automation", ["mark"], "feedback (+ also_hit), bookmarks, upvotes, document_counts"),
          s("mark", "Mark what the totals keep", "pg", "automation", ["requests"], "document_views, skill_downloads: <id>@deleted-<n>"),
          s("requests", "Mark requests it answered", "pg", "automation", ["parts"], "requests.linked_gone, then audit_log"),
          s("parts", "Remove its parts from the index", "server", "automation", ["skills"], "search_chunks, in the background"),
          s("skills", "Withdraw its skills", "server", "automation", [], "skills.active = false"),
        ],
      ),
      caption:
        "`deleteDoc` (`server/internal/httpapi/content.go`): the first six steps are one transaction of `docs.Store.Remove`, with `feedback.DeleteByTargetIn`, `engagement.DeleteByTargetIn` and `requests.AnswerGoneIn` in its `After`. Only `working_drafts` goes by a foreign key; everything else is named by `(kind, id)` and handled here by code. Versions, views and downloads stay; skills and the index follow after the commit.",
    },
  ],
  tables: [
    // ---------- the content and its history
    {
      name: "documents",
      purpose: "The current version of every process, standard and of the lists (one catalog document). One row per `(kind, id)`.",
      columns: [
        { name: "kind", type: "text", note: "process | standard | catalog (check)" },
        { name: "id", type: "text", note: "lower case words joined by dashes, at most 80 characters (`docs.ValidID`); the catalog's id is catalog" },
        { name: "version", type: "int", note: "the number of the version this row holds" },
        { name: "body", type: "json", note: "the whole document, keys in the author's order, re-indented" },
        { name: "updated_at", type: "timestamptz" },
        { name: "updated_by", type: "text", note: "email of whoever saved; import or system for imports and conversions" },
        { name: "status", type: "text generated always as (coalesce(body->>'status', '')) stored", note: "migration 006" },
        { name: "owner", type: "text generated (body->>'owner')", note: "the owning team; migration 006" },
        { name: "platform", type: "text generated (body->>'platform')", note: "migration 006" },
        { name: "practice", type: "text generated (body->>'practice')", note: "migration 006" },
        { name: "created_at", type: "timestamptz not null default now()", note: "when the first version since the last deletion was saved; filled from the versions by migration 007" },
      ],
      keys: [
        "`primary key (kind, id)`",
        "`documents_drafts`: index on `(kind, id) where status = 'draft'` (migration 006)",
        "`working_drafts (kind, id)` refers to it, on delete cascade",
      ],
      createdIn: M + "002_content_roles_skills.sql",
      writtenBy: ["server/internal/docs/docs.go"],
      readBy: ["server/internal/retrieval/retrieval.go", "server/internal/engagement/store.go", "server/internal/upgrade/lists.go", "server/internal/skills/store.go", "server/internal/feedback/store.go", "server/internal/icons/store.go"],
      rules: [
        "Written only by `docs.SaveIn` (`insert … on conflict (kind, id) do update`) and deleted only by `Store.Remove`, both under the lock of the document.",
        "Every write of a row is accompanied, in the same transaction, by a row of `document_versions` with the same version.",
        "The generated columns are read by the statistics (`engagement/store.go`) to group by team, platform and practice without reading bodies.",
      ],
    },
    {
      name: "document_versions",
      purpose: "Every version ever saved of every document, and every deletion (a null body). The history and restore read it.",
      columns: [
        { name: "kind", type: "text" },
        { name: "id", type: "text" },
        { name: "version", type: "int" },
        { name: "body", type: "json", note: "null: this version records a deletion" },
        { name: "saved_at", type: "timestamptz" },
        { name: "saved_by", type: "text", note: "email of whoever saved (the publisher, for a publish)" },
        { name: "note", type: "text not null default ''", note: "what changed, at most 300 characters (`docs.MaxNote`); migration 003" },
        { name: "changes_by", type: "text not null default ''", note: "who saved last the changes this version published, when that is not `saved_by`; migration 012" },
        { name: "changes_by_name", type: "text not null default ''", note: "their name as the working draft kept it; migration 012" },
      ],
      keys: ["`primary key (kind, id, version)`", "no check on `kind` and no foreign key: versions stay after the document is deleted"],
      createdIn: M + "002_content_roles_skills.sql",
      writtenBy: ["server/internal/docs/docs.go", "server/internal/upgrade/lists.go"],
      readBy: ["server/internal/docs/drafts.go", "server/internal/icons/store.go"],
      rules: [
        "A new version is `max(version) + 1` over all rows of the document, deletions included.",
        "Rows are never deleted. The one change in place is `upgrade.Convert` adjusting older bodies to the new lists (no new version).",
        "When a document was first published (`Store.Published`) is the first version after the last deletion whose `status` is not `draft`.",
      ],
    },
    {
      name: "working_drafts",
      purpose: "One shared working draft per process or standard: unpublished changes to a published one, or what a never-published one cannot be stored as yet.",
      columns: [
        { name: "kind", type: "text", note: "process | standard (check)" },
        { name: "id", type: "text" },
        { name: "body", type: "json", note: "need not pass the format; at most 1 MB as sent and 32 levels deep (`docs.CheckDraftBody`)" },
        { name: "base", type: "int", note: "the version of the document the draft was started from" },
        { name: "revision", type: "int check (revision > 0)", note: "grows by one with every save of the draft" },
        { name: "updated_at", type: "timestamptz" },
        { name: "updated_by", type: "text", note: "email of whoever saved it last" },
        { name: "updated_by_name", type: "text not null default ''", note: "their name from the sign-in; migration 009" },
      ],
      keys: ["`primary key (kind, id)`: one draft per document", "`foreign key (kind, id) references documents on delete cascade`"],
      createdIn: M + "007_working_drafts.sql",
      writtenBy: ["server/internal/docs/drafts.go", "server/internal/docs/docs.go", "server/internal/upgrade/lists.go"],
      rules: [
        "Never read by the index, the skills, exports, the history, counts or the MCP server.",
        "Leaves the table only through `docs.SaveIn` (`PublishDraft`, `ReplaceDraft`), `DiscardDraft`, or the cascade of a deleted document.",
      ],
    },
    {
      name: "audit_log",
      purpose: "The activity log (Admin › Activity): one row per action somebody took.",
      columns: [
        { name: "id", type: "bigserial primary key" },
        { name: "at", type: "timestamptz" },
        { name: "actor_email", type: "text" },
        { name: "actor_name", type: "text" },
        { name: "action", type: "text", note: "e.g. `process.save`, `process.publish`, `process.discard`, `content.convert`" },
        { name: "target", type: "text", note: "the id it is about" },
        { name: "detail", type: "text not null default ''", note: "e.g. version 4: note; the changes were last saved by …" },
      ],
      keys: ["`audit_log_at`: index on `(at desc)`", "`audit_log_actor`: index on `(actor_email, id desc)`, migration 008: the names in Admin › Access"],
      createdIn: M + "002_content_roles_skills.sql",
      writtenBy: ["server/internal/audit/audit.go"],
      readBy: ["server/internal/httpapi/users.go"],
      rules: ["A person's save writes its entry inside the save's transaction (`docs.Change.After`): the version and its entry are stored together or not at all. An import and the start-up conversion write one summary entry instead (`content.import`, `content.convert`; the conversion also one `access.grant` or `access.revoke` per converted role). Saving a working draft writes no entry."],
    },
    // ---------- the search index (made by retrieval, not by a migration)
    {
      name: "search_settings",
      purpose: "The one row that says with which settings the index was built and whether it is `complete`.",
      columns: [
        { name: "key", type: "int primary key default 1 check (key = 1)" },
        { name: "provider", type: "text", note: "builtin or vertex:<model>" },
        { name: "dimensions", type: "int", note: "the vector size" },
        { name: "chunks", type: "text", note: "e.g. parts=prerequisite,requirement,scope,step,summary;max=2000;layout=3;text=2" },
        { name: "built_at", type: "timestamptz" },
        { name: "complete", type: "boolean not null default false", note: "added by alter table … add column if not exists in Ensure" },
      ],
      createdIn: "server/internal/retrieval/retrieval.go",
      writtenBy: ["server/internal/retrieval/retrieval.go"],
      rules: [
        "A search answers \"not set up\" unless the row matches this program's settings and `complete` is true.",
        "`complete` is set to false while the index is rebuilt, and by a start with search by meaning off (`MarkUnused`).",
      ],
    },
    {
      name: "search_chunks",
      purpose: "One row per part (summary, step, prerequisite, requirement, scope) of every published process and standard, with its vector.",
      columns: [
        { name: "kind", type: "text" },
        { name: "doc_id", type: "text" },
        { name: "part", type: "text", note: "summary | step | prerequisite | requirement | scope" },
        { name: "item", type: "text", note: "step or requirement id; the position for a prerequisite; '' otherwise" },
        { name: "seq", type: "int", note: "0, or 1, 2… when a document has two parts with the same part and item" },
        { name: "label", type: "text", note: "what a person calls it: Step 3: Approve the monthly budget" },
        { name: "snippet", type: "text", note: "the readable text of the part, without the metadata the embedded text carries" },
        { name: "content_hash", type: "text", note: "sha256(provider, size, embedded text), first 16 bytes in hex" },
        { name: "status", type: "text", note: "active or deprecated, as written at the last sync" },
        { name: "embedding", type: "<schema>.vector(<dimensions>) not null", note: "unit length; the schema is wherever pgvector lives" },
        { name: "updated_at", type: "timestamptz" },
      ],
      keys: [
        "`primary key (kind, doc_id, part, item, seq)`",
        "`search_chunks_embedding`: hnsw index on `(embedding <schema>.vector_cosine_ops)`",
        "no foreign key: a search joins `documents` and drops what is a draft or gone",
      ],
      createdIn: "server/internal/retrieval/retrieval.go",
      writtenBy: ["server/internal/retrieval/retrieval.go"],
      readBy: ["server/internal/retrieval/retrieval.go"],
      rules: [
        "A draft, a deleted document and a working draft have no rows.",
        "All rows of one document are written in one short transaction; a search never sees half a document.",
        "Dropped and created again (empty) when the settings change and the new provider has answered.",
      ],
    },
    {
      name: "search_pending",
      purpose: "Documents whose parts still have to be brought up to date: a failed sync, a new index, or catching up.",
      columns: [
        { name: "kind", type: "text" },
        { name: "doc_id", type: "text" },
        { name: "since", type: "timestamptz" },
        { name: "reason", type: "text not null default ''", note: "the error, at most 500 characters; 'new index' or 'catching up'" },
      ],
      keys: ["`primary key (kind, doc_id)`"],
      createdIn: "server/internal/retrieval/retrieval.go",
      writtenBy: ["server/internal/retrieval/retrieval.go"],
      rules: ["Emptied by a successful sync of the document; the index is complete once it is empty (`markComplete`)."],
    },
    // ---------- generated from the content
    {
      name: "skills",
      purpose: "The registry of generated skills and review agents, one row per skill id.",
      columns: [
        { name: "id", type: "text primary key", note: "e.g. process-request-gcp-project" },
        { name: "kind", type: "text", note: "skill | review-agent (check)" },
        { name: "source_kind", type: "text", note: "process | standard (check)" },
        { name: "source_id", type: "text" },
        { name: "title", type: "text" },
        { name: "extra", type: "text not null default ''", note: "hand-written guidance, kept across versions" },
        { name: "active", type: "boolean not null default true", note: "false when the source is a draft, retired or deleted" },
        { name: "version", type: "int not null default 0" },
        { name: "updated_at", type: "timestamptz" },
      ],
      keys: ["`skills_source`: index on `(source_kind, source_id)`"],
      createdIn: M + "002_content_roles_skills.sql",
      writtenBy: ["server/internal/skills/store.go"],
      rules: [
        "The skills of one document are regenerated in one transaction under lock 7462 of `'<kind>/<id>'`, from the `documents` row as it is then (never from a working draft).",
        "A new `skill_versions` row is written only when the hash of the generated text changed; what the document no longer produces (a draft, retired or deleted) is set `active = false`, never deleted.",
      ],
    },
    {
      name: "skill_versions",
      purpose: "Every generated text of a skill, with the version of the document it came from.",
      columns: [
        { name: "skill_id", type: "text", note: "references skills (id) on delete cascade" },
        { name: "version", type: "int" },
        { name: "content", type: "text" },
        { name: "content_hash", type: "text" },
        { name: "source_version", type: "int", note: "the version of the process or standard" },
        { name: "created_at", type: "timestamptz" },
      ],
      keys: ["`primary key (skill_id, version)`"],
      createdIn: M + "002_content_roles_skills.sql",
      writtenBy: ["server/internal/skills/store.go"],
    },
    // ---------- people and their rights
    {
      name: "role_assignments",
      purpose: "Who may do what: one row per person, role and scope.",
      columns: [
        { name: "email", type: "text" },
        { name: "role", type: "text", note: "admin, catalog-manager, process-editor, standards-editor, owner, platform-owner, practice-owner, platform-member, practice-member (check, widened by 004 and 011)" },
        { name: "scope", type: "text not null default ''", note: "the team, platform or practice id the role is limited to; '' for none" },
        { name: "granted_by", type: "text" },
        { name: "granted_at", type: "timestamptz" },
      ],
      keys: ["`primary key (email, role, scope)`"],
      createdIn: M + "002_content_roles_skills.sql",
      writtenBy: ["server/internal/rbac/rbac.go", "server/internal/upgrade/lists.go"],
      rules: ["The check of `role` is replaced by each migration that adds roles (004, 011): a role outside the list cannot be stored."],
    },
    {
      name: "signed_out",
      purpose: "When each person last signed out: sessions issued before that moment no longer count.",
      columns: [
        { name: "email", type: "text primary key" },
        { name: "at", type: "timestamptz" },
      ],
      createdIn: M + "003_version_notes_sessions.sql",
      writtenBy: ["server/internal/auth/signout.go"],
    },
    {
      name: "viewing_as",
      purpose: "An admin viewing the portal as somebody else: one row per session of the admin, named by the session's id in the cookie (`sid`).",
      columns: [
        { name: "email", type: "text not null", note: "the admin" },
        { name: "session", type: "text not null", note: "which session of the admin (`auth.Session.ID`)" },
        { name: "target", type: "text not null", note: "the person whose view it is (or `reader@no-roles.invalid`)" },
        { name: "target_name", type: "text not null default ''" },
        { name: "started_at", type: "timestamptz not null" },
        { name: "until", type: "timestamptz not null", note: "started_at + one hour (`auth.ViewAsFor`)" },
      ],
      keys: ["primary key (email, session): one viewing per session, never nested"],
      createdIn: M + "013_viewing_as.sql",
      writtenBy: ["server/internal/auth/viewas.go"],
      readBy: ["server/internal/httpapi/viewas.go"],
      rules: [
        "A row only ever takes rights away: while it is there, that session reads as the target and changes nothing.",
        "Deleted when the admin stops or signs out (every session of theirs), when a request finds it past `until` or the admin no longer an admin; rows a day past `until` are dropped at the next start of a viewing.",
      ],
    },
    // ---------- what people say: feedback and requests
    {
      name: "feedback",
      purpose: "Feedback on a process or standard, or on one step or requirement of it, from the portal or an agent's `report_problem`.",
      columns: [
        { name: "id", type: "uuid primary key default gen_random_uuid()" },
        { name: "target_id", type: "text", note: "the document id; was `process_id` until migration 002" },
        { name: "target_kind", type: "text not null default 'process'", note: "process | standard (check); migration 002" },
        { name: "step_id", type: "text", note: "the step or requirement id, null for the whole document" },
        { name: "kind", type: "text", note: "broken | outdated | unclear | idea (check)" },
        { name: "body", type: "text" },
        { name: "author_email", type: "text" },
        { name: "author_name", type: "text" },
        { name: "step_hash", type: "text", note: "`docs.Fingerprint` of the step when it was written: shows that the step changed since" },
        { name: "created_at", type: "timestamptz" },
        { name: "resolved_at", type: "timestamptz" },
        { name: "resolved_by", type: "text" },
      ],
      keys: ["`feedback_target`: index on `(target_kind, target_id)`"],
      createdIn: M + "001_feedback.sql",
      writtenBy: ["server/internal/feedback/store.go"],
      rules: [
        "Deleted with its document (`feedback.DeleteByTargetIn` in the delete's transaction).",
        "Inserted only while the document exists (its `documents` row is read `for share` in the same transaction); at most 30 per person and hour (`feedback.Report`, under lock 7465 of the person), counted over the portal and the MCP server together.",
      ],
    },
    {
      name: "feedback_also_hit",
      purpose: "\"I hit this as well\": one row per person per feedback item.",
      columns: [
        { name: "feedback_id", type: "uuid", note: "references feedback (id) on delete cascade" },
        { name: "email", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
      keys: ["`primary key (feedback_id, email)`"],
      createdIn: M + "001_feedback.sql",
      writtenBy: ["server/internal/feedback/store.go"],
    },
    {
      name: "requests",
      purpose: "Requests for a process or standard that does not exist yet, with their state.",
      columns: [
        { name: "id", type: "bigserial primary key" },
        { name: "kind", type: "text", note: "process | standard" },
        { name: "title", type: "text" },
        { name: "description", type: "text" },
        { name: "platform", type: "text not null default ''", note: "an id, without a foreign key" },
        { name: "practice", type: "text not null default ''", note: "an id, without a foreign key" },
        { name: "requested_by_email", type: "text" },
        { name: "requested_by_name", type: "text" },
        { name: "created_at", type: "timestamptz" },
        { name: "state", type: "text default 'open'", note: "open | planned | done | declined (check)" },
        { name: "state_note", type: "text" },
        { name: "state_by", type: "text" },
        { name: "state_at", type: "timestamptz" },
        { name: "linked_id", type: "text not null default ''", note: "the document that answered it" },
        { name: "linked_gone", type: "boolean not null default false", note: "the answer was deleted; migration 006" },
      ],
      keys: ["`requests_created`: index on `(created_at desc)`", "`requests_requester`: index on `(requested_by_email, created_at)`"],
      createdIn: M + "005_engagement_requests.sql",
      writtenBy: ["server/internal/requests/store.go", "server/cmd/server/seed.go"],
      rules: ["Deleting the answering document clears `linked_id` and sets `linked_gone` (`requests.AnswerGoneIn`) in the delete's transaction."],
    },
    {
      name: "request_votes",
      purpose: "One vote per person and request.",
      columns: [
        { name: "request_id", type: "bigint", note: "references requests (id) on delete cascade" },
        { name: "email", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
      keys: ["`primary key (request_id, email)`"],
      createdIn: M + "005_engagement_requests.sql",
      writtenBy: ["server/internal/requests/store.go"],
    },
    {
      name: "requests_removed",
      purpose: "Requests that were withdrawn or removed, kept only so the hourly brake still counts them.",
      columns: [
        { name: "email", type: "text" },
        { name: "created_at", type: "timestamptz", note: "when the request was made" },
      ],
      keys: ["`requests_removed_email`: index on `(email, created_at)`"],
      createdIn: M + "006_counts_and_limits.sql",
      writtenBy: ["server/internal/requests/store.go"],
      rules: ["Rows of requests made more than a day ago are deleted whenever another removal is written: the brake only looks at the last hour."],
    },
    // ---------- use: views, counts, bookmarks, upvotes, downloads
    {
      name: "document_views",
      purpose: "Views: one row per person, document and day (UTC), only to count views and different people.",
      columns: [
        { name: "kind", type: "text", note: "process | standard" },
        { name: "id", type: "text", note: "<id>@deleted-<n> once the document was deleted" },
        { name: "day", type: "date" },
        { name: "email", type: "text" },
      ],
      keys: ["`primary key (kind, id, email, day)` since migration 006", "`document_views_day`: index on `(day, kind, id, email)`"],
      createdIn: M + "005_engagement_requests.sql",
      writtenBy: ["server/internal/engagement/store.go", "server/cmd/server/seed.go"],
      rules: ["Kept when the document is deleted, with its id marked, so the totals of a period do not change and a new document under the same id starts from nothing."],
    },
    {
      name: "document_counts",
      purpose: "All-time views, people and downloads per process and standard, kept up to date in the transaction that records a view or a download.",
      columns: [
        { name: "kind", type: "text" },
        { name: "id", type: "text" },
        { name: "views", type: "int not null default 0" },
        { name: "people", type: "int not null default 0" },
        { name: "downloads", type: "int not null default 0" },
      ],
      keys: ["`primary key (kind, id)`"],
      createdIn: M + "006_counts_and_limits.sql",
      writtenBy: ["server/internal/engagement/store.go", "server/cmd/server/seed.go"],
      rules: ["Filled from `document_views` and `skill_downloads` when the migration ran; deleted with the document (`engagement.DeleteByTargetIn`)."],
    },
    {
      name: "bookmarks",
      purpose: "One bookmark per person and document. `upvotes` has exactly the same shape.",
      columns: [
        { name: "email", type: "text" },
        { name: "kind", type: "text", note: "process | standard" },
        { name: "id", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
      keys: ["`primary key (email, kind, id)`", "`bookmarks_target`: index on `(kind, id)`"],
      createdIn: M + "005_engagement_requests.sql",
      writtenBy: ["server/internal/engagement/store.go", "server/cmd/server/seed.go"],
      rules: ["Deleted with the document, in the transaction of the delete."],
    },
    {
      name: "upvotes",
      purpose: "One upvote per person and document; the same columns and keys as `bookmarks`.",
      columns: [
        { name: "email", type: "text" },
        { name: "kind", type: "text" },
        { name: "id", type: "text" },
        { name: "created_at", type: "timestamptz" },
      ],
      keys: ["`primary key (email, kind, id)`", "`upvotes_target`: index on `(kind, id)`"],
      createdIn: M + "005_engagement_requests.sql",
      writtenBy: ["server/internal/engagement/store.go", "server/cmd/server/seed.go"],
    },
    {
      name: "skill_downloads",
      purpose: "One row per counted skill download from the portal and per skill written by an export.",
      columns: [
        { name: "id", type: "bigserial primary key" },
        { name: "skill_id", type: "text" },
        { name: "source_kind", type: "text", note: "process | standard" },
        { name: "source_id", type: "text", note: "marked <id>@deleted-<n> when the document is deleted" },
        { name: "via", type: "text", note: "download | export (check)" },
        { name: "at", type: "timestamptz" },
        { name: "email", type: "text not null default ''", note: "only to count once a day; '' for exports; migration 006" },
        { name: "day", type: "date not null", note: "filled from at by migration 006" },
      ],
      keys: [
        "`skill_downloads_source`: index on `(source_kind, source_id)`; `skill_downloads_day`: index on `(day)`",
        "`skill_downloads_once_a_day`: unique `(skill_id, email, day) where via = 'download' and email <> ''`",
      ],
      createdIn: M + "005_engagement_requests.sql",
      writtenBy: ["server/internal/engagement/store.go"],
    },
    // ---------- the look
    {
      name: "icons",
      purpose: "Icons of tools and languages (and the logo), stored once under the SHA-256 of their bytes.",
      columns: [
        { name: "id", type: "text primary key check (id ~ '^[a-f0-9]{64}$')" },
        { name: "content_type", type: "text", note: "image/png, image/jpeg, image/webp or image/svg+xml (check)" },
        { name: "width", type: "int check (width > 0)" },
        { name: "height", type: "int check (height > 0)" },
        { name: "data", type: "bytea check (octet_length(data) between 1 and 65536)" },
        { name: "created_by", type: "text not null default ''" },
        { name: "created_at", type: "timestamptz" },
      ],
      createdIn: M + "008_icons.sql",
      writtenBy: ["server/internal/icons/store.go"],
      rules: ["Removed at start (`icons.Clean`) only when uploaded more than 24 hours ago and named by no version of the lists, not by the lists now and not by `portal_settings` (the logo)."],
    },
    {
      name: "portal_settings",
      purpose: "Settings admins change in the portal; today only the theme.",
      columns: [
        { name: "key", type: "text primary key check (key in ('theme'))" },
        { name: "value", type: "jsonb", note: "only what the admin chose; the colours are worked out by the app" },
        { name: "revision", type: "int check (revision > 0)", note: "a save says which revision it was made from" },
        { name: "updated_by", type: "text not null default ''" },
        { name: "updated_by_name", type: "text not null default ''" },
        { name: "updated_at", type: "timestamptz" },
      ],
      createdIn: M + "010_portal_settings.sql",
      writtenBy: ["server/internal/theme/theme.go"],
    },
    // ---------- bookkeeping
    {
      name: "schema_migrations",
      purpose: "Which migration files have run: one row per file number.",
      columns: [
        { name: "version", type: "int primary key", note: "the number the file name starts with" },
        { name: "applied_at", type: "timestamptz not null default now()" },
      ],
      createdIn: "server/internal/db/db.go",
      writtenBy: ["server/internal/db/db.go"],
      rules: ["Created with `create table if not exists` by `db.migrate`, not by a migration file."],
    },
  ],
  examples: [
    {
      title: "One process through its tables",
      caption: "The sample `request-gcp-project` imported, a member saving unpublished changes, and an owner publishing them: the real rows (dates shortened).",
      stages: [
        {
          label: "The file in the sample content",
          where: "processes/request-gcp-project.json",
          shape: `{
  "$schema": "../schema/process.schema.json",
  "schemaVersion": "1.0",
  "id": "request-gcp-project",
  "title": "Request a GCP project",
  "summary": "Get a new Google Cloud project created by the project factory, …",
  "owner": "cloud-platform-team",
  "category": "cloud",
  "platform": "google-cloud",
  "rigour": "mandatory",
  "estimatedDuration": "3-5 working days",
  "status": "active",
  "review": { "intervalMonths": 6, "lastReviewedAt": "2026-11-03", … },
  "prerequisites": [ … 4 ], "actors": [ … 4 ], "steps": [ … 10 ]
}`,
        },
        {
          label: "Stored in `documents`",
          where: "server/internal/docs/docs.go",
          shape: `kind       | process
id         | request-gcp-project
version    | 1
body       | {"$schema": …, "id": "request-gcp-project", …}   (json, 7089 bytes, keys in file order)
updated_by | import
updated_at | 2026-11-22 14:04:20
created_at | 2026-11-22 14:04:20
status     | active                 ← generated from body->>'status'
owner      | cloud-platform-team    ← generated
platform   | google-cloud           ← generated
practice   |                        ← generated ('' when absent)`,
          note: "`docs.Store.ImportDir` → `Put` → `SaveIn`: no `base` (imports are not checked), re-indented, version 1.",
        },
        {
          label: "Its first row of `document_versions`",
          shape: `{"kind":"process","id":"request-gcp-project","version":1,
 "saved_at":"2026-11-22T14:04:20","saved_by":"import","note":"",
 "changes_by":"","changes_by_name":"","deleted":false}`,
          note: "Same transaction as the `documents` row. `deleted` is `body is null`.",
        },
        {
          label: "A member saves unpublished changes: `working_drafts`",
          where: "server/internal/docs/drafts.go",
          shape: `PUT /api/processes/request-gcp-project/draft?rev=0
{"kind":"process","id":"request-gcp-project","base":1,"revision":1,
 "updated_by":"morgan@example.com","updated_by_name":"Morgan Member",
 "body":"{\\n  \\"$schema\\": …  \\"estimatedDuration\\": \\"2-4 working days\\" …"}`,
          note: "`documents` and `document_versions` are untouched; readers, skills and the index still see version 1.",
        },
        {
          label: "An owner publishes it: `document_versions` gets version 2",
          where: "server/internal/httpapi/drafts.go",
          shape: `POST /api/processes/request-gcp-project/publish?rev=1&note=Shorter+lead+time
{"kind":"process","id":"request-gcp-project","version":2,
 "saved_by":"alex@example.com","note":"Shorter lead time",
 "changes_by":"morgan@example.com","changes_by_name":"Morgan Member","deleted":false}

select count(*) from working_drafts;   → 0`,
          note: "One transaction: `documents` updated to version 2, the version row with `changes_by`, the `audit_log` entry `process.publish`, the working draft deleted.",
        },
        {
          label: "A save still made from version 1 is refused",
          shape: `PUT /api/processes/request-gcp-project?base=1
→ docs.Conflict: "the document was changed in the meantime: it is now at version 2"
→ 409 {"error": "alex@example.com saved a newer version (version 2) while you were working on this.",
       "conflict": {"exists": true, "version": 2, "status": "active", …}}`,
          note: "Nothing is written.",
        },
      ],
    },
  ],
  files: [
    {
      path: "server/internal/db/db.go",
      role: "Applies the embedded migration files in order under a database lock, records them in `schema_migrations`, and says whether a database is current.",
      requirements: [
        { text: "A server waiting for a lock gives its connection back between tries (every 50 ms). Holding it would starve the pool that the work behind the lock needs, and several servers starting together could block each other (`TestWithLockLetsOneInAtATime`).", at: "case <-time.After(50 * time.Millisecond):" },
        { text: "The lock is released on a context that cannot be cancelled: a session lock left on a pooled connection would block every later start until that connection closes.", at: "select pg_advisory_unlock($1)" },
        { text: "Whether a file has run is asked inside the same transaction that runs it and records its number, so a file that fails leaves neither its changes nor its row, and the next start runs it again.", at: "select exists (select 1 from schema_migrations where version = $1)" },
        { text: "The content conversions run after the files and before the lock is released, and a starting server serves only after both: no server of this version saves content in the old shape. A server of the old version that is still running is held off by the conversion's own lock of `documents` (`upgrade/lists.go`), not by this one.", at: "for _, step := range after {" },
        { text: "`Current` only compares the newest number recorded with the newest file this program has (not every number): a program that must not migrate refuses to start with `ErrBehind`.", at: "if have < Latest() {" },
      ],
      tests: ["server/internal/db/db_test.go", "server/internal/db/counts_test.go"],
    },
    {
      path: "server/internal/db/dbtest/dbtest.go",
      role: "Gives every database test a fresh, migrated schema of its own in a real Postgres (`TEST_DATABASE_URL`).",
      requirements: [
        { text: "Without a database the test is skipped locally but fails in CI (`CI` set), so a green CI run always includes the database tests.", at: "if os.Getenv(\"CI\") != \"\" {" },
      ],
    },
    {
      path: M + "001_feedback.sql",
      role: "Creates `feedback` and `feedback_also_hit`. Undo: drop both tables (the feedback is lost).",
      requirements: [{ text: "`step_hash` keeps `docs.Fingerprint` of the step when the feedback was written, so the owner can see that the step changed since.", at: "step_hash    text," }],
    },
    {
      path: M + "002_content_roles_skills.sql",
      role: "Renames `feedback.process_id` to `target_id` and adds `target_kind`; creates `documents`, `document_versions`, `role_assignments`, `audit_log`, `skills` and `skill_versions`. Undo only by dropping the content tables: everything stored is lost.",
      requirements: [
        { text: "`body` is `json`, not `jsonb`: `jsonb` would sort the keys and the author's order (shown in the JSON view and exports) would be lost.", at: "create table documents (" },
        { text: "`body` of `document_versions` may be null: that row records a deletion, and the numbering continues over it.", at: "create table document_versions (" },
      ],
    },
    {
      path: M + "003_version_notes_sessions.sql",
      role: "Adds `document_versions.note` and creates `signed_out`. Undo: drop the column and the table (notes and sign-outs are lost).",
      requirements: [{ text: "Every version may carry a note (at most 300 characters, cut by `docs.SaveIn`); versions stored before get ''.", at: "alter table document_versions add column note" }],
    },
    {
      path: M + "004_platform_practice_owners.sql",
      role: "Widens the role check of `role_assignments` by `platform-owner` and `practice-owner`. Undo: only after deleting the rows with those roles.",
      requirements: [{ text: "The role check is dropped and created again with the longer list: the database itself refuses a role the server does not know.", at: "alter table role_assignments drop constraint role_assignments_role_check;" }],
    },
    {
      path: M + "005_engagement_requests.sql",
      role: "Creates `document_views`, `bookmarks`, `upvotes`, `skill_downloads`, `requests` and `request_votes`. Undo: drop them (all use and requests are lost).",
      requirements: [
        { text: "Views are one row per person, document and day; they stay after a delete with the id marked, so the totals of a period never change afterwards.", at: "create table document_views (" },
        { text: "`platform`, `practice` and `linked_id` of a request are ids without a foreign key: a request outlives what it names.", at: "create table requests (" },
      ],
    },
    {
      path: M + "006_counts_and_limits.sql",
      role: "Adds the generated columns `status`, `owner`, `platform`, `practice` to `documents` with the index of drafts; re-keys `document_views`; adds `email` and `day` to `skill_downloads` with a once-a-day unique index; creates and fills `document_counts`; adds `requests.linked_gone` and `requests_removed`. Undo: possible by hand, but `day` was filled and the counts were computed from the rows.",
      requirements: [
        { text: "The columns are generated by the database from the body on every write: no code has to keep them in step, and they cannot disagree with the body.", at: "alter table documents add column status   text generated always as (coalesce(body->>'status', '')) stored;" },
        { text: "A download counts once per person, skill and day; exports (no person) are not limited by this index.", at: "create unique index skill_downloads_once_a_day" },
        { text: "The all-time counts are filled once from what was recorded, leaving out marked (deleted) ids.", at: "insert into document_counts (kind, id, views, people)" },
      ],
    },
    {
      path: M + "007_working_drafts.sql",
      role: "Creates `working_drafts` and adds `documents.created_at`, filled from the first version since the last deletion. Undo: drop both (unpublished changes are lost).",
      requirements: [
        { text: "A working draft goes with its document by the database itself: no delete can leave a draft that would come back under a new document of the same id.", at: "foreign key (kind, id) references documents (kind, id) on delete cascade" },
        { text: "`revision` is always above 0: 0 is what the API's `rev=0` means (\"I am starting one\").", at: "revision   int  not null check (revision > 0)," },
      ],
    },
    {
      path: M + "008_icons.sql",
      role: "Creates `icons` and the index `audit_log_actor`. Undo: drop both (uploaded icons are lost).",
      requirements: [{ text: "The database itself refuses an id that is not a SHA-256 in hex, an unknown type and more than 64 KB, whatever the code checks before.", at: "id           text primary key check (id ~ '^[a-f0-9]{64}$')," }],
    },
    {
      path: M + "009_draft_names.sql",
      role: "Adds `working_drafts.updated_by_name`. Undo: drop the column.",
      requirements: [{ text: "'' when the sign-in gave no name: the app then shows the email.", at: "alter table working_drafts add column updated_by_name" }],
    },
    {
      path: M + "010_portal_settings.sql",
      role: "Creates `portal_settings` (today only the theme). Undo: drop it (the portal falls back to the default look).",
      requirements: [{ text: "Only the key `theme` is allowed: a new setting needs a migration of its own.", at: "key             text primary key check (key in ('theme'))," }],
    },
    {
      path: M + "011_platform_practice_members.sql",
      role: "Widens the role check by `platform-member` and `practice-member`. Undo: only after deleting the rows with those roles.",
      requirements: [{ text: "Members of a platform or practice may be stored; what they may do (draft, never publish) is decided in `rbac`, not here.", at: "'platform-member', 'practice-member'" }],
    },
    {
      path: M + "012_version_changes_by.sql",
      role: "Adds `document_versions.changes_by` and `changes_by_name`. Undo: drop the columns. The only migration written with `if not exists`.",
      requirements: [{ text: "Empty for every version that did not publish somebody else's changes, also for the ones stored before: the history then names only `saved_by`.", at: "alter table document_versions add column if not exists changes_by text not null default '';" }],
    },
    {
      path: M + "013_viewing_as.sql",
      role: "Creates `viewing_as` (an admin viewing the portal as somebody else, per session). Undo: drop it; every viewing in progress then simply ends.",
      requirements: [{ text: "Keyed by the admin and the session, so the state lives on the server with that one session, never in anything the browser could alter; `if not exists`, so it is safe to run twice.", at: "create table if not exists viewing_as (" }],
    },
    {
      path: "server/internal/retrieval/retrieval.go",
      role: "Creates the three tables of the search index itself (not a migration) and writes them.",
      requirements: [
        { text: "The vector column is written with the extension's schema, found in `pg_extension`: on a database where pgvector lives outside the search path (here: `extensions`) an unqualified `vector` would not be found.", at: "embedding %s.vector(%d) not null," },
        { text: "Only one settings row can exist, so two servers cannot each record their own settings for the one index.", at: "key int primary key default 1 check (key = 1)," },
      ],
      tests: ["server/internal/retrieval/retrieval_test.go"],
    },
    {
      path: "server/internal/docs/docs.go",
      role: "The only code that adds or removes rows of `documents` and `document_versions` (the conversion in `upgrade/lists.go` only adjusts older bodies in place).",
      requirements: [
        { text: "The current version is an upsert and the version row an insert in the same transaction: the two tables never disagree about the newest version.", at: "on conflict (kind, id) do update set version = excluded.version, body = excluded.body, updated_by = excluded.updated_by, updated_at = now()" },
        { text: "A delete records a version with a null body numbered after the last one, so the history shows the deletion and a new document of the same id goes on counting.", at: "select $1, $2, coalesce(max(version), 0) + 1, null, $3 from document_versions where kind = $1 and id = $2" },
      ],
      tests: ["server/internal/docs/docs_test.go"],
    },
  ],
  start: "server/internal/db/db.go",
};
