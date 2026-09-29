# Coordinator (Main Agent)

**Status: Implemented.** Coordinator là invocation gốc của một full `agent-v1` run, không phải một process riêng. Nó chọn capability hợp lệ theo use case và điều phối các agent còn lại theo thứ tự có ràng buộc. Tên `Main Agent` là nhãn UI của định nghĩa `coordinator`; chat `AgentRuntime` có bộ lập kế hoạch khác.

## Đầu vào và kết quả

- Đầu vào: run đã được repository xác thực, scope, `data_as_of`, use case và `agent_target` tùy chọn. `coordinateRun` từ chối capability không được use case hỗ trợ; nó không tự tìm snapshot mới hay tính metric.
- Đầu ra: `CoordinatorDecision` và các invocation con. Sau Data, Coordinator gọi Comparison, Chart, Analyst song song, rồi Insight, Report, Reviewer. Review `REVISION_REQUIRED` cho phép đúng một draft revision và một lượt review nữa.
- Publication là stage riêng sau kết quả `PASS`, không phải quyền tự ghi report của Coordinator.

Agent này có quyền `requestAgent` tới specialist; `allowed_tools` của chính Coordinator rỗng. Lỗi nhánh được gom bằng `Promise.allSettled` rồi làm run thất bại; checkpoint hợp lệ có thể được dùng lại sau worker reclaim. Specialist run bắt đầu trực tiếp tại agent được yêu cầu, không đi qua full Coordinator chain.

Code: `src/backend/agents/analysis/specialists/coordinator.ts`, `src/backend/agents/analysis/team-workflow.ts`, `src/backend/agents/runtime/team/definitions.ts`. Xem [orchestration](../orchestration.md) và [execution model](../../architecture/execution-model.md).
