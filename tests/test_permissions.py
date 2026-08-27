"""Permission contract for the single Analyst workspace role."""

from src.services.permissions import (
    AGENT_TRACE_DEBUG_READ,
    CALENDAR_READ,
    CALENDAR_WRITE,
    QA_PUBLISHED_ASK,
    REPORT_ARCHIVE,
    REPORT_PUBLISH,
    REPORT_PUBLISHED_EXPORT,
    REPORT_PUBLISHED_READ,
    REPORT_REVIEW,
    WORKSPACE_ACTIVITY_READ,
    WORKSPACE_AUDIT_READ,
    WORKSPACE_CREATE,
    WORKSPACE_DELETE,
    WORKSPACE_MEMBERS_MANAGE,
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_STORAGE_CONNECT,
    permissions_for_role,
)


def test_analyst_has_the_complete_workspace_flow() -> None:
    analyst = permissions_for_role("analyst")
    expected = {
        AGENT_TRACE_DEBUG_READ,
        QA_PUBLISHED_ASK,
        REPORT_ARCHIVE,
        REPORT_PUBLISH,
        REPORT_PUBLISHED_EXPORT,
        REPORT_PUBLISHED_READ,
        REPORT_REVIEW,
        WORKSPACE_ACTIVITY_READ,
        WORKSPACE_AUDIT_READ,
        WORKSPACE_CREATE,
        WORKSPACE_DELETE,
        WORKSPACE_MEMBERS_MANAGE,
        WORKSPACE_SETTINGS_MANAGE,
        WORKSPACE_STORAGE_CONNECT,
        CALENDAR_READ,
        CALENDAR_WRITE,
    }
    assert expected <= analyst


def test_admin_has_system_management_only() -> None:
    admin = permissions_for_role("admin")
    analyst = permissions_for_role("analyst")
    assert "user.accounts.read" in admin
    assert "user.account.manage" in admin
    assert "system.admin" in admin
    assert "dataset.read" not in admin
    from src.services.permissions import system_permissions_for_role
    system = system_permissions_for_role("admin")
    assert "user.accounts.read" in system
    assert "user.account.manage" in system
    assert "system.admin" in system
    assert not (analyst & system)


def test_removed_roles_fail_closed_and_are_not_supported_by_the_contract() -> None:
    assert permissions_for_role("viewer") == frozenset()
    assert permissions_for_role("unknown_role") == frozenset()
