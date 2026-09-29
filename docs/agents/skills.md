# Skills trong repo

**Implemented: một skill tĩnh.** `slow-inventory-analysis` là cấu hình có schema và version cho use case `slow_moving_inventory`; nó được chọn cho câu hỏi tương tác và báo cáo theo lịch. Skill khai báo metric, artifact, chính sách evidence và điều kiện review cần có. Đây là registry trong code, không phải loader tự động từ thư mục hay quyền để agent chạy tool tùy ý.

Coordinator nạp yêu cầu của skill vào ngữ cảnh run. Data và các specialist tiếp tục tạo artifact theo DAG hiện có. Reviewer kiểm tra coverage trên graph artifact đã lưu trước khi cho phép publication. Metric không có giá trị vẫn phải thể hiện giới hạn dữ liệu; skill không tạo số liệu hoặc tự thay thế validation của domain.

`AgentDefinition` định nghĩa trách nhiệm, input/output và tool allowlist của từng agent. `ToolRegistry` thực thi tool có schema. Skill định nghĩa yêu cầu sản phẩm của use case và chọn workflow hiện có; ba cơ chế này có vai trò riêng.

Code mapping: `src/contracts/agents/skill.ts`, `src/backend/agents/skills.ts`, `src/backend/agents/runtime/team/definitions.ts`, `src/backend/agents/analysis/specialists/reviewer.ts`. Xem [tools](tools.md) và [orchestration](orchestration.md).
