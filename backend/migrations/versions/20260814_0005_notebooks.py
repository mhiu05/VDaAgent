"""Add workspace-scoped Notebook LLM documents and cells."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260814_0005"
down_revision = "20260813_0004"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in inspect(op.get_bind()).get_table_names(schema="public")


def upgrade() -> None:
    if not _has_table("notebooks"):
        op.create_table(
            "notebooks",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
            sa.Column("profile_run_id", sa.String(32), sa.ForeignKey("profile_runs.id"), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text()),
            sa.Column("visibility", sa.String(16), nullable=False, server_default="private"),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("created_by_user_id", sa.String(36), nullable=False),
            sa.Column("shared_by_user_id", sa.String(36)),
            sa.Column("shared_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
        op.create_index("ix_notebooks_workspace_id", "notebooks", ["workspace_id"])
        op.create_index("ix_notebooks_profile_run_id", "notebooks", ["profile_run_id"])
        op.create_index("ix_notebooks_workspace_updated_at", "notebooks", ["workspace_id", "updated_at"])
    if not _has_table("notebook_cells"):
        op.create_table(
            "notebook_cells",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("notebook_id", sa.String(32), sa.ForeignKey("notebooks.id"), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("title", sa.String(255)),
            sa.Column("source", sa.Text(), nullable=False),
            sa.Column("result", sa.JSON()),
            sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
            sa.Column("created_by_user_id", sa.String(36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
        op.create_index("ix_notebook_cells_notebook_id", "notebook_cells", ["notebook_id"])
        op.create_index("ix_notebook_cells_notebook_position", "notebook_cells", ["notebook_id", "position"])


def downgrade() -> None:
    if _has_table("notebook_cells"):
        op.drop_table("notebook_cells")
    if _has_table("notebooks"):
        op.drop_table("notebooks")
