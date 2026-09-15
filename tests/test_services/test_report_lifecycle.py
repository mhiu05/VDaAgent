"""Regression coverage for the report publication state machine."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from src.services.report_lifecycle import ReportLifecycleError
from src.services.report_service import ReportService
from src.services.report_draft_repository import ReportDraftRepository
from src.services.repository import get_repository, report_versions


def _workspace() -> tuple[str, str]:
    repo = get_repository()
    owner_id = str(uuid4())
    workspace = repo.create_workspace(owner_id, f"Report lifecycle {uuid4().hex}")
    return workspace["id"], owner_id


def _report(workspace_id: str, author_id: str) -> dict:
    return get_repository().create_report(
        workspace_id,
        author_id,
        {"title": "Lifecycle report"},
    )


def _publish(workspace_id: str, author_id: str, reviewer_id: str) -> dict:
    repo = get_repository()
    created = _report(workspace_id, author_id)
    report_id = created["id"]
    repo.submit_report(report_id, workspace_id, author_id)
    repo.review_report(report_id, workspace_id, reviewer_id, "approved", None)
    return repo.publish_report(report_id, workspace_id, reviewer_id).report


def test_lifecycle_requires_approval_and_disallows_self_review() -> None:
    repo = get_repository()
    workspace_id, owner_id = _workspace()
    author_id = str(uuid4())
    report_id = _report(workspace_id, author_id)["id"]

    with pytest.raises(ReportLifecycleError) as publish_error:
        repo.publish_report(report_id, workspace_id, owner_id)
    assert publish_error.value.code == "invalid_report_version_transition"

    submitted = repo.submit_report(report_id, workspace_id, author_id)
    assert submitted and submitted.next_status == "in_review"
    assert submitted.report["status"] == "in_review"
    queue = repo.list_report_review_queue(workspace_id)
    assert [(item["id"], item["status"])] == [(report_id, "in_review")]

    with pytest.raises(PermissionError, match="submitter"):
        repo.review_report(report_id, workspace_id, author_id, "approved", None)

    approved = repo.review_report(
        report_id, workspace_id, owner_id, "approved", "Reviewed"
    )
    assert approved and approved.report["status"] == "approved"
    assert [(item["id"], item["status"])] == [(report_id, "approved")]
    published = repo.publish_report(report_id, workspace_id, owner_id)
    assert published and published.report["status"] == "published"
    assert repo.list_report_review_queue(workspace_id) == []
    assert published.report["current_published_version_id"] == published.report_version_id

    with pytest.raises(ReportLifecycleError) as repeat_publish:
        repo.publish_report(report_id, workspace_id, owner_id)
    assert repeat_publish.value.code == "invalid_report_version_transition"


def test_changes_requested_must_be_edited_before_resubmission() -> None:
    repo = get_repository()
    workspace_id, owner_id = _workspace()
    author_id = str(uuid4())
    report_id = _report(workspace_id, author_id)["id"]
    repo.submit_report(report_id, workspace_id, author_id)
    changed = repo.review_report(
        report_id, workspace_id, owner_id, "changes_requested", "Add evidence"
    )
    assert changed and changed.report["status"] == "changes_requested"

    with pytest.raises(ReportLifecycleError) as resubmit:
        repo.submit_report(report_id, workspace_id, author_id)
    assert resubmit.value.code == "invalid_report_version_transition"

    edited = ReportDraftRepository(repo).update_title(
        report_id, workspace_id, author_id, "Lifecycle report v2"
    )
    assert edited["status"] == "draft"
    assert repo.submit_report(report_id, workspace_id, author_id).report["status"] == "in_review"


def test_published_read_uses_pointer_when_a_newer_draft_exists() -> None:
    repo = get_repository()
    workspace_id, owner_id = _workspace()
    author_id = str(uuid4())
    published = _publish(workspace_id, author_id, owner_id)
    report_id = published["id"]
    published_version_id = published["current_published_version_id"]

    with repo.engine.begin() as conn:
        conn.execute(
            report_versions.insert().values(
                id=uuid4().hex,
                report_id=report_id,
                version=2,
                status="draft",
                created_by_user_id=author_id,
                created_at=datetime.now(UTC),
            )
        )

    visible = repo.get_report(report_id, workspace_id, published_only=True)
    assert visible is not None
    assert visible["status"] == "published"
    assert [version["id"] for version in visible["versions"]] == [published_version_id]
    assert visible["versions"][0]["status"] == "published"
    assert {item["id"] for item in repo.list_reports(workspace_id, published_only=True)} == {
        report_id
    }
    assert repo.dashboard_summary(workspace_id)["counts"]["reports"] == 1


def test_archived_report_is_no_longer_a_published_snapshot() -> None:
    repo = get_repository()
    workspace_id, owner_id = _workspace()
    published = _publish(workspace_id, str(uuid4()), owner_id)
    archived = repo.archive_report(published["id"], workspace_id)

    assert archived and archived.next_status == "archived"
    assert repo.get_report(published["id"], workspace_id, published_only=True) is None
    assert repo.list_reports(workspace_id, published_only=True) == []


class _Audit:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def log(self, event: str, **fields: object) -> None:
        self.events.append((event, dict(fields)))


def test_service_audit_contains_transition_facts_not_report_content() -> None:
    repo = get_repository()
    workspace_id, owner_id = _workspace()
