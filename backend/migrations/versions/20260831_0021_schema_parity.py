"""Reconcile additive metadata constraints and indexes with the application model.

The original release migrations intentionally omitted a few foreign keys and
used shorter index names while rolling out tenant adoption. Keep those
physical structures where they are useful, but add the current model's missing
columns, constraints, and lookup indexes in a data-preserving migration.
"""

from __future__ import annotations

import hashlib

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260831_0021"
down_revision = "20260827_0020"
branch_labels = None
depends_on = None


def _inspector():
    return inspect(op.get_bind())


def _has_column(table: str, column: str) -> bool:
    return any(c["name"] == column for c in _inspector().get_columns(table))


def _has_index(table: str, name: str) -> bool:
    return any(i["name"] == name for i in _inspector().get_indexes(table))


def _has_fk(
    table: str, columns: list[str], referred_table: str, referred_columns: list[str]
) -> bool:
    for fk in _inspector().get_foreign_keys(table):
        if (
            fk.get("constrained_columns") == columns
            and fk.get("referred_table") == referred_table
            and fk.get("referred_columns") == referred_columns
        ):
            return True
    return False


def _add_fk(table: str, columns: list[str], referred_table: str, referred_columns: list[str]) -> None:
    if not _has_fk(table, columns, referred_table, referred_columns):
        raw_name = f"fk_{table}_{'_'.join(columns)}_{referred_table}"
        # PostgreSQL limits identifiers to 63 bytes. Keep names readable where
        # possible and append a stable digest when truncation is required.
        name = (
            raw_name
            if len(raw_name) <= 63
            else raw_name[:50] + "_" + hashlib.sha1(raw_name.encode()).hexdigest()[:10]
        )
        op.create_foreign_key(name, table, referred_table, columns, referred_columns)


def _add_index(table: str, name: str, columns: list[str]) -> None:
    if not _has_index(table, name):
        op.create_index(name, table, columns)


def _rename_index(table: str, old: str, new: str) -> None:
    if _has_index(table, old) and not _has_index(table, new):
        op.execute(sa.text(f'ALTER INDEX "{old}" RENAME TO "{new}"'))


