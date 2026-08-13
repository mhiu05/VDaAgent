"""Permission contracts for workspace-scoped integrations."""

from src.services.permissions import (
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_STORAGE_CONNECT,
    permissions_for_role,
)


def test_analyst_can_connect_storage_but_cannot_manage_workspace_settings() -> None:
    analyst = permissions_for_role("analyst")
    assert WORKSPACE_STORAGE_CONNECT in analyst
    assert WORKSPACE_SETTINGS_MANAGE not in analyst


def test_viewer_cannot_connect_storage() -> None:
    assert WORKSPACE_STORAGE_CONNECT not in permissions_for_role("viewer")
