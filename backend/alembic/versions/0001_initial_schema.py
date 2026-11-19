"""Initial schema: every table of doc 10, workspace extensions included.

Hand-checked against backend/db/tables.py; backend/tests/db/test_schema.py compares the
migrated catalog with `metadata.create_all`. The trigger SQL (invariants 1 and 8) is copied
here, not imported, so this revision stays fixed when tables.py changes.

Revision ID: 0001
Revises:
Create Date: 2026-10-17 14:59:14.479662
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EVENTS_APPEND_ONLY_FN = """
CREATE FUNCTION events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.kind = 'tool_result'
     AND (to_jsonb(NEW) - 'payload') = (to_jsonb(OLD) - 'payload')
     AND (NEW.payload - 'text' - 'batch_offloaded_at')
         = (OLD.payload - 'text' - 'batch_offloaded_at')
     AND OLD.payload ->> 'batch_offloaded_at' IS NULL
     AND NEW.payload ->> 'batch_offloaded_at' IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    MESSAGE = 'events are append-only (only a batch offload may rewrite a tool_result)',
    ERRCODE = 'integrity_constraint_violation';
END
$$
"""

IMMUTABLE_ROW_FN = """
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = TG_TABLE_NAME || ' rows are never updated or deleted',
    ERRCODE = 'integrity_constraint_violation';
