# VDaAgent — Tóm tắt kỹ thuật

VDaAgent là workspace profiling và phân tích trực quan theo hướng
**evidence-first**. Đơn vị ngữ cảnh là **Profile Run** thuộc một workspace;
không phải notebook hay một truy vấn độc lập.

Hướng dẫn cài đặt và API: [README.md](../README.md). Thiết kế data flow và ranh
giới runtime: [ARCHITECTURE.md](../ARCHITECTURE.md).

## 1. Phạm vi sản phẩm hiện tại

Ứng dụng nhận CSV, TSV, Parquet và JSON; tạo profile deterministic cho schema,
quality và privacy; cho phép Analyst review proposal metadata/PII; sau đó dùng
Profile Run hoàn tất làm nguồn cho chart, Agent, compare và report.

```text
Đăng nhập Supabase / guest trial
  → workspace
  → upload dataset
  → POST /profile trả 202
  → worker claim và profiling deterministic
  → pending review semantic type / candidate key / PII nếu cần
  → worker resume từ checkpoint → completed
      ├─ /charts: plan → Preview → Official evidence → insight
      ├─ /chat: hỏi Agent theo Profile Run
      ├─ /compare: drift giữa hai Profile Run
      └─ Report Draft → snapshot bất biến → PDF/JSON
```

Frontend hiện có public/auth routes, analyst workspace routes và system admin
route. Admin không có login page riêng: admin cũng đăng nhập tại `/login`, sau
đó `/admin` được mở theo permission `user.accounts.read`.

### Invariant cốt lõi

- Backend luôn resolve user, workspace và capability trước request nhạy cảm.
- PII đã xác nhận bị loại khỏi context chart/Agent; raw row không được trả qua
  Explorer, UI, report hay MCP tool.
- Browser chỉ gửi `QuerySpec` có cấu trúc; không gửi raw SQL/Python/shell.
- Preview là kết quả giới hạn; chỉ Official execution có `result_hash`,
  provenance và context binding mới đủ điều kiện ghim vào report.
- PDF/JSON ưu tiên Report Snapshot bất biến, không dựng lại từ UI state live.
- System role `admin` có toàn bộ quyền Analyst cộng quyền quản trị user/system;
  workspace membership vẫn được chuẩn hóa về role `analyst`.

## 2. Runtime và ownership

| Lớp | Thành phần hiện dùng | Trách nhiệm |
| --- | --- | --- |
| Web | Next.js 15, React 19, React Query | Auth browser, workspace bootstrap, UI profile/charts/chat/report/admin, SSE và PDF route |
| Auth | Supabase Auth/SSR/PKCE | Identity, email/password login, signup/confirmation, session và token |
| API | FastAPI | REST/SSE, auth/workspace guard, capability, audit, job submission, analysis, report và admin API |
| Worker | Python profiling worker | Claim job/continuation bằng lease, retry hữu hạn, profiling và HITL resume |
| Agent | LangGraph, native skill registry | Profiling/Q&A, chart planning và trace/provenance đã redact tùy cấu hình |
| Compute | DuckDB, pandas, NumPy, SciPy | Profiling, aggregate bounded, quality/statistics, drift và forecast adapter |
| Metadata | PostgreSQL/Supabase PostgreSQL | User profile, workspace, membership, dataset metadata, Profile Run, evidence, report, audit, trace |
| File storage | Supabase Storage, Google Drive hoặc local | Binary dataset; compute materialize file tạm khi cần |

Frontend gọi FastAPI qua `NEXT_PUBLIC_API_URL`, gửi Bearer token và
`X-Workspace-Id`. `frontend/next.config.ts` chỉ forward allow-list biến public;
mọi thay đổi `NEXT_PUBLIC_*` cần build/restart frontend. Next.js PDF route là
ngoại lệ: server Next.js gọi export source đã được FastAPI cấp quyền rồi render
PDF.

### Workspace bootstrap và auth

`GET /workspace-bootstrap` trả trong một round trip user đã xác thực, workspace
được chọn, danh sách workspace, `effective_permissions` và dashboard summary
(counts cùng tối đa 12 report gần nhất). Frontend seed dashboard cache theo
workspace; cache stale sau 30 giây, giữ 10 phút và xóa khi đổi workspace.

Supabase token được backend verify bằng JWKS/Auth API. `AUTH_MODE=dual` chỉ là
compatibility path cho local/migration; production dùng `AUTH_MODE=supabase`.
`AUTH_REQUIRE_EMAIL_CONFIRMED=true` chặn session chưa xác nhận email.

System role được lưu trong `user_profiles.role` (`analyst` hoặc `admin`). Email
trong `GLOBAL_ADMIN_EMAILS` được seed thành admin khi user profile sync. Admin
API đọc toàn bộ user và cho phép đổi trạng thái, đổi role hoặc xóa tài khoản,
với audit event và guard chống tự khóa/tự xóa. Workspace invitation chỉ cấp
Analyst, không cấp system admin.

