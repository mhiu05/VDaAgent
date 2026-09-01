"""Safe, versioned Chat Agent error semantics.

The API deliberately maps implementation exceptions to this small public
vocabulary.  Neither provider error text nor database/trace details may cross
the browser boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ChatErrorCode = Literal[
    "CHAT_NETWORK",
    "CHAT_TIMEOUT",
    "CHAT_CANCELLED",
    "AUTH_REQUIRED",
    "PERMISSION_DENIED",
    "WORKSPACE_ACCESS_DENIED",
    "PROFILE_NOT_READY",
    "PROFILE_UNAVAILABLE",
    "INSUFFICIENT_EVIDENCE",
    "INVALID_QUESTION",
    "CONTEXT_MISMATCH",
    "TOOL_TEMPORARY_FAILURE",
    "PROVIDER_UNAVAILABLE",
    "REQUEST_IN_PROGRESS",
    "SERVER_ERROR",
]


@dataclass(frozen=True)
class ChatError:
    code: ChatErrorCode
    message: str
    recovery_actions: tuple[str, ...] = ()

    def as_payload(self) -> dict[str, object]:
        return {
            "code": self.code,
            "detail": self.message,
            "recovery_actions": list(self.recovery_actions),
        }


ERRORS: dict[str, ChatError] = {
    "CHAT_NETWORK": ChatError("CHAT_NETWORK", "Kết nối tới agent bị gián đoạn.", ("retry",)),
    "AUTH_REQUIRED": ChatError("AUTH_REQUIRED", "Phiên đăng nhập cần được làm mới.", ("refresh_session",)),
    "PERMISSION_DENIED": ChatError("PERMISSION_DENIED", "Bạn không có quyền truy cập ngữ cảnh chat này.", ("switch_context",)),
    "WORKSPACE_ACCESS_DENIED": ChatError("WORKSPACE_ACCESS_DENIED", "Workspace này không khả dụng trong phiên hiện tại.", ("switch_context",)),
    "CHAT_TIMEOUT": ChatError("CHAT_TIMEOUT", "Phân tích mất quá nhiều thời gian để hoàn tất an toàn.", ("retry", "narrow_question")),
    "CHAT_CANCELLED": ChatError("CHAT_CANCELLED", "Yêu cầu đã bị hủy.", ("retry",)),
    "PROFILE_NOT_READY": ChatError("PROFILE_NOT_READY", "Profile Run này chưa sẵn sàng.", ("open_profiling_status",)),
    "PROFILE_UNAVAILABLE": ChatError("PROFILE_UNAVAILABLE", "Profile Run đã chọn không có trong workspace này.", ("switch_context",)),
    "INSUFFICIENT_EVIDENCE": ChatError("INSUFFICIENT_EVIDENCE", "Evidence hiện có chưa đủ để trả lời an toàn.", ("run_full_profile", "clarify")),
    "INVALID_QUESTION": ChatError("INVALID_QUESTION", "Hãy làm rõ câu hỏi trước khi tiếp tục.", ("clarify",)),
    "CONTEXT_MISMATCH": ChatError("CONTEXT_MISMATCH", "Lượt hỏi tiếp theo này đang tham chiếu Profile Run khác.", ("clarify", "switch_context")),
    "TOOL_TEMPORARY_FAILURE": ChatError("TOOL_TEMPORARY_FAILURE", "Công cụ phân tích cần thiết đang tạm thời không khả dụng.", ("retry",)),
    "PROVIDER_UNAVAILABLE": ChatError("PROVIDER_UNAVAILABLE", "Nhà cung cấp câu trả lời AI đang tạm thời không khả dụng.", ("retry",)),
    "REQUEST_IN_PROGRESS": ChatError("REQUEST_IN_PROGRESS", "Yêu cầu này vẫn đang được xử lý. Hãy kết nối lại để xem kết quả mà không tạo lượt chạy mới.", ("reconnect",)),
    "SERVER_ERROR": ChatError("SERVER_ERROR", "Agent chưa thể hoàn tất câu trả lời.", ("retry",)),
}


def chat_error(code: str) -> ChatError:
    return ERRORS.get(code, ERRORS["SERVER_ERROR"])


def http_detail(code: str) -> dict[str, object]:
    """FastAPI ``detail`` payload shared by non-streaming QA failures."""

    return chat_error(code).as_payload()


__all__ = ["ChatError", "ChatErrorCode", "chat_error", "http_detail"]