END
$$
"""

IMMUTABLE_TABLES = ("report_versions", "report_artifacts", "report_evidence")


def upgrade() -> None:
    op.create_table(
        "domains",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("status_reason", sa.Text(), nullable=True),
        sa.Column(
            "synced_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('available', 'unavailable')", name=op.f("ck_domains_status")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_domains")),
    )
    op.create_table(
        "library_presets",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("title_vi", sa.Text(), nullable=False),
        sa.Column("description_vi", sa.Text(), nullable=False),
        sa.Column("packages", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("domain_id", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["domain_id"], ["domains.id"], name=op.f("fk_library_presets_domain_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_library_presets")),
    )
    op.create_table(
        "skill_catalog",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("title_vi", sa.Text(), nullable=False),
        sa.Column("description_vi", sa.Text(), nullable=False),
        sa.Column(
            "tags", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False
        ),
        sa.Column("install_cmd", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("domain_id", sa.Text(), nullable=True),
        sa.Column(
            "seeded_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["domain_id"], ["domains.id"], name=op.f("fk_skill_catalog_domain_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_skill_catalog")),
    )
    op.create_index(
        "ix_skill_catalog_tags", "skill_catalog", ["tags"], unique=False, postgresql_using="gin"
    )
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("domain_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("status_detail", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(role = 'admin') = (domain_id IS NULL)", name=op.f("ck_users_admin_has_no_domain")
        ),
        sa.CheckConstraint("role IN ('user', 'admin')", name=op.f("ck_users_role")),
        sa.CheckConstraint(
            "status IN ('provisioning', 'active', 'failed', 'disabled')",
            name=op.f("ck_users_status"),
        ),
        sa.CheckConstraint("username ~ '^[a-z0-9._-]{3,32}$'", name=op.f("ck_users_username")),
        sa.CheckConstraint("char_length(display_name) <= 100", name=op.f("ck_users_display_name")),
        sa.ForeignKeyConstraint(["domain_id"], ["domains.id"], name=op.f("fk_users_domain_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("username", name=op.f("uq_users_username")),
    )
    op.create_table(
        "agents",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("avatar", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("origin", sa.Text(), nullable=False),
        sa.Column("is_lead", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("status_detail", sa.Text(), nullable=True),
        sa.Column(
            "compaction_pending", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("compaction_failures", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("baseline_commit", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "origin IN ('lead', 'starter', 'custom')", name=op.f("ck_agents_origin")
        ),
        sa.CheckConstraint("slug ~ '^[a-z0-9][a-z0-9-]{1,31}$'", name=op.f("ck_agents_slug")),
        sa.CheckConstraint("state IN ('active', 'deleted')", name=op.f("ck_agents_state")),
        sa.CheckConstraint(
            "status IN ('idle', 'busy', 'routine', 'compacting')", name=op.f("ck_agents_status")
        ),
        sa.CheckConstraint("compaction_failures >= 0", name=op.f("ck_agents_compaction_failures")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_agents_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agents")),
        sa.UniqueConstraint("user_id", "slug", name=op.f("uq_agents_user_id_slug")),
    )
    op.create_index(
        "uq_agents_one_lead_per_user",
        "agents",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_lead"),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.CheckConstraint(
            "octet_length(token_hash) = 32", name=op.f("ck_auth_sessions_token_hash")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_auth_sessions_user_id"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("token_hash", name=op.f("pk_auth_sessions")),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"], unique=False)
    op.create_table(
        "threads",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("member_key", sa.Text(), nullable=True),
        sa.Column("read_only", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "last_message_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('direct', 'group', 'agent')", name=op.f("ck_threads_kind")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_threads_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_threads")),
    )
    op.create_index(
        "uq_threads_member_key",
        "threads",
        ["user_id", "kind", "member_key"],
        unique=True,
        postgresql_where=sa.text("kind IN ('direct', 'agent')"),
    )
    op.create_table(
        "user_notifications",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("target", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "occurred_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("read_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('account-created', 'system', 'report-ready', 'task-failed', 'action-required')",
            name=op.f("ck_user_notifications_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_notifications_user_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_notifications")),
    )
    op.create_index(
        "ix_user_notifications_user_id_occurred_at",
        "user_notifications",
        ["user_id", sa.literal_column("occurred_at DESC")],
        unique=False,
    )
    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_user_preferences_user_id")
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_preferences")),
    )
    op.create_table(
        "agent_epochs",
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=False),
        sa.Column("start_seq", sa.BigInteger(), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "reason IN ('initial', 'compaction', 'reset', 'truncated')",
            name=op.f("ck_agent_epochs_reason"),
        ),
        sa.CheckConstraint("epoch >= 0", name=op.f("ck_agent_epochs_epoch")),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], name=op.f("fk_agent_epochs_agent_id")),
        sa.PrimaryKeyConstraint("agent_id", "epoch", name=op.f("pk_agent_epochs")),
    )
    op.create_table(
        "datasets",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column(
            "published_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('dashboard')", name=op.f("ck_datasets_kind")),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], name=op.f("fk_datasets_agent_id")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_datasets_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_datasets")),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("request", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("output", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('agent_create', 'agent_reset', 'skill_install', 'skill_remove', 'package_add', 'package_remove', 'preset_apply')",
            name=op.f("ck_jobs_kind"),
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')", name=op.f("ck_jobs_status")
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], name=op.f("fk_jobs_agent_id")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_jobs_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jobs")),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("thread_id", sa.UUID(), nullable=False),
        sa.Column("sender_type", sa.Text(), nullable=False),
        sa.Column("sender_id", sa.UUID(), nullable=True),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=True),
        sa.Column("exec_id", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(sender_type = 'system') = (sender_id IS NULL)",
            name=op.f("ck_messages_system_has_no_sender"),
        ),
        sa.CheckConstraint(
            "sender_type IN ('user', 'agent', 'system')", name=op.f("ck_messages_sender_type")
        ),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], name=op.f("fk_messages_thread_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
    )
    op.create_index("ix_messages_thread_id_id", "messages", ["thread_id", "id"], unique=False)
    op.create_table(
        "reports",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column(
            "project_ids",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column(
            "market_ids",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("code ~ '^R[0-9]+$'", name=op.f("ck_reports_code")),
        sa.CheckConstraint("type ~ '^[a-z][a-z0-9-]{0,79}$'", name=op.f("ck_reports_type")),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], name=op.f("fk_reports_agent_id")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_reports_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reports")),
        sa.UniqueConstraint("user_id", "code", name=op.f("uq_reports_user_id_code")),
    )
    op.create_table(
        "routine_state",
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("cron", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("prompt_sha", sa.String(length=64), nullable=False),
        sa.Column("next_fire_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_fired_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_started_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_ended_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("pending", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["agents.id"], name=op.f("fk_routine_state_agent_id")
        ),
        sa.PrimaryKeyConstraint("agent_id", "name", name=op.f("pk_routine_state")),
    )
    op.create_table(
        "thread_members",
        sa.Column("thread_id", sa.UUID(), nullable=False),
        sa.Column("member_type", sa.Text(), nullable=False),
        sa.Column("member_id", sa.UUID(), nullable=False),
        sa.Column("last_read_message_id", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "member_type IN ('user', 'agent')", name=op.f("ck_thread_members_member_type")
        ),
        sa.ForeignKeyConstraint(
            ["thread_id"], ["threads.id"], name=op.f("fk_thread_members_thread_id")
        ),
        sa.PrimaryKeyConstraint(
            "thread_id", "member_type", "member_id", name=op.f("pk_thread_members")
        ),
    )
    op.create_table(
        "attachments",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("mime", sa.Text(), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.CheckConstraint("size >= 0", name=op.f("ck_attachments_size")),
        sa.ForeignKeyConstraint(
            ["message_id"], ["messages.id"], name=op.f("fk_attachments_message_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attachments")),
    )
    op.create_table(
        "global_tasks",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("source_message_id", sa.BigInteger(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("ended_by", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("ended_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "ended_by IS NULL OR ended_by IN ('lead', 'user', 'timeout', 'harness')",
            name=op.f("ck_global_tasks_ended_by"),
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed', 'cancelled')",
            name=op.f("ck_global_tasks_status"),
        ),
        sa.ForeignKeyConstraint(
            ["source_message_id"], ["messages.id"], name=op.f("fk_global_tasks_source_message_id")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_global_tasks_user_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_global_tasks")),
    )
    op.create_index(
        "uq_global_tasks_one_running_per_user",
        "global_tasks",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_table(
        "jev_decisions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("lead_id", sa.UUID(), nullable=False),
        sa.Column("input", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("fallback", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=False),
        sa.Column("observed", sa.Text(), nullable=True),
        sa.Column("observed_by", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "label IN ('task', 'side_question')", name=op.f("ck_jev_decisions_label")
        ),
        sa.CheckConstraint(
            "observed IS NULL OR observed IN ('task', 'side_question')",
            name=op.f("ck_jev_decisions_observed"),
        ),
        sa.ForeignKeyConstraint(["lead_id"], ["agents.id"], name=op.f("fk_jev_decisions_lead_id")),
        sa.ForeignKeyConstraint(
            ["message_id"], ["messages.id"], name=op.f("fk_jev_decisions_message_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_jev_decisions")),
    )
    op.create_table(
        "report_versions",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("schema", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("policy_version", sa.Text(), nullable=False),
        sa.Column("content_revision", sa.Text(), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=False),
        sa.Column(
            "completed_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("sequence >= 1", name=op.f("ck_report_versions_sequence")),
        sa.ForeignKeyConstraint(
            ["report_id"], ["reports.id"], name=op.f("fk_report_versions_report_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_versions")),
        sa.UniqueConstraint(
            "report_id", "sequence", name=op.f("uq_report_versions_report_id_sequence")
        ),
    )
    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("trace_id", sa.String(length=32), nullable=False),
        sa.Column("activation_kind", sa.Text(), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "activation_kind IN ('message', 'routine', 'compaction', 'task')",
            name=op.f("ck_events_activation_kind"),
        ),
        sa.CheckConstraint(
            "kind IN ('input', 'assistant', 'tool_result', 'error')", name=op.f("ck_events_kind")
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], name=op.f("fk_events_agent_id")),
        sa.ForeignKeyConstraint(["task_id"], ["global_tasks.id"], name=op.f("fk_events_task_id")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_events")),
        sa.UniqueConstraint("agent_id", "seq", name=op.f("uq_events_agent_id_seq")),
    )
    op.create_table(
        "report_artifacts",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("version_id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("mime", sa.Text(), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.CheckConstraint("size >= 0", name=op.f("ck_report_artifacts_size")),
        sa.ForeignKeyConstraint(
            ["version_id"], ["report_versions.id"], name=op.f("fk_report_artifacts_version_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_artifacts")),
    )
    op.create_table(
        "report_attempts",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("report_id", sa.UUID(), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.BigInteger(), nullable=True),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("version_id", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "state IN ('queued', 'running', 'succeeded', 'failed')",
            name=op.f("ck_report_attempts_state"),
        ),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["agents.id"], name=op.f("fk_report_attempts_agent_id")
        ),
        sa.ForeignKeyConstraint(
            ["report_id"], ["reports.id"], name=op.f("fk_report_attempts_report_id")
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["global_tasks.id"], name=op.f("fk_report_attempts_task_id")
        ),
        sa.ForeignKeyConstraint(
            ["version_id"], ["report_versions.id"], name=op.f("fk_report_attempts_version_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_attempts")),
    )
    op.create_index(
        "uq_report_attempts_one_running_per_report",
        "report_attempts",
        ["report_id"],
        unique=True,
        postgresql_where=sa.text("state = 'running'"),
    )
    op.create_table(
        "report_evidence",
        sa.Column("version_id", sa.UUID(), nullable=False),
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("source_id", sa.Text(), nullable=False),
        sa.Column(
            "project_ids",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("snapshot_id", sa.Text(), nullable=True),
        sa.Column("data_through", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("limitation", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["version_id"], ["report_versions.id"], name=op.f("fk_report_evidence_version_id")
        ),
        sa.PrimaryKeyConstraint("version_id", "id", name=op.f("pk_report_evidence")),
    )
    op.create_table(
        "task_involvement",
        sa.Column("task_id", sa.BigInteger(), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column(
            "first_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["agent_id"], ["agents.id"], name=op.f("fk_task_involvement_agent_id")
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["global_tasks.id"], name=op.f("fk_task_involvement_task_id")
        ),
        sa.PrimaryKeyConstraint("task_id", "agent_id", name=op.f("pk_task_involvement")),
    )
    op.create_table(
        "deliveries",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("agent_id", sa.UUID(), nullable=False),
        sa.Column("message_id", sa.BigInteger(), nullable=True),
        sa.Column("notice", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("route", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("consumed_seq", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("route IN ('notification', 'jev')", name=op.f("ck_deliveries_route")),
        sa.CheckConstraint(
            "status = 'consumed' OR consumed_seq IS NULL", name=op.f("ck_deliveries_consumed_seq")
        ),
        sa.CheckConstraint(
            "status IN ('classifying', 'pending', 'consumed')", name=op.f("ck_deliveries_status")
        ),
        sa.CheckConstraint(
            "(message_id IS NULL) <> (notice IS NULL)", name=op.f("ck_deliveries_message_or_notice")
        ),
        sa.ForeignKeyConstraint(
            ["agent_id", "consumed_seq"],
            ["events.agent_id", "events.seq"],
            name=op.f("fk_deliveries_agent_id_consumed_seq"),
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], name=op.f("fk_deliveries_agent_id")),
        sa.ForeignKeyConstraint(
            ["message_id"], ["messages.id"], name=op.f("fk_deliveries_message_id")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_deliveries")),
    )
    op.create_index(
        "ix_deliveries_pending",
        "deliveries",
        ["agent_id"],
        unique=False,
        postgresql_where=sa.text("status = 'pending'"),
    )

    # Invariant 1: events are append-only, except a batch offload of a tool_result.
    op.execute(EVENTS_APPEND_ONLY_FN)
    op.execute(
        "CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events "
        "FOR EACH ROW EXECUTE FUNCTION events_append_only()"
    )
    # Invariant 8: report versions, artifacts and evidence are never updated or deleted.
    op.execute(IMMUTABLE_ROW_FN)
    for table in IMMUTABLE_TABLES:
        op.execute(
            f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION immutable_row()"
        )


def downgrade() -> None:
    op.drop_index(
        "ix_deliveries_pending",
        table_name="deliveries",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_table("deliveries")
    op.drop_table("task_involvement")
    op.drop_table("report_evidence")
    op.drop_index(
        "uq_report_attempts_one_running_per_report",
        table_name="report_attempts",
        postgresql_where=sa.text("state = 'running'"),
    )
    op.drop_table("report_attempts")
    op.drop_table("report_artifacts")
    op.drop_table("events")
    op.drop_table("report_versions")
    op.drop_table("jev_decisions")
    op.drop_index(
        "uq_global_tasks_one_running_per_user",
        table_name="global_tasks",
        postgresql_where=sa.text("status = 'running'"),
    )
    op.drop_table("global_tasks")
    op.drop_table("attachments")
    op.drop_table("thread_members")
    op.drop_table("routine_state")
    op.drop_table("reports")
    op.drop_index("ix_messages_thread_id_id", table_name="messages")
    op.drop_table("messages")
    op.drop_table("jobs")
    op.drop_table("datasets")
    op.drop_table("agent_epochs")
    op.drop_table("user_preferences")
    op.drop_index("ix_user_notifications_user_id_occurred_at", table_name="user_notifications")
    op.drop_table("user_notifications")
    op.drop_index(
        "uq_threads_member_key",
        table_name="threads",
        postgresql_where=sa.text("kind IN ('direct', 'agent')"),
    )
    op.drop_table("threads")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index(
        "uq_agents_one_lead_per_user", table_name="agents", postgresql_where=sa.text("is_lead")
    )
    op.drop_table("agents")
    op.drop_table("users")
    op.drop_index("ix_skill_catalog_tags", table_name="skill_catalog", postgresql_using="gin")
    op.drop_table("skill_catalog")
    op.drop_table("library_presets")
    op.drop_table("domains")
    op.execute("DROP FUNCTION IF EXISTS events_append_only()")
    op.execute("DROP FUNCTION IF EXISTS immutable_row()")
