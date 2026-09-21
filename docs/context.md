# VDaAgent — Project Context for AI coding assistant

> Mục đích: cung cấp một context ngắn gọn nhưng đủ để một AI coding assistant hiểu VDaAgent trước khi trả lời, review hoặc sửa code.
>
> Snapshot của tài liệu: 2026-09-21. Khi tài liệu này khác với code/test hiện tại, **code và test hiện tại là source of truth**.

## 1. VDaAgent là gì?

VDaAgent là workspace phân tích tồn kho bất động sản theo chuỗi:

```text
Data → Analysis → Evidence → Insight → Report
```

MVP cho phép thành viên workspace:

- chọn project, zone tùy chọn và ngày dữ liệu;
- chạy phân tích tồn kho định lượng từ snapshot bất động sản đã đóng băng;
- xem metric, bảng unit, biểu đồ, evidence/lineage và report;
- dùng Agent Chat để tạo hoặc mở lại kết quả phân tích được cấp quyền;
- import CSV, lập lịch report và export report JSON/CSV qua private storage.

Đây là dữ liệu synthetic/provisional cho MVP (`Vinhomes Synthetic Demo`), chưa phải business truth.

## 2. Trạng thái hiện tại

- Monorepo TypeScript/pnpm/Turbo, version nội bộ `0.1.0`.
- Node.js `>=24`, pnpm `11.0.8`.
- Next.js `16.3.5`, React `19.3.0`, TypeScript `5.9.3`.
- Runtime duy nhất: Supabase Auth + PostgreSQL + Storage.
- Gemini là LLM provider chính; OpenAI là fallback. Provider chỉ được dùng trong ranh giới structured output/evidence đã định nghĩa.
- Agent Chat vertical slice đã có implementation trong code hiện tại: conversations/messages, typed decision, typed tools, idempotent turn, queue/worker/DAG, persisted assistant lifecycle và UI polling.
- Hạ tầng ngoài phạm vi MVP: Redis/Kafka/BullMQ, vector database, MCP/plugin runtime, xAI service, multi-agent loop, SSE/WebSocket/token streaming.
- Không có remote deployment hoặc external report delivery trong MVP; local Supabase là đường chạy được kiểm thử.

## 4. Cấu trúc repository


### Workspace packages

| Package | Trách nhiệm |
| --- | --- |
| `@vda/contracts` | Zod schemas cho request/response, runs, tasks, artifacts, metrics, reports, conversations, messages và Agent decisions. Đây là boundary typed giữa các layer. |
| `@vda/config` | Parse env và kiểm tra cấu hình Supabase/provider. |
| `@vda/db` | `SqlRepository`, auth/membership checks, transaction, idempotency, snapshot pinning, PostgreSQL queue, lease/fencing, messages/conversations, artifacts/reports. |
| `@vda/domain` | Parser/domain helpers và integrity primitives. |
| `@vda/semantic` | Sole authority của công thức metric, date/as-of selection, comparison, null/abstain và insight rules. |
| `@vda/agents` | DAG executor, chart builder, provider adapters, artifact/report validation, Agent Chat orchestrator và typed tools. |
| `@vda/worker` | Claim run, renew lease, gọi `executeLease`, scheduler tick và xử lý terminal failure. |
| `@vda/web` | Next.js UI, server BFF/API, Supabase Auth SSR và Agent Chat/workspace panels. |

## 5. Runtime architecture

```text
Browser / Workspace (Next.js client)
        │ same-origin /api/v1, Zod response parsing, no-store
        ▼
Next catch-all route → server/api.ts → principal() + Repository authorization
        │
        ▼
SqlRepository (Supabase PostgreSQL)
  ├─ conversations/messages
  ├─ runs/tasks/events
  ├─ snapshots/imports/artifacts/validations/reports
  └─ PostgreSQL queue with lease + fencing token
        │
        ▼
Worker → claimRun() → executeLease()
        │
        ▼
orchestrator → data → calculation → comparison → chart
              → insight → validation → report
        │
        ├─ @vda/semantic: deterministic values
        ├─ @vda/agents/integrity: hashes, lineage, claim grounding
        └─ canonical artifacts + report + evidence
```

Long-running analysis không chạy trong request HTTP. API enqueue một run; worker claim run bằng `FOR UPDATE SKIP LOCKED`, renew lease và dùng fencing token để stale worker không thể ghi terminal state. Browser polling run/tasks/events khoảng mỗi 1.1 giây trong MVP.

## 6. Analytics truth boundary

### As-of và scope