def _backfill_legacy_workspaces() -> None:
    """Preserve legacy tenant rows before enforcing workspace foreign keys."""
    bind = op.get_bind()
    workspace_tables = (
        "analysis_sessions",
        "audit_events",
        "datasets",
        "datasource_connections",
        "profile_runs",
        "reports",
        "retrieval_documents",
        "workspace_invitations",
        "workspace_memberships",
    )
    for table in workspace_tables:
        if not _has_column(table, "workspace_id"):
            continue
        orphan_ids = bind.execute(
            sa.text(
                f"""
                SELECT DISTINCT child.workspace_id
                FROM {table} AS child
                LEFT JOIN workspaces AS workspace ON workspace.id = child.workspace_id
                WHERE child.workspace_id IS NOT NULL AND workspace.id IS NULL
                """
            )
        ).scalars()
        for workspace_id in orphan_ids:
            digest = hashlib.sha1(workspace_id.encode()).hexdigest()[:16]
            bind.execute(
                sa.text(
                    """
                    INSERT INTO workspaces (id, name, slug, created_by_user_id, status)
                    VALUES (:id, :name, :slug, :created_by_user_id, 'active')
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": workspace_id,
                    "name": f"Legacy workspace {workspace_id}",
                    "slug": f"legacy-{digest}",
                    "created_by_user_id": "legacy-system",
                },
            )


def upgrade() -> None:
    user_columns = {c["name"] for c in _inspector().get_columns("user_profiles")}
    if "role" not in user_columns:
        op.add_column(
            "user_profiles",
            sa.Column("role", sa.String(16), nullable=False, server_default="analyst"),
        )
    if "status" not in user_columns:
        op.add_column(
            "user_profiles",
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        )
    if "locked_reason" not in user_columns:
        op.add_column("user_profiles", sa.Column("locked_reason", sa.Text()))
    if "locked_at" not in user_columns:
        op.add_column("user_profiles", sa.Column("locked_at", sa.DateTime(timezone=True)))
    if "locked_by_user_id" not in user_columns:
        op.add_column("user_profiles", sa.Column("locked_by_user_id", sa.String(36)))

    # Early authz bootstrap helpers added these columns as nullable. Fill only
    # missing values with their documented defaults, then enforce the model's
    # non-null contract. No existing non-null value is changed.
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE user_profiles SET role = 'analyst' WHERE role IS NULL"))
    bind.execute(sa.text("UPDATE user_profiles SET status = 'active' WHERE status IS NULL"))
    op.alter_column("user_profiles", "role", nullable=False)
    op.alter_column("user_profiles", "status", nullable=False)

    _backfill_legacy_workspaces()

    # Preserve existing rollout-era indexes by renaming them to the model's
    # canonical names rather than building duplicate physical indexes.
    for table, old, new in (
        ("report_items", "ix_report_items_profile_run", "ix_report_items_profile_run_id"),
        ("report_items", "ix_report_items_execution", "ix_report_items_query_execution_id"),
        ("report_items", "ix_report_items_agent_run", "ix_report_items_agent_run_id"),
        (
            "workspace_context_versions",
            "ix_workspace_context_versions_workspace",
            "ix_workspace_context_versions_workspace_id",
        ),
        (
            "workspace_theme_versions",
            "ix_workspace_theme_versions_workspace",
            "ix_workspace_theme_versions_workspace_id",
        ),
    ):
        _rename_index(table, old, new)

    for table, name, columns in (
        ("audit_events", "ix_audit_events_actor_user_id", ["actor_user_id"]),
        ("report_items", "ix_report_items_context_version_id", ["context_version_id"]),
        ("report_items", "ix_report_items_report_version_id", ["report_version_id"]),
        ("report_reviews", "ix_report_reviews_report_version_id", ["report_version_id"]),
        ("report_sections", "ix_report_sections_report_version_id", ["report_version_id"]),
        ("report_versions", "ix_report_versions_report_id", ["report_id"]),
        (
            "report_visualizations",
            "ix_report_visualizations_report_version_id",
            ["report_version_id"],
        ),
        ("reports", "ix_reports_profile_run_id", ["profile_run_id"]),
        ("reports", "ix_reports_workspace_id", ["workspace_id"]),
        ("user_profiles", "ix_user_profiles_status", ["status"]),
        (
            "workspace_invitations",
            "ix_workspace_invitations_normalized_email",
            ["normalized_email"],
        ),
        ("workspace_invitations", "ix_workspace_invitations_workspace_id", ["workspace_id"]),
        ("workspace_memberships", "ix_workspace_memberships_status", ["status"]),
    ):
        _add_index(table, name, columns)

    for table, columns, referred_table, referred_columns in (
        ("analysis_sessions", ["workspace_id"], "workspaces", ["id"]),
        ("audit_events", ["workspace_id"], "workspaces", ["id"]),
        ("datasets", ["workspace_id"], "workspaces", ["id"]),
        ("datasource_connections", ["workspace_id"], "workspaces", ["id"]),
        ("profile_runs", ["workspace_id"], "workspaces", ["id"]),
        ("query_executions", ["quality_gate_run_id"], "quality_gate_runs", ["id"]),
        ("report_reviews", ["report_version_id"], "report_versions", ["id"]),
        ("report_sections", ["report_version_id"], "report_versions", ["id"]),
        ("report_versions", ["report_id"], "reports", ["id"]),
        (
            "report_versions",
            ["workspace_context_version_id"],
            "workspace_context_versions",
            ["id"],
        ),
        (
            "report_versions",
            ["workspace_theme_version_id"],
            "workspace_theme_versions",
            ["id"],
        ),
        ("report_visualizations", ["query_execution_id"], "query_executions", ["id"]),
        ("report_visualizations", ["report_version_id"], "report_versions", ["id"]),
        ("reports", ["workspace_id"], "workspaces", ["id"]),
        ("reports", ["profile_run_id"], "profile_runs", ["id"]),
        ("retrieval_documents", ["workspace_id"], "workspaces", ["id"]),
        ("workspace_invitations", ["workspace_id"], "workspaces", ["id"]),
        ("workspace_memberships", ["workspace_id"], "workspaces", ["id"]),
    ):
        _add_fk(table, columns, referred_table, referred_columns)


def downgrade() -> None:
    # This reconciliation is intentionally non-destructive. Removing the
    # constraints/indexes would make rollback unsafe for a live database.
    pass
