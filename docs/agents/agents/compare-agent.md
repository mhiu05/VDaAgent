# Compare Agent (Comparison)

**Status: Implemented.** Agent id trong runtime là `comparison`; `Compare Agent` là tên hiển thị. Nó đóng gói các so sánh kỳ, segment và peer đã được Data tính thành `comparison_pack` có evidence refs. Nó không truy vấn SQL, gọi LLM hay tự tính lại delta.

Coordinator gọi agent sau Data, song song với Chart và Analyst; Insight và Reviewer dùng kết quả. Tool duy nhất là `comparison.calculate`. Input là `data_analysis_pack` đã xác minh hash, tổ chức, run, ngày và semantic version. Output mang cùng scope, snapshot/source refs và trỏ về các path so sánh trong pack đầu vào; validator đối chiếu toàn bộ projection với kết quả mong đợi.

Nếu pack đầu vào hoặc projection sai, branch thất bại và full report không được publish. `comparison` cũng là specialist target, kết thúc bằng pack thay vì report.

Code: `src/backend/packages/agents/src/analysis-v1/agents/comparison-agent.ts`, `src/backend/packages/agents/src/analysis-v1/stages/branches.ts`. Xem [analysis workflow](../../workflows/analysis-workflow.md).
