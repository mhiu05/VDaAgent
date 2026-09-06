"""Collapse workspace roles to the single Analyst role."""

from __future__ import annotations

from alembic import op

revision = "20260815_0010"
down_revision = "20260815_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing workspaces remain available; only their obsolete role labels
    # are normalized. Invitations must follow the same rule or they could
    # reintroduce a removed role later.
    op.execute(
        "UPDATE workspace_memberships SET role = 'analyst' "
        "WHERE role IN ('owner', 'admin', 'viewer')"
    )
    op.execute(
        "UPDATE workspace_invitations SET role = 'analyst' "
        "WHERE role IN ('owner', 'admin', 'viewer')"
    )
    op.drop_constraint("ck_membership_role", "workspace_memberships", type_="check")
    op.create_check_constraint(
        "ck_membership_role",
        "workspace_memberships",
        "role = 'analyst'",
    )


def downgrade() -> None:
    # The original role cannot be reconstructed after normalization. Reopen
    # the legacy constraint only so an older application can be rolled back;
    # all existing rows intentionally remain Analyst.
    op.drop_constraint("ck_membership_role", "workspace_memberships", type_="check")
    op.create_check_constraint(
        "ck_membership_role",
        "workspace_memberships",
        "role IN ('owner', 'admin', 'analyst', 'viewer')",
    )
