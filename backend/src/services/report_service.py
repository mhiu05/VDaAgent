"""Application service for report lifecycle mutations."""

from __future__ import annotations

from typing import Any, Protocol

from src.services.repository import Repository


class AuditSink(Protocol):
    def log(self, event: str, **fields: Any) -> None: ...


class ReportError(Exception):
    """Expected report lifecycle error for transport-layer translation."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class ReportService:
    def __init__(self, repo: Repository, audit: AuditSink) -> None:
        self.repo = repo
        self.audit = audit

    def create_report(
        self, payload: dict[str, Any], workspace_id: str, user_id: str
    ) -> dict[str, Any]:
        try:
            report = self.repo.create_report(workspace_id, user_id, payload)
        except LookupError as exc:
            raise ReportError(str(exc), 404) from exc
        except ValueError as exc:
            raise ReportError(str(exc), 422) from exc
        self._audit("report_created", report["id"], workspace_id, user_id)
        return report

    def update_report(
        self,
        report_id: str,
        payload: dict[str, Any],
        workspace_id: str,
        user_id: str,
    ) -> dict[str, Any]:
        try:
            report = self.repo.update_report_draft(
                report_id, workspace_id, user_id, payload
            )
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        except ValueError as exc:
            raise ReportError(str(exc), 409) from exc
        except LookupError as exc:
            raise ReportError(str(exc), 404) from exc
        if not report:
            raise ReportError("Không tìm thấy report.", 404)
        self._audit("report_updated", report_id, workspace_id, user_id)
        return report

    def publish_report(
        self,
        report_id: str,
        payload: dict[str, Any],
        workspace_id: str,
        user_id: str,
    ) -> dict[str, Any]:
        try:
            report = self.repo.publish_report(
                report_id,
                workspace_id,
                user_id,
                reason=payload.get("reason", ""),
            )
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        except ValueError as exc:
            raise ReportError(str(exc), 409) from exc
        if not report:
            raise ReportError("Không tìm thấy report.", 404)
        self._audit("report_published", report_id, workspace_id, user_id)
        return report

    def review_report(
        self,
        report_id: str,
        payload: dict[str, Any],
        workspace_id: str,
        user_id: str,
    ) -> dict[str, Any]:
        try:
            report = self.repo.review_report(
                report_id,
                workspace_id,
                user_id,
                payload.get("decision", ""),
                payload.get("comment", ""),
            )
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        except ValueError as exc:
            raise ReportError(str(exc), 409) from exc
        if not report:
            raise ReportError("Không tìm thấy report.", 404)
        self._audit(
            f"report_{payload.get('decision', 'unknown')}",
            report_id,
            workspace_id,
            user_id,
        )
        return report

    def submit_report(
        self, report_id: str, workspace_id: str, user_id: str
    ) -> dict[str, Any]:
        try:
            report = self.repo.publish_report(
                report_id,
                workspace_id,
                user_id,
                reason="Tự động xuất bản report do Analyst tạo.",
            )
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        except ValueError as exc:
            raise ReportError(str(exc), 409) from exc
        if not report:
            raise ReportError("Không tìm thấy report.", 404)
        self._audit("report_published", report_id, workspace_id, user_id)
        return report

    def archive_report(self, report_id: str, workspace_id: str, user_id: str) -> bool:
        if not self.repo.archive_report(report_id, workspace_id):
            raise ReportError("Không tìm thấy report.", 404)
        self._audit("report_archived", report_id, workspace_id, user_id)
        return True

    def delete_report(self, report_id: str, workspace_id: str, user_id: str) -> bool:
        try:
            deleted = self.repo.delete_report_draft(report_id, workspace_id, user_id)
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        except ValueError as exc:
            raise ReportError(str(exc), 409) from exc
        if not deleted:
            raise ReportError("Không tìm thấy report.", 404)
        self._audit("report_deleted", report_id, workspace_id, user_id)
        return True

    def _audit(
        self, event: str, report_id: str, workspace_id: str, user_id: str
    ) -> None:
        self.audit.log(
            event,
            workspace_id=workspace_id,
            actor_user_id=user_id,
            resource_type="report",
            resource_id=report_id,
        )
