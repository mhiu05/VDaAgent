# Tóm tắt bàn giao VDaAgent (P-170)

Trang này chụp trạng thái implementation tại ngày 2026-08-31 để maintainer biết hệ thống thực sự làm gì và điểm nào chưa phải product guarantee. Cổng tài liệu là [docs/README.md](README.md), còn kiến trúc cấp cao ở [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Luồng sản phẩm hiện tại

1. Người dùng xác thực, backend đồng bộ account projection và resolve một workspace active.
2. Analyst upload file hoặc tạo dataset từ connector MySQL/MongoDB/DuckDB.
3. API tạo Profile Run/queue record và trả HTTP 202; worker riêng xử lý source.
4. DuckDB profile source file-backed, lưu aggregate/proposal và dừng ở HITL khi còn review.
5. Analyst confirm/reject/edit/request test; resume cũng được đưa lại vào durable queue.
6. Profile completed có thể mở Command Center, tạo chart plan, Preview và Official execution.
7. QA chỉ kết luận khi có evidence phù hợp; chart insight phải bind Official execution.
8. Drift so sánh các thống kê đã lưu; report pin evidence vào draft, snapshot rồi export PDF.

## Stack và trạng thái kỹ thuật

- Frontend: Next.js 15, React 19, TypeScript, TanStack Query, Vitest và Playwright.
- Backend: Python 3.11, FastAPI, Pydantic, SQLAlchemy/Alembic và LangGraph.
- Compute: DuckDB file-backed; pandas/NumPy/SciPy/statsmodels/scikit-learn và các forecast backend tùy deployment.
- Persistence: PostgreSQL bắt buộc; LangGraph checkpointer cũng dùng PostgreSQL.
- Storage: Supabase Storage, Google Drive hoặc local development storage.
- Authentication: Supabase JWT ở production; `dual`/guest là compatibility hoặc trial path.
- Deployment: Azure App Service containers + ACR qua workflow GitHub Actions.
- Migration head: `20260831_0022`, gồm schema parity và backend-only Supabase Data API boundary.

## Giới hạn mặc định đáng nhớ

| Phạm vi | Giá trị mặc định/contract |
| --- | --- |
| Profiling sample | 10.000 row, reservoir, seed 42 |
| Số cột profile | tối đa 200; cột dư được ghi vào warning |
| Batch profiling | 1–20 dataset ID duy nhất |
| Profile/QA question | tối đa 2.000 ký tự |
| QA history | nhận tối đa 20 message, graph dùng 12 message cuối |
| Tool/deep analysis | 10 tool call/request; tối đa 5 vòng deep analysis |
| Preview | row budget 50.000, result 50, timeout 60 giây, expiry 1 giờ |
| Official | result tối đa 500, hiện dùng cùng timeout 60 giây |
| QuerySpec | 12 columns, 3 dimensions, 20 filters, limit tối đa 500 |
| Worker | concurrency 1, poll 1 giây, lease 300 giây, 3 attempt |
| Profiling SSE | polling backoff 1 → 2 → 3 → 5 giây; keepalive 10 giây |
| Upload | authenticated 500 MB; guest 25 MB theo default |

Giá trị hiệu lực luôn là environment override → `config.yaml` → code default. Không coi bảng này là invariant nếu deployment đã override.

## Những thay đổi mới đã phản ánh

- Profiling CSV/TSV/Parquet/JSON chạy aggregate trực tiếp trong DuckDB trên file tạm; full DataFrame không còn được giữ cho pipeline chính.
- Remote source được stream với byte limit và cleanup; statistical test chỉ reload các cột được yêu cầu.
- Candidate-key và data-quality QA có deterministic prefetch/render path; validator fail-closed kiểm tra workspace/run, artifact, citation và số trong answer.
- Retrieval profile/external có thể chạy song song; chart planner bỏ qua model khi intent an toàn có thể lập kế hoạch deterministic.
- AI latency log tách router/planner/retrieval/tool/evidence/model/validation và TTFT.
- Profiling SSE giảm query nền bằng adaptive backoff, reset khi state đổi và ngừng đọc khi client disconnect.
- Supabase Data API không cấp direct table access cho browser roles; migration/test bảo vệ inventory này.

## Known gaps cần giữ nguyên trong tài liệu

### Report submit không tạo review step

`POST /api/v1/reports/{report_id}/submit` gọi `ReportService.submit_report`, nhưng service gọi thẳng `Repository.publish_report`. Public submit vì vậy publish ngay. Repository vẫn có `submit_report` và API vẫn có `/review`, song hai path chưa tạo thành chuỗi Analyst submit → reviewer approve.

Role workspace duy nhất `analyst` đồng thời có `report.submit`, `report.review` và `report.publish`. Flag `report_separation_of_duties` được lưu trong workspace configuration nhưng chưa được lifecycle service enforce.

### Report list/get không chỉ trả published

Handler có tên `list_published_reports` và `get_published_report` dùng `published_only=False`. List loại latest version `rejected`, trong khi get/export-source không áp dụng filter tương đương. UI/library có thể thấy draft hoặc in-review; lookup trực tiếp có thể đọc report rejected nếu caller có permission.

### Drift không bắt buộc cùng dataset

Route drift chỉ yêu cầu hai run khác nhau, cùng workspace và đều `completed`; chưa kiểm tra `dataset_id` giống nhau. UI hiện cũng có thể chọn run từ hai dataset. Kết quả như vậy là behavior được phép hiện tại, không phải guarantee về comparability.

### Promotion tự approve context draft

Promote Preview tự approve context hiện tại bằng actor nếu context còn `draft`, rồi mới chạy quality gate/Official. Generic `POST /analysis-sessions/{id}/executions` lại yêu cầu context đã approved. Governance giữa hai path chưa đồng nhất.

### HITL low-risk chưa có allow-list ở Settings

Default chỉ chứa `semantic_type`, nhưng `HITL_LOW_RISK_TYPES` nhận list string tự do. Node auto-confirm duyệt cả candidate key, semantic type và PII rồi tin cấu hình; misconfiguration có thể nới policy ngoài ý định.

### Evaluation staging hiện có đã cũ so với các fix mới

`evaluations/results/latest_scorecard.md` là staging run tại commit `6717254...`, đạt 17/17 HTTP 200 nhưng FAIL evidence/planner/latency gates. Các commit hiện tại đã sửa candidate-key/quality evidence và PII-safe planning, nhưng repository chưa có staging scorecard mới chứng minh các gate đã pass. Không dùng unit test hoặc local latency benchmark thay thế một rerun staging authenticated.

### Workflow còn tham chiếu đường dẫn tài liệu cũ

Thông báo lỗi trong bước validate production configuration vẫn trỏ tới `docs/azure-deploy-cicd.md`, file đã được hợp nhất vào [deployment](operations/deployment.md). Đây là stale reference trong YAML, không phải link còn tồn tại trong bộ Markdown.

### Cấu hình có default ở nhiều lớp

`config.yaml` chọn Gemini/Voyage và bật external knowledge; code default riêng lại dùng local embedding và tắt external knowledge nếu không nhận YAML. `LANGSMITH_DATA_MODE` nhận `sanitized_content`, nhưng adapter hiện vẫn ẩn input/output và chỉ gửi metadata allow-list. Luôn kiểm tra effective settings thay vì suy luận từ một file.

## Checklist bàn giao

- Chạy migration smoke và database security assertion khi đổi schema/access boundary.
- Chạy focused pytest, sau đó full pytest phù hợp với phạm vi thay đổi.
- Chạy `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` và Playwright cho frontend.
- Chạy evaluation dry-run/offline để kiểm tra harness; rerun staging synthetic sau thay đổi QA/planner.
- Kiểm tra health của API, worker và frontend; dùng correlation ID/telemetry thay vì log raw payload.
- Khi đổi data flow, kiểm tra lại workspace predicate, PII masking, approximation, evidence binding, idempotency và cleanup file tạm.
