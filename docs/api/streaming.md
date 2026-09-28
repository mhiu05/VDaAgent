# Streaming trạng thái

**Status: Implemented, có hai chế độ.** Với durable execution, worker ghi event vào PostgreSQL; `GET /runs/{id}/events` và `GET /agent-turn-jobs/{id}/events` là SSE đọc lại trạng thái. Client gửi `Accept: text/event-stream` và cursor qua `Last-Event-ID` hoặc `?after=`. Server trả `snapshot`, event `runtime`/`execution` có `id: sequence`, rồi `terminal` khi đã xả hết các trang event. Event được sắp theo sequence, bỏ qua ID đã nhận.

```text
POST turn/run → ID → GET state + SSE(after=cursor) → disconnect/refresh
→ GET state mới + SSE(Last-Event-ID=cursor) → terminal
```

`durableEventStream` polling repository sau mỗi trang, heartbeat khoảng 15 giây và đóng kết nối sau khoảng 55 giây để client reconnect. Nếu đọc lỗi hoặc quyền bị thu hồi, stream gửi `stream_error: STREAM_UNAVAILABLE` rồi đóng; chi tiết exception không ra UI. Ngắt SSE không hủy run/job. UI có polling/snapshot để phục hồi và đồng bộ trạng thái sau refresh.

**Chế độ cũ/flagged:** POST stream hội thoại chạy Agent Runtime trong HTTP request khi `GROK_RUNTIME_ENABLED` và `GROK_SSE_ENABLED` bật nhưng durable execution tắt. Đường này phụ thuộc connection/HTTP owner; không có replay từ durable event ledger giống GET SSE. `GROK_WORKSPACE_ENABLED` điều khiển UI, không thay bản chất persistence của run.

Code: `src/frontend/src/server/durable-event-stream.ts`, `src/frontend/src/server/api/routes/runtime-workspace.ts`, `src/frontend/src/server/api/routes/conversations.ts`, `src/frontend/src/server/api/streaming/agent-turn.ts`, `src/frontend/src/lib/sse.ts`. Xem [execution model](../architecture/execution-model.md), [failure recovery](../workflows/failure-recovery.md).
