"""Central workspace roles and permissions.

The API deliberately authorizes capabilities rather than sprinkling role
comparisons throughout routes.  A new sensitive action must be added here and
covered by a test before it can be exposed by an endpoint.
"""

from __future__ import annotations

from typing import Final, Literal

WorkspaceRole = Literal["analyst", "admin"]

REPORT_PUBLISHED_READ: Final = "report.published.read"
REPORT_PUBLISHED_EXPORT: Final = "report.published.export"
QA_PUBLISHED_ASK: Final = "qa.published.ask"
DATASET_READ: Final = "dataset.read"
DATASET_UPLOAD: Final = "dataset.upload"
DATASET_DELETE: Final = "dataset.delete"
PROFILE_READ: Final = "profile.read"
PROFILE_RUN: Final = "profile.run"
PROFILE_REVIEW: Final = "profile.review"
STATS_RUN: Final = "stats.run"
DRIFT_RUN: Final = "drift.run"
QA_PROFILE_ASK: Final = "qa.profile.ask"
ANALYSIS_RUN: Final = "analysis.run"
REPORT_DRAFT_WRITE: Final = "report.draft.write"
REPORT_SUBMIT: Final = "report.submit"
REPORT_REVIEW: Final = "report.review"
REPORT_PUBLISH: Final = "report.publish"
REPORT_ARCHIVE: Final = "report.archive"
WORKSPACE_ACTIVITY_READ: Final = "workspace.activity.read"
WORKSPACE_AUDIT_READ: Final = "workspace.audit.read"
WORKSPACE_MEMBERS_MANAGE: Final = "workspace.members.manage"
WORKSPACE_SETTINGS_MANAGE: Final = "workspace.settings.manage"
WORKSPACE_STORAGE_CONNECT: Final = "workspace.storage.connect"
WORKSPACE_LIFECYCLE_MANAGE: Final = "workspace.lifecycle.manage"
WORKSPACE_CREATE: Final = "workspace.create"
WORKSPACE_DELETE: Final = "workspace.delete"
AGENT_RUN_READ: Final = "agent.run.read"
AGENT_TRACE_READ: Final = "agent.trace.read"
AGENT_TRACE_DEBUG_READ: Final = "agent.trace.debug.read"

# Admin / System Management Permissions
USER_ACCOUNTS_READ: Final = "user.accounts.read"
USER_ACCOUNT_MANAGE: Final = "user.account.manage"
SYSTEM_ADMIN: Final = "system.admin"

CALENDAR_READ: Final = 'calendar.read'
CALENDAR_WRITE: Final = 'calendar.write'

_ANALYST = frozenset({
    REPORT_PUBLISHED_READ,
    REPORT_PUBLISHED_EXPORT,
    DATASET_READ,
    DATASET_UPLOAD,
    DATASET_DELETE,
    PROFILE_READ,
    PROFILE_RUN,
    PROFILE_REVIEW,
    STATS_RUN,
    DRIFT_RUN,
    QA_PROFILE_ASK,
    QA_PUBLISHED_ASK,
    ANALYSIS_RUN,
    REPORT_DRAFT_WRITE,
    REPORT_SUBMIT,
    REPORT_REVIEW,
    REPORT_PUBLISH,
    REPORT_ARCHIVE,
    WORKSPACE_ACTIVITY_READ,
    WORKSPACE_AUDIT_READ,
    WORKSPACE_MEMBERS_MANAGE,
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_STORAGE_CONNECT,
    CALENDAR_READ,
    CALENDAR_WRITE,
    WORKSPACE_LIFECYCLE_MANAGE,
    WORKSPACE_CREATE,
    WORKSPACE_DELETE,
    AGENT_RUN_READ,
    AGENT_TRACE_READ,
    AGENT_TRACE_DEBUG_READ,
})

_ADMIN = frozenset(_ANALYST | {
    USER_ACCOUNTS_READ,
    USER_ACCOUNT_MANAGE,
    SYSTEM_ADMIN,
})

ROLE_PERMISSIONS: Final[dict[WorkspaceRole, frozenset[str]]] = {
    "analyst": _ANALYST,
    "admin": _ADMIN,
}

ALL_PERMISSIONS: Final[frozenset[str]] = _ADMIN


def permissions_for_role(role: WorkspaceRole | str) -> frozenset[str]:
    """Return an immutable permission set and fail closed for unknown roles."""
    return ROLE_PERMISSIONS.get(role if role in ROLE_PERMISSIONS else "", frozenset())


def canonical_role(role: str) -> str:
    """Normalize role values."""
    if role in {"admin"}:
        return "admin"
    if role in {"owner", "viewer", "analyst"}:
        return "analyst"
    return role


def role_can_manage_target(actor_role: str, target_role: str) -> bool:
    """Check whether actor can manage target role."""
    actor = canonical_role(actor_role)
    target = canonical_role(target_role)
    if actor == "admin":
        return True
    return actor == "analyst" and target == "analyst"


__all__ = [
    'CALENDAR_READ',
    'CALENDAR_WRITE',
    "AGENT_RUN_READ",
    "AGENT_TRACE_DEBUG_READ",
    "AGENT_TRACE_READ",
    "ALL_PERMISSIONS",
    "ANALYSIS_RUN",
    "DATASET_DELETE",
    "DATASET_READ",
    "DATASET_UPLOAD",
    "DRIFT_RUN",
    "PROFILE_READ",
    "PROFILE_REVIEW",
    "PROFILE_RUN",
    "QA_PROFILE_ASK",
    "QA_PUBLISHED_ASK",
    "REPORT_ARCHIVE",
    "REPORT_DRAFT_WRITE",
    "REPORT_PUBLISH",
    "REPORT_PUBLISHED_EXPORT",
    "REPORT_PUBLISHED_READ",
    "REPORT_REVIEW",
    "REPORT_SUBMIT",
    "ROLE_PERMISSIONS",
    "STATS_RUN",
    "SYSTEM_ADMIN",
    "USER_ACCOUNT_MANAGE",
    "USER_ACCOUNTS_READ",
    "WORKSPACE_ACTIVITY_READ",
    "WORKSPACE_AUDIT_READ",
    "WORKSPACE_CREATE",
    "WORKSPACE_DELETE",
    "WORKSPACE_LIFECYCLE_MANAGE",
    "WORKSPACE_MEMBERS_MANAGE",
    "WORKSPACE_SETTINGS_MANAGE",
    "WORKSPACE_STORAGE_CONNECT",
    "WorkspaceRole",
    "canonical_role",
    "permissions_for_role",
    "role_can_manage_target",
]