Backend dùng join/aggregate cho bootstrap và mọi endpoint sau bootstrap vẫn
kiểm tra workspace/capability. Telemetry chỉ ghi route, status, duration,
correlation ID và timing breakdown; không ghi token, email hay payload.

Không có BigQuery/Snowflake hoặc vector database được triển khai như compute
backend hiện tại. Knowledge-base retrieval là khả năng nội bộ tùy cấu hình.

## 3. Profiling và review

`POST /datasets/upload` lưu file theo storage provider và tạo metadata
workspace-scoped. `POST /profile` yêu cầu `Idempotency-Key`, lưu Profile Run/job
bền vững rồi trả `202 Accepted`. Client theo dõi job qua
`GET /profiling-jobs/{job_id}` với trạng thái `queued`, `running`, `succeeded`
hoặc `failed`.

Trạng thái queue khác trạng thái nghiệp vụ của Profile Run: job `succeeded` có
thể để run ở `pending_review`; run chỉ thành `completed` sau review và
continuation. Worker claim job từ PostgreSQL bằng `SKIP LOCKED`, gia hạn lease,
retry lỗi tạm thời và resume LangGraph checkpoint. API không chạy profiling
graph trực tiếp trong request.

Analyst dùng `PATCH /profile/{run_id}/confirm` để xác nhận, sửa hoặc từ chối
proposal. Quyết định được lưu nguyên tử và continuation được enqueue để worker
resume. Chart/Explorer/Agent yêu cầu Profile Run `completed` và context phù hợp.

Profile lưu row/column count, scan mode, sampling metadata, column statistics,
correlation, risk warning, proposal, test result và provenance. Sample phù hợp
khám phá nhanh; `full` bao phủ file source đã pin.

## 4. Charts, bounded analysis và forecast

### Chart workflow

1. `/charts` chọn Profile Run `completed` và gọi
   `POST /profile/{run_id}/explorer/session` để lấy/tạo Explorer context.
2. Người dùng nhập câu hỏi hoặc yêu cầu profile pack. Backend tạo plan qua
   `POST /profile/{run_id}/charts/auto-plan` hoặc
   `POST /profile/{run_id}/charts/auto-profile-pack`.
3. Planner LLM chỉ nhận dimension/measure và metadata an toàn. Khi provider
   lỗi hoặc không cấu hình, planner quy tắc tạo fallback bounded.
4. Backend validate `QuerySpec`: allow-list cột/analysis kind/aggregation,
   PII policy, dimension, time grain, timeout, row/result budget và idempotency.
5. Preview có thể approximate hoặc hết hạn. Promote Preview sẽ kiểm tra
   context/quality gate rồi chạy Official, lưu execution, result hash,
   limitation và provenance.
6. Renderer native hiển thị aggregate result. Insight của Agent phải bind vào
   Official execution và được người dùng review trước khi ghim Report Draft.

Analysis kind hiện có: aggregate, histogram, scatter, box, heatmap, forecast,
missing bar/heatmap, correlation heatmap, cardinality, violin, donut và
outlier. Chart renderer phát hành 15 loại: line, bar, table, KPI, histogram,
scatter, box, heatmap, missing bar/heatmap, correlation heatmap, cardinality,
violin, donut và outlier.

### Forecasting

Registry hiện có **28 model** thuộc baseline, exponential smoothing, ARIMA,
state-space, decomposable và machine learning. `GET
/profile/{run_id}/charts/algorithms` trả catalog kèm `available` và lý do nếu
model thiếu dependency. Forecast yêu cầu time dimension, time grain, lịch sử
đủ dài và horizon trong giới hạn; model cần future exogenous input không được
thực thi. Kết quả luôn kèm interval/cảnh báo.

## 5. Agent, evidence và MCP

Calendar MCP cho Analyst được triển khai qua Google Calendar OAuth. UI/API và
MCP stdio dùng chung các tool list/create/delete, token mã hóa được lưu theo
workspace + user, và permission calendar.read/calendar.write được kiểm tra
trước mọi thao tác. Xem [hướng dẫn Google Calendar MCP](google-calendar-mcp.md)
để cấu hình Google Cloud, local, Azure và MCP client.

Q&A hoạt động trong phạm vi Profile Run. `POST /qa` và `POST /qa/stream` chỉ
được đọc evidence mà caller có quyền; câu trả lời thiếu evidence phải được
hiển thị như limitation, không phải kết luận đã kiểm chứng.

Trace là lớp quan sát bổ sung, không thay thế deterministic compute. Với
`AGENT_TRACE_MODE=shadow`, PostgreSQL lưu provenance đã redact; không lưu raw
prompt/message, chain-of-thought, raw row, PII, secret hay file path. LangSmith
là projection tùy chọn, fail-open và metadata-only; PostgreSQL vẫn là nguồn
trace có thẩm quyền.

