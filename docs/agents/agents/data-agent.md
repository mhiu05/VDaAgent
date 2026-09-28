# Data Agent

**Status: Implemented.** Data Agent là chủ sở hữu phép tính trên các snapshot đã chốt cho run. Nó đọc dữ liệu qua repository có fence, áp dụng semantic `mvp-inventory-v0.1` và tạo các artifact có thể kiểm tra; không chọn dữ liệu ngoài scope hoặc sau `data_as_of`.

Đầu vào gồm run, snapshot IDs, cấu hình ngưỡng tồn chậm và use case. Tool `data.analyze` gọi stage tạo `query`, `query_result`, `calculation`, `comparison_calculation`, `comparison` và `data_analysis_pack`. Pack ghi metric, breakdown, comparison, candidate, limitation, snapshot/source refs. `data.evidence` trả tham chiếu và số lượng bằng chứng cho Insight; dữ liệu thô ở artifact store.

Comparison, Chart, Analyst và Insight tiêu thụ pack này. Data có thể là đích của specialist run, khi đó run kết thúc bằng artifact đã validate mà không tạo report. Input/output sai hash, lineage, scope hoặc schema bị từ chối; stage không được tự sửa số liệu bằng model.

Code: `src/backend/packages/agents/src/analysis-v1/agents/data-agent.ts`, `src/backend/packages/agents/src/analysis-v1/stages/coordinator-data.ts`, `src/backend/packages/semantic/src/analyze.ts`. Xem [evidence validation](../evidence-validation.md) và [datasets](../../platform/datasets.md).
