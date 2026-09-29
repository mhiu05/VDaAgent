# Luồng end-to-end

Hai đường vào cùng dùng tổ chức đã xác thực và repository, nhưng không phải mọi chat turn đều tạo run.

```mermaid
sequenceDiagram
  participant U as User/UI
  participant A as API
  participant D as PostgreSQL
  participant W as Worker
  participant T as Agent Runtime/Team
  U->>A: POST conversation message / analysis
  A->>D: xác thực scope; ghi message/job hoặc run
  A-->>U: 202 + ID
  W->>D: claim + lease
  W->>T: execute phase/stages
  T->>D: checkpoint, event, artifact
  U->>A: GET/SSE với cursor
  A->>D: đọc state đã persist
  A-->>U: snapshot, event, report
```

1. `/api/[...path]` gọi router; `principal()` xác thực và repository kiểm tra membership. Request body và response được kiểm bằng schema contract.
2. Chat POST nhận `Idempotency-Key`. Agent Runtime có thể trả lời bằng capability đọc; yêu cầu phân tích mới tạo `run`. Khi durable admission được bật và request phù hợp, API ghi job để worker tiếp tục.
3. `POST /analyses` tạo run trực tiếp. Giao dịch tạo run chốt danh sách snapshot cùng scope/ngày và tạo message liên quan. Worker lưu task/checkpoint khi thực thi stage.
4. Worker claim bằng lease, ghi stage và artifact; publication ghi report record trong giao dịch có fencing. UI đọc qua endpoint run, artifact, report, runtime event hoặc job event.

Code mapping: `src/frontend/server/api/router.ts`, `src/backend/agents/runtime/agent-runtime.ts`, `src/backend/database/transactions/create-run.ts`, `src/backend/worker/run-loop.ts`, `src/backend/agents/analysis/workflow.ts`. Xem [execution model](execution-model.md).
