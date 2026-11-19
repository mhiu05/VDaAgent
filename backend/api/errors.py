"""The error shape of doc 15: `{"error": "<code>", "message": "<Vietnamese, user-safe>"}`."""

from __future__ import annotations

from collections.abc import Mapping

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

MESSAGES = {
    "invalid_request": "Dữ liệu gửi lên không hợp lệ.",
    "unauthenticated": "Bạn cần đăng nhập.",
    "invalid_credentials": "Tên đăng nhập hoặc mật khẩu không đúng.",
    "demo_admin_unavailable": "Demo quản trị chưa được cấu hình trên môi trường này.",
    "demo_unavailable": "Không thể đăng nhập tài khoản demo. Vui lòng thử lại.",
    "forbidden": "Bạn không có quyền thực hiện thao tác này.",
    "csrf": "Yêu cầu bị từ chối.",
    "user_disabled": "Tài khoản đã bị vô hiệu hóa.",
    "not_found": "Không tìm thấy.",
    "username_taken": "Tên đăng nhập đã tồn tại.",
    "domain_change_unsupported": "Chưa hỗ trợ đổi miền dữ liệu của người dùng.",
    "rate_limited": "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.",
    "domain_unavailable": "Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên.",
    "invalid_path": "Đường dẫn không hợp lệ.",
    "invalid_commit": "Phiên bản không hợp lệ.",
    "not_expandable": "Thư mục này không thể mở.",
    "not_a_directory": "Đây không phải thư mục.",
    "not_a_file": "Đây không phải tệp.",
    "invalid_slug": "Mã agent không hợp lệ.",
    "unknown_credential_set": "Bộ thông tin đăng nhập không tồn tại trong miền dữ liệu.",
    "slug_taken": "Mã agent đã được dùng.",
    "agent_limit": "Đã đạt số agent tối đa.",
    "agent_busy_in_task": "Agent đang tham gia một việc đang chạy.",
    "lead_protected": "Không thể xóa agent điều phối.",
    "domain_taken": "Mã miền dữ liệu đã tồn tại.",
    "invalid_domain_id": "Mã miền dữ liệu không hợp lệ.",
    "credential_set_taken": "Bộ thông tin đăng nhập đã tồn tại trong miền dữ liệu này.",
    "credential_set_in_use": "Bộ thông tin đăng nhập đang được một agent mẫu dùng, không thể xóa.",
    "unknown_credential_key": "Key không khớp với khai báo của bộ thông tin đăng nhập.",
    "starter_taken": "Mã agent mẫu đã tồn tại trong miền dữ liệu này.",
    "unknown_preset": "Thư viện không tồn tại.",
}


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message or MESSAGES.get(code, "Đã có lỗi xảy ra.")
        self.headers = dict(headers or {})


def error_response(
    status: int, code: str, message: str | None = None, headers: Mapping[str, str] | None = None
) -> JSONResponse:
    err = ApiError(status, code, message, headers)
    return JSONResponse(
        {"error": err.code, "message": err.message}, status_code=status, headers=err.headers
    )


# Framework errors (unknown route, wrong method, ...) mapped onto doc 15 codes.
_HTTP_CODES = {401: "unauthenticated", 403: "forbidden", 404: "not_found", 429: "rate_limited"}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Path parameters that don't parse (e.g. a malformed id) are a missing resource.
        if all(e.get("loc", ("",))[0] == "path" for e in exc.errors()):
            return error_response(404, "not_found")
        return error_response(400, "invalid_request")

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "invalid_request")
        return error_response(exc.status_code, code, headers=getattr(exc, "headers", None))
