# Mô hình xác thực và phân quyền

## Phương thức xác thực

`AUTH_MODE` quyết định principal flow được chấp nhận và hiện chỉ nhận `dual` hoặc `supabase`. Production validator yêu cầu mode `supabase` và email đã confirm. Trong development/test, mode `dual` có thể nhận legacy API token đã cấu hình hoặc bootstrap identity khi tắt token enforcement. Guest session dùng token dạng `guest.<uuid>.analyst` khi được bật. Không dùng các compatibility path này trong production.

`SupabaseJWTVerifier` nhận asymmetric JWT algorithm đã cấu hình (`ES256`/`RS256`), validate issuer, audience, expiry, subject và `role=authenticated`, cache JWKS với một lần retry khi rotation, đồng thời dùng narrow authoritative Supabase user fallback khi local verification fail. Identity invalid, expired, chưa confirm (khi bắt buộc) hoặc không thể truy cập đều fail closed.

## Chuỗi phân quyền

1. `get_current_user` authenticate bearer.
2. `get_active_user` đồng bộ/kiểm tra account projection và status.
3. `get_current_workspace` resolve `X-Workspace-Id` với active membership và reject workspace mơ hồ/ngoài tenant.
4. `require_permission(name)` kiểm tra capability của canonical workspace role.
5. Service/repository giữ workspace scope và kiểm tra resource ownership.

System Admin route dùng `require_system_permission`, không dùng workspace context. Admin không thể vào Analyst workspace bằng membership hoặc header cũ. Account bị lock/inactive bị từ chối sau khi token đã cấp.

## Hành vi của API

Request chưa authenticate trả 401; thiếu membership/capability hoặc account bị lock trả 403; nhiều lookup workspace/resource ngoài scope trả 404 có chủ ý không tiết lộ; nhiều membership mà thiếu header trả 409 với `workspace_required`. Route map trong `frontend/src/lib/auth/route-access.ts` chỉ giúp điều hướng, không phải security control.

## Vị trí source code và kiểm chứng

- JWT/principal: [`backend/src/services/auth.py`](../../backend/src/services/auth.py).
- Dependency pipeline: [`backend/src/api/dependencies.py`](../../backend/src/api/dependencies.py).
- Capability registry: [`backend/src/services/permissions.py`](../../backend/src/services/permissions.py).
- Production validation: [`backend/src/config.py`](../../backend/src/config.py).
- Test: tìm trong `tests/` với `auth`, `jwt`, `workspace`, `permission`, `locked` và `guest`.
