"""Add durable, tenant-scoped P2 chat continuity and learning records.

The migration is expand-only.  It never copies browser history, mutates an old
answer, or grants browser roles access to chat/evaluation/cache content.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260831_0024"
down_revision = "20260831_0023"
branch_labels = None
depends_on = None


# This inventory deliberately lives in the revision that creates these tables.
# The earlier 0022 boundary migration must remain able to run against its
# historical schema during fresh installs and upgrade smoke tests.
BACKEND_ONLY_TABLES = (
    "conversations",
    "conversation_messages",
    "conversation_feedback",
    "evaluation_candidates",
    "qa_answer_cache",
)
BROWSER_ROLES = ("anon", "authenticated")


def _has_table(name: str) -> bool:
    return name in inspect(op.get_bind()).get_table_names(schema="public")


def _has_index(table: str, name: str) -> bool:
    return any(item["name"] == name for item in inspect(op.get_bind()).get_indexes(table, schema="public"))


def _index(name: str, table: str, columns: list[str]) -> None:
    if not _has_index(table, name):
        op.create_index(name, table, columns)


def upgrade() -> None:
    if not _has_table("conversations"):
        op.create_table(
            "conversations",
            sa.Column("id", sa.String(128), primary_key=True),
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
            sa.Column("created_by_user_id", sa.String(36), nullable=False),
            sa.Column("title", sa.String(160), nullable=False),
            sa.Column("active_dataset_id", sa.String(32), sa.ForeignKey("datasets.id")),
            sa.Column("active_profile_run_id", sa.String(32), sa.ForeignKey("profile_runs.id")),
            sa.Column("archived_at", sa.DateTime(timezone=True)),
            sa.Column("deleted_at", sa.DateTime(timezone=True)),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        )
    _index("ix_conversations_workspace_updated", "conversations", ["workspace_id", "updated_at"])

    if not _has_table("conversation_messages"):
        op.create_table(
            "conversation_messages",
            sa.Column("id", sa.String(128), primary_key=True),
            sa.Column("conversation_id", sa.String(128), sa.ForeignKey("conversations.id"), nullable=False),
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
            sa.Column("role", sa.String(16), nullable=False),
            sa.Column("request_id", sa.String(128)),
            sa.Column("agent_run_id", sa.String(32), sa.ForeignKey("agent_runs.id")),
            sa.Column("parent_message_id", sa.String(128)),
            sa.Column("retry_of", sa.String(128)),
            sa.Column("regeneration_of", sa.String(128)),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("answer_envelope", sa.JSON()),
            sa.Column("context_snapshot", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.CheckConstraint("role IN ('user', 'agent')", name="ck_conversation_messages_role"),
        )
    _index("ix_conversation_messages_workspace_created", "conversation_messages", ["workspace_id", "created_at"])
    _index("ix_conversation_messages_conversation_created", "conversation_messages", ["conversation_id", "created_at"])

    if not _has_table("conversation_feedback"):
        op.create_table(
            "conversation_feedback",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
            sa.Column("actor_user_id", sa.String(36), nullable=False),
            sa.Column("conversation_id", sa.String(128), sa.ForeignKey("conversations.id")),
            # Scalar supports feedback for P1 answers created before P2 storage.
            sa.Column("message_id", sa.String(128), nullable=False),
            sa.Column("agent_run_id", sa.String(32), sa.ForeignKey("agent_runs.id"), nullable=False),
            sa.Column("polarity", sa.String(16), nullable=False),
            sa.Column("reason_code", sa.String(64)),
            sa.Column("metadata", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("workspace_id", "actor_user_id", "message_id", name="uq_conversation_feedback_workspace_actor_message"),
            sa.CheckConstraint("polarity IN ('helpful', 'not_helpful')", name="ck_conversation_feedback_polarity"),
        )
    _index("ix_conversation_feedback_workspace_created", "conversation_feedback", ["workspace_id", "created_at"])

    if not _has_table("evaluation_candidates"):
        op.create_table(
            "evaluation_candidates",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
            sa.Column("feedback_id", sa.String(32), sa.ForeignKey("conversation_feedback.id"), nullable=False),
            sa.Column("status", sa.String(32), nullable=False, server_default="pending_review"),
            sa.Column("case_spec", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("reviewed_at", sa.DateTime(timezone=True)),
            sa.UniqueConstraint("feedback_id", name="uq_evaluation_candidates_feedback"),
        )
    _index("ix_evaluation_candidates_workspace_created", "evaluation_candidates", ["workspace_id", "created_at"])

    if not _has_table("qa_answer_cache"):
        op.create_table(
            "qa_answer_cache",
            sa.Column("id", sa.String(32), primary_key=True),
            sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
            sa.Column("cache_key", sa.String(71), nullable=False),
            sa.Column("intent", sa.String(64), nullable=False),
            sa.Column("dimensions", sa.JSON(), nullable=False),
            sa.Column("response", sa.JSON(), nullable=False),
            sa.Column("validator_version", sa.String(64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("last_hit_at", sa.DateTime(timezone=True)),
            sa.Column("hit_count", sa.Integer(), nullable=False, server_default="0"),
            sa.UniqueConstraint("workspace_id", "cache_key", name="uq_qa_answer_cache_workspace_key"),
        )
    _index("ix_qa_answer_cache_workspace_expiry", "qa_answer_cache", ["workspace_id", "expires_at"])

    # FastAPI is the only data path. Enable RLS with no browser policies so
    # direct Supabase/Data API access remains deny-by-default.
    for table in BACKEND_ONLY_TABLES:
        op.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
        # New public-schema tables must be explicitly deny-by-default even in
        # databases that pre-date Supabase's default-privilege hardening.
        op.execute(f'REVOKE ALL ON TABLE public."{table}" FROM PUBLIC')
        for role in BROWSER_ROLES:
            op.execute(f'REVOKE ALL ON TABLE public."{table}" FROM "{role}"')


def downgrade() -> None:
    # Preserve durable history/provenance when rolling an application release
    # back. Deletion follows configured retention, never Alembic downgrade.
    pass
