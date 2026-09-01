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
    query_executions,
    report_items,
    report_versions,
    reports,
    workspace_context_versions,
    workspace_theme_versions,
)
from src.services.llm import report_text


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
    def _validated_chart_spec(
        spec: dict[str, Any] | None, execution: dict[str, Any]
    ) -> dict[str, Any]:
        query = dict(execution.get("query_spec") or {})
        dimensions = list(query.get("dimensions") or [])
        analysis_kind = str(query.get("analysis_kind") or "aggregate")
        if analysis_kind == "histogram":
            expected_x = query.get("column")
            expected_y = None
        elif analysis_kind == "scatter":
            expected_x = query.get("x_column")
            expected_y = query.get("y_column")
        elif analysis_kind == "box":
            expected_x = str(dimensions[0]) if dimensions else query.get("column")
            expected_y = query.get("column")
        elif analysis_kind == "heatmap":
            expected_x = str(dimensions[0]) if dimensions else None
            expected_y = str(dimensions[1]) if len(dimensions) > 1 else None
        elif analysis_kind == "forecast":
            expected_x = str(dimensions[0]) if dimensions else None
            expected_y = query.get("column")
        elif analysis_kind == "forecast_ranking":
            expected_x = str(dimensions[0]) if dimensions else None
            expected_y = query.get("column")
        elif analysis_kind in {"missing_bar", "cardinality", "outlier"}:
            expected_x = "column"
            expected_y = None
        elif analysis_kind in {"missing_heatmap", "correlation_heatmap"}:
            expected_x = "x"
            expected_y = "y"
        elif analysis_kind in {"violin", "donut"}:
            expected_x = str(dimensions[0]) if dimensions else None
            expected_y = query.get("column")
        else:
            expected_x = str(dimensions[0]) if dimensions else None
            expected_y = query.get("column")
        expected = {
            "analysis_kind": analysis_kind,
            "x_column": expected_x,
            "y_column": expected_y,
            "aggregation": query.get("aggregate"),
            "time_grain": query.get("time_grain"),
            "bins": query.get("bins")
            if analysis_kind in {"histogram", "scatter", "violin"}
            else None,
            "forecast_algorithm": query.get("forecast_algorithm")
            if analysis_kind in {"forecast", "forecast_ranking"}
            else None,
            "forecast_horizon": query.get("forecast_horizon")
            if analysis_kind in {"forecast", "forecast_ranking"}
            else None,
            "season_length": query.get("season_length")
            if analysis_kind in {"forecast", "forecast_ranking"}
            else None,
        }
        normalized = dict(spec or {})
        chart_type = str(
            normalized.get("chart_type") or ("bar" if dimensions else "kpi")
        )
        if chart_type not in {
            "kpi",
            "bar",
            "line",
            "table",
            "histogram",
            "scatter",
            "box",
            "heatmap",
            "missing_bar",
            "missing_heatmap",
            "correlation_heatmap",
            "cardinality",
            "violin",
            "donut",
            "outlier",
        }:
            raise ValueError("chart_type is not allowed.")
        compatible_renderers = {
            "line": {"native-svg"},
            "bar": {"native-css"},
            "table": {"native-html"},
            "kpi": {"native-kpi"},
            "histogram": {"native-svg"},
            "scatter": {"native-svg"},
            "box": {"native-svg"},
            "heatmap": {"native-grid"},
            "missing_bar": {"native-css"},
            "missing_heatmap": {"native-grid"},
            "correlation_heatmap": {"native-grid"},
            "cardinality": {"native-css"},
            "violin": {"native-svg"},
            "donut": {"native-svg"},
            "outlier": {"native-css"},
        }
        renderer = str(normalized.get("renderer") or "")
        if renderer not in compatible_renderers[chart_type]:
            raise ValueError("ChartSpec renderer is not compatible with chart_type.")
        for key, value in expected.items():
            normalized[key] = value
        if chart_type in {"bar", "line"} and not normalized["x_column"]:
            normalized["x_column"] = expected_x or (dimensions[0] if dimensions else "total")
        if chart_type == "kpi" and normalized["x_column"]:
            normalized["x_column"] = None
        expected_chart_type = {
            "histogram": "histogram",
            "scatter": "scatter",
            "box": "box",
            "heatmap": "heatmap",
            "forecast": "line",
            "forecast_ranking": "bar",
            "missing_bar": "missing_bar",
            "missing_heatmap": "missing_heatmap",
            "correlation_heatmap": "correlation_heatmap",
            "cardinality": "cardinality",
            "violin": "violin",
            "donut": "donut",
            "outlier": "outlier",
        }.get(analysis_kind)
        if expected_chart_type and chart_type != expected_chart_type and analysis_kind != "aggregate":
            chart_type = expected_chart_type
        normalized["chart_type"] = chart_type
        normalized["renderer"] = renderer or compatible_renderers.get(chart_type, {"native-css"}).copy().pop()
        return normalized

    @staticmethod
    def _validated_chart_insight(content: Any) -> dict[str, Any]:
        if content is None:
            return {}
        if not isinstance(content, dict):
            raise TypeError("Chart insight content must be an object.")
        unsupported = set(content) - {"insight", "insight_reviewed"}
        if unsupported:
            raise ValueError("Chart insight contains unsupported fields.")
        if content.get("insight_reviewed") is not True:
            raise ValueError("Chart insight must be reviewed before it is pinned.")
        insight = content.get("insight")
        if not isinstance(insight, str) or not insight.strip():
            return {}
        insight = insight.strip()
        if len(insight) > 50_000:
            insight = insight[:50_000]
        return {"insight": insight, "insight_reviewed": True}

    @staticmethod
    def _validated_agent(
        conn: Any,
        *,
        agent_run_id: str | None,
        workspace_id: str,
        profile_run_id: str,
        required_execution_id: str | None = None,
    ) -> dict[str, Any]:
        if not agent_run_id:
            return {}
        agent = (
            conn.execute(
                select(agent_runs).where(
                    agent_runs.c.id == agent_run_id,
                    agent_runs.c.workspace_id == workspace_id,
                )
            )
            .mappings()
            .first()
        )
        if not agent:
            return {}
        bindings = dict(agent["resource_bindings"] or {})
        if bindings.get("profile_run_id") and bindings.get("profile_run_id") != profile_run_id:
            raise ValueError(
                "Agent insight belongs to a different profile run."
            )
        return dict(agent)

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
        # Older pins may contain the provider's serialized content-block list.
        # Normalize it on read so existing drafts render cleanly without a DB
        # migration; new pins are normalized at the QA API boundary.
        for item in items:
            content = item.get("content_json")
            if isinstance(content, dict):
                normalized = dict(content)
                changed = False
                for key in ("insight", "answer"):
                    value = normalized.get(key)
                    if isinstance(value, str):
                        clean = report_text(value)
                        if clean != value:
                            normalized[key] = clean
                            changed = True
                if changed:
                    item["content_json"] = normalized
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
            "snapshot_hash": version.get("snapshot_hash")
            or (latest_snapshot or {}).get("snapshot_hash"),
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

    @staticmethod
    def _advance_draft_version(conn: Any, version: dict[str, Any]) -> None:
        """Advance a mutable draft revision after a non-reorder write.

        The database expression keeps simultaneous independent pin requests
        monotonic. Reorder uses an expected revision as a compare-and-swap.
        """
        conn.execute(
            report_versions.update()
            .where(report_versions.c.id == version["id"])
            .values(version=report_versions.c.version + 1)
        )
        version["version"] = int(
            conn.execute(
                select(report_versions.c.version).where(
                    report_versions.c.id == version["id"]
                )
            ).scalar_one()
        )

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
                chart_spec = self._validated_chart_spec(
                    payload.get("chart_spec"), execution
                )
                insight_content = {}
                if payload.get("content") is not None or payload.get("agent_run_id"):
                    insight_content = self._validated_chart_insight(
                        payload.get("content")
                    )
                    self._validated_agent(
                        conn,
                        agent_run_id=payload.get("agent_run_id"),
                        workspace_id=workspace_id,
                        profile_run_id=report["profile_run_id"],
                        required_execution_id=execution["id"],
                    )
            else:
                chart_spec = None
                insight_content = {}
            if item_type == "agent_answer":
                self._validated_agent(
                    conn,
                    agent_run_id=payload.get("agent_run_id"),
                    workspace_id=workspace_id,
                    profile_run_id=report["profile_run_id"],
                )
            if item_type not in {"chart", "note", "agent_answer"}:
                raise ValueError(
                    "This Command Center release supports chart, agent answer and note pins only."
                )

            # Check if this exact execution is already pinned in the current draft version
            existing_by_exec = None
            if item_type == "chart" and payload.get("query_execution_id"):
                existing_by_exec = (
                    conn.execute(
                        select(report_items).where(
                            report_items.c.report_version_id == version["id"],
                            report_items.c.query_execution_id == payload.get("query_execution_id"),
                        )
                    )
                    .mappings()
                    .first()
                )

            if existing or existing_by_exec:
                target_item = existing or existing_by_exec
                content_update = {
                    **(target_item.get("content_json") or {}),
                    **(
                        {
                            "result": execution["result"],
                            "chart_spec": chart_spec,
                            **insight_content,
                        }
                        if execution
                        else (payload.get("content") or {})
                    ),
                }
                conn.execute(
                    report_items.update()
                    .where(report_items.c.id == target_item["id"])
                    .values(
                        title=payload.get("title") or target_item.get("title"),
                        content_json=content_update,
                        agent_run_id=payload.get("agent_run_id") or target_item.get("agent_run_id"),
                    )
                )
                return self._payload(conn, report, version)
            self._advance_draft_version(conn, version)
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
                if item_type in {"chart", "agent_answer"}
                else None,
                "title": payload.get("title"),
                "note": payload.get("note"),
                "content_json": {
                    "result": execution["result"],
                    "chart_spec": chart_spec,
                    **insight_content,
                }
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
            next_version = int(version["version"]) + 1
            version_update = conn.execute(
                report_versions.update()
                .where(
                    report_versions.c.id == version["id"],
                    report_versions.c.version == expected_version,
                )
                .values(version=next_version)
            )
            if version_update.rowcount != 1:
                raise IdempotencyConflictError(
                    "draft_stale: reload the report before reordering"
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
            version["version"] = next_version
            return self._payload(conn, report, version)

    def update_title(
        self, report_id: str, workspace_id: str, actor: str, title: str
    ) -> dict[str, Any]:
        with self.engine.begin() as conn:
            report, version = self._current(conn, report_id, workspace_id, actor)
            self._advance_draft_version(conn, version)
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(title=title, updated_at=_now())
            )
            report["title"] = title
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
                self._advance_draft_version(conn, version)
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
            self._advance_draft_version(conn, version)
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

    def get_draft(
        self, report_id: str, workspace_id: str
    ) -> dict[str, Any] | None:
        """Return the current mutable draft for report export without creating one.

        Exporting a report before its first snapshot is supported by rendering
        the report's current draft. This lookup deliberately does not filter
        by author: route-level authorization already scopes report export, and
        repository access remains constrained to the workspace and report.
        """
        with self.engine.connect() as conn:
            report = (
                conn.execute(
                    select(reports).where(
                        reports.c.id == report_id,
                        reports.c.workspace_id == workspace_id,
                        reports.c.status == "draft",
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
                        report_versions.c.status == "draft",
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
                "version": version["version"],
                "updated_at": report.get("updated_at"),
                "items": items,
            }


def get_report_draft_repository() -> ReportDraftRepository:
    from src.services.repository import get_repository

    return ReportDraftRepository(get_repository())
