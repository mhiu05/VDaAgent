"""Metadata store — SQLAlchemy Core trên PostgreSQL, ADR-009.

Bảng khớp ER diagram trong `docs/architecture/agent_architecture.md`:
datasets, profile_runs, column_stats, candidate_key_proposals,
semantic_type_proposals, pii_proposals, statistical_test_results, drift_reports.

Dùng SQLAlchemy Core (không ORM) vì truy vấn ở đây đơn giản và QA structured
lookup cần SQL tường minh để trace được số liệu về đúng dòng dữ liệu.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    func,
    select,
)
from sqlalchemy.engine import Engine, make_url
from src.config import Settings, get_settings

metadata = MetaData()

ProposalKind = Literal["candidate_key", "semantic_type", "pii"]
ProposalStatus = Literal["pending", "confirmed", "rejected", "auto_confirmed"]


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


# Workspace identity is held beside the domain metadata. Browser clients have
# no grants to these tables; the API always applies a workspace predicate.
user_profiles = Table(
    "user_profiles",
    metadata,
    Column("user_id", String(36), primary_key=True),
    Column("display_name", String(255), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)

workspaces = Table(
    "workspaces",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("name", String(255), nullable=False),
    Column("slug", String(128), nullable=False, unique=True),
    Column("created_by_user_id", String(36), nullable=False),
    Column("status", String(16), nullable=False, default="active"),
    Column("settings", JSON, nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)

workspace_memberships = Table(
    "workspace_memberships",
    metadata,
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), primary_key=True),
    Column("user_id", String(36), primary_key=True),
    Column("role", String(16), nullable=False),
    Column("status", String(16), nullable=False, default="active", index=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)

workspace_invitations = Table(
    "workspace_invitations",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False, index=True),
    Column("normalized_email", String(320), nullable=False, index=True),
    Column("role", String(16), nullable=False),
    Column("token_hash", String(128), nullable=False, unique=True),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("invited_by_user_id", String(36), nullable=False),
    Column("accepted_by_user_id", String(36), nullable=True),
    Column("status", String(16), nullable=False, default="pending"),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

google_drive_connections = Table(
    "google_drive_connections",
    metadata,
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), primary_key=True),
    Column("folder_id", String(255), nullable=False),
    Column("encrypted_refresh_token", Text, nullable=False),
    Column("connected_by_user_id", String(36), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)

google_drive_oauth_states = Table(
    "google_drive_oauth_states",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False, index=True),
    Column("user_id", String(36), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("used_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

datasets = Table(
    "datasets",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("name", String(255), nullable=False),
    Column("source_type", String(32), nullable=False),  # csv | parquet | bigquery
    Column("source_ref", String(1024), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=True, index=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("last_profiled_at", DateTime(timezone=True), nullable=True),
)

profile_runs = Table(
    "profile_runs",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("dataset_id", String(32), ForeignKey("datasets.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=True, index=True),
    Column("version", Integer, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("scan_mode", String(16), nullable=False),
    Column("sampling_strategy", String(32), nullable=True),
    Column("sample_size", Integer, nullable=True),
    Column("random_seed", Integer, nullable=True),  # L5 — reproducibility
    Column("executed_query", String(4096), nullable=True),  # L5
    Column("row_count", Integer, nullable=True),
    # Tool V2 data-quality artifact.  These are aggregate-only so they never
    # reveal duplicate records to the agent.
    Column("duplicate_row_count", Integer, nullable=True),
    Column("duplicate_row_rate", Float, nullable=True),
    Column("status", String(16), nullable=False, default="draft"),
    Column("graph_thread_id", String(255), nullable=True, unique=True),
    Column("initial_question", String(2000), nullable=True),
    Column("question_type", String(32), nullable=True),
    Column("answer", Text, nullable=True),
    Column("answer_sources", JSON, nullable=True),
    Column("terminal_result", JSON, nullable=True),
    Column("last_resume_key", String(255), nullable=True),
    Column("last_resume_action", String(32), nullable=True),
    Column("last_resume_at", DateTime(timezone=True), nullable=True),
    Column("resume_count", Integer, nullable=False, default=0),
    Column("narrative_report", String, nullable=True),
    Column("risk_warnings", JSON, nullable=True),
    Column("correlation_matrix", JSON, nullable=True),
    Column("quasi_identifiers", JSON, nullable=True),
    Column("is_approximate", Boolean, nullable=False, default=False),
    Column("error", String(1024), nullable=True),
)

column_stats = Table(
    "column_stats",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("column_name", String(255), nullable=False),
    Column("dtype", String(64), nullable=True),
    Column("null_pct", Float, nullable=True),
    Column("null_count", Integer, nullable=True),
    Column("cardinality", Integer, nullable=True),
    Column("uniqueness_ratio", Float, nullable=True),
    Column("min_value", Float, nullable=True),
    Column("max_value", Float, nullable=True),
    Column("mean", Float, nullable=True),
    Column("median", Float, nullable=True),
    Column("std", Float, nullable=True),
    Column("q1", Float, nullable=True),
    Column("q3", Float, nullable=True),
    Column("outlier_count", Integer, nullable=True),
    Column("outlier_method", String(32), nullable=True),
    Column("min_length", Integer, nullable=True),
    Column("max_length", Integer, nullable=True),
    Column("top_k_values", JSON, nullable=True),
    Column("is_approximate", Boolean, nullable=False, default=False),  # ADR-006
    Column("margin_of_error", Float, nullable=True),  # ADR-006
)

# Ba loại proposal cùng một luồng HITL (ADR-003) nên dùng chung shape cột.
def _PROPOSAL_COLUMNS() -> list[Column]:
    """Cột dùng chung cho ba bảng proposal.

    Phải là hàm chứ không phải list dùng lại: mỗi `Column` chỉ gắn được vào một
    `Table`, nên mỗi bảng cần một bộ object mới.
    """
    return [
        Column("id", String(32), primary_key=True),
        Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
        Column("confidence_score", Float, nullable=False),
        Column("evidence", String(2048), nullable=True),
        Column("status", String(16), nullable=False, default="pending"),
        Column("confirmed_by", String(255), nullable=True),
        Column("confirmed_at", DateTime(timezone=True), nullable=True),
        Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    ]

candidate_key_proposals = Table(
    "candidate_key_proposals",
    metadata,
    *_PROPOSAL_COLUMNS(),
    Column("columns", JSON, nullable=False),  # single hoặc composite
)

semantic_type_proposals = Table(
    "semantic_type_proposals",
    metadata,
    *_PROPOSAL_COLUMNS(),
    Column("column_name", String(255), nullable=False),
    Column("proposed_type", String(32), nullable=False),
    Column("semantic_description", String(512), nullable=True),
    Column("final_type", String(32), nullable=True),  # Analyst sửa thì ghi vào đây
)

pii_proposals = Table(
    "pii_proposals",
    metadata,
    *_PROPOSAL_COLUMNS(),
    Column("column_name", String(255), nullable=False),
    Column("pii_type", String(64), nullable=True),
    Column("detection_method", String(32), nullable=False),  # heuristic|regex|NER|LLM|manual
)

statistical_test_results = Table(
    "statistical_test_results",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("test_type", String(64), nullable=False),
    Column("target_columns", JSON, nullable=False),
    Column("test_statistic", Float, nullable=True),
    Column("p_value", Float, nullable=True),
    Column("p_value_adjusted", Float, nullable=True),  # L1
    Column("significant_after_correction", Boolean, nullable=True),  # L1
    Column("conclusion", String(32), nullable=False),
    Column("interpretation", String(2048), nullable=True),
    Column("alpha", Float, nullable=True),
    Column("extra", JSON, nullable=True),
    Column("requested_by", String(255), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

drift_reports = Table(
    "drift_reports",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("profile_run_id_a", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("profile_run_id_b", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("drift_columns", JSON, nullable=False),
    Column("summary", String(2048), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

# Analysis workspace is intentionally additive: a completed profile run remains
# the immutable technical snapshot, while an analysis session captures the
# business work performed against that snapshot.
analysis_sessions = Table(
    "analysis_sessions", metadata,
    Column("id", String(32), primary_key=True),
    Column("mode", String(16), nullable=False),
    Column("status", String(32), nullable=False),
    Column("goal", Text, nullable=False),
    Column("decision", Text, nullable=True),
    Column("audience", String(255), nullable=True),
    Column("output", String(64), nullable=True),
    Column("time_scope", JSON, nullable=True),
    Column("population", JSON, nullable=True),
    Column("baseline", JSON, nullable=True),
    Column("creator", String(255), nullable=True),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=True, index=True),
    Column("graph_thread_id", String(255), nullable=False, unique=True),
    Column("version", Integer, nullable=False, default=1),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)
analysis_sources = Table(
    "analysis_sources", metadata,
    Column("id", String(32), primary_key=True),
    Column("session_id", String(32), ForeignKey("analysis_sessions.id"), nullable=False, index=True),
    Column("dataset_id", String(32), ForeignKey("datasets.id"), nullable=False),
    Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("alias", String(64), nullable=False, default="primary"),
    Column("role", String(32), nullable=False, default="primary"),
)
semantic_context_versions = Table(
    "semantic_context_versions", metadata,
    Column("id", String(32), primary_key=True),
    Column("session_id", String(32), ForeignKey("analysis_sessions.id"), nullable=False, index=True),
    Column("version", Integer, nullable=False),
    Column("context", JSON, nullable=False),
    Column("status", String(16), nullable=False, default="draft"),
    Column("approved_by", String(255), nullable=True),
    Column("approved_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
quality_gate_runs = Table(
    "quality_gate_runs", metadata,
    Column("id", String(32), primary_key=True),
    Column("session_id", String(32), ForeignKey("analysis_sessions.id"), nullable=False, index=True),
    Column("context_version_id", String(32), ForeignKey("semantic_context_versions.id"), nullable=True),
    Column("decision", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
quality_issues = Table(
    "quality_issues", metadata,
    Column("id", String(32), primary_key=True),
    Column("quality_gate_run_id", String(32), ForeignKey("quality_gate_runs.id"), nullable=False, index=True),
    Column("rule", String(64), nullable=False),
    Column("dimension", String(32), nullable=False),
    Column("severity", String(16), nullable=False),
    Column("message", Text, nullable=False),
    Column("evidence", JSON, nullable=True),
    Column("status", String(16), nullable=False, default="open"),
    Column("resolution_note", Text, nullable=True),
)
query_executions = Table(
    "query_executions", metadata,
    Column("id", String(32), primary_key=True),
    Column("session_id", String(32), ForeignKey("analysis_sessions.id"), nullable=False, index=True),
    Column("context_version_id", String(32), ForeignKey("semantic_context_versions.id"), nullable=False),
    Column("query_spec", JSON, nullable=False),
    Column("result", JSON, nullable=False),
    Column("result_hash", String(64), nullable=False),
    Column("is_approximate", Boolean, nullable=False, default=False),
    Column("limitations", JSON, nullable=True),
    Column("duration_ms", Integer, nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

retrieval_documents = Table(
    "retrieval_documents",
    metadata,
    Column("doc_id", String(255), primary_key=True),
    Column("text", Text, nullable=False),
    Column("document_metadata", JSON, nullable=True),
    # NULL is global external knowledge. Profile and published-report docs are
    # always tenant-scoped before candidate ranking.
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=True, index=True),
    Column("vector", JSON, nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)

audit_events = Table(
    "audit_events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("ts", DateTime(timezone=True), nullable=False, default=_now),
    Column("event", String(128), nullable=False, index=True),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=True, index=True),
    Column("actor_user_id", String(36), nullable=True, index=True),
    Column("resource_type", String(64), nullable=True),
    Column("resource_id", String(255), nullable=True),
    Column("outcome", String(32), nullable=True),
    Column("correlation_id", String(128), nullable=True),
    Column("fields", JSON, nullable=True),
)

# A published report is a stable viewer artifact.  It never points the viewer
# at mutable profiling pages or an arbitrary aggregate query.
reports = Table(
    "reports", metadata,
    Column("id", String(32), primary_key=True),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False, index=True),
    Column("title", String(255), nullable=False),
    Column("slug", String(160), nullable=False),
    Column("status", String(24), nullable=False, default="draft"),
    Column("created_by_user_id", String(36), nullable=False),
    Column("current_published_version_id", String(32), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)

report_versions = Table(
    "report_versions", metadata,
    Column("id", String(32), primary_key=True),
    Column("report_id", String(32), ForeignKey("reports.id"), nullable=False, index=True),
    Column("version", Integer, nullable=False),
    Column("status", String(24), nullable=False, default="draft"),
    Column("executive_summary", Text, nullable=True),
    Column("scope", JSON, nullable=True),
    Column("time_range", JSON, nullable=True),
    Column("submitted_by_user_id", String(36), nullable=True),
    Column("submitted_at", DateTime(timezone=True), nullable=True),
    Column("reviewed_by_user_id", String(36), nullable=True),
    Column("reviewed_at", DateTime(timezone=True), nullable=True),
    Column("published_by_user_id", String(36), nullable=True),
    Column("published_at", DateTime(timezone=True), nullable=True),
    Column("created_by_user_id", String(36), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

report_sections = Table(
    "report_sections", metadata,
    Column("id", String(32), primary_key=True),
    Column("report_version_id", String(32), ForeignKey("report_versions.id"), nullable=False, index=True),
    Column("position", Integer, nullable=False),
    Column("kind", String(32), nullable=False),
    Column("title", String(255), nullable=True),
    Column("content_json", JSON, nullable=False),
)

report_visualizations = Table(
    "report_visualizations", metadata,
    Column("id", String(32), primary_key=True),
    Column("report_version_id", String(32), ForeignKey("report_versions.id"), nullable=False, index=True),
    Column("position", Integer, nullable=False),
    Column("chart_type", String(16), nullable=False),
    Column("title", String(255), nullable=True),
    Column("visualization_spec", JSON, nullable=False),
    Column("query_execution_id", String(32), ForeignKey("query_executions.id"), nullable=False),
    Column("result_hash", String(64), nullable=False),
    Column("result_snapshot", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

report_reviews = Table(
    "report_reviews", metadata,
    Column("id", String(32), primary_key=True),
    Column("report_version_id", String(32), ForeignKey("report_versions.id"), nullable=False, index=True),
    Column("reviewer_user_id", String(36), nullable=False),
    Column("decision", String(24), nullable=False),
    Column("comment", Text, nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

PROPOSAL_TABLES: dict[str, Table] = {
    "candidate_key": candidate_key_proposals,
    "semantic_type": semantic_type_proposals,
    "pii": pii_proposals,
}


# --------------------------------------------------------------------------- #
class Repository:
    """Truy cập metadata DB. Mọi số trong báo cáo/QA đều đọc từ đây."""

    def __init__(self, engine: Engine, settings: Settings | None = None) -> None:
        self.engine = engine
        self.settings = settings or get_settings()
        # Production schema changes are a release-job responsibility (Alembic),
        # never an implicit side effect of serving the first request.  Existing
        # local/test workflows remain convenient and isolated.
        if self.settings.app_env != "production":
            metadata.create_all(engine)
            self._migrate_semantic_description()
            self._migrate_tool_v2_profile_columns()
            self._migrate_workflow_columns()
            self._migrate_authz_columns()

    def _migrate_semantic_description(self) -> None:
        """Bổ sung cột mô tả cho các metadata DB đã tồn tại từ phiên bản trước."""
        from sqlalchemy import inspect, text

        columns = {item["name"] for item in inspect(self.engine).get_columns("semantic_type_proposals")}
        if "semantic_description" not in columns:
            with self.engine.begin() as conn:
                conn.execute(text("ALTER TABLE semantic_type_proposals ADD COLUMN semantic_description VARCHAR(512)"))

    def _migrate_tool_v2_profile_columns(self) -> None:
        """Add aggregate Tool V2 artifacts to existing PostgreSQL databases."""
        from sqlalchemy import inspect, text

        columns = {item["name"] for item in inspect(self.engine).get_columns("profile_runs")}
        additions = {
            "duplicate_row_count": "INTEGER",
            "duplicate_row_rate": "FLOAT",
        }
        with self.engine.begin() as conn:
            for name, sql_type in additions.items():
                if name not in columns:
                    conn.execute(text(f"ALTER TABLE profile_runs ADD COLUMN {name} {sql_type}"))

    def _migrate_workflow_columns(self) -> None:
        """Add durable execution identity and terminal continuation fields."""
        from sqlalchemy import inspect, text

        columns = {item["name"] for item in inspect(self.engine).get_columns("profile_runs")}
        additions = {
            "graph_thread_id": "VARCHAR(255)",
            "initial_question": "VARCHAR(2000)",
            "question_type": "VARCHAR(32)",
            "answer": "TEXT",
            "answer_sources": "JSON",
            "terminal_result": "JSON",
            "last_resume_key": "VARCHAR(255)",
            "last_resume_action": "VARCHAR(32)",
            "last_resume_at": "TIMESTAMP",
            "resume_count": "INTEGER DEFAULT 0",
        }
        with self.engine.begin() as conn:
            for name, sql_type in additions.items():
                if name not in columns:
                    conn.execute(text(f"ALTER TABLE profile_runs ADD COLUMN {name} {sql_type}"))
            if "graph_thread_id" not in columns:
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_runs_graph_thread_id "
                    "ON profile_runs (graph_thread_id)"
                ))

    def _migrate_authz_columns(self) -> None:
        """Add only nullable tenant/audit fields for legacy local databases.

        PostgreSQL production receives the equivalent, stricter migration from
        Alembic.  This compatibility path intentionally does not enforce the
        final NOT NULL constraints before `backfill_authz.py` has run.
        """
        from sqlalchemy import inspect, text

        additions: dict[str, dict[str, str]] = {
            "datasets": {"workspace_id": "VARCHAR(36)"},
            "profile_runs": {"workspace_id": "VARCHAR(36)"},
            "analysis_sessions": {"workspace_id": "VARCHAR(36)"},
            "retrieval_documents": {"workspace_id": "VARCHAR(36)"},
            "audit_events": {
                "workspace_id": "VARCHAR(36)",
                "actor_user_id": "VARCHAR(36)",
                "resource_type": "VARCHAR(64)",
                "resource_id": "VARCHAR(255)",
                "outcome": "VARCHAR(32)",
                "correlation_id": "VARCHAR(128)",
            },
        }
        inspector = inspect(self.engine)
        with self.engine.begin() as conn:
            for table_name, fields in additions.items():
                columns = {item["name"] for item in inspector.get_columns(table_name)}
                for name, sql_type in fields.items():
                    if name not in columns:
                        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {name} {sql_type}"))
            # Local/test databases may still contain the legacy role from a
            # previous authz schema. Keep them aligned with production.
            conn.execute(workspace_memberships.update().where(workspace_memberships.c.role == "owner").values(role="admin"))

    # --- Identity / tenant ------------------------------------------------ #
    @staticmethod
    def _legacy_workspace_id() -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, "p170:legacy-workspace"))

    def ensure_bootstrap_workspace(self, bootstrap_user_id: str) -> str:
        """Create the one deterministic legacy workspace/membership if needed."""
        workspace_id = self._legacy_workspace_id()
        now = _now()
        with self.engine.begin() as conn:
            exists = conn.execute(select(workspaces.c.id).where(workspaces.c.id == workspace_id)).first()
            if not exists:
                conn.execute(workspaces.insert().values(
                    id=workspace_id,
                    name="Legacy workspace",
                    slug="legacy",
                    created_by_user_id=bootstrap_user_id,
                    status="active",
                    settings={"report_separation_of_duties": True},
                    created_at=now,
                    updated_at=now,
                ))
            profile = conn.execute(select(user_profiles.c.user_id).where(user_profiles.c.user_id == bootstrap_user_id)).first()
            if not profile:
                conn.execute(user_profiles.insert().values(user_id=bootstrap_user_id, created_at=now, updated_at=now))
            membership = conn.execute(
                select(workspace_memberships.c.user_id).where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == bootstrap_user_id,
                )
            ).first()
            if not membership:
                conn.execute(workspace_memberships.insert().values(
                    workspace_id=workspace_id,
                    user_id=bootstrap_user_id,
                    role="admin",
                    status="active",
                    created_at=now,
                    updated_at=now,
                ))
        return workspace_id

    def ensure_guest_workspace(self, guest_user_id: str, role: str) -> str:
        """Create the isolated, non-personal workspace used by one trial tab."""
        if role not in {"admin", "analyst", "viewer"}:
            raise ValueError("Guest role không hợp lệ.")
        workspace_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"p170:guest-workspace:{guest_user_id}"))
        now = _now()
        with self.engine.begin() as conn:
            exists = conn.execute(select(workspaces.c.id).where(workspaces.c.id == workspace_id)).first()
            if not exists:
                conn.execute(workspaces.insert().values(
                    id=workspace_id,
                    name="P-170 Trial Workspace",
                    slug=f"guest-{workspace_id.replace('-', '')[:20]}",
                    created_by_user_id=guest_user_id,
                    status="active",
                    settings={"guest": True, "report_separation_of_duties": True},
                    created_at=now,
                    updated_at=now,
                ))
            membership = conn.execute(select(workspace_memberships.c.user_id).where(
                workspace_memberships.c.workspace_id == workspace_id,
                workspace_memberships.c.user_id == guest_user_id,
            )).first()
            if not membership:
                conn.execute(workspace_memberships.insert().values(
                    workspace_id=workspace_id,
                    user_id=guest_user_id,
                    role=role,
                    status="active",
                    created_at=now,
                    updated_at=now,
                ))
            else:
                conn.execute(workspace_memberships.update().where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == guest_user_id,
                ).values(role=role, updated_at=now))
        return workspace_id

    def purge_guest_workspace(self, guest_user_id: str) -> bool:
        """Remove trial data and identity rows; never touches Supabase users."""
        with self.engine.begin() as conn:
            workspace_ids = [row[0] for row in conn.execute(select(workspaces.c.id).where(
                workspaces.c.created_by_user_id == guest_user_id,
                workspaces.c.settings.isnot(None),
            )).all()]
            guest_workspace_ids = []
            for workspace_id in workspace_ids:
                row = conn.execute(select(workspaces.c.settings).where(workspaces.c.id == workspace_id)).first()
                if row and isinstance(row[0], dict) and row[0].get("guest"):
                    guest_workspace_ids.append(workspace_id)
            for workspace_id in guest_workspace_ids:
                source_refs = [row[0] for row in conn.execute(select(datasets.c.source_ref).where(datasets.c.workspace_id == workspace_id)).all()]
                for source_ref in source_refs:
                    try:
                        from src.services.google_drive import (
                            GoogleDriveStorage,
                            is_google_drive_ref,
                            parse_google_drive_ref,
                        )
                        from src.services.storage import (
                            get_storage,
                            is_supabase_ref,
                            parse_supabase_ref,
                        )

                        if is_supabase_ref(str(source_ref)):
                            bucket, object_path = parse_supabase_ref(str(source_ref))
                            get_storage().remove(bucket, object_path)
                        elif is_google_drive_ref(str(source_ref)):
                            ref_workspace_id, file_id, _ = parse_google_drive_ref(str(source_ref))
                            if ref_workspace_id == workspace_id:
                                GoogleDriveStorage(self.settings).remove(workspace_id, file_id)
                        else:
                            source_path = Path(str(source_ref))
                            upload_root = self.settings.upload_path.resolve()
                            source_path.resolve().relative_to(upload_root)
                            source_path.unlink(missing_ok=True)
                    except Exception:  # noqa: BLE001, S110
                        # Metadata cleanup must not be blocked by an already
                        # missing object or a temporary Storage outage.
                        pass
                for table in reversed(metadata.sorted_tables):
                    if "workspace_id" in table.c:
                        conn.execute(table.delete().where(table.c.workspace_id == workspace_id))
                conn.execute(workspaces.delete().where(workspaces.c.id == workspace_id))
            conn.execute(user_profiles.delete().where(user_profiles.c.user_id == guest_user_id))
        return bool(guest_workspace_ids)

    def purge_expired_guest_workspaces(self, retention_hours: int) -> int:
        """Best-effort TTL cleanup for guest workspaces abandoned in a tab."""
        cutoff = _now() - timedelta(hours=retention_hours)
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(
                    workspaces.c.created_by_user_id,
                    workspaces.c.created_at,
                    workspaces.c.settings,
                ).where(workspaces.c.created_at < cutoff)
            ).all()
        guest_user_ids = {
            str(user_id)
            for user_id, _created_at, workspace_settings in rows
            if isinstance(workspace_settings, dict) and workspace_settings.get("guest") and user_id
        }
        return sum(1 for user_id in guest_user_ids if self.purge_guest_workspace(user_id))

    def provision_self_signup_workspace(self, user_id: str, email: str | None, role: str) -> dict[str, Any]:
        """Create or return the personal workspace for a self-signing-up user."""
        if role not in {"admin", "analyst", "viewer"}:
            raise ValueError("Role self-signup không hợp lệ.")
        now = _now()
        with self.engine.begin() as conn:
            candidates = conn.execute(
                select(workspaces, workspace_memberships.c.role.label("membership_role"))
                .join(workspace_memberships, workspace_memberships.c.workspace_id == workspaces.c.id)
                .where(
                    workspace_memberships.c.user_id == user_id,
                    workspace_memberships.c.status == "active",
                    workspaces.c.created_by_user_id == user_id,
                )
                .order_by(workspaces.c.created_at)
            ).mappings().all()
            for existing in candidates:
                workspace_settings = existing.get("settings") or {}
                if isinstance(workspace_settings, dict) and workspace_settings.get("self_signup"):
                    return {
                        "workspace_id": existing["id"],
                        "workspace_name": existing["name"],
                        "workspace_slug": existing["slug"],
                        "role": existing["membership_role"],
                        "created": False,
                    }

            workspace_id = str(uuid.uuid4())
            slug = f"personal-{workspace_id.replace('-', '')[:20]}"
            local_part = (email or "user").split("@", 1)[0].strip() or "user"
            workspace_name = f"Workspace của {local_part[:180]}"
            conn.execute(workspaces.insert().values(
                id=workspace_id,
                name=workspace_name,
                slug=slug,
                created_by_user_id=user_id,
                status="active",
                settings={"self_signup": True, "report_separation_of_duties": True},
                created_at=now,
                updated_at=now,
            ))
            profile = conn.execute(select(user_profiles.c.user_id).where(user_profiles.c.user_id == user_id)).first()
            if not profile:
                conn.execute(user_profiles.insert().values(user_id=user_id, created_at=now, updated_at=now))
            conn.execute(workspace_memberships.insert().values(
                workspace_id=workspace_id,
                user_id=user_id,
                role=role,
                status="active",
                created_at=now,
                updated_at=now,
            ))
            return {
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
                "workspace_slug": slug,
                "role": role,
                "created": True,
            }

    def get_workspace(self, workspace_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(select(workspaces).where(workspaces.c.id == workspace_id)).mappings().first()
            return dict(row) if row else None

    def list_active_memberships_for_user(self, user_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(workspace_memberships).where(
                    workspace_memberships.c.user_id == user_id,
                    workspace_memberships.c.status == "active",
                ).order_by(workspace_memberships.c.created_at)
            ).mappings()
            return [dict(row) for row in rows]

    def get_membership(self, workspace_id: str, user_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(select(workspace_memberships).where(
                workspace_memberships.c.workspace_id == workspace_id,
                workspace_memberships.c.user_id == user_id,
            )).mappings().first()
            return dict(row) if row else None

    def list_memberships(self, workspace_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(workspace_memberships).where(
                workspace_memberships.c.workspace_id == workspace_id,
            ).order_by(workspace_memberships.c.created_at)).mappings()
            return [dict(row) for row in rows]

    def save_membership(self, workspace_id: str, user_id: str, role: str, status: str = "active") -> dict[str, Any]:
        now = _now()
        with self.engine.begin() as conn:
            existing = conn.execute(select(workspace_memberships).where(
                workspace_memberships.c.workspace_id == workspace_id,
                workspace_memberships.c.user_id == user_id,
            )).mappings().first()
            values = {"role": role, "status": status, "updated_at": now}
            if existing:
                conn.execute(workspace_memberships.update().where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == user_id,
                ).values(**values))
            else:
                conn.execute(workspace_memberships.insert().values(
                    workspace_id=workspace_id, user_id=user_id, role=role, status=status,
                    created_at=now, updated_at=now,
                ))
            row = conn.execute(select(workspace_memberships).where(
                workspace_memberships.c.workspace_id == workspace_id,
                workspace_memberships.c.user_id == user_id,
            )).mappings().one()
            return dict(row)

    def create_invitation(self, workspace_id: str, email: str, role: str, invited_by_user_id: str, *, expires_at: datetime) -> tuple[dict[str, Any], str]:
        """Store only a hash of an opaque invite secret, never the secret itself."""
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = _now()
        invitation = {
            "id": str(uuid.uuid4()), "workspace_id": workspace_id,
            "normalized_email": email.strip().casefold(), "role": role, "token_hash": token_hash,
            "expires_at": expires_at, "invited_by_user_id": invited_by_user_id,
            "status": "pending", "created_at": now,
        }
        with self.engine.begin() as conn:
            conn.execute(workspace_invitations.insert().values(**invitation))
        return invitation, token

    def accept_invitation(self, token: str, user_id: str, email: str | None) -> dict[str, Any] | None:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = _now()
        with self.engine.begin() as conn:
            invite = conn.execute(select(workspace_invitations).where(
                workspace_invitations.c.token_hash == token_hash,
                workspace_invitations.c.status == "pending",
            )).mappings().first()
            if not invite or invite["expires_at"] <= now:
                return None
            if email and str(invite["normalized_email"]) != email.casefold():
                return None
            conn.execute(workspace_memberships.insert().values(
                workspace_id=invite["workspace_id"], user_id=user_id, role=invite["role"], status="active",
                created_at=now, updated_at=now,
            ))
            conn.execute(workspace_invitations.update().where(workspace_invitations.c.id == invite["id"]).values(
                status="accepted", accepted_by_user_id=user_id,
            ))
            row = conn.execute(select(workspace_memberships).where(
                workspace_memberships.c.workspace_id == invite["workspace_id"],
                workspace_memberships.c.user_id == user_id,
            )).mappings().one()
            return dict(row)

    # --- Google Drive connections -------------------------------------- #
    def create_google_drive_oauth_state(
        self, state_id: str, workspace_id: str, user_id: str, expires_at: datetime
    ) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                google_drive_oauth_states.insert().values(
                    id=state_id,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    expires_at=expires_at,
                    created_at=_now(),
                )
            )

    def consume_google_drive_oauth_state(self, state_id: str) -> dict[str, Any] | None:
        now = _now()
        with self.engine.begin() as conn:
            row = conn.execute(
                select(google_drive_oauth_states)
                .where(
                    google_drive_oauth_states.c.id == state_id,
                    google_drive_oauth_states.c.used_at.is_(None),
                    google_drive_oauth_states.c.expires_at > now,
                )
                .with_for_update()
            ).mappings().first()
            if not row:
                return None
            conn.execute(
                google_drive_oauth_states.update()
                .where(google_drive_oauth_states.c.id == state_id)
                .values(used_at=now)
            )
            return dict(row)

    def save_google_drive_connection(
        self,
        workspace_id: str,
        folder_id: str,
        encrypted_refresh_token: str,
        connected_by_user_id: str,
    ) -> None:
        now = _now()
        with self.engine.begin() as conn:
            existing = conn.execute(
                select(google_drive_connections.c.workspace_id).where(
                    google_drive_connections.c.workspace_id == workspace_id
                )
            ).first()
            values = {
                "folder_id": folder_id,
                "encrypted_refresh_token": encrypted_refresh_token,
                "connected_by_user_id": connected_by_user_id,
                "updated_at": now,
            }
            if existing:
                conn.execute(
                    google_drive_connections.update()
                    .where(google_drive_connections.c.workspace_id == workspace_id)
                    .values(**values)
                )
            else:
                conn.execute(
                    google_drive_connections.insert().values(
                        workspace_id=workspace_id,
                        created_at=now,
                        **values,
                    )
                )

    def get_google_drive_connection(self, workspace_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = conn.execute(
                select(google_drive_connections).where(
                    google_drive_connections.c.workspace_id == workspace_id
                )
            ).mappings().first()
            return dict(row) if row else None

    def delete_google_drive_connection(self, workspace_id: str) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(
                google_drive_connections.delete().where(
                    google_drive_connections.c.workspace_id == workspace_id
                )
            )
            return bool(result.rowcount)

    # --- Dataset -------------------------------------------------------- #
    def upsert_dataset(self, name: str, source_type: str, source_ref: str, *, workspace_id: str) -> str:
        """Trả về dataset id; dataset đã tồn tại (theo source_ref) thì tái sử dụng."""
        with self.engine.begin() as conn:
            row = conn.execute(
                select(datasets.c.id).where(
                    datasets.c.source_ref == source_ref,
                    datasets.c.workspace_id == workspace_id,
                )
            ).first()
            if row:
                return row[0]
            dataset_id = _uuid()
            conn.execute(
                datasets.insert().values(
                    id=dataset_id,
                    name=name,
                    source_type=source_type,
                    source_ref=source_ref,
                    workspace_id=workspace_id,
                    created_at=_now(),
                )
            )
            return dataset_id

    def create_dataset(self, dataset_id: str, name: str, source_type: str, source_ref: str, *, workspace_id: str) -> str:
        """Persist an uploaded source before profiling so it is tenant-owned."""
        with self.engine.begin() as conn:
            conn.execute(datasets.insert().values(
                id=dataset_id, name=name, source_type=source_type, source_ref=source_ref,
                workspace_id=workspace_id, created_at=_now(),
            ))
        return dataset_id

    def get_dataset(self, dataset_id: str, *, workspace_id: str | None = None) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            query = select(datasets).where(datasets.c.id == dataset_id)
            if workspace_id is not None:
                query = query.where(datasets.c.workspace_id == workspace_id)
            row = conn.execute(query).mappings().first()
            return dict(row) if row else None

    def list_datasets(self, *, workspace_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(select(datasets).where(
                datasets.c.workspace_id == workspace_id
            ).order_by(datasets.c.created_at.desc())).mappings()
            return [dict(r) for r in rows]

    def delete_dataset(self, dataset_id: str, *, workspace_id: str) -> dict[str, Any] | None:
        """Xóa dataset và toàn bộ metadata con, trả về source_ref + run ids."""
        with self.engine.begin() as conn:
            dataset = conn.execute(
                select(datasets).where(datasets.c.id == dataset_id, datasets.c.workspace_id == workspace_id)
            ).mappings().first()
            if not dataset:
                return None

            run_ids = [
                row[0]
                for row in conn.execute(
                    select(profile_runs.c.id).where(profile_runs.c.dataset_id == dataset_id)
                )
            ]

            if run_ids:
                for table in PROPOSAL_TABLES.values():
                    conn.execute(table.delete().where(table.c.profile_run_id.in_(run_ids)))
                conn.execute(column_stats.delete().where(column_stats.c.profile_run_id.in_(run_ids)))
                conn.execute(
                    statistical_test_results.delete().where(
                        statistical_test_results.c.profile_run_id.in_(run_ids)
                    )
                )
                conn.execute(
                    drift_reports.delete().where(
                        (drift_reports.c.profile_run_id_a.in_(run_ids))
                        | (drift_reports.c.profile_run_id_b.in_(run_ids))
                    )
                )
                conn.execute(profile_runs.delete().where(profile_runs.c.id.in_(run_ids)))

            conn.execute(datasets.delete().where(datasets.c.id == dataset_id, datasets.c.workspace_id == workspace_id))
            return {
                "dataset_id": dataset_id,
                "source_ref": dataset["source_ref"],
                "run_ids": run_ids,
            }

    # --- ProfileRun ----------------------------------------------------- #
    def create_profile_run(
        self,
        dataset_id: str,
        scan_mode: str,
        sampling_strategy: str | None = None,
        sample_size: int | None = None,
        random_seed: int | None = None,
        graph_thread_id: str | None = None,
        initial_question: str | None = None,
        workspace_id: str | None = None,
    ) -> str:
        with self.engine.begin() as conn:
            dataset_query = select(datasets.c.workspace_id).where(datasets.c.id == dataset_id)
            if workspace_id is not None:
                dataset_query = dataset_query.where(datasets.c.workspace_id == workspace_id)
            dataset_workspace = conn.execute(dataset_query).scalar_one_or_none()
            if dataset_workspace is None:
                raise LookupError("Không tìm thấy dataset trong workspace.")
            version = (
                conn.execute(
                    select(func.coalesce(func.max(profile_runs.c.version), 0)).where(
                        profile_runs.c.dataset_id == dataset_id
                    )
                ).scalar()
                or 0
            ) + 1
            run_id = _uuid()
            conn.execute(
                profile_runs.insert().values(
                    id=run_id,
                    dataset_id=dataset_id,
                    workspace_id=str(dataset_workspace),
                    version=version,
                    created_at=_now(),
                    scan_mode=scan_mode,
                    sampling_strategy=sampling_strategy,
                    sample_size=sample_size,
                    random_seed=random_seed,
                    status="created",
                    graph_thread_id=graph_thread_id,
                    initial_question=initial_question,
                    resume_count=0,
                    is_approximate=scan_mode == "sample",
                )
            )
            return run_id

    def transition_profile_run(
        self,
        run_id: str,
        from_statuses: set[str] | list[str] | tuple[str, ...],
        to_status: str,
        workspace_id: str | None = None,
        **fields: Any,
    ) -> bool:
        """Atomically transition a run and prevent two resumes from racing."""
        with self.engine.begin() as conn:
            result = conn.execute(
                profile_runs.update()
                .where(profile_runs.c.id == run_id)
                .where(profile_runs.c.status.in_(list(from_statuses)))
                .where(profile_runs.c.workspace_id == workspace_id if workspace_id is not None else True)
                .values(status=to_status, **fields)
            )
            return result.rowcount > 0

    def execution_config(self, run_id: str, *, workspace_id: str | None = None) -> dict[str, Any] | None:
        run = self.get_profile_run(run_id, workspace_id=workspace_id)
        if not run or not run.get("graph_thread_id"):
            return None
        return {"configurable": {"thread_id": run["graph_thread_id"]}}

    def apply_review_and_start(
        self,
        run_id: str,
        *,
        action: str,
        decisions: list[dict[str, Any]],
        confirmed_by: str,
        idempotency_key: str | None = None,
        workspace_id: str | None = None,
    ) -> dict[str, Any]:
        """Validate/apply one review atomically, then claim the run for resume."""
        with self.engine.begin() as conn:
            query = select(profile_runs).where(profile_runs.c.id == run_id)
            if workspace_id is not None:
                query = query.where(profile_runs.c.workspace_id == workspace_id)
            run = conn.execute(query).mappings().first()
            if not run:
                return {"ok": False, "code": "not_found"}
            if idempotency_key and run.get("last_resume_key") == idempotency_key:
                return {"ok": True, "duplicate": True, "run": dict(run), "applied": 0}
            if run["status"] != "pending_review":
                return {"ok": False, "code": "invalid_state", "status": run["status"]}

            normalized: list[dict[str, Any]] = []
            seen: set[tuple[str, str]] = set()
            for item in decisions:
                kind = item.get("kind")
                proposal_id = item.get("proposal_id")
                table = PROPOSAL_TABLES.get(kind)
                key = (str(kind), str(proposal_id))
                if table is None or key in seen:
                    return {"ok": False, "code": "invalid_proposal", "proposal_id": proposal_id}
                seen.add(key)
                row = conn.execute(
                    select(table).where(
                        table.c.id == proposal_id,
                        table.c.profile_run_id == run_id,
                        table.c.status == "pending",
                    )
                ).mappings().first()
                if not row:
                    return {"ok": False, "code": "invalid_proposal", "proposal_id": proposal_id}
                normalized.append(item)

            status_map = {"confirm": "confirmed", "reject": "rejected", "edit": "edited"}
            for item in normalized:
                decision = item.get("decision")
                if decision not in status_map:
                    return {"ok": False, "code": "invalid_decision"}
                if decision == "edit" and not item.get("final_type"):
                    return {"ok": False, "code": "edit_requires_final_type", "proposal_id": item["proposal_id"]}
                table = PROPOSAL_TABLES[item["kind"]]
                values: dict[str, Any] = {
                    "status": status_map[decision],
                    "confirmed_by": confirmed_by,
                    "confirmed_at": _now(),
                }
                if item.get("final_type") is not None and "final_type" in table.c:
                    values["final_type"] = item["final_type"]
                result = conn.execute(
                    table.update()
                    .where(table.c.id == item["proposal_id"])
                    .where(table.c.profile_run_id == run_id)
                    .where(table.c.status == "pending")
                    .values(**values)
                )
                if result.rowcount != 1:
                    return {"ok": False, "code": "concurrent_review"}

            update_values: dict[str, Any] = {
                "status": "resuming",
                "last_resume_action": action,
                "last_resume_at": _now(),
                "resume_count": (run.get("resume_count") or 0) + 1,
            }
            if idempotency_key:
                update_values["last_resume_key"] = idempotency_key
            result = conn.execute(
                profile_runs.update()
                .where(profile_runs.c.id == run_id)
                .where(profile_runs.c.status == "pending_review")
                .values(**update_values)
            )
            if result.rowcount != 1:
                return {"ok": False, "code": "concurrent_review"}
            updated = conn.execute(select(profile_runs).where(profile_runs.c.id == run_id)).mappings().first()
            return {"ok": True, "duplicate": False, "run": dict(updated), "applied": len(normalized)}

    def update_profile_run(self, run_id: str, *, workspace_id: str | None = None, **fields: Any) -> None:
        if not fields:
            return
        with self.engine.begin() as conn:
            conn.execute(
                profile_runs.update().where(profile_runs.c.id == run_id).where(
                    profile_runs.c.workspace_id == workspace_id if workspace_id is not None else True
                ).values(**fields)
            )

    def get_profile_run(self, run_id: str, *, workspace_id: str | None = None) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            query = select(profile_runs).where(profile_runs.c.id == run_id)
            if workspace_id is not None:
                query = query.where(profile_runs.c.workspace_id == workspace_id)
            row = conn.execute(query).mappings().first()
            return dict(row) if row else None

    def list_profile_runs(self, dataset_id: str | None = None, limit: int = 50, *, workspace_id: str | None = None) -> list[dict[str, Any]]:
        query = select(profile_runs).order_by(profile_runs.c.created_at.desc()).limit(limit)
        if workspace_id is not None:
            query = query.where(profile_runs.c.workspace_id == workspace_id)
        if dataset_id:
            query = query.where(profile_runs.c.dataset_id == dataset_id)
        with self.engine.begin() as conn:
            return [dict(r) for r in conn.execute(query).mappings()]

    def mark_profiled(self, dataset_id: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                datasets.update()
                .where(datasets.c.id == dataset_id)
                .values(last_profiled_at=_now())
            )

    # --- ColumnStat ----------------------------------------------------- #
    def save_column_stats(self, run_id: str, stats: dict[str, dict[str, Any]]) -> None:
        """Ghi thống kê từng cột. Chỉ lấy các khoá có cột tương ứng trong bảng."""
        allowed = set(column_stats.c.keys()) - {"id", "profile_run_id"}
        rows = []
        for column_name, st in stats.items():
            payload = {k: v for k, v in st.items() if k in allowed}
            payload["column_name"] = column_name
            payload.setdefault("is_approximate", False)
            rows.append({"id": _uuid(), "profile_run_id": run_id, **payload})
        if not rows:
            return
        with self.engine.begin() as conn:
            conn.execute(
                column_stats.delete().where(column_stats.c.profile_run_id == run_id)
            )
            conn.execute(column_stats.insert(), rows)

    def column_stats_rows(
        self, run_id: str, column_name: str | None = None
    ) -> list[dict[str, Any]]:
        """Thống kê từng cột dạng list — giữ cả `id` để trace về dòng DB."""
        query = select(column_stats).where(column_stats.c.profile_run_id == run_id)
        if column_name:
            query = query.where(func.lower(column_stats.c.column_name) == column_name.lower())
        with self.engine.begin() as conn:
            return [dict(r) for r in conn.execute(query).mappings()]

    def get_column_stats(
        self, run_id: str, column_name: str | None = None
    ) -> dict[str, dict[str, Any]]:
        """Thống kê từng cột, key theo tên cột — cùng shape với `compute` trả về.

        Đây là dạng mà node và tool dùng, nên tra cột theo tên là O(1).
        """
        return {
            row["column_name"]: row for row in self.column_stats_rows(run_id, column_name)
        }

    # --- Proposals ------------------------------------------------------ #
    def save_proposals(self, run_id: str, kind: ProposalKind, items: list[dict[str, Any]]) -> list[str]:
        """Ghi proposals cho một loại. Ghi đè proposals cũ của cùng run."""
        table = PROPOSAL_TABLES[kind]
        allowed = set(table.c.keys()) - {"id", "profile_run_id", "created_at"}
        rows, ids = [], []
        for item in items:
            payload = {k: v for k, v in item.items() if k in allowed}
            payload.setdefault("status", "pending")
            payload.setdefault("confidence_score", 0.0)
            proposal_id = _uuid()
            ids.append(proposal_id)
            rows.append(
                {"id": proposal_id, "profile_run_id": run_id, "created_at": _now(), **payload}
            )
        with self.engine.begin() as conn:
            # Preserve confirmed/edited/rejected rows as a decision history;
            # only an unreviewed revision may be replaced.
            conn.execute(
                table.delete().where(
                    table.c.profile_run_id == run_id,
                    table.c.status == "pending",
                )
            )
            if rows:
                conn.execute(table.insert(), rows)
        return ids

    def get_proposals(
        self,
        run_id: str,
        kind: ProposalKind | None = None,
        status: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        kinds = [kind] if kind else list(PROPOSAL_TABLES)
        out: dict[str, list[dict[str, Any]]] = {}
        with self.engine.begin() as conn:
            for k in kinds:
                table = PROPOSAL_TABLES[k]
                query = select(table).where(table.c.profile_run_id == run_id)
                if status:
                    query = query.where(table.c.status == status)
                out[k] = [
                    dict(r)
                    for r in conn.execute(query.order_by(table.c.confidence_score.desc())).mappings()
                ]
        return out

    def update_proposal(
        self,
        kind: ProposalKind,
        proposal_id: str,
        status: ProposalStatus,
        confirmed_by: str | None = None,
        final_type: str | None = None,
        run_id: str | None = None,
    ) -> bool:
        table = PROPOSAL_TABLES[kind]
        values: dict[str, Any] = {
            "status": status,
            "confirmed_by": confirmed_by,
            "confirmed_at": _now(),
        }
        if final_type is not None and "final_type" in table.c:
            values["final_type"] = final_type
        with self.engine.begin() as conn:
            query = table.update().where(table.c.id == proposal_id)
            if run_id:
                query = query.where(table.c.profile_run_id == run_id)
            result = conn.execute(query.values(**values))
            return result.rowcount > 0

    def save_terminal_result(
        self,
        run_id: str,
        *,
        question_type: str | None = None,
        answer: str | None = None,
        answer_sources: list[dict[str, Any]] | None = None,
        terminal_result: dict[str, Any] | None = None,
    ) -> None:
        self.update_profile_run(
            run_id,
            question_type=question_type,
            answer=answer,
            answer_sources=answer_sources or [],
            terminal_result=terminal_result or {},
            status="completed",
        )

    def confirmed_pii_columns(self, run_id: str) -> set[str]:
        """Cột PII đã xác nhận — dùng để mask giá trị trong báo cáo & QA."""
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(pii_proposals.c.column_name).where(
                    pii_proposals.c.profile_run_id == run_id,
                    pii_proposals.c.status.in_(["confirmed", "auto_confirmed", "pending"]),
                )
            )
            # `pending` cũng mask: fail-closed khi Analyst chưa kịp review.
            return {r[0] for r in rows}

    def pending_count(self, run_id: str) -> int:
        total = 0
        with self.engine.begin() as conn:
            for table in PROPOSAL_TABLES.values():
                total += (
                    conn.execute(
                        select(func.count()).where(
                            table.c.profile_run_id == run_id, table.c.status == "pending"
                        )
                    ).scalar()
                    or 0
                )
        return total

    # --- Statistical tests ---------------------------------------------- #
    def save_test_results(
        self, run_id: str, results: list[dict[str, Any]], requested_by: str | None = None
    ) -> None:
        allowed = set(statistical_test_results.c.keys()) - {"id", "profile_run_id", "created_at"}
        rows = []
        for r in results:
            payload = {k: v for k, v in r.items() if k in allowed}
            payload["requested_by"] = requested_by
            # `error` không có cột riêng — gộp vào extra để không mất thông tin.
            if r.get("error"):
                extra = dict(payload.get("extra") or {})
                extra["error"] = r["error"]
                payload["extra"] = extra
            rows.append(
                {"id": _uuid(), "profile_run_id": run_id, "created_at": _now(), **payload}
            )
        if not rows:
            return
        with self.engine.begin() as conn:
            conn.execute(statistical_test_results.insert(), rows)

    def get_test_results(self, run_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(statistical_test_results)
                .where(statistical_test_results.c.profile_run_id == run_id)
                .order_by(statistical_test_results.c.created_at.asc())
            ).mappings()
            return [dict(r) for r in rows]

    # --- Drift ---------------------------------------------------------- #
    def save_drift_report(
        self, run_a: str, run_b: str, drift_columns: list[dict[str, Any]], summary: str
    ) -> str:
        report_id = _uuid()
        with self.engine.begin() as conn:
            conn.execute(
                drift_reports.insert().values(
                    id=report_id,
                    profile_run_id_a=run_a,
                    profile_run_id_b=run_b,
                    drift_columns=drift_columns,
                    summary=summary,
                    created_at=_now(),
                )
            )
        return report_id

    def get_drift_reports(self, run_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(drift_reports).where(
                    (drift_reports.c.profile_run_id_a == run_id)
                    | (drift_reports.c.profile_run_id_b == run_id)
                )
            ).mappings()
            return [dict(r) for r in rows]

    # --- Tổng hợp cho báo cáo & QA -------------------------------------- #
    def full_profile(
        self, run_id: str, mask_pii: bool = True, *, workspace_id: str | None = None
    ) -> dict[str, Any] | None:
        """Toàn bộ hồ sơ của một run. `mask_pii=True` xoá top_k_values của cột PII."""
        run = self.get_profile_run(run_id, workspace_id=workspace_id)
        if not run:
            return None

        stats = self.column_stats_rows(run_id)
        if mask_pii:
            pii_cols = self.confirmed_pii_columns(run_id)
            for st in stats:
                if st["column_name"] in pii_cols:
                    st["top_k_values"] = None
                    st["pii_masked"] = True

        return {
            "run": run,
            "dataset": self.get_dataset(run["dataset_id"], workspace_id=workspace_id),
            "column_stats": stats,
            "proposals": self.get_proposals(run_id),
            "test_results": self.get_test_results(run_id),
            "drift_reports": self.get_drift_reports(run_id),
        }

    def profile_summary_text(self, run_id: str, *, workspace_id: str | None = None) -> str:
        """Dựng văn bản mô tả run — nội dung index cho QA vector search."""
        profile = self.full_profile(run_id, workspace_id=workspace_id)
        if not profile:
            return ""
        run, dataset = profile["run"], profile["dataset"] or {}
        lines = [
            # Không index source_ref: với file local nó có thể làm lộ absolute
            # path; với warehouse nó có thể lộ tên project/table ngoài nhu cầu QA.
            f"Dataset: {dataset.get('name', 'unknown')}",
            f"Profile run version {run['version']} — {run['created_at']}",
            f"Chế độ quét: {run['scan_mode']}; số dòng: {run.get('row_count')}"
            + (" (số liệu là ước lượng từ sampling)" if run.get("is_approximate") else ""),
        ]
        if run.get("narrative_report"):
            lines.append(run["narrative_report"])
        for warning in run.get("risk_warnings") or []:
            lines.append(f"Cảnh báo: {warning}")
        for st in profile["column_stats"]:
            lines.append(
                f"Cột {st['column_name']} ({st.get('dtype')}): null% = {st.get('null_pct')}, "
                f"cardinality = {st.get('cardinality')}, uniqueness = {st.get('uniqueness_ratio')}"
            )
        for result in profile["test_results"]:
            lines.append(
                f"Kiểm định {result['test_type']} trên {json.dumps(result['target_columns'], ensure_ascii=False)}: "
                f"{result.get('interpretation') or result['conclusion']}"
            )
        return "\n".join(lines)

    # --- Retrieval persistence ----------------------------------------- #
    def list_retrieval_documents(self, *, workspace_id: str | None = None) -> list[dict[str, Any]]:
        """Return only global corpus plus the requested tenant's documents."""
        with self.engine.begin() as conn:
            query = select(retrieval_documents)
            if workspace_id is None:
                query = query.where(retrieval_documents.c.workspace_id.is_(None))
            else:
                query = query.where(
                    (retrieval_documents.c.workspace_id == workspace_id)
                    | retrieval_documents.c.workspace_id.is_(None)
                )
            rows = conn.execute(query.order_by(retrieval_documents.c.doc_id)).mappings().all()
        return [dict(row) for row in rows]

    def upsert_retrieval_document(
        self,
        doc_id: str,
        text: str,
        document_metadata: dict[str, Any] | None,
        vector: list[float] | None,
        *,
        workspace_id: str | None = None,
    ) -> None:
        now = _now()
        values = {
            "doc_id": doc_id,
            "text": text,
            "document_metadata": document_metadata or {},
            "workspace_id": workspace_id,
            "vector": vector or [],
            "updated_at": now,
        }
        with self.engine.begin() as conn:
            existing = conn.execute(
                select(retrieval_documents.c.doc_id).where(
                    retrieval_documents.c.doc_id == doc_id
                )
            ).first()
            if existing:
                conn.execute(
                    retrieval_documents.update()
                    .where(retrieval_documents.c.doc_id == doc_id)
                    .values(**values)
                )
            else:
                conn.execute(
                    retrieval_documents.insert().values(
                        **{**values, "created_at": now}
                    )
                )

    def upsert_retrieval_documents(
        self, documents: list[tuple[str, str, dict[str, Any], list[float]]], *, workspace_id: str | None = None
    ) -> dict[str, int]:
        """Idempotent bulk upsert in one transaction.

        Keep this portable across PostgreSQL and the SQLite test database rather
        than relying on a dialect-specific ON CONFLICT clause.
        """
        if not documents:
            return {"inserted": 0, "updated": 0, "unchanged": 0}
        ids = [doc_id for doc_id, _, _, _ in documents]
        now = _now()
        inserted = updated = unchanged = 0
        with self.engine.begin() as conn:
            existing = {
                row["doc_id"]: dict(row)
                for row in conn.execute(
                    select(retrieval_documents).where(retrieval_documents.c.doc_id.in_(ids))
                ).mappings()
            }
            for doc_id, text, document_metadata, vector in documents:
                values = {
                    "text": text,
                    "document_metadata": document_metadata or {},
                    "workspace_id": workspace_id,
                    "vector": vector or [],
                    "updated_at": now,
                }
                previous = existing.get(doc_id)
                if previous and all(previous.get(key) == value for key, value in values.items() if key != "updated_at"):
                    unchanged += 1
                elif previous:
                    conn.execute(
                        retrieval_documents.update().where(retrieval_documents.c.doc_id == doc_id).values(**values)
                    )
                    updated += 1
                else:
                    conn.execute(retrieval_documents.insert().values(doc_id=doc_id, created_at=now, **values))
                    inserted += 1
        return {"inserted": inserted, "updated": updated, "unchanged": unchanged}

    def delete_external_retrieval_documents_except(self, active_ids: set[str]) -> int:
        """Delete only confirmed stale external-corpus documents, never reports."""
        with self.engine.begin() as conn:
            rows = conn.execute(select(retrieval_documents.c.doc_id, retrieval_documents.c.document_metadata)).mappings()
            stale = [
                row["doc_id"] for row in rows
                if (row.get("document_metadata") or {}).get("knowledge_type") == "external_knowledge"
                and row["doc_id"] not in active_ids
            ]
            if not stale:
                return 0
            result = conn.execute(retrieval_documents.delete().where(retrieval_documents.c.doc_id.in_(stale)))
        return int(result.rowcount or 0)

    def delete_retrieval_document(self, doc_id: str, *, workspace_id: str | None = None) -> bool:
        with self.engine.begin() as conn:
            query = retrieval_documents.delete().where(retrieval_documents.c.doc_id == doc_id)
            if workspace_id is not None:
                query = query.where(retrieval_documents.c.workspace_id == workspace_id)
            result = conn.execute(query)
        return bool(result.rowcount)

    # --- Audit persistence --------------------------------------------- #
    def save_audit_event(self, event: str, fields: dict[str, Any]) -> None:
        # JSON columns reject arbitrary Python objects.  Normalize exception,
        # UUID and datetime values while preserving the existing audit contract.
        normalized = json.loads(
            json.dumps(fields, ensure_ascii=False, default=str)
        )
        scoped = {
            "workspace_id": normalized.get("workspace_id"),
            "actor_user_id": normalized.get("actor_user_id") or normalized.get("user_id"),
            "resource_type": normalized.get("resource_type"),
            "resource_id": normalized.get("resource_id"),
            "outcome": normalized.get("outcome", "success"),
            "correlation_id": normalized.get("correlation_id"),
        }
        with self.engine.begin() as conn:
            conn.execute(
                audit_events.insert().values(
                    ts=_now(), event=event, fields=normalized, **scoped
                )
            )

    def tail_audit_events(self, limit: int = 50, *, workspace_id: str | None = None) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            query = select(audit_events)
            if workspace_id is not None:
                query = query.where(audit_events.c.workspace_id == workspace_id)
            rows = conn.execute(query.order_by(audit_events.c.id.desc()).limit(limit)).mappings().all()
        output: list[dict[str, Any]] = []
        for row in reversed(rows):
            item = dict(row["fields"] or {})
            timestamp = row["ts"]
            item = {
                "ts": timestamp.isoformat() if hasattr(timestamp, "isoformat") else str(timestamp),
                "event": row["event"],
                **item,
            }
            output.append(item)
        return output

    # --- Published reports --------------------------------------------- #
    def _report_version_payload(self, conn: Any, version_row: dict[str, Any]) -> dict[str, Any]:
        payload = dict(version_row)
        version_id = payload["id"]
        payload["sections"] = [dict(row) for row in conn.execute(
            select(report_sections).where(report_sections.c.report_version_id == version_id)
            .order_by(report_sections.c.position)
        ).mappings()]
        payload["visualizations"] = [dict(row) for row in conn.execute(
            select(report_visualizations).where(report_visualizations.c.report_version_id == version_id)
            .order_by(report_visualizations.c.position)
        ).mappings()]
        payload["reviews"] = [dict(row) for row in conn.execute(
            select(report_reviews).where(report_reviews.c.report_version_id == version_id)
            .order_by(report_reviews.c.created_at)
        ).mappings()]
        return payload

    def list_reports(self, workspace_id: str, *, published_only: bool = False) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            query = select(reports).where(reports.c.workspace_id == workspace_id)
            if published_only:
                query = query.where(reports.c.status == "published")
            rows = conn.execute(query.order_by(reports.c.updated_at.desc())).mappings()
            return [dict(row) for row in rows]

    def get_report(self, report_id: str, workspace_id: str, *, published_only: bool = False) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            query = select(reports).where(reports.c.id == report_id, reports.c.workspace_id == workspace_id)
            if published_only:
                query = query.where(reports.c.status == "published")
            report = conn.execute(query).mappings().first()
            if not report:
                return None
            result = dict(report)
            version_id = report.get("current_published_version_id") if published_only else None
            version_query = select(report_versions).where(report_versions.c.report_id == report["id"])
            if version_id:
                version_query = version_query.where(report_versions.c.id == version_id)
            versions = conn.execute(version_query.order_by(report_versions.c.version.desc())).mappings()
            result["versions"] = [self._report_version_payload(conn, dict(row)) for row in versions]
            return result

    @staticmethod
    def _validate_visualization_spec(chart_type: str, spec: dict[str, Any]) -> None:
        if chart_type not in {"kpi", "bar", "line", "table"}:
            raise ValueError("chart_type không thuộc allowlist.")
        encoded = json.dumps(spec, ensure_ascii=False)
        if len(encoded) > 20_000:
            raise ValueError("visualization_spec quá lớn.")
        forbidden = {"sql", "javascript", "formatter", "local_path", "file_path", "result_hash"}
        if any(str(key).lower() in forbidden for key in spec):
            raise ValueError("visualization_spec chứa trường không được phép.")

    def _execution_for_workspace(self, conn: Any, execution_id: str, workspace_id: str) -> dict[str, Any] | None:
        row = conn.execute(
            select(query_executions, analysis_sessions.c.workspace_id)
            .join(analysis_sessions, analysis_sessions.c.id == query_executions.c.session_id)
            .where(query_executions.c.id == execution_id, analysis_sessions.c.workspace_id == workspace_id)
        ).mappings().first()
        return dict(row) if row else None

    def create_report(self, workspace_id: str, actor_user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        report_id, version_id, now = _uuid(), _uuid(), _now()
        title = str(payload["title"]).strip()
        slug = str(payload.get("slug") or title.lower().replace(" ", "-")).strip("-")[:160] or report_id
        with self.engine.begin() as conn:
            conn.execute(reports.insert().values(
                id=report_id, workspace_id=workspace_id, title=title, slug=slug, status="draft",
                created_by_user_id=actor_user_id, created_at=now, updated_at=now,
            ))
            conn.execute(report_versions.insert().values(
                id=version_id, report_id=report_id, version=1, status="draft",
                executive_summary=payload.get("executive_summary"), scope=payload.get("scope"),
                time_range=payload.get("time_range"), created_by_user_id=actor_user_id, created_at=now,
            ))
            self._replace_report_content(conn, version_id, workspace_id, payload)
        return self.get_report(report_id, workspace_id) or {}

    def _replace_report_content(self, conn: Any, version_id: str, workspace_id: str, payload: dict[str, Any]) -> None:
        sections = payload.get("sections") or []
        visualizations = payload.get("visualizations") or []
        allowed_sections = {"narrative", "methodology", "findings", "limitations", "recommendations"}
        conn.execute(report_sections.delete().where(report_sections.c.report_version_id == version_id))
        conn.execute(report_visualizations.delete().where(report_visualizations.c.report_version_id == version_id))
        for position, section in enumerate(sections):
            if section.get("kind") not in allowed_sections:
                raise ValueError("Loại report section không hợp lệ.")
            conn.execute(report_sections.insert().values(
                id=_uuid(), report_version_id=version_id, position=position,
                kind=section["kind"], title=section.get("title"), content_json=section.get("content") or {},
            ))
        for position, item in enumerate(visualizations):
            chart_type = str(item.get("chart_type", ""))
            spec = item.get("visualization_spec") or {}
            if not isinstance(spec, dict):
                raise ValueError("visualization_spec phải là object.")
            self._validate_visualization_spec(chart_type, spec)
            execution = self._execution_for_workspace(conn, str(item.get("query_execution_id", "")), workspace_id)
            if not execution:
                raise LookupError("Evidence execution không thuộc workspace.")
            conn.execute(report_visualizations.insert().values(
                id=_uuid(), report_version_id=version_id, position=position, chart_type=chart_type,
                title=item.get("title"), visualization_spec=spec,
                query_execution_id=execution["id"], result_hash=execution["result_hash"],
                result_snapshot=execution["result"], created_at=_now(),
            ))

    def update_report_draft(self, report_id: str, workspace_id: str, actor_user_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            report = conn.execute(select(reports).where(
                reports.c.id == report_id, reports.c.workspace_id == workspace_id,
            )).mappings().first()
            if not report:
                return None
            version = conn.execute(select(report_versions).where(
                report_versions.c.report_id == report_id,
            ).order_by(report_versions.c.version.desc())).mappings().first()
            if not version or version["status"] not in {"draft", "changes_requested"}:
                raise ValueError("Chỉ có thể sửa report version draft hoặc changes_requested.")
            if version["created_by_user_id"] != actor_user_id:
                raise PermissionError("Chỉ tác giả mới có thể sửa draft này.")
            fields = {key: payload[key] for key in ("executive_summary", "scope", "time_range") if key in payload}
            if fields:
                conn.execute(report_versions.update().where(report_versions.c.id == version["id"]).values(**fields))
            self._replace_report_content(conn, version["id"], workspace_id, payload)
            conn.execute(reports.update().where(reports.c.id == report_id).values(
                title=payload.get("title", report["title"]), updated_at=_now(), status="draft",
            ))
        return self.get_report(report_id, workspace_id)

    def submit_report(self, report_id: str, workspace_id: str, actor_user_id: str) -> dict[str, Any] | None:
        now = _now()
        with self.engine.begin() as conn:
            report = conn.execute(select(reports).where(reports.c.id == report_id, reports.c.workspace_id == workspace_id)).mappings().first()
            if not report:
                return None
            version = conn.execute(select(report_versions).where(report_versions.c.report_id == report_id)
                .order_by(report_versions.c.version.desc())).mappings().first()
            if not version or version["status"] not in {"draft", "changes_requested"}:
                raise ValueError("Report không ở trạng thái có thể submit.")
            if version["created_by_user_id"] != actor_user_id:
                raise PermissionError("Chỉ tác giả mới có thể submit report.")
            conn.execute(report_versions.update().where(report_versions.c.id == version["id"]).values(
                status="in_review", submitted_by_user_id=actor_user_id, submitted_at=now,
            ))
            conn.execute(reports.update().where(reports.c.id == report_id).values(status="in_review", updated_at=now))
        return self.get_report(report_id, workspace_id)

    def review_report(self, report_id: str, workspace_id: str, reviewer_user_id: str, decision: str, comment: str | None, *, allow_admin_override: bool = False) -> dict[str, Any] | None:
        if decision not in {"approved", "changes_requested", "rejected"}:
            raise ValueError("Review decision không hợp lệ.")
        if allow_admin_override and not (comment or "").strip():
            raise ValueError("Admin override cần lý do được audit.")
        now = _now()
        with self.engine.begin() as conn:
            report = conn.execute(select(reports).where(reports.c.id == report_id, reports.c.workspace_id == workspace_id)).mappings().first()
            if not report:
                return None
            version = conn.execute(select(report_versions).where(report_versions.c.report_id == report_id)
                .order_by(report_versions.c.version.desc())).mappings().first()
            if not version or version["status"] != "in_review":
                raise ValueError("Report không ở trạng thái in_review.")
            if version["created_by_user_id"] == reviewer_user_id and not allow_admin_override:
                raise PermissionError("Không thể tự review report version do chính mình tạo.")
            conn.execute(report_reviews.insert().values(
                id=_uuid(), report_version_id=version["id"], reviewer_user_id=reviewer_user_id,
                decision=decision, comment=comment, created_at=now,
            ))
            next_report_status = "in_review" if decision == "approved" else "draft"
            conn.execute(report_versions.update().where(report_versions.c.id == version["id"]).values(
                status=decision, reviewed_by_user_id=reviewer_user_id, reviewed_at=now,
            ))
            conn.execute(reports.update().where(reports.c.id == report_id).values(status=next_report_status, updated_at=now))
        return self.get_report(report_id, workspace_id)

    def publish_report(self, report_id: str, workspace_id: str, actor_user_id: str, *, allow_admin_override: bool = False, reason: str | None = None) -> dict[str, Any] | None:
        if allow_admin_override and not (reason or "").strip():
            raise ValueError("Admin override cần lý do được audit.")
        now = _now()
        with self.engine.begin() as conn:
            report = conn.execute(select(reports).where(reports.c.id == report_id, reports.c.workspace_id == workspace_id)).mappings().first()
            if not report:
                return None
            version = conn.execute(select(report_versions).where(report_versions.c.report_id == report_id)
                .order_by(report_versions.c.version.desc())).mappings().first()
            if not version or version["status"] != "approved":
                raise ValueError("Chỉ report version approved mới được publish.")
            if version["created_by_user_id"] == actor_user_id and not allow_admin_override:
                raise PermissionError("Không thể tự publish report version do chính mình tạo.")
            conn.execute(report_versions.update().where(report_versions.c.id == version["id"]).values(
                status="published", published_by_user_id=actor_user_id, published_at=now,
            ))
            conn.execute(reports.update().where(reports.c.id == report_id).values(
                status="published", current_published_version_id=version["id"], updated_at=now,
            ))
        return self.get_report(report_id, workspace_id)

    def archive_report(self, report_id: str, workspace_id: str) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(reports.update().where(
                reports.c.id == report_id, reports.c.workspace_id == workspace_id,
            ).values(status="archived", updated_at=_now()))
            return bool(result.rowcount)


# --------------------------------------------------------------------------- #
_repo: Repository | None = None


def build_engine(settings: Settings | None = None) -> Engine:
    cfg = settings or get_settings()
    url = make_url(cfg.database_url)
    if url.get_backend_name() not in {"postgresql", "postgres"}:
        raise ValueError("P-170 chỉ hỗ trợ PostgreSQL.")
    return create_engine(url, future=True, pool_pre_ping=True)


def get_repository(settings: Settings | None = None) -> Repository:
    global _repo
    if _repo is None:
        cfg = settings or get_settings()
        _repo = Repository(build_engine(cfg), cfg)
    return _repo


def reset_repository() -> None:
    """Dùng trong test để buộc tạo lại engine sau khi đổi DATABASE_URL."""
    global _repo
    _repo = None


__all__ = [
    "PROPOSAL_TABLES",
    "Repository",
    "build_engine",
    "column_stats",
    "get_repository",
    "metadata",
    "reports",
    "reset_repository",
    "workspace_memberships",
    "workspaces",
]
