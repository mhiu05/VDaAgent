# Tóm tắt bàn giao VDaAgent (P-170)

> Snapshot implementation được kiểm tra ngày 2026-09-01. Nội dung phản ánh code/migration/test hiện có, không phải cam kết SLA hay trạng thái production.

Trang này chụp trạng thái implementation tại ngày 2026-09-01 để maintainer biết hệ thống thực sự làm gì và điểm nào chưa phải product guarantee. Cổng tài liệu là [docs/README.md](README.md), còn kiến trúc cấp cao ở [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Luồng sản phẩm hiện tại

1. Người dùng xác thực, backend đồng bộ account projection và resolve một workspace active.
2. Analyst upload file hoặc import từ Drive/MySQL/MongoDB/DuckDB; ingestion verify rồi finalize thành canonical Supabase artifact (local trong development/test).
3. API chỉ tạo Profile Run/queue record khi dataset ready và snapshot chính xác `artifact_id`; worker retry luôn dùng artifact đó.
4. DuckDB profile source file-backed, lưu aggregate/proposal và dừng ở HITL khi còn review.
5. Analyst confirm/reject/edit/request test; resume cũng được đưa lại vào durable queue.
6. Profile completed mở `/profiles/{runId}/preview` để xem tóm tắt Agent; từ preview có thể đi tới `/charts?runId={runId}` để tạo chart plan, Preview và Official execution.
7. Chat Agent trả lời qua REST hoặc `chat_stream.v1` SSE. Fast path/tool/retrieval đều đi qua validator evidence; lịch sử server chỉ tạo khi analyst gửi một turn mới.
8. Chat P2 lưu conversation/message theo workspace, sinh gợi ý deterministic từ aggregate an toàn và nhận feedback có reason code; cache đủ điều kiện phải tái chạy tool và tái validate trước khi trả lời.
9. Drift so sánh các thống kê đã lưu; report pin evidence vào draft, snapshot rồi export PDF.

## Stack và trạng thái kỹ thuật

- Frontend: Next.js 15, React 19, TypeScript, TanStack Query, Vitest và Playwright.
- Backend: Python 3.11, FastAPI, Pydantic, SQLAlchemy/Alembic và LangGraph.
- Compute: DuckDB file-backed; pandas/NumPy/SciPy/statsmodels/scikit-learn và các forecast backend tùy deployment.
- Persistence: PostgreSQL bắt buộc; LangGraph checkpointer cũng dùng PostgreSQL.
- Storage: Supabase Storage là canonical production; Google Drive là optional import connector; local là development/test adapter.
- Authentication: Supabase JWT ở production; `dual`/guest là compatibility hoặc trial path.
- Deployment: Azure App Service containers + ACR qua workflow GitHub Actions.
- Migration head: `20260901_0026`, gồm durable P2 chat metadata và canonical dataset artifact/ingestion metadata.

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

## Chat Agent P0–P2 đã phản ánh

- **Chat Agent hiện tại:** `chat_stream.v1` có stage thực tế và cancellation hợp tác; answer V2 tách conclusion/findings/evidence/limitations, có provenance bất biến và fast path deterministic. Các capability P1/P2 (message actions, recovery/replay, durable conversation, suggestions, feedback, semantic cache và verifier shadow) được mô tả tập trung trong [Agent system](architecture/agent-system.md).
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

### Chat Agent chưa có release evidence trên staging được ủy quyền

P0/P1/P2 có focused local test, migration smoke và offline evaluation; `evaluations/results/p0-local/` xác nhận 17/17 synthetic cases của harness offline nhưng cố ý mang trạng thái `NOT_EVALUATED`. Scorecard staging trước đó không chứng minh các behavior chat hiện tại. Cần chạy lại synthetic evaluation authenticated trên đúng commit, đo TTFVA/p95 theo execution path và đo cache hit rate; không dùng unit test, offline harness hoặc fixed-delay benchmark thay cho bằng chứng release.

### P2 verifier và retention job chưa enforce/schedule

`agent_verifier_mode=shadow` chỉ ghi verification result, không thay answer. Chế độ `enforce` vẫn bị chặn bởi cấu hình cho tới khi có UX fail-closed đã review. `purge_expired_deleted_conversations` là primitive maintenance có giới hạn, chưa có scheduler production gọi nó; soft-deleted conversation cần có job vận hành trước khi có thể cam kết retention thực tế.

### Cấu hình có default ở nhiều lớp

`config.yaml` chọn Gemini/Voyage và bật external knowledge; code default riêng lại dùng local embedding và tắt external knowledge nếu không nhận YAML. `LANGSMITH_DATA_MODE` nhận `sanitized_content`, nhưng adapter hiện vẫn ẩn input/output và chỉ gửi metadata allow-list. Luôn kiểm tra effective settings thay vì suy luận từ một file.

## Checklist bàn giao

- Chạy migration smoke và database security assertion khi đổi schema/access boundary.
- Chạy focused pytest, sau đó full pytest phù hợp với phạm vi thay đổi.
- Chạy `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` và Playwright cho frontend.
- Chạy evaluation dry-run/offline để kiểm tra harness; rerun staging synthetic sau thay đổi QA/planner.
- Sau đổi P2 schema, chạy `python scripts/migration_smoke.py`, assertion Data API boundary và focused conversation/cache/verifier tests.
- Trước khi bật verifier enforce hoặc mô tả cache là cải thiện latency, có staging evidence theo execution path và review privacy/retention.
- Kiểm tra health của API, worker và frontend; dùng correlation ID/telemetry thay vì log raw payload.
- Khi đổi data flow, kiểm tra lại workspace predicate, PII masking, approximation, evidence binding, idempotency và cleanup file tạm.
