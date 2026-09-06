"""Add durable queue metadata to profile runs."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260823_0015"
down_revision = "20260822_0014"
branch_labels = None
depends_on = None

_COLUMNS = (
    sa.Column("created_by_user_id", sa.String(36)),
    sa.Column("agent_run_id", sa.String(32)),
    sa.Column("job_status", sa.String(16)),
    sa.Column("job_stage", sa.String(32)),
    sa.Column("job_idempotency_key", sa.String(255)),
    sa.Column("job_request_hash", sa.String(64)),
    sa.Column("job_correlation_id", sa.String(128)),
    sa.Column(
        "job_attempt_count", sa.Integer(), nullable=False, server_default="0"
    ),
    sa.Column("job_max_attempts", sa.Integer(), nullable=False, server_default="3"),
    sa.Column("job_available_at", sa.DateTime(timezone=True)),
    sa.Column("job_started_at", sa.DateTime(timezone=True)),
    sa.Column("job_finished_at", sa.DateTime(timezone=True)),
    sa.Column("job_heartbeat_at", sa.DateTime(timezone=True)),
    sa.Column("job_lease_expires_at", sa.DateTime(timezone=True)),
    sa.Column("job_claim_token", sa.String(64)),
    sa.Column("job_worker_id", sa.String(128)),
    sa.Column("job_error_code", sa.String(64)),
    sa.Column("job_error_message", sa.String(512)),
    sa.Column("job_payload", sa.JSON()),
)


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    existing_columns = {
        column["name"] for column in inspector.get_columns("profile_runs")
    }
    for column in _COLUMNS:
        if column.name not in existing_columns:
            op.add_column("profile_runs", column)

    inspector = inspect(op.get_bind())
    constraints = {
        item["name"] for item in inspector.get_unique_constraints("profile_runs")
    }
    unique_name = "uq_profile_runs_workspace_actor_idempotency"
    # Development/test compatibility uses an equivalent unique index. Do not
    # add a second physical structure when that index already exists.
    indexes = {item["name"] for item in inspector.get_indexes("profile_runs")}
    if unique_name not in constraints and unique_name not in indexes:
        op.create_unique_constraint(
            unique_name,
            "profile_runs",
            ["workspace_id", "created_by_user_id", "job_idempotency_key"],
        )
    claim_index = "ix_profile_runs_job_claim"
    if claim_index not in indexes:
        op.create_index(
            claim_index,
            "profile_runs",
            ["job_status", "job_available_at", "created_at"],
        )


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    indexes = {item["name"] for item in inspector.get_indexes("profile_runs")}
    claim_index = "ix_profile_runs_job_claim"
    if claim_index in indexes:
        op.drop_index(claim_index, table_name="profile_runs")
    unique_name = "uq_profile_runs_workspace_actor_idempotency"
    constraints = {
        item["name"] for item in inspector.get_unique_constraints("profile_runs")
    }
    if unique_name in constraints:
        op.drop_constraint(unique_name, "profile_runs", type_="unique")
    elif unique_name in indexes:
        op.drop_index(unique_name, table_name="profile_runs")

    existing_columns = {
        column["name"] for column in inspect(op.get_bind()).get_columns("profile_runs")
    }
    for column in reversed(_COLUMNS):
        if column.name in existing_columns:
            op.drop_column("profile_runs", column.name)
