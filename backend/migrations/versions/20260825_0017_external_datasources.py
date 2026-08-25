"""Persist encrypted external datasource connection metadata."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260825_0017"
down_revision = "20260825_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "datasource_connections" not in inspect(op.get_bind()).get_table_names():
        op.create_table(
            "datasource_connections",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("workspace_id", sa.String(36), nullable=False),
            sa.Column("created_by_user_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("kind", sa.String(32), nullable=False),
            sa.Column("config_encrypted", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
        op.create_index("ix_datasource_connections_workspace_id", "datasource_connections", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_datasource_connections_workspace_id", table_name="datasource_connections")
    op.drop_table("datasource_connections")
