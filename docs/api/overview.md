# API boundary

**Status: Implemented.** HTTP API nằm trong Next.js catch-all route `/api/[...path]`; không có server HTTP backend thứ hai. Router kiểm Origin, xử lý setup/login trước, rồi lấy principal, repository, parse query/body và phân phối route theo domain. Request/response quan trọng được kiểm bằng Zod contract chung.

Luồng chuẩn: browser dùng session cookie → API xác thực Supabase `getUser()` → repository kiểm organization membership/role → transaction PostgreSQL hoặc Storage/provider → JSON response. Run/turn có thể trả `202` cùng ID để UI theo dõi qua GET/SSE; request HTTP không giữ worker queue. Response dữ liệu riêng dùng `no-store`; lỗi có dạng problem document.

Nhóm route: setup/auth/session, catalog/workspace, conversations/messages/turn jobs, analyses/runs/runtime, imports, reports/exports, report definitions/scheduler. `org_id` thường ở query cho GET và body cho write; chat yêu cầu query/body trùng nhau. Các endpoint tạo turn/run yêu cầu `Idempotency-Key`.

Code: `src/frontend/app/api/[...path]/route.ts`, `src/frontend/server/api/router.ts`, `src/frontend/server/api/routes`, `src/contracts`. Xem [endpoints](endpoints.md), [errors](errors.md).
