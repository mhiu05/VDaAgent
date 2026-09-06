"""Persist reviewer notes and final PII classifications."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260815_0008"
down_revision = "20260815_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    for table_name in (
        "candidate_key_proposals",
        "semantic_type_proposals",
        "pii_proposals",
    ):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "review_note" not in columns:
            op.add_column(table_name, sa.Column("review_note", sa.Text()))
    pii_columns = {
        column["name"] for column in inspector.get_columns("pii_proposals")
    }
    if "final_type" not in pii_columns:
        op.add_column("pii_proposals", sa.Column("final_type", sa.String(64)))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    pii_columns = {
        column["name"] for column in inspector.get_columns("pii_proposals")
    }
    if "final_type" in pii_columns:
        op.drop_column("pii_proposals", "final_type")
    for table_name in (
        "candidate_key_proposals",
        "semantic_type_proposals",
        "pii_proposals",
    ):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "review_note" in columns:
            op.drop_column(table_name, "review_note")
