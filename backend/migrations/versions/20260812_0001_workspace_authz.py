"""Add workspace tenancy and report authorization metadata.

This migration is intentionally compatible with databases bootstrapped by the
pre-Alembic SQLAlchemy ``create_all`` path.  Those databases already contain
some or all of the tables, use ``VARCHAR(36)`` for UUID-shaped identifiers, and
may not have an ``alembic_version`` table yet.  A release migration must be
safe to run against that state without recreating tables or changing existing
data types.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260812_0001"
down_revision = None
branch_labels = None
depends_on = None


ID_TYPE = sa.String(36)


def _inspector():
    return inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names(schema="public")


def _has_column(table: str, column: str) -> bool:
    return any(item["name"] == column for item in _inspector().get_columns(table, schema="public"))


def _has_index(table: str, name: str) -> bool:
    return any(item["name"] == name for item in _inspector().get_indexes(table, schema="public"))


def _has_check(table: str, name: str) -> bool:
    return any(item.get("name") == name for item in _inspector().get_check_constraints(table, schema="public"))


def _ensure_column(table: str, column: str, column_type: sa.types.TypeEngine) -> None:
    if not _has_column(table, column):
        op.add_column(table, sa.Column(column, column_type, nullable=True))


def _ensure_index(table: str, name: str, columns: list[str]) -> None:
    if not _has_index(table, name):
        op.create_index(name, table, columns)


def _ensure_identity_tables() -> None:
    if not _has_table("user_profiles"):
        op.create_table(
            "user_profiles",
            sa.Column("user_id", ID_TYPE, primary_key=True),
            sa.Column("display_name", sa.String(255)),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    if not _has_table("workspaces"):
        op.create_table(
            "workspaces",
            sa.Column("id", ID_TYPE, primary_key=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("slug", sa.String(128), nullable=False, unique=True),
            sa.Column("created_by_user_id", ID_TYPE, nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("settings", sa.JSON()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    if not _has_table("workspace_memberships"):
        op.create_table(
            "workspace_memberships",
            sa.Column("workspace_id", ID_TYPE, primary_key=True),
            sa.Column("user_id", ID_TYPE, primary_key=True),
            sa.Column("role", sa.String(16), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    if not _has_table("workspace_invitations"):
        op.create_table(
            "workspace_invitations",
            sa.Column("id", ID_TYPE, primary_key=True),
            sa.Column("workspace_id", ID_TYPE, nullable=False),
            sa.Column("normalized_email", sa.String(320), nullable=False),
            sa.Column("role", sa.String(16), nullable=False),
            sa.Column("token_hash", sa.String(128), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("invited_by_user_id", ID_TYPE, nullable=False),
            sa.Column("accepted_by_user_id", ID_TYPE),
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )


def _ensure_report_tables() -> None:
    if not _has_table("reports"):
        op.create_table(
            "reports",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("workspace_id", ID_TYPE, nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("slug", sa.String(160), nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
            sa.Column("created_by_user_id", ID_TYPE, nullable=False),
            sa.Column("current_published_version_id", sa.String(32)),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    if not _has_table("report_versions"):
        op.create_table(
            "report_versions",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("report_id", sa.String(32), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
            sa.Column("executive_summary", sa.Text()),
            sa.Column("scope", sa.JSON()),
            sa.Column("time_range", sa.JSON()),
            sa.Column("submitted_by_user_id", ID_TYPE),
            sa.Column("submitted_at", sa.DateTime(timezone=True)),
            sa.Column("reviewed_by_user_id", ID_TYPE),
            sa.Column("reviewed_at", sa.DateTime(timezone=True)),
            sa.Column("published_by_user_id", ID_TYPE),
            sa.Column("published_at", sa.DateTime(timezone=True)),
            sa.Column("created_by_user_id", ID_TYPE, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("report_id", "version", name="uq_report_versions_report_version"),
        )
    if not _has_table("report_sections"):
        op.create_table(
            "report_sections",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("report_version_id", sa.String(32), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(32), nullable=False),
            sa.Column("title", sa.String(255)),
            sa.Column("content_json", sa.JSON(), nullable=False),
        )
    if not _has_table("report_visualizations"):
        op.create_table(
            "report_visualizations",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("report_version_id", sa.String(32), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("chart_type", sa.String(16), nullable=False),
            sa.Column("title", sa.String(255)),
            sa.Column("visualization_spec", sa.JSON(), nullable=False),
            sa.Column("query_execution_id", sa.String(32), nullable=False),
            sa.Column("result_hash", sa.String(64), nullable=False),
            sa.Column("result_snapshot", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    if not _has_table("report_reviews"):
        op.create_table(
            "report_reviews",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("report_version_id", sa.String(32), nullable=False),
            sa.Column("reviewer_user_id", ID_TYPE, nullable=False),
            sa.Column("decision", sa.String(24), nullable=False),
            sa.Column("comment", sa.Text()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )


def upgrade() -> None:
    _ensure_identity_tables()

    # These columns were added after the original SQLAlchemy schema.  Keep
    # them nullable until the explicit backfill job assigns tenant ownership.
    for table in ("datasets", "profile_runs", "analysis_sessions", "retrieval_documents"):
        _ensure_column(table, "workspace_id", ID_TYPE)
    for column in ("workspace_id", "actor_user_id"):
        _ensure_column("audit_events", column, ID_TYPE)
    audit_column_types = {
        "resource_type": sa.String(64),
        "resource_id": sa.String(255),
        "outcome": sa.String(32),
        "correlation_id": sa.String(128),
    }
    for column, column_type in audit_column_types.items():
        _ensure_column("audit_events", column, column_type)

    for table in ("datasets", "profile_runs", "analysis_sessions", "retrieval_documents", "audit_events"):
        _ensure_index(table, f"ix_{table}_workspace_id", ["workspace_id"])

    _ensure_report_tables()

    if not _has_check("workspace_memberships", "ck_membership_role"):
        op.create_check_constraint(
            "ck_membership_role",
            "workspace_memberships",
            "role IN ('owner','admin','analyst','viewer')",
        )
    if not _has_check("workspace_memberships", "ck_membership_status"):
        op.create_check_constraint(
            "ck_membership_status",
            "workspace_memberships",
            "status IN ('active','suspended','removed')",
        )

    # Browser Data API access is deny-by-default.  FastAPI still applies the
    # tenant predicate and capability check for every request.
    for table in (
        "user_profiles", "workspaces", "workspace_memberships", "workspace_invitations",
        "reports", "report_versions", "report_sections", "report_visualizations", "report_reviews",
        "datasets", "profile_runs", "analysis_sessions", "retrieval_documents", "audit_events",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Intentionally no destructive rollback: reverting an application release
    # must retain workspace columns, backfilled memberships and evidence.
    pass
