"""Add additive, tenant-scoped agent runtime trace and evidence tables.

The migration is intentionally expand-only.  Existing profile/analysis domain
tables remain the compatibility projection; no legacy row is rewritten and
rollback never drops provenance from a partially deployed release.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260813_0004"
down_revision = "20260812_0003"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in inspect(op.get_bind()).get_table_names(schema="public")


def _has_index(table: str, name: str) -> bool:
    return any(
        item["name"] == name
        for item in inspect(op.get_bind()).get_indexes(table, schema="public")
    )


def _has_column(table: str, column: str) -> bool:
    return any(
        item["name"] == column
        for item in inspect(op.get_bind()).get_columns(table, schema="public")
    )


def _index(name: str, table: str, columns: list[str]) -> None:
    if not _has_index(table, name):
        op.create_index(name, table, columns)


def upgrade() -> None:
    # Upload provenance is additive to the existing dataset/profile contract.
    # Existing sources remain readable but cannot be advertised as content-pinned
    # until a deliberate backfill/re-profile operation records a hash.
    if not _has_column("datasets", "content_sha256"):
        op.add_column("datasets", sa.Column("content_sha256", sa.String(64)))
    if not _has_column("datasets", "source_version"):
        op.add_column("datasets", sa.Column("source_version", sa.String(255)))
    if not _has_column("profile_runs", "source_content_sha256"):
        op.add_column("profile_runs", sa.Column("source_content_sha256", sa.String(64)))
    if not _has_column("profile_runs", "source_version"):
        op.add_column("profile_runs", sa.Column("source_version", sa.String(255)))

    if not _has_table("agent_runs"):
        op.create_table(
            "agent_runs",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("actor_user_id", sa.String(36)),
            sa.Column("run_type", sa.String(32), nullable=False),
            sa.Column(
                "status", sa.String(32), nullable=False, server_default="created"
            ),
            sa.Column("resource_bindings", sa.JSON(), nullable=False),
            sa.Column("correlation_id", sa.String(128)),
            sa.Column("idempotency_key", sa.String(255)),
            sa.Column("request_hash", sa.String(71)),
            sa.Column("runtime_version", sa.String(64), nullable=False),
            sa.Column("policy_version", sa.String(64), nullable=False),
            sa.Column("version_snapshot", sa.JSON(), nullable=False),
            sa.Column("budget", sa.JSON(), nullable=False),
            sa.Column("usage", sa.JSON(), nullable=False),
            sa.Column(
                "trace_sequence", sa.Integer(), nullable=False, server_default="0"
            ),
            sa.Column("error_code", sa.String(64)),
            sa.Column("error_summary", sa.String(512)),
            sa.Column("started_at", sa.DateTime(timezone=True)),
            sa.Column("ended_at", sa.DateTime(timezone=True)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    _index(
        "ix_agent_runs_workspace_created_at",
        "agent_runs",
        ["workspace_id", "created_at"],
    )
    _index("ix_agent_runs_workspace_status", "agent_runs", ["workspace_id", "status"])

    if not _has_table("agent_plans"):
        op.create_table(
            "agent_plans",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("plan_version", sa.Integer(), nullable=False),
            sa.Column("schema_version", sa.String(32), nullable=False),
            sa.Column("plan_hash", sa.String(71), nullable=False),
            sa.Column("plan", sa.JSON(), nullable=False),
            sa.Column("validation_status", sa.String(32), nullable=False),
            sa.Column("superseded_by_plan_id", sa.String(32)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "agent_run_id", "plan_version", name="uq_agent_plans_run_version"
            ),
        )
    _index(
        "ix_agent_plans_workspace_created_at",
        "agent_plans",
        ["workspace_id", "created_at"],
    )

    if not _has_table("agent_steps"):
        op.create_table(
            "agent_steps",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("step_key", sa.String(128), nullable=False),
            sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("step_type", sa.String(32), nullable=False),
            sa.Column("target_name", sa.String(128), nullable=False),
            sa.Column("target_version", sa.String(64)),
            sa.Column("depends_on", sa.JSON(), nullable=False),
            sa.Column("reason_code", sa.String(64)),
            sa.Column("reason_summary", sa.String(240)),
            sa.Column("approval_rule", sa.String(64)),
            sa.Column(
                "status", sa.String(32), nullable=False, server_default="pending"
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "agent_run_id", "step_key", name="uq_agent_steps_run_key"
            ),
        )
    _index(
        "ix_agent_steps_workspace_created_at",
        "agent_steps",
        ["workspace_id", "created_at"],
    )
    _index("ix_agent_steps_run_status", "agent_steps", ["agent_run_id", "status"])

    if not _has_table("agent_step_attempts"):
        op.create_table(
            "agent_step_attempts",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_step_id",
                sa.String(32),
                sa.ForeignKey("agent_steps.id"),
                nullable=False,
            ),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("attempt_number", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("input_hash", sa.String(71)),
            sa.Column("output_hash", sa.String(71)),
            sa.Column("retry_classification", sa.String(64)),
            sa.Column("error_code", sa.String(64)),
            sa.Column("error_summary", sa.String(512)),
            sa.Column("checkpoint", sa.JSON()),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ended_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint(
                "agent_step_id",
                "attempt_number",
                name="uq_agent_step_attempts_step_number",
            ),
        )
    _index(
        "ix_agent_step_attempts_workspace_started_at",
        "agent_step_attempts",
        ["workspace_id", "started_at"],
    )

    if not _has_table("model_invocations"):
        op.create_table(
            "model_invocations",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column(
                "step_attempt_id",
                sa.String(32),
                sa.ForeignKey("agent_step_attempts.id"),
            ),
            sa.Column("provider", sa.String(64), nullable=False),
            sa.Column("model_id", sa.String(255), nullable=False),
            sa.Column("parameters_hash", sa.String(71), nullable=False),
            sa.Column("prompt_id", sa.String(128)),
            sa.Column("prompt_version", sa.String(64)),
            sa.Column("prompt_hash", sa.String(71)),
            sa.Column("request_hash", sa.String(71), nullable=False),
            sa.Column("response_hash", sa.String(71)),
            sa.Column("input_tokens", sa.Integer()),
            sa.Column("output_tokens", sa.Integer()),
            sa.Column("estimated_cost", sa.Float()),
            sa.Column(
                "usage_status", sa.String(32), nullable=False, server_default="unknown"
            ),
            sa.Column("latency_ms", sa.Integer()),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("error_code", sa.String(64)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    _index(
        "ix_model_invocations_workspace_created_at",
        "model_invocations",
        ["workspace_id", "created_at"],
    )

    if not _has_table("tool_invocations"):
        op.create_table(
            "tool_invocations",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column(
                "step_attempt_id",
                sa.String(32),
                sa.ForeignKey("agent_step_attempts.id"),
            ),
            sa.Column("tool_name", sa.String(128), nullable=False),
            sa.Column("tool_version", sa.String(64)),
            sa.Column("sanitized_args", sa.JSON(), nullable=False),
            sa.Column("reason_code", sa.String(64)),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("timeout_ms", sa.Integer()),
            sa.Column(
                "attempt_number", sa.Integer(), nullable=False, server_default="1"
            ),
            sa.Column("latency_ms", sa.Integer()),
            sa.Column("result_hash", sa.String(71)),
            sa.Column("error_code", sa.String(64)),
            sa.Column("evidence_ids", sa.JSON(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    _index(
        "ix_tool_invocations_workspace_created_at",
        "tool_invocations",
        ["workspace_id", "created_at"],
    )

    if not _has_table("evidence_items"):
        op.create_table(
            "evidence_items",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column(
                "profile_run_id", sa.String(32), sa.ForeignKey("profile_runs.id")
            ),
            sa.Column("context_version_id", sa.String(32)),
            sa.Column(
                "execution_id", sa.String(32), sa.ForeignKey("query_executions.id")
            ),
            sa.Column("artifact_type", sa.String(64), nullable=False),
            sa.Column("artifact_id", sa.String(128), nullable=False),
            sa.Column("field_path", sa.String(512), nullable=False),
            sa.Column("value", sa.JSON()),
            sa.Column("unit", sa.String(64)),
            sa.Column(
                "is_approximate",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("limitations", sa.JSON(), nullable=False),
            sa.Column("source_hash", sa.String(71), nullable=False),
            sa.Column("source_version", sa.String(255)),
            sa.Column(
                "producer_invocation_id",
                sa.String(32),
                sa.ForeignKey("tool_invocations.id"),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    _index(
        "ix_evidence_items_workspace_created_at",
        "evidence_items",
        ["workspace_id", "created_at"],
    )

    if not _has_table("verification_runs"):
        op.create_table(
            "verification_runs",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("answer_hash", sa.String(71), nullable=False),
            sa.Column("claim_hash", sa.String(71), nullable=False),
            sa.Column("verifier_version", sa.String(64), nullable=False),
            sa.Column("outcome", sa.String(32), nullable=False),
            sa.Column("violations", sa.JSON(), nullable=False),
            sa.Column("recovery_decision", sa.String(64)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    _index(
        "ix_verification_runs_workspace_created_at",
        "verification_runs",
        ["workspace_id", "created_at"],
    )

    if not _has_table("approval_requests"):
        op.create_table(
            "approval_requests",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("plan_hash", sa.String(71), nullable=False),
            sa.Column("plan_version", sa.Integer(), nullable=False),
            sa.Column("step_id", sa.String(32)),
            sa.Column("capability_version", sa.String(64)),
            sa.Column("context_version", sa.String(64)),
            sa.Column("policy_version", sa.String(64), nullable=False),
            sa.Column("risk_level", sa.String(32), nullable=False),
            sa.Column("preview", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("approver_user_id", sa.String(36)),
            sa.Column("decision_note", sa.String(512)),
            sa.Column("expires_at", sa.DateTime(timezone=True)),
            sa.Column("invalidation_reason", sa.String(255)),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )
    _index(
        "ix_approval_requests_workspace_created_at",
        "approval_requests",
        ["workspace_id", "created_at"],
    )

    if not _has_table("agent_trace_events"):
        op.create_table(
            "agent_trace_events",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "agent_run_id",
                sa.String(32),
                sa.ForeignKey("agent_runs.id"),
                nullable=False,
            ),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(64), nullable=False),
            sa.Column("status", sa.String(64)),
            sa.Column("reason_code", sa.String(64)),
            sa.Column("reason_summary", sa.String(240)),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column(
                "schema_version", sa.String(32), nullable=False, server_default="1"
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "agent_run_id", "sequence", name="uq_agent_trace_events_run_sequence"
            ),
        )
    _index(
        "ix_agent_trace_events_workspace_created_at",
        "agent_trace_events",
        ["workspace_id", "created_at"],
    )

    # Browser Data API remains deny-by-default. FastAPI applies both the
    # workspace predicate and capability guard on every public trace request.
    for table in (
        "agent_runs",
        "agent_plans",
        "agent_steps",
        "agent_step_attempts",
        "model_invocations",
        "tool_invocations",
        "evidence_items",
        "verification_runs",
        "approval_requests",
        "agent_trace_events",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Never destructively remove in-flight run provenance during rollback.
    pass
