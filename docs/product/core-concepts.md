# Khái niệm cốt lõi

| Khái niệm | Ý nghĩa và quan hệ |
| --- | --- |
| Organization / workspace | Biên dữ liệu theo `org_id`; membership gán vai trò. UI có một workspace cho tổ chức được chọn. |
| Conversation / thread | Chuỗi trao đổi; bảng `conversations` giữ context chọn dataset, run, report, artifact. “Thread” trong code thường chính là conversation này. |
| Message | Lời người dùng hoặc assistant trong conversation; có thể gắn `run_id`, context refs và trạng thái. |
| Agent turn job | Công việc bền vững cho một lượt chat đủ điều kiện, có invocation/event và có thể liên kết run. |
| Run | Một yêu cầu phân tích có scope, ngày dữ liệu, snapshot đã chốt, trạng thái, attempt và lease. Run mới dùng `agent-v1`. |
| Task / invocation | Task là stage/checkpoint của run. Invocation là một lần gọi agent trong runtime, có parent và event; hai loại không đồng nhất. |
| Agent / tool | Agent có định nghĩa, phạm vi gọi agent khác và tool được phép. Tool là thao tác có schema, giới hạn, kiểm tra quyền và kết quả chuẩn hóa. |
| Context / memory | Context là dữ liệu được chọn và cấp quyền cho lượt chạy. Memory là các tóm tắt `working`, `episodic`, `workspace` lưu riêng; message history vẫn là nguồn độc lập. |
| Dataset | Import CSV và các snapshot tồn kho; không có thực thể “dataset” tùy ý tách khỏi import/snapshot trong database. |
| Evidence / artifact | Artifact là đầu ra bất biến của stage, có hash và lineage. Evidence ref trỏ tới đường dẫn giá trị trong artifact có thể kiểm tra. |
| Report / version | Draft và review là artifact nội bộ. Publication tạo report record. `report_versions` nối các report được tạo tiếp theo thành lineage. |
| Skill | **Planned / placeholder:** không có cơ chế skill registry/loader trong runtime hiện tại. |

Codebase: `src/backend/packages/contracts/src`, `src/backend/supabase/migrations`, `src/backend/packages/agents/src/runtime`. Xem [data model](../architecture/data-model.md) và [context & memory](../agents/context-memory.md).
