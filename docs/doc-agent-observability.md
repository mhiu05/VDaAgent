# Agent Governance và Observability API

Tài liệu này mô tả các API quan sát Agent, trace, HITL và lịch sử chat.

## 1. Agent Run

Mỗi luồng quan trọng có thể tạo một Agent Run:

- Chạy profiling.
- Chat với saved report.
- Tạo profiling plan.
- Recommend database tables.

Agent Run có các thông tin chính:

- `run_id`
- `source_name`
- `source_type`
- `status`
- `started_at`
- `updated_at`
- `metrics`

## 2. Trace Events

Trace event cho biết Agent đã làm gì trong từng bước.

Mỗi event gồm:

- `run_id`
- `trace_id`
- `span_id`
- `parent_span_id`
- `event_type`
- `component`
- `tool_name`
- `input_summary`
- `output_summary`
- `status`
- `started_at`
- `ended_at`
- `duration_ms`
- `error_message`
- `metadata`

Trace chỉ lưu summary PII-safe, không lưu raw row hoặc raw sensitive value.

## 3. Saved Report Chat Trace

Khi gọi `POST /api/v1/chat` với `run_id` của saved report, chat agent dùng tool-calling.

Các tool có thể xuất hiện trong trace:

- `get_report_overview`
- `get_schema`
- `get_nulls`
- `get_categorical_columns`
- `get_distribution`
- `get_findings`
- `get_pii`
- `get_correlations`
- `get_cardinality`
- `get_full_report`
- `saved_report_lookup_fallback`

Nếu LLM gọi đúng tool, trace sẽ có `event_type=tool_call` và `component=agent_chat`.

Nếu LLM lỗi hoặc không gọi tool, backend dùng fallback. Khi đó trace có `tool_name=saved_report_lookup_fallback` và metadata `fallback=true`.

## 4. Planning Trace

`POST /api/v1/profiling/plans` hiện tạo Agent Run riêng với `source_type=planning`.

Các tool có thể xuất hiện:

- `search_requirement_documents`
- `create_profiling_plan`
- `fallback_generate_profiling_plan`

Run metrics gồm:

- `user_id`
- `planning_mode`
- `tool_calls`
- `plan_items`
- `clarification_questions`

`planning_mode` có thể là:

- `llm_tool_calling`
- `deterministic_fallback`

## 5. Database Planning Trace

`POST /api/v1/profiling/database-plan` cũng tạo Agent Run riêng với `source_type=planning`.

Các tool có thể xuất hiện:

- `search_requirement_documents`
- `create_database_plan`
- `fallback_recommend_database_plan`

Run metrics gồm:

- `user_id`
- `planning_mode`
- `tool_calls`
- `recommended_tables`
- `clarification_questions`

## 6. Agent Tools API

`GET /api/v1/agent/tools` trả về catalog các tool mà hệ thống expose cho Agent/UI.

Catalog hiện gồm:

- Profiling workflow tools: `schema_inspection`, `column_profiling`, `correlation_analysis`, `pii_detection`, `hitl_proposal`, `report_generation`.
- Saved report tools: `get_schema`, `get_nulls`, `get_categorical_columns`, `get_distribution`, `get_findings`, `get_pii`, `get_correlations`, `get_cardinality`, `get_full_report`.
- Planning tools: `search_requirement_documents`, `create_profiling_plan`, `create_database_plan`.

## 7. APIs

### `GET /api/v1/agent/runs`

Lấy danh sách Agent Run. Hỗ trợ `limit`, `offset`, `user_id`.

### `GET /api/v1/agent/runs/{run_id}`

Lấy một Agent Run.

### `GET /api/v1/agent/runs/{run_id}/trace`

Lấy trace timeline của một run.

### `GET /api/v1/agent/traces`

Lấy trace events toàn hệ thống. Hỗ trợ `limit`, `offset`.

### `GET /api/v1/hitl`

Lấy danh sách HITL records. Có thể filter theo `status`, `run_id`, `user_id`.

### `POST /api/v1/hitl/{record_id}/approve`

Approve một HITL item.

### `POST /api/v1/hitl/{record_id}/reject`

Reject một HITL item.

## 8. Chat History

Chat history được lưu ở backend trong SQLite.

Frontend chỉ giữ:

- pseudonymous `user_id`
- active `conversation_id`

Các pattern PII phổ biến được mask trước khi lưu message hoặc trace.

## 9. Storage

Database mặc định:

```text
sqlite:///./data/app.db
```

Các bảng chính:

- `agent_runs`
- `trace_events`
- `hitl_records`
- `conversations`
- `chat_messages`
- `profile_reports`
- `knowledge_documents`
- `profiling_plans`
- `user_rules`

Khi deploy multi-instance, nên chuyển persistence sang PostgreSQL và thay browser user id bằng authenticated backend user identity.
