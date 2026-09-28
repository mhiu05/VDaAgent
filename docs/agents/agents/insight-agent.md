# Insight Agent

**Status: Implemented.** Insight tổng hợp claim đã gắn evidence từ Data cùng kết quả Comparison, Chart và Analyst. Nó có thể gọi lại Data qua `data.evidence` để lấy tham chiếu đã xác minh trước khi gọi `insight.compose`; đây là delegation có kiểm soát trong Team Runtime.

Đầu vào là các pack/artifact cùng run, scope, ngày và semantic version. Stage có thể dùng provider để viết diễn giải, nhưng claim và số liệu đầu vào được `bindClaims` cố định; validator không cho narrative thay đổi evidence. Đầu ra là insight và `insight_pack` cho Report. `insight` cũng có thể chạy như specialist, tự yêu cầu Data và ba branch hỗ trợ, rồi kết thúc ở pack.

Provider lỗi, thiếu evidence hoặc lineage sai làm stage thất bại; worker giữ checkpoint hợp lệ để thử lại theo run lease. Insight không tự publish.

Code: `src/backend/packages/agents/src/analysis-v1/agents/insight-agent.ts`, `src/backend/packages/agents/src/analysis-v1/stages/insight-report.ts`, `src/backend/packages/agents/src/analysis-v1/team-workflow.ts`. Xem [evidence validation](../evidence-validation.md).
