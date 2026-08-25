"""Unit tests for Supabase JWT authentication boundaries."""

from __future__ import annotations

import asyncio

import httpx
import pytest
from src.api import authz_routes
from src.config import Settings
from src.services.auth import AuthContext, JWTVerificationError, SupabaseJWTVerifier


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


def test_session_provisions_personal_workspace_for_new_confirmed_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        provisioned: tuple[str, str | None, str] | None = None

        def sync_user_profile(self, user_id: str, email: str | None) -> None:
            return None

        def is_user_locked(self, user_id: str) -> bool:
            return False

        def get_user_profile(self, user_id: str) -> dict[str, str]:
            return {"role": "analyst", "status": "active"}

        def provision_self_signup_workspace(
            self, user_id: str, email: str | None, role: str
        ) -> None:
            self.provisioned = (user_id, email, role)

    repository = Repository()
    workspace = {
        "id": "workspace-1",
        "name": "Workspace của new-user",
        "slug": "personal-workspace-1",
        "role": "analyst",
    }
    calls = 0

    def workspace_items(_repository: Repository, _user_id: str) -> list[dict[str, str]]:
        nonlocal calls
        calls += 1
        return [] if calls == 1 else [workspace]

    monkeypatch.setattr(authz_routes, "get_repository", lambda: repository)
    monkeypatch.setattr(authz_routes, "_workspace_items", workspace_items)
    monkeypatch.setattr(authz_routes.get_settings(), "auth_allow_signup", True)

    response = asyncio.run(
        authz_routes.session(
            AuthContext(
                user_id="00000000-0000-0000-0000-000000000123",
                email="new-user@example.com",
                session_id="session-1",
                aal="aal1",
                raw_claims={"role": "authenticated"},
            ),
            workspace_header=None,
        )
    )

    assert repository.provisioned == (
        "00000000-0000-0000-0000-000000000123",
        "new-user@example.com",
        "analyst",
    )
    assert response["workspace"] == {"id": "workspace-1", "role": "analyst"}


def test_workspace_bootstrap_combines_authorized_session_and_dashboard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        selected_workspace_id: str | None = None

        def dashboard_summary(self, workspace_id: str) -> dict[str, object]:
            self.selected_workspace_id = workspace_id
            return {
                "kind": "analyst",
                "counts": {"datasets": 0, "profiles": 0, "reports": 0},
                "reports": [],
            }

    async def session_snapshot(
        _user: AuthContext, _workspace_header: str | None
    ) -> dict[str, object]:
        return {
            "user": {"id": "user-1", "email": "analyst@example.com"},
            "workspace": {"id": "workspace-1", "role": "analyst"},
            "effective_permissions": [],
            "workspaces": [],
        }

    repository = Repository()
    monkeypatch.setattr(authz_routes, "session", session_snapshot)
    monkeypatch.setattr(authz_routes, "get_repository", lambda: repository)

    response = asyncio.run(
        authz_routes.workspace_bootstrap(
            AuthContext(
                user_id="user-1",
                email="analyst@example.com",
                session_id="session-1",
                aal="aal1",
                raw_claims={"role": "authenticated"},
            ),
            workspace_header=None,
        )
    )

    assert repository.selected_workspace_id == "workspace-1"
    assert response["dashboard"] == {
        "kind": "analyst",
        "counts": {"datasets": 0, "profiles": 0, "reports": 0},
        "reports": [],
    }
