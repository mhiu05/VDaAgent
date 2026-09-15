# Report Draft và snapshot bất biến

> Đối chiếu với report routes/service, lifecycle policy, migration và PDF renderer trong working tree ngày 2026-09-15.

## Mô hình hai lớp

Mỗi report có:

- **Report Draft mutable:** title và item có thể thêm/sửa/xóa/reorder.
- **Snapshot bất biến:** nội dung canonical đã hash, dùng làm nguồn review/export ổn định.

Item type hiện hỗ trợ profile section, chart, agent answer, note và giá trị compatibility `legacy_notebook` còn trong schema cũ. Chart item phải tham chiếu persisted analysis execution và ChartSpec hợp lệ. Note thủ công được phép nhưng không trở thành quantitative evidence.

Pin item yêu cầu `Idempotency-Key`. Reorder gửi `expected_draft_version` cùng danh sách đầy đủ item ID; mutation trên version stale bị reject để tránh ghi đè đồng thời.

## Tạo snapshot

[`ReportDraftRepository.snapshot`](../../src/backend/src/services/report_draft_repository.py) đọc draft cùng item theo position, canonicalize JSON, tính `snapshot_hash`, đánh dấu snapshot bất biến rồi tạo draft kế tiếp. Edit sau snapshot không mutate snapshot cũ.

Draft/snapshot quản lý dùng surface riêng, chỉ author có `report.draft.write` mới sửa draft. `GET /profile/{run_id}/report-draft` là get-or-create, không phải published read; endpoint có semantics published không được dùng draft hoặc snapshot mới nhất làm fallback. Snapshot status `snapshot` là capture nội bộ terminal; draft mới phải submit/review/publish riêng.

## Provenance và privacy

Profile/chart/answer item giữ identifier nguồn như Profile Run, context version, query execution, agent run và result hash khi loại item yêu cầu. Snapshot/export chỉ lấy payload PII-safe do backend authorize. Raw row và PII value không được đưa vào export source.

Next.js server route `/api/reports/profile/[runId]` chuyển bearer và workspace header sang backend, timeout source fetch sau 30 giây rồi render PDF bằng Playwright Core/Chromium. Có `reportId` thì source là published `GET /reports/{id}/export-source`; không có `reportId` thì source là profile-scoped `GET /profile/{run_id}/report`, không phải report publication. Browser không tự dựng PDF từ raw API data. Production frontend image cài Chromium và font Noto/Arial để giữ tiếng Việt.

## Lifecycle và publication boundary

Version dùng state machine duy nhất: `draft → in_review → approved → published → archived`. Review có thể chuyển `in_review` sang `changes_requested` (author phải edit để về `draft`) hoặc `rejected` (terminal). Không có đường tắt từ `draft` hoặc `in_review` sang `published`.

`submitted_by_user_id` được lưu khi submit. Owner có `report.review` không được approve version do chính họ submit; Owner đã approve vẫn có thể publish. Mỗi transition lock report trước rồi lock version, kiểm tra state trong transaction, và audit actor/report/version/previous/next state mà không ghi nội dung report.

`GET /reports`, `GET /reports/{id}`, export source và dashboard chỉ truy vấn report có `status = published` **và** `current_published_version_id` trỏ đúng version `published` của report. Chúng hydrate đúng một version được pointer chỉ định; draft mới hơn không làm thay đổi snapshot đã phát hành. Các trạng thái khác và pointer legacy không hợp lệ trả 404/không được liệt kê.

## API chính

- `POST /api/v1/reports`;
- `POST /reports/{id}/items`;
- `PATCH /reports/{id}/draft-title`;
- `PATCH|DELETE /reports/{id}/items/{item_id}`;
- `PATCH /reports/{id}/items/reorder`;
- `POST /reports/{id}/snapshots`;
- `GET /reports/{id}/export-source`;
- `POST /reports/{id}/submit|review|publish|archive`.

List/get/export handler có semantics published luôn giới hạn đúng snapshot published được pointer chỉ định; chi tiết ở [feature report](../features/reports.md).

## Source và test

- API: [`src/backend/src/api/authz_routes.py`](../../src/backend/src/api/authz_routes.py).
- Draft/snapshot: [`src/backend/src/services/report_draft_repository.py`](../../src/backend/src/services/report_draft_repository.py).
- Lifecycle: [`src/backend/src/services/report_service.py`](../../src/backend/src/services/report_service.py).
- Transition policy: [`src/backend/src/services/report_lifecycle.py`](../../src/backend/src/services/report_lifecycle.py) (file chưa được commit trong working tree).
- Persistence: [`src/backend/src/services/repository.py`](../../src/backend/src/services/repository.py).
- Frontend/PDF: [`src/frontend/src/app/reports/`](../../src/frontend/src/app/reports/), [PDF route](../../src/frontend/src/app/api/reports/profile/[runId]/route.ts).
