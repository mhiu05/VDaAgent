# Tóm tắt bàn giao P-170

Đây là snapshot implementation ngắn cho maintainer. Cổng tài liệu là [docs/README.md](README.md); entry point root là [../README.md](../README.md); chỉ mục kiến trúc là [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Luồng sản phẩm hiện tại

1. Authenticate và chọn workspace.
2. Upload file được hỗ trợ hoặc materialize datasource MySQL/MongoDB/DuckDB.
3. Enqueue Profiling Job và theo dõi status đã lưu/SSE.
4. Review proposal và risk warning, sau đó resume profiling graph nếu cần.
5. Tạo chart Preview hoặc auto plan trong Command Center; context được approve và quality gate không bị block trước Official execution. Luồng promotion hiện có thể tự approve context draft.
6. Hỏi QA có evidence, so sánh các run đã hoàn tất và pin evidence vào Report Draft.
7. Tạo snapshot/export report; dùng lifecycle endpoint theo state và permission hiện tại.

## Trạng thái runtime

- Frontend: Next.js 15/React 19/TypeScript, Node 22, pnpm 11.
- Backend: FastAPI/Python 3.11, Pydantic, SQLAlchemy/Alembic, PostgreSQL, LangGraph checkpointer.
- Compute: DuckDB in-memory cùng pandas/NumPy/SciPy/statsmodels/scikit-learn.
- Triển khai: Azure App Service container qua GitHub Actions workflow trong repository.
- Storage: Supabase Storage, Google Drive hoặc local development storage.
- Datasource: MySQL, MongoDB, DuckDB. Google Calendar chưa được runtime/migration hiện tại hỗ trợ.

## Giới hạn quan trọng

Profile question tối đa 2.000 ký tự; QA nhận tối đa 20 history message nhưng chỉ chuyển 12 message cuối vào graph; batch profiling tối đa 20 dataset. Default trong YAML là sample 10.000 row bằng reservoir, seed 42 và tối đa 200 column. Command Center dùng timeout 60 giây cho cả Preview lẫn Official qua cùng setting, preview row budget 50.000, preview result limit 50 và Official result limit 500. Tool call và deep-analysis loop của agent đều bị giới hạn. Giá trị hiệu lực được lấy từ configuration sau khi environment override.

## Điểm còn thiếu và ghi chú nguồn sự thật

### Gửi report và review

Public `POST /api/v1/reports/{report_id}/submit` hiện gọi `ReportService.submit_report`, method này gọi thẳng `Repository.publish_report` nên report được publish ngay. Repository vẫn có method `submit_report` riêng và API có `/review`, nhưng service không gọi method submit cấp thấp đó. Không mô tả một chuỗi bắt buộc Analyst-submit → Admin-review như behavior hiện tại. Ownership: [`backend/src/services/report_service.py`](../backend/src/services/report_service.py), [`backend/src/services/repository.py`](../backend/src/services/repository.py), [`backend/src/api/authz_routes.py`](../backend/src/api/authz_routes.py). Xem [reports](features/reports.md).

Canonical workspace role `analyst` đồng thời có `report.submit`, `report.review` và `report.publish`; review repository không chặn creator tự làm reviewer. Flag workspace `report_separation_of_duties` được ghi khi tạo workspace nhưng không được dùng ở report lifecycle. Approval separation vì vậy chưa được enforce.

### Tên handler của report list

Handler `list_published_reports` và `get_published_report` đều dùng `published_only=False`. List loại report có latest version `rejected`; get và export-source không áp dụng filter rejected đó. Report library vì vậy có thể chứa draft/in-review, còn lookup trực tiếp có thể trả report bị rejected. Xem [reports](features/reports.md).

### Drift không ràng buộc cùng dataset

Route drift kiểm tra hai Profile Run tồn tại trong cùng workspace, đã `completed` và có id khác nhau, nhưng không kiểm tra `dataset_id` giống nhau. UI/test hiện còn có thể so sánh run từ hai dataset. Xem [drift comparison](features/drift-comparison.md).

### Promotion tự approve context draft

Luồng promote Preview tự gọi `approve_context` khi context hiện tại chưa `approved`, rồi mới chạy quality gate và Official execution. Generic execution endpoint lại yêu cầu approval đã có. Đây là khác biệt governance cần được quyết định rõ trong contract; tài liệu mô tả đúng behavior hiện tại tại [Command Center](features/command-center.md).

### HITL low-risk chưa được khóa bằng schema

`config.yaml` chỉ đặt `semantic_type` trong `HITL_LOW_RISK_TYPES`, nhưng Settings nhận list string không có allow-list. Node auto-confirm lặp qua cả `candidate_key`, `semantic_type` và `pii`, rồi tin cấu hình này. Misconfiguration vì vậy có thể auto-confirm candidate key hoặc PII trái với comment “luôn cần Analyst”.

### Tham chiếu tài liệu cũ trong workflow

Thông báo lỗi của bước validate production configuration trong workflow vẫn trỏ tới `docs/azure-deploy-cicd.md`, trong khi file này đã được hợp nhất vào [deployment](operations/deployment.md). Đây là stale source reference trong YAML workflow; audit tài liệu không sửa source ngoài Markdown.

### Các trang legacy đã bị xóa

Các file `docs/azure-deploy-cicd.md`, `docs/connectors-redesign-plan.md`, `docs/eval_v1.md`, `docs/latency-options.md`, `docs/mongodb-atlas-setup.md` và `docs/production-supabase.md` không còn là source tài liệu trong working tree. Nội dung còn đúng đã được gom vào [deployment](operations/deployment.md), [connector/storage](features/connectors-and-storage.md), [evaluation](development/evaluation.md), [configuration](operations/configuration.md) và [local development](development/local-development-and-testing.md). Không khôi phục claim setup không có trong code/configuration.

### Cấu hình và giá trị mặc định trong code

`config.yaml` là lớp default không chứa secret khi environment variable vắng mặt. Một số code default khác YAML, đặc biệt embedding provider và external knowledge. Khi debug deployment, cần kiểm tra effective setting thay vì chỉ đọc YAML hoặc Python default.

`LANGSMITH_DATA_MODE` nhận `metadata_only` hoặc `sanitized_content`, nhưng adapter hiện vẫn tạo client với `hide_inputs=true`, `hide_outputs=true` và chỉ gửi metadata allow-list. Giá trị `sanitized_content` chưa làm thay đổi payload export thực tế.

## Checklist kiểm chứng

- Chạy test backend tập trung cho route/service thay đổi, sau đó chạy toàn bộ pytest khi phù hợp.
- Chạy `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` và Playwright test liên quan cho thay đổi frontend.
- Chạy evaluation dry-run/offline theo [evaluation](development/evaluation.md).
- Kiểm tra `/health` của API, worker và frontend; chỉ đọc `/api/v1/status` trong context có authorization.
- Khi đổi data flow, kiểm tra lại workspace isolation, PII redaction, approximation flag, idempotency và migration compatibility.
