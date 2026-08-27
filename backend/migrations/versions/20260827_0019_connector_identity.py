"""Add connector fingerprints and durable idempotency records."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260827_0019"
down_revision = "20260826_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {item["name"] for item in inspector.get_columns("datasource_connections")}
    if "fingerprint" not in columns:
        op.add_column("datasource_connections", sa.Column("fingerprint", sa.String(64), nullable=True))
    indexes = {item["name"] for item in inspect(bind).get_indexes("datasource_connections")}
    if "uq_datasource_connections_workspace_fingerprint_active" not in indexes:
        op.create_index(
            "uq_datasource_connections_workspace_fingerprint_active",
            "datasource_connections",
            ["workspace_id", "kind", "fingerprint"],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL AND fingerprint IS NOT NULL"),
            sqlite_where=sa.text("deleted_at IS NULL AND fingerprint IS NOT NULL"),
        )
    if not inspect(bind).has_table("connector_idempotency"):
        op.create_table(
            "connector_idempotency",
            sa.Column("workspace_id", sa.String(36), nullable=False),
            sa.Column("idempotency_key", sa.String(255), nullable=False),
            sa.Column("request_hash", sa.String(64), nullable=False),
            sa.Column("connection_id", sa.String(32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.PrimaryKeyConstraint("workspace_id", "idempotency_key"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if inspector.has_table("connector_idempotency"):
        op.drop_table("connector_idempotency")
    if "uq_datasource_connections_workspace_fingerprint_active" in {item["name"] for item in inspector.get_indexes("datasource_connections")}:
        op.drop_index("uq_datasource_connections_workspace_fingerprint_active", table_name="datasource_connections")
    if "fingerprint" in {item["name"] for item in inspect(bind).get_columns("datasource_connections")}:
        op.drop_column("datasource_connections", "fingerprint")
