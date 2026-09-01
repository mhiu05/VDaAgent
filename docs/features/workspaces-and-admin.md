# Workspace, membership và quản trị

> Đã đối chiếu với authz/admin routes và capability policy hiện tại ngày 2026-09-01.

Workspace là ranh giới tenant chính. Mọi dataset, profile run, connector, analysis session, agent run, report và audit record phải được truy cập qua workspace đã xác thực.

## Phiên và onboarding

Các endpoint nền:

- `GET /api/v1/session`;
- `GET /api/v1/workspace-bootstrap`;
- `GET /api/v1/me`;
- `GET/POST /api/v1/workspaces`;
- `POST /api/v1/onboarding/provision`;
- `POST /api/v1/invitations/accept`;
- `DELETE /api/v1/guest/session`.

Frontend dùng bootstrap để chọn workspace hiện tại và hiển thị navigation. Route guard phía trình duyệt chỉ là UX; backend vẫn xác minh bearer token, membership, capability và ownership cho từng request.

## Membership và capability

Registry hiện dùng một workspace role chuẩn là `analyst`. Quyền thực tế đến từ capability registry, không nên suy luận từ nhãn role ở UI. API thành viên/invitation nằm dưới:

- `/api/v1/workspaces/current/members`;
- `/api/v1/workspaces/current/invitations`;
- `/api/v1/workspaces/current/configuration`.

Cập nhật membership hoặc cấu hình phải ghi audit. Archived workspace không được dùng cho tác vụ phân tích mới; restore và permanent delete là thao tác lifecycle riêng.

## Guest và compatibility mode

Development có thể dùng `AUTH_MODE=dual` để bootstrap user/workspace local. Guest session có vòng đời giới hạn và endpoint xóa riêng. Đây là luồng tương thích/phát triển, không thay thế Supabase Auth trong production.

## System administrator

System admin là phạm vi toàn hệ thống, tách khỏi workspace membership. Route `/api/v1/admin/users` hỗ trợ list/create, đổi trạng thái, đổi system role và delete theo capability. Một system admin không nên được ngầm thêm vào mọi workspace; khi truy cập tài nguyên tenant vẫn phải qua policy được định nghĩa rõ.

## Quy tắc isolation

- Không nhận `workspace_id` từ client rồi tin trực tiếp.
- Repository query phải scope bằng workspace đã resolve từ principal/membership.
- ID không tồn tại và ID thuộc workspace khác nên dùng lỗi không làm lộ tài nguyên.
- Audit ghi actor, workspace, action, target và request correlation.
- Browser không được gọi trực tiếp bảng domain qua Supabase Data API.

## Nguồn triển khai

- `backend/src/api/authz_routes.py`
- `backend/src/api/admin_routes.py`
- `backend/src/api/dependencies.py`
- `backend/src/services/auth.py`
- `backend/src/services/permissions.py`
- `frontend/src/lib/auth/`
