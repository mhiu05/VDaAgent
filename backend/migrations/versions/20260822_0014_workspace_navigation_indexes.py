"""Add indexes for workspace bootstrap and authorization lookups."""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect

revision = "20260822_0014"
down_revision = "20260820_0013"
branch_labels = None
depends_on = None


def _has_index(table: str, name: str) -> bool:
    indexes = inspect(op.get_bind()).get_indexes(table)
    return any(index["name"] == name for index in indexes)


def upgrade() -> None:
    index_name = "ix_workspace_memberships_user_status_created"
    if not _has_index("workspace_memberships", index_name):
        op.create_index(
            index_name,
            "workspace_memberships",
            ["user_id", "status", "created_at"],
        )


def downgrade() -> None:
    index_name = "ix_workspace_memberships_user_status_created"
    if _has_index("workspace_memberships", index_name):
        op.drop_index(index_name, table_name="workspace_memberships")
