# Workspace, membership và quản trị

> Đã đối chiếu với authz/admin routes và capability policy hiện tại ngày 2026-09-06.

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

Registry dùng hai workspace role: `owner` và `analyst`. Quyền thực tế đến từ
capability registry, không suy luận chỉ từ nhãn UI: Analyst xử lý luồng phân
tích thường ngày, còn Owner quản lý membership, cấu hình, connector, lifecycle
và các thao tác governance/phá hủy. API thành viên/invitation nằm dưới:

- `/api/v1/workspaces/current/members`;
- `/api/v1/workspaces/current/invitations`;
- `/api/v1/workspaces/current/configuration`.

Cập nhật membership hoặc cấu hình phải ghi audit. Invitation chỉ tạo Analyst;
Owner hiện hữu có thể promote/demote membership và hệ thống từ chối mọi thay đổi
làm workspace active hoặc archived mất Owner hiệu lực cuối cùng (membership Owner
active, profile active và không phải System Admin). Chỉ workspace mới cấp Owner
cho người tạo; provisioning workspace cũ luôn giữ nguyên role đã lưu. Archived
workspace không được dùng cho tác vụ phân tích mới; restore và permanent delete là
thao tác lifecycle riêng của Owner. Guest workspace luôn giữ role Analyst, kể cả
khi migration chuẩn hóa membership cũ.

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

- `src/backend/src/api/authz_routes.py`
- `src/backend/src/api/admin_routes.py`
- `src/backend/src/api/dependencies.py`
- `src/backend/src/services/auth.py`
- `src/backend/src/services/permissions.py`
- `src/frontend/src/lib/auth/`
