# VDaAgent — Tóm tắt kỹ thuật

VDaAgent là workspace profiling và phân tích trực quan theo hướng
**evidence-first**. Đơn vị ngữ cảnh của sản phẩm là **Profile Run** thuộc một
workspace; không phải một notebook hoặc một truy vấn độc lập.

Hướng dẫn cài đặt, cấu hình và API rút gọn: [README.md](../README.md).
Thiết kế thành phần và data flow: [ARCHITECTURE.md](../ARCHITECTURE.md).

## 1. Phạm vi sản phẩm hiện tại

Ứng dụng nhận CSV, TSV, Parquet và JSON; tạo profile deterministic cho schema,
quality và privacy; cho phép Analyst review proposal metadata/PII còn chờ; rồi
sử dụng Profile Run hoàn tất làm nguồn cho biểu đồ, Agent và báo cáo.

```text
Upload dataset
  → Profile Run (sample hoặc full)
  → Review semantic type / candidate key / PII khi cần
  → completed
      ├─ /charts: plan → Preview → Official evidence → insight
      ├─ /profiles/{runId}: Tổng quan, Hỏi Agent, Báo cáo
      └─ Report Draft → snapshot bất biến → PDF/JSON
```

`/charts` là workspace biểu đồ riêng, dùng cùng Profile Run và Report Draft.
Command Center tại `/profiles/{runId}` hiện có ba vùng Tổng quan, Hỏi Agent và
Báo cáo. `/analyses` và `/notebooks` vẫn tồn tại trong compatibility window,
nhưng không phải luồng được navigation chính quảng bá.

### Invariant cốt lõi

- Mỗi request nhạy cảm phải resolve user, workspace và capability ở backend.
- Cột PII đã xác nhận bị loại khỏi context chart/Agent; raw row không được trả
  qua Explorer, UI, report hay MCP tool.
- Browser chỉ gửi `QuerySpec` có cấu trúc, không gửi raw SQL/Python/shell.
- Preview là kết quả giới hạn; chỉ Official execution có `result_hash` và
  provenance mới đủ điều kiện ghim vào report.
- PDF/JSON lấy từ Report Snapshot bất biến, không dựng lại từ UI state live.

## 2. Runtime và ownership

| Lớp | Thành phần hiện dùng | Trách nhiệm |
| --- | --- | --- |
| Web | Next.js 15, React 19, React Query | Auth phía browser, profile pages, `/charts`, SSE và PDF route cùng origin |
| API | FastAPI | Route, auth/workspace guard, capability, audit, profile, analysis, report |
| Agent | LangGraph, native skill registry | Profiling/Q&A, structured chart-planning và trace/provenance tùy cấu hình |
| Compute | DuckDB, pandas, NumPy, SciPy | Profiling, aggregate bounded, quality/statistics và chuẩn bị dữ liệu forecast |
| Forecast | statsmodels/scikit-learn; dependency tùy chọn | Thực thi model khi catalog xác nhận model khả dụng |
| Metadata | PostgreSQL/Supabase PostgreSQL | Workspace, dataset metadata, Profile Run, evidence, draft/snapshot, audit, agent trace |
| File storage | Supabase Storage, Google Drive hoặc local dev | Binary dataset; compute chỉ materialize file tạm khi cần |

Frontend gọi FastAPI qua `NEXT_PUBLIC_API_URL`, gửi bearer token và
`X-Workspace-Id`. Next.js PDF route là ngoại lệ: server Next.js lấy export
source đã được FastAPI cấp quyền rồi render PDF.

Supabase Auth quản lý identity/session. PostgreSQL là nguồn sự thật cho dữ liệu
nghiệp vụ. Không có cloud warehouse (BigQuery/Snowflake) hoặc vector database
được triển khai như data compute backend hiện tại; knowledge-base retrieval là
khả năng nội bộ có thể cấu hình.

## 3. Profiling và review

`POST /datasets/upload` lưu file theo storage provider đã cấu hình và tạo
metadata workspace-scoped. `POST /profile` chạy graph profiling đến checkpoint
review. Các metric/proposal được tạo bằng compute deterministic; narrative chỉ
là diễn giải khi LLM provider khả dụng.

Analyst dùng `PATCH /profile/{run_id}/confirm` để xác nhận, sửa hoặc từ chối
proposal. Các workflow evidence như chart/Explorer yêu cầu Profile Run có
trạng thái `completed`.

Profile giữ row/column count, scan mode, sampling metadata, column statistics,
correlation, risk warnings, proposal, test result và provenance. Sample run
phù hợp khám phá nhanh; `full` mới là phạm vi đầy đủ của file source đã pin.

## 4. Charts, bounded analysis và forecast

### Chart workflow

1. `/charts` chọn Profile Run đã hoàn tất và gọi
   `POST /profile/{run_id}/explorer/session` để lấy/tạo Explorer context nội
   bộ theo profile.
2. Người dùng nhập một hoặc nhiều câu hỏi, hoặc yêu cầu profile pack tự động.
   `POST /profile/{run_id}/charts/auto-plan` tạo một ChartPlan;
   `POST /profile/{run_id}/charts/auto-profile-pack` tạo nhiều plan dựa trên
   metadata profile.
3. Planner LLM chỉ được nhận dimension/measure đã duyệt và thống kê an toàn.
   Nếu provider lỗi hoặc không cấu hình, planner quy tắc tạo fallback bounded.
4. Client gửi plan qua Preview. Backend enforce allow-list, cột hợp lệ, PII
   policy, số dimension, giới hạn thời gian/row/result và idempotency key.
