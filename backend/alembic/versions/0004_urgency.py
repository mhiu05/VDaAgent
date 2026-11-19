"""deliveries, jev_decisions: add `urgency` (doc 07 "jev") so a batched activation can surface a
more urgent message first.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-20 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "deliveries",
        sa.Column("urgency", sa.Text(), server_default=sa.text("'normal'"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_deliveries_urgency"), "deliveries", "urgency IN ('low', 'normal', 'high')"
    )
    op.add_column(
        "jev_decisions",
        sa.Column("urgency", sa.Text(), server_default=sa.text("'normal'"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_jev_decisions_urgency"), "jev_decisions", "urgency IN ('low', 'normal', 'high')"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_jev_decisions_urgency"), "jev_decisions", type_="check")
    op.drop_column("jev_decisions", "urgency")
    op.drop_constraint(op.f("ck_deliveries_urgency"), "deliveries", type_="check")
    op.drop_column("deliveries", "urgency")
