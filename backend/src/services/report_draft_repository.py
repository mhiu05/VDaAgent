"""Profile-scoped Report Draft persistence for Command Center pins."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from src.services.repository import (
    Repository,
    agent_runs,
    analysis_sessions,
    analysis_sources,
    evidence_items,
    query_executions,
    report_items,
    report_versions,
    reports,
    workspace_context_versions,
    workspace_theme_versions,
)


def _id() -> str:
    return uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class IdempotencyConflictError(ValueError):
    pass


class ReportDraftRepository:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository
        self.engine = repository.engine

    @staticmethod
    def _configuration(
        conn: Any, workspace_id: str
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        context = (
            conn.execute(
                select(workspace_context_versions)
                .where(
                    workspace_context_versions.c.workspace_id == workspace_id,
                    workspace_context_versions.c.status == "active",
                )
                .order_by(workspace_context_versions.c.version.desc())
            )
            .mappings()
            .first()
        )
        theme = (
            conn.execute(
                select(workspace_theme_versions)
                .where(
                    workspace_theme_versions.c.workspace_id == workspace_id,
                    workspace_theme_versions.c.status == "active",
                )
                .order_by(workspace_theme_versions.c.version.desc())
            )
            .mappings()
            .first()
        )
        return (dict(context) if context else None, dict(theme) if theme else None)

    def _draft_row(
        self, conn: Any, workspace_id: str, profile_run_id: str, actor: str
    ) -> tuple[dict[str, Any], dict[str, Any]] | None:
        report = (
            conn.execute(
                select(reports)
                .where(
                    reports.c.workspace_id == workspace_id,
                    reports.c.profile_run_id == profile_run_id,
                    reports.c.created_by_user_id == actor,
                    reports.c.status == "draft",
                )
                .order_by(reports.c.updated_at.desc())
            )
            .mappings()
            .first()
        )
        if not report:
            return None
        version = (
            conn.execute(
                select(report_versions)
                .where(
                    report_versions.c.report_id == report["id"],
                    report_versions.c.status == "draft",
                )
                .order_by(report_versions.c.version.desc())
            )
            .mappings()
            .first()
        )
        return (dict(report), dict(version)) if version else None

    def _payload(
        self, conn: Any, report: dict[str, Any], version: dict[str, Any]
    ) -> dict[str, Any]:
        items = [
            dict(row)
            for row in conn.execute(
                select(report_items)
                .where(report_items.c.report_version_id == version["id"])
                .order_by(report_items.c.position)
            ).mappings()
        ]
        active_context, active_theme = self._configuration(conn, report["workspace_id"])
        latest_snapshot = (
            conn.execute(
                select(report_versions.c.snapshot_hash, report_versions.c.version)
                .where(
                    report_versions.c.report_id == report["id"],
                    report_versions.c.status == "snapshot",
                )
                .order_by(report_versions.c.version.desc())
            )
            .mappings()
            .first()
        )
        stale: list[str] = []
        if (
            version.get("workspace_context_version_id")
            and active_context
            and version["workspace_context_version_id"] != active_context["id"]
        ):
            stale.append("context_superseded")
        if (
            version.get("workspace_theme_version_id")
            and active_theme
            and version["workspace_theme_version_id"] != active_theme["id"]
        ):
            stale.append("theme_superseded")
        for item in items:
            if item.get("query_execution_id"):
                execution = conn.execute(
                    select(query_executions.c.status).where(
                        query_executions.c.id == item["query_execution_id"]
                    )
                ).first()
                if not execution or execution[0] != "ready":
                    stale.append("execution_unavailable")
        return {
            "id": report["id"],
            "title": report["title"],
            "profile_run_id": report["profile_run_id"],
            "status": "stale" if stale else ("draft" if items else "empty"),
            "draft_version": version["version"],
            "version_id": version["id"],
            "items": items,
            "stale_reasons": sorted(set(stale)),
            "snapshot_hash": version.get("snapshot_hash") or (latest_snapshot or {}).get("snapshot_hash"),
            "snapshot_version": (latest_snapshot or {}).get("version"),
        }

    def get_or_create(
        self, workspace_id: str, profile_run_id: str, actor: str
    ) -> dict[str, Any]:
        run = self.repository.get_profile_run(profile_run_id, workspace_id=workspace_id)
        if not run:
            raise LookupError("Profile run was not found.")
        with self.engine.begin() as conn:
            existing = self._draft_row(conn, workspace_id, profile_run_id, actor)
            if existing:
                return self._payload(conn, *existing)
            context, theme = self._configuration(conn, workspace_id)
            report_id, version_id, now = _id(), _id(), _now()
            title = f"Report: {run.get('run_name') or profile_run_id}"
            conn.execute(
                reports.insert().values(
                    id=report_id,
                    workspace_id=workspace_id,
                    profile_run_id=profile_run_id,
                    title=title,
                    slug=report_id,
                    status="draft",
                    created_by_user_id=actor,
                    created_at=now,
                    updated_at=now,
                )
            )
            version = {
                "id": version_id,
                "report_id": report_id,
                "version": 1,
                "status": "draft",
                "scope": {"profile_run_id": profile_run_id},
                "workspace_context_version_id": context["id"] if context else None,
                "workspace_theme_version_id": theme["id"] if theme else None,
                "created_by_user_id": actor,
                "created_at": now,
            }
            conn.execute(report_versions.insert().values(**version))
            return self._payload(
                conn,
                {
                    "id": report_id,
                    "workspace_id": workspace_id,
                    "profile_run_id": profile_run_id,
                    "title": title,
                },
                version,
            )

    def _current(
        self, conn: Any, report_id: str, workspace_id: str, actor: str
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        report = (
            conn.execute(
                select(reports).where(
                    reports.c.id == report_id,
                    reports.c.workspace_id == workspace_id,
                    reports.c.created_by_user_id == actor,
                )
            )
            .mappings()
            .first()
        )
        if not report:
            raise LookupError("Report draft was not found.")
        version = (
            conn.execute(
                select(report_versions)
                .where(
                    report_versions.c.report_id == report_id,
                    report_versions.c.status == "draft",
                )
                .order_by(report_versions.c.version.desc())
            )
            .mappings()
            .first()
        )
        if not version:
            raise ValueError("Report has no editable draft version.")
        return dict(report), dict(version)

    def pin_item(
        self,
        report_id: str,
        workspace_id: str,
        actor: str,
        payload: dict[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        with self.engine.begin() as conn:
            report, version = self._current(conn, report_id, workspace_id, actor)
            existing = (
                conn.execute(
                    select(report_items).where(
                        report_items.c.report_version_id == version["id"],
                        report_items.c.idempotency_key == idempotency_key,
                    )
                )
                .mappings()
                .first()
            )
            if existing:
                if existing["item_type"] != payload["item_type"] or existing[
                    "query_execution_id"
                ] != payload.get("query_execution_id"):
                    raise IdempotencyConflictError(
                        "idempotency_conflict: key has a different payload"
                    )
                return self._payload(conn, report, version)
            item_type = payload["item_type"]
            execution: dict[str, Any] | None = None
            if item_type == "chart":
                execution_row = (
                    conn.execute(
                        select(query_executions, analysis_sources.c.profile_run_id)
                        .join(
                            analysis_sessions,
                            analysis_sessions.c.id == query_executions.c.session_id,
                        )
                        .join(
                            analysis_sources,
                            analysis_sources.c.session_id == analysis_sessions.c.id,
                        )
                        .where(
                            query_executions.c.id == payload.get("query_execution_id"),
                            analysis_sessions.c.workspace_id == workspace_id,
                        )
                    )
                    .mappings()
                    .first()
                )
                execution = dict(execution_row) if execution_row else None
                if (
                    not execution
                    or execution["profile_run_id"] != report["profile_run_id"]
                    or execution["execution_kind"] != "official"
                    or execution["status"] != "ready"
                ):
                    raise ValueError(
                        "Only an official execution for this profile can be pinned."
                    )
            if item_type == "agent_answer":
                agent = (
                    conn.execute(
                        select(agent_runs).where(
                            agent_runs.c.id == payload.get("agent_run_id"),
                            agent_runs.c.workspace_id == workspace_id,
                            agent_runs.c.status == "completed",
                        )
                    )
                    .mappings()
                    .first()
                )
                bindings = dict(agent["resource_bindings"] or {}) if agent else {}
                evidence_exists = bool(
                    agent
                    and conn.execute(
                        select(evidence_items.c.id)
                        .where(
                            evidence_items.c.agent_run_id == agent["id"],
                            evidence_items.c.workspace_id == workspace_id,
                            evidence_items.c.profile_run_id == report["profile_run_id"],
                        )
                        .limit(1)
                    ).first()
                )
                if (
                    not agent
                    or bindings.get("profile_run_id") != report["profile_run_id"]
                    or not evidence_exists
                ):
                    raise ValueError(
                        "Agent answer requires a completed profile-bound evidence trace."
                    )
            if item_type not in {"chart", "note", "agent_answer"}:
                raise ValueError(
                    "This Command Center release supports chart and note pins only."
                )
            position = (
                int(
                    conn.execute(
                        select(
                            func.coalesce(func.max(report_items.c.position), -1)
                        ).where(report_items.c.report_version_id == version["id"])
                    ).scalar()
                    or -1
                )
                + 1
            )
            item = {
                "id": _id(),
                "report_version_id": version["id"],
                "item_type": item_type,
                "position": position,
                "profile_run_id": report["profile_run_id"],
                "context_version_id": execution.get("context_version_id")
                if execution
                else None,
                "query_execution_id": execution.get("id") if execution else None,
                "agent_run_id": payload.get("agent_run_id")
                if item_type == "agent_answer"
                else None,
                "title": payload.get("title"),
                "note": payload.get("note"),
                "content_json": {"result": execution["result"]}
                if execution
                else payload.get("content"),
                "query_spec": execution.get("query_spec") if execution else None,
                "result_hash": execution.get("result_hash") if execution else None,
                "quality_status": "passed" if execution else None,
                "limitations": execution.get("limitations") if execution else [],
                "export_policy": {"mask_pii": True},
                "idempotency_key": idempotency_key,
                "created_by_user_id": actor,
                "created_at": _now(),
                "updated_at": _now(),
            }
            conn.execute(report_items.insert().values(**item))
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(updated_at=_now())
            )
            return self._payload(conn, report, version)

    def reorder(
        self,
        report_id: str,
        workspace_id: str,
        actor: str,
        item_ids: list[str],
        expected_version: int,
    ) -> dict[str, Any]:
        with self.engine.begin() as conn:
            report, version = self._current(conn, report_id, workspace_id, actor)
            if version["version"] != expected_version:
                raise IdempotencyConflictError(
                    "draft_stale: reload the report before reordering"
                )
            items = [
                dict(row)
                for row in conn.execute(
                    select(report_items).where(
                        report_items.c.report_version_id == version["id"]
                    )
                ).mappings()
            ]
            if {item["id"] for item in items} != set(item_ids) or len(item_ids) != len(
                items
            ):
                raise ValueError(
                    "Reorder must contain every current report item exactly once."
                )
            for position, item_id in enumerate(item_ids):
                conn.execute(
                    report_items.update()
                    .where(report_items.c.id == item_id)
                    .values(position=position, updated_at=_now())
                )
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(updated_at=_now())
            )
            return self._payload(conn, report, version)

    def update_item(
        self,
        report_id: str,
        item_id: str,
        workspace_id: str,
        actor: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        with self.engine.begin() as conn:
            report, version = self._current(conn, report_id, workspace_id, actor)
            item = conn.execute(
                select(report_items.c.id).where(
                    report_items.c.id == item_id,
                    report_items.c.report_version_id == version["id"],
                )
            ).first()
            if not item:
                raise LookupError("Report item was not found.")
            values = {key: value for key, value in payload.items() if value is not None}
            if values:
                conn.execute(
                    report_items.update()
                    .where(report_items.c.id == item_id)
                    .values(**values, updated_at=_now())
                )
            return self._payload(conn, report, version)

    def delete_item(
        self, report_id: str, item_id: str, workspace_id: str, actor: str
    ) -> dict[str, Any]:
        with self.engine.begin() as conn:
            report, version = self._current(conn, report_id, workspace_id, actor)
            item = conn.execute(
                select(report_items.c.position).where(
                    report_items.c.id == item_id,
                    report_items.c.report_version_id == version["id"],
                )
            ).first()
            if not item:
                raise LookupError("Report item was not found.")
            conn.execute(report_items.delete().where(report_items.c.id == item_id))
            conn.execute(
                report_items.update()
                .where(
                    report_items.c.report_version_id == version["id"],
                    report_items.c.position > item.position,
                )
                .values(position=report_items.c.position - 1, updated_at=_now())
            )
            return self._payload(conn, report, version)

    def snapshot(self, report_id: str, workspace_id: str, actor: str) -> dict[str, Any]:
        with self.engine.begin() as conn:
            report, version = self._current(conn, report_id, workspace_id, actor)
            payload = self._payload(conn, report, version)
            if payload["stale_reasons"]:
                raise ValueError(
                    "Report is stale and cannot be snapshotted without explicit "
                    "policy acknowledgement."
                )
            stable = json.dumps(
                {
                    "profile_run_id": report["profile_run_id"],
                    "items": payload["items"],
                    "context": version.get("workspace_context_version_id"),
                    "theme": version.get("workspace_theme_version_id"),
                },
                default=str,
                sort_keys=True,
                separators=(",", ":"),
            )
            digest = hashlib.sha256(stable.encode()).hexdigest()
            snapshot_at = _now()
            conn.execute(
                report_versions.update()
                .where(report_versions.c.id == version["id"])
                .values(
                    status="snapshot", snapshot_hash=digest, snapshot_at=snapshot_at
                )
            )
            next_version_id = _id()
            next_version = {
                "id": next_version_id,
                "report_id": report_id,
                "version": int(version["version"]) + 1,
                "status": "draft",
                "scope": version.get("scope") or {},
                "workspace_context_version_id": version.get(
                    "workspace_context_version_id"
                ),
                "workspace_theme_version_id": version.get("workspace_theme_version_id"),
                "created_by_user_id": actor,
                "created_at": snapshot_at,
            }
            conn.execute(report_versions.insert().values(**next_version))
            for item in payload["items"]:
                copied = {
                    key: value
                    for key, value in item.items()
                    if key
                    not in {
                        "id",
                        "report_version_id",
                        "idempotency_key",
                        "created_at",
                        "updated_at",
                    }
                }
                copied.update(
                    id=_id(),
                    report_version_id=next_version_id,
                    idempotency_key=None,
                    created_by_user_id=actor,
                    created_at=snapshot_at,
                    updated_at=snapshot_at,
                )
                conn.execute(report_items.insert().values(**copied))
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(status="draft", updated_at=snapshot_at)
            )
            return {
                **payload,
                "status": "snapshot",
                "snapshot_hash": digest,
                "snapshot_version": version["version"],
                "next_draft_version": next_version["version"],
            }


    def latest_snapshot(
        self, report_id: str, workspace_id: str
    ) -> dict[str, Any] | None:
        with self.engine.connect() as conn:
            report = (
                conn.execute(
                    select(reports).where(
                        reports.c.id == report_id,
                        reports.c.workspace_id == workspace_id,
                    )
                )
                .mappings()
                .first()
            )
            if not report:
                return None
            version = (
                conn.execute(
                    select(report_versions)
                    .where(
                        report_versions.c.report_id == report_id,
                        report_versions.c.status == "snapshot",
                    )
                    .order_by(report_versions.c.version.desc())
                )
                .mappings()
                .first()
            )
            if not version:
                return None
            items = [
                dict(row)
                for row in conn.execute(
                    select(report_items)
                    .where(report_items.c.report_version_id == version["id"])
                    .order_by(report_items.c.position)
                ).mappings()
            ]
            return {
                "id": report["id"],
                "title": report["title"],
                "profile_run_id": report["profile_run_id"],
                "snapshot_hash": version.get("snapshot_hash"),
                "snapshot_at": version.get("snapshot_at"),
                "version": version["version"],
                "items": items,
            }

def get_report_draft_repository() -> ReportDraftRepository:
    from src.services.repository import get_repository

    return ReportDraftRepository(get_repository())