5. Promote Preview thành Official chỉ khi context không stale và quality gate
   cho phép. Official chạy lại, lưu execution, evidence/result hash, limitation
   và provenance.
6. Renderer native nhận aggregate result; Agent có thể viết insight đã bind vào
   Official execution. Chart/insight được ghim vào Report Draft sau review.

### Loại biểu đồ và truy vấn

`QuerySpec.analysis_kind` chỉ nhận aggregate, histogram, scatter, box, heatmap,
forecast, missing bar/heatmap, correlation heatmap, cardinality, violin, donut
và outlier. UI render 15 chart type native: line, bar, table, KPI, histogram,
scatter, box, heatmap, missing bar/heatmap, correlation heatmap, cardinality,
violin, donut và outlier.

Khung Preview/Official là boundary chung cho cả Explorer và Charts. Preview có
thể approximate hoặc hết hạn; các lỗi như `explorer_timeout`, `context_stale`,
`preview_expired` và quality-gate block là trạng thái nghiệp vụ có chủ đích.

### Forecasting

Catalog gồm 30 model thuộc baseline, exponential smoothing, ARIMA, state space,
decomposable và machine learning. `GET /profile/{run_id}/charts/algorithms`
trả trạng thái `available` cho từng model. Model chưa cài dependency hoặc cần
biến ngoại sinh trong tương lai không được thực thi. Forecast yêu cầu một time
dimension, time grain, model allow-list và lịch sử đủ dài; kết quả luôn phải nêu
interval/cảnh báo, không được xem là giá trị chắc chắn.

## 5. Agent, evidence và MCP

Q&A hoạt động trong phạm vi Profile Run. `POST /qa` và `POST /qa/stream` chỉ
truy cập evidence mà caller có quyền đọc; câu trả lời thiếu evidence phải được
hiển thị như hạn chế và không được xem là kết luận đã kiểm chứng.

Agent trace là lớp quan sát bổ sung. Config hiện đặt `AGENT_TRACE_MODE=shadow`:
trace đã redact được ghi mà không thay đổi nguồn kết quả deterministic. Trace
không chứa raw prompt/message, chain-of-thought, raw row, secret hay giá trị
PII. Planner autonomy, verifier `enforce`, durable jobs và long-term memory là
feature-gated, chưa là workflow phát hành.

`backend/src/mcp_server.py` chạy FastMCP qua **stdio** cho trusted local
process. Tool profile/chart đều cần `profile_run_id`, dùng allow-list và không
trả raw data. MCP stdio không thay thế route HTTP có auth/workspace context và
không nên mở thành endpoint public.

## 6. Báo cáo và export

Report Draft thuộc đúng Profile Run. API đọc/tạo draft là
`GET/POST /profile/{run_id}/report-draft`; `POST /reports/{report_id}/items`
ghim chart/note đã hợp lệ; `POST /reports/{report_id}/snapshots` đóng băng một
snapshot. `GET /reports/{report_id}/export-source` chỉ trả source snapshot đã
được cấp quyền.

Route Next.js `/api/reports/profile/{runId}?reportId={reportId}` render PDF từ
snapshot. Report không đưa raw PII, raw row, preview history hoặc execution
không chính thức vào export.

## 7. Cấu hình vận hành cần biết

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | PostgreSQL bắt buộc cho ứng dụng |
| `NEXT_PUBLIC_API_URL` | Base URL FastAPI được nhúng khi build frontend |
| `UX_COMMAND_CENTER_ENABLED` / `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` | Bật contract backend và UI Command Center; biến frontend cần build lại |
| `AUTH_MODE` | Local có thể dùng `dual`; production phải dùng `supabase` |
| `STORAGE_PROVIDER` | `supabase`, `google_drive` hoặc `local` cho development/test |
| `AGENT_TRACE_MODE` | `off`, `shadow` hoặc `required`; chỉ dùng `required` khi trace DB đã được giám sát |

Không đặt database URL, Supabase secret/service key, OAuth secret, storage
credential hay LLM key vào `NEXT_PUBLIC_*`. Guest trial là workspace tạm với
retention riêng, không phải cơ chế lưu trữ production.

## 8. API rút gọn

| Domain | Endpoint |
| --- | --- |
| Dataset/profile | `POST /datasets/upload`, `GET /datasets`, `POST /profile`, `PATCH /profile/{run_id}/confirm` |
| Charts | `POST /profile/{run_id}/charts/auto-plan`, `POST /profile/{run_id}/charts/auto-profile-pack`, `GET /profile/{run_id}/charts/algorithms` |
| Explorer | `POST /profile/{run_id}/explorer/session`, `POST /profile/{run_id}/explorer/previews`, `POST /profile/{run_id}/explorer/previews/{preview_id}/promote` |
| Agent | `POST /qa`, `POST /qa/stream`, `GET /agent-runs/{run_id}/evidence` |
| Report | `GET/POST /profile/{run_id}/report-draft`, `POST /reports/{report_id}/items`, `POST /reports/{report_id}/snapshots` |

Mọi endpoint backend dùng prefix `/api/v1`.

## 9. Kiểm thử

Từ `frontend/`, chạy `pnpm typecheck`, `pnpm lint`, `pnpm test` và `pnpm build`.
Từ root, đặt một `P170_TEST_DATABASE_URL` riêng trước khi chạy `pytest`; không
bao giờ chạy test ghi dữ liệu vào database development/production. Smoke check
cho production chart flow nằm tại `scripts/chart_production_smoke.py`.
