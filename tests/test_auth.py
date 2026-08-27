"""Unit tests for Supabase JWT authentication boundaries."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import jwt
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from src.api import authz_routes, dependencies
from src.config import Settings
from src.services.auth import AuthContext, JWTVerificationError, SupabaseJWTVerifier


def _user(*, user_id: str = "00000000-0000-0000-0000-000000000123") -> AuthContext:
    return AuthContext(
        user_id=user_id,
        email="analyst@example.com",
        session_id="session-1",
        aal="aal1",
        raw_claims={"role": "authenticated"},
    )


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


def test_jwt_verifier_passes_bounded_clock_skew_to_pyjwt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    verifier = _verifier()
    captured: dict[str, object] = {}
    verifier._client = SimpleNamespace(
        get_signing_key_from_jwt=lambda _token: SimpleNamespace(key="signing-key")
    )

    monkeypatch.setattr(jwt, "get_unverified_header", lambda _token: {"alg": "ES256", "kid": "kid-1"})

    def fake_decode(*_args: object, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {
            "sub": "00000000-0000-0000-0000-000000000123",
            "email": "analyst@example.com",
            "email_confirmed_at": "2026-08-13T08:00:00Z",
            "role": "authenticated",
        }

    monkeypatch.setattr(jwt, "decode", fake_decode)

    context = verifier.verify("signed-token")

    assert context.user_id == "00000000-0000-0000-0000-000000000123"
    assert captured["leeway"] == 30


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


def test_active_user_guard_rejects_a_locked_or_deleted_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        def __init__(self, account_status: str) -> None:
            self.account_status = account_status
            self.synced: tuple[str, str | None] | None = None

        def sync_user_profile(self, user_id: str, email: str | None) -> None:
            self.synced = (user_id, email)

        def get_user_profile(self, _user_id: str) -> dict[str, str]:
            return {"role": "analyst", "status": self.account_status}

    for account_status in ("locked", "deleted"):
        repository = Repository(account_status)
        monkeypatch.setattr(dependencies, "get_repository", lambda: repository)
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(dependencies.get_active_user(_user()))
        assert exc_info.value.status_code == 403
        assert repository.synced == (_user().user_id, "analyst@example.com")


def test_workspace_entry_rejects_a_system_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        def get_user_profile(self, _user_id: str) -> dict[str, str]:
            return {"role": "admin", "status": "active"}

    monkeypatch.setattr(dependencies, "get_repository", lambda: Repository())
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(dependencies.get_active_analyst_user(_user()))
    assert exc_info.value.status_code == 403


def test_workspace_resolver_hides_an_unrelated_workspace_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        def get_user_profile(self, _user_id: str) -> dict[str, str]:
            return {"role": "analyst", "status": "active"}

        def list_active_workspace_membership_contexts(
            self, _user_id: str
        ) -> list[dict[str, str]]:
            return [{"workspace_id": "workspace-a", "role": "analyst"}]

    monkeypatch.setattr(dependencies, "get_repository", lambda: Repository())
    with pytest.raises(HTTPException) as exc_info:
        dependencies._resolve_workspace(_user(), "workspace-b")
    assert exc_info.value.status_code == 404


def _auth_api() -> FastAPI:
    app = FastAPI()
    app.include_router(authz_routes.router)
    app.dependency_overrides[dependencies.get_current_user] = _user
    return app


def test_locked_user_is_rejected_before_workspace_or_invitation_handlers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        def sync_user_profile(self, _user_id: str, _email: str | None) -> None:
            return None

        @staticmethod
        def get_user_profile(_user_id: str) -> dict[str, str]:
            return {"role": "analyst", "status": "locked"}

    monkeypatch.setattr(dependencies, "get_repository", lambda: Repository())
    client = TestClient(_auth_api())
    assert client.get("/workspaces").status_code == 403
    assert client.post("/invitations/accept", json={"token": "x" * 24}).status_code == 403


def test_system_admin_is_rejected_by_an_analyst_resource_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        def sync_user_profile(self, _user_id: str, _email: str | None) -> None:
            return None

        @staticmethod
        def get_user_profile(_user_id: str) -> dict[str, str]:
            return {"role": "admin", "status": "active"}

    monkeypatch.setattr(dependencies, "get_repository", lambda: Repository())
    response = TestClient(_auth_api()).get("/me")
    assert response.status_code == 403


def test_session_provisions_personal_workspace_for_new_confirmed_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Repository:
        provisioned: tuple[str, str | None, str] | None = None

        def sync_user_profile(self, user_id: str, email: str | None) -> None:
            return None

        def is_user_locked(self, user_id: str) -> bool:
            return False

        def get_user_profile(self, user_id: str) -> dict[str, str] | None:
            return {"user_id": user_id, "role": "analyst", "status": "active"}
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
