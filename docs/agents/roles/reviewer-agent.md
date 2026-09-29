# Reviewer Agent

**Status: Implemented.** Reviewer là cổng kiểm tra draft trước publication. Nó nạp lại graph artifact đã lưu, kiểm hash, lineage, scope, metric, chart, claim, section và revision; không tin các giá trị chỉ do caller cung cấp.

Coordinator gọi `reviewer.check` sau Report. Output `review_result` là `PASS` hoặc `REVISION_REQUIRED` với issue/correction có giới hạn. Provider reviewer có thể đề xuất chỉnh wording gắn evidence, nhưng validator xác định vẫn quyết định draft có hợp lệ. Publication transaction kiểm lại draft, review `PASS`, checkpoint và lease thay vì chỉ tin kết quả invocation.

Lần review thứ hai vẫn cần sửa sẽ kết thúc run bằng `REVIEW_REVISION_LIMIT`. Reviewer không cấp quyền cho user hoặc tạo report record trực tiếp.

Reviewer còn kiểm các artifact/metric/evidence mà skill `slow-inventory-analysis` yêu cầu. Kết quả `review_result` bất biến ghi danh sách issue có severity, category và yêu cầu sửa; API workflow status chỉ trả các category để giao diện cho biết lý do cần sửa mà không lộ draft hay nội dung review riêng tư. Khi không có evidence đáng tin cậy, publication vẫn bị chặn.

Code: `src/backend/agents/analysis/specialists/reviewer.ts`, `src/backend/agents/analysis/stages/reviewer.ts`, `src/backend/database/transactions/publish-reviewed-draft.ts`. Xem [report generation](../../workflows/report-generation.md) và [evidence validation](../evidence-validation.md).
