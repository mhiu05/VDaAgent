# Analyst Agent

**Status: Implemented.** Analyst chuyển `insight_candidates` do Data tính thành các finding mô tả trong `analysis_pack`. Finding có category, support level, limitation và evidence path; agent không tạo giải thích nhân quả hoặc giá trị số mới.

Coordinator gọi sau Data, song song với Comparison và Chart. Tool là `analyst.analyze`; Insight dùng findings làm một nguồn tổng hợp. Validator so output với projection xác định từ `data_analysis_pack`, bao gồm scope và lineage. Input/output không khớp làm stage thất bại. `analyst` cũng hỗ trợ specialist run không tạo report.

Code: `src/backend/packages/agents/src/analysis-v1/agents/analyst-agent.ts`, `src/backend/packages/agents/src/analysis-v1/stages/branches.ts`. Xem [evidence validation](../evidence-validation.md).
