"""domain_credential_sets, domain_credential_values, domain_starters: admin-managed domains
(credentials encrypted at rest); domains.created_by for light audit.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-20 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("domains", sa.Column("created_by", sa.Text(), nullable=True))

    op.create_table(
        "domain_credential_sets",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("domain_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("keys", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.ForeignKeyConstraint(
            ["domain_id"], ["domains.id"], name=op.f("fk_domain_credential_sets_domain_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_domain_credential_sets")),
        sa.UniqueConstraint(
            "domain_id", "name", name=op.f("uq_domain_credential_sets_domain_id_name")
        ),
    )

    op.create_table(
        "domain_credential_values",
        sa.Column("set_id", sa.UUID(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["set_id"],
            ["domain_credential_sets.id"],
            name=op.f("fk_domain_credential_values_set_id"),
        ),
        sa.PrimaryKeyConstraint("set_id", "key", name=op.f("pk_domain_credential_values")),
    )

    op.create_table(
        "domain_starters",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("domain_id", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("avatar", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("presets", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("credentials", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("prompt", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("is_lead", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.ForeignKeyConstraint(
            ["domain_id"], ["domains.id"], name=op.f("fk_domain_starters_domain_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_domain_starters")),
        sa.UniqueConstraint("domain_id", "slug", name=op.f("uq_domain_starters_domain_id_slug")),
    )


def downgrade() -> None:
    op.drop_table("domain_starters")
    op.drop_table("domain_credential_values")
    op.drop_table("domain_credential_sets")
    op.drop_column("domains", "created_by")
