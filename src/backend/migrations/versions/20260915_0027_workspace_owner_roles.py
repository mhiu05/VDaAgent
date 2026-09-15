"""Restore Owner/Analyst workspace roles without silently losing ownership.

This revision deliberately fails before changing constraints when an active
non-guest workspace has no active member to own it. Operators must repair or
archive those orphaned tenants from a reviewed membership backup instead of
accepting an arbitrary or hidden privilege decision during deployment.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "20260915_0027"
down_revision = "20260901_0026"
branch_labels = None
depends_on = None


def _has_check(table_name: str, constraint_name: str) -> bool:
    return any(
        item.get("name") == constraint_name
        for item in inspect(op.get_bind()).get_check_constraints(table_name)
    )


def _workspace_rows() -> list[tuple[str, str]]:
    return [
        (str(row["id"]), str(row["status"]))
        for row in op.get_bind()
        .execute(
            sa.text(
                "SELECT id, status FROM workspaces "
                "WHERE status IN ('active', 'archived') "
                "AND COALESCE(settings ->> 'guest', 'false') <> 'true'"
            )
        )
        .mappings()
    ]


def _promote_initial_owners() -> None:
    bind = op.get_bind()
    orphaned: list[str] = []
    for workspace_id, workspace_status in _workspace_rows():
        # Prefer the active creator membership when its profile can actually
        # enter the workspace. This preserves the original authority
        # relationship without assigning Owner to a System Admin, locked, or
        # deleted account.
        bind.execute(
            sa.text(
                """
                UPDATE workspace_memberships AS membership
                SET role = 'owner'
                FROM workspaces AS workspace, user_profiles AS profile
                WHERE membership.workspace_id = workspace.id
                  AND workspace.id = :workspace_id
                  AND membership.user_id = workspace.created_by_user_id
                  AND membership.status = 'active'
                  AND profile.user_id = membership.user_id
                  AND profile.status = 'active'
                  AND COALESCE(profile.role, 'analyst') <> 'admin'
                """
            ),
            {"workspace_id": workspace_id},
        )
        owner_exists = bind.execute(
            sa.text(
                """
                SELECT 1
                FROM workspace_memberships AS membership
                JOIN user_profiles AS profile ON profile.user_id = membership.user_id
                WHERE membership.workspace_id = :workspace_id
                  AND membership.status = 'active'
                  AND membership.role = 'owner'
                  AND profile.status = 'active'
                  AND COALESCE(profile.role, 'analyst') <> 'admin'
                """
            ),
            {"workspace_id": workspace_id},
        ).first()
        if owner_exists:
            continue

        # Creator could have been removed. Pick the longest-lived active
        # membership as the documented deterministic fallback.
        fallback_user_id = bind.execute(
            sa.text(
                """
                SELECT membership.user_id
                FROM workspace_memberships AS membership
                JOIN user_profiles AS profile ON profile.user_id = membership.user_id
                WHERE membership.workspace_id = :workspace_id
                  AND membership.status = 'active'
                  AND profile.status = 'active'
                  AND COALESCE(profile.role, 'analyst') <> 'admin'
                ORDER BY membership.created_at ASC, membership.user_id ASC
                LIMIT 1
                """
            ),
            {"workspace_id": workspace_id},
        ).scalar_one_or_none()
        if fallback_user_id is None:
            # An archived workspace is not currently accessible, but still
            # gets backfilled whenever a valid former member exists. A truly
            # orphaned archived workspace can remain archived for a manual
            # recovery; only an active tenant blocks deployment.
            if workspace_status == "active":
                orphaned.append(workspace_id)
            continue
        bind.execute(
            sa.text(
                """
                UPDATE workspace_memberships
                SET role = 'owner'
                WHERE workspace_id = :workspace_id AND user_id = :user_id
                """
            ),
            {"workspace_id": workspace_id, "user_id": fallback_user_id},
        )

    if orphaned:
        sample = ", ".join(orphaned[:20])
        suffix = "" if len(orphaned) <= 20 else f" (+{len(orphaned) - 20} more)"
        raise RuntimeError(
            "Cannot migrate active workspaces without an active membership: "
            f"{sample}{suffix}. Restore or repair memberships from the pre-migration backup."
        )


def upgrade() -> None:
    bind = op.get_bind()

    # Fail closed for membership values that are no longer part of the public
    # contract. Invitation records must not reintroduce an elevated role later.
    bind.execute(
        sa.text(
            """
            UPDATE workspace_memberships
            SET role = 'analyst'
            WHERE role IS NULL OR role NOT IN ('owner', 'analyst')
            """
        )
    )
    # Guest tenants are intentionally isolated Analyst workspaces. They are
    # excluded from Owner backfill and any legacy elevated membership is
    # flattened before the new role constraint is installed.
    bind.execute(
        sa.text(
            """
            UPDATE workspace_memberships AS membership
            SET role = 'analyst'
            FROM workspaces AS workspace
            WHERE membership.workspace_id = workspace.id
              AND COALESCE(workspace.settings ->> 'guest', 'false') = 'true'
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE workspace_invitations
            SET role = 'analyst'
            WHERE role IS NULL OR role <> 'analyst'
            """
        )
    )
    _promote_initial_owners()

    if _has_check("workspace_memberships", "ck_membership_role"):
        op.drop_constraint(
            "ck_membership_role", "workspace_memberships", type_="check"
        )
    op.create_check_constraint(
        "ck_membership_role",
        "workspace_memberships",
        "role IN ('owner', 'analyst')",
    )

    invitation_constraint = "ck_workspace_invitation_role"
    if _has_check("workspace_invitations", invitation_constraint):
        op.drop_constraint(
            invitation_constraint, "workspace_invitations", type_="check"
        )
    op.create_check_constraint(
        invitation_constraint,
        "workspace_invitations",
        "role = 'analyst'",
    )


def downgrade() -> None:
    # Reverting the code is safe only after the operational rollback restores
    # the membership snapshot. Never silently flatten Owners into Analysts.
    raise RuntimeError(
        "Refusing to downgrade workspace roles. Restore the membership snapshot "
        "and deploy the previous release using the documented rollback runbook."
    )
