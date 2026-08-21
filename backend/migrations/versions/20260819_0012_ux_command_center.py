"""Add additive persistence for the Profile Run Command Center.

The migration is intentionally inspect-before-create so it is safe for both
an empty database and instances created by the previous SQLAlchemy bootstrap.
No legacy Analysis, Notebook, or Report data is removed or renamed.
"""

from __future__ import annotations

from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect, select

revision = "20260819_0012"
down_revision = "20260815_0011"
branch_labels = None
depends_on = None


def _inspector():
    return inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names(schema="public")


def _has_column(table: str, name: str) -> bool:
    return any(
        column["name"] == name
        for column in _inspector().get_columns(table, schema="public")
    )


def _has_index(table: str, name: str) -> bool:
    return any(
        index["name"] == name
        for index in _inspector().get_indexes(table, schema="public")
    )


def _add_column(table: str, column: sa.Column) -> None:
    if not _has_column(table, column.name):
        op.add_column(table, column)


def _create_configuration_tables() -> None:
    if not _has_table("workspace_context_versions"):
        op.create_table(
            "workspace_context_versions",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("domain", sa.String(120)),
            sa.Column("primary_goal", sa.Text()),
            sa.Column("target_audience", sa.String(120)),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("created_by_user_id", sa.String(36), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "workspace_id",
                "version",
                name="uq_workspace_context_versions_workspace_version",
            ),
        )
        op.create_index(
            "ix_workspace_context_versions_workspace",
            "workspace_context_versions",
            ["workspace_id"],
        )
    if not _has_table("workspace_theme_versions"):
        op.create_table(
            "workspace_theme_versions",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column(
                "workspace_id",
                sa.String(36),
                sa.ForeignKey("workspaces.id"),
                nullable=False,
            ),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column(
                "primary_color", sa.String(7), nullable=False, server_default="#315EFB"
            ),
            sa.Column(
                "secondary_color",
                sa.String(7),
                nullable=False,
                server_default="#0F9D91",
            ),
            sa.Column(
                "tone", sa.String(32), nullable=False, server_default="professional"
            ),
            sa.Column(
                "default_language", sa.String(8), nullable=False, server_default="vi"
            ),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("created_by_user_id", sa.String(36), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.UniqueConstraint(
                "workspace_id",
                "version",
                name="uq_workspace_theme_versions_workspace_version",
            ),
        )
        op.create_index(
            "ix_workspace_theme_versions_workspace",
            "workspace_theme_versions",
            ["workspace_id"],
        )


def _create_report_items() -> None:
    if _has_table("report_items"):
        return
    op.create_table(
        "report_items",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "report_version_id",
            sa.String(32),
            sa.ForeignKey("report_versions.id"),
            nullable=False,
        ),
        sa.Column("item_type", sa.String(32), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("profile_run_id", sa.String(32), sa.ForeignKey("profile_runs.id")),
        sa.Column(
            "context_version_id",
            sa.String(32),
            sa.ForeignKey("semantic_context_versions.id"),
        ),
        sa.Column(
            "query_execution_id", sa.String(32), sa.ForeignKey("query_executions.id")
        ),
        sa.Column("agent_run_id", sa.String(32), sa.ForeignKey("agent_runs.id")),
        sa.Column("title", sa.String(255)),
        sa.Column("note", sa.Text()),
        sa.Column("content_json", sa.JSON()),
        sa.Column("query_spec", sa.JSON()),
        sa.Column("result_hash", sa.String(64)),
        sa.Column("quality_status", sa.String(32)),
        sa.Column("limitations", sa.JSON()),
        sa.Column("export_policy", sa.JSON()),
        sa.Column("idempotency_key", sa.String(255)),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
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
            "report_version_id",
            "idempotency_key",
            name="uq_report_items_version_idempotency",
        ),
    )
    op.create_index(
        "ix_report_items_version_position",
        "report_items",
        ["report_version_id", "position"],
    )
    op.create_index("ix_report_items_profile_run", "report_items", ["profile_run_id"])
    op.create_index("ix_report_items_execution", "report_items", ["query_execution_id"])
    op.create_index("ix_report_items_agent_run", "report_items", ["agent_run_id"])


