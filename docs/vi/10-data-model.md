# 10 · Mô hình dữ liệu

PostgreSQL 17, truy cập bằng SQLAlchemy Core (async, `asyncpg`). Migration dùng Alembic (`backend/alembic/`) và chạy khi khởi động (`alembic upgrade head`). **Phụ thuộc:** [01](01-glossary.md), [19](19-reports-dashboard-notifications.md).

**Trạng thái:** Đã triển khai (S1): mọi bảng dưới đây có trong `backend/db/tables.py` và migration đầu tiên `backend/alembic/versions/0001_initial_schema.py`, được áp dụng ở bước khởi động 2 ([16](16-configuration-and-deployment.md#trình-tự-khởi-động-lifespan-của-api)). Các bất biến do database cưỡng chế được đánh dấu bên dưới; phần còn lại đến cùng các section phụ trách chúng.

## Hai nguồn sự thật

| Nơi lưu | Chứa |
|---|---|
| Thư mục agent (`/data/folders`) | prompt, trí nhớ, kỹ năng, helper, định nghĩa lịch chạy, package, liên kết credentials, file, lịch sử git |
| Postgres `contoso` | người dùng và session, agent, epoch, event, hội thoại, tin nhắn, delivery, task, quyết định jev, trạng thái chạy của lịch, kho, job; báo cáo, dataset, thông báo người dùng (user notification) và tuỳ chọn ([19](19-reports-dashboard-notifications.md)) |
| `/data/reports` | artifact của báo cáo đã xuất bản, mỗi phiên bản một thư mục |

Không bên nào sao chép bên kia. Khi DB cần thứ gì từ thư mục, như lịch của lịch chạy, nó cache lại và đồng bộ lại từ thư mục.

## Quy ước

- **Id.** Id là `uuid` (sinh bằng `gen_random_uuid()`), trừ chỗ cần `bigint` identity có thứ tự (`events`, `messages`, `deliveries`, `global_tasks`).
- **Thời gian** là `timestamptz`, mặc định `now()`.
- **Enum** là cột `text` có ràng buộc `CHECK`, nên thêm giá trị chỉ cần migration một dòng.
- **JSON** là `jsonb`.
- **Nullable.** Một cột là `NOT NULL` trừ khi ghi chú của nó nói "null".
- **Mặc định.** Cột `bool` mặc định `false`, bộ đếm `0`, các mảng id và tag (`project_ids`, `market_ids`, `tags`) là `'{}'`, còn `users.display_name`, `agents.description`, `agent_epochs.summary` và `jobs.output` là `''`. Cột trạng thái và loại không có mặc định: code luôn ghi rõ trạng thái.
- **Tên ràng buộc** cố định, để code có thể ánh xạ vi phạm sang lỗi API: `pk_<bảng>`, `fk_<bảng>_<cột>`, `uq_<bảng>_<cột>`, `ck_<bảng>_<cột>` cho check enum và `ck_<bảng>_<quy tắc>` cho các check khác. Partial unique index đặt tên theo quy tắc của nó, ví dụ `uq_global_tasks_one_running_per_user`.

## Các bảng

### `domains`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | text PK | `fabrikam` |
| `name` | text | tên hiển thị |
| `status` | text | `available` \| `unavailable` |
| `status_reason` | text null | chỉ tên key hoặc tên file |
| `synced_at` | timestamptz | |

### `users`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `username` | text UNIQUE | `^[a-z0-9._-]{3,32}$`, lưu chữ thường |
| `display_name` | text | tối đa 100 ký tự, mặc định `''` (tài khoản tạo không kèm tên); rỗng nghĩa là "hiện username". Form cài đặt yêu cầu 1–100 ([14b](14b-frontend-pages.md)) |
| `password_hash` | text | argon2id |
| `role` | text | `user` \| `admin` |
| `domain_id` | text FK null | `CHECK ((role='admin') = (domain_id IS NULL))` |
| `status` | text | `provisioning` \| `active` \| `failed` \| `disabled` |
| `status_detail` | text null | bước cấp phát bị lỗi |
| `created_at` | timestamptz | |

### `auth_sessions`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `token_hash` | bytea PK | SHA-256 của token cookie 32 byte (`CHECK` 32 byte) |
| `user_id` | uuid FK | `ON DELETE CASCADE` |
| `created_at`, `last_seen_at`, `expires_at` | timestamptz | hết hạn trượt 7 ngày |

### `agents`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `slug` | text | `^[a-z0-9][a-z0-9-]{1,31}$` ([04](04-agent-folder.md)); `UNIQUE (user_id, slug)`, tính cả agent đã xoá |
| `display_name`, `description` | text | |
| `avatar` | jsonb | `{"emoji": "📊", "color": "#16A34A"}` |
| `origin` | text | `lead` \| `starter` \| `custom` |
| `is_lead` | bool | `UNIQUE (user_id) WHERE is_lead` |
| `state` | text | `active` \| `deleted` |
| `status` | text | `idle` \| `busy` \| `routine` \| `compacting` |
| `status_detail` | text null | tên lịch chạy |
| `compaction_pending` | bool | |
| `compaction_failures` | int | về 0 khi thành công |
| `baseline_commit` | text | dùng khi khôi phục |
| `created_at` | timestamptz | |

Đường dẫn thư mục được suy ra: `/data/folders/<user_id>/<slug>`.

### `agent_epochs`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `agent_id` | uuid FK | PK (`agent_id`, `epoch`) |
| `epoch` | int | bắt đầu từ 0 |
| `start_seq` | bigint | context = các event có `seq > start_seq` |
| `system_prompt` | text | render một lần ([06](06-context-and-compaction.md#system-prompt)) |
| `summary` | text | cho phép chuỗi rỗng |
| `reason` | text | `initial` \| `compaction` \| `reset` \| `truncated` |
| `created_at` | timestamptz | |

### `events`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | bigint identity PK | |
| `agent_id` | uuid FK | |
| `seq` | bigint | `UNIQUE (agent_id, seq)`; theo từng agent, không có khoảng trống |
| `epoch` | int | |
| `kind` | text | `input` \| `assistant` \| `tool_result` \| `error` |
| `payload` | jsonb | xem dưới |
| `trace_id` | char(32) | trace của activation |
| `activation_kind` | text | `message` \| `routine` \| `compaction` \| `task` |
| `task_id` | bigint FK null | task đang chạy, nếu có |
| `created_at` | timestamptz | |

Payload:

```jsonc
// input
{"text": "<đúng thứ model đã thấy>", "items": [{"type": "notification", "delivery_id": 981, "message_id": 5521},
  {"type": "notice", "delivery_id": 990, "kind": "builder"}, {"type": "routine", "name": "bao-cao-sang"},
  {"type": "begin_task", "task_id": 42}, {"type": "compaction"}]}
// assistant
{"text": "...", "tool_calls": [{"id": "call_1", "code": "..."}], "model": "anthropic/claude-haiku-4.5",
 "usage": {"prompt_tokens": 12034, "completion_tokens": 311, "cached_tokens": 11520, "cost": 0.0041}, "latency_ms": 2140}
// tool_result
{"tool_call_id": "call_1", "exec_id": "x_01J…", "text": "<như đã gửi>", "exit_code": 0, "duration_ms": 1400,
 "timed_out": false, "truncated": false, "offload_path": ".contoso/outputs/x_01J….txt", "head": "3f2c…",
 "changed": [{"path": "memory/preferences.md", "status": "M"}], "snapshot_error": null, "final": false,
 "batch_offloaded_at": null, "system": false}
// error
{"code": "step_limit|model_unavailable|context_overflow|batch_offload|compaction_truncated|restart", "text": "..."}
```

### `threads` và `thread_members`
| Cột của `threads` | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | chủ sở hữu |
| `kind` | text | `direct` \| `group` \| `agent` |
| `name` | text null | chỉ với nhóm |
| `member_key` | text null | các slug đã sắp xếp nối bằng `+`; `UNIQUE (user_id, kind, member_key)` với `direct` và `agent` |
| `read_only` | bool | hội thoại trực tiếp của agent đã xoá |
| `last_message_at` | timestamptz | thứ tự trong danh sách chat |

| Cột của `thread_members` | Kiểu | Ghi chú |
|---|---|---|
| `thread_id` | uuid FK | PK (`thread_id`, `member_type`, `member_id`) |
| `member_type` | text | `user` \| `agent` |
| `member_id` | uuid | |
| `last_read_message_id` | bigint null | huy hiệu chưa đọc (chỉ thành viên người dùng) |

### `messages`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | bigint identity PK | |
| `thread_id` | uuid FK | index (`thread_id`, `id`) |
| `sender_type` | text | `user` \| `agent` \| `system` |
| `sender_id` | uuid null | null khi và chỉ khi là `system` (`CHECK`) |
| `content` | jsonb | `{"text", "choices": [{id,label}], "reply_to", "choice_id", "report_refs": [{report_id, version_id, title}]}` |
| `trace_id` | char(32) null | activation đã gửi (agent), hoặc trace `user_message` |
| `exec_id` | text null | |
| `created_at` | timestamptz | |

### `attachments`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `message_id` | bigint FK | |
| `filename`, `mime` | text | |
| `size` | bigint | |
| `sha256` | char(64) | |
| `path` | text | `/data/attachments/<message_id>/<filename>` |

### `deliveries`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | bigint identity PK | |
| `agent_id` | uuid FK | người nhận |
| `message_id` | bigint FK null | |
| `notice` | jsonb null | `{"kind": "builder\|presence\|restart\|task_cancelled\|task_timeout\|routine_invalid\|task_resume", "text": "..."}`; `CHECK ((message_id IS NULL) <> (notice IS NULL))` |
| `route` | text | `notification` \| `jev` |
| `status` | text | `classifying` (jev đang chạy; chỉ delivery của lead) \| `pending` \| `consumed` |
| `consumed_seq` | bigint null | event `input` đã tiêu thụ nó: FK (`agent_id`, `consumed_seq`) → `events (agent_id, seq)`, hoãn kiểm tra đến lúc commit; chỉ đặt khi `status='consumed'` (task do jev gắn nhãn tiêu thụ delivery mà không cần nó) |
| `created_at` | timestamptz | index (`agent_id`) `WHERE status='pending'` |

### `global_tasks`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | bigint identity PK | hiển thị là `T<id>` |
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
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | bigint identity PK | |
| `message_id` | bigint FK | |
| `lead_id` | uuid FK | |
| `input` | jsonb | `{state, questions}` gửi tới Decisions API |
| `label` | text | `task` \| `side_question` |
| `confidence` | float null | độ tin cậy jev tính toán (0–1); `null` khi fallback |
| `fallback` | bool | |
| `model`, `latency_ms`, `trace_id` | | |
| `observed` | text null | nhãn admin cho là đúng |
| `observed_by` | uuid null | |
| `created_at` | timestamptz | |

### `routine_state`
`agent_id` uuid FK, `name` text (PK `agent_id`, `name`), `cron` text, `enabled` bool, `prompt_sha` char(64), `next_fire_at`, `last_fired_at`, `last_started_at`, `last_ended_at` timestamptz null, `pending` bool.

### `skill_catalog`
`id` text PK, `name` text, `title_vi` text, `description_vi` text, `tags` text[] (index GIN), `install_cmd` text[], `domain_id` text FK null, `seeded_at` timestamptz.

### `library_presets`
`id` text PK, `title_vi` text, `description_vi` text, `packages` text[], `domain_id` text FK null.

### `jobs`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `agent_id` | uuid FK null | null với job tạo agent cho tới bước cuối |
| `kind` | text | `agent_create` \| `agent_reset` \| `skill_install` \| `skill_remove` \| `package_add` \| `package_remove` \| `preset_apply` \| `user_provision` (job cấp phát người dùng ở [12](12-auth-and-domains.md#cấp-phát-người-dùng); `request` là `{domain_id}`) |
| `request` | jsonb | |
| `status` | text | `queued` \| `running` \| `done` \| `failed` |
| `output` | text | 4 KB cuối |
| `created_at` | timestamptz | |
| `finished_at` | timestamptz null | |

Khi khởi động, các job còn `queued` hoặc `running` được đặt `failed` với output "interrupted by restart".

### Bảng mở rộng workspace

Các bảng này phục vụ thư viện báo cáo, dashboard nghiệp vụ, thông báo người dùng (user notification) và tuỳ chọn ([19](19-reports-dashboard-notifications.md)).

#### `reports`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | chủ sở hữu |
| `code` | text | `R<n>` (`^R[0-9]+$`), đánh số theo người dùng; `UNIQUE (user_id, code)`; id dùng trong API và URL |
| `title`, `type` | text | `type` khớp `^[a-z][a-z0-9-]{0,79}$` |
| `project_ids`, `market_ids` | text[] | |
| `agent_id` | uuid FK | agent đã khởi tạo |
| `created_at` | timestamptz | |

#### `report_attempts`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid FK | |
| `agent_id` | uuid FK | |
| `task_id` | bigint FK null | task toàn cục đang chạy lúc bắt đầu |
| `state` | text | `queued` \| `running` \| `succeeded` \| `failed` |
| `reason` | text null | `task_ended`, `timeout` hoặc lý do của agent |
| `version_id` | uuid FK null | đặt khi thành công |
| `created_at` | timestamptz | |
| `finished_at` | timestamptz null | |

#### `report_versions`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `report_id` | uuid FK | |
| `sequence` | int | `UNIQUE (report_id, sequence)`; id trong API là `<code>-v<sequence>` |
| `schema` | jsonb | report schema v1 đã kiểm tra hợp lệ |
| `source` | jsonb | `{id, label, dataThrough, completeness}` |
| `policy_version`, `content_revision` | text | |
| `trace_id` | char(32) | activation đã xuất bản nó |
| `completed_at` | timestamptz | |

Các dòng không bao giờ được cập nhật hay xoá ([19](19-reports-dashboard-notifications.md#nguyên-tắc)); xem bất biến 8.

#### `report_artifacts` và `report_evidence`
`report_artifacts`: `id` uuid PK, `version_id` uuid FK, `filename`, `mime` text, `size` bigint, `sha256` char(64), `path` text (`/data/reports/<version_id>/<filename>`).

`report_evidence`: `version_id` uuid FK, `id` text (PK `version_id`, `id`), `label`, `source_id` text, `project_ids` text[], `snapshot_id` text null, `data_through` timestamptz, `limitation` text.

#### `datasets`
`id` uuid PK, `user_id` uuid FK, `kind` text (`dashboard`), `payload` jsonb, `agent_id` uuid FK, `published_at` timestamptz. Giữ năm bản mới nhất cho mỗi (`user_id`, `kind`).

#### `user_notifications`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | index (`user_id`, `occurred_at` DESC) |
| `kind` | text | `account-created` \| `system` \| `report-ready` \| `task-failed` \| `action-required` |
| `title`, `summary` | jsonb | `{"vi": "...", "en": "..."}` |
| `target` | jsonb | `{kind: chat, conversationId}` (id hội thoại, đặt tên như `NotificationTarget` của frontend) \| `{kind: report, reportId, versionId?}` \| `{kind: account}` \| `{kind: system-detail, notificationId}` (id của chính nó) |
| `occurred_at` | timestamptz | |
| `read_at` | timestamptz null | |

#### `user_preferences`
`user_id` uuid PK FK, `value` jsonb (`Preferences` của frontend, không có `displayName`), `updated_at` timestamptz.

## Bất biến

Mỗi bất biến đều có test ([17](17-testing.md)). Database cưỡng chế 1, 3, 8, 9 và một phần của 6 (`backend/tests/db/test_invariants.py`); code của các section sau cưỡng chế phần còn lại.

1. **`events` chỉ nối thêm.** Ngoại lệ duy nhất là offload hàng loạt, ghi lại `payload.text` của các dòng `tool_result` cũ và đặt `batch_offloaded_at` ([06](06-context-and-compaction.md#offload-output-lớn)). *DB:* trigger `events_append_only` từ chối mọi `UPDATE` và `DELETE` trừ lần ghi lại đó: một `tool_result` có các cột khác và các khoá payload khác giữ nguyên, và `payload.batch_offloaded_at` chuyển từ null sang có giá trị (nên chỉ một lần).
2. **Context của agent** là `system_prompt của epoch mới nhất + summary + events(seq > start_seq)`.
3. **Tối đa một global task `running` cho mỗi người dùng.** *DB:* partial unique index `uq_global_tasks_one_running_per_user`.
4. **Compaction không bao giờ bắt đầu** với agent đang nằm trong `task_involvement` của task đang chạy.
5. **Mọi `tool_calls[i].id`** trong một event `assistant` có đúng một `tool_result`, kể cả sau khi khởi động lại.
6. **Mỗi delivery được tiêu thụ bởi đúng một event `input`** (`consumed_seq`), hoặc bởi một `begin_task` với task do jev gắn nhãn. *DB, một phần:* `consumed_seq` là một cột, FK của nó trỏ tới một event của cùng agent, và chỉ dòng `consumed` mới được đặt nó; việc event đó là `input` và mỗi delivery chỉ được tiêu thụ một lần là việc của code.
7. **Exec token không được lưu.** Chúng được ký HMAC và kiểm tra với bản đồ `running_exec` trong bộ nhớ ([11](11-sandbox.md#exec-token)).
8. **Phiên bản báo cáo, artifact và evidence của nó không bao giờ được cập nhật hay xoá.** Thay đổi là một phiên bản mới ([19](19-reports-dashboard-notifications.md#nguyên-tắc)). *DB:* trigger `immutable_row` từ chối `UPDATE` và `DELETE` trên `report_versions`, `report_artifacts` và `report_evidence`.
9. **Mỗi báo cáo có tối đa một lần thử `running`.** *DB:* partial unique index `uq_report_attempts_one_running_per_report` trên `report_attempts (report_id) WHERE state='running'`; `start_report` trên báo cáo đang có lần thử chạy trả về 409 `job_running`.
