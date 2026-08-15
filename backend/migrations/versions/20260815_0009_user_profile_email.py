"""Project Auth emails into the application identity table for Admin lookup."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260815_0009"
down_revision = "20260815_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("user_profiles")}
    if "email" not in columns:
        op.add_column("user_profiles", sa.Column("email", sa.String(320), nullable=True))

    indexes = {index["name"] for index in inspector.get_indexes("user_profiles")}
    if "ix_user_profiles_email" not in indexes:
        op.create_index("ix_user_profiles_email", "user_profiles", ["email"])

    # Supabase keeps the authoritative email in auth.users. Backfill the
    # app-side projection when that schema is available; local/test databases
    # do not have it and will populate email from the signed-in JWT instead.
    if bind.dialect.name == "postgresql":
        auth_users = bind.execute(
            sa.text("SELECT to_regclass('auth.users')")
        ).scalar()
        if auth_users:
            bind.execute(
                sa.text(
                    """
                    UPDATE user_profiles AS profile
                    SET email = lower(auth_user.email), updated_at = now()
                    FROM auth.users AS auth_user
                    WHERE auth_user.id::text = profile.user_id
                      AND auth_user.email IS NOT NULL
                      AND (profile.email IS NULL OR profile.email <> lower(auth_user.email))
                    """
                )
            )


def downgrade() -> None:
    # Identity projection is retained to preserve workspace auditability.
    pass
