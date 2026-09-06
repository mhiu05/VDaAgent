"""Permanently remove retired Notebook tables and their data."""

from __future__ import annotations

from alembic import op
from sqlalchemy import inspect


revision = "20260820_0013"
down_revision = "20260819_0012"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in inspect(op.get_bind()).get_table_names(schema="public")


def upgrade() -> None:
    if _has_table("notebook_cells"):
        op.drop_table("notebook_cells")
    if _has_table("notebooks"):
        op.drop_table("notebooks")


def downgrade() -> None:
    raise NotImplementedError("Notebook retirement is irreversible.")
