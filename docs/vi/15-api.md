# 15 · API

**Phụ thuộc:** [10](10-data-model.md), [12](12-auth-and-domains.md), [19](19-reports-dashboard-notifications.md).

**Trạng thái:** Đã làm: `GET /api/health` (S0), [Xác thực](#xác-thực) và các route quản lý người dùng `GET`/`POST /users`, `PATCH /users/{id}` (S2). Phần còn lại là dự kiến; frontend vẫn chạy trên mock service ([14c](14c-frontend-adapters.md)).

## Quy ước

- **Đường dẫn gốc.** Public là `/api` trên `api:8000`, internal là `/internal/v1` trên `api:8001`, và `execd` nằm trên `workspace:7000`.
- **Xác thực.** Route public dùng cookie `contoso_session`, và mọi request khác GET, HEAD và OPTIONS cần thêm `X-Contoso-Client: web` ([12](12-auth-and-domains.md#đăng-nhập-mức-poc)). Route internal dùng `Authorization: Bearer <exec token>`. `execd` dùng `Authorization: Bearer $EXECD_TOKEN`.
- **Định dạng.** Body là JSON trừ chỗ ghi multipart. Thời gian dạng ISO 8601 có múi giờ. Route lõi dùng snake_case; các [mở rộng workspace](#mở-rộng-workspace) dùng shape camelCase của contract frontend ([19](19-reports-dashboard-notifications.md#nguyên-tắc)).
- **Lỗi:** `{"error": "<mã>", "message": "<tiếng Việt, an toàn để hiện cho người dùng>"}`. Body không qua kiểm tra (sai kiểu, field lạ, JSON hỏng) là 400 `invalid_request`; id trên đường dẫn không parse được là 404 `not_found`, như id không tồn tại.

| Status | Mã |
|---|---|
| 400 | `invalid_request`, `invalid_path`, `invalid_commit`, `not_expandable`, `not_a_directory`, `not_a_file`, `invalid_slug`, `unknown_credential_set`, `invalid_cron`, `invalid_package`, `invalid_report`, `invalid_dataset`, `invalid_thread`, `invalid_receiver`, `invalid_file` |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `forbidden`, `csrf`, `user_disabled`, `lead_only` |
| 404 | `not_found` (cũng dùng cho tài nguyên người gọi không sở hữu) |
| 409 | `slug_taken`, `agent_limit`, `agent_busy_in_task`, `job_running`, `lead_protected`, `thread_read_only`, `username_taken`, `domain_change_unsupported`, `task_ended`, `no_running_task`, `compacting`, `not_compacting`, `invalid_state`, `attempt_ended` |
| 413 | `file_too_large` |
| 429 | `rate_limited` |
| 503 | `domain_unavailable`, `marketplace_disabled` |

## API public

### Xác thực
| Method | Đường dẫn | Body → Response |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → `200 Me` + cookie |
| POST | `/auth/logout` | → `204` |
| GET | `/auth/me` | → `Me = {id, username, display_name, role, status, domain: {id, name, status} \| null}`; `status` là `provisioning \| active \| failed \| disabled`; `status_detail` chỉ có ở API quản trị |

### Hội thoại và tin nhắn
| Method | Đường dẫn | Body → Response |
|---|---|---|
| GET | `/threads` | → `[{id, kind, name, members: [{type, id, slug?, display_name, avatar}], last_message, unread, read_only}]` |
| POST | `/threads` | `{name, agent_ids: [≥2]}` → `201 Thread` (nhóm) |
| PATCH | `/threads/{id}` | `{name?, add_agent_ids?, remove_agent_ids?}` → `Thread` (chỉ nhóm) |
| GET | `/threads/{id}/messages?before=<id>&limit=50` | → `[Message]`, mới nhất ở cuối |
| POST | `/threads/{id}/messages` | multipart: `text?`, `files[]?`, `reply_to?`, `choice_id?` → `201 Message` |
| POST | `/threads/{id}/read` | `{message_id}` → `204` |
| GET | `/attachments/{id}` | → file (`Content-Disposition` theo mime) |

`Thread = {id, kind, name, members: [{type, id, slug?, display_name, avatar, is_lead?}], last_message: Message | null, unread, read_only, last_message_at}`; một nhóm luôn có ít nhất hai agent (nếu không thì 400). Bấm lựa chọn được gửi như tin nhắn thường với `text`, `choice_id` và `reply_to`.

`Message = {id, thread_id, sender: {type, id, display_name, avatar}, text, choices, reply_to, choice_id, attachments: [{id, filename, mime, size}], report_refs: [{report_id, version_id, title}], created_at}` (người gửi là agent có thêm `slug`; người gửi hệ thống là `{type: "system", id: null, display_name: "Hệ thống", avatar: null}`)

`Task = {id, description, status, outcome, ended_by, source_message_id, created_at, started_at, ended_at}`. `task.updated` mang đúng dòng này. Huỷ một task đã kết thúc là 409 `task_ended`. `contoso.end_task` khi không có task đang chạy là 409 `no_running_task`; `end_task` và `queue_task` từ agent không phải lead là 403 `lead_only`.

### Task, hiện diện và stream
| Method | Đường dẫn | Body → Response |
|---|---|---|
| GET | `/tasks?status=queued,running` | → `[Task]` |
| POST | `/tasks/{id}/cancel` | → `Task` |
| POST | `/presence` | → `204` |
| GET | `/stream` | SSE ([14](14-frontend.md#realtime)) |
| GET | `/health` | không cần xác thực → `{"ok": true, "db": true, "execd": true}`; `503` với `ok: false` và mục kiểm tra lỗi là `false` khi một phụ thuộc không hoạt động. Healthcheck của compose dùng endpoint này |

### Agent và builder
| Method | Đường dẫn | Body → Response |
|---|---|---|
| GET | `/agents` | → `[Agent]` (chỉ agent đang hoạt động) |
| POST | `/agents` | `{slug, display_name, avatar, description, starter?: <slug>, presets?: [id], credentials?: [set]}` → `202 {job_id}` |
| GET / PATCH | `/agents/{id}` | PATCH `{display_name?, avatar?, description?}` → `Agent` |
| DELETE | `/agents/{id}` | → `204` |
| POST | `/agents/{id}/reset` | → `202 {job_id}` |
| GET / PUT | `/agents/{id}/prompt` | PUT `{text}` → `{text, commit}` |
| GET | `/agents/{id}/skills` | → `[{name, description, catalog_id?, commit_author}]` |
| POST | `/agents/{id}/skills` | `{catalog_id}` hoặc `{url}` → `202 {job_id}` |
| DELETE | `/agents/{id}/skills/{name}` | → `202 {job_id}` |
| GET | `/agents/{id}/packages` | → `[{name, spec}]` lấy từ `pyproject.toml` |
| POST | `/agents/{id}/packages` | `{preset_id}` hoặc `{package: "<PEP 508>"}` → `202 {job_id}` |
| DELETE | `/agents/{id}/packages/{name}` | → `202 {job_id}` |
| GET | `/agents/{id}/routines` | → `[{name, prompt, cron, enabled, next_fires: [3], last_started_at, last_ended_at, error?}]` |
| PUT / DELETE | `/agents/{id}/routines/{name}` | PUT `{prompt, cron, enabled}` → `Routine` |
| GET / PUT | `/agents/{id}/credentials` | PUT `{sets: [name]}` → `[{set, keys}]` |
| GET | `/jobs/{id}` | → `{id, kind, status, output, created_at, finished_at}` |

`Agent = {id, slug, display_name, avatar, description, origin, is_lead, status, status_detail, created_at}`

### Trình xem thư mục
`GET /agents/{id}/tree|file|archive|log|diff` ([04](04-agent-folder.md#trình-xem-thư-mục)). Admin dùng được các route này cho mọi agent.

### Kho
| Method | Đường dẫn | Response |
|---|---|---|
| GET | `/catalog/skills?q=&tag=` | `[{id, name, title_vi, description_vi, tags}]` (toàn cục + miền của mình) |
| GET | `/catalog/skills/{id}/preview` | `{skill_md, files: [path], has_code}` |
| GET | `/catalog/presets` | `[{id, title_vi, description_vi, packages}]` |
| GET | `/catalog/credential-sets` | `[{set, description, keys}]` (miền của mình) |
| GET | `/catalog/starters` | `[{slug, display_name, avatar, description, presets, credentials}]` (các mẫu của miền mình, cho "Bắt đầu từ mẫu") |

## Mở rộng workspace

Các route cho thư viện báo cáo, dashboard nghiệp vụ, thông báo người dùng (user notification) và tuỳ chọn. Thiết kế và quy tắc: [19](19-reports-dashboard-notifications.md). Body dùng các kiểu contract frontend nêu dưới đây (camelCase), từ `frontend/src/features/*/model/types.ts` và `frontend/src/shared/contracts/*`. Mọi route chỉ dành cho người dùng (admin nhận 403 `forbidden`) và giới hạn theo chủ sở hữu.

Một **phạm vi (scope)** là các query `from`, `to` (ngày nghiệp vụ, `[from, to)`), `timezone` (IANA), và tuỳ chọn `market` và `project`.

### Báo cáo
| Method | Đường dẫn | Query hoặc body → Response |
|---|---|---|
| GET | `/reports/catalog` | → `WorkspaceCatalog = {reportTypes, projects, authors, agents, defaultScope}` |
| GET | `/reports` | `q`, lặp lại `type` `status` `market` `project` `author` `agent`, `dateField` (`createdAt`\|`completedAt`), ngày của scope, `sort` (`createdAt`\|`completedAt`\|`title`\|`status`), `direction`, `page`, `pageSize` (25\|50\|100) → `Page<ReportSummary>` |
| GET | `/reports/{id}?version=` | → `ReportDetail` (phiên bản được chọn, các phiên bản được phép, evidence, metadata của artifact). Không có `version` thì là phiên bản đã lưu mới nhất |
| GET | `/reports/{id}/versions/{version_id}/artifacts/{artifact_id}` | → file (`Content-Disposition: attachment`) |
| GET | `/reports/summary` | scope → `ReportAggregate = {distinctReports, completedVersions, source}` |
| GET | `/reports/recent` | scope, `limit` (≤ 20) → `[ReportSummary]` |

`ReportVersion.sections` (định dạng cũ) luôn là `[]`; nội dung nằm trong `schema`.

### Dashboard nghiệp vụ
| Method | Đường dẫn | Query hoặc body → Response |
|---|---|---|
| GET | `/dashboard/dataset` | → `{dataset: DashboardDataset \| null, publishedAt: string \| null}`. `tasks` và `taskSource` lấy từ các lần thử báo cáo của người dùng |

Tổng quan và phân rã được tính trong trình duyệt ([19](19-reports-dashboard-notifications.md#cách-tính)).

### Thông báo người dùng
| Method | Đường dẫn | Query hoặc body → Response |
|---|---|---|
| GET | `/notifications?limit=100` | → `[Notification]`, mới nhất trước |
| POST | `/notifications/read` | `{ids?: [id]}`; không có `ids` thì đánh dấu mọi mục chưa đọc → `[Notification]` |

Sự kiện SSE trên `/stream`: `notification.created`, `notification.read`, `report.updated` ([14](14-frontend.md#realtime)).

### Tuỳ chọn
| Method | Đường dẫn | Query hoặc body → Response |
|---|---|---|
| GET | `/me/preferences` | → `Preferences = {displayName, locale, theme, timezone, motion, density, notifications: {reports, tasks, system}}` |
| PUT | `/me/preferences` | `Preferences` → `Preferences`; đồng thời cập nhật `users.display_name` |

## API admin (`/api/admin`)

| Method | Đường dẫn | Body → Response |
|---|---|---|
| GET | `/overview` | → `{domains: [...], agents: [{..., user, domain, current_task, queue_len, pending, cost_today, last_error_at, compaction_failed}]}` |
| GET | `/users` | → `[User]` |
| POST | `/users` | `{username, password, domain_id, display_name?}` → `202 {user, job_id}` |
| PATCH | `/users/{id}` | `{disabled?, password?}` → `User`; `domain_id` khác miền hiện tại → 409 `domain_change_unsupported` |
| POST | `/users/{id}/retry` | → `202 {job_id}` (S9) |
| GET | `/users/{id}/agents`, `/users/{id}/threads` | → danh sách cho thanh bên của trace |
| GET | `/agents/{id}/events?after_seq=&limit=200` | → `{agent, events: [{seq, epoch, kind, payload, trace_id, activation_kind, task_id, created_at}], epochs: [{epoch, start_seq, reason, summary, system_prompt, created_at}], jev: [{id, message_id, label, fallback, model, latency_ms, trace_id, observed, created_at}]}` |
| GET | `/agents/{id}/stream` | SSE `event.appended`, `agent.status` |
| POST | `/agents/{id}/compact` | → `204` (compaction chuyển sang chờ) |
| POST | `/agents/{id}/reset` | → `202 {job_id}`: job đặt lại của [04](04-agent-folder.md) cho agent của bất kỳ người dùng nào (doc 12 "Đặt lại agent"); 409 `job_running` hoặc `agent_busy_in_task` |
| GET | `/threads/{id}` | → `{thread, messages}` (mọi loại) |
| POST | `/jev/{message_id}/observed` | `{label}` → `204` |
| GET | `/config` | → `{langfuse_url, langfuse_project_id}` |

`User = {id, username, display_name, role, domain: {id, name, status}, status, status_detail, created_at}`. `GET /admin/users` thêm `provisioning: {job_status, step, agent, done, total}` khi người dùng đang provisioning (ngược lại là `null`), lấy từ bảng `jobs`/`agents` và starter của domain — không bao giờ là output của job. Các route người dùng chỉ gồm tài khoản `user`, sắp theo tên đăng nhập; id của admin là 404 ([12](12-auth-and-domains.md#quản-lý-người-dùng-trang-admin-người-dùng)).

## API internal (`api:8001/internal/v1`, exec token)

| Method | Đường dẫn | Body → Response |
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

Lỗi internal dùng cùng định dạng. `contoso` raise chúng thành `ContosoError(code, message)`.

## API của `execd` (`workspace:7000`)

`POST /exec` và `GET /health` ([11](11-sandbox.md#api-của-execd)).
