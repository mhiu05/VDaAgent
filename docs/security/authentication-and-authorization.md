# Xác thực và phân quyền

Production dùng Supabase Auth để phát JWT, nhưng mọi quyết định truy cập domain được thực thi trong FastAPI/PostgreSQL.

## Xác thực production

`AUTH_MODE=supabase` yêu cầu bearer token. Backend:

1. đọc JWT header và chỉ chấp nhận thuật toán bất đối xứng ES256/RS256;
2. lấy signing key từ Supabase JWKS với cache có giới hạn;
3. retry một lần khi key rotation làm `kid` chưa có trong cache;
4. kiểm tra signature, issuer, audience, `sub`, `exp` và role `authenticated`;
5. nếu policy yêu cầu, kiểm tra email đã xác nhận;
6. chỉ gọi Supabase Auth như fallback hẹp khi token hợp lệ không thể xác minh cục bộ.

Các lỗi không được phép fallback (sai claim, thuật toán, role hoặc token hỏng) phải fail closed. Network auth/JWKS dùng I/O async có timeout; thao tác DB/JWKS blocking được đưa khỏi event loop.

## Đường request đã xác thực

Sau token verification, backend resolve profile và memberships trong một truy vấn hợp nhất, chọn workspace hợp lệ, canonicalize role và tính capability. Account bị khóa, workspace archived, membership thiếu hoặc workspace khác đều bị từ chối trước khi gọi service domain.

Frontend route guard, cookie và `X-Workspace-Id` chỉ giúp UX/chọn ngữ cảnh; chúng không phải authorization proof.

## Chế độ local

`AUTH_MODE=dual` cùng `AUTH_ALLOW_GUEST=true` hỗ trợ bootstrap/guest cho phát triển. Không dùng cấu hình này trong production. API token compatibility chỉ là đường chuyển tiếp; không mở rộng nó thành một cơ chế tenant auth song song.

## Role và capability

- Workspace role chuẩn hiện là `analyst`.
- System role `admin` tách khỏi workspace membership.
- Endpoint kiểm capability cụ thể thay vì chỉ so sánh chuỗi role.
- System admin không tự động sở hữu dữ liệu của mọi workspace.
- Thay đổi membership/admin phải ghi audit.

Các route report hiện cho analyst submit/review/publish và chưa enforce separation-of-duties; xem [Báo cáo](../features/reports.md).

## Mã lỗi và chống lộ thông tin

- 401: thiếu/không hợp lệ token;
- 403: principal hợp lệ nhưng thiếu capability;
- 404 có thể được dùng để không lộ tài nguyên workspace khác;
- 409: xung đột version/lifecycle;
- 422: request vi phạm contract.

Không trả chi tiết JWT, membership của tenant khác hoặc secret trong error body/log.

## Cấu hình chính

- `AUTH_MODE`, `AUTH_ALLOW_GUEST`, `AUTH_ALLOW_SIGNUP`;
- `AUTH_REQUIRE_EMAIL_CONFIRMED`;
- `SUPABASE_URL`, `SUPABASE_AUTH_ISSUER`, `SUPABASE_AUTH_AUDIENCE`;
- `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`;
- JWKS timeout/cache và danh sách thuật toán.

`SUPABASE_SERVICE_ROLE_KEY` chỉ còn fallback tương thích một release; cấu hình mới nên dùng secret key backend. Không đưa bất kỳ backend key nào vào biến `NEXT_PUBLIC_*`.

## Nguồn triển khai

- `backend/src/services/auth.py`
- `backend/src/api/dependencies.py`
- `backend/src/services/permissions.py`
- `backend/src/api/authz_routes.py`
- `backend/src/api/admin_routes.py`
