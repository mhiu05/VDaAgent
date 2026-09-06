"""Create the schema that existed before Alembic was introduced.

Revision ``20260812_0001`` was written as an adoption migration: it assumes
that SQLAlchemy ``metadata.create_all()`` has already created the core domain
tables.  Keeping that assumption in the root revision makes an empty database
impossible to bootstrap.  This baseline records the historical schema
explicitly so fresh databases and verified legacy databases can enter the same
revision chain without runtime schema creation.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260812_0000"
down_revision = None
branch_labels = None
depends_on = None


def _proposal_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "profile_run_id",
            sa.String(32),
            sa.ForeignKey("profile_runs.id"),
            nullable=False,
        ),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("evidence", sa.String(2048)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("confirmed_by", sa.String(255)),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_type", sa.String(32), nullable=False),
        sa.Column("source_ref", sa.String(1024), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_profiled_at", sa.DateTime(timezone=True)),
    )
    op.create_table(
        "profile_runs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "dataset_id", sa.String(32), sa.ForeignKey("datasets.id"), nullable=False
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scan_mode", sa.String(16), nullable=False),
        sa.Column("sampling_strategy", sa.String(32)),
        sa.Column("sample_size", sa.Integer()),
        sa.Column("random_seed", sa.Integer()),
        sa.Column("executed_query", sa.String(4096)),
        sa.Column("row_count", sa.Integer()),
        sa.Column("duplicate_row_count", sa.Integer()),
        sa.Column("duplicate_row_rate", sa.Float()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("graph_thread_id", sa.String(255), unique=True),
        sa.Column("initial_question", sa.String(2000)),
        sa.Column("question_type", sa.String(32)),
        sa.Column("answer", sa.Text()),
        sa.Column("answer_sources", sa.JSON()),
        sa.Column("terminal_result", sa.JSON()),
        sa.Column("last_resume_key", sa.String(255)),
        sa.Column("last_resume_action", sa.String(32)),
        sa.Column("last_resume_at", sa.DateTime(timezone=True)),
        sa.Column("resume_count", sa.Integer(), nullable=False),
        sa.Column("narrative_report", sa.String()),
        sa.Column("risk_warnings", sa.JSON()),
        sa.Column("correlation_matrix", sa.JSON()),
        sa.Column("quasi_identifiers", sa.JSON()),
        sa.Column("is_approximate", sa.Boolean(), nullable=False),
        sa.Column("error", sa.String(1024)),
    )
    op.create_table(
        "column_stats",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "profile_run_id",
            sa.String(32),
            sa.ForeignKey("profile_runs.id"),
            nullable=False,
        ),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("dtype", sa.String(64)),
        sa.Column("null_pct", sa.Float()),
        sa.Column("null_count", sa.Integer()),
        sa.Column("cardinality", sa.Integer()),
        sa.Column("uniqueness_ratio", sa.Float()),
        sa.Column("min_value", sa.Float()),
        sa.Column("max_value", sa.Float()),
        sa.Column("mean", sa.Float()),
        sa.Column("median", sa.Float()),
        sa.Column("std", sa.Float()),
        sa.Column("q1", sa.Float()),
        sa.Column("q3", sa.Float()),
        sa.Column("outlier_count", sa.Integer()),
        sa.Column("outlier_method", sa.String(32)),
        sa.Column("min_length", sa.Integer()),
        sa.Column("max_length", sa.Integer()),
        sa.Column("top_k_values", sa.JSON()),
        sa.Column("is_approximate", sa.Boolean(), nullable=False),
        sa.Column("margin_of_error", sa.Float()),
    )
    op.create_table(
        "candidate_key_proposals",
        *_proposal_columns(),
        sa.Column("columns", sa.JSON(), nullable=False),
    )
    op.create_table(
        "semantic_type_proposals",
        *_proposal_columns(),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("proposed_type", sa.String(32), nullable=False),
        sa.Column("semantic_description", sa.String(512)),
        sa.Column("final_type", sa.String(32)),
    )
    op.create_table(
        "pii_proposals",
        *_proposal_columns(),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("pii_type", sa.String(64)),
        sa.Column("detection_method", sa.String(32), nullable=False),
    )
    op.create_table(
        "statistical_test_results",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "profile_run_id",
            sa.String(32),
            sa.ForeignKey("profile_runs.id"),
            nullable=False,
        ),
        sa.Column("test_type", sa.String(64), nullable=False),
        sa.Column("target_columns", sa.JSON(), nullable=False),
        sa.Column("test_statistic", sa.Float()),
        sa.Column("p_value", sa.Float()),
        sa.Column("p_value_adjusted", sa.Float()),
        sa.Column("significant_after_correction", sa.Boolean()),
        sa.Column("conclusion", sa.String(32), nullable=False),
        sa.Column("interpretation", sa.String(2048)),
        sa.Column("alpha", sa.Float()),
        sa.Column("extra", sa.JSON()),
        sa.Column("requested_by", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "drift_reports",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "profile_run_id_a",
            sa.String(32),
            sa.ForeignKey("profile_runs.id"),
            nullable=False,
        ),
        sa.Column(
            "profile_run_id_b",
            sa.String(32),
            sa.ForeignKey("profile_runs.id"),
            nullable=False,
        ),
        sa.Column("drift_columns", sa.JSON(), nullable=False),
        sa.Column("summary", sa.String(2048)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "analysis_sessions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("decision", sa.Text()),
        sa.Column("audience", sa.String(255)),
        sa.Column("output", sa.String(64)),
        sa.Column("time_scope", sa.JSON()),
        sa.Column("population", sa.JSON()),
        sa.Column("baseline", sa.JSON()),
        sa.Column("creator", sa.String(255)),
        sa.Column("graph_thread_id", sa.String(255), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "analysis_sources",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(32),
            sa.ForeignKey("analysis_sessions.id"),
            nullable=False,
        ),
        sa.Column(
            "dataset_id", sa.String(32), sa.ForeignKey("datasets.id"), nullable=False
        ),
        sa.Column(
            "profile_run_id",
            sa.String(32),
            sa.ForeignKey("profile_runs.id"),
            nullable=False,
        ),
        sa.Column("alias", sa.String(64), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
    )
    op.create_index("ix_analysis_sources_session_id", "analysis_sources", ["session_id"])
    op.create_table(
        "semantic_context_versions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(32),
            sa.ForeignKey("analysis_sessions.id"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("approved_by", sa.String(255)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_semantic_context_versions_session_id",
        "semantic_context_versions",
        ["session_id"],
    )
    op.create_table(
        "quality_gate_runs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(32),
            sa.ForeignKey("analysis_sessions.id"),
            nullable=False,
        ),
        sa.Column(
            "context_version_id",
            sa.String(32),
            sa.ForeignKey("semantic_context_versions.id"),
        ),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_quality_gate_runs_session_id", "quality_gate_runs", ["session_id"])
    op.create_table(
        "quality_issues",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "quality_gate_run_id",
            sa.String(32),
            sa.ForeignKey("quality_gate_runs.id"),
            nullable=False,
        ),
        sa.Column("rule", sa.String(64), nullable=False),
        sa.Column("dimension", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("evidence", sa.JSON()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("resolution_note", sa.Text()),
    )
    op.create_index(
        "ix_quality_issues_quality_gate_run_id",
        "quality_issues",
        ["quality_gate_run_id"],
    )
    op.create_table(
        "query_executions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(32),
            sa.ForeignKey("analysis_sessions.id"),
            nullable=False,
        ),
        sa.Column(
            "context_version_id",
            sa.String(32),
            sa.ForeignKey("semantic_context_versions.id"),
            nullable=False,
        ),
        sa.Column("query_spec", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("result_hash", sa.String(64), nullable=False),
        sa.Column("is_approximate", sa.Boolean(), nullable=False),
        sa.Column("limitations", sa.JSON()),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_query_executions_session_id", "query_executions", ["session_id"])

    # These two tables were moved into PostgreSQL by the same release that
    # introduced Alembic.  Revision 0001 nevertheless treats them as existing
    # legacy tables, so the baseline supplies their pre-tenancy shape.
    op.create_table(
        "retrieval_documents",
        sa.Column("doc_id", sa.String(255), primary_key=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("document_metadata", sa.JSON()),
        sa.Column("vector", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event", sa.String(128), nullable=False),
        sa.Column("fields", sa.JSON()),
    )
    op.create_index("ix_audit_events_event", "audit_events", ["event"])


def downgrade() -> None:
    raise RuntimeError(
        "Downgrading below the pre-Alembic baseline is intentionally unsupported; "
        "it would destroy application data."
    )
