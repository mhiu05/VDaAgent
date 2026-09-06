# Report Draft và snapshot bất biến

> Đã đối chiếu với report routes/service và PDF renderer hiện tại ngày 2026-09-06.

## Mô hình hai lớp

Mỗi report có:

- **Report Draft mutable:** title và item có thể thêm/sửa/xóa/reorder.
- **Snapshot bất biến:** nội dung canonical đã hash, dùng làm nguồn review/export ổn định.

Item type hiện hỗ trợ profile section, chart, agent answer, note và giá trị compatibility `legacy_notebook` còn trong schema cũ. Chart item phải tham chiếu persisted analysis execution và ChartSpec hợp lệ. Note thủ công được phép nhưng không trở thành quantitative evidence.

Pin item yêu cầu `Idempotency-Key`. Reorder gửi `expected_draft_version` cùng danh sách đầy đủ item ID; mutation trên version stale bị reject để tránh ghi đè đồng thời.

## Tạo snapshot

[`ReportDraftRepository.snapshot`](../../src/backend/src/services/report_draft_repository.py) thực hiện:

1. đọc draft version hiện tại cùng item theo position;
2. canonicalize JSON;
3. tính SHA-256 `snapshot_hash`;
4. đánh dấu version đã capture là snapshot;
5. tạo draft version kế tiếp để tiếp tục chỉnh sửa.

Edit sau snapshot không mutate snapshot cũ. `/reports/{id}/export-source` ưu tiên snapshot mới nhất; nếu chưa có snapshot, endpoint trả bounded draft fallback với `snapshot_hash = "draft"`.

## Provenance và privacy

Profile/chart/answer item giữ identifier nguồn như Profile Run, context version, query execution, agent run và result hash khi loại item yêu cầu. Snapshot/export chỉ lấy payload PII-safe do backend authorize. Raw row và PII value không được đưa vào export source.

Next.js server route `/api/reports/profile/[runId]` chuyển bearer và workspace header sang backend, timeout source fetch sau 30 giây rồi render PDF bằng Playwright Core/Chromium. Browser không tự dựng PDF từ raw API data. Production frontend image cài Chromium và font Noto/Arial để giữ tiếng Việt.

## Lifecycle đang có

`reports.status`: `draft`, `in_review`, `published`, `archived`.

`report_versions.status`: `draft`, `snapshot`, `in_review`, `approved`, `changes_requested`, `rejected`, `published`.

Update/delete còn phụ thuộc creator và state; review/publish/archive phụ thuộc capability + repository state check. Tuy nhiên behavior hiện tại có gap quan trọng: public `POST /reports/{id}/submit` gọi service rồi publish trực tiếp, không tạo một review step bắt buộc. Không mô tả endpoint này như separation-of-duties workflow.

Role `analyst` hiện có cả submit/review/publish; flag `report_separation_of_duties` chưa được lifecycle code dùng. Xem [giới hạn hiện tại](./known-limitations.md).

## API chính

- `POST /api/v1/reports`;
- `POST /reports/{id}/items`;
- `PATCH /reports/{id}/draft-title`;
- `PATCH|DELETE /reports/{id}/items/{item_id}`;
- `PATCH /reports/{id}/items/reorder`;
- `POST /reports/{id}/snapshots`;
- `GET /reports/{id}/export-source`;
- `POST /reports/{id}/submit|review|publish|archive`.

List/get handler hiện không giới hạn tuyệt đối ở published report; chi tiết ở [feature report](../features/reports.md).

## Source và test

- API: [`src/backend/src/api/authz_routes.py`](../../src/backend/src/api/authz_routes.py).
- Draft/snapshot: [`src/backend/src/services/report_draft_repository.py`](../../src/backend/src/services/report_draft_repository.py).
- Lifecycle: [`src/backend/src/services/report_service.py`](../../src/backend/src/services/report_service.py).
- Persistence: [`src/backend/src/services/repository.py`](../../src/backend/src/services/repository.py).
- Frontend/PDF: [`src/frontend/src/app/reports/`](../../src/frontend/src/app/reports/), [PDF route](../../src/frontend/src/app/api/reports/profile/[runId]/route.ts).
