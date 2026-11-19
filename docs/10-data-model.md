# 10 · Data model

PostgreSQL 17, accessed with SQLAlchemy Core (async, `asyncpg`). Migrations use Alembic (`backend/alembic/`) and run at boot (`alembic upgrade head`). **Depends on:** [01](01-glossary.md), [19](19-reports-dashboard-notifications.md).

**Status:** Implemented (S1): every table below is in `backend/db/tables.py` and the initial migration `backend/alembic/versions/0001_initial_schema.py`, which boot step 2 applies ([16](16-configuration-and-deployment.md#boot-sequence-api-lifespan)). The invariants the database enforces are marked below; the others come with the sections that own them.

## Two sources of truth

| Store | Holds |
|---|---|
| Agent folder (`/data/folders`) | prompts, memory, skills, helpers, routine definitions, packages, credential links, files, git history |
| Postgres `contoso` | users and sessions, agents, epochs, events, threads, messages, deliveries, tasks, jev decisions, routine runtime state, catalogs, jobs; reports, datasets, user notifications and preferences ([19](19-reports-dashboard-notifications.md)) |
| `/data/reports` | published report artifacts, one directory per version |

Neither copies the other. Where the DB needs something from a folder, such as routine schedules, it caches it and re-syncs from the folder.

## Conventions

- **Ids.** Ids are `uuid` (generated with `gen_random_uuid()`), except where an ordered `bigint` identity is needed (`events`, `messages`, `deliveries`, `global_tasks`).
- **Timestamps** are `timestamptz`, default `now()`.
- **Enums** are `text` columns with `CHECK` constraints, so adding a value is a one-line migration.
- **JSON** is `jsonb`.
- **Nullability.** A column is `NOT NULL` unless its notes say "null".
- **Defaults.** `bool` columns default to `false`, counters to `0`, the id and tag arrays (`project_ids`, `market_ids`, `tags`) to `'{}'`, and `users.display_name`, `agents.description`, `agent_epochs.summary` and `jobs.output` to `''`. Status and kind columns have no default: the code always names the state.
- **Constraint names** are fixed, so code can map a violation to an API error: `pk_<table>`, `fk_<table>_<columns>`, `uq_<table>_<columns>`, `ck_<table>_<column>` for enum checks and `ck_<table>_<rule>` for others. Partial unique indexes are named after their rule, such as `uq_global_tasks_one_running_per_user`.

## Tables

### `domains`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `fabrikam` |
| `name` | text | display name |
| `status` | text | `available` \| `unavailable` |
| `status_reason` | text null | key names or file names only |
| `synced_at` | timestamptz | |

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `username` | text UNIQUE | `^[a-z0-9._-]{3,32}$`, stored lower-case |
| `display_name` | text | at most 100 characters, default `''` (an account created without one); empty means "show the username". The settings form requires 1–100 ([14b](14b-frontend-pages.md)) |
| `password_hash` | text | argon2id |
| `role` | text | `user` \| `admin` |
| `domain_id` | text FK null | `CHECK ((role='admin') = (domain_id IS NULL))` |
| `status` | text | `provisioning` \| `active` \| `failed` \| `disabled` |
| `status_detail` | text null | the failing provisioning step |
| `created_at` | timestamptz | |

### `auth_sessions`
| Column | Type | Notes |
|---|---|---|
| `token_hash` | bytea PK | SHA-256 of the 32-byte cookie token (`CHECK` 32 bytes) |
| `user_id` | uuid FK | `ON DELETE CASCADE` |
| `created_at`, `last_seen_at`, `expires_at` | timestamptz | sliding 7-day expiry |

### `agents`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `slug` | text | `^[a-z0-9][a-z0-9-]{1,31}$` ([04](04-agent-folder.md)); `UNIQUE (user_id, slug)`, deleted agents included |
| `display_name`, `description` | text | |
| `avatar` | jsonb | `{"emoji": "📊", "color": "#16A34A"}` |
| `origin` | text | `lead` \| `starter` \| `custom` |
| `is_lead` | bool | `UNIQUE (user_id) WHERE is_lead` |
| `state` | text | `active` \| `deleted` |
| `status` | text | `idle` \| `busy` \| `routine` \| `compacting` |
| `status_detail` | text null | routine name |
| `compaction_pending` | bool | |
| `compaction_failures` | int | resets on success |
| `baseline_commit` | text | used by reset |
| `created_at` | timestamptz | |

The folder path is derived: `/data/folders/<user_id>/<slug>`.

### `agent_epochs`
| Column | Type | Notes |
|---|---|---|
| `agent_id` | uuid FK | PK (`agent_id`, `epoch`) |
| `epoch` | int | starts at 0 |
| `start_seq` | bigint | context = events with `seq > start_seq` |
| `system_prompt` | text | rendered once ([06](06-context-and-compaction.md#system-prompt)) |
| `summary` | text | empty string allowed |
| `reason` | text | `initial` \| `compaction` \| `reset` \| `truncated` |
| `created_at` | timestamptz | |

### `events`
| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | |
| `agent_id` | uuid FK | |
| `seq` | bigint | `UNIQUE (agent_id, seq)`; per agent, gap-free |
| `epoch` | int | |
| `kind` | text | `input` \| `assistant` \| `tool_result` \| `error` |
| `payload` | jsonb | see below |
| `trace_id` | char(32) | activation trace |
| `activation_kind` | text | `message` \| `routine` \| `compaction` \| `task` |
| `task_id` | bigint FK null | running task, if any |
| `created_at` | timestamptz | |

Payloads:

```jsonc
// input
{"text": "<exactly what the model saw>", "items": [{"type": "notification", "delivery_id": 981, "message_id": 5521},
  {"type": "notice", "delivery_id": 990, "kind": "builder"}, {"type": "routine", "name": "bao-cao-sang"},
  {"type": "begin_task", "task_id": 42}, {"type": "compaction"}]}
// assistant
{"text": "...", "tool_calls": [{"id": "call_1", "code": "..."}], "model": "anthropic/claude-haiku-4.5",
 "usage": {"prompt_tokens": 12034, "completion_tokens": 311, "cached_tokens": 11520, "cost": 0.0041}, "latency_ms": 2140}
// tool_result
{"tool_call_id": "call_1", "exec_id": "x_01J…", "text": "<as sent>", "exit_code": 0, "duration_ms": 1400,
 "timed_out": false, "truncated": false, "offload_path": ".contoso/outputs/x_01J….txt", "head": "3f2c…",
 "changed": [{"path": "memory/preferences.md", "status": "M"}], "snapshot_error": null, "final": false,
 "batch_offloaded_at": null, "system": false}
// error
{"code": "step_limit|model_unavailable|context_overflow|batch_offload|compaction_truncated|restart", "text": "..."}
```

### `threads` and `thread_members`
| `threads` column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | owner |
| `kind` | text | `direct` \| `group` \| `agent` |
| `name` | text null | groups only |
| `member_key` | text null | sorted slugs joined with `+`; `UNIQUE (user_id, kind, member_key)` for `direct` and `agent` |
| `read_only` | bool | direct thread of a deleted agent |
| `last_message_at` | timestamptz | ordering in the chat list |

| `thread_members` column | Type | Notes |
|---|---|---|
| `thread_id` | uuid FK | PK (`thread_id`, `member_type`, `member_id`) |
| `member_type` | text | `user` \| `agent` |
| `member_id` | uuid | |
| `last_read_message_id` | bigint null | unread badges (user member only) |

### `messages`
| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | |
| `thread_id` | uuid FK | index (`thread_id`, `id`) |
| `sender_type` | text | `user` \| `agent` \| `system` |
| `sender_id` | uuid null | null exactly for `system` (`CHECK`) |
| `content` | jsonb | `{"text", "choices": [{id,label}], "reply_to", "choice_id", "report_refs": [{report_id, version_id, title}]}` |
| `trace_id` | char(32) null | activation that sent it (agents), or the `user_message` trace |
| `exec_id` | text null | |
| `created_at` | timestamptz | |

### `attachments`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `message_id` | bigint FK | |
| `filename`, `mime` | text | |
| `size` | bigint | |
| `sha256` | char(64) | |
| `path` | text | `/data/attachments/<message_id>/<filename>` |

### `telegram_links`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK, FK (`ON DELETE CASCADE`) | one Telegram chat per user |
| `chat_id` | bigint | `UNIQUE` |
| `linked_at` | timestamptz | |

### `telegram_link_codes`
One-time, short-lived codes for `/start <code>` account linking (see the Telegram integration plan).

| Column | Type | Notes |
|---|---|---|
| `code` | text PK | `secrets.token_urlsafe` |
| `user_id` | uuid FK (`ON DELETE CASCADE`) | index (`user_id`) |
| `expires_at` | timestamptz | ~10 minutes after creation |
| `created_at` | timestamptz | |

### `deliveries`
| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | |
| `agent_id` | uuid FK | receiver |
| `message_id` | bigint FK null | |
| `notice` | jsonb null | `{"kind": "builder\|presence\|restart\|task_cancelled\|task_timeout\|routine_invalid\|task_resume", "text": "..."}`; `CHECK ((message_id IS NULL) <> (notice IS NULL))` |
| `route` | text | `notification` \| `jev` |
| `status` | text | `classifying` (jev running; lead deliveries only) \| `pending` \| `consumed` |
| `consumed_seq` | bigint null | `input` event that consumed it: FK (`agent_id`, `consumed_seq`) → `events (agent_id, seq)`, deferred to commit; set only when `status='consumed'` (a jev-labelled task consumes its delivery without one) |
| `created_at` | timestamptz | index (`agent_id`) `WHERE status='pending'` |

### `global_tasks`
| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | shown as `T<id>` |
| `user_id` | uuid FK | `UNIQUE (user_id) WHERE status='running'` |
| `source_message_id` | bigint FK null | |
| `description` | text | |
| `status` | text | `queued` \| `running` \| `done` \| `failed` \| `cancelled` |
| `outcome` | text null | |
| `ended_by` | text null | `lead` \| `user` \| `timeout` \| `harness` |
| `created_at` | timestamptz | |
| `started_at`, `ended_at` | timestamptz null | |

### `task_involvement`
`task_id` bigint FK, `agent_id` uuid FK, `first_at` timestamptz; PK (`task_id`, `agent_id`).

### `jev_decisions`
| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity PK | |
| `message_id` | bigint FK | |
| `lead_id` | uuid FK | |
| `input` | jsonb | `{state, questions}` sent to the Decisions API |
| `label` | text | `task` \| `side_question` |
| `confidence` | float null | jev's calibrated confidence (0–1); `null` on fallback |
| `fallback` | bool | |
| `model`, `latency_ms`, `trace_id` | | |
| `observed` | text null | the label the admin thinks was right |
| `observed_by` | uuid null | |
| `created_at` | timestamptz | |

### `routine_state`
`agent_id` uuid FK, `name` text (PK `agent_id`, `name`), `cron` text, `enabled` bool, `prompt_sha` char(64), `next_fire_at`, `last_fired_at`, `last_started_at`, `last_ended_at` timestamptz null, `pending` bool.

### `skill_catalog`
`id` text PK, `name` text, `title_vi` text, `description_vi` text, `tags` text[] (GIN index), `install_cmd` text[], `domain_id` text FK null, `seeded_at` timestamptz.

### `library_presets`
`id` text PK, `title_vi` text, `description_vi` text, `packages` text[], `domain_id` text FK null.

### `jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `agent_id` | uuid FK null | null for agent creation until the end |
| `kind` | text | `agent_create` \| `agent_reset` \| `skill_install` \| `skill_remove` \| `package_add` \| `package_remove` \| `preset_apply` \| `user_provision` (the provisioning job of [12](12-auth-and-domains.md#provisioning-a-user); `request` is `{domain_id}`) |
| `request` | jsonb | |
| `status` | text | `queued` \| `running` \| `done` \| `failed` |
| `output` | text | last 4 KB |
| `created_at` | timestamptz | |
| `finished_at` | timestamptz null | |

At boot, jobs left in `queued` or `running` are set to `failed` with the output "interrupted by restart".

### Workspace extension tables

These back the reports library, the business dashboard, user notifications and preferences ([19](19-reports-dashboard-notifications.md)).

#### `reports`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | owner |
| `code` | text | `R<n>` (`^R[0-9]+$`), numbered per user; `UNIQUE (user_id, code)`; the id the API and URLs use |
| `title`, `type` | text | `type` matches `^[a-z][a-z0-9-]{0,79}$` |
| `project_ids`, `market_ids` | text[] | |
| `agent_id` | uuid FK | agent that started it |
| `created_at` | timestamptz | |

#### `report_attempts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid FK | |
| `agent_id` | uuid FK | |
| `task_id` | bigint FK null | running global task at start |
| `state` | text | `queued` \| `running` \| `succeeded` \| `failed` |
| `reason` | text null | `task_ended`, `timeout` or the agent's reason |
| `version_id` | uuid FK null | set on success |
| `created_at` | timestamptz | |
| `finished_at` | timestamptz null | |

#### `report_versions`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid FK | |
| `sequence` | int | `UNIQUE (report_id, sequence)`; the API id is `<code>-v<sequence>` |
| `schema` | jsonb | validated report schema v1 |
| `source` | jsonb | `{id, label, dataThrough, completeness}` |
| `policy_version`, `content_revision` | text | |
| `trace_id` | char(32) | activation that published it |
| `completed_at` | timestamptz | |

Rows are never updated or deleted ([19](19-reports-dashboard-notifications.md#principles)); see invariant 8.

#### `report_artifacts` and `report_evidence`
`report_artifacts`: `id` uuid PK, `version_id` uuid FK, `filename`, `mime` text, `size` bigint, `sha256` char(64), `path` text (`/data/reports/<version_id>/<filename>`).

`report_evidence`: `version_id` uuid FK, `id` text (PK `version_id`, `id`), `label`, `source_id` text, `project_ids` text[], `snapshot_id` text null, `data_through` timestamptz, `limitation` text.

#### `datasets`
`id` uuid PK, `user_id` uuid FK, `kind` text (`dashboard`), `payload` jsonb, `agent_id` uuid FK, `published_at` timestamptz. The five newest per (`user_id`, `kind`) are kept.

#### `user_notifications`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | index (`user_id`, `occurred_at` DESC) |
| `kind` | text | `account-created` \| `system` \| `report-ready` \| `task-failed` \| `action-required` |
| `title`, `summary` | jsonb | `{"vi": "...", "en": "..."}` |
| `target` | jsonb | `{kind: chat, conversationId}` (the thread id, named as in the frontend `NotificationTarget`) \| `{kind: report, reportId, versionId?}` \| `{kind: account}` \| `{kind: system-detail, notificationId}` (its own id) |
| `occurred_at` | timestamptz | |
| `read_at` | timestamptz null | |

#### `user_preferences`
`user_id` uuid PK FK, `value` jsonb (the frontend `Preferences` without `displayName`), `updated_at` timestamptz.

## Invariants

Each one is covered by a test ([17](17-testing.md)). The database enforces 1, 3, 8, 9 and part of 6 (`backend/tests/db/test_invariants.py`); the code of later sections enforces the rest.

1. **`events` is append-only.** The one exception is batch offload, which rewrites `payload.text` of older `tool_result` rows and sets `batch_offloaded_at` ([06](06-context-and-compaction.md#offloading-large-outputs)). *DB:* the trigger `events_append_only` rejects every `UPDATE` and `DELETE` except that rewrite: a `tool_result` whose other columns and other payload keys stay the same, and whose `payload.batch_offloaded_at` goes from null to set (so once).
2. **An agent's context** is `latest epoch.system_prompt + summary + events(seq > start_seq)`.
3. **At most one `running` global task per user.** *DB:* the partial unique index `uq_global_tasks_one_running_per_user`.
4. **Compaction never starts** for an agent that is in `task_involvement` of a running task.
5. **Every `tool_calls[i].id`** in an `assistant` event has exactly one `tool_result`, even after a restart.
6. **A delivery is consumed by exactly one `input` event** (`consumed_seq`), or by a `begin_task` for jev-labelled tasks. *DB, in part:* `consumed_seq` is one column, its FK points at an event of the same agent, and only `consumed` rows may set it; that the event is an `input` and that each delivery is consumed once is the code's job.
7. **Exec tokens aren't stored.** They are HMAC-signed and checked against the in-memory `running_exec` map ([11](11-sandbox.md#exec-token)).
8. **Report versions, their artifacts and evidence are never updated or deleted.** A change is a new version ([19](19-reports-dashboard-notifications.md#principles)). *DB:* the trigger `immutable_row` rejects `UPDATE` and `DELETE` on `report_versions`, `report_artifacts` and `report_evidence`.
9. **At most one attempt per report is `running`.** *DB:* the partial unique index `uq_report_attempts_one_running_per_report` on `report_attempts (report_id) WHERE state='running'`; `start_report` on a report with a running attempt returns 409 `job_running`.
