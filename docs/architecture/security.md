# Security và quyền dữ liệu

API lấy người dùng qua Supabase Auth `getUser()`; local development có thể dùng cookie role ký HMAC khi `DEVELOPMENT_ROLE_BYPASS` bật. Config cấm bypass trong production. `organization_members` quyết định `owner`, `analyst`, `viewer`; repository kiểm tra membership trong transaction và từ chối write của viewer. Query đọc đặt role `authenticated` cùng user claim để áp dụng RLS. Migration tạo policy theo `org_id` cho bảng và bucket liên quan.

Body chat phải khớp `org_id` ở route/query; conversation, run, artifact và context reference được xác thực lại trong repository. Runtime capability kiểm role, mode và allowlist của run/evidence/report trước khi thực thi, rồi kiểm quyền lần nữa ngay trước truy cập dữ liệu. Worker write dùng lease/fencing và kiểm lại membership để giảm rủi ro khi quyền bị thu hồi.

Secret key, DB URL và provider keys ở server; `NEXT_PUBLIC_` chỉ dành cho cấu hình công khai, config từ chối tên env có dấu hiệu secret. API kiểm Origin đối với request, parse body bằng Zod, trả problem response và `no-store` cho dữ liệu riêng. Artifact draft/review không nằm trong tập artifact công khai.

Đây là các biện pháp nhìn thấy trong code, không phải tuyên bố hệ thống an toàn tuyệt đối. Code mapping: `src/frontend/server/context.ts`, `src/frontend/server/api/middleware/origin.ts`, `src/backend/database/authorization/authorization-repository.ts`, `src/backend/agents/runtime/capabilities/registry.ts`, `src/backend/supabase/migrations`. Xem [permissions](../platform/permissions.md).
