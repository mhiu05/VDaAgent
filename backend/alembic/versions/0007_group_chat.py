"""users.account_type, groups, group_members: technical group owners and group membership.

Additive: existing users become `account_type='human'` through the column default. A `service`
account owns a group's agents and never logs in (PLAN_GROUPCHAT §5, §7).

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-20 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("account_type", sa.Text(), server_default=sa.text("'human'"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_users_account_type"), "users", "account_type IN ('human', 'service')"
    )
    op.create_check_constraint(
        op.f("ck_users_service_is_not_admin"), "users", "account_type = 'human' OR role = 'user'"
    )
    op.create_table(
        "groups",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("technical_owner_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 100", name=op.f("ck_groups_name")),
        sa.ForeignKeyConstraint(
            ["technical_owner_id"], ["users.id"], name=op.f("fk_groups_technical_owner_id")
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], name=op.f("fk_groups_created_by_user_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_groups")),
        sa.UniqueConstraint("technical_owner_id", name=op.f("uq_groups_technical_owner_id")),
    )
    op.create_table(
        "group_members",
        sa.Column("group_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name=op.f("fk_group_members_group_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_group_members_user_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("group_id", "user_id", name=op.f("pk_group_members")),
    )
    op.create_index("ix_group_members_user_id", "group_members", ["user_id"], unique=False)


def downgrade() -> None:
    # Service rows (and their agents) stay as ordinary rows; only group data is dropped.
    op.drop_index("ix_group_members_user_id", table_name="group_members")
    op.drop_table("group_members")
    op.drop_table("groups")
    op.drop_constraint(op.f("ck_users_service_is_not_admin"), "users", type_="check")
    op.drop_constraint(op.f("ck_users_account_type"), "users", type_="check")
    op.drop_column("users", "account_type")
