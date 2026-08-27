"""Remove Google Calendar connection and OAuth state tables."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "20260827_0020"
down_revision = "20260827_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    for index in ("ix_google_calendar_connections_owner", "ix_google_calendar_oauth_states_workspace_id"):
        for table in ("google_calendar_connections", "google_calendar_oauth_states"):
            if inspector.has_table(table) and index in {item["name"] for item in inspector.get_indexes(table)}:
                op.drop_index(index, table_name=table)
    for table in ("google_calendar_oauth_states", "google_calendar_connections"):
        if inspect(bind).has_table(table):
            op.drop_table(table)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if not inspector.has_table("google_calendar_connections"):
        op.create_table(
            "google_calendar_connections",
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), primary_key=True),
            sa.Column("user_id", sa.String(36), primary_key=True),
            sa.Column("calendar_id", sa.String(255), nullable=False, server_default="primary"),
            sa.Column("encrypted_refresh_token", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="connected"),
            sa.Column("account_label", sa.String(320), nullable=True),
            sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_code", sa.String(64), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        )
        op.create_index("ix_google_calendar_connections_owner", "google_calendar_connections", ["workspace_id", "user_id", "status"])
    if not inspect(bind).has_table("google_calendar_oauth_states"):
        op.create_table(
            "google_calendar_oauth_states",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_google_calendar_oauth_states_workspace_id", "google_calendar_oauth_states", ["workspace_id"])