Short-term conversation memory is implemented for Q&A. The frontend sends a
bounded recent history, the API caps the accepted history, and the backend uses
only the latest eight messages with per-message truncation. This context is
scoped to the current request/conversation and is not long-term workspace or
personal memory.

`backend/src/mcp_server.py` chạy FastMCP qua **stdio** cho trusted local
process. Tool profile/chart dùng allow-list, yêu cầu Profile Run và không trả
raw data. MCP stdio không thay thế HTTP auth/workspace và không được mở thành
public endpoint.

Planner autonomy, verifier `enforce`, circuit breaker và long-term memory là
feature-gated, chưa phải workflow phát hành mặc định. Hủy profile job cũng
chưa được hỗ trợ vì compute chưa có cooperative cancellation checkpoint an
toàn.

## 6. Báo cáo và export

Report Draft thuộc đúng Profile Run. API đọc/tạo draft tại
`GET/POST /profile/{run_id}/report-draft`; item chart/note đi qua
`POST /reports/{report_id}/items`; snapshot được tạo bằng
`POST /reports/{report_id}/snapshots`. `GET /reports/{report_id}/export-source`
ưu tiên snapshot đã được cấp quyền.

Trước snapshot đầu tiên, export source có thể trả draft hiện tại với
`snapshot_hash: draft` để trang detail vẫn mở được; trạng thái này không phải
báo cáo chính thức. Sau snapshot, report hỗ trợ submit, review, publish và
archive. PDF được render từ route Next.js
`/api/reports/profile/{runId}?reportId={reportId}` sau khi FastAPI authorize
export source.

## 7. Cấu hình vận hành cần biết

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` / `DATABASE_CHECKPOINTER_URL` | PostgreSQL metadata và LangGraph checkpoint |
| `AUTH_MODE` | `dual` cho local/migration, `supabase` cho production |
| `AUTH_ALLOW_SIGNUP` / `AUTH_ALLOW_GUEST` | Signup và guest trial |
| `AUTH_REQUIRE_EMAIL_CONFIRMED` | Bắt buộc email confirmation |
| `GLOBAL_ADMIN_EMAILS` | Email được seed system admin |
| `STORAGE_PROVIDER` / `GUEST_STORAGE_PROVIDER` | `supabase`, `google_drive` hoặc `local` tùy môi trường |
| `UX_COMMAND_CENTER_ENABLED` / `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` | Contract backend và UI Command Center |
| `AGENT_TRACE_MODE` | `off`, `shadow` hoặc `required` |
| `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT` | Projection trace metadata-only tùy chọn |
| `GOOGLE_DRIVE_*` | OAuth/storage Google Drive tùy chọn |

Không đặt database URL, Supabase service/secret key, OAuth secret, storage
credential hoặc LLM key trong `NEXT_PUBLIC_*`. Guest workspace có retention
riêng và không phải storage production lâu dài.

## 8. API rút gọn

Mọi endpoint FastAPI dùng prefix `/api/v1`.

| Domain | Endpoint tiêu biểu |
| --- | --- |
| Auth/workspace | `GET /session`, `GET /me`, `GET /workspace-bootstrap`, workspace/member/invitation/configuration endpoints |
| Dataset/profile | `POST /datasets/upload`, `GET /datasets`, `POST /profile` (`202`), `GET /profiling-jobs/{job_id}`, `PATCH /profile/{run_id}/confirm`, `POST /profile/{run_id}/test` |
| Drift | `POST /profile/{run_id}/drift` |
| Charts/Explorer | auto-plan, auto-profile-pack, algorithms, session, previews và promote endpoints |
| Agent | `POST /qa`, `POST /qa/stream`, `GET /agent-runs/{run_id}`, trace, plan và evidence endpoints |
| Reports | report-draft, items, snapshots, export-source, submit, review, publish, archive |
| Admin | `GET /admin/users`, status, role và delete user endpoints |
| Google Drive | status, connect, callback và delete connection endpoints |

## 9. Kiểm thử và release

Từ `frontend/`, chạy `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm test:e2e` và `pnpm build`. Từ root, đặt `P170_TEST_DATABASE_URL` riêng và
khác `DATABASE_URL` trước khi chạy `pytest`; test có thể chạy migration và ghi
fixture.

CI chạy Ruff, pytest với PostgreSQL service, evaluation `--dry-run`/`--offline`,
Vitest, typecheck, lint, Playwright E2E và frontend build. Workflow Azure sau
quality gate build/push backend và frontend image, chạy Alembic migration, cập
nhật ba App Service process và health-check API/worker/frontend.

Đánh giá latency workspace phải chạy bundle/image đã precompile (`pnpm build`
rồi `pnpm start`, hoặc frontend container candidate). HMR và route compile của
`pnpm dev` là chi phí development, không phải production regression.
