"""Canonical report lifecycle states and transition guards.

The lifecycle is intentionally kept outside route handlers so API, background
work and repository callers use the same policy.  ``snapshot`` is an internal
immutable-draft capture; it is not a publishable state.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Final, Literal

ReportStatus = Literal[
    "draft",
    "in_review",
    "approved",
    "changes_requested",
    "rejected",
    "published",
    "archived",
]
ReportVersionStatus = Literal[
    "draft",
    "snapshot",
    "in_review",
    "approved",
    "changes_requested",
    "rejected",
    "published",
    "archived",
]


class ReportLifecycleError(ValueError):
    """A stable domain error for invalid or stale lifecycle requests."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        current_state: str | None = None,
        target_state: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.current_state = current_state
        self.target_state = target_state

    def as_detail(self) -> dict[str, str]:
        detail = {"code": self.code, "message": str(self)}
        if self.current_state is not None:
            detail["current_state"] = self.current_state
        if self.target_state is not None:
            detail["target_state"] = self.target_state
        return detail


# This is the one authoritative version state machine.  There is no shortcut
# from draft/in_review to published and a rejected version is terminal.
REPORT_VERSION_TRANSITIONS: Final[Mapping[str, frozenset[str]]] = {
    "draft": frozenset({"in_review", "snapshot"}),
    "snapshot": frozenset(),
    "in_review": frozenset({"approved", "changes_requested", "rejected"}),
    "approved": frozenset({"published"}),
    "changes_requested": frozenset({"draft"}),
    "rejected": frozenset(),
    "published": frozenset({"archived"}),
    "archived": frozenset(),
}

# A report container without an already-published snapshot mirrors the active
# version.  Once it has a published pointer it deliberately remains published
# while a newer draft moves through review, preserving the released snapshot.
REPORT_TRANSITIONS: Final[Mapping[str, frozenset[str]]] = {
    "draft": frozenset({"in_review"}),
    "in_review": frozenset({"approved", "changes_requested", "rejected"}),
    "approved": frozenset({"published"}),
    "changes_requested": frozenset({"draft"}),
    "rejected": frozenset(),
    "published": frozenset({"published", "archived"}),
    "archived": frozenset(),
}


def require_version_transition(current: str, target: str) -> None:
    if target not in REPORT_VERSION_TRANSITIONS.get(current, frozenset()):
        raise ReportLifecycleError(
            "invalid_report_version_transition",
            f"Cannot transition report version from {current!r} to {target!r}.",
            current_state=current,
            target_state=target,
        )


def require_report_transition(current: str, target: str) -> None:
    if target not in REPORT_TRANSITIONS.get(current, frozenset()):
        raise ReportLifecycleError(
            "invalid_report_transition",
            f"Cannot transition report from {current!r} to {target!r}.",
            current_state=current,
            target_state=target,
        )


def report_status_after_version_transition(
    current_report_status: str,
    next_version_status: str,
    *,
    has_published_snapshot: bool,
) -> str:
    """Derive and validate the aggregate report state for a version transition."""
    if has_published_snapshot and next_version_status != "archived":
        next_report_status = "published"
    else:
        next_report_status = next_version_status
    require_report_transition(current_report_status, next_report_status)
    return next_report_status


__all__ = [
    "REPORT_TRANSITIONS",
    "REPORT_VERSION_TRANSITIONS",
    "ReportLifecycleError",
    "ReportStatus",
    "ReportVersionStatus",
    "report_status_after_version_transition",
    "require_report_transition",
    "require_version_transition",
]
