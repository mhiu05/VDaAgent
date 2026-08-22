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

# pyrefly: ignore [missing-import]
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    func,
    or_,
    select,
)
# pyrefly: ignore [missing-import]
from sqlalchemy.engine import Engine, make_url
from src.config import Settings, get_settings

metadata = MetaData()

ProposalKind = Literal["candidate_key", "semantic_type", "pii"]
ProposalStatus = Literal["pending", "confirmed", "rejected", "auto_confirmed"]


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(UTC)


def _normalise_email(email: str | None) -> str | None:
    """Keep an application-safe, canonical copy of the Auth email."""
    if not email:
        return None
    normalised = email.strip().casefold()
    return normalised or None


# Workspace identity is held beside the domain metadata. Browser clients have
# no grants to these tables; the API always applies a workspace predicate.
user_profiles = Table(
    "user_profiles",
    metadata,
    Column("user_id", String(36), primary_key=True),
    Column("email", String(320), nullable=True, index=True),
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

workspace_context_versions = Table(
    "workspace_context_versions",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=False,
        index=True,
    ),
    Column("version", Integer, nullable=False),
    Column("domain", String(120), nullable=True),
    Column("primary_goal", Text, nullable=True),
    Column("target_audience", String(120), nullable=True),
    Column("status", String(16), nullable=False, default="active"),
    Column("created_by_user_id", String(36), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    UniqueConstraint(
        "workspace_id",
        "version",
        name="uq_workspace_context_versions_workspace_version",
    ),
)

workspace_theme_versions = Table(
    "workspace_theme_versions",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=False,
        index=True,
    ),
    Column("version", Integer, nullable=False),
    Column("primary_color", String(7), nullable=False, default="#315EFB"),
    Column("secondary_color", String(7), nullable=False, default="#0F9D91"),
    Column("tone", String(32), nullable=False, default="professional"),
    Column("default_language", String(8), nullable=False, default="vi"),
    Column("status", String(16), nullable=False, default="active"),
    Column("created_by_user_id", String(36), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    UniqueConstraint(
        "workspace_id", "version", name="uq_workspace_theme_versions_workspace_version"
    ),
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
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=False,
        index=True,
    ),
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
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=False,
        index=True,
    ),
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
    # Immutable binary provenance captured at upload. Never expose this with a
    # local path; evidence uses the hash, not the mutable source reference.
    Column("content_sha256", String(64), nullable=True),
    Column("source_version", String(255), nullable=True),
    Column("collection_name", String(255), nullable=True, index=True),
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=True,
        index=True,
    ),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("last_profiled_at", DateTime(timezone=True), nullable=True),
)

profile_runs = Table(
    "profile_runs",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("dataset_id", String(32), ForeignKey("datasets.id"), nullable=False),
    Column("source_content_sha256", String(64), nullable=True),
    Column("source_version", String(255), nullable=True),
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=True,
        index=True,
    ),
    Column("version", Integer, nullable=False),
    Column("run_name", String(255), nullable=True),
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
        Column(
            "profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False
        ),
        Column("confidence_score", Float, nullable=False),
        Column("evidence", String(2048), nullable=True),
        Column("status", String(16), nullable=False, default="pending"),
        Column("confirmed_by", String(255), nullable=True),
        Column("confirmed_at", DateTime(timezone=True), nullable=True),
        Column("review_note", Text, nullable=True),
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
    Column("final_type", String(64), nullable=True),  # Analyst phân loại lại PII
    Column(
        "detection_method", String(32), nullable=False
    ),  # heuristic|regex|NER|LLM|manual
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
    Column(
        "profile_run_id_a", String(32), ForeignKey("profile_runs.id"), nullable=False
    ),
    Column(
        "profile_run_id_b", String(32), ForeignKey("profile_runs.id"), nullable=False
    ),
    Column("drift_columns", JSON, nullable=False),
    Column("summary", String(2048), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

# Analysis workspace is intentionally additive: a completed profile run remains
# the immutable technical snapshot, while an analysis session captures the
# business work performed against that snapshot.
analysis_sessions = Table(
    "analysis_sessions",
    metadata,
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
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=True,
        index=True,
    ),
    Column("graph_thread_id", String(255), nullable=False, unique=True),
    Column("version", Integer, nullable=False, default=1),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)
analysis_sources = Table(
    "analysis_sources",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "session_id",
        String(32),
        ForeignKey("analysis_sessions.id"),
        nullable=False,
        index=True,
    ),
    Column("dataset_id", String(32), ForeignKey("datasets.id"), nullable=False),
    Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=False),
    Column("alias", String(64), nullable=False, default="primary"),
    Column("role", String(32), nullable=False, default="primary"),
)
semantic_context_versions = Table(
    "semantic_context_versions",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "session_id",
        String(32),
        ForeignKey("analysis_sessions.id"),
        nullable=False,
        index=True,
    ),
    Column("version", Integer, nullable=False),
    Column("context", JSON, nullable=False),
    Column("status", String(16), nullable=False, default="draft"),
    Column("approved_by", String(255), nullable=True),
    Column("approved_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
quality_gate_runs = Table(
    "quality_gate_runs",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "session_id",
        String(32),
        ForeignKey("analysis_sessions.id"),
        nullable=False,
        index=True,
    ),
    Column(
        "context_version_id",
        String(32),
        ForeignKey("semantic_context_versions.id"),
        nullable=True,
    ),
    Column("decision", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
quality_issues = Table(
    "quality_issues",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "quality_gate_run_id",
        String(32),
        ForeignKey("quality_gate_runs.id"),
        nullable=False,
        index=True,
    ),
    Column("rule", String(64), nullable=False),
    Column("dimension", String(32), nullable=False),
    Column("severity", String(16), nullable=False),
    Column("message", Text, nullable=False),
    Column("evidence", JSON, nullable=True),
    Column("status", String(16), nullable=False, default="open"),
    Column("resolution_note", Text, nullable=True),
)
query_executions = Table(
    "query_executions",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "session_id",
        String(32),
        ForeignKey("analysis_sessions.id"),
        nullable=False,
        index=True,
    ),
    Column(
        "context_version_id",
        String(32),
        ForeignKey("semantic_context_versions.id"),
        nullable=False,
    ),
    Column("query_spec", JSON, nullable=False),
    Column("result", JSON, nullable=False),
    Column("result_hash", String(64), nullable=False),
    Column("is_approximate", Boolean, nullable=False, default=False),
    Column("limitations", JSON, nullable=True),
    Column("duration_ms", Integer, nullable=True),
    Column("execution_kind", String(16), nullable=False, default="official"),
    Column("status", String(16), nullable=False, default="ready"),
    Column(
        "quality_gate_run_id",
        String(32),
        ForeignKey("quality_gate_runs.id"),
        nullable=True,
    ),
    Column("requested_by_user_id", String(36), nullable=True),
    Column("expires_at", DateTime(timezone=True), nullable=True, index=True),
    Column("idempotency_key", String(255), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

# Notebook LLM is a durable, bounded working document.  Cells store prompts,
# markdown and sanitized Agent outputs; they never store raw dataset rows.
notebooks = Table(
    "notebooks",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=False,
        index=True,
    ),
    Column(
        "profile_run_id",
        String(32),
        ForeignKey("profile_runs.id"),
        nullable=False,
        index=True,
    ),
    Column("title", String(255), nullable=False),
    Column("description", Text, nullable=True),
    Column("visibility", String(16), nullable=False, default="private"),
    Column("status", String(16), nullable=False, default="active"),
    Column("created_by_user_id", String(36), nullable=False),
    Column("shared_by_user_id", String(36), nullable=True),
    Column("shared_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_notebooks_workspace_updated_at",
    notebooks.c.workspace_id,
    notebooks.c.updated_at,
)

notebook_cells = Table(
    "notebook_cells",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "notebook_id",
        String(32),
        ForeignKey("notebooks.id"),
        nullable=False,
        index=True,
    ),
    Column("position", Integer, nullable=False),
    Column("kind", String(16), nullable=False),  # markdown | prompt
    Column("title", String(255), nullable=True),
    Column("source", Text, nullable=False),
    Column("result", JSON, nullable=True),
    Column("status", String(16), nullable=False, default="draft"),
    Column("created_by_user_id", String(36), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_notebook_cells_notebook_position",
    notebook_cells.c.notebook_id,
    notebook_cells.c.position,
)
# Notebook persistence is retired. Excluding these historical declarations
# from active metadata prevents local bootstrap from recreating the tables.
metadata.remove(notebook_cells)
metadata.remove(notebooks)

retrieval_documents = Table(
    "retrieval_documents",
    metadata,
    Column("doc_id", String(255), primary_key=True),
    Column("text", Text, nullable=False),
    Column("document_metadata", JSON, nullable=True),
    # NULL is global external knowledge. Profile and published-report docs are
    # always tenant-scoped before candidate ranking.
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=True,
        index=True,
    ),
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
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=True,
        index=True,
    ),
    Column("actor_user_id", String(36), nullable=True, index=True),
    Column("resource_type", String(64), nullable=True),
    Column("resource_id", String(255), nullable=True),
    Column("outcome", String(32), nullable=True),
    Column("correlation_id", String(128), nullable=True),
    Column("fields", JSON, nullable=True),
)

