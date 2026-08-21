"""Persistence boundary for the evidence-first analysis workspace."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from src.services.repository import (
    Repository,
    analysis_sessions,
    analysis_sources,
    get_repository,
    quality_gate_runs,
    quality_issues,
    query_executions,
    semantic_context_versions,
)


def _id() -> str:
    return uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


class AnalysisRepository:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository
        self.engine = repository.engine

    def create_session(
        self,
        payload: dict[str, Any],
        *,
        profile_run_id: str,
        creator: str,
        workspace_id: str,
    ) -> dict[str, Any]:
        run = self.repository.get_profile_run(profile_run_id, workspace_id=workspace_id)
        if not run:
            raise LookupError("Không tìm thấy profile run.")
        if run["status"] != "completed":
            raise ValueError("Chỉ có thể bắt đầu analysis từ profile đã completed.")
        session_id = _id()
        now = _now()
        session = {
            "id": session_id,
            "mode": payload["mode"],
            "status": "needs_context",
            "goal": payload["goal"],
            "decision": payload.get("decision"),
            "audience": payload.get("audience"),
            "output": payload.get("output", "answer"),
            "time_scope": payload.get("time_scope"),
            "population": payload.get("population"),
            "baseline": payload.get("baseline"),
            "creator": creator,
            "workspace_id": workspace_id,
            "graph_thread_id": f"analysis:{session_id}",
            "version": 1,
            "created_at": now,
            "updated_at": now,
        }
        with self.engine.begin() as conn:
            conn.execute(analysis_sessions.insert().values(**session))
            conn.execute(
                analysis_sources.insert().values(
                    id=_id(),
                    session_id=session_id,
                    dataset_id=run["dataset_id"],
                    profile_run_id=profile_run_id,
                    alias="primary",
                    role="primary",
                )
            )
        return self.get_session(session_id, workspace_id=workspace_id) or session

    def get_session(
        self, session_id: str, *, workspace_id: str | None = None
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            statement = select(analysis_sessions).where(
                analysis_sessions.c.id == session_id
            )
            if workspace_id is not None:
                statement = statement.where(
                    analysis_sessions.c.workspace_id == workspace_id
                )
            session = conn.execute(statement).mappings().first()
            if not session:
                return None
            result = dict(session)
            source = (
                conn.execute(
                    select(analysis_sources).where(
                        analysis_sources.c.session_id == session_id
                    )
                )
                .mappings()
                .first()
            )
            if source:
                result["source"] = dict(source)
            context = (
                conn.execute(
                    select(semantic_context_versions)
                    .where(semantic_context_versions.c.session_id == session_id)
                    .order_by(semantic_context_versions.c.version.desc())
                )
                .mappings()
                .first()
            )
            if context:
                result["context"] = dict(context)
            gate = (
                conn.execute(
                    select(quality_gate_runs)
                    .where(quality_gate_runs.c.session_id == session_id)
                    .order_by(quality_gate_runs.c.created_at.desc())
                )
                .mappings()
                .first()
            )
            if gate:
                current_gate = dict(gate)
                current_gate["issues"] = [
                    dict(row)
                    for row in conn.execute(
                        select(quality_issues).where(
                            quality_issues.c.quality_gate_run_id == gate["id"]
                        )
                    ).mappings()
                ]
                result["quality_gate"] = current_gate
            return result

    def list_sessions(
        self, profile_run_id: str | None = None, *, workspace_id: str | None = None
    ) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            statement = select(analysis_sessions)
            if profile_run_id:
                statement = statement.join(
                    analysis_sources,
                    analysis_sources.c.session_id == analysis_sessions.c.id,
                ).where(analysis_sources.c.profile_run_id == profile_run_id)
            if workspace_id is not None:
                statement = statement.where(
                    analysis_sessions.c.workspace_id == workspace_id
                )
            sessions = conn.execute(
                statement.order_by(analysis_sessions.c.updated_at.desc())
            ).mappings()
            return [dict(row) for row in sessions]

    def add_context(self, session_id: str, context: dict[str, Any]) -> dict[str, Any]:
        with self.engine.begin() as conn:
            latest = (
                conn.execute(
                    select(
                        func.coalesce(func.max(semantic_context_versions.c.version), 0)
                    ).where(semantic_context_versions.c.session_id == session_id)
                ).scalar()
                or 0
            )
            item = {
                "id": _id(),
                "session_id": session_id,
                "version": latest + 1,
                "context": context,
                "status": "draft",
                "created_at": _now(),
            }
            conn.execute(semantic_context_versions.insert().values(**item))
            conn.execute(
                analysis_sessions.update()
                .where(analysis_sessions.c.id == session_id)
                .values(status="needs_context", updated_at=_now())
            )
            return item

    def approve_context(
        self, session_id: str, context_id: str, analyst: str
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            item = (
                conn.execute(
                    select(semantic_context_versions).where(
                        semantic_context_versions.c.id == context_id,
                        semantic_context_versions.c.session_id == session_id,
                    )
                )
                .mappings()
                .first()
            )
            if not item:
                return None
            conn.execute(
                semantic_context_versions.update()
                .where(semantic_context_versions.c.id == context_id)
                .values(status="approved", approved_by=analyst, approved_at=_now())
            )
            conn.execute(
                analysis_sessions.update()
                .where(analysis_sessions.c.id == session_id)
                .values(status="quality_review", updated_at=_now())
            )
            return {
                **dict(item),
                "status": "approved",
                "approved_by": analyst,
                "approved_at": _now(),
            }

    def save_gate(
        self,
        session_id: str,
        context_id: str,
        decision: str,
        issues: list[dict[str, Any]],
    ) -> dict[str, Any]:
        gate = {
            "id": _id(),
            "session_id": session_id,
            "context_version_id": context_id,
            "decision": decision,
            "created_at": _now(),
        }
        with self.engine.begin() as conn:
            conn.execute(quality_gate_runs.insert().values(**gate))
            if issues:
                conn.execute(
                    quality_issues.insert(),
                    [
                        {"id": _id(), "quality_gate_run_id": gate["id"], **issue}
                        for issue in issues
                    ],
                )
            status = (
                "quality_blocked"
                if decision == "blocked"
                else (
                    "plan_review"
                    if self.get_session(session_id)["mode"] == "deep"
                    else "running"
                )
            )
            conn.execute(
                analysis_sessions.update()
                .where(analysis_sessions.c.id == session_id)
                .values(status=status, updated_at=_now())
            )
        return {**gate, "issues": issues}

    def acknowledge_issue(self, session_id: str, issue_id: str, note: str) -> bool:
        with self.engine.begin() as conn:
            issue = conn.execute(
                select(quality_issues.c.id)
                .join(quality_gate_runs)
                .where(
                    quality_issues.c.id == issue_id,
                    quality_gate_runs.c.session_id == session_id,
                )
            ).first()
            if not issue:
                return False
            conn.execute(
                quality_issues.update()
                .where(quality_issues.c.id == issue_id)
                .values(status="acknowledged", resolution_note=note)
            )
            return True

    def save_execution(
        self,
        session_id: str,
        context_id: str,
        query_spec: dict[str, Any],
        result: dict[str, Any],
        result_hash: str,
        *,
        approximate: bool,
        limitations: list[str],
        duration_ms: int,
        execution_kind: str = "official",
        status: str = "ready",
        quality_gate_run_id: str | None = None,
        requested_by_user_id: str | None = None,
        expires_at: datetime | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        item = {
            "id": _id(),
            "session_id": session_id,
            "context_version_id": context_id,
            "query_spec": query_spec,
            "result": result,
            "result_hash": result_hash,
            "is_approximate": approximate,
            "limitations": limitations,
            "duration_ms": duration_ms,
            "execution_kind": execution_kind,
            "status": status,
            "quality_gate_run_id": quality_gate_run_id,
            "requested_by_user_id": requested_by_user_id,
            "expires_at": expires_at,
            "idempotency_key": idempotency_key,
            "created_at": _now(),
        }
        with self.engine.begin() as conn:
            conn.execute(query_executions.insert().values(**item))
            conn.execute(
                analysis_sessions.update()
                .where(analysis_sessions.c.id == session_id)
                .values(status="insight_review", updated_at=_now())
            )
        return item

    def find_execution_by_idempotency(
        self, session_id: str, idempotency_key: str | None
    ) -> dict[str, Any] | None:
        if not idempotency_key:
            return None
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(query_executions).where(
                        query_executions.c.session_id == session_id,
                        query_executions.c.idempotency_key == idempotency_key,
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def get_execution(
        self, execution_id: str, *, workspace_id: str | None = None
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            statement = (
                select(query_executions, analysis_sessions.c.workspace_id)
                .join(
                    analysis_sessions,
                    analysis_sessions.c.id == query_executions.c.session_id,
                )
                .where(query_executions.c.id == execution_id)
            )
            if workspace_id is not None:
                statement = statement.where(
                    analysis_sessions.c.workspace_id == workspace_id
                )
            row = conn.execute(statement).mappings().first()
            return dict(row) if row else None

    def executions(self, session_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            return [
                dict(row)
                for row in conn.execute(
                    select(query_executions)
                    .where(query_executions.c.session_id == session_id)
                    .order_by(query_executions.c.created_at.desc())
                ).mappings()
            ]


def get_analysis_repository() -> AnalysisRepository:
    return AnalysisRepository(get_repository())
