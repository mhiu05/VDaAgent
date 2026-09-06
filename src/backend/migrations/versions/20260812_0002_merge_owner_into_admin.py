"""Merge the retired owner role into admin."""

from __future__ import annotations

from alembic import op

revision = "20260812_0002"
down_revision = "20260812_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE workspace_memberships SET role = 'admin' WHERE role = 'owner'")
    op.drop_constraint("ck_membership_role", "workspace_memberships", type_="check")
    op.create_check_constraint(
        "ck_membership_role",
        "workspace_memberships",
        "role IN ('admin','analyst','viewer')",
    )


def downgrade() -> None:
    # There is no safe one-to-one mapping from unified admins back to owners.
    pass
