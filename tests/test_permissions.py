"""Permission contract for the single Analyst workspace role."""

from src.services.permissions import (
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
    }
    assert expected <= analyst


def test_removed_roles_fail_closed_and_are_not_supported_by_the_contract() -> None:
    assert permissions_for_role("admin") == frozenset()
    assert permissions_for_role("viewer") == frozenset()
