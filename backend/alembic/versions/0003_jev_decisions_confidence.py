"""jev_decisions: drop `description` (jev no longer writes text), add `confidence` (doc 07 "jev").

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-19 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("jev_decisions", "description")
    op.add_column("jev_decisions", sa.Column("confidence", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("jev_decisions", "confidence")
    op.add_column(
        "jev_decisions", sa.Column("description", sa.Text(), nullable=False, server_default="")
    )
