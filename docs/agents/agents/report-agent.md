# Report Agent

**Status: Implemented.** Report Agent ghép các pack đã validate thành `report_draft` có cấu trúc. Draft là artifact nội bộ của run; `reports` record chỉ xuất hiện sau Reviewer `PASS` và publication transaction.

Coordinator gọi agent sau Insight. `report.draft` tạo revision 1 từ Data, Comparison, Chart, Analyst, Insight và decision pack nếu có. Nếu Reviewer yêu cầu sửa, `report.revise` tạo revision 2 bất biến từ draft và review trước đó. Validator kiểm report section, claim/evidence, scope, input refs và bản sửa; không cho thay metric hoặc nguồn bằng câu chữ.

Reviewer tiêu thụ draft. Sau review thứ hai vẫn không đạt, run thất bại với `REVIEW_REVISION_LIMIT`; không có vòng sửa tự do hay editor báo cáo trong UI.

Code: `src/backend/packages/agents/src/analysis-v1/agents/report-agent.ts`, `src/backend/packages/agents/src/analysis-v1/stages/insight-report.ts`, `src/backend/packages/agents/src/analysis-v1/stages/reviewer.ts`. Xem [report generation](../../workflows/report-generation.md).
