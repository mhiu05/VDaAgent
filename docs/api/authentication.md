# Authentication và authorization của API

**Status: Implemented.** `POST /api/v1/auth/login` nhận thông tin đăng nhập theo `LoginSchema` và dùng Supabase Auth `signInWithPassword`; SSR client đọc/ghi session cookie. `GET /api/v1/session` gọi `getUser()` rồi trả user cùng organization/role. `POST /api/v1/auth/logout` sign out và xóa cookie phát triển. `GET /api/v1/setup` cho biết cấu hình sẵn sàng, không chứa secret.

Mọi route còn lại đi qua `principal()`. Repository kiểm `organization_members` trong transaction; role `viewer` chỉ đọc. Query dữ liệu đọc đặt authenticated role và user claim để RLS lọc theo tổ chức. Các context ref và capability agent được xác thực thêm ở điểm dùng. Worker kiểm lại membership khi nhận/ghi job, nên quyền bị thu hồi có hiệu lực với công việc đang xếp hàng.

**Local development:** `POST /api/v1/auth/development-role` chỉ có khi `DEVELOPMENT_ROLE_BYPASS` được bật. Cookie HMAC có hạn 8 giờ, map tới principal seed; config cấm bypass trong production. Đây không phải API đổi role cho người dùng thật.

Code: `src/frontend/src/server/api/routes/auth.ts`, `src/frontend/src/server/context.ts`, `src/backend/packages/db/src/authorization/authorization-repository.ts`, `src/frontend/src/server/api/middleware/authenticated-context.ts`. Xem [permissions](../platform/permissions.md), [security](../architecture/security.md).
