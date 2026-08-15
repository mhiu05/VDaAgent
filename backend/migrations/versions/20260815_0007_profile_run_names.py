"""Add a human-readable name for each profiling run."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260815_0007"
down_revision = "20260814_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("profile_runs")}
    if "run_name" not in columns:
        op.add_column("profile_runs", sa.Column("run_name", sa.String(255)))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("profile_runs")}
    if "run_name" in columns:
        op.drop_column("profile_runs", "run_name")
