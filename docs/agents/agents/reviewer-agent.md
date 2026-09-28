# Reviewer Agent

**Status: Implemented.** Reviewer là cổng kiểm tra draft trước publication. Nó nạp lại graph artifact đã lưu, kiểm hash, lineage, scope, metric, chart, claim, section và revision; không tin các giá trị chỉ do caller cung cấp.

Coordinator gọi `reviewer.check` sau Report. Output `review_result` là `PASS` hoặc `REVISION_REQUIRED` với issue/correction có giới hạn. Provider reviewer có thể đề xuất chỉnh wording gắn evidence, nhưng validator xác định vẫn quyết định draft có hợp lệ. Publication transaction kiểm lại draft, review `PASS`, checkpoint và lease thay vì chỉ tin kết quả invocation.

Lần review thứ hai vẫn cần sửa sẽ kết thúc run bằng `REVIEW_REVISION_LIMIT`. Reviewer không cấp quyền cho user hoặc tạo report record trực tiếp.

Code: `src/backend/packages/agents/src/analysis-v1/agents/reviewer-agent.ts`, `src/backend/packages/agents/src/analysis-v1/stages/reviewer.ts`, `src/backend/packages/db/src/transactions/publish-reviewed-draft.ts`. Xem [report generation](../../workflows/report-generation.md) và [evidence validation](../evidence-validation.md).
