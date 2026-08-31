# Workspace và quản trị

## Mô hình workspace

Analyst đã authenticate có thể thuộc một hoặc nhiều workspace active. Browser chọn workspace bằng `X-Workspace-Id`; khi có nhiều membership mà bỏ header, API trả conflict `workspace_required`. Dataset, Profile Run, analysis session, connector, report, audit event và agent record đều có workspace scope. Retrieval document của profile/report cũng có workspace scope; external corpus có thể là global với `workspace_id` null.

Workspace role hiện tại là `analyst`. Giá trị owner/viewer/admin cũ được normalize về canonical workspace role; system-admin là account context riêng và không phải workspace superuser.

Endpoint gồm `/session`, `/workspace-bootstrap`, `/me`, `/workspaces`, `/workspaces/archived`, tạo/configuration workspace, list/update member, tạo/cancel/accept invitation, archive/restore/permanent purge, và guest-session cleanup. Context/theme update dùng optimistic expected version.

## Mô hình capability

Permission là capability có tên, ví dụ `dataset.read`, `profile.run`, `analysis.run`, `report.draft.write`, `workspace.members.manage` và `workspace.storage.connect`. Các route nghiệp vụ theo workspace dùng `require_permission` hoặc dependency workspace tương ứng; repository method xử lý resource nhận workspace predicate lần nữa. System Admin route dưới `/api/v1/admin` dùng system capability (`user.accounts.read`, `user.account.manage`, `system.admin`) và không cấp quyền Analyst workspace.

Do chỉ có một workspace role, `analyst` hiện nhận toàn bộ capability submit/review/publish report và quản lý workspace. Capability registry tách tên quyền nhưng chưa tạo separation of duties giữa nhiều workspace role.

## Bề mặt Admin

`/admin` và `/api/v1/admin/users` cho system administrator list user, tạo user, đổi status/role và delete. Frontend route guard chỉ hỗ trợ UX; dependency backend vẫn là authorization boundary. Account bị lock hoặc inactive sẽ fail closed kể cả token cũ còn hạn.

## Vị trí source code và kiểm chứng

- Dependency: [`backend/src/api/dependencies.py`](../../backend/src/api/dependencies.py).
- Capability: [`backend/src/services/permissions.py`](../../backend/src/services/permissions.py).
- Workspace/admin route: [`backend/src/api/authz_routes.py`](../../backend/src/api/authz_routes.py), [`admin_routes.py`](../../backend/src/api/admin_routes.py).
- Browser guard: [`frontend/src/lib/auth/route-access.ts`](../../frontend/src/lib/auth/route-access.ts).
- Test: tìm trong `tests/` với `workspace`, `membership`, `invitation`, `permission`, `admin` và `tenant`.
