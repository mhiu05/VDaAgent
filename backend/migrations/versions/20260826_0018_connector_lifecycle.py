"""Add connector lifecycle metadata and reusable datasource references.

This migration is additive. Existing provider tables and source_ref values stay
valid so one previous application version can still read the database during
the rollout window.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260826_0018"
down_revision = "20260825_0017"
branch_labels = None
depends_on = None


def _add_column(table: str, column: sa.Column) -> None:
    inspector = inspect(op.get_bind())
    names = {item["name"] for item in inspector.get_columns(table)}
    if column.name not in names:
        op.add_column(table, column)


def _add_index(name: str, table: str, columns: list[str]) -> None:
    inspector = inspect(op.get_bind())
    names = {item["name"] for item in inspector.get_indexes(table)}
    if name not in names:
        op.create_index(name, table, columns)


def upgrade() -> None:
    for name, table in (
        ("google_drive_connections", "google_drive_connections"),
        ("google_calendar_connections", "google_calendar_connections"),
        ("datasource_connections", "datasource_connections"),
    ):
        # Keep this explicit so a partially restored database fails with a
        # useful migration error rather than silently losing lifecycle data.
        if not inspect(op.get_bind()).has_table(table):
            raise RuntimeError(f"Required table is missing: {table}")

    for column in (
        sa.Column("status", sa.String(32), nullable=False, server_default="connected"),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    ):
        _add_column("google_drive_connections", column.copy())

    for column in (
        sa.Column("status", sa.String(32), nullable=False, server_default="connected"),
        sa.Column("account_label", sa.String(320), nullable=True),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    ):
        _add_column("google_calendar_connections", column.copy())

    for column in (
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="connected"),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error_code", sa.String(64), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    ):
        _add_column("datasource_connections", column.copy())

    # Existing rows predate updated_at; use created_at before making it strict.
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE datasource_connections SET updated_at = created_at WHERE updated_at IS NULL"))
    op.alter_column("datasource_connections", "updated_at", nullable=False)

    _add_column(
        "datasets",
        sa.Column(
            "datasource_connection_id",
            sa.String(32),
            sa.ForeignKey("datasource_connections.id"),
            nullable=True,
        ),
    )
    _add_index(
        "ix_datasets_datasource_connection_id",
        "datasets",
        ["datasource_connection_id"],
    )
    _add_index(
        "ix_datasource_connections_workspace_status",
        "datasource_connections",
        ["workspace_id", "status", "deleted_at"],
    )
    _add_index(
        "ix_google_calendar_connections_owner",
        "google_calendar_connections",
        ["workspace_id", "user_id", "status"],
    )

    # Backfill references from the existing opaque source_ref format.
    bind.execute(
        sa.text(
            """
            UPDATE datasets
            SET datasource_connection_id = substring(source_ref from 14 for 32)
            WHERE source_ref LIKE 'datasource://%'
              AND datasource_connection_id IS NULL
              AND EXISTS (
                  SELECT 1 FROM datasource_connections dc
                  WHERE dc.id = substring(datasets.source_ref from 14 for 32)
              )
            """
        )
    )


def downgrade() -> None:
    # Keep downgrade conservative: dropping lifecycle columns would destroy
    # health data and is unsafe while an older application may still run.
    inspector = inspect(op.get_bind())
    if "ix_google_calendar_connections_owner" in {i["name"] for i in inspector.get_indexes("google_calendar_connections")}:
        op.drop_index("ix_google_calendar_connections_owner", table_name="google_calendar_connections")
    if "ix_datasource_connections_workspace_status" in {i["name"] for i in inspector.get_indexes("datasource_connections")}:
        op.drop_index("ix_datasource_connections_workspace_status", table_name="datasource_connections")
    if "ix_datasets_datasource_connection_id" in {i["name"] for i in inspector.get_indexes("datasets")}:
        op.drop_index("ix_datasets_datasource_connection_id", table_name="datasets")
    columns = {item["name"] for item in inspector.get_columns("datasets")}
    if "datasource_connection_id" in columns:
        op.drop_column("datasets", "datasource_connection_id")
