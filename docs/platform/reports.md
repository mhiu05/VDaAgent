# Reports và version

**Status: Implemented, lưu hành nội bộ.** Report xuất hiện khi full run có draft và review `PASS`. `report_draft`/`review_result` là artifact trung gian; `report` artifact và `reports` record được ghi cùng publication transaction. `/reports` hiển thị report đã publish, không hiển thị draft như report hoàn chỉnh.

`report_versions` ghi `lineage_id`, số version và `parent_report_id`. Một yêu cầu cập nhật qua hội thoại cần chỉ rõ report context; run mới tạo report mới, không sửa record/hash cũ. Revision 1/2 của draft trong cùng run là khái niệm khác với version 1/2 của các report đã publish. UI xem report, chọn làm context và xuất JSON/CSV. Export lưu metadata/path trong `report_exports` và file ở private Storage; API tạo download grant ngắn hạn rồi kiểm quyền lại khi tải.

**Giới hạn:** Không thấy report editor tự do, trạng thái phê duyệt của con người, email/webhook delivery hoặc public sharing. “Publish” chỉ có nghĩa là ghi report record nội bộ sau validation.

Code: `src/backend/database/transactions/publish-reviewed-draft.ts`, `src/backend/database/repositories/workspace-repository.ts`, `src/backend/database/repositories/report-repository.ts`, `src/frontend/server/api/routes/reports.ts`. Xem [report generation](../workflows/report-generation.md).
