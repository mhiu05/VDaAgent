# Agent Runtime

`AgentRuntime` nhận turn từ API hoặc durable job, dựng context được cấp quyền, chọn plan bằng policy xác định hoặc provider, kiểm plan, gọi capability và dựng câu trả lời đã grounding. Nó không phải chính Team Runtime của run: run dùng `TeamRuntime` và stage `agent-v1` trong worker.

Lifecycle chat: `submit` tạo/replay turn theo idempotency; durable admission có thể ghi job. `executeTurn` dựng context, áp timeout/budget, chọn plan, preflight capability, thực thi từng bước và validate response selection trước khi hoàn thành assistant message. Mutating capability tạo run có giới hạn một lần; worker tiếp tục run riêng. Lỗi provider/capability được đổi thành mã và câu chữ an toàn; không xuất raw exception cho UI.

Team Runtime có registry agent, `ToolRegistry`, context builder, event emission và giới hạn invocation/delegation/duration. Tool kiểm schema input/output, agent allowlist, timeout, quyền và kích thước kết quả. Các stage luôn dùng repository để persist artifact/checkpoint; mất lease khiến write cũ bị từ chối. Cancellation dùng `AbortSignal`, trong khi repository là nguồn quyết định trạng thái cuối.

Giới hạn mặc định trong code: Team Runtime tối đa 40 invocation, depth 6, 30 delegation và 10 phút; ToolRegistry tối đa 80 call và kết quả chuẩn hóa 16 KB (phần lớn stage tool timeout 240 giây). Chat runtime tối đa 3 plan steps/3 capability calls, một run mới và một mutating call; provider attempt mặc định 12 giây, turn tối đa 45 giây. Đây là guardrail của process; lease và transaction vẫn là ranh giới nhất quán dữ liệu.

Code mapping: `src/backend/agents/runtime/agent-runtime.ts`, `src/backend/agents/runtime/team/executor.ts`, `src/backend/agents/runtime/team/tools.ts`, `src/backend/worker/agent-turn-dispatcher.ts`. Xem [tools](tools.md), [execution model](../architecture/execution-model.md).