def _backfill_workspace_versions() -> None:
    bind = op.get_bind()
    workspaces = sa.table(
        "workspaces", sa.column("id"), sa.column("created_by_user_id")
    )
    contexts = sa.table("workspace_context_versions", sa.column("workspace_id"))
    themes = sa.table("workspace_theme_versions", sa.column("workspace_id"))
    for workspace in bind.execute(
        select(workspaces.c.id, workspaces.c.created_by_user_id)
    ).mappings():
        if not bind.execute(
            select(contexts.c.workspace_id).where(
                contexts.c.workspace_id == workspace["id"]
            )
        ).first():
            bind.execute(
                sa.text(
                    "INSERT INTO workspace_context_versions "
                    "(id, workspace_id, version, status, created_by_user_id, "
                    "created_at) "
                    "VALUES (:id, :workspace_id, 1, 'active', :actor, now())"
                ),
                {
                    "id": uuid4().hex,
                    "workspace_id": workspace["id"],
                    "actor": workspace["created_by_user_id"],
                },
            )
        if not bind.execute(
            select(themes.c.workspace_id).where(
                themes.c.workspace_id == workspace["id"]
            )
        ).first():
            bind.execute(
                sa.text(
                    "INSERT INTO workspace_theme_versions "
                    "(id, workspace_id, version, primary_color, secondary_color, tone, "
                    "default_language, status, created_by_user_id, created_at) "
                    "VALUES (:id, :workspace_id, 1, '#315EFB', '#0F9D91', "
                    "'professional', 'vi', 'active', :actor, now())"
                ),
                {
                    "id": uuid4().hex,
                    "workspace_id": workspace["id"],
                    "actor": workspace["created_by_user_id"],
                },
            )


def upgrade() -> None:
    _create_configuration_tables()
    _add_column("reports", sa.Column("profile_run_id", sa.String(32), nullable=True))
    _add_column(
        "report_versions",
        sa.Column("workspace_context_version_id", sa.String(32), nullable=True),
    )
    _add_column(
        "report_versions",
        sa.Column("workspace_theme_version_id", sa.String(32), nullable=True),
    )
    _add_column(
        "report_versions", sa.Column("snapshot_hash", sa.String(64), nullable=True)
    )
    _add_column(
        "report_versions",
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column(
        "query_executions",
        sa.Column(
            "execution_kind", sa.String(16), nullable=False, server_default="official"
        ),
    )
    _add_column(
        "query_executions",
        sa.Column("status", sa.String(16), nullable=False, server_default="ready"),
    )
    _add_column(
        "query_executions",
        sa.Column("quality_gate_run_id", sa.String(32), nullable=True),
    )
    _add_column(
        "query_executions",
        sa.Column("requested_by_user_id", sa.String(36), nullable=True),
    )
    _add_column(
        "query_executions",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    _add_column(
        "query_executions", sa.Column("idempotency_key", sa.String(255), nullable=True)
    )
    if not _has_index("query_executions", "ix_query_executions_expires_at"):
        op.create_index(
            "ix_query_executions_expires_at", "query_executions", ["expires_at"]
        )
    if not _has_index("query_executions", "uq_query_executions_session_idempotency"):
        op.create_index(
            "uq_query_executions_session_idempotency",
            "query_executions",
            ["session_id", "idempotency_key"],
            unique=True,
        )
    _create_report_items()
    _backfill_workspace_versions()


def downgrade() -> None:
    # Downgrade only removes the additive schema. Existing legacy records stay intact.
    if _has_table("report_items"):
        op.drop_table("report_items")
    if _has_table("workspace_theme_versions"):
        op.drop_table("workspace_theme_versions")
    if _has_table("workspace_context_versions"):
        op.drop_table("workspace_context_versions")
