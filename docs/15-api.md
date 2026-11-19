# 15 · API

**Depends on:** [10](10-data-model.md), [12](12-auth-and-domains.md), [19](19-reports-dashboard-notifications.md).

**Status:** Implemented: `GET /api/health` (S0), [Auth](#auth) and the admin user routes `GET`/`POST /users`, `PATCH /users/{id}` (S2). Everything else is planned; the frontend still runs on mock services ([14c](14c-frontend-adapters.md)).

## Conventions

- **Base paths.** The public base is `/api` on `api:8000`, internal is `/internal/v1` on `api:8001`, and `execd` is on `workspace:7000`.
- **Auth.** Public routes use the `contoso_session` cookie, and every request other than GET, HEAD and OPTIONS also needs `X-Contoso-Client: web` ([12](12-auth-and-domains.md#login-poc-grade)). Internal routes use `Authorization: Bearer <exec token>`. `execd` uses `Authorization: Bearer $EXECD_TOKEN`.
- **Format.** Bodies are JSON unless marked multipart. Times are ISO 8601 with offset. Core routes use snake_case; the [workspace extensions](#workspace-extensions) use the camelCase shapes of the frontend contracts ([19](19-reports-dashboard-notifications.md#principles)).
- **Errors:** `{"error": "<code>", "message": "<Vietnamese, user-safe>"}`. A body that fails validation (wrong types, unknown fields, bad JSON) is 400 `invalid_request`; a path id that doesn't parse is 404 `not_found`, like a missing one.

| Status | Codes |
|---|---|
| 400 | `invalid_request`, `invalid_path`, `invalid_commit`, `not_expandable`, `not_a_directory`, `not_a_file`, `invalid_slug`, `unknown_credential_set`, `invalid_cron`, `invalid_package`, `invalid_report`, `invalid_dataset`, `invalid_thread`, `invalid_receiver`, `invalid_file` |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `forbidden`, `csrf`, `user_disabled`, `lead_only` |
| 404 | `not_found` (also returned for resources the caller doesn't own) |
| 409 | `slug_taken`, `agent_limit`, `agent_busy_in_task`, `job_running`, `lead_protected`, `thread_read_only`, `username_taken`, `domain_change_unsupported`, `task_ended`, `no_running_task`, `compacting`, `not_compacting`, `invalid_state`, `attempt_ended` |
| 413 | `file_too_large` |
| 429 | `rate_limited` |
| 503 | `domain_unavailable`, `marketplace_disabled` |

## Public API

### Auth
| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → `200 Me` + cookie |
| POST | `/auth/logout` | → `204` |
| GET | `/auth/me` | → `Me = {id, username, display_name, role, status, domain: {id, name, status} \| null}`; `status` is `provisioning \| active \| failed \| disabled`; `status_detail` stays admin-only |

### Threads and messages
| Method | Path | Body → Response |
|---|---|---|
| GET | `/threads` | → `[{id, kind, name, members: [{type, id, slug?, display_name, avatar}], last_message, unread, read_only}]` |
| POST | `/threads` | `{name, agent_ids: [≥2]}` → `201 Thread` (group) |
| PATCH | `/threads/{id}` | `{name?, add_agent_ids?, remove_agent_ids?}` → `Thread` (groups only) |
| GET | `/threads/{id}/messages?before=<id>&limit=50` | → `[Message]`, newest last |
| POST | `/threads/{id}/messages` | multipart: `text?`, `files[]?`, `reply_to?`, `choice_id?` → `201 Message` |
| POST | `/threads/{id}/read` | `{message_id}` → `204` |
| GET | `/attachments/{id}` | → file (`Content-Disposition` by mime) |

`Thread = {id, kind, name, members: [{type, id, slug?, display_name, avatar, is_lead?}], last_message: Message | null, unread, read_only, last_message_at}`; a group keeps at least two agents (400 otherwise). Choice clicks are posted as ordinary messages with `text`, `choice_id` and `reply_to`.

`Message = {id, thread_id, sender: {type, id, display_name, avatar}, text, choices, reply_to, choice_id, attachments: [{id, filename, mime, size}], report_refs: [{report_id, version_id, title}], created_at}` (an agent sender also has `slug`; a system sender is `{type: "system", id: null, display_name: "Hệ thống", avatar: null}`)

`Task = {id, description, status, outcome, ended_by, source_message_id, created_at, started_at, ended_at}`. `task.updated` carries this row. Cancelling a task that already ended is 409 `task_ended`. `contoso.end_task` with no running task is 409 `no_running_task`; `end_task` and `queue_task` from a non-lead are 403 `lead_only`.

### Tasks, presence and stream
| Method | Path | Body → Response |
|---|---|---|
| GET | `/tasks?status=queued,running` | → `[Task]` |
| POST | `/tasks/{id}/cancel` | → `Task` |
| POST | `/presence` | → `204` |
| GET | `/stream` | SSE ([14](14-frontend.md#realtime)) |
| GET | `/health` | no auth → `{"ok": true, "db": true, "execd": true}`; `503` with `ok: false` and the failing check `false` when a dependency is down. Used by the compose healthcheck |

### Agents and builder
| Method | Path | Body → Response |
|---|---|---|
| GET | `/agents` | → `[Agent]` (active only) |
| POST | `/agents` | `{slug, display_name, avatar, description, starter?: <slug>, presets?: [id], credentials?: [set]}` → `202 {job_id}` |
| GET / PATCH | `/agents/{id}` | PATCH `{display_name?, avatar?, description?}` → `Agent` |
| DELETE | `/agents/{id}` | → `204` |
| POST | `/agents/{id}/reset` | → `202 {job_id}` |
| GET / PUT | `/agents/{id}/prompt` | PUT `{text}` → `{text, commit}` |
| GET | `/agents/{id}/skills` | → `[{name, description, catalog_id?, commit_author}]` |
| POST | `/agents/{id}/skills` | `{catalog_id}` or `{url}` → `202 {job_id}` |
| DELETE | `/agents/{id}/skills/{name}` | → `202 {job_id}` |
| GET | `/agents/{id}/packages` | → `[{name, spec}]` from `pyproject.toml` |
| POST | `/agents/{id}/packages` | `{preset_id}` or `{package: "<PEP 508>"}` → `202 {job_id}` |
| DELETE | `/agents/{id}/packages/{name}` | → `202 {job_id}` |
| GET | `/agents/{id}/routines` | → `[{name, prompt, cron, enabled, next_fires: [3], last_started_at, last_ended_at, error?}]` |
| PUT / DELETE | `/agents/{id}/routines/{name}` | PUT `{prompt, cron, enabled}` → `Routine` |
| GET / PUT | `/agents/{id}/credentials` | PUT `{sets: [name]}` → `[{set, keys}]` |
| GET | `/jobs/{id}` | → `{id, kind, status, output, created_at, finished_at}` |

`Agent = {id, slug, display_name, avatar, description, origin, is_lead, status, status_detail, created_at}`

### Folder viewer
`GET /agents/{id}/tree|file|archive|log|diff` ([04](04-agent-folder.md#folder-viewer)). Admins may use these routes for any agent.

### Catalogs
| Method | Path | Response |
|---|---|---|
| GET | `/catalog/skills?q=&tag=` | `[{id, name, title_vi, description_vi, tags}]` (global + own domain) |
| GET | `/catalog/skills/{id}/preview` | `{skill_md, files: [path], has_code}` |
| GET | `/catalog/presets` | `[{id, title_vi, description_vi, packages}]` |
| GET | `/catalog/credential-sets` | `[{set, description, keys}]` (own domain) |
| GET | `/catalog/starters` | `[{slug, display_name, avatar, description, presets, credentials}]` (own domain's starters, for "Bắt đầu từ mẫu") |

## Workspace extensions

Routes for the reports library, the business dashboard, user notifications and preferences. Design and rules: [19](19-reports-dashboard-notifications.md). Bodies use the frontend contract types named below (camelCase), from `frontend/src/features/*/model/types.ts` and `frontend/src/shared/contracts/*`. Every route is user-only (admins get 403 `forbidden`) and owner-scoped.

A **scope** is the query `from`, `to` (business dates, `[from, to)`), `timezone` (IANA), and optional `market` and `project`.

### Reports
| Method | Path | Query or body → Response |
|---|---|---|
| GET | `/reports/catalog` | → `WorkspaceCatalog = {reportTypes, projects, authors, agents, defaultScope}` |
| GET | `/reports` | `q`, repeated `type` `status` `market` `project` `author` `agent`, `dateField` (`createdAt`\|`completedAt`), scope dates, `sort` (`createdAt`\|`completedAt`\|`title`\|`status`), `direction`, `page`, `pageSize` (25\|50\|100) → `Page<ReportSummary>` |
| GET | `/reports/{id}?version=` | → `ReportDetail` (selected version, permitted versions, evidence, artifact metadata). Without `version`, the newest saved version |
| GET | `/reports/{id}/versions/{version_id}/artifacts/{artifact_id}` | → file (`Content-Disposition: attachment`) |
| GET | `/reports/summary` | scope → `ReportAggregate = {distinctReports, completedVersions, source}` |
| GET | `/reports/recent` | scope, `limit` (≤ 20) → `[ReportSummary]` |

`ReportVersion.sections` (the legacy format) is always `[]`; content is in `schema`.

### Business dashboard
| Method | Path | Query or body → Response |
|---|---|---|
| GET | `/dashboard/dataset` | → `{dataset: DashboardDataset \| null, publishedAt: string \| null}`. `tasks` and `taskSource` come from the user's report attempts |

Overview and breakdown are computed in the browser ([19](19-reports-dashboard-notifications.md#computation)).

### User notifications
| Method | Path | Query or body → Response |
|---|---|---|
| GET | `/notifications?limit=100` | → `[Notification]`, newest first |
| POST | `/notifications/read` | `{ids?: [id]}`; no `ids` marks every unread one → `[Notification]` |

SSE events on `/stream`: `notification.created`, `notification.read`, `report.updated` ([14](14-frontend.md#realtime)).

### Preferences
| Method | Path | Query or body → Response |
|---|---|---|
| GET | `/me/preferences` | → `Preferences = {displayName, locale, theme, timezone, motion, density, notifications: {reports, tasks, system}}` |
| PUT | `/me/preferences` | `Preferences` → `Preferences`; also updates `users.display_name` |

## Admin API (`/api/admin`)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/overview` | → `{domains: [...], agents: [{..., user, domain, current_task, queue_len, pending, cost_today, last_error_at, compaction_failed}]}` |
| GET | `/users` | → `[User]` |
| POST | `/users` | `{username, password, domain_id, display_name?}` → `202 {user, job_id}` |
| PATCH | `/users/{id}` | `{disabled?, password?}` → `User`; a `domain_id` other than the user's → 409 `domain_change_unsupported` |
| POST | `/users/{id}/retry` | → `202 {job_id}` (S9) |
| GET | `/users/{id}/agents`, `/users/{id}/threads` | → lists for the trace sidebar |
| GET | `/agents/{id}/events?after_seq=&limit=200` | → `{agent, events: [{seq, epoch, kind, payload, trace_id, activation_kind, task_id, created_at}], epochs: [{epoch, start_seq, reason, summary, system_prompt, created_at}], jev: [{id, message_id, label, fallback, model, latency_ms, trace_id, observed, created_at}]}` |
| GET | `/agents/{id}/stream` | SSE `event.appended`, `agent.status` |
| POST | `/agents/{id}/compact` | → `204` (compaction becomes pending) |
| POST | `/agents/{id}/reset` | → `202 {job_id}`: the reset job of [04](04-agent-folder.md) for any user's agent (doc 12 "Reset agent"); 409 `job_running` or `agent_busy_in_task` |
| GET | `/threads/{id}` | → `{thread, messages}` (any kind) |
| POST | `/jev/{message_id}/observed` | `{label}` → `204` |
| GET | `/config` | → `{langfuse_url, langfuse_project_id}` |

`User = {id, username, display_name, role, domain: {id, name, status}, status, status_detail, created_at}`. `GET /admin/users` adds `provisioning: {job_status, step, agent, done, total}` while a user is provisioning (else `null`), from `jobs`/`agents` rows and the domain's starters — never job output. The user routes cover `user` accounts only, sorted by username; an admin's id is 404 ([12](12-auth-and-domains.md#user-management-admin-page-người-dùng)).

## Internal API (`api:8001/internal/v1`, exec token)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/whoami` | → `{agent, exec_id, activation_kind}` (diagnostics) |
| POST | `/send_to_user` | `{text?, files?, choices?, reports?, thread?, reply_to?, final?}` → `{message_id}` |
| POST | `/send_to_agent` | `{receivers, content, files?, thread?, reply_to?}` → `{message_id}` |
| POST | `/end_task` | `{outcome, status}` → `{task_id}` |
| POST | `/queue_task` | `{description}` → `{task_id}` |
| POST | `/write_summary` | `{text}` → `204` |
| POST | `/reports/start` | `{title, type, projects?, markets?, report_id?}` → `{report_id, attempt_id}` |
| POST | `/reports/publish` | `{attempt_id, schema_path, artifacts?, evidence?, source?}` → `{version_id}` |
| POST | `/reports/fail` | `{attempt_id, reason}` → `204` |
| POST | `/datasets/publish` | `{kind: "dashboard", path}` → `{dataset_id}` |

Internal errors use the same shape. `contoso` raises them as `ContosoError(code, message)`.

## `execd` API (`workspace:7000`)

`POST /exec` and `GET /health` ([11](11-sandbox.md#execd-api)).
