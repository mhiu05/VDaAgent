# Lỗi, hủy và khôi phục

**Status: Implemented với giới hạn.** PostgreSQL giữ run/job, task, artifact và event; HTTP stream không sở hữu công việc. Refresh/disconnect chỉ ngắt kết nối xem tiến độ của durable run/job.

| Tình huống | Hành vi hiện tại |
| --- | --- |
| Worker chết hoặc mất lease | Run/job `running` quá hạn được claim lại với fencing token mới; owner cũ không ghi được. Worker heartbeat mỗi 10 giây cho lease mặc định 30 giây. |
| Run retry | Claim tối đa 3 attempt; stage nạp lại checkpoint/artifact đã validate. Quá giới hạn thành `failed`/`MAX_ATTEMPTS`. Lỗi workflow được ghi terminal `failed`; không có nút retry cùng run trong API. |
| Durable turn chờ analysis | Job chuyển `waiting`, không chiếm worker; khi run terminal, repository đưa job về `queued` để tổng kết message. |
| Tool/provider/validation lỗi | Runtime trả mã an toàn; full report không publish nếu validation/review không đạt. |
| User hủy | Endpoint cancel run/job đặt trạng thái terminal và fence; `AbortSignal` hỗ trợ ngừng cooperative work. Adapter không ngắt được vẫn không thể ghi bằng lease cũ. |
| SSE mất kết nối | UI lấy lại snapshot/event bằng cursor hoặc polling; stream có heartbeat và thời hạn kết nối. |

Đường chat không durable còn phụ thuộc HTTP owner; script `reconcile-stalled-turns.ts` là thao tác operator có điều kiện, yêu cầu owner đã dừng, không phải auto-recovery cho mọi turn. `legacy-v1` chỉ còn để drain run cũ; unknown workflow version không được dispatch. Không thấy dead-letter queue hoặc external retry service riêng.

Code: `src/backend/packages/db/src/workflow/lease-repository.ts`, `src/backend/packages/db/src/repositories/agent-execution-repository.ts`, `src/backend/worker/src/workflow-dispatcher.ts`, `src/backend/worker/src/agent-turn-dispatcher.ts`, `src/backend/packages/db/src/workflow/reconcile-stalled-turn.ts`. Xem [execution model](../architecture/execution-model.md) và [streaming](../api/streaming.md).
