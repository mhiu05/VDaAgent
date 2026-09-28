# Quy ước lỗi API

**Status: Implemented.** Router bọc lỗi thành `ProblemSchema`: `type` (`urn:vda:problem:<code>`), `title` (mã ổn định), `status`, `detail`. `RepositoryError` giữ status/code do domain hoặc quyền cung cấp; Zod lỗi trả `400 VALIDATION_FAILED`; `RuntimeContextError` trả 403; lỗi không xác định trả `500 INTERNAL_ERROR` với detail chung. CSV/hierarchy/schedule input lỗi được ánh xạ 422. Server log diagnostic giới hạn, không trả raw stack/query/provider exception cho client.

| Status thường gặp | Ý nghĩa và hành động client |
| --- | --- |
| 400 / 422 | Request/schema hoặc CSV/domain không hợp lệ; sửa input, không retry y nguyên. |
| 401 | Chưa đăng nhập hoặc grant hết hạn; tải lại session/đăng nhập. |
| 403 | Không thuộc organization, viewer cố ghi, hoặc context ref không được phép. |
| 404 | Tài nguyên/report/brief không tồn tại hoặc chưa có; một số tài nguyên nội bộ cố ý trả 404. |
| 409 | Xung đột idempotency, snapshot bất biến, lease/cancel/publication; tải lại state trước khi quyết định thao tác tiếp. |
| 502 / 503 / 500 | Storage/provider/cấu hình hoặc lỗi nội bộ; theo dõi server log và trạng thái run/job. |

Run/job còn có `error_code` ở trạng thái terminal và event `failed`; lỗi HTTP của một lần poll không tự chứng minh worker đã dừng. `Idempotency-Key` cùng key nhưng payload khác trả `IDEMPOTENCY_CONFLICT`. API không phát correlation/request ID chung trong problem response ở code hiện tại; event sequence và run/job IDs là khóa theo dõi hữu ích.

Code: `src/frontend/src/server/api/problem-response.ts`, `src/backend/packages/db/src/errors.ts`, `src/frontend/src/server/api/middleware/request-body.ts`, `src/backend/packages/contracts/src`. Xem [failure recovery](../workflows/failure-recovery.md).
