# Tools và capabilities

Tool là thao tác agent có tên, input/output schema, danh sách agent được gọi, timeout, mức rủi ro và kết quả chuẩn hóa. `ToolRegistry` chặn tool không đăng ký/không được phép, giới hạn số call và kích thước kết quả; kết quả lớn phải đi qua artifact/raw reference. Team Runtime ghi start/completed/failed/cancelled event cho tool.

Trong full run, tool nội bộ gồm `data.analyze`, `data.evidence`, `comparison.calculate`, `chart.build`, `analyst.analyze`, `insight.compose`, `report.draft`, `report.revise`, `reviewer.check`. Đây là adapter cho stage/checkpoint, không phải truy cập tự do vào database. `requestAgent` cũng chạy qua tool loop được kiểm soát.

Chat Agent Runtime dùng một registry khác: `create_analysis`, `get_analysis_result`, `inspect_signal`, `inspect_decision_intelligence`, `inspect_visual`, `inspect_priority_entity`, `inspect_evidence`, `get_report_context`, `inspect_agent_checkpoint`. Mỗi capability có role/mode/context yêu cầu; mutating call kiểm quyền lại trước khi ghi. Lỗi đọc có thể trả kết quả unavailable an toàn.

**Partially implemented:** `McpGateway` có discover/allowlist/health nhưng chưa có server được đăng ký trong workflow chính. Code mapping: `src/backend/packages/agents/src/runtime/team/tools.ts`, `src/backend/packages/agents/src/analysis-v1/team-workflow.ts`, `src/backend/packages/agents/src/runtime/capabilities/registry.ts`. Xem [security](../architecture/security.md).
