"""Unit tests for Supabase JWT authentication boundaries."""

from __future__ import annotations

import httpx
import pytest

from src.config import Settings
from src.services.auth import JWTVerificationError, SupabaseJWTVerifier


def _verifier() -> SupabaseJWTVerifier:
    settings = Settings(
        app_env="test",
        database_url="postgresql+psycopg://user:password@localhost/test",
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="publishable-test-key",
        auth_require_email_confirmed=True,
    )
    return SupabaseJWTVerifier(settings)


def test_email_confirmation_uses_supabase_user_record_when_jwt_claim_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        status_code = 200

        @staticmethod
        def json() -> dict[str, str]:
            return {"email_confirmed_at": "2026-08-13T08:00:00Z"}

    captured: dict[str, object] = {}

    def fake_get(url: str, **kwargs: object) -> Response:
        captured["url"] = url
        captured["kwargs"] = kwargs
        return Response()

    monkeypatch.setattr(httpx, "get", fake_get)

    assert _verifier()._email_is_confirmed("access-token") is True
    assert captured["url"] == "https://example.supabase.co/auth/v1/user"
    assert captured["kwargs"]["headers"] == {
        "apikey": "publishable-test-key",
        "Authorization": "Bearer access-token",
    }


def test_email_confirmation_rejects_user_without_confirmation_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        status_code = 200

        @staticmethod
        def json() -> dict[str, None]:
            return {"email_confirmed_at": None}

    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: Response())

    assert _verifier()._email_is_confirmed("access-token") is False


def test_email_confirmation_fails_closed_on_auth_request_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get(*args: object, **kwargs: object) -> None:
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx, "get", fake_get)

    with pytest.raises(JWTVerificationError, match="Không thể kiểm tra"):
        _verifier()._email_is_confirmed("access-token")
