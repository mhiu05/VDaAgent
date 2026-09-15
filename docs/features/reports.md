# Báo cáo

> Đã đối chiếu với report lifecycle API, repository và PDF route hiện tại ngày 2026-09-15.

Báo cáo ghép insight đã được kiểm chứng thành draft có thể chỉnh sửa. Capture snapshot nội bộ là bất biến; bản phát hành phải qua submit, Owner review và Owner publish version riêng trước khi published export.

## Mô hình dữ liệu

- report: container và trạng thái lifecycle;
- report item: tham chiếu insight/execution cùng thứ tự và nội dung trình bày;
- draft: trạng thái mutable;
- snapshot: bản bất biến, có payload chuẩn hóa và hash;
- export source: dữ liệu đã kiểm tra để frontend/server renderer tạo PDF.

Item định lượng phải tham chiếu profile run, Official execution hoặc evidence có provenance. Ghi chú thủ công là nội dung biên tập, không trở thành quantitative evidence chỉ vì được thêm vào report.

## API chính

Các route nằm dưới `/api/v1/reports`:

- list/get và lấy export source;
- tạo report;
- thêm, sửa, xóa, sắp xếp item;
- sửa draft title;
- tạo snapshot;
- submit bởi tác giả; Owner-only review queue, review, publish và archive;
- xóa report khi policy cho phép.

`GET/POST /api/v1/profile/{run_id}/report-draft` hỗ trợ draft gắn với một profiling run. `POST /api/v1/profile/{run_id}/report` tạo và submit một report từ profile completed, **không publish**. Frontend PDF route dùng Chromium phía server và timeout source fetch 30 giây; profile PDF không có `reportId` khác với PDF của published report có `reportId`.

## Snapshot, workflow và tính tái lập

Snapshot bảo toàn provenance/hash. Published API và PDF export không fallback sang draft: chúng chỉ đọc version `published` được `current_published_version_id` của report chỉ định.

Workflow version chính là `draft → in_review → approved → published → archived`; review cũng có thể chuyển sang `changes_requested` (tác giả edit để trở lại draft) hoặc `rejected` (terminal). `snapshot` là capture bất biến nội bộ, không phải trạng thái có thể publish. Analyst viết/submit draft; Owner review/publish/archive. Submitter không thể review version của chính mình: nếu một Owner tự submit, cần Owner khác approve; Analyst submit giúp workspace chỉ có một Owner hoàn tất workflow. Request sai state hoặc stale trả conflict có `code` ổn định; report chưa published được ẩn bằng 404 khỏi list/detail/export/dashboard.

Khi đã có bản phát hành, draft/version mới hơn không thay đổi snapshot published cũ. Migration preflight chỉ backfill pointer legacy khi xác định được một published version; dữ liệu còn bất biến không hợp lệ chặn deploy để operator phục hồi có kiểm soát.

## Nguồn triển khai

- `src/backend/src/api/authz_routes.py`
- `src/backend/src/api/routes.py`
- `src/backend/src/services/report_service.py`
- `src/backend/src/services/report_lifecycle.py` (working tree, chưa commit)
- `src/backend/src/services/report_draft_repository.py`
- `src/backend/src/models/auth_schemas.py`
- `src/frontend/src/app/reports/`
- `src/frontend/src/app/api/reports/profile/[runId]/route.ts`
- `src/frontend/src/lib/pdf-report.ts`
