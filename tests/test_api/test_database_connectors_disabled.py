from __future__ import annotations

from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from src.config import get_settings
from src.services.datasource import DatabaseConnectorsDisabledError
from src.services.repository import get_repository
from src.services.storage import materialize_source


DATABASE_KINDS = ("mysql", "mongodb", "duckdb")


def _owner_scope(client: TestClient) -> tuple[str, str]:
    response = client.get("/api/v1/session")
    assert response.status_code == 200, response.text
    payload = response.json()
    return str(payload["workspace"]["id"]), str(payload["user"]["id"])


def _legacy_connection(client: TestClient, kind: str) -> str:
    workspace_id, user_id = _owner_scope(client)
    connection_id = uuid4().hex
    get_repository().create_datasource_connection(
        connection_id,
        workspace_id=workspace_id,
        created_by_user_id=user_id,
        name=f"legacy-{kind}-{connection_id[:8]}",
        kind=kind,
        # The guard must reject without attempting to decrypt this sentinel.
        config_encrypted="must-not-decrypt",
    )
    return connection_id


def _analyst_headers(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    monkeypatch.setattr(get_settings(), "auth_allow_guest", True)
    session_id = uuid4()
    headers = {"Authorization": f"Bearer guest.{session_id}.analyst"}
    session = client.get("/api/v1/session", headers=headers)
    assert session.status_code == 200, session.text
    return {**headers, "X-Workspace-Id": session.json()["workspace"]["id"]}


@pytest.mark.parametrize("kind", DATABASE_KINDS)
@pytest.mark.parametrize("path", [
    "/api/v1/datasets/datasource/test",
    "/api/v1/datasets/datasource",
    "/api/v1/connectors/datasource",
    "/api/v1/connectors/datasource/test",
])
def test_owner_cannot_create_or_test_database_connectors(
    client: TestClient, kind: str, path: str
) -> None:
    response = client.post(
        path,
        json={"kind": kind, "name": "blocked", "config": {"host": "127.0.0.1"}},
    )
    assert response.status_code == 403, response.text
    assert response.json()["detail"]["code"] == "database_connectors_disabled"


@pytest.mark.parametrize("path,payload", [
    ("/api/v1/datasets/datasource/test", {"kind": "mysql", "name": "blocked", "config": {}}),
    ("/api/v1/datasets/datasource", {"kind": "mongodb", "name": "blocked", "config": {}}),
    ("/api/v1/connectors/datasource", {"kind": "duckdb", "name": "blocked", "config": {}}),
    ("/api/v1/connectors/datasource/test", {"kind": "mysql", "name": "blocked", "config": {}}),
    ("/api/v1/connectors/datasource:not-a-connection/test", None),
    ("/api/v1/datasets/datasource/not-a-connection/use", {"name": "blocked"}),
])
def test_analyst_cannot_reach_any_database_connector_route(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    payload: dict[str, object] | None,
) -> None:
    response = client.post(path, json=payload, headers=_analyst_headers(client, monkeypatch))
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("kind", DATABASE_KINDS)
def test_legacy_connection_is_redacted_disabled_and_cannot_be_reused_or_materialized(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    connection_id = _legacy_connection(client, kind)
    forbidden = Mock(side_effect=AssertionError("legacy credential must not be touched"))
    monkeypatch.setattr("src.api.routes.decrypt_config", forbidden)
    monkeypatch.setattr("src.api.routes.probe", forbidden)
    monkeypatch.setattr("src.api.routes.materialize_connection", forbidden)
    monkeypatch.setattr("src.services.storage.materialize_connection", forbidden)

    listed = client.get("/api/v1/connectors")
    assert listed.status_code == 200, listed.text
    connector = next(item for item in listed.json()["connectors"] if item["id"] == f"datasource:{connection_id}")
    assert connector["status"] == "disabled"
    assert connector["unavailable"] is True
    assert connector["safe_target"] == {"unavailable": True}
    assert connector["can_test"] is False
    assert connector["can_edit"] is False
    assert {item["provider"] for item in listed.json()["available"]} == {"google_drive"}

    for path, payload in (
        (
            f"/api/v1/connectors/datasource:{connection_id}",
            {"kind": kind, "name": "blocked-update", "config": {"host": "127.0.0.1"}},
        ),
        (f"/api/v1/connectors/datasource:{connection_id}/test", None),
        (f"/api/v1/datasets/datasource/{connection_id}/use", {"name": "blocked"}),
    ):
        response = client.patch(path, json=payload) if path.endswith(connection_id) else client.post(path, json=payload)
        assert response.status_code == 403, response.text
        assert response.json()["detail"]["code"] == "database_connectors_disabled"

    other_workspace = client.post("/api/v1/workspaces", json={"name": f"other-{uuid4().hex[:8]}"})
    assert other_workspace.status_code == 201, other_workspace.text
    cross_workspace = client.post(
        f"/api/v1/datasets/datasource/{connection_id}/use",
        json={"name": "cross-workspace"},
        headers={"X-Workspace-Id": other_workspace.json()["id"]},
    )
    assert cross_workspace.status_code == 404, cross_workspace.text

    with pytest.raises(DatabaseConnectorsDisabledError):
        with materialize_source(f"datasource://{connection_id}"):
            pass
    forbidden.assert_not_called()

    deleted = client.delete(f"/api/v1/connectors/datasource:{connection_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True