- `AnalysisRequestSchema` yêu cầu `org_id`, `scope`, `data_as_of`, `question`, và scope project.
- `scope.project_external_id` là bắt buộc; `zone_external_id` có thể null.
- Với mỗi unit, chọn bản snapshot mới nhất có `snapshot_date <= data_as_of`, sau đó áp dụng project/zone scope.
- Historical comparison cũng dùng latest-at-or-before target date; không yêu cầu snapshot đúng ngày.
- Run đóng băng snapshot membership lúc enqueue. Artifact immutable, hash và liên kết tới snapshot/import/query lineage.

### Semantic versions

- Semantic pack: `mvp-inventory-v0.2`.
- Artifact schema: `1.1`.
- Chart contract: `chart-spec-v1`.
- Chart rules: `chart-rules-v0.2`.
- Các assumption/formula hiện tại là provisional MVP.

### Metric groups hiện được hỗ trợ

- Inventory: `total_inventory`, `available_inventory`, `available_inventory_rate`.
- Snapshot-reported sales: `sold_units_7d`, `sold_units_30d`, `sold_units_90d`. Đây **không** phải authoritative transaction-ledger measure.
- Movement: `inventory_change_7d`, `inventory_change_30d`, `inventory_change_90d`.
- Aging: `median_inventory_age_days`, `p75_inventory_age_days`, `slow_moving_units`, `slow_moving_rate`, `unknown_inventory_age`, `unknown_inventory_age_rate`.
- Price: `median_price`, `median_price_per_area`, `p25_price_per_area`, `p75_price_per_area`, `price_per_area_iqr`.
- Data quality: `missing_inventory_age_rate`, `missing_price_rate`, `missing_area_rate`, `records_with_invalid_or_unusable_values`, `snapshot_coverage`.

Các rate là phần trăm 0–100. Null/abstain nghĩa là unavailable, không được đổi thành zero. Monetary/area metrics dùng decimal arithmetic và bắt buộc currency metadata nếu có giá trị. Nhiều currency hoặc zero denominator có thể làm metric/comparison abstain.

### Quy tắc nghiệp vụ quan trọng

- Aging buckets: `0-30`, `31-60`, `61-90`, `91-180`, `>180`, `unknown`.
- Slow-moving threshold mặc định là 90 ngày và là assumption có thể cấu hình.
- Breakdown hiện hỗ trợ `zone`, `unit_type`, `bedrooms`, `status` (project là enclosing scope).
- Unit peer comparison giữ cùng org/project/zone/unit type/bedrooms/currency, area trong ±15%, loại target và cần tối thiểu 3 peers. Không được silently widen cohort.
- Notable-change thresholds và top-N insight selection nằm trong semantic registry, không nằm ở UI/LLM.
- Chart chỉ được tạo từ calculation/comparison artifacts đã validate. Không chart point nào do LLM tạo.
- Mỗi claim có evidence path; validation reject invented/duplicate/missing claim IDs, path hoặc values.

### Deferred/unsupported analytics

Không được suy diễn các đầu ra sau từ snapshot hiện tại:

- authoritative sales velocity/decline;
- reservation conversion/cancellation;
- price-change event analytics;
- freshness SLA/stale rate khi chưa có SLA/cadence được phê duyệt;
- portfolio-wide project comparison;
- causal explanation.

Muốn thêm một metric cần contract typed, query/lineage frozen, deterministic semantic implementation, artifact/chart/report support và test; không chỉ sửa prompt.

## 7. Agent Chat hiện tại

Agent Chat là một lớp mỏng trên pipeline analytics hiện có, không phải một analytics engine thứ hai.

### Flow

```text
POST /api/v1/conversations[/:conversation_id]/messages
  → validate body + Idempotency-Key
  → startTurn(): persist user message + assistant placeholder
  → server-authoritative bounded context
  → one structured AgentDecision
  → at most one typed tool
       create_analysis → attach run → existing queue/worker/DAG
       get_analysis_result → authorized existing run/artifact refs only
       unsupported → deterministic honest response, no run
  → worker terminal transaction finalizes assistant placeholder
  → UI polls and hydrates canonical artifacts/report/evidence
```

Relevant files:

- `src/backend/packages/agents/src/chat.ts`: bounded context (`latest 12 messages`, latest authorized run refs, bounded chars), one-decision orchestrator, deterministic unsupported/error responses.
- `src/backend/packages/agents/src/tools.ts`: `create_analysis`, `get_analysis_result`, UI/API-only `cancelAnalysisTool`; re-authorize before mutation.
- `src/backend/packages/agents/src/provider.ts`: separate `AgentDecisionProvider` và `NarrativeProvider`; Gemini primary/OpenAI fallback; structured output, no raw provider error to client.
- `src/backend/packages/db/src/repository.ts` và `types.ts`: conversation/message pages, turn lifecycle, idempotency, attach/finalize, terminal state.
- `src/frontend/src/components/agent-chat/`: conversation list, message thread, composer, progress và orchestrator UI.
- `src/frontend/src/components/workspace.tsx`: owning shell; giữ scope/catalog và các panel analysis/reports/schedules/imports/history.

