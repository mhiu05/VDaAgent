"""Permission contracts for workspace-scoped integrations."""

from src.services.permissions import (
    ACCOUNT_DIRECTORY_READ,
    NOTEBOOK_READ,
    QA_PUBLISHED_ASK,
    REPORT_PUBLISHED_EXPORT,
    REPORT_PUBLISHED_READ,
    WORKSPACE_ACTIVITY_READ,
    WORKSPACE_AUDIT_READ,
    WORKSPACE_CREATE,
    WORKSPACE_DELETE,
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_STORAGE_CONNECT,
    permissions_for_role,
)


def test_analyst_can_connect_storage_but_cannot_manage_workspace_settings() -> None:
    analyst = permissions_for_role("analyst")
    assert WORKSPACE_STORAGE_CONNECT in analyst
    assert WORKSPACE_CREATE in analyst
    assert WORKSPACE_DELETE in analyst
    assert WORKSPACE_SETTINGS_MANAGE not in analyst


def test_viewer_cannot_connect_storage() -> None:
    viewer = permissions_for_role("viewer")
    assert WORKSPACE_STORAGE_CONNECT not in viewer
    assert NOTEBOOK_READ not in viewer
    assert QA_PUBLISHED_ASK not in viewer
    assert REPORT_PUBLISHED_READ in viewer
    assert REPORT_PUBLISHED_EXPORT in viewer


def test_workspace_roles_keep_admin_activity_boundary_explicitly() -> None:
    analyst = permissions_for_role("analyst")
    admin = permissions_for_role("admin")
    viewer = permissions_for_role("viewer")

    assert WORKSPACE_ACTIVITY_READ in admin
    assert WORKSPACE_AUDIT_READ in admin
    assert ACCOUNT_DIRECTORY_READ in admin
    assert WORKSPACE_CREATE not in admin
    assert ACCOUNT_DIRECTORY_READ not in analyst
    assert ACCOUNT_DIRECTORY_READ not in viewer
    assert WORKSPACE_ACTIVITY_READ not in analyst
    assert WORKSPACE_AUDIT_READ not in analyst
    assert WORKSPACE_ACTIVITY_READ not in viewer
    assert WORKSPACE_AUDIT_READ not in viewer
