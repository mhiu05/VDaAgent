# Backend

Backend chia theo trách nhiệm, không theo một server HTTP đơn khối:

| Phần | Vai trò |
| --- | --- |
| `src/frontend/src/server/api` | Router Next.js, route theo tài nguyên, middleware, problem response, SSE |
| `src/backend/packages/contracts` | Zod schema và kiểu dữ liệu chung cho API, worker, UI |
| `src/backend/packages/db` | Repository, quyền truy cập, transaction, lease, storage adapter |
| `src/backend/packages/semantic` | Chọn snapshot và tính toán chỉ số/so sánh theo phiên bản semantic |
| `src/backend/packages/domain` | Quy tắc nhập liệu, integrity, claim và report validation |
| `src/backend/packages/agents` | Agent Runtime cho chat; Team Runtime và các stage `agent-v1` |
| `src/backend/worker` | Poll queue, scheduler, dispatch, heartbeat và shutdown |
| `src/backend/packages/config` | Kiểm tra biến môi trường và feature flags |

API không tự giữ hàng đợi. Repository dùng PostgreSQL để lưu run/job/event và chặn write khi lease mất hiệu lực. Worker chủ yếu gọi các package chung; nó không sở hữu logic tính metric. Code `legacy-workflow` vẫn được dispatch cho run `legacy-v1` đã tồn tại, trong khi `create-run` tạo `agent-v1`.

Entrypoint: `src/frontend/src/app/api/v1/[...path]/route.ts` và `src/backend/worker/src/main.ts`. Xem [execution model](execution-model.md), [API](../api/overview.md).
