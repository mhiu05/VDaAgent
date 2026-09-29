# Backend

Backend chia theo trách nhiệm, không theo một server HTTP đơn khối:

| Phần | Vai trò |
| --- | --- |
| `src/frontend/server/api` | Router Next.js, route theo tài nguyên, middleware, problem response, SSE |
| `src/contracts` | Zod schema và kiểu dữ liệu chung cho API, worker, UI |
| `src/backend/database` | Repository, quyền truy cập, transaction, lease, storage adapter |
| `src/backend/semantic` | Chọn snapshot và tính toán chỉ số/so sánh theo phiên bản semantic |
| `src/backend/domain` | Quy tắc nhập liệu, integrity, claim và report validation |
| `src/backend/agents` | Agent Runtime cho chat; Team Runtime và các stage `agent-v1` |
| `src/backend/worker` | Poll queue, scheduler, dispatch, heartbeat và shutdown |
| `src/backend/config` | Kiểm tra biến môi trường và feature flags |

API không tự giữ hàng đợi. Repository dùng PostgreSQL để lưu run/job/event và chặn write khi lease mất hiệu lực. Worker chủ yếu gọi các package chung; nó không sở hữu logic tính metric. `create-run`, worker claim và dispatcher chỉ thực thi `agent-v1`; repository tiếp tục đọc run `legacy-v1` lịch sử.

Entrypoint: `src/frontend/app/api/[...path]/route.ts` và `src/backend/worker/main.ts`. Xem [execution model](execution-model.md), [API](../api/overview.md).