### Agent contract

`AgentDecisionSchema` chỉ cho phép:

- `create_analysis` với focus: `current_inventory`, `slow_moving`, `inventory_comparison`, `price_distribution`, `peer_comparison`, `full_report`;
- `get_analysis_result` với `run_id` đã nằm trong bounded authorized context;
- `unsupported` với reason code đã enum.

LLM không được tính metric, viết SQL, tạo ID/scope/permission/evidence/claim, đọc raw database rows hoặc tự loop. Provider chỉ quyết định route; analytics pipeline vẫn là nơi tính và tổng hợp.

Messages có `role`, `status`, `content` và typed reference-only `parts` (`text`, `run_ref`, `report_ref`, `artifact_ref`, `error`). Không copy metric values, chart series, evidence records hoặc hidden chain-of-thought vào message payload. Trạng thái gồm `submitted`, `in_progress`, `completed`, `failed`, `cancelled`.

Agent Chat dùng workspace-shared conversations theo organization membership; không phải private thread. Owner/analyst được tạo/cancel analysis; viewer read-only.

## 8. Auth, tenancy và security

- Supabase Auth là identity source. `src/frontend/src/server/context.ts` lấy principal từ Supabase hoặc development-only signed httpOnly role grant.
- Development role bypass chỉ dùng local development; không được coi là production auth.
- Mọi request được authorize theo `user_id + org_id`; client không được quyết định user, org, role hay quyền.
- Roles: `owner`, `analyst`, `viewer`. Owner/analyst có write mutation; viewer chỉ đọc.
- PostgreSQL RLS cho workspace membership. Authenticated client có SELECT theo membership; direct writes bị revoke; `service_role` dùng server-side.
- Mọi lookup/write phải có `org_id`; mọi tool phải re-authorize ngay trước execution.
- `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, LLM keys chỉ server/worker. Không in, commit hoặc gửi chúng vào prompt/browser/log.
- BFF có same-origin mutation guard, body size limit, Zod parse, private `no-store` headers và problem mapping.
- Report/source buckets là private; report download dùng short-lived BFF grant với membership revalidation.

## 9. API surface chính

Tất cả route nằm dưới `/api/v1` và response được parse bằng contract schema.

| Nhóm | Routes chính | Ghi chú |
| --- | --- | --- |
| Setup/Auth | `GET /setup`, `POST /auth/login`, `POST /auth/development-role`, `POST /auth/logout`, `GET /session` | Supabase/Auth local flow |
| Catalog | `GET /catalog?org_id=...` | projects/zones/latest snapshot |
| Analysis | `POST /analyses`, `GET /runs`, `GET /runs/:id`, `GET /runs/:id/artifacts`, `POST /runs/:id/cancel` | Legacy/direct analysis vẫn được giữ |
| Agent Chat | `GET /conversations`, `POST /conversations`, `GET /conversations/:id`, `GET/POST /conversations/:id/messages` | POST cần `Idempotency-Key`; body `AgentTurnRequestSchema` |
| Legacy messages | `GET /messages?org_id=...&conversation_id=...` | Compatibility path |
| Data | `GET/POST /imports` | CSV import có lineage/private storage |
| Reports | `GET /reports`, `GET /reports/:id`, `POST /reports/:id/exports`, `GET /reports/:id/download` | JSON/CSV signed download |
| Schedules | `GET/POST /report-definitions`, `PATCH/DELETE /report-definitions/:id`, `POST /report-definitions/:id/trigger`, `POST /scheduler/tick` | Scheduled runs là entrypoint riêng |

## 10. Database model và migration

Các record chính trong schema `src/backend/supabase/schemas/001_inventory.sql` và additive Agent Chat schema `005_agent_chat.sql`:

`organizations`, `organization_members`, `imports`, `snapshots`, `conversations`, `runs`, `run_snapshots`, `tasks`, `artifacts`, `artifact_inputs`, `artifact_snapshots`, `artifact_sources`, `validations`, `events`, `messages`, `definitions`, `occurrences`, `reports`, `report_exports`.

Agent Chat migration bổ sung metadata conversation (`kind`, `title`, timestamps), message lifecycle (`run_id` nullable, `client_turn_id`, `role`, `status`, timestamps), partial/compound indexes và direct-write policy giữ nguyên. Migration thực tế là `src/backend/supabase/migrations/20260920170143_agent_chat.sql`; nếu sửa database, edit declarative schema trước, dùng Supabase CLI generate/review migration và test fresh/upgrade + pgTAP.
