"""Central workspace roles and permissions.

The API deliberately authorizes capabilities rather than sprinkling role
comparisons throughout routes.  A new sensitive action must be added here and
covered by a test before it can be exposed by an endpoint.
"""

from __future__ import annotations

from typing import Final, Literal

WorkspaceRole = Literal["admin", "analyst", "viewer"]

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
NOTEBOOK_READ: Final = "notebook.read"
NOTEBOOK_WRITE: Final = "notebook.write"
NOTEBOOK_SHARE: Final = "notebook.share"
REPORT_DRAFT_WRITE: Final = "report.draft.write"
REPORT_SUBMIT: Final = "report.submit"
REPORT_REVIEW: Final = "report.review"
REPORT_PUBLISH: Final = "report.publish"
GLOBAL_REPORTS_READ: Final = "global.reports.read"
GLOBAL_REPORTS_REVIEW: Final = "global.reports.review"
GLOBAL_REPORTS_PUBLISH: Final = "global.reports.publish"
REPORT_ARCHIVE: Final = "report.archive"
WORKSPACE_ACTIVITY_READ: Final = "workspace.activity.read"
WORKSPACE_AUDIT_READ: Final = "workspace.audit.read"
WORKSPACE_MEMBERS_MANAGE: Final = "workspace.members.manage"
WORKSPACE_SETTINGS_MANAGE: Final = "workspace.settings.manage"
WORKSPACE_STORAGE_CONNECT: Final = "workspace.storage.connect"
WORKSPACE_LIFECYCLE_MANAGE: Final = "workspace.lifecycle.manage"
WORKSPACE_CREATE: Final = "workspace.create"
WORKSPACE_DELETE: Final = "workspace.delete"
ACCOUNT_DIRECTORY_READ: Final = "account.directory.read"
AGENT_RUN_READ: Final = "agent.run.read"
AGENT_TRACE_READ: Final = "agent.trace.read"
AGENT_TRACE_DEBUG_READ: Final = "agent.trace.debug.read"

# Viewer is deliberately a report-consumer role.  Shared notebooks remain an
# analyst/admin collaboration surface; exposing them to Viewer would conflict
# with the "published reports only" boundary shown throughout the product.
_VIEWER = frozenset({REPORT_PUBLISHED_READ, REPORT_PUBLISHED_EXPORT})
_ANALYST = _VIEWER | {
    DATASET_READ,
    DATASET_UPLOAD,
    PROFILE_READ,
    PROFILE_RUN,
    PROFILE_REVIEW,
    STATS_RUN,
    DRIFT_RUN,
    QA_PROFILE_ASK,
    ANALYSIS_RUN,
    NOTEBOOK_WRITE,
    NOTEBOOK_SHARE,
    REPORT_DRAFT_WRITE,
    REPORT_SUBMIT,
    WORKSPACE_CREATE,
    WORKSPACE_DELETE,
    WORKSPACE_STORAGE_CONNECT,
    AGENT_RUN_READ,
    AGENT_TRACE_READ,
}
# Admin is a governance role, not a project-workspace creator. Analysts own
# the working surface where a new project workspace is needed.
_ADMIN_BASE = (_ANALYST - {WORKSPACE_CREATE}) | {
    DATASET_DELETE,
    REPORT_REVIEW,
    REPORT_PUBLISH,
    REPORT_ARCHIVE,
    WORKSPACE_ACTIVITY_READ,
    WORKSPACE_AUDIT_READ,
    WORKSPACE_MEMBERS_MANAGE,
    ACCOUNT_DIRECTORY_READ,
}
_ADMIN = _ADMIN_BASE | {
    WORKSPACE_SETTINGS_MANAGE,
    WORKSPACE_LIFECYCLE_MANAGE,
    AGENT_TRACE_DEBUG_READ,
}

ROLE_PERMISSIONS: Final[dict[WorkspaceRole, frozenset[str]]] = {
    "viewer": _VIEWER,
    "analyst": frozenset(_ANALYST),
    "admin": frozenset(_ADMIN),
}

ALL_PERMISSIONS: Final[frozenset[str]] = frozenset().union(*ROLE_PERMISSIONS.values())
GLOBAL_ROLE_PERMISSIONS: Final[dict[str, frozenset[str]]] = {
    "global_admin": frozenset({GLOBAL_REPORTS_READ, GLOBAL_REPORTS_REVIEW, GLOBAL_REPORTS_PUBLISH, REPORT_PUBLISHED_READ, REPORT_PUBLISHED_EXPORT, REPORT_REVIEW, REPORT_PUBLISH}),
    "super_admin": frozenset({GLOBAL_REPORTS_READ, GLOBAL_REPORTS_REVIEW, GLOBAL_REPORTS_PUBLISH, REPORT_PUBLISHED_READ, REPORT_PUBLISHED_EXPORT, REPORT_REVIEW, REPORT_PUBLISH}),
}


def permissions_for_role(role: WorkspaceRole | str) -> frozenset[str]:
    """Return an immutable permission set and fail closed for unknown roles."""
    return ROLE_PERMISSIONS.get(canonical_role(role), frozenset())


def permissions_for_global_role(role: str | None) -> frozenset[str]:
    return GLOBAL_ROLE_PERMISSIONS.get(role or "", frozenset())


def canonical_role(role: str) -> str:
    """Map the legacy owner value to the unified admin role."""
    return "admin" if role == "owner" else role


def role_can_manage_target(actor_role: str, target_role: str) -> bool:
    """Apply the membership-management boundary from the security policy."""
    actor_role = canonical_role(actor_role)
    target_role = canonical_role(target_role)
    if actor_role == "admin":
        return target_role in {"viewer", "analyst", "admin"}
    return False


__all__ = [
    "ACCOUNT_DIRECTORY_READ",
    "AGENT_RUN_READ",
    "AGENT_TRACE_DEBUG_READ",
    "AGENT_TRACE_READ",
    "ALL_PERMISSIONS",
    "GLOBAL_REPORTS_PUBLISH",
    "GLOBAL_REPORTS_READ",
    "GLOBAL_REPORTS_REVIEW",
    "GLOBAL_ROLE_PERMISSIONS",
    "ANALYSIS_RUN",
    "DATASET_DELETE",
    "DATASET_READ",
    "DATASET_UPLOAD",
    "DRIFT_RUN",
    "NOTEBOOK_READ",
    "NOTEBOOK_SHARE",
    "NOTEBOOK_WRITE",
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
    "permissions_for_global_role",
    "role_can_manage_target",
]
