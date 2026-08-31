"""Persistence guarantees for client-generated agent request identifiers."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine

from src.services.repository import Repository


def _create(repo: Repository, *, request_hash: str) -> tuple[str, bool]:
    result = repo.create_agent_run(
        workspace_id="workspace-1",
        actor_user_id="user-1",
        run_type="qa",
        resource_bindings={"profile_run_id": "run-1"},
        version_snapshot={"runtime_version": "2.0.0", "policy_version": "test"},
        idempotency_key="request-123",
        request_hash=request_hash,
        return_created=True,
    )
    assert isinstance(result, tuple)
    return result


def test_agent_run_idempotency_reuses_only_the_identical_request() -> None:
    repo = Repository(engine=create_engine("sqlite:///:memory:"))

    first_id, first_created = _create(repo, request_hash="hash-a")
    second_id, second_created = _create(repo, request_hash="hash-a")

    assert first_created is True
    assert second_created is False
    assert second_id == first_id
    with pytest.raises(ValueError, match="idempotency_key_reused"):
        _create(repo, request_hash="hash-b")
