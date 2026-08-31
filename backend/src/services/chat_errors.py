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
    "CHAT_NETWORK": ChatError("CHAT_NETWORK", "The connection to the agent was interrupted.", ("retry",)),
    "AUTH_REQUIRED": ChatError("AUTH_REQUIRED", "Your session needs to be refreshed.", ("refresh_session",)),
    "PERMISSION_DENIED": ChatError("PERMISSION_DENIED", "You do not have access to this chat context.", ("switch_context",)),
    "WORKSPACE_ACCESS_DENIED": ChatError("WORKSPACE_ACCESS_DENIED", "This workspace is not available to the current session.", ("switch_context",)),
    "CHAT_TIMEOUT": ChatError("CHAT_TIMEOUT", "The analysis took too long to complete safely.", ("retry", "narrow_question")),
    "CHAT_CANCELLED": ChatError("CHAT_CANCELLED", "The request was cancelled.", ("retry",)),
    "PROFILE_NOT_READY": ChatError("PROFILE_NOT_READY", "This Profile Run is not ready yet.", ("open_profiling_status",)),
    "PROFILE_UNAVAILABLE": ChatError("PROFILE_UNAVAILABLE", "The selected Profile Run is unavailable in this workspace.", ("switch_context",)),
    "INSUFFICIENT_EVIDENCE": ChatError("INSUFFICIENT_EVIDENCE", "Available evidence is not sufficient for a safe answer.", ("run_full_profile", "clarify")),
    "INVALID_QUESTION": ChatError("INVALID_QUESTION", "Please clarify the question before continuing.", ("clarify",)),
    "CONTEXT_MISMATCH": ChatError("CONTEXT_MISMATCH", "This follow-up refers to a different Profile Run.", ("clarify", "switch_context")),
    "TOOL_TEMPORARY_FAILURE": ChatError("TOOL_TEMPORARY_FAILURE", "A required analysis tool is temporarily unavailable.", ("retry",)),
    "PROVIDER_UNAVAILABLE": ChatError("PROVIDER_UNAVAILABLE", "The answer provider is temporarily unavailable.", ("retry",)),
    "REQUEST_IN_PROGRESS": ChatError("REQUEST_IN_PROGRESS", "This request is still being processed. Reconnect to check its result without starting another run.", ("reconnect",)),
    "SERVER_ERROR": ChatError("SERVER_ERROR", "The agent could not complete the answer.", ("retry",)),
}


def chat_error(code: str) -> ChatError:
    return ERRORS.get(code, ERRORS["SERVER_ERROR"])


def http_detail(code: str) -> dict[str, object]:
    """FastAPI ``detail`` payload shared by non-streaming QA failures."""

    return chat_error(code).as_payload()


__all__ = ["ChatError", "ChatErrorCode", "chat_error", "http_detail"]
