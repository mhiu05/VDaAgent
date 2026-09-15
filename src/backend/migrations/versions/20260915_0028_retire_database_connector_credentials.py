"""Allow retired datasource credentials to be removed permanently.

The companion ``scripts/retire_database_connectors.py`` command performs the
data rollout explicitly. Schema migration stays separate so an operator can
inventory and approve credential removal before executing it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "20260915_0028"
down_revision = "20260915_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if not inspector.has_table("datasource_connections"):
        raise RuntimeError("Required table datasource_connections is missing.")
    columns = {
        column["name"]: column for column in inspector.get_columns("datasource_connections")
    }
    config = columns.get("config_encrypted")
    if config is None:
        raise RuntimeError("Required column datasource_connections.config_encrypted is missing.")
    if not bool(config.get("nullable")):
        op.alter_column(
            "datasource_connections",
            "config_encrypted",
            existing_type=sa.Text(),
            nullable=True,
        )


def downgrade() -> None:
    # A credential purge is intentionally irreversible. Refusing to restore
    # NOT NULL prevents a downgrade from either failing unpredictably on
    # tombstones or inventing a replacement value that could look like a key.
    raise RuntimeError(
        "Refusing to restore datasource_connections.config_encrypted to NOT NULL; "
        "retired connector credentials may have been permanently removed."
    )
