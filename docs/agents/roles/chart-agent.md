# Chart Agent

**Status: Implemented.** Chart Agent tạo `visual_evidence` và `chart_pack` từ calculation/comparison đã lưu. Nó tạo đặc tả biểu đồ và liên kết tới giá trị nguồn, không phải dịch vụ render ảnh hay dashboard tùy ý.

Coordinator gọi sau Data, song song với Comparison và Analyst; Insight và Report dùng chart pack. Tool là `chart.build`. Input artifact được kiểm hash, scope và lineage; chart spec được validator kiểm nguồn và giá trị. Nếu chart lệch số hoặc tham chiếu, stage thất bại. `chart` có thể chạy như specialist và kết thúc ở artifact.

Code: `src/backend/agents/analysis/specialists/chart.ts`, `src/backend/agents/analysis/stages/branches.ts`, `src/backend/agents/analysis/chart-builder.ts`. Xem [artifacts](../../platform/artifacts.md).
