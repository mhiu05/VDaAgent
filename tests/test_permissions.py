"""Permission matrix for the Owner/Analyst workspace boundary."""

from src.services.permissions import (
    AGENT_RUN_READ,
    AGENT_TRACE_DEBUG_READ,
    AGENT_TRACE_READ,
    ANALYSIS_RUN,
    DATASET_DELETE,
    DATASET_READ,
    DATASET_UPLOAD,
    DRIFT_RUN,
    PROFILE_READ,
    PROFILE_REVIEW,
    PROFILE_RUN,
    QA_PROFILE_ASK,
    QA_PUBLISHED_ASK,
    REPORT_ARCHIVE,
    REPORT_DRAFT_WRITE,
    REPORT_PUBLISH,
    REPORT_PUBLISHED_EXPORT,
    REPORT_PUBLISHED_READ,
    REPORT_REVIEW,
    REPORT_SUBMIT,
    STATS_RUN,
    WORKSPACE_ACTIVITY_READ,
    WORKSPACE_AUDIT_READ,
    WORKSPACE_CREATE,
    WORKSPACE_DELETE,
    WORKSPACE_LIFECYCLE_MANAGE,
    WORKSPACE_MEMBERS_MANAGE,
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_STORAGE_CONNECT,
    permissions_for_role,
    role_can_manage_target,
    workspace_permissions_for_role,
)


def test_analyst_has_only_the_collaborative_analysis_flow() -> None:
    analyst = permissions_for_role("analyst")
    expected = {
        AGENT_RUN_READ,
        AGENT_TRACE_READ,
        ANALYSIS_RUN,
        DATASET_READ,
        DATASET_UPLOAD,
        DRIFT_RUN,
        PROFILE_READ,
        PROFILE_REVIEW,
        PROFILE_RUN,
        QA_PROFILE_ASK,
        QA_PUBLISHED_ASK,
        REPORT_DRAFT_WRITE,
        REPORT_PUBLISHED_EXPORT,
        REPORT_PUBLISHED_READ,
        REPORT_SUBMIT,
        STATS_RUN,
        WORKSPACE_ACTIVITY_READ,
    }
    assert analyst == expected


def test_owner_inherits_analysis_and_gets_sensitive_workspace_capabilities() -> None:
    analyst = permissions_for_role("analyst")
    owner = permissions_for_role("owner")
    sensitive = {
        AGENT_TRACE_DEBUG_READ,
        DATASET_DELETE,
        REPORT_ARCHIVE,
        REPORT_PUBLISH,
        REPORT_REVIEW,
        WORKSPACE_AUDIT_READ,
        WORKSPACE_CREATE,
        WORKSPACE_DELETE,
        WORKSPACE_LIFECYCLE_MANAGE,
        WORKSPACE_MEMBERS_MANAGE,
        WORKSPACE_SETTINGS_MANAGE,
        WORKSPACE_STORAGE_CONNECT,
    }
    assert owner == analyst | sensitive
    assert not (sensitive & analyst)


def test_admin_has_system_management_only() -> None:
    admin = permissions_for_role("admin")
    assert {"user.accounts.read", "user.account.manage", "system.admin"} <= admin
    assert "dataset.read" not in admin
    assert not (permissions_for_role("analyst") & admin)


def test_only_owner_can_manage_workspace_memberships() -> None:
    assert role_can_manage_target("owner", "owner") is True
    assert role_can_manage_target("owner", "analyst") is True
    assert role_can_manage_target("analyst", "owner") is False
    assert role_can_manage_target("analyst", "analyst") is False
    assert role_can_manage_target("admin", "analyst") is False


def test_removed_or_unknown_workspace_roles_fail_closed() -> None:
    assert permissions_for_role("viewer") == frozenset()
    assert permissions_for_role("unknown_role") == frozenset()
    assert workspace_permissions_for_role("viewer") == frozenset()
    assert workspace_permissions_for_role("unknown_role") == frozenset()
