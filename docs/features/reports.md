# Report và vòng đời

## Tạo và chỉnh sửa

Report có workspace scope. `POST /api/v1/reports` tạo draft; Command Center có thể pin profile section, chart, agent answer và note qua `/reports/{id}/items`. Pin yêu cầu `Idempotency-Key`. Draft title và item note có thể sửa, item có thể xóa, còn reorder dùng optimistic `expected_draft_version`. Browser report detail là `/reports/{reportId}`.

## Snapshot và export

`POST /api/v1/reports/{id}/snapshots` tính hash ổn định và đóng băng item set. Snapshot bất biến mới nhất được dùng bởi `/reports/{id}/export-source`; nếu chưa có snapshot, endpoint trả draft fallback có giới hạn và hash `draft`. Next server route `/api/reports/profile/[runId]` chuyển authorization/workspace header, lấy PII-safe export payload và render PDF bằng Playwright/Chromium. Route có source timeout 30 giây và trả lỗi 4xx/5xx an toàn.

## Vòng đời hiện tại

`reports` dùng các state `draft`, `in_review`, `published` và `archived`; `report_versions` có thêm `snapshot`, `approved`, `changes_requested` và `rejected`, đồng thời lưu review decision. Tuy nhiên public `POST /api/v1/reports/{id}/submit` hiện publish ngay vì `ReportService.submit_report` gọi `Repository.publish_report`. Review endpoint yêu cầu version ở `in_review`, nên không phải bước tiếp nối đáng tin cậy của public submit hiện tại. Đây là known gap, không phải approval workflow được ngầm giả định. `/review`, `/publish` và `/archive` vẫn có thể dùng theo permission và state check.

Workspace hiện chỉ có canonical role `analyst`, và role này nhận đồng thời `report.submit`, `report.review` lẫn `report.publish`. `Repository.review_report` không kiểm tra reviewer khác creator. Workspace settings có `report_separation_of_duties: true` nhưng source hiện không đọc flag này khi mutate report. Vì vậy separation of duties chưa được enforce.

Handler list/get được đặt tên “published” nhưng đều dùng `published_only=False`. List truyền thêm `exclude_rejected=True`, còn get/export-source không có filter rejected tương đương. Report library vì vậy có thể chứa draft/in-review; lookup trực tiếp còn có thể trả report có latest version bị rejected. Phía sử dụng phải theo behavior này cho tới khi contract đổi.

## Vị trí source code và kiểm chứng

- API/service: [`backend/src/api/authz_routes.py`](../../backend/src/api/authz_routes.py), [`backend/src/services/report_service.py`](../../backend/src/services/report_service.py).
- Draft/snapshot: [`backend/src/services/report_draft_repository.py`](../../backend/src/services/report_draft_repository.py).
- Persistence: [`backend/src/services/repository.py`](../../backend/src/services/repository.py).
- Browser/PDF: [`frontend/src/app/reports/`](../../frontend/src/app/reports/), [`frontend/src/app/api/reports/profile/[runId]/route.ts`](../../frontend/src/app/api/reports/profile/%5BrunId%5D/route.ts).
- Test: tìm trong `tests/` với `report`, `snapshot`, `draft`, `export` và `pdf`.

Xem [kiến trúc Report Draft/snapshot](../architecture/report-draft-snapshots.md).
