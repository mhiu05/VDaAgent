"""Add a logical collection name shared by datasets uploaded together."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260814_0006"
down_revision = "20260814_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("datasets")}
    if "collection_name" not in columns:
        op.add_column("datasets", sa.Column("collection_name", sa.String(255)))
    indexes = {index["name"] for index in inspector.get_indexes("datasets")}
    if "ix_datasets_collection_name" not in indexes:
        op.create_index("ix_datasets_collection_name", "datasets", ["collection_name"])


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    indexes = {index["name"] for index in inspector.get_indexes("datasets")}
    if "ix_datasets_collection_name" in indexes:
        op.drop_index("ix_datasets_collection_name", table_name="datasets")
    columns = {column["name"] for column in inspector.get_columns("datasets")}
    if "collection_name" in columns:
        op.drop_column("datasets", "collection_name")
