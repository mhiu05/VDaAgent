"""Application service for report lifecycle mutations."""

from __future__ import annotations

from typing import Any, Protocol

from src.services.repository import Repository
from src.services.report_lifecycle import ReportLifecycleError


class AuditSink(Protocol):
    def log(self, event: str, **fields: Any) -> None: ...


class ReportError(Exception):
    """Expected report lifecycle error for transport-layer translation."""

    def __init__(
        self, message: str, status_code: int = 400, *, code: str | None = None
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code

    def detail(self) -> str | dict[str, str]:
        return {"code": self.code, "message": self.message} if self.code else self.message
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
            mutation = self.repo.publish_report(
                report_id,
                workspace_id,
                user_id,
                reason=payload.get("reason", ""),
            )
        except ReportLifecycleError as exc:
            raise ReportError(str(exc), 409, code=exc.code) from exc
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        if not mutation:
            raise ReportError("Report was not found.", 404)
        self._audit(
            "report_published",
            report_id,
            workspace_id,
            user_id,
            report_version_id=mutation.report_version_id,
            previous_status=mutation.previous_status,
            next_status=mutation.next_status,
        )
        return mutation.report
    def review_report(
        self,
        report_id: str,
        payload: dict[str, Any],
        workspace_id: str,
        user_id: str,
    ) -> dict[str, Any]:
        try:
            mutation = self.repo.review_report(
                report_id,
                workspace_id,
                user_id,
                payload.get("decision", ""),
                payload.get("comment", ""),
            )
        except ReportLifecycleError as exc:
            raise ReportError(str(exc), 409, code=exc.code) from exc
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        if not mutation:
            raise ReportError("Report was not found.", 404)
        self._audit(
            f"report_{mutation.next_status}",
            report_id,
            workspace_id,
            user_id,
            report_version_id=mutation.report_version_id,
            previous_status=mutation.previous_status,
            next_status=mutation.next_status,
        )
        return mutation.report
    def submit_report(
        self, report_id: str, workspace_id: str, user_id: str
    ) -> dict[str, Any]:
        try:
            mutation = self.repo.submit_report(report_id, workspace_id, user_id)
        except ReportLifecycleError as exc:
            raise ReportError(str(exc), 409, code=exc.code) from exc
        except PermissionError as exc:
            raise ReportError(str(exc), 403) from exc
        if not mutation:
            raise ReportError("Report was not found.", 404)
        self._audit(
            "report_submitted",
            report_id,
            workspace_id,
            user_id,
            report_version_id=mutation.report_version_id,
            previous_status=mutation.previous_status,
            next_status=mutation.next_status,
        )
        return mutation.report
    def archive_report(self, report_id: str, workspace_id: str, user_id: str) -> bool:
        try:
            mutation = self.repo.archive_report(report_id, workspace_id)
        except ReportLifecycleError as exc:
            raise ReportError(str(exc), 409, code=exc.code) from exc
        if not mutation:
            raise ReportError("Report was not found.", 404)
        self._audit(
            "report_archived",
            report_id,
            workspace_id,
            user_id,
            report_version_id=mutation.report_version_id,
            previous_status=mutation.previous_status,
            next_status=mutation.next_status,
        )
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
        self,
        event: str,
        report_id: str,
        workspace_id: str,
        user_id: str,
        **fields: Any,
    ) -> None:
        self.audit.log(
            event,
            workspace_id=workspace_id,
            actor_user_id=user_id,
            resource_type="report",
            resource_id=report_id,
            **fields,
        )
