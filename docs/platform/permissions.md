# Quyền truy cập

**Status: Implemented.** Membership `organization_members(org_id,user_id,role)` là nguồn role. API lấy identity qua Supabase Auth; repository kiểm membership theo tổ chức trong transaction. RLS read policies áp `org_id` và user claim; write đi qua repository/server. Chọn `org_id` trong query/body không tự tạo quyền.

| Role | Đọc workspace, run, report | Nhập CSV, tạo run, sửa lịch | Draft/review artifact và memory |
| --- | --- | --- | --- |
| `owner` | Có | Có | Có |
| `analyst` | Có | Có | Có |
| `viewer` | Có | Không | Không qua public artifact/memory API |

`owner` và `analyst` hiện cùng quyền ghi ở các repository được kiểm; code chưa thể hiện quyền quản trị membership dành riêng cho owner qua API. Viewer có thể xuất report vì export là quyền đọc, được kiểm lại trước upload/download. Runtime kiểm role và context ref riêng trước khi gọi capability. Worker kiểm lại membership khi claim và khi ghi với lease; thu hồi quyền có thể làm run/job thất bại.

Local `DEVELOPMENT_ROLE_BYPASS` dùng cookie ký cho principal seed; config cấm bật trong production. Không nên suy ra cơ chế này là role impersonation trong production.

Code: `src/frontend/server/context.ts`, `src/backend/database/authorization/authorization-repository.ts`, `src/backend/supabase/schemas`, `src/backend/agents/runtime/capabilities/registry.ts`. Xem [security](../architecture/security.md) và [authentication](../api/authentication.md).