# Agent runtime V2 is additive.  These records are deliberately separate from
# LangGraph checkpoints: an orchestration checkpoint is not an auditable run
# ledger and cannot safely serve as the source of truth for a resumed action.
agent_runs = Table(
    "agent_runs",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("actor_user_id", String(36), nullable=True),
    Column("run_type", String(32), nullable=False),
    Column("status", String(32), nullable=False, default="created"),
    Column("resource_bindings", JSON, nullable=False),
    Column("correlation_id", String(128), nullable=True),
    Column("idempotency_key", String(255), nullable=True),
    Column("request_hash", String(71), nullable=True),
    Column("runtime_version", String(64), nullable=False),
    Column("policy_version", String(64), nullable=False),
    Column("version_snapshot", JSON, nullable=False),
    Column("budget", JSON, nullable=False),
    Column("usage", JSON, nullable=False),
    Column("trace_sequence", Integer, nullable=False, default=0),
    Column("error_code", String(64), nullable=True),
    Column("error_summary", String(512), nullable=True),
    Column("started_at", DateTime(timezone=True), nullable=True),
    Column("ended_at", DateTime(timezone=True), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_agent_runs_workspace_created_at",
    agent_runs.c.workspace_id,
    agent_runs.c.created_at,
)
Index("ix_agent_runs_workspace_status", agent_runs.c.workspace_id, agent_runs.c.status)

agent_plans = Table(
    "agent_plans",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("plan_version", Integer, nullable=False),
    Column("schema_version", String(32), nullable=False),
    Column("plan_hash", String(71), nullable=False),
    Column("plan", JSON, nullable=False),
    Column("validation_status", String(32), nullable=False),
    Column("superseded_by_plan_id", String(32), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    UniqueConstraint("agent_run_id", "plan_version", name="uq_agent_plans_run_version"),
)
Index(
    "ix_agent_plans_workspace_created_at",
    agent_plans.c.workspace_id,
    agent_plans.c.created_at,
)

agent_steps = Table(
    "agent_steps",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("step_key", String(128), nullable=False),
    Column("ordinal", Integer, nullable=False, default=0),
    Column("step_type", String(32), nullable=False),
    Column("target_name", String(128), nullable=False),
    Column("target_version", String(64), nullable=True),
    Column("depends_on", JSON, nullable=False),
    Column("reason_code", String(64), nullable=True),
    Column("reason_summary", String(240), nullable=True),
    Column("approval_rule", String(64), nullable=True),
    Column("status", String(32), nullable=False, default="pending"),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
    UniqueConstraint("agent_run_id", "step_key", name="uq_agent_steps_run_key"),
)
Index(
    "ix_agent_steps_workspace_created_at",
    agent_steps.c.workspace_id,
    agent_steps.c.created_at,
)
Index("ix_agent_steps_run_status", agent_steps.c.agent_run_id, agent_steps.c.status)

agent_step_attempts = Table(
    "agent_step_attempts",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_step_id", String(32), ForeignKey("agent_steps.id"), nullable=False),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("attempt_number", Integer, nullable=False),
    Column("status", String(32), nullable=False),
    Column("input_hash", String(71), nullable=True),
    Column("output_hash", String(71), nullable=True),
    Column("retry_classification", String(64), nullable=True),
    Column("error_code", String(64), nullable=True),
    Column("error_summary", String(512), nullable=True),
    Column("checkpoint", JSON, nullable=True),
    Column("started_at", DateTime(timezone=True), nullable=False),
    Column("ended_at", DateTime(timezone=True), nullable=True),
    UniqueConstraint(
        "agent_step_id", "attempt_number", name="uq_agent_step_attempts_step_number"
    ),
)
Index(
    "ix_agent_step_attempts_workspace_started_at",
    agent_step_attempts.c.workspace_id,
    agent_step_attempts.c.started_at,
)

model_invocations = Table(
    "model_invocations",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column(
        "step_attempt_id",
        String(32),
        ForeignKey("agent_step_attempts.id"),
        nullable=True,
    ),
    Column("provider", String(64), nullable=False),
    Column("model_id", String(255), nullable=False),
    Column("parameters_hash", String(71), nullable=False),
    Column("prompt_id", String(128), nullable=True),
    Column("prompt_version", String(64), nullable=True),
    Column("prompt_hash", String(71), nullable=True),
    Column("request_hash", String(71), nullable=False),
    Column("response_hash", String(71), nullable=True),
    Column("input_tokens", Integer, nullable=True),
    Column("output_tokens", Integer, nullable=True),
    Column("estimated_cost", Float, nullable=True),
    Column("usage_status", String(32), nullable=False, default="unknown"),
    Column("latency_ms", Integer, nullable=True),
    Column("status", String(32), nullable=False),
    Column("error_code", String(64), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_model_invocations_workspace_created_at",
    model_invocations.c.workspace_id,
    model_invocations.c.created_at,
)

tool_invocations = Table(
    "tool_invocations",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column(
        "step_attempt_id",
        String(32),
        ForeignKey("agent_step_attempts.id"),
        nullable=True,
    ),
    Column("tool_name", String(128), nullable=False),
    Column("tool_version", String(64), nullable=True),
    Column("sanitized_args", JSON, nullable=False),
    Column("reason_code", String(64), nullable=True),
    Column("status", String(32), nullable=False),
    Column("timeout_ms", Integer, nullable=True),
    Column("attempt_number", Integer, nullable=False, default=1),
    Column("latency_ms", Integer, nullable=True),
    Column("result_hash", String(71), nullable=True),
    Column("error_code", String(64), nullable=True),
    Column("evidence_ids", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_tool_invocations_workspace_created_at",
    tool_invocations.c.workspace_id,
    tool_invocations.c.created_at,
)

evidence_items = Table(
    "evidence_items",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("profile_run_id", String(32), ForeignKey("profile_runs.id"), nullable=True),
    Column("context_version_id", String(32), nullable=True),
    Column(
        "execution_id", String(32), ForeignKey("query_executions.id"), nullable=True
    ),
    Column("artifact_type", String(64), nullable=False),
    Column("artifact_id", String(128), nullable=False),
    Column("field_path", String(512), nullable=False),
    Column("value", JSON, nullable=True),
    Column("unit", String(64), nullable=True),
    Column("is_approximate", Boolean, nullable=False, default=False),
    Column("limitations", JSON, nullable=False),
    Column("source_hash", String(71), nullable=False),
    Column("source_version", String(255), nullable=True),
    Column(
        "producer_invocation_id",
        String(32),
        ForeignKey("tool_invocations.id"),
        nullable=True,
    ),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_evidence_items_workspace_created_at",
    evidence_items.c.workspace_id,
    evidence_items.c.created_at,
)

verification_runs = Table(
    "verification_runs",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("answer_hash", String(71), nullable=False),
    Column("claim_hash", String(71), nullable=False),
    Column("verifier_version", String(64), nullable=False),
    Column("outcome", String(32), nullable=False),
    Column("violations", JSON, nullable=False),
    Column("recovery_decision", String(64), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_verification_runs_workspace_created_at",
    verification_runs.c.workspace_id,
    verification_runs.c.created_at,
)

approval_requests = Table(
    "approval_requests",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("plan_hash", String(71), nullable=False),
    Column("plan_version", Integer, nullable=False),
    Column("step_id", String(32), nullable=True),
    Column("capability_version", String(64), nullable=True),
    Column("context_version", String(64), nullable=True),
    Column("policy_version", String(64), nullable=False),
    Column("risk_level", String(32), nullable=False),
    Column("preview", JSON, nullable=False),
    Column("status", String(32), nullable=False),
    Column("approver_user_id", String(36), nullable=True),
    Column("decision_note", String(512), nullable=True),
    Column("expires_at", DateTime(timezone=True), nullable=True),
    Column("invalidation_reason", String(255), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)
Index(
    "ix_approval_requests_workspace_created_at",
    approval_requests.c.workspace_id,
    approval_requests.c.created_at,
)

agent_trace_events = Table(
    "agent_trace_events",
    metadata,
    Column("id", String(32), primary_key=True),
    Column("agent_run_id", String(32), ForeignKey("agent_runs.id"), nullable=False),
    Column("workspace_id", String(36), ForeignKey("workspaces.id"), nullable=False),
    Column("sequence", Integer, nullable=False),
    Column("event_type", String(64), nullable=False),
    Column("status", String(64), nullable=True),
    Column("reason_code", String(64), nullable=True),
    Column("reason_summary", String(240), nullable=True),
    Column("payload", JSON, nullable=False),
    Column("schema_version", String(32), nullable=False, default="1"),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    UniqueConstraint(
        "agent_run_id", "sequence", name="uq_agent_trace_events_run_sequence"
    ),
)
Index(
    "ix_agent_trace_events_workspace_created_at",
    agent_trace_events.c.workspace_id,
    agent_trace_events.c.created_at,
)

# A published report is a stable workspace artifact. It never points a member
# at mutable profiling pages or an arbitrary aggregate query.
reports = Table(
    "reports",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "workspace_id",
        String(36),
        ForeignKey("workspaces.id"),
        nullable=False,
        index=True,
    ),
    Column("title", String(255), nullable=False),
    Column("slug", String(160), nullable=False),
    Column("status", String(24), nullable=False, default="draft"),
    Column("created_by_user_id", String(36), nullable=False),
    Column(
        "profile_run_id",
        String(32),
        ForeignKey("profile_runs.id"),
        nullable=True,
        index=True,
    ),
    Column("current_published_version_id", String(32), nullable=True),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
)

report_versions = Table(
    "report_versions",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "report_id", String(32), ForeignKey("reports.id"), nullable=False, index=True
    ),
    Column("version", Integer, nullable=False),
    Column("status", String(24), nullable=False, default="draft"),
    Column("executive_summary", Text, nullable=True),
    Column("scope", JSON, nullable=True),
    Column("time_range", JSON, nullable=True),
    Column(
        "workspace_context_version_id",
        String(32),
        ForeignKey("workspace_context_versions.id"),
        nullable=True,
    ),
    Column(
        "workspace_theme_version_id",
        String(32),
        ForeignKey("workspace_theme_versions.id"),
        nullable=True,
    ),
    Column("snapshot_hash", String(64), nullable=True),
    Column("snapshot_at", DateTime(timezone=True), nullable=True),
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
    "report_sections",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "report_version_id",
        String(32),
        ForeignKey("report_versions.id"),
        nullable=False,
        index=True,
    ),
    Column("position", Integer, nullable=False),
    Column("kind", String(32), nullable=False),
    Column("title", String(255), nullable=True),
    Column("content_json", JSON, nullable=False),
)

report_items = Table(
    "report_items",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "report_version_id",
        String(32),
        ForeignKey("report_versions.id"),
        nullable=False,
        index=True,
    ),
    Column("item_type", String(32), nullable=False),
    Column("position", Integer, nullable=False),
    Column(
        "profile_run_id",
        String(32),
        ForeignKey("profile_runs.id"),
        nullable=True,
        index=True,
    ),
    Column(
        "context_version_id",
        String(32),
        ForeignKey("semantic_context_versions.id"),
        nullable=True,
        index=True,
    ),
    Column(
        "query_execution_id",
        String(32),
        ForeignKey("query_executions.id"),
        nullable=True,
        index=True,
    ),
    Column(
        "agent_run_id",
        String(32),
        ForeignKey("agent_runs.id"),
        nullable=True,
        index=True,
    ),
    Column("title", String(255), nullable=True),
    Column("note", Text, nullable=True),
    Column("content_json", JSON, nullable=True),
    Column("query_spec", JSON, nullable=True),
    Column("result_hash", String(64), nullable=True),
    Column("quality_status", String(32), nullable=True),
    Column("limitations", JSON, nullable=True),
    Column("export_policy", JSON, nullable=True),
    Column("idempotency_key", String(255), nullable=True),
    Column("created_by_user_id", String(36), nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
    Column("updated_at", DateTime(timezone=True), default=_now, nullable=False),
    UniqueConstraint(
        "report_version_id",
        "idempotency_key",
        name="uq_report_items_version_idempotency",
    ),
)
Index(
    "ix_report_items_version_position",
    report_items.c.report_version_id,
    report_items.c.position,
)

report_visualizations = Table(
    "report_visualizations",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "report_version_id",
        String(32),
        ForeignKey("report_versions.id"),
        nullable=False,
        index=True,
    ),
    Column("position", Integer, nullable=False),
    Column("chart_type", String(16), nullable=False),
    Column("title", String(255), nullable=True),
    Column("visualization_spec", JSON, nullable=False),
    Column(
        "query_execution_id",
        String(32),
        ForeignKey("query_executions.id"),
        nullable=False,
    ),
    Column("result_hash", String(64), nullable=False),
    Column("result_snapshot", JSON, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now, nullable=False),
)

report_reviews = Table(
    "report_reviews",
    metadata,
    Column("id", String(32), primary_key=True),
    Column(
        "report_version_id",
        String(32),
        ForeignKey("report_versions.id"),
        nullable=False,
        index=True,
    ),
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
            self._migrate_review_proposal_columns()
            self._migrate_tool_v2_profile_columns()
            self._migrate_workflow_columns()
            self._migrate_authz_columns()
        # Upload metadata is required by the current repository projection.
        # Keep this additive compatibility step for already-running production
        # databases whose release job has not applied the latest Alembic head.
        self._migrate_upload_provenance_columns()

    def _migrate_upload_provenance_columns(self) -> None:
        """Ensure upload provenance columns exist before dataset writes.

        These fields are nullable and additive, so the check is safe for both
        legacy production databases and fresh local/test databases. Without
        it, Google Drive upload succeeds and the subsequent metadata insert
        fails because SQLAlchemy includes the new nullable columns.
        """
        # pyrefly: ignore [missing-import]
        from sqlalchemy import text

        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE datasets "
                    "ADD COLUMN IF NOT EXISTS content_sha256 VARCHAR(64)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE datasets "
                    "ADD COLUMN IF NOT EXISTS source_version VARCHAR(255)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE datasets "
                    "ADD COLUMN IF NOT EXISTS collection_name VARCHAR(255)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_datasets_collection_name "
                    "ON datasets (collection_name)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE profile_runs "
                    "ADD COLUMN IF NOT EXISTS source_content_sha256 VARCHAR(64)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE profile_runs "
                    "ADD COLUMN IF NOT EXISTS source_version VARCHAR(255)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE profile_runs "
                    "ADD COLUMN IF NOT EXISTS run_name VARCHAR(255)"
                )
            )

    def _migrate_semantic_description(self) -> None:
        """Bổ sung cột mô tả cho các metadata DB đã tồn tại từ phiên bản trước."""
        # pyrefly: ignore [missing-import]
        from sqlalchemy import inspect, text

        columns = {
            item["name"]
            for item in inspect(self.engine).get_columns("semantic_type_proposals")
        }
        if "semantic_description" not in columns:
            with self.engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE semantic_type_proposals ADD COLUMN semantic_description VARCHAR(512)"
                    )
                )

    def _migrate_review_proposal_columns(self) -> None:
        """Bổ sung dữ liệu quyết định review cho các DB local đã tồn tại."""
        # pyrefly: ignore [missing-import]
        from sqlalchemy import inspect, text

        additions = {
            "candidate_key_proposals": {"review_note": "TEXT"},
            "semantic_type_proposals": {"review_note": "TEXT"},
            "pii_proposals": {"final_type": "VARCHAR(64)", "review_note": "TEXT"},
        }
        with self.engine.begin() as conn:
            inspector = inspect(self.engine)
            for table_name, columns_to_add in additions.items():
                columns = {item["name"] for item in inspector.get_columns(table_name)}
                for column_name, sql_type in columns_to_add.items():
                    if column_name not in columns:
                        conn.execute(
                            text(
                                f"ALTER TABLE {table_name} "
                                f"ADD COLUMN {column_name} {sql_type}"
                            )
                        )

    def _migrate_tool_v2_profile_columns(self) -> None:
        """Add aggregate Tool V2 artifacts to existing PostgreSQL databases."""
        # pyrefly: ignore [missing-import]
        from sqlalchemy import inspect, text

        columns = {
            item["name"] for item in inspect(self.engine).get_columns("profile_runs")
        }
        additions = {
            "duplicate_row_count": "INTEGER",
            "duplicate_row_rate": "FLOAT",
        }
        with self.engine.begin() as conn:
            for name, sql_type in additions.items():
                if name not in columns:
                    conn.execute(
                        text(f"ALTER TABLE profile_runs ADD COLUMN {name} {sql_type}")
                    )

    def _migrate_workflow_columns(self) -> None:
        """Add durable execution identity and terminal continuation fields."""
        # pyrefly: ignore [missing-import]
        from sqlalchemy import inspect, text

        columns = {
            item["name"] for item in inspect(self.engine).get_columns("profile_runs")
        }
        additions = {
            "graph_thread_id": "VARCHAR(255)",
            "initial_question": "VARCHAR(2000)",
            "source_content_sha256": "VARCHAR(64)",
            "source_version": "VARCHAR(255)",
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
                    conn.execute(
                        text(f"ALTER TABLE profile_runs ADD COLUMN {name} {sql_type}")
                    )
            if "graph_thread_id" not in columns:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_runs_graph_thread_id "
                        "ON profile_runs (graph_thread_id)"
                    )
                )

    def _migrate_authz_columns(self) -> None:
        """Add only nullable tenant/audit fields for legacy local databases.

        PostgreSQL production receives the equivalent, stricter migration from
        Alembic.  This compatibility path intentionally does not enforce the
        final NOT NULL constraints before `backfill_authz.py` has run.
        """
        # pyrefly: ignore [missing-import]
        from sqlalchemy import inspect, text

        additions: dict[str, dict[str, str]] = {
            "datasets": {"workspace_id": "VARCHAR(36)"},
            "profile_runs": {"workspace_id": "VARCHAR(36)"},
            "analysis_sessions": {"workspace_id": "VARCHAR(36)"},
            "notebooks": {"workspace_id": "VARCHAR(36)"},
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
                        conn.execute(
                            text(
                                f"ALTER TABLE {table_name} ADD COLUMN {name} {sql_type}"
                            )
                        )
            # Local/test databases may still contain the legacy role from a
            # previous authz schema. Keep them aligned with production.
            conn.execute(
                workspace_memberships.update()
                .where(workspace_memberships.c.role.in_(["owner", "admin", "viewer"]))
                .values(role="analyst")
            )

    # --- Agent runtime -------------------------------------------------- #
    # These methods are kept in the domain repository so a state transition
    # and its trace event share one database transaction.  Callers must pass a
    # workspace ID even when a run ID is known; that is the tenant boundary.
    def _append_agent_trace(
        self,
        conn: Any,
        *,
        agent_run_id: str,
        workspace_id: str,
        event_type: str,
        status: str | None = None,
        reason_code: str | None = None,
        reason_summary: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        sequence = conn.execute(
            agent_runs.update()
            .where(
                agent_runs.c.id == agent_run_id,
                agent_runs.c.workspace_id == workspace_id,
            )
            .values(trace_sequence=agent_runs.c.trace_sequence + 1, updated_at=_now())
            .returning(agent_runs.c.trace_sequence)
        ).scalar_one_or_none()
        if sequence is None:
            raise LookupError("Agent run không thuộc workspace.")
        event = {
            "id": _uuid(),
            "agent_run_id": agent_run_id,
            "workspace_id": workspace_id,
            "sequence": int(sequence),
            "event_type": event_type,
            "status": status,
            "reason_code": reason_code,
            "reason_summary": reason_summary,
            "payload": payload or {},
            "schema_version": "1",
            "created_at": _now(),
        }
        conn.execute(agent_trace_events.insert().values(**event))
        return event

    def create_agent_run(
        self,
        *,
        workspace_id: str,
        actor_user_id: str,
        run_type: str,
        resource_bindings: dict[str, str],
        version_snapshot: dict[str, Any],
        budget: dict[str, Any] | None = None,
        correlation_id: str | None = None,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ) -> str:
        run_id = _uuid()
        now = _now()
        runtime_version = str(version_snapshot.get("runtime_version") or "2.0.0")
        policy_version = str(
            version_snapshot.get("policy_version") or "agent-policy-v1"
        )
        with self.engine.begin() as conn:
            conn.execute(
                agent_runs.insert().values(
                    id=run_id,
                    workspace_id=workspace_id,
                    actor_user_id=actor_user_id,
                    run_type=run_type,
                    status="running",
                    resource_bindings=resource_bindings,
                    correlation_id=correlation_id,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    runtime_version=runtime_version,
                    policy_version=policy_version,
                    version_snapshot=version_snapshot,
                    budget=budget or {},
                    usage={},
                    trace_sequence=0,
                    started_at=now,
                    created_at=now,
                    updated_at=now,
                )
            )
            self._append_agent_trace(
                conn,
                agent_run_id=run_id,
                workspace_id=workspace_id,
                event_type="run",
                status="running",
                reason_code="run_started",
                reason_summary="Đã bắt đầu workflow đã được server scope.",
                payload={"run_type": run_type, "resource_bindings": resource_bindings},
            )
        return run_id

    def append_agent_trace(
        self,
        agent_run_id: str,
        *,
        workspace_id: str,
        event_type: str,
        status: str | None = None,
        reason_code: str | None = None,
        reason_summary: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self.engine.begin() as conn:
            return self._append_agent_trace(
                conn,
                agent_run_id=agent_run_id,
                workspace_id=workspace_id,
                event_type=event_type,
                status=status,
                reason_code=reason_code,
                reason_summary=reason_summary,
                payload=payload,
            )

    def transition_agent_run(
        self,
        agent_run_id: str,
        *,
        workspace_id: str,
        status: str,
        reason_code: str,
        reason_summary: str,
        error_code: str | None = None,
        usage: dict[str, Any] | None = None,
    ) -> bool:
        terminal = status in {"completed", "failed", "cancelled", "rejected"}
        values: dict[str, Any] = {
            "status": status,
            "error_code": error_code,
            "error_summary": reason_summary if error_code else None,
            "updated_at": _now(),
        }
        if terminal:
            values["ended_at"] = _now()
        if usage is not None:
            values["usage"] = usage
        with self.engine.begin() as conn:
            updated = conn.execute(
                agent_runs.update()
                .where(
                    agent_runs.c.id == agent_run_id,
                    agent_runs.c.workspace_id == workspace_id,
                )
                .values(**values)
            )
            if not updated.rowcount:
                return False
            self._append_agent_trace(
                conn,
                agent_run_id=agent_run_id,
                workspace_id=workspace_id,
                event_type="run",
                status=status,
                reason_code=reason_code,
                reason_summary=reason_summary,
                payload={"usage": usage or {}},
            )
        return True

    def get_agent_run(
        self, agent_run_id: str, *, workspace_id: str
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(agent_runs).where(
                        agent_runs.c.id == agent_run_id,
                        agent_runs.c.workspace_id == workspace_id,
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def list_agent_trace_events(
        self,
        agent_run_id: str,
        *,
        workspace_id: str,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(agent_trace_events)
                .where(
                    agent_trace_events.c.agent_run_id == agent_run_id,
                    agent_trace_events.c.workspace_id == workspace_id,
                    agent_trace_events.c.sequence > max(0, after_sequence),
                )
                .order_by(agent_trace_events.c.sequence)
                .limit(max(1, min(limit, 2_000)))
            ).mappings()
            return [dict(row) for row in rows]

    def agent_trace_summary(
        self, agent_run_id: str, *, workspace_id: str
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(agent_runs.c.status, agent_runs.c.trace_sequence).where(
                        agent_runs.c.id == agent_run_id,
                        agent_runs.c.workspace_id == workspace_id,
                    )
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            status = str(row["status"])
            return {
                "event_count": int(row["trace_sequence"] or 0),
                "latest_sequence": int(row["trace_sequence"] or 0),
                "terminal": status in {"completed", "failed", "cancelled", "rejected"},
                "status": status,
            }

    def list_agent_evidence(
        self, agent_run_id: str, *, workspace_id: str
    ) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(evidence_items)
                .where(
                    evidence_items.c.agent_run_id == agent_run_id,
                    evidence_items.c.workspace_id == workspace_id,
                )
                .order_by(evidence_items.c.created_at, evidence_items.c.id)
            ).mappings()
            return [dict(row) for row in rows]

    def get_agent_plan(
        self, agent_run_id: str, *, workspace_id: str
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(agent_plans)
                    .where(
                        agent_plans.c.agent_run_id == agent_run_id,
                        agent_plans.c.workspace_id == workspace_id,
                    )
                    .order_by(agent_plans.c.plan_version.desc())
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def begin_agent_step(
        self,
        agent_run_id: str,
        *,
        workspace_id: str,
        step_key: str,
        ordinal: int,
        step_type: str = "node",
        target_version: str | None = "1",
        reason_code: str = "dependency_ready",
        reason_summary: str = "Bước workflow đã sẵn sàng chạy.",
        input_hash: str | None = None,
    ) -> tuple[str, str]:
        now = _now()
        with self.engine.begin() as conn:
            step = (
                conn.execute(
                    select(agent_steps).where(
                        agent_steps.c.agent_run_id == agent_run_id,
                        agent_steps.c.workspace_id == workspace_id,
                        agent_steps.c.step_key == step_key,
                    )
                )
                .mappings()
                .first()
            )
            if step:
                step_id = str(step["id"])
                conn.execute(
                    agent_steps.update()
                    .where(agent_steps.c.id == step_id)
                    .values(
                        status="running",
                        updated_at=now,
                    )
                )
            else:
                step_id = _uuid()
                conn.execute(
                    agent_steps.insert().values(
                        id=step_id,
                        agent_run_id=agent_run_id,
                        workspace_id=workspace_id,
                        step_key=step_key,
                        ordinal=ordinal,
                        step_type=step_type,
                        target_name=step_key,
                        target_version=target_version,
                        depends_on=[],
                        reason_code=reason_code,
                        reason_summary=reason_summary,
                        approval_rule="auto_read_only",
                        status="running",
                        created_at=now,
                        updated_at=now,
                    )
                )
            attempt_number = (
                int(
                    conn.execute(
                        select(
                            func.coalesce(
                                func.max(agent_step_attempts.c.attempt_number), 0
                            )
                        ).where(agent_step_attempts.c.agent_step_id == step_id)
                    ).scalar()
                    or 0
                )
                + 1
            )
            attempt_id = _uuid()
            conn.execute(
                agent_step_attempts.insert().values(
                    id=attempt_id,
                    agent_step_id=step_id,
                    agent_run_id=agent_run_id,
                    workspace_id=workspace_id,
                    attempt_number=attempt_number,
                    status="running",
                    input_hash=input_hash,
                    started_at=now,
                )
            )
            self._append_agent_trace(
                conn,
                agent_run_id=agent_run_id,
                workspace_id=workspace_id,
                event_type="step",
                status="running",
                reason_code=reason_code,
                reason_summary=reason_summary,
                payload={"step_key": step_key, "attempt": attempt_number},
            )
        return step_id, attempt_id

    def finish_agent_step(
        self,
        attempt_id: str,
        *,
        workspace_id: str,
        status: str,
        output_hash: str | None = None,
        error_code: str | None = None,
        error_summary: str | None = None,
    ) -> bool:
        now = _now()
        with self.engine.begin() as conn:
            attempt = (
                conn.execute(
                    select(agent_step_attempts).where(
                        agent_step_attempts.c.id == attempt_id,
                        agent_step_attempts.c.workspace_id == workspace_id,
                    )
                )
                .mappings()
                .first()
            )
            if not attempt:
                return False
            conn.execute(
                agent_step_attempts.update()
                .where(agent_step_attempts.c.id == attempt_id)
                .values(
                    status=status,
                    output_hash=output_hash,
                    error_code=error_code,
                    error_summary=error_summary,
                    ended_at=now,
                )
            )
            conn.execute(
                agent_steps.update()
                .where(agent_steps.c.id == attempt["agent_step_id"])
                .values(
                    status=status,
                    updated_at=now,
                )
            )
            self._append_agent_trace(
                conn,
                agent_run_id=str(attempt["agent_run_id"]),
                workspace_id=workspace_id,
                event_type="step",
                status=status,
                reason_code="step_completed"
                if status == "succeeded"
                else "step_failed",
                reason_summary=(
                    "Bước workflow đã hoàn thành."
                    if status == "succeeded"
                    else (error_summary or "Bước workflow không hoàn thành.")
                )[:240],
                payload={"attempt_id": attempt_id, "error_code": error_code},
            )
        return True

    def record_model_invocation(self, payload: dict[str, Any]) -> str:
        invocation_id = _uuid()
        with self.engine.begin() as conn:
            conn.execute(model_invocations.insert().values(id=invocation_id, **payload))
            self._append_agent_trace(
                conn,
                agent_run_id=str(payload["agent_run_id"]),
                workspace_id=str(payload["workspace_id"]),
                event_type="model",
                status=str(payload.get("status") or "completed"),
                reason_code="model_invocation",
                reason_summary="Đã gọi model với prompt version đã hash.",
                payload={
                    "provider": payload.get("provider"),
                    "model_id": payload.get("model_id"),
                    "prompt_id": payload.get("prompt_id"),
                    "latency_ms": payload.get("latency_ms"),
                    "usage_status": payload.get("usage_status"),
                },
            )
        return invocation_id

    def record_tool_invocation(
        self,
        payload: dict[str, Any],
        evidence: list[dict[str, Any]],
    ) -> str:
        invocation_id = _uuid()
        with self.engine.begin() as conn:
            evidence_ids = [str(item["id"]) for item in evidence]
            conn.execute(
                tool_invocations.insert().values(
                    id=invocation_id,
                    **{**payload, "evidence_ids": evidence_ids},
                )
            )
            for item in evidence:
                conn.execute(
                    evidence_items.insert().values(
                        **{**item, "producer_invocation_id": invocation_id},
                    )
                )
            self._append_agent_trace(
                conn,
                agent_run_id=str(payload["agent_run_id"]),
                workspace_id=str(payload["workspace_id"]),
                event_type="tool",
                status=str(payload.get("status") or "completed"),
                reason_code=str(payload.get("reason_code") or "metric_required"),
                reason_summary="Đã chạy capability read-only với input đã sanitize.",
                payload={
                    "tool_name": payload.get("tool_name"),
                    "latency_ms": payload.get("latency_ms"),
                    "error_code": payload.get("error_code"),
                    "evidence_count": len(evidence_ids),
                },
            )
        return invocation_id

    # --- Identity / tenant ------------------------------------------------ #
    @staticmethod
    def _legacy_workspace_id() -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, "p170:legacy-workspace"))

    def _sync_user_profile(
        self, conn: Any, user_id: str, email: str | None, now: datetime
    ) -> None:
        """Create a local identity record or refresh its canonical email."""
        normalised_email = _normalise_email(email)
        profile = (
            conn.execute(
                select(user_profiles.c.user_id, user_profiles.c.email).where(
                    user_profiles.c.user_id == user_id
                )
            )
            .mappings()
            .first()
        )
        if not profile:
            conn.execute(
                user_profiles.insert().values(
                    user_id=user_id,
                    email=normalised_email,
                    created_at=now,
                    updated_at=now,
                )
            )
            return
        if normalised_email and profile["email"] != normalised_email:
            conn.execute(
                user_profiles.update()
                .where(user_profiles.c.user_id == user_id)
                .values(email=normalised_email, updated_at=now)
            )

    def sync_user_profile(self, user_id: str, email: str | None) -> None:
        """Synchronise the signed-in user's public identity from Auth."""
        with self.engine.begin() as conn:
            self._sync_user_profile(conn, user_id, email, _now())

    def ensure_bootstrap_workspace(self, bootstrap_user_id: str) -> str:
        """Create the one deterministic legacy workspace/membership if needed."""
        workspace_id = self._legacy_workspace_id()
        now = _now()
        with self.engine.begin() as conn:
            exists = conn.execute(
                select(workspaces.c.id).where(workspaces.c.id == workspace_id)
            ).first()
            if not exists:
                conn.execute(
                    workspaces.insert().values(
                        id=workspace_id,
                        name="Legacy workspace",
                        slug="legacy",
                        created_by_user_id=bootstrap_user_id,
                        status="active",
                        settings={"report_separation_of_duties": True},
                        created_at=now,
                        updated_at=now,
                    )
                )
            self._sync_user_profile(conn, bootstrap_user_id, None, now)
            membership = conn.execute(
                select(workspace_memberships.c.user_id).where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == bootstrap_user_id,
                )
            ).first()
            if not membership:
                conn.execute(
                    workspace_memberships.insert().values(
                        workspace_id=workspace_id,
                        user_id=bootstrap_user_id,
                        role="analyst",
                        status="active",
                        created_at=now,
                        updated_at=now,
                    )
                )
        return workspace_id

    def ensure_guest_workspace(self, guest_user_id: str, role: str) -> str:
        """Create the isolated, non-personal workspace used by one trial tab."""
        if role != "analyst":
            raise ValueError("Chỉ hỗ trợ role Analyst.")
        workspace_id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"p170:guest-workspace:{guest_user_id}")
        )
        now = _now()
        with self.engine.begin() as conn:
            exists = conn.execute(
                select(workspaces.c.id).where(workspaces.c.id == workspace_id)
            ).first()
            if not exists:
                conn.execute(
                    workspaces.insert().values(
                        id=workspace_id,
                        name="VDaAgent Trial Workspace",
                        slug=f"guest-{workspace_id.replace('-', '')[:20]}",
                        created_by_user_id=guest_user_id,
                        status="active",
                        settings={"guest": True, "report_separation_of_duties": True},
                        created_at=now,
                        updated_at=now,
                    )
                )
            membership = conn.execute(
                select(workspace_memberships.c.user_id).where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == guest_user_id,
                )
            ).first()
            if not membership:
                conn.execute(
                    workspace_memberships.insert().values(
                        workspace_id=workspace_id,
                        user_id=guest_user_id,
                        role=role,
                        status="active",
                        created_at=now,
                        updated_at=now,
                    )
                )
            else:
                conn.execute(
                    workspace_memberships.update()
                    .where(
                        workspace_memberships.c.workspace_id == workspace_id,
                        workspace_memberships.c.user_id == guest_user_id,
                    )
                    .values(role=role, updated_at=now)
                )
        return workspace_id

    def purge_guest_workspace(self, guest_user_id: str) -> bool:
        """Remove trial data and identity rows; never touches Supabase users."""
        with self.engine.begin() as conn:
            workspace_ids = [
                row[0]
                for row in conn.execute(
                    select(workspaces.c.id).where(
                        workspaces.c.created_by_user_id == guest_user_id,
                        workspaces.c.settings.isnot(None),
                    )
                ).all()
            ]
            guest_workspace_ids = []
            for workspace_id in workspace_ids:
                row = conn.execute(
                    select(workspaces.c.settings).where(workspaces.c.id == workspace_id)
                ).first()
                if row and isinstance(row[0], dict) and row[0].get("guest"):
                    guest_workspace_ids.append(workspace_id)
            for workspace_id in guest_workspace_ids:
                source_refs = [
                    row[0]
                    for row in conn.execute(
                        select(datasets.c.source_ref).where(
                            datasets.c.workspace_id == workspace_id
                        )
                    ).all()
                ]
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
                            ref_workspace_id, file_id, _ = parse_google_drive_ref(
                                str(source_ref)
                            )
                            if ref_workspace_id == workspace_id:
                                GoogleDriveStorage(self.settings).remove(
                                    workspace_id, file_id
                                )
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
                        conn.execute(
                            table.delete().where(table.c.workspace_id == workspace_id)
                        )
                conn.execute(workspaces.delete().where(workspaces.c.id == workspace_id))
            conn.execute(
                user_profiles.delete().where(user_profiles.c.user_id == guest_user_id)
            )
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
            if isinstance(workspace_settings, dict)
            and workspace_settings.get("guest")
            and user_id
        }
        return sum(
            1 for user_id in guest_user_ids if self.purge_guest_workspace(user_id)
        )

    def provision_self_signup_workspace(
        self, user_id: str, email: str | None, role: str
    ) -> dict[str, Any]:
        """Create or return the personal workspace for a self-signing-up user."""
        if role != "analyst":
            raise ValueError("Chỉ hỗ trợ role Analyst.")
        now = _now()
        with self.engine.begin() as conn:
            # Do this before the idempotent early return so a returning user
            # still has an email available to workspace collaborators.
            self._sync_user_profile(conn, user_id, email, now)
            candidates = (
                conn.execute(
                    select(
                        workspaces,
                        workspace_memberships.c.role.label("membership_role"),
                    )
                    .join(
                        workspace_memberships,
                        workspace_memberships.c.workspace_id == workspaces.c.id,
                    )
                    .where(
                        workspace_memberships.c.user_id == user_id,
                        workspace_memberships.c.status == "active",
                        workspaces.c.created_by_user_id == user_id,
                    )
                    .order_by(workspaces.c.created_at)
                )
                .mappings()
                .all()
            )
            for existing in candidates:
                workspace_settings = existing.get("settings") or {}
                if isinstance(workspace_settings, dict) and workspace_settings.get(
                    "self_signup"
                ):
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
            conn.execute(
                workspaces.insert().values(
                    id=workspace_id,
                    name=workspace_name,
                    slug=slug,
                    created_by_user_id=user_id,
                    status="active",
                    settings={"self_signup": True, "report_separation_of_duties": True},
                    created_at=now,
                    updated_at=now,
                )
            )
            conn.execute(
                workspace_memberships.insert().values(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    role=role,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
            )
            return {
                "workspace_id": workspace_id,
                "workspace_name": workspace_name,
                "workspace_slug": slug,
                "role": role,
                "created": True,
            }

    def get_workspace(self, workspace_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = (
                conn.execute(select(workspaces).where(workspaces.c.id == workspace_id))
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def create_workspace(self, user_id: str, name: str, role: str) -> dict[str, Any]:
        """Create a project workspace owned by the current user."""
        workspace_id = str(uuid.uuid4())
        slug_base = "".join(
            char.lower() if char.isalnum() else "-" for char in name
        ).strip("-")[:80]
        slug = f"{slug_base or 'workspace'}-{workspace_id.replace('-', '')[:12]}"
        now = _now()
        with self.engine.begin() as conn:
            self._sync_user_profile(conn, user_id, None, now)
            conn.execute(
                workspaces.insert().values(
                    id=workspace_id,
                    name=name,
                    slug=slug,
                    created_by_user_id=user_id,
                    status="active",
                    settings={
                        "project_workspace": True,
                        "report_separation_of_duties": True,
                    },
                    created_at=now,
                    updated_at=now,
                )
            )
            conn.execute(
                workspace_memberships.insert().values(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    role=role,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
            )
        return {
            "id": workspace_id,
            "name": name,
            "slug": slug,
            "role": role,
            "status": "active",
            "created_by_user_id": user_id,
            "is_project": True,
        }

    def delete_workspace(self, workspace_id: str, actor_user_id: str) -> bool:
        """Archive a project workspace without physically deleting its data.

        Memberships intentionally stay active while a workspace is archived.
        This preserves the authorization trail and lets an authorized member
        restore the workspace later without recreating access records.
        """
        with self.engine.begin() as conn:
            workspace = (
                conn.execute(select(workspaces).where(workspaces.c.id == workspace_id))
                .mappings()
                .first()
            )
            if not workspace or workspace["status"] != "active":
                return False
            settings = workspace.get("settings") or {}
            if not isinstance(settings, dict) or not settings.get("project_workspace"):
                raise ValueError("Chỉ workspace dự án mới có thể xóa.")
            target_membership = conn.execute(
                select(workspace_memberships.c.role).where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == actor_user_id,
                    workspace_memberships.c.status == "active",
                )
            ).scalar_one_or_none()
            if target_membership is None:
                raise PermissionError("Bạn không có membership trong workspace này.")
            if workspace["created_by_user_id"] != actor_user_id:
                raise PermissionError(
                    "Chỉ người tạo workspace mới có thể xóa workspace này."
                )
            actor_active_workspace_count = conn.execute(
                select(func.count())
                .select_from(
                    workspaces.join(
                        workspace_memberships,
                        workspace_memberships.c.workspace_id == workspaces.c.id,
                    )
                )
                .where(
                    workspace_memberships.c.user_id == actor_user_id,
                    workspace_memberships.c.status == "active",
                    workspaces.c.status == "active",
                )
            ).scalar()
            if int(actor_active_workspace_count or 0) <= 1:
                raise ValueError(
                    "Cannot archive the last active workspace. Create or open another workspace first."
                )
            now = _now()
            conn.execute(
                workspaces.update()
                .where(workspaces.c.id == workspace_id)
                .values(status="archived", updated_at=now)
            )
            return True

    def restore_workspace(self, workspace_id: str, actor_user_id: str) -> bool:
        """Restore an archived project workspace for an authorized member."""
        with self.engine.begin() as conn:
            workspace = (
                conn.execute(select(workspaces).where(workspaces.c.id == workspace_id))
                .mappings()
                .first()
            )
            if not workspace or workspace["status"] != "archived":
                return False
            settings = workspace.get("settings") or {}
            if not isinstance(settings, dict) or not settings.get("project_workspace"):
                raise ValueError("Chỉ workspace dự án mới có thể khôi phục.")
            membership = conn.execute(
                select(workspace_memberships.c.role).where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == actor_user_id,
                    workspace_memberships.c.status == "active",
                )
            ).scalar_one_or_none()
            if membership is None:
                raise PermissionError("Bạn không còn quyền khôi phục workspace này.")
            if workspace["created_by_user_id"] != actor_user_id:
                raise PermissionError(
                    "Chỉ người tạo workspace mới có thể khôi phục workspace này."
                )
            conn.execute(
                workspaces.update()
                .where(workspaces.c.id == workspace_id)
                .values(status="active", updated_at=_now())
            )
            return True

    def purge_workspace(self, workspace_id: str, actor_user_id: str) -> bool:
        """Permanently delete a project workspace and its owned resources.

        The workspace creator can purge a project workspace with active
        membership. Storage objects are removed on a best-effort basis before
        the metadata rows are deleted; an already-missing object must not block
        the database cleanup.
        """
        with self.engine.begin() as conn:
            workspace = (
                conn.execute(select(workspaces).where(workspaces.c.id == workspace_id))
                .mappings()
                .first()
            )
            if not workspace or workspace["status"] not in {"active", "archived"}:
                return False
            settings = workspace.get("settings") or {}
            if not isinstance(settings, dict) or not settings.get("project_workspace"):
                raise ValueError("Chỉ workspace dự án mới có thể xóa.")

            target_membership = conn.execute(
                select(workspace_memberships.c.role).where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.user_id == actor_user_id,
                    workspace_memberships.c.status == "active",
                )
            ).scalar_one_or_none()
            if target_membership is None:
                raise PermissionError("Bạn không có membership trong workspace này.")
            if workspace["created_by_user_id"] != actor_user_id:
                raise PermissionError(
                    "Chỉ người tạo workspace mới có thể xóa workspace này."
                )

            source_refs = [
                row[0]
                for row in conn.execute(
                    select(datasets.c.source_ref).where(
                        datasets.c.workspace_id == workspace_id
                    )
                ).all()
            ]
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
                        ref_workspace_id, file_id, _ = parse_google_drive_ref(
                            str(source_ref)
                        )
                        if ref_workspace_id == workspace_id:
                            GoogleDriveStorage(self.settings).remove(
                                workspace_id, file_id
                            )
                    else:
                        source_path = Path(str(source_ref))
                        upload_root = self.settings.upload_path.resolve()
                        source_path.resolve().relative_to(upload_root)
                        source_path.unlink(missing_ok=True)
                except Exception:  # noqa: BLE001, S110
                    # Metadata cleanup must not be blocked by an already
                    # missing object or a temporary Storage outage.
                    pass

            # Resolve all rows owned by this workspace before deleting any
            # parent rows. This covers both directly scoped tables and child
            # tables that only reference a dataset, profile, run, report, or
            # notebook through a foreign key.
            affected_ids: dict[str, set[Any]] = {workspaces.name: {workspace_id}}
            for table in metadata.sorted_tables:
                if table is workspaces:
                    continue
                predicates = []
                if "workspace_id" in table.c:
                    predicates.append(table.c.workspace_id == workspace_id)
                for foreign_key in table.foreign_keys:
                    parent_ids = affected_ids.get(foreign_key.column.table.name)
                    if parent_ids:
                        predicates.append(foreign_key.parent.in_(parent_ids))
                primary_key = list(table.primary_key.columns)
                if not predicates or len(primary_key) != 1:
                    continue
                condition = predicates[0] if len(predicates) == 1 else or_(*predicates)
                values = (
                    conn.execute(select(primary_key[0]).where(condition))
                    .scalars()
                    .all()
                )
                if values:
                    affected_ids.setdefault(table.name, set()).update(values)

            # Break the only self-reference before removing agent plans and
            # clear the report pointer before removing report versions.
            if "agent_plans" in metadata.tables:
                conn.execute(
                    agent_plans.update()
                    .where(agent_plans.c.workspace_id == workspace_id)
                    .values(superseded_by_plan_id=None)
                )
            if (
                "reports" in metadata.tables
                and "current_published_version_id" in reports.c
            ):
                conn.execute(
                    reports.update()
                    .where(reports.c.workspace_id == workspace_id)
                    .values(current_published_version_id=None)
                )

            for table in reversed(metadata.sorted_tables):
                predicates = []
                if table is workspaces:
                    predicates.append(workspaces.c.id == workspace_id)
                elif "workspace_id" in table.c:
                    predicates.append(table.c.workspace_id == workspace_id)
                for foreign_key in table.foreign_keys:
                    parent_ids = affected_ids.get(foreign_key.column.table.name)
                    if parent_ids:
                        predicates.append(foreign_key.parent.in_(parent_ids))
                if predicates:
                    condition = (
                        predicates[0] if len(predicates) == 1 else or_(*predicates)
                    )
                    conn.execute(table.delete().where(condition))
            return True

    def list_active_memberships_for_user(self, user_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(workspace_memberships)
                .where(
                    workspace_memberships.c.user_id == user_id,
                    workspace_memberships.c.status == "active",
                )
                .order_by(workspace_memberships.c.created_at)
            ).mappings()
            return [dict(row) for row in rows]

    def list_archived_workspaces_for_user(self, user_id: str) -> list[dict[str, Any]]:
        """Return archived project workspaces where the user still has access.

        Archived workspaces are not selectable for normal API requests, but
        their active memberships remain so the workspace creator can restore or purge
        them from the workspace library.
        """
        with self.engine.begin() as conn:
            rows = (
                conn.execute(
                    select(
                        workspaces,
                        workspace_memberships.c.role.label("membership_role"),
                    )
                    .join(
                        workspace_memberships,
                        workspace_memberships.c.workspace_id == workspaces.c.id,
                    )
                    .where(
                        workspace_memberships.c.user_id == user_id,
                        workspace_memberships.c.status == "active",
                        workspaces.c.status == "archived",
                    )
                    .order_by(workspaces.c.updated_at.desc())
                )
                .mappings()
                .all()
            )
            return [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "slug": row["slug"],
                    "role": row["membership_role"],
                    "status": row["status"],
                    "created_by_user_id": row["created_by_user_id"],
                    "is_project": bool(
                        isinstance(row.get("settings"), dict)
                        and row["settings"].get("project_workspace")
                    ),
                }
                for row in rows
            ]

    def get_membership(self, workspace_id: str, user_id: str) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            row = (
                conn.execute(
                    select(workspace_memberships).where(
                        workspace_memberships.c.workspace_id == workspace_id,
                        workspace_memberships.c.user_id == user_id,
                    )
                )
                .mappings()
                .first()
            )
            return dict(row) if row else None

    def list_memberships(self, workspace_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(
                    workspace_memberships,
                    user_profiles.c.email,
                    user_profiles.c.display_name,
                )
                .select_from(
                    workspace_memberships.outerjoin(
                        user_profiles,
                        workspace_memberships.c.user_id == user_profiles.c.user_id,
                    )
                )
                .where(
                    workspace_memberships.c.workspace_id == workspace_id,
                )
                .order_by(workspace_memberships.c.created_at)
            ).mappings()
            return [dict(row) for row in rows]

    def save_membership(
        self, workspace_id: str, user_id: str, role: str, status: str = "active"
    ) -> dict[str, Any]:
        now = _now()
        with self.engine.begin() as conn:
            existing = (
                conn.execute(
                    select(workspace_memberships).where(
                        workspace_memberships.c.workspace_id == workspace_id,
                        workspace_memberships.c.user_id == user_id,
                    )
                )
                .mappings()
                .first()
            )
            values = {"role": role, "status": status, "updated_at": now}
            if existing:
                conn.execute(
                    workspace_memberships.update()
                    .where(
                        workspace_memberships.c.workspace_id == workspace_id,
                        workspace_memberships.c.user_id == user_id,
                    )
                    .values(**values)
                )
            else:
                conn.execute(
                    workspace_memberships.insert().values(
                        workspace_id=workspace_id,
                        user_id=user_id,
                        role=role,
                        status=status,
                        created_at=now,
                        updated_at=now,
                    )
                )
            row = (
                conn.execute(
                    select(workspace_memberships).where(
                        workspace_memberships.c.workspace_id == workspace_id,
                        workspace_memberships.c.user_id == user_id,
                    )
                )
                .mappings()
                .one()
            )
            return dict(row)

    def create_invitation(
        self,
        workspace_id: str,
        email: str,
        role: str,
        invited_by_user_id: str,
        *,
        expires_at: datetime,
    ) -> tuple[dict[str, Any], str]:
        """Store only a hash of an opaque invite secret, never the secret itself."""
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = _now()
        invitation = {
            "id": str(uuid.uuid4()),
            "workspace_id": workspace_id,
            "normalized_email": email.strip().casefold(),
            "role": role,
            "token_hash": token_hash,
            "expires_at": expires_at,
            "invited_by_user_id": invited_by_user_id,
            "status": "pending",
            "created_at": now,
        }
        with self.engine.begin() as conn:
            conn.execute(workspace_invitations.insert().values(**invitation))
        return invitation, token

    def list_invitations(self, workspace_id: str) -> list[dict[str, Any]]:
        """List invitation metadata without exposing the stored token hash."""
        with self.engine.begin() as conn:
            rows = (
                conn.execute(
                    select(workspace_invitations)
                    .where(workspace_invitations.c.workspace_id == workspace_id)
                    .order_by(workspace_invitations.c.created_at.desc())
                )
                .mappings()
                .all()
            )
            return [
                {
                    "id": row["id"],
                    "email": row["normalized_email"],
                    "role": row["role"],
                    "expires_at": row["expires_at"],
                    "invited_by_user_id": row["invited_by_user_id"],
                    "accepted_by_user_id": row["accepted_by_user_id"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                }
                for row in rows
            ]

    def cancel_invitation(self, workspace_id: str, invitation_id: str) -> bool:
        """Cancel a pending workspace invitation; accepted invites are immutable."""
        with self.engine.begin() as conn:
            result = conn.execute(
                workspace_invitations.update()
                .where(
                    workspace_invitations.c.id == invitation_id,
                    workspace_invitations.c.workspace_id == workspace_id,
                    workspace_invitations.c.status == "pending",
                )
                .values(status="cancelled")
            )
            return bool(result.rowcount)

    def accept_invitation(
        self, token: str, user_id: str, email: str | None
    ) -> dict[str, Any] | None:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = _now()
        with self.engine.begin() as conn:
            invite = (
                conn.execute(
                    select(workspace_invitations).where(
                        workspace_invitations.c.token_hash == token_hash,
                        workspace_invitations.c.status == "pending",
                    )
                )
                .mappings()
                .first()
            )
            if not invite or invite["expires_at"] <= now:
                return None
            if email and str(invite["normalized_email"]) != email.casefold():
                return None
            self._sync_user_profile(conn, user_id, email, now)
            invitation_role = "analyst"
            conn.execute(
                workspace_memberships.insert().values(
                    workspace_id=invite["workspace_id"],
                    user_id=user_id,
                    role=invitation_role,
                    status="active",
                    created_at=now,
                    updated_at=now,
                )
            )
            conn.execute(
                workspace_invitations.update()
                .where(workspace_invitations.c.id == invite["id"])
                .values(
                    status="accepted",
                    accepted_by_user_id=user_id,
                )
            )
            row = (
                conn.execute(
                    select(workspace_memberships).where(
                        workspace_memberships.c.workspace_id == invite["workspace_id"],
                        workspace_memberships.c.user_id == user_id,
                    )
                )
                .mappings()
                .one()
            )
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
            row = (
                conn.execute(
                    select(google_drive_oauth_states)
                    .where(
                        google_drive_oauth_states.c.id == state_id,
                        google_drive_oauth_states.c.used_at.is_(None),
                        google_drive_oauth_states.c.expires_at > now,
                    )
                    .with_for_update()
                )
                .mappings()
                .first()
            )
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
            row = (
                conn.execute(
                    select(google_drive_connections).where(
                        google_drive_connections.c.workspace_id == workspace_id
                    )
                )
                .mappings()
                .first()
            )
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
    def upsert_dataset(
        self,
        name: str,
        source_type: str,
        source_ref: str,
        *,
        workspace_id: str,
        content_sha256: str | None = None,
        source_version: str | None = None,
    ) -> str:
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
                    content_sha256=content_sha256,
                    source_version=source_version,
                    workspace_id=workspace_id,
                    created_at=_now(),
                )
            )
            return dataset_id

    def create_dataset(
        self,
        dataset_id: str,
        name: str,
        source_type: str,
        source_ref: str,
        *,
        workspace_id: str,
        content_sha256: str | None = None,
        source_version: str | None = None,
    ) -> str:
        """Persist an uploaded source before profiling so it is tenant-owned."""
        with self.engine.begin() as conn:
            conn.execute(
                datasets.insert().values(
                    id=dataset_id,
                    name=name,
                    source_type=source_type,
                    source_ref=source_ref,
                    content_sha256=content_sha256,
                    source_version=source_version,
                    workspace_id=workspace_id,
                    created_at=_now(),
                )
            )
        return dataset_id

    def get_dataset(
        self, dataset_id: str, *, workspace_id: str | None = None
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            query = select(datasets).where(datasets.c.id == dataset_id)
            if workspace_id is not None:
                query = query.where(datasets.c.workspace_id == workspace_id)
            row = conn.execute(query).mappings().first()
            return dict(row) if row else None

    def list_datasets(self, *, workspace_id: str) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(datasets)
                .where(datasets.c.workspace_id == workspace_id)
                .order_by(datasets.c.created_at.desc())
            ).mappings()
            return [dict(r) for r in rows]

    def set_dataset_collection(
        self, dataset_ids: list[str], collection_name: str, *, workspace_id: str
    ) -> list[dict[str, Any]] | None:
        """Assign one logical collection name to an uploaded batch."""
        with self.engine.begin() as conn:
            rows = (
                conn.execute(
                    select(datasets.c.id).where(
                        datasets.c.id.in_(dataset_ids),
                        datasets.c.workspace_id == workspace_id,
                    )
                )
                .scalars()
                .all()
            )
            if len(rows) != len(dataset_ids):
                return None
            conn.execute(
                datasets.update()
                .where(
                    datasets.c.id.in_(dataset_ids),
                    datasets.c.workspace_id == workspace_id,
                )
                .values(collection_name=collection_name)
            )
            updated = (
                conn.execute(
                    select(datasets).where(
                        datasets.c.id.in_(dataset_ids),
                        datasets.c.workspace_id == workspace_id,
                    )
                )
                .mappings()
                .all()
            )
            by_id = {str(row["id"]): dict(row) for row in updated}
            return [by_id[dataset_id] for dataset_id in dataset_ids]

    def delete_dataset(
        self, dataset_id: str, *, workspace_id: str
    ) -> dict[str, Any] | None:
        """Xóa dataset và toàn bộ metadata con, trả về source_ref + run ids."""
        with self.engine.begin() as conn:
            dataset = (
                conn.execute(
                    select(datasets).where(
                        datasets.c.id == dataset_id,
                        datasets.c.workspace_id == workspace_id,
                    )
                )
                .mappings()
                .first()
            )
            if not dataset:
                return None

            run_ids = [
                row[0]
                for row in conn.execute(
                    select(profile_runs.c.id).where(
                        profile_runs.c.dataset_id == dataset_id
                    )
                )
            ]

            if run_ids:
                for table in PROPOSAL_TABLES.values():
                    conn.execute(
                        table.delete().where(table.c.profile_run_id.in_(run_ids))
                    )
                conn.execute(
                    column_stats.delete().where(
                        column_stats.c.profile_run_id.in_(run_ids)
                    )
                )
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
                conn.execute(
                    profile_runs.delete().where(profile_runs.c.id.in_(run_ids))
                )

            conn.execute(
                datasets.delete().where(
                    datasets.c.id == dataset_id, datasets.c.workspace_id == workspace_id
                )
            )
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
        run_name: str | None = None,
    ) -> str:
        with self.engine.begin() as conn:
            dataset_query = select(
                datasets.c.workspace_id,
                datasets.c.content_sha256,
                datasets.c.source_version,
            ).where(datasets.c.id == dataset_id)
            if workspace_id is not None:
                dataset_query = dataset_query.where(
                    datasets.c.workspace_id == workspace_id
                )
            dataset = conn.execute(dataset_query).mappings().first()
            if dataset is None:
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
                    workspace_id=str(dataset["workspace_id"]),
                    source_content_sha256=dataset.get("content_sha256"),
                    source_version=dataset.get("source_version"),
                    version=version,
                    run_name=run_name,
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
                .where(
                    profile_runs.c.workspace_id == workspace_id
                    if workspace_id is not None
                    else True
                )
                .values(status=to_status, **fields)
            )
            return result.rowcount > 0

    def execution_config(
        self, run_id: str, *, workspace_id: str | None = None
    ) -> dict[str, Any] | None:
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
                    return {
                        "ok": False,
                        "code": "invalid_proposal",
                        "proposal_id": proposal_id,
                    }
                seen.add(key)
                row = (
                    conn.execute(
                        select(table).where(
                            table.c.id == proposal_id,
                            table.c.profile_run_id == run_id,
                            table.c.status == "pending",
                        )
                    )
                    .mappings()
                    .first()
                )
                if not row:
                    return {
                        "ok": False,
                        "code": "invalid_proposal",
                        "proposal_id": proposal_id,
                    }
                normalized.append(item)

            status_map = {
                "confirm": "confirmed",
                "reject": "rejected",
                "edit": "edited",
            }
            for item in normalized:
                decision = item.get("decision")
                if decision not in status_map:
                    return {"ok": False, "code": "invalid_decision"}
                if decision == "edit":
                    if item["kind"] == "candidate_key":
                        return {
                            "ok": False,
                            "code": "edit_not_supported",
                            "proposal_id": item["proposal_id"],
                        }
                    if not item.get("final_type"):
                        return {
                            "ok": False,
                            "code": "edit_requires_final_type",
                            "proposal_id": item["proposal_id"],
                        }
                    if not item.get("note"):
                        return {
                            "ok": False,
                            "code": "edit_requires_note",
                            "proposal_id": item["proposal_id"],
                        }
                table = PROPOSAL_TABLES[item["kind"]]
                values: dict[str, Any] = {
                    "status": status_map[decision],
                    "confirmed_by": confirmed_by,
                    "confirmed_at": _now(),
                    "review_note": item.get("note"),
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
            updated = (
                conn.execute(select(profile_runs).where(profile_runs.c.id == run_id))
                .mappings()
                .first()
            )
            return {
                "ok": True,
                "duplicate": False,
                "run": dict(updated),
                "applied": len(normalized),
            }

    def update_profile_run(
        self, run_id: str, *, workspace_id: str | None = None, **fields: Any
    ) -> None:
        if not fields:
            return
        with self.engine.begin() as conn:
            conn.execute(
                profile_runs.update()
                .where(profile_runs.c.id == run_id)
                .where(
                    profile_runs.c.workspace_id == workspace_id
                    if workspace_id is not None
                    else True
                )
                .values(**fields)
            )

    def get_profile_run(
        self, run_id: str, *, workspace_id: str | None = None
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            query = select(profile_runs).where(profile_runs.c.id == run_id)
            if workspace_id is not None:
                query = query.where(profile_runs.c.workspace_id == workspace_id)
            row = conn.execute(query).mappings().first()
            return dict(row) if row else None

    def list_profile_runs(
        self,
        dataset_id: str | None = None,
        limit: int = 50,
        *,
        workspace_id: str | None = None,
    ) -> list[dict[str, Any]]:
        query = (
            select(profile_runs).order_by(profile_runs.c.created_at.desc()).limit(limit)
        )
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
            query = query.where(
                func.lower(column_stats.c.column_name) == column_name.lower()
            )
        with self.engine.begin() as conn:
            return [dict(r) for r in conn.execute(query).mappings()]

    def get_column_stats(
        self, run_id: str, column_name: str | None = None
    ) -> dict[str, dict[str, Any]]:
        """Thống kê từng cột, key theo tên cột — cùng shape với `compute` trả về.

        Đây là dạng mà node và tool dùng, nên tra cột theo tên là O(1).
        """
        return {
            row["column_name"]: row
            for row in self.column_stats_rows(run_id, column_name)
        }

    # --- Proposals ------------------------------------------------------ #
    def save_proposals(
        self, run_id: str, kind: ProposalKind, items: list[dict[str, Any]]
    ) -> list[str]:
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
                {
                    "id": proposal_id,
                    "profile_run_id": run_id,
                    "created_at": _now(),
                    **payload,
                }
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
                    for r in conn.execute(
                        query.order_by(table.c.confidence_score.desc())
                    ).mappings()
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
                    pii_proposals.c.status.in_(
                        ["confirmed", "edited", "auto_confirmed", "pending"]
                    ),
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
                            table.c.profile_run_id == run_id,
                            table.c.status == "pending",
                        )
                    ).scalar()
                    or 0
                )
        return total

    # --- Statistical tests ---------------------------------------------- #
    def save_test_results(
        self,
        run_id: str,
        results: list[dict[str, Any]],
        requested_by: str | None = None,
    ) -> None:
        allowed = set(statistical_test_results.c.keys()) - {
            "id",
            "profile_run_id",
            "created_at",
        }
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
                {
                    "id": _uuid(),
                    "profile_run_id": run_id,
                    "created_at": _now(),
                    **payload,
                }
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

    def profile_summary_text(
        self, run_id: str, *, workspace_id: str | None = None
    ) -> str:
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
            + (
                " (số liệu là ước lượng từ sampling)"
                if run.get("is_approximate")
                else ""
            ),
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
    def list_retrieval_documents(
        self, *, workspace_id: str | None = None
    ) -> list[dict[str, Any]]:
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
            rows = (
                conn.execute(query.order_by(retrieval_documents.c.doc_id))
                .mappings()
                .all()
            )
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
                    retrieval_documents.insert().values(**{**values, "created_at": now})
                )

    def upsert_retrieval_documents(
        self,
        documents: list[tuple[str, str, dict[str, Any], list[float]]],
        *,
        workspace_id: str | None = None,
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
                    select(retrieval_documents).where(
                        retrieval_documents.c.doc_id.in_(ids)
                    )
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
                if previous and all(
                    previous.get(key) == value
                    for key, value in values.items()
                    if key != "updated_at"
                ):
                    unchanged += 1
                elif previous:
                    conn.execute(
                        retrieval_documents.update()
                        .where(retrieval_documents.c.doc_id == doc_id)
                        .values(**values)
                    )
                    updated += 1
                else:
                    conn.execute(
                        retrieval_documents.insert().values(
                            doc_id=doc_id, created_at=now, **values
                        )
                    )
                    inserted += 1
        return {"inserted": inserted, "updated": updated, "unchanged": unchanged}

    def delete_external_retrieval_documents_except(self, active_ids: set[str]) -> int:
        """Delete only confirmed stale external-corpus documents, never reports."""
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(
                    retrieval_documents.c.doc_id,
                    retrieval_documents.c.document_metadata,
                )
            ).mappings()
            stale = [
                row["doc_id"]
                for row in rows
                if (row.get("document_metadata") or {}).get("knowledge_type")
                == "external_knowledge"
                and row["doc_id"] not in active_ids
            ]
            if not stale:
                return 0
            result = conn.execute(
                retrieval_documents.delete().where(
                    retrieval_documents.c.doc_id.in_(stale)
                )
            )
        return int(result.rowcount or 0)

    def delete_retrieval_document(
        self, doc_id: str, *, workspace_id: str | None = None
    ) -> bool:
        with self.engine.begin() as conn:
            query = retrieval_documents.delete().where(
                retrieval_documents.c.doc_id == doc_id
            )
            if workspace_id is not None:
                query = query.where(retrieval_documents.c.workspace_id == workspace_id)
            result = conn.execute(query)
        return bool(result.rowcount)

    # --- Audit persistence --------------------------------------------- #
    def save_audit_event(self, event: str, fields: dict[str, Any]) -> None:
        # JSON columns reject arbitrary Python objects.  Normalize exception,
        # UUID and datetime values while preserving the existing audit contract.
        normalized = json.loads(json.dumps(fields, ensure_ascii=False, default=str))
        scoped = {
            "workspace_id": normalized.get("workspace_id"),
            "actor_user_id": normalized.get("actor_user_id")
            or normalized.get("user_id"),
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

    def tail_audit_events(
        self, limit: int = 50, *, workspace_id: str | None = None
    ) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            query = select(audit_events)
            if workspace_id is not None:
                query = query.where(audit_events.c.workspace_id == workspace_id)
            rows = (
                conn.execute(query.order_by(audit_events.c.id.desc()).limit(limit))
                .mappings()
                .all()
            )
        output: list[dict[str, Any]] = []
        for row in reversed(rows):
            item = dict(row["fields"] or {})
            timestamp = row["ts"]
            item = {
                "ts": timestamp.isoformat()
                if hasattr(timestamp, "isoformat")
                else str(timestamp),
                "event": row["event"],
                **item,
            }
            output.append(item)
        return output

    # --- Published reports --------------------------------------------- #
    def _report_version_payload(
        self, conn: Any, version_row: dict[str, Any]
    ) -> dict[str, Any]:
        payload = dict(version_row)
        version_id = payload["id"]
        payload["sections"] = [
            dict(row)
            for row in conn.execute(
                select(report_sections)
                .where(report_sections.c.report_version_id == version_id)
                .order_by(report_sections.c.position)
            ).mappings()
        ]
        payload["visualizations"] = [
            dict(row)
            for row in conn.execute(
                select(report_visualizations)
                .where(report_visualizations.c.report_version_id == version_id)
                .order_by(report_visualizations.c.position)
            ).mappings()
        ]
        payload["items"] = [
            dict(row)
            for row in conn.execute(
                select(report_items)
                .where(report_items.c.report_version_id == version_id)
                .order_by(report_items.c.position)
            ).mappings()
        ]
        payload["reviews"] = [
            dict(row)
            for row in conn.execute(
                select(report_reviews)
                .where(report_reviews.c.report_version_id == version_id)
                .order_by(report_reviews.c.created_at)
            ).mappings()
        ]
        return payload

    def list_reports(
        self,
        workspace_id: str,
        *,
        published_only: bool = False,
        exclude_rejected: bool = False,
    ) -> list[dict[str, Any]]:
        with self.engine.begin() as conn:
            query = select(reports).where(reports.c.workspace_id == workspace_id)
            if published_only:
                query = query.where(reports.c.status == "published")
            if exclude_rejected:
                latest_version = (
                    select(func.max(report_versions.c.version))
                    .where(report_versions.c.report_id == reports.c.id)
                    .correlate(reports)
                    .scalar_subquery()
                )
                query = query.where(
                    ~select(report_versions.c.id)
                    .where(
                        report_versions.c.report_id == reports.c.id,
                        report_versions.c.version == latest_version,
                        report_versions.c.status == "rejected",
                    )
                    .exists()
                )
            rows = conn.execute(query.order_by(reports.c.updated_at.desc())).mappings()
            return [dict(row) for row in rows]

    def get_report(
        self, report_id: str, workspace_id: str, *, published_only: bool = False
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
            query = select(reports).where(
                reports.c.id == report_id, reports.c.workspace_id == workspace_id
            )
            if published_only:
                query = query.where(reports.c.status == "published")
            report = conn.execute(query).mappings().first()
            if not report:
                return None
            result = dict(report)
            version_id = (
                report.get("current_published_version_id") if published_only else None
            )
            version_query = select(report_versions).where(
                report_versions.c.report_id == report["id"]
            )
            if version_id:
                version_query = version_query.where(report_versions.c.id == version_id)
            versions = conn.execute(
                version_query.order_by(report_versions.c.version.desc())
            ).mappings()
            result["versions"] = [
                self._report_version_payload(conn, dict(row)) for row in versions
            ]
            return result

    def get_report_any_workspace(
        self, report_id: str, *, published_only: bool = False
    ) -> dict[str, Any] | None:
        """Read a report without tenant scoping; callers must be global-authorized."""
        with self.engine.begin() as conn:
            query = (
                select(reports)
                .join(workspaces, workspaces.c.id == reports.c.workspace_id)
                .where(reports.c.id == report_id, workspaces.c.status == "active")
            )
            if published_only:
                query = query.where(reports.c.status == "published")
            report = conn.execute(query).mappings().first()
            if not report:
                return None
            result = dict(report)
            version_id = (
                report.get("current_published_version_id") if published_only else None
            )
            version_query = select(report_versions).where(
                report_versions.c.report_id == report["id"]
            )
            if version_id:
                version_query = version_query.where(report_versions.c.id == version_id)
            result["versions"] = [
                self._report_version_payload(conn, dict(row))
                for row in conn.execute(
                    version_query.order_by(report_versions.c.version.desc())
                ).mappings()
            ]
            return result

    @staticmethod
    def _validate_visualization_spec(chart_type: str, spec: dict[str, Any]) -> None:
        if chart_type not in {
            "kpi",
            "bar",
            "line",
            "table",
            "histogram",
            "scatter",
            "box",
            "heatmap",
        }:
            raise ValueError("chart_type không thuộc allowlist.")
        encoded = json.dumps(spec, ensure_ascii=False)
        if len(encoded) > 20_000:
            raise ValueError("visualization_spec quá lớn.")
        forbidden = {
            "sql",
            "javascript",
            "formatter",
            "local_path",
            "file_path",
            "result_hash",
        }
        if any(str(key).lower() in forbidden for key in spec):
            raise ValueError("visualization_spec chứa trường không được phép.")

    def _execution_for_workspace(
        self, conn: Any, execution_id: str, workspace_id: str
    ) -> dict[str, Any] | None:
        row = (
            conn.execute(
                select(query_executions, analysis_sessions.c.workspace_id)
                .join(
                    analysis_sessions,
                    analysis_sessions.c.id == query_executions.c.session_id,
                )
                .where(
                    query_executions.c.id == execution_id,
                    analysis_sessions.c.workspace_id == workspace_id,
                )
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    def create_report(
        self, workspace_id: str, actor_user_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        report_id, version_id, now = _uuid(), _uuid(), _now()
        title = str(payload["title"]).strip()
        slug = (
            str(payload.get("slug") or title.lower().replace(" ", "-")).strip("-")[:160]
            or report_id
        )
        with self.engine.begin() as conn:
            conn.execute(
                reports.insert().values(
                    id=report_id,
                    workspace_id=workspace_id,
                    title=title,
                    slug=slug,
                    status="draft",
                    created_by_user_id=actor_user_id,
                    created_at=now,
                    updated_at=now,
                )
            )
            conn.execute(
                report_versions.insert().values(
                    id=version_id,
                    report_id=report_id,
                    version=1,
                    status="draft",
                    executive_summary=payload.get("executive_summary"),
                    scope=payload.get("scope"),
                    time_range=payload.get("time_range"),
                    created_by_user_id=actor_user_id,
                    created_at=now,
                )
            )
            self._replace_report_content(conn, version_id, workspace_id, payload)
        return self.get_report(report_id, workspace_id) or {}

    def _replace_report_content(
        self, conn: Any, version_id: str, workspace_id: str, payload: dict[str, Any]
    ) -> None:
        sections = payload.get("sections") or []
        visualizations = payload.get("visualizations") or []
        allowed_sections = {
            "narrative",
            "methodology",
            "findings",
            "limitations",
            "recommendations",
        }
        conn.execute(
            report_sections.delete().where(
                report_sections.c.report_version_id == version_id
            )
        )
        conn.execute(
            report_visualizations.delete().where(
                report_visualizations.c.report_version_id == version_id
            )
        )
        for position, section in enumerate(sections):
            if section.get("kind") not in allowed_sections:
                raise ValueError("Loại report section không hợp lệ.")
            conn.execute(
                report_sections.insert().values(
                    id=_uuid(),
                    report_version_id=version_id,
                    position=position,
                    kind=section["kind"],
                    title=section.get("title"),
                    content_json=section.get("content") or {},
                )
            )
        for position, item in enumerate(visualizations):
            chart_type = str(item.get("chart_type", ""))
            spec = item.get("visualization_spec") or {}
            if not isinstance(spec, dict):
                raise ValueError("visualization_spec phải là object.")
            self._validate_visualization_spec(chart_type, spec)
            execution = self._execution_for_workspace(
                conn, str(item.get("query_execution_id", "")), workspace_id
            )
            if not execution:
                raise LookupError("Evidence execution không thuộc workspace.")
            conn.execute(
                report_visualizations.insert().values(
                    id=_uuid(),
                    report_version_id=version_id,
                    position=position,
                    chart_type=chart_type,
                    title=item.get("title"),
                    visualization_spec=spec,
                    query_execution_id=execution["id"],
                    result_hash=execution["result_hash"],
                    result_snapshot=execution["result"],
                    created_at=_now(),
                )
            )

    def update_report_draft(
        self,
        report_id: str,
        workspace_id: str,
        actor_user_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any] | None:
        with self.engine.begin() as conn:
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
                    )
                    .order_by(report_versions.c.version.desc())
                )
                .mappings()
                .first()
            )
            if not version or version["status"] not in {"draft", "changes_requested"}:
                raise ValueError(
                    "Chỉ có thể sửa report version draft hoặc changes_requested."
                )
            if version["created_by_user_id"] != actor_user_id:
                raise PermissionError("Chỉ tác giả mới có thể sửa draft này.")
            fields = {
                key: payload[key]
                for key in ("executive_summary", "scope", "time_range")
                if key in payload
            }
            if fields:
                conn.execute(
                    report_versions.update()
                    .where(report_versions.c.id == version["id"])
                    .values(**fields)
                )
            self._replace_report_content(conn, version["id"], workspace_id, payload)
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(
                    title=payload.get("title", report["title"]),
                    updated_at=_now(),
                    status="draft",
                )
            )
        return self.get_report(report_id, workspace_id)

    def delete_report_draft(
        self, report_id: str, workspace_id: str, actor_user_id: str
    ) -> bool:
        """Delete an analyst-owned report before it becomes a published artifact."""
        with self.engine.begin() as conn:
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
                return False
            if report["created_by_user_id"] != actor_user_id:
                raise PermissionError("Chỉ tác giả mới có thể xóa report này.")
            if report["status"] not in {"draft", "in_review"}:
                raise ValueError("Chỉ report chưa publish mới có thể xóa.")

            versions = list(
                conn.execute(
                    select(report_versions.c.id, report_versions.c.status).where(
                        report_versions.c.report_id == report_id
                    )
                ).mappings()
            )
            if not versions:
                raise ValueError("Report không có version hợp lệ để xóa.")
            if any(
                version["status"] in {"approved", "published"} for version in versions
            ):
                raise ValueError("Report đã qua bước duyệt, không thể xóa.")

            version_ids = [version["id"] for version in versions]
            conn.execute(
                report_reviews.delete().where(
                    report_reviews.c.report_version_id.in_(version_ids)
                )
            )
            conn.execute(
                report_sections.delete().where(
                    report_sections.c.report_version_id.in_(version_ids)
                )
            )
            conn.execute(
                report_visualizations.delete().where(
                    report_visualizations.c.report_version_id.in_(version_ids)
                )
            )
            conn.execute(
                report_items.delete().where(
                    report_items.c.report_version_id.in_(version_ids)
                )
            )
            conn.execute(
                report_versions.delete().where(report_versions.c.id.in_(version_ids))
            )
            conn.execute(
                reports.delete().where(
                    reports.c.id == report_id,
                    reports.c.workspace_id == workspace_id,
                )
            )
            return True

    def submit_report(
        self, report_id: str, workspace_id: str, actor_user_id: str
    ) -> dict[str, Any] | None:
        now = _now()
        with self.engine.begin() as conn:
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
                    .where(report_versions.c.report_id == report_id)
                    .order_by(report_versions.c.version.desc())
                )
                .mappings()
                .first()
            )
            if not version or version["status"] not in {"draft", "changes_requested"}:
                raise ValueError("Report không ở trạng thái có thể submit.")
            if version["created_by_user_id"] != actor_user_id:
                raise PermissionError("Chỉ tác giả mới có thể submit report.")
            conn.execute(
                report_versions.update()
                .where(report_versions.c.id == version["id"])
                .values(
                    status="in_review",
                    submitted_by_user_id=actor_user_id,
                    submitted_at=now,
                )
            )
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(status="in_review", updated_at=now)
            )
        return self.get_report(report_id, workspace_id)

    def review_report(
        self,
        report_id: str,
        workspace_id: str,
        reviewer_user_id: str,
        decision: str,
        comment: str | None,
    ) -> dict[str, Any] | None:
        if decision not in {"approved", "changes_requested", "rejected"}:
            raise ValueError("Review decision không hợp lệ.")
        now = _now()
        with self.engine.begin() as conn:
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
                    .where(report_versions.c.report_id == report_id)
                    .order_by(report_versions.c.version.desc())
                )
                .mappings()
                .first()
            )
            if not version or version["status"] != "in_review":
                raise ValueError("Report không ở trạng thái in_review.")
            conn.execute(
                report_reviews.insert().values(
                    id=_uuid(),
                    report_version_id=version["id"],
                    reviewer_user_id=reviewer_user_id,
                    decision=decision,
                    comment=comment,
                    created_at=now,
                )
            )
            next_report_status = "in_review" if decision == "approved" else "draft"
            conn.execute(
                report_versions.update()
                .where(report_versions.c.id == version["id"])
                .values(
                    status=decision,
                    reviewed_by_user_id=reviewer_user_id,
                    reviewed_at=now,
                )
            )
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(status=next_report_status, updated_at=now)
            )
        return self.get_report(report_id, workspace_id)

    def publish_report(
        self,
        report_id: str,
        workspace_id: str,
        actor_user_id: str,
        *,
        reason: str | None = None,
    ) -> dict[str, Any] | None:
        now = _now()
        with self.engine.begin() as conn:
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
                    .where(report_versions.c.report_id == report_id)
                    .order_by(report_versions.c.version.desc())
                )
                .mappings()
                .first()
            )
            if not version or version["status"] not in {
                "draft",
                "in_review",
                "approved",
            }:
                raise ValueError("Report version không ở trạng thái có thể xuất bản.")
            conn.execute(
                report_versions.update()
                .where(report_versions.c.id == version["id"])
                .values(
                    status="published",
                    published_by_user_id=actor_user_id,
                    published_at=now,
                )
            )
            conn.execute(
                reports.update()
                .where(reports.c.id == report_id)
                .values(
                    status="published",
                    current_published_version_id=version["id"],
                    updated_at=now,
                )
            )
        return self.get_report(report_id, workspace_id)

    def archive_report(self, report_id: str, workspace_id: str) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(
                reports.update()
                .where(
                    reports.c.id == report_id,
                    reports.c.workspace_id == workspace_id,
                )
                .values(status="archived", updated_at=_now())
            )
            return bool(result.rowcount)


# --------------------------------------------------------------------------- #
_repo: Repository | None = None


def build_engine(settings: Settings | None = None) -> Engine:
    cfg = settings or get_settings()
    url = make_url(cfg.database_url)
    if url.get_backend_name() not in {"postgresql", "postgres"}:
        raise ValueError("VDaAgent chỉ hỗ trợ PostgreSQL.")
    # Supabase session-mode poolers enforce a hard client limit. SQLAlchemy's
    # defaults (pool_size=5 + max_overflow=10) can consume all 15 sessions from
    # one backend process before LangGraph's checkpointer is counted. Keep the
    # metadata pool deliberately small and bounded; pre_ping/recycle also avoid
    # handing a stale idle connection to a request.
    return create_engine(
        url,
        future=True,
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=0,
        pool_timeout=30,
        pool_recycle=300,
    )


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
    "notebook_cells",
    "notebooks",
    "query_executions",
    "report_items",
    "reports",
    "reset_repository",
    "workspace_memberships",
    "workspace_context_versions",
    "workspace_theme_versions",
    "workspaces",
]
