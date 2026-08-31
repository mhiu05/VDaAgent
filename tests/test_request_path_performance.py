"""Regression coverage for the authenticated request-path quick wins."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.pool import StaticPool

from src.api import dependencies
from src.services.auth import AuthContext
from src.services.permissions import PROFILE_RUN
from src.services.repository import Repository, user_profiles, workspace_memberships, workspaces


USER_ID = "00000000-0000-0000-0000-000000000123"
WORKSPACE_ID = "00000000-0000-0000-0000-000000000456"


def _user() -> AuthContext:
    return AuthContext(
        user_id=USER_ID,
        email="analyst@example.com",
        session_id="session-1",
        aal="aal1",
        raw_claims={"role": "authenticated"},
    )


def _repository() -> Repository:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    repository = Repository(engine=engine)
    now = datetime.now(UTC)
    repository.sync_user_profile(USER_ID, "analyst@example.com")
    with engine.begin() as conn:
        conn.execute(
            workspaces.insert().values(
                id=WORKSPACE_ID,
                name="Performance workspace",
                slug="performance-workspace",
                created_by_user_id=USER_ID,
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
        conn.execute(
            workspace_memberships.insert().values(
                workspace_id=WORKSPACE_ID,
                user_id=USER_ID,
                role="analyst",
                status="active",
                created_at=now,
                updated_at=now,
            )
        )
    return repository


def _count_queries(repository: Repository, callback) -> int:
    count = 0

    def before_cursor_execute(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(repository.engine, "before_cursor_execute", before_cursor_execute)
    try:
        callback()
    finally:
        event.remove(repository.engine, "before_cursor_execute", before_cursor_execute)
    return count


def test_authenticated_principal_resolution_reduces_round_trips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = _repository()
    monkeypatch.setattr(dependencies, "get_repository", lambda: repository)

    def before_path() -> None:
        repository.sync_user_profile(USER_ID, "analyst@example.com")
        repository.get_user_profile(USER_ID)
        repository.get_user_profile(USER_ID)
        repository.list_active_workspace_membership_contexts(USER_ID)
        repository.is_user_locked(USER_ID)

    before = _count_queries(repository, before_path)
    after = _count_queries(
        repository,
        lambda: dependencies._resolve_authenticated_workspace(_user(), None),
    )

    assert before == 5
    assert after == 2
    assert after < before


def test_authenticated_principal_preserves_workspace_and_capability_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = _repository()
    monkeypatch.setattr(dependencies, "get_repository", lambda: repository)
    context = dependencies._resolve_authenticated_workspace(_user(), WORKSPACE_ID)

    assert context.workspace_id == WORKSPACE_ID
    assert context.role == "analyst"
    assert PROFILE_RUN in context.effective_permissions


def test_request_context_reuses_one_principal_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    class Repository:
        sync_calls = 0
        resolve_calls = 0

        def sync_user_profile(self, _user_id: str, _email: str | None) -> None:
            self.sync_calls += 1

        def resolve_request_principal(self, _user_id: str) -> dict[str, object]:
            self.resolve_calls += 1
            return {
                "profile": {"role": "analyst", "status": "active"},
                "memberships": [{"workspace_id": WORKSPACE_ID, "role": "analyst"}],
            }

    repository = Repository()
    monkeypatch.setattr(dependencies, "get_repository", lambda: repository)
    app = FastAPI()
    app.dependency_overrides[dependencies.get_current_user] = _user

    @app.get("/protected")
    async def protected(context=Depends(dependencies.require_permission(PROFILE_RUN))):
        return {"workspace_id": context.workspace_id}

    response = TestClient(app).get("/protected")

    assert response.status_code == 200
    assert response.json() == {"workspace_id": WORKSPACE_ID}
    assert repository.sync_calls == 1
    assert repository.resolve_calls == 1


@pytest.mark.parametrize("status", ["locked", "deleted"])
def test_authenticated_principal_rejects_inactive_accounts(
    status: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository = _repository()
    with repository.engine.begin() as conn:
        conn.execute(
            # Keep the account state authoritative in the profile row.
            user_profiles.update()
            .where(user_profiles.c.user_id == USER_ID)
            .values(status=status)
        )
    monkeypatch.setattr(dependencies, "get_repository", lambda: repository)
    with pytest.raises(HTTPException) as exc_info:
        dependencies._resolve_authenticated_workspace(_user(), WORKSPACE_ID)
    assert exc_info.value.status_code == 403


def test_authenticated_principal_hides_wrong_workspace_and_denies_non_member(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = _repository()
    monkeypatch.setattr(dependencies, "get_repository", lambda: repository)
    with pytest.raises(HTTPException) as wrong_workspace:
        dependencies._resolve_authenticated_workspace(
            _user(), "00000000-0000-0000-0000-000000000999"
        )
    with repository.engine.begin() as conn:
        conn.execute(
            workspace_memberships.delete().where(
                workspace_memberships.c.workspace_id == WORKSPACE_ID,
                workspace_memberships.c.user_id == USER_ID,
            )
        )
    with pytest.raises(HTTPException) as non_member:
        dependencies._resolve_authenticated_workspace(_user(), None)

    assert wrong_workspace.value.status_code == 404
    assert non_member.value.status_code == 403
