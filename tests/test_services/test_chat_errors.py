"""Public Chat Agent failure taxonomy must remain safe and actionable."""

from __future__ import annotations

from src.services.chat_errors import ERRORS, chat_error, http_detail


def test_every_declared_chat_failure_has_its_own_safe_contract() -> None:
    expected = {
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
    }

    assert set(ERRORS) == expected
    for code in expected:
        payload = http_detail(code)
        assert payload["code"] == code
        assert isinstance(payload["detail"], str)
        assert payload["detail"]
        assert isinstance(payload["recovery_actions"], list)
        assert "traceback" not in payload["detail"].casefold()
        assert "password" not in payload["detail"].casefold()


def test_unknown_internal_errors_fail_closed_to_the_generic_public_error() -> None:
    assert chat_error("postgres_connection_refused").code == "SERVER_ERROR"
