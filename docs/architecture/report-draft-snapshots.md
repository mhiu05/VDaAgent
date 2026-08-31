# Report Draft và snapshot bất biến

## Hai biểu diễn

Report có Report Draft mutable và snapshot bất biến. User có permission report-draft có thể thêm, sửa, xóa, đổi title và reorder item. Snapshot chụp item list và content hash ổn định để review/export; edit sau đó tạo draft version mới và không mutate snapshot cũ.

Draft repository lưu item type gồm profile section, chart, agent answer, note và giá trị tương thích legacy notebook. Chart item tham chiếu analysis execution đã lưu và chart spec đã validate. Pin item yêu cầu `Idempotency-Key`; reorder yêu cầu expected draft version và danh sách item id đầy đủ để bảo vệ optimistic concurrency.

## Thuật toán tạo snapshot

`ReportDraftRepository.snapshot` canonicalize JSON của draft, tính SHA-256 `snapshot_hash`, đánh dấu version đã capture là snapshot rồi tạo mutable draft version tiếp theo. Snapshot mới nhất được ưu tiên khi export. Nếu chưa có snapshot, `/reports/{id}/export-source` trả draft fallback có giới hạn và `snapshot_hash: "draft"`.

## Vòng đời

`reports` dùng các state `draft`, `in_review`, `published` và `archived`; `report_versions` dùng `draft`, `snapshot`, `in_review`, `approved`, `changes_requested`, `rejected` và `published`, đồng thời lưu review decision. Update/delete bị giới hạn bởi creator và lifecycle check. Report export được workspace authorize và dùng profile payload PII-safe giống PDF path.

Có một chi tiết implementation quan trọng: public `POST /api/v1/reports/{id}/submit` hiện gọi trực tiếp `Repository.publish_report`, nên publish ngay. `Repository.submit_report` cấp thấp và review endpoint vẫn tồn tại, nhưng service không gọi method submit đó. Behavior này được mô tả, không sửa; xem [điểm còn thiếu](../summary.md).

## Quyền sở hữu và kiểm chứng

- API: [`backend/src/api/authz_routes.py`](../../backend/src/api/authz_routes.py).
- Draft storage: [`backend/src/services/report_draft_repository.py`](../../backend/src/services/report_draft_repository.py).
- Lifecycle service: [`backend/src/services/report_service.py`](../../backend/src/services/report_service.py).
- Report table: [`backend/src/services/repository.py`](../../backend/src/services/repository.py) và migration.
- Browser/PDF: [`frontend/src/app/reports/`](../../frontend/src/app/reports/) và [`frontend/src/app/api/reports/profile/[runId]/route.ts`](../../frontend/src/app/api/reports/profile/%5BrunId%5D/route.ts).
